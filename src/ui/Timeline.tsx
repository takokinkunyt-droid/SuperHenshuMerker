import { memo, useEffect, useRef } from 'react';
import { editorState, useEditor } from '../state/store';
import type { Project, TimelineItem } from '../types';
import { MIN_ITEM_DURATION, MIN_LAYERS } from '../state/defaults';
import { formatTime, itemEnd, overlaps, projectDuration, rulerStep, trimStart } from '../state/timeline';
import { playback } from '../media/playback';
import { addTextItem, deleteItem, duplicateItem, splitAtPlayhead } from '../state/actions';
import { AddButtons } from './MediaPanel';

const ROW_H = 40;
const RULER_H = 28;
const HEAD_W = 36;
const SNAP_PX = 8;
/** 長押しと判定するまでの時間 */
const LONG_PRESS_MS = 350;
/** これ以上指が動いたら長押しではなくスクロールとみなす */
const MOVE_TOLERANCE = 10;

const KIND_LABEL: Record<TimelineItem['kind'], string> = {
  text: 'テキスト',
  image: '画像',
  video: '動画',
  audio: '音楽',
};

const KIND_ICON: Record<TimelineItem['kind'], string> = { text: 'T', image: '🖼', video: '🎞', audio: '🎵' };

function itemLabel(project: Project, item: TimelineItem): string {
  if (item.kind === 'text') return item.text;
  return project.assets[item.assetId]?.name ?? KIND_LABEL[item.kind];
}

/** 素材の長さを超えて伸ばせないようにする上限 */
function maxDuration(project: Project, item: TimelineItem): number {
  if (item.kind !== 'audio' && item.kind !== 'video') return Infinity;
  const d = project.assets[item.assetId]?.duration;
  return d ? Math.max(MIN_ITEM_DURATION, d - item.sourceOffset) : Infinity;
}

type DragMode = 'move' | 'left' | 'right';

interface PressHandlers {
  /** 押してすぐ（マウス）または長押しが成立した時点（タッチ）で呼ぶ */
  start: (e: PointerEvent) => void;
  move: (e: PointerEvent) => void;
  end: () => void;
  /** タッチで、長押しにならずに指を離したとき */
  tap?: (e: PointerEvent) => void;
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const pps = useEditor((s) => s.pxPerSec);
  const selectedId = useEditor((s) => s.selectedItemId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  /** ドラッグ中はタッチによるスクロールを止める */
  const lockScroll = useRef(false);

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

  // 長押し後の指の動きでページやタイムラインがスクロールしないようにする
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onTouchMove = (e: TouchEvent) => {
      if (lockScroll.current && e.cancelable) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  const timeAt = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft) / editorState().pxPerSec);
  };

  /** 端に近づいたら自動でスクロールする（ドラッグ中） */
  const autoScroll = (clientX: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    if (clientX < rect.left + 30) el.scrollLeft -= 12;
    else if (clientX > rect.right - 30) el.scrollLeft += 12;
  };

  /**
   * 押す操作の共通処理。マウスや immediate 指定のときはすぐ開始し、
   * タッチは長押し（LONG_PRESS_MS）が成立してから開始する。それまでに指が動けば普通のスクロールに任せる。
   */
  const press = (e: React.PointerEvent, h: PressHandlers, immediate = e.pointerType === 'mouse') => {
    if (e.button !== 0) return;
    const pointerId = e.pointerId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let last = e.nativeEvent;
    let timer = 0;

    const begin = () => {
      started = true;
      lockScroll.current = true;
      if (e.pointerType !== 'mouse') navigator.vibrate?.(15);
      h.start(last);
    };
    const cleanup = () => {
      clearTimeout(timer);
      lockScroll.current = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      last = ev;
      if (started) {
        h.move(ev);
      } else if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > MOVE_TOLERANCE) {
        cleanup(); // 長押し前に動いた＝スクロール
      }
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (started) h.end();
      else h.tap?.(ev);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (started) h.end();
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    if (immediate) begin();
    else timer = window.setTimeout(begin, LONG_PRESS_MS);
  };

  // ---------- 再生位置（赤い線）の移動 ----------

  const scrubHandlers: PressHandlers = {
    start: (ev) => playback.seek(timeAt(ev.clientX)),
    move: (ev) => {
      autoScroll(ev.clientX);
      editorState().setTime(timeAt(ev.clientX));
    },
    end: () => undefined,
    tap: (ev) => {
      editorState().selectItem(null);
      playback.seek(timeAt(ev.clientX));
    },
  };

  /** ルーラーと赤い線のつまみは、押した瞬間から動かせる */
  const onScrubHandleDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    press(e, scrubHandlers, true);
  };

  /** 何も無いところ：クリック／タップで移動、マウスはそのままドラッグ、タッチは長押しでドラッグ */
  const onTracksPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.pointerType === 'mouse') editorState().selectItem(null);
    press(e, scrubHandlers);
  };

  // ---------- アイテムの移動・伸縮 ----------

  const snap = (t: number, snaps: number[], disable: boolean) => {
    if (disable) return t;
    const threshold = SNAP_PX / editorState().pxPerSec;
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
    e.stopPropagation();
    // 端のつまみはすぐ伸縮できる。本体はマウスならすぐ、タッチなら長押しで移動
    const immediate = e.pointerType === 'mouse' || mode !== 'move';
    let x0 = 0;
    let y0 = 0;
    let snaps: number[] = [];
    press(
      e,
      {
        start: (ev) => {
          const s = editorState();
          s.selectItem(item.id);
          x0 = ev.clientX;
          y0 = ev.clientY;
          snaps = [s.currentTime, 0];
          for (const it of s.project.items) if (it.id !== item.id) snaps.push(it.start, itemEnd(it));
          s.beginGesture();
        },
        move: (ev) => {
          autoScroll(ev.clientX);
          applyDrag(item, mode, ev.clientX - x0, ev.clientY - y0, snaps, ev.altKey);
        },
        end: () => editorState().endGesture(),
        tap: () => editorState().selectItem(item.id),
      },
      immediate,
    );
  };

  const applyDrag = (it: TimelineItem, mode: DragMode, dx: number, dy: number, snaps: number[], noSnap: boolean) => {
    const s = editorState();
    const dt = dx / s.pxPerSec;
    if (mode === 'move') {
      let start = Math.max(0, it.start + dt);
      // 開始・終了のどちらかが吸着点に近ければ合わせる
      const snappedStart = snap(start, snaps, noSnap);
      const snappedEnd = snap(start + it.duration, snaps, noSnap);
      if (snappedStart !== start) start = snappedStart;
      else if (snappedEnd !== start + it.duration) start = snappedEnd - it.duration;
      start = Math.max(0, start);
      let layer = Math.max(0, it.layer + Math.round(dy / ROW_H));
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
    } else if (mode === 'right') {
      const end = snap(itemEnd(it) + dt, snaps, noSnap);
      const duration = Math.min(maxDuration(s.project, it), Math.max(MIN_ITEM_DURATION, end - it.start));
      if (overlaps(s.project.items, it.layer, it.start, it.start + duration, it.id)) return;
      s.editTransient((p) => {
        const target = p.items.find((x) => x.id === it.id);
        if (target) target.duration = duration;
      });
    } else {
      const patch = trimStart(it, snap(it.start + dt, snaps, noSnap));
      if (overlaps(s.project.items, it.layer, patch.start!, itemEnd(it), it.id)) return;
      s.editTransient((p) => {
        const target = p.items.find((x) => x.id === it.id);
        if (target) Object.assign(target, patch);
      });
    }
  };

  return (
    <div className="timeline" onContextMenu={(e) => e.preventDefault()}>
      <div className="timeline-toolbar">
        <AddButtons compact />
        <button className="btn add-btn" onClick={addTextItem} title="再生位置にテキストを追加">
          T テキスト
        </button>
        <span className="toolbar-sep" />
        <button className="btn small" onClick={splitAtPlayhead} title="再生位置で分割 (S)">
          ✂ 分割
        </button>
        <button className="btn small" disabled={!selectedId} onClick={() => selectedId && duplicateItem(selectedId)} title="複製 (Ctrl+D)">
          ⧉ 複製
        </button>
        <button className="btn small" disabled={!selectedId} onClick={() => selectedId && deleteItem(selectedId)} title="削除 (Delete)">
          🗑 削除
        </button>
        <span className="spacer" />
        <span className="hint">赤い線はドラッグ・長押しで移動</span>
        <button className="icon-btn" title="縮小" aria-label="タイムラインを縮小" onClick={() => editorState().setPxPerSec(pps / 1.4)}>
          −
        </button>
        <button className="icon-btn" title="拡大" aria-label="タイムラインを拡大" onClick={() => editorState().setPxPerSec(pps * 1.4)}>
          ＋
        </button>
      </div>
      <div className="timeline-body">
        <div className="layer-heads" style={{ paddingTop: RULER_H, width: HEAD_W }}>
          <div ref={headsRef} style={{ height: layers * ROW_H }}>
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
            if (headsRef.current) headsRef.current.style.transform = `translateY(${-e.currentTarget.scrollTop}px)`;
          }}
          onWheel={(e) => {
            if (e.ctrlKey || e.metaKey) {
              e.preventDefault();
              editorState().setPxPerSec(pps * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
            }
          }}
        >
          <div className="timeline-content" style={{ width: contentW, height: RULER_H + layers * ROW_H }}>
            <Ruler pps={pps} width={contentW} fps={project.fps} onPointerDown={onScrubHandleDown} />
            <div className="tracks" style={{ top: RULER_H, height: layers * ROW_H }} onPointerDown={onTracksPointerDown}>
              {Array.from({ length: layers }, (_, i) => (
                <div key={i} className="track-row" style={{ top: i * ROW_H, height: ROW_H }} />
              ))}
              <Items project={project} pps={pps} selectedId={selectedId} onPointerDown={onItemPointerDown} />
            </div>
            <Playhead pps={pps} onPointerDown={onScrubHandleDown} />
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
      {project.items.map((item) => (
        <div
          key={item.id}
          className={`tl-item kind-${item.kind} ${item.id === selectedId ? 'selected' : ''}`}
          style={{
            left: item.start * pps,
            width: Math.max(2, item.duration * pps),
            top: item.layer * ROW_H + 3,
            height: ROW_H - 6,
          }}
          title={`${KIND_LABEL[item.kind]}: ${itemLabel(project, item)}`}
          onPointerDown={(e) => onPointerDown(e, item, 'move')}
        >
          <span className="tl-handle left" onPointerDown={(e) => onPointerDown(e, item, 'left')} />
          <span className="tl-label">
            {KIND_ICON[item.kind]} {itemLabel(project, item)}
          </span>
          <span className="tl-handle right" onPointerDown={(e) => onPointerDown(e, item, 'right')} />
        </div>
      ))}
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
      <PlayheadKnob pps={pps} />
    </div>
  );
}

/** 再生位置の赤い線。線そのものをドラッグして動かせる */
function Playhead({ pps, onPointerDown }: { pps: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const t = useEditor((s) => s.currentTime);
  return (
    <div className="playhead" style={{ transform: `translateX(${t * pps}px)` }}>
      <div className="playhead-grip" onPointerDown={onPointerDown} title="ドラッグで再生位置を移動" />
    </div>
  );
}

/** 目盛りの上の赤いつまみ。目盛りと一緒に上に固定されるので、縦にスクロールしても見える */
function PlayheadKnob({ pps }: { pps: number }) {
  const t = useEditor((s) => s.currentTime);
  return <div className="playhead-knob" style={{ transform: `translateX(${t * pps}px)` }} title="ドラッグで再生位置を移動" />;
}
