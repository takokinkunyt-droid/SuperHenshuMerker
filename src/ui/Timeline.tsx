import { memo, useEffect, useRef } from 'react';
import { editorState, useEditor } from '../state/store';
import type { Project, TimelineItem } from '../types';
import { MIN_ITEM_DURATION, MIN_LAYERS } from '../state/defaults';
import { formatTime, itemEnd, overlaps, projectDuration, rulerStep, trimStart } from '../state/timeline';
import { playback } from '../media/playback';
import { addTextItem, deleteItem, duplicateItem, splitAtPlayhead } from '../state/actions';

const ROW_H = 36;
const RULER_H = 26;
const HEAD_W = 56;
const SNAP_PX = 8;

const KIND_LABEL: Record<TimelineItem['kind'], string> = {
  voice: 'セリフ',
  tachie: '立ち絵',
  text: 'テキスト',
  image: '画像',
  video: '動画',
  audio: '音声',
};

function itemLabel(project: Project, item: TimelineItem): string {
  switch (item.kind) {
    case 'voice': {
      const ch = project.characters.find((c) => c.id === item.characterId);
      return `${ch?.name ?? '?'}：${item.text}`;
    }
    case 'tachie':
      return `立ち絵：${project.characters.find((c) => c.id === item.characterId)?.name ?? '?'}`;
    case 'text':
      return item.text;
    default:
      return project.assets[item.assetId]?.name ?? KIND_LABEL[item.kind];
  }
}

function itemColor(project: Project, item: TimelineItem): string {
  if (item.kind === 'voice' || item.kind === 'tachie') {
    return project.characters.find((c) => c.id === item.characterId)?.color ?? '#777';
  }
  return { text: '#b08d2c', image: '#3a7bd5', video: '#7a4fd1', audio: '#2f9e8f' }[item.kind];
}

/** 素材の長さを超えて伸ばせないようにする上限 */
function maxDuration(project: Project, item: TimelineItem): number {
  let assetId: string | null = null;
  let offset = 0;
  if (item.kind === 'audio' || item.kind === 'video') {
    assetId = item.assetId;
    offset = item.sourceOffset;
  } else if (item.kind === 'voice' && item.audioAssetId) {
    assetId = item.audioAssetId;
    offset = item.audioOffset;
  }
  const d = assetId ? project.assets[assetId]?.duration : undefined;
  return d ? Math.max(MIN_ITEM_DURATION, d - offset) : Infinity;
}

type DragMode = 'move' | 'left' | 'right';

interface DragState {
  mode: DragMode;
  id: string;
  x0: number;
  y0: number;
  item: TimelineItem;
  snaps: number[];
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const pps = useEditor((s) => s.pxPerSec);
  const selectedId = useEditor((s) => s.selectedItemId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState | null>(null);

  const maxLayer = project.items.reduce((m, it) => Math.max(m, it.layer), 0);
  const layers = Math.max(MIN_LAYERS, maxLayer + 3);
  const duration = projectDuration(project);
  const contentW = Math.max(duration + 30, 60) * pps;

  // 再生中は再生位置が見えるようにスクロールする
  useEffect(
    () =>
      useEditor.subscribe((s) => {
        const el = scrollRef.current;
        if (!el || !s.playing) return;
        const x = s.currentTime * s.pxPerSec;
        if (x > el.scrollLeft + el.clientWidth - 80 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 120);
      }),
    [],
  );

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft) / pps);
  };

  const snap = (t: number, snaps: number[], disable: boolean) => {
    if (disable) return t;
    const threshold = SNAP_PX / pps;
    let best = t;
    let bestDist = threshold;
    for (const s of snaps) {
      const dist = Math.abs(s - t);
      if (dist < bestDist) {
        best = s;
        bestDist = dist;
      }
    }
    return best;
  };

  const onItemPointerDown = (e: React.PointerEvent, item: TimelineItem, mode: DragMode) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const s = editorState();
    s.selectItem(item.id);
    const snaps = [s.currentTime, 0];
    for (const it of s.project.items) if (it.id !== item.id) snaps.push(it.start, itemEnd(it));
    drag.current = { mode, id: item.id, x0: e.clientX, y0: e.clientY, item, snaps };
    s.beginGesture();
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp, { once: true });
  };

  const onPointerMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const s = editorState();
    const dt = (e.clientX - d.x0) / s.pxPerSec;
    const it = d.item;
    const noSnap = e.altKey;
    if (d.mode === 'move') {
      let start = Math.max(0, it.start + dt);
      // 開始・終了のどちらかが吸着点に近ければ合わせる
      const snappedStart = snap(start, d.snaps, noSnap);
      const snappedEnd = snap(start + it.duration, d.snaps, noSnap);
      if (snappedStart !== start) start = snappedStart;
      else if (snappedEnd !== start + it.duration) start = snappedEnd - it.duration;
      start = Math.max(0, start);
      let layer = Math.max(0, it.layer + Math.round((e.clientY - d.y0) / ROW_H));
      const items = s.project.items;
      if (overlaps(items, layer, start, start + it.duration, it.id)) {
        // 重なる場合は元のレイヤーで試し、それでも重なれば動かさない
        layer = it.layer;
        if (overlaps(items, layer, start, start + it.duration, it.id)) return;
      }
      s.editTransient((p) => {
        const target = p.items.find((x) => x.id === it.id);
        if (target) Object.assign(target, { start, layer });
      });
    } else if (d.mode === 'right') {
      const end = snap(itemEnd(it) + dt, d.snaps, noSnap);
      const duration = Math.min(maxDuration(s.project, it), Math.max(MIN_ITEM_DURATION, end - it.start));
      if (overlaps(s.project.items, it.layer, it.start, it.start + duration, it.id)) return;
      s.editTransient((p) => {
        const target = p.items.find((x) => x.id === it.id);
        if (target) target.duration = duration;
      });
    } else {
      const patch = trimStart(it, snap(it.start + dt, d.snaps, noSnap));
      if (overlaps(s.project.items, it.layer, patch.start!, itemEnd(it), it.id)) return;
      s.editTransient((p) => {
        const target = p.items.find((x) => x.id === it.id);
        if (target) Object.assign(target, patch);
      });
    }
  };

  const onPointerUp = () => {
    window.removeEventListener('pointermove', onPointerMove);
    drag.current = null;
    editorState().endGesture();
  };

  const onRulerPointerDown = (e: React.PointerEvent) => {
    playback.seek(timeAt(e.clientX));
    const move = (ev: PointerEvent) => editorState().setTime(timeAt(ev.clientX));
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', () => window.removeEventListener('pointermove', move), { once: true });
  };

  return (
    <div className="timeline">
      <div className="timeline-toolbar">
        <button className="btn small" onClick={splitAtPlayhead} title="再生位置で分割 (S)">
          ✂ 分割
        </button>
        <button className="btn small" disabled={!selectedId} onClick={() => selectedId && duplicateItem(selectedId)} title="複製 (Ctrl+D)">
          ⧉ 複製
        </button>
        <button className="btn small" disabled={!selectedId} onClick={() => selectedId && deleteItem(selectedId)} title="削除 (Delete)">
          🗑 削除
        </button>
        <button className="btn small" onClick={addTextItem} title="再生位置にテキストを追加">
          T テキスト追加
        </button>
        <span className="spacer" />
        <span className="hint">ドラッグで移動・端で伸縮（Altで吸着なし）</span>
        <button className="icon-btn" title="縮小" onClick={() => editorState().setPxPerSec(pps / 1.4)}>
          −
        </button>
        <input
          type="range"
          min={5}
          max={600}
          value={pps}
          onChange={(e) => editorState().setPxPerSec(Number(e.target.value))}
          aria-label="タイムラインの拡大率"
        />
        <button className="icon-btn" title="拡大" onClick={() => editorState().setPxPerSec(pps * 1.4)}>
          ＋
        </button>
      </div>
      <div className="timeline-body">
        <div className="layer-heads" style={{ paddingTop: RULER_H, width: HEAD_W }}>
          <div className="layer-heads-inner" style={{ height: layers * ROW_H }}>
            {Array.from({ length: layers }, (_, i) => (
              <div key={i} className="layer-head" style={{ height: ROW_H }}>
                {i}
              </div>
            ))}
          </div>
        </div>
        <div
          className="timeline-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            const heads = (e.currentTarget.previousElementSibling as HTMLElement).firstElementChild as HTMLElement;
            heads.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`;
          }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              editorState().setPxPerSec(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
            }
          }}
        >
          <div className="timeline-content" style={{ width: contentW, height: RULER_H + layers * ROW_H }}>
            <Ruler pps={pps} width={contentW} fps={project.fps} onPointerDown={onRulerPointerDown} />
            <div
              className="tracks"
              style={{ top: RULER_H, height: layers * ROW_H }}
              onPointerDown={(e) => {
                if (e.target !== e.currentTarget) return;
                editorState().selectItem(null);
                playback.seek(timeAt(e.clientX));
              }}
            >
              {Array.from({ length: layers }, (_, i) => (
                <div key={i} className="track-row" style={{ top: i * ROW_H, height: ROW_H }} />
              ))}
              <Items project={project} pps={pps} selectedId={selectedId} onPointerDown={onItemPointerDown} />
            </div>
            <Playhead pps={pps} />
          </div>
        </div>
      </div>
    </div>
  );
}

const Items = memo(function Items({
  project,
  pps,
  selectedId,
  onPointerDown,
}: {
  project: Project;
  pps: number;
  selectedId: string | null;
  onPointerDown: (e: React.PointerEvent, item: TimelineItem, mode: DragMode) => void;
}) {
  return (
    <>
      {project.items.map((item) => {
        const missingAudio = item.kind === 'voice' && !item.audioAssetId;
        return (
          <div
            key={item.id}
            className={`tl-item kind-${item.kind} ${item.id === selectedId ? 'selected' : ''} ${missingAudio ? 'no-audio' : ''}`}
            style={{
              left: item.start * pps,
              width: Math.max(2, item.duration * pps),
              top: item.layer * ROW_H + 3,
              height: ROW_H - 6,
              ['--item-color' as string]: itemColor(project, item),
            }}
            title={`${KIND_LABEL[item.kind]}: ${itemLabel(project, item)}${missingAudio ? '（音声なし）' : ''}`}
            onPointerDown={(e) => onPointerDown(e, item, 'move')}
          >
            <span className="tl-handle left" onPointerDown={(e) => onPointerDown(e, item, 'left')} />
            <span className="tl-label">{itemLabel(project, item)}</span>
            <span className="tl-handle right" onPointerDown={(e) => onPointerDown(e, item, 'right')} />
          </div>
        );
      })}
    </>
  );
});

function Ruler({
  pps,
  width,
  fps,
  onPointerDown,
}: {
  pps: number;
  width: number;
  fps: number;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  const step = rulerStep(pps);
  const ticks = [];
  for (let t = 0; t * pps < width; t += step) {
    ticks.push(
      <div key={t} className="tick" style={{ left: t * pps }}>
        <span>{formatTime(t, fps).replace(/\.00$/, '')}</span>
      </div>,
    );
  }
  return (
    <div className="ruler" style={{ height: RULER_H }} onPointerDown={onPointerDown}>
      {ticks}
    </div>
  );
}

function Playhead({ pps }: { pps: number }) {
  const t = useEditor((s) => s.currentTime);
  return <div className="playhead" style={{ transform: `translateX(${t * pps}px)` }} />;
}
