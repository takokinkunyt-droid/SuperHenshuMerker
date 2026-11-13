import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { editorState, useEditor } from '../state/store';
import type { LayerState, Project, TimelineItem } from '../types';
import { MIN_ITEM_DURATION, MIN_LAYERS } from '../state/defaults';
import { formatTime, itemEnd, nearestLayerShift, overlaps, projectDuration, rulerStep, trimStart } from '../state/timeline';
import { playback } from '../media/playback';
import { addTextItem, copyItems, deleteItems, duplicateItems, insertLayer, pasteItem, removeLayer, setLayerState, splitAtPlayhead, swapLayers } from '../state/actions';
import { AddButtons } from './MediaPanel';
import { hasAnyEffect } from '../render/effects';
import { clientId, useCollab, type Participant } from '../collab/client';

const ROW_H = 40;
const RULER_H = 28;
/** レイヤーの見出しの幅（スマホは狭くする） */
const headWidth = () => (typeof window !== 'undefined' && window.innerWidth < 760 ? 70 : 96);
const SNAP_PX = 8;
/** 長押しと判定するまでの時間 */
const LONG_PRESS_MS = 300;
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
  if (item.kind === 'audio' && item.tts) return item.tts.text;
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
  end: (e: PointerEvent) => void;
  /** ドラッグ中に上下の端でも自動スクロールする */
  vertical?: boolean;
  /** タッチで、長押しにならずに指を離したとき */
  tap?: (e: PointerEvent) => void;
}

interface MenuItem {
  label: string;
  run: () => void;
  disabled?: boolean;
  danger?: boolean;
}

interface MenuState {
  x: number;
  y: number;
  items: MenuItem[];
}

/** ドラッグ中に出す案内（吸着した位置の線と、時間の表示） */
interface DragHint {
  guide: number | null;
  label: string;
  x: number;
  y: number;
}

export function Timeline() {
  const project = useEditor((s) => s.project);
  const pps = useEditor((s) => s.pxPerSec);
  const selectedIds = useEditor((s) => s.selectedIds);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const canPaste = useEditor((s) => !!s.clipboard);
  // 共同作業で、ほかの人が選んでいるアイテム
  const users = useCollab((s) => s.users);
  const others = useMemo(() => {
    const m = new Map<string, Participant>();
    for (const u of users) if (u.id !== clientId && u.selected) m.set(u.selected, u);
    return m;
  }, [users]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headsRef = useRef<HTMLDivElement>(null);
  /** ドラッグ中はタッチによるスクロールを止める */
  const lockScroll = useRef(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [hint, setHint] = useState<DragHint | null>(null);
  /** 範囲選択の四角（タイムラインの中の座標） */
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [headW, setHeadW] = useState(headWidth);
  useEffect(() => {
    const onResize = () => setHeadW(headWidth());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const maxLayer = project.items.reduce((m, it) => Math.max(m, it.layer), 0);
  const layers = Math.max(MIN_LAYERS, maxLayer + 3);
  const duration = projectDuration(project);
  /** 右端までスクロールした位置（秒）。ここより先にも余白を足して、タイムラインをどこまでも伸ばせるようにする */
  const [scrolledEnd, setScrolledEnd] = useState(0);
  const contentEnd = Math.max(60, duration + 60, scrolledEnd + 60);
  const contentW = contentEnd * pps;

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

  // Ctrl＋ホイールで、マウスの位置を中心に拡大縮小する（passive では止められないので自分で登録する）
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = editorState();
      const x = e.clientX - el.getBoundingClientRect().left;
      const t = (x + el.scrollLeft) / s.pxPerSec;
      s.setPxPerSec(s.pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15));
      const next = editorState().pxPerSec;
      requestAnimationFrame(() => (el.scrollLeft = Math.max(0, t * next - x)));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  /** 画面上の位置を、タイムラインの中の位置（スクロール込み）に直す */
  const contentPos = (clientX: number, clientY: number) => {
    const el = scrollRef.current!;
    const rect = el.getBoundingClientRect();
    return { x: clientX - rect.left + el.scrollLeft, y: clientY - rect.top + el.scrollTop - RULER_H };
  };
  const timeAt = (clientX: number) => Math.max(0, contentPos(clientX, 0).x / editorState().pxPerSec);

  /** ボタンで拡大縮小するときは、再生位置（見えていなければ画面の中央）を中心にする */
  const zoomBy = (k: number) => {
    const el = scrollRef.current;
    const s = editorState();
    if (!el) return s.setPxPerSec(s.pxPerSec * k);
    const px = s.currentTime * s.pxPerSec - el.scrollLeft;
    const x = px >= 0 && px <= el.clientWidth ? px : el.clientWidth / 2;
    const t = (x + el.scrollLeft) / s.pxPerSec;
    s.setPxPerSec(s.pxPerSec * k);
    const next = editorState().pxPerSec;
    requestAnimationFrame(() => (el.scrollLeft = Math.max(0, t * next - x)));
  };

  /**
   * 押す操作の共通処理。マウスや immediate 指定のときはすぐ開始し、
   * タッチは長押し（LONG_PRESS_MS）が成立してから開始する。それまでに指が動けば普通のスクロールに任せる。
   * ドラッグ中に端へ近づくと、指を止めていても自動でスクロールし続ける。
   */
  const press = (e: React.PointerEvent, h: PressHandlers, immediate = e.pointerType === 'mouse') => {
    if (e.button !== 0) return;
    const pointerId = e.pointerId;
    const x0 = e.clientX;
    const y0 = e.clientY;
    let started = false;
    let last = e.nativeEvent;
    let timer = 0;
    let raf = 0;

    const edgeScroll = () => {
      raf = requestAnimationFrame(edgeScroll);
      const el = scrollRef.current;
      if (!el || !started) return;
      const rect = el.getBoundingClientRect();
      const speed = (d: number) => Math.ceil(Math.min(24, (40 - d) * 0.6));
      let moved = false;
      if (last.clientX < rect.left + 40 && el.scrollLeft > 0) {
        el.scrollLeft -= speed(last.clientX - rect.left);
        moved = true;
      } else if (last.clientX > rect.right - 40) {
        el.scrollLeft += speed(rect.right - last.clientX);
        moved = true;
      }
      if (h.vertical) {
        if (last.clientY < rect.top + RULER_H + 16 && el.scrollTop > 0) {
          el.scrollTop -= 6;
          moved = true;
        } else if (last.clientY > rect.bottom - 16 && el.scrollTop < el.scrollHeight - el.clientHeight) {
          el.scrollTop += 6;
          moved = true;
        }
      }
      if (moved) h.move(last);
    };
    const begin = () => {
      started = true;
      lockScroll.current = true;
      if (e.pointerType !== 'mouse') navigator.vibrate?.(15);
      h.start(last);
      raf = requestAnimationFrame(edgeScroll);
    };
    const cleanup = () => {
      clearTimeout(timer);
      cancelAnimationFrame(raf);
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
      if (started) h.end(ev);
      else h.tap?.(ev);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      cleanup();
      if (started) h.end(ev);
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
    move: (ev) => editorState().setTime(timeAt(ev.clientX)),
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

  /**
   * 何も無いところ。
   * マウス：クリックで再生位置を移動、ドラッグで範囲選択（Shift・Ctrl で選択に足す）。
   * タッチ：タップで再生位置を移動、長押しからのドラッグで再生位置を動かす。
   */
  const onTracksPointerDown = (e: React.PointerEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.pointerType !== 'mouse') return press(e, scrubHandlers);
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    const base = add ? editorState().selectedIds : [];
    const p0 = contentPos(e.clientX, e.clientY);
    let dragged = false;
    press(e, {
      vertical: true,
      start: () => undefined,
      move: (ev) => {
        const p = contentPos(ev.clientX, ev.clientY);
        if (!dragged && Math.hypot(p.x - p0.x, p.y - p0.y) < 5) return;
        dragged = true;
        const box = { x: Math.min(p0.x, p.x), y: Math.min(p0.y, p.y), w: Math.abs(p.x - p0.x), h: Math.abs(p.y - p0.y) };
        setMarquee(box);
        const s = editorState();
        const k = s.pxPerSec;
        const hit = s.project.items
          .filter((it) => !s.project.layers?.[it.layer]?.locked)
          .filter((it) => it.start * k < box.x + box.w && itemEnd(it) * k > box.x && it.layer * ROW_H < box.y + box.h && (it.layer + 1) * ROW_H > box.y)
          .map((it) => it.id);
        s.setSelection([...new Set([...base, ...hit])]);
      },
      end: (ev) => {
        setMarquee(null);
        if (dragged) return;
        if (!add) editorState().selectItem(null);
        playback.seek(timeAt(ev.clientX));
      },
    });
  };

  // ---------- アイテムの移動・伸縮 ----------

  /** 吸着：近くに吸着点があればそこ、無ければフレームの区切りに合わせる */
  const snap = (t: number, snaps: number[], disable: boolean): { t: number; hit: number | null } => {
    const s = editorState();
    const fps = s.project.fps;
    if (disable) return { t, hit: null };
    const threshold = SNAP_PX / s.pxPerSec;
    let best: number | null = null;
    let bestDist = threshold;
    for (const sn of snaps) {
      const dist = Math.abs(sn - t);
      if (dist < bestDist) {
        best = sn;
        bestDist = dist;
      }
    }
    return best === null ? { t: Math.round(t * fps) / fps, hit: null } : { t: best, hit: best };
  };

  const isLocked = (layer: number) => !!editorState().project.layers?.[layer]?.locked;

  const onItemPointerDown = (e: React.PointerEvent, item: TimelineItem, mode: DragMode) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const add = e.shiftKey || e.ctrlKey || e.metaKey;
    // 端のつまみはすぐ伸縮できる。本体はマウスならすぐ。
    // タッチは、選択済みのアイテムならすぐ動かせ、未選択のものは長押しで動かす（すぐ動かすとスクロール）
    const isTouch = e.pointerType !== 'mouse';
    const wasSelected = editorState().selectedIds.includes(item.id);
    const immediate = !isTouch || mode !== 'move' || wasSelected;
    let p0 = { x: 0, y: 0 };
    let moved = false;
    let snaps: number[] = [];
    /** まとめて動かすアイテムの、動かす前の状態 */
    let group: TimelineItem[] = [];
    press(
      e,
      {
        vertical: mode === 'move',
        start: (ev) => {
          const s = editorState();
          if (add && mode === 'move') s.toggleSelect(item.id);
          else if (!s.selectedIds.includes(item.id)) s.selectItem(item.id);
          else s.setSelection(s.selectedIds, item.id);
          const now = editorState();
          const ids = new Set(mode === 'move' && now.selectedIds.includes(item.id) ? now.selectedIds : [item.id]);
          group = now.project.items.filter((it) => ids.has(it.id));
          p0 = contentPos(ev.clientX, ev.clientY);
          snaps = [now.currentTime, 0];
          for (const it of now.project.items) if (!ids.has(it.id)) snaps.push(it.start, itemEnd(it));
          now.beginGesture();
        },
        move: (ev) => {
          const p = contentPos(ev.clientX, ev.clientY);
          if (!moved && Math.hypot(p.x - p0.x, p.y - p0.y) < 4) return;
          moved = true;
          applyDrag(item, group, mode, p.x - p0.x, p.y - p0.y, snaps, ev.altKey, ev);
        },
        end: () => {
          setHint(null);
          editorState().endGesture();
          const s = editorState();
          // 動かさずに離したとき：複数選択の中の1つをクリックしたら、それだけを選ぶ
          if (!moved && !add && mode === 'move' && s.selectedIds.length > 1) s.selectItem(item.id);
          // 選択済みのアイテムを動かさずにタップしたら、編集パネルを開く（スマホ）
          if (isTouch && wasSelected && mode === 'move' && !moved) s.setSheet('edit');
        },
        tap: () => {
          const s = editorState();
          // スマホで選択済みのアイテムをもう一度タップしたら、編集パネルを開く
          if (s.selectedItemId === item.id) s.setSheet('edit');
          else s.selectItem(item.id);
        },
      },
      immediate,
    );
  };

  const applyDrag = (it: TimelineItem, group: TimelineItem[], mode: DragMode, dx: number, dy: number, snaps: number[], noSnap: boolean, ev: PointerEvent) => {
    const s = editorState();
    const dt = dx / s.pxPerSec;
    const fps = s.project.fps;
    const show = (guide: number | null, label: string) => setHint({ guide, label, x: ev.clientX, y: ev.clientY });
    if (mode === 'move') {
      // つかんでいるアイテムの開始・終了のどちらかが吸着点に近ければ合わせる。まとまりは同じだけ動かす
      const first = Math.min(...group.map((g) => g.start));
      let start = Math.max(it.start - first, it.start + dt);
      const a = snap(start, snaps, noSnap);
      const b = snap(start + it.duration, snaps, noSnap);
      let guide: number | null = null;
      if (a.hit !== null) {
        start = a.t;
        guide = a.hit;
      } else if (b.hit !== null) {
        start = b.t - it.duration;
        guide = b.hit;
      } else start = a.t;
      const shiftT = Math.max(-first, start - it.start);
      const top = Math.min(...group.map((g) => g.layer));
      const want = Math.max(-top, Math.round(dy / ROW_H));
      const moving = group.map((g) => ({ ...g, start: g.start + shiftT }) as TimelineItem);
      // 置きたいレイヤーがふさがっていたら、一番近い空いているレイヤーに置く
      const shiftL = nearestLayerShift(s.project.items, moving, want, isLocked);
      if (shiftL === null) return;
      const next = new Map(moving.map((m) => [m.id, { start: m.start, layer: m.layer + shiftL }]));
      s.editTransient((p) => {
        for (const target of p.items) {
          const n = next.get(target.id);
          if (n) Object.assign(target, n);
        }
      });
      show(guide, `${formatTime(it.start + shiftT, fps)}　L${it.layer + shiftL}`);
    } else if (mode === 'right') {
      const e = snap(itemEnd(it) + dt, snaps, noSnap);
      const duration = Math.min(maxDuration(s.project, it), Math.max(MIN_ITEM_DURATION, e.t - it.start));
      if (overlaps(s.project.items, it.layer, it.start, it.start + duration, it.id)) return;
      s.editTransient((p) => {
        const target = p.items.find((x) => x.id === it.id);
        if (target) target.duration = duration;
      });
      show(e.hit, `長さ ${formatTime(duration, fps)}`);
    } else {
      const st = snap(it.start + dt, snaps, noSnap);
      const patch = trimStart(it, st.t);
      if (overlaps(s.project.items, it.layer, patch.start!, itemEnd(it), it.id)) return;
      s.editTransient((p) => {
        const target = p.items.find((x) => x.id === it.id);
        if (target) Object.assign(target, patch);
      });
      show(st.hit, `長さ ${formatTime(patch.duration!, fps)}`);
    }
  };

  // ---------- 右クリックメニュー ----------

  const openMenu = (e: React.MouseEvent, items: MenuItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const itemMenu = (e: React.MouseEvent, item: TimelineItem) => {
    const s = editorState();
    if (!s.selectedIds.includes(item.id)) s.selectItem(item.id);
    const ids = editorState().selectedIds;
    const n = ids.length > 1 ? `（${ids.length}個）` : '';
    const t = timeAt(e.clientX);
    openMenu(e, [
      { label: 'ここで分割', run: () => { playback.seek(t); splitAtPlayhead(); }, disabled: !(t > item.start && t < itemEnd(item)) },
      { label: `複製${n}`, run: () => duplicateItems(ids) },
      { label: `コピー${n}`, run: () => copyItems(ids) },
      { label: 'ここに貼り付け', run: () => pasteItem(t), disabled: !canPaste },
      { label: `削除${n}`, run: () => deleteItems(ids), danger: true },
    ]);
  };

  const tracksMenu = (e: React.MouseEvent) => {
    const t = timeAt(e.clientX);
    const layer = Math.max(0, Math.floor(contentPos(e.clientX, e.clientY).y / ROW_H));
    openMenu(e, [
      { label: 'ここに貼り付け', run: () => pasteItem(t, layer), disabled: !canPaste },
      { label: 'ここにテキストを追加', run: () => { playback.seek(t); addTextItem(); } },
      { label: 'すべて選択', run: () => editorState().setSelection(editorState().project.items.map((it) => it.id)) },
      { label: 'この上にレイヤーを入れる', run: () => insertLayer(layer) },
    ]);
  };

  const layerMenu = (e: React.MouseEvent, layer: number) => {
    const st = project.layers?.[layer];
    const count = project.items.filter((it) => it.layer === layer).length;
    openMenu(e, [
      { label: 'レイヤーに名前をつける', run: () => { const name = window.prompt('レイヤーの名前（空にすると番号に戻ります）', st?.name ?? ''); if (name !== null) setLayerState(layer, { name: name.trim().slice(0, 20) }); } },
      { label: 'このレイヤーのアイテムをすべて選択', run: () => editorState().setSelection(editorState().project.items.filter((it) => it.layer === layer).map((it) => it.id)), disabled: !count },
      { label: '上にレイヤーを入れる', run: () => insertLayer(layer) },
      { label: '下にレイヤーを入れる', run: () => insertLayer(layer + 1) },
      { label: '1つ上のレイヤーと入れ替える', run: () => swapLayers(layer, layer - 1), disabled: layer === 0 },
      { label: '1つ下のレイヤーと入れ替える', run: () => swapLayers(layer, layer + 1) },
      { label: count ? `レイヤーを削除（アイテム${count}個も削除）` : 'レイヤーを削除', run: () => removeLayer(layer), danger: true },
    ]);
  };

  return (
    <div className="timeline" onContextMenu={(e) => e.preventDefault()}>
      <div className="timeline-toolbar">
        <AddButtons compact />
        <button className="btn add-btn" onClick={addTextItem} title="再生位置にテキストを追加">
          T テキスト
        </button>
        <button className="btn add-btn" onClick={() => editorState().setTtsOpen(true)} title="合成音声（VOICEVOX）で読み上げ音声を作る">
          🗣 読み上げ
        </button>
        <span className="toolbar-sep" />
        <button className="btn small" onClick={splitAtPlayhead} title="再生位置で分割 (S)">
          ✂ 分割
        </button>
        <button className="btn small" disabled={!selectedIds.length} onClick={() => duplicateItems(selectedIds)} title="複製 (Ctrl+D)">
          ⧉ 複製
        </button>
        <button className="btn small" disabled={!selectedIds.length} onClick={() => deleteItems(selectedIds)} title="削除 (Delete)">
          🗑 削除
        </button>
        {selectedIds.length > 1 && <span className="sel-count">{selectedIds.length}個を選択中</span>}
        <span className="spacer" />
        <span className="hint">ドラッグで範囲選択・右クリックでメニュー・Ctrl+ホイールで拡大縮小</span>
        <button
          className="icon-btn"
          title="全体を表示"
          aria-label="タイムライン全体を表示"
          onClick={() => {
            const el = scrollRef.current;
            if (!el) return;
            editorState().setPxPerSec((el.clientWidth - 40) / Math.max(10, duration));
            el.scrollLeft = 0;
          }}
        >
          ↔
        </button>
        <button className="icon-btn" title="縮小" aria-label="タイムラインを縮小" onClick={() => zoomBy(1 / 1.4)}>
          −
        </button>
        <button className="icon-btn" title="拡大" aria-label="タイムラインを拡大" onClick={() => zoomBy(1.4)}>
          ＋
        </button>
      </div>
      <div className="timeline-body">
        <div className="layer-heads" style={{ paddingTop: RULER_H, width: headW }}>
          <div ref={headsRef} style={{ height: layers * ROW_H }}>
            {Array.from({ length: layers }, (_, i) => (
              <LayerHead key={i} layer={i} state={project.layers?.[i]} onMenu={(e) => layerMenu(e, i)} />
            ))}
          </div>
        </div>
        <div
          className="timeline-scroll"
          ref={scrollRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            if (headsRef.current) headsRef.current.style.transform = `translateY(${-el.scrollTop}px)`;
            // 右端に近づいたら、その先にタイムラインを伸ばす（30秒単位で更新して描き直しを減らす）
            const endSec = Math.ceil((el.scrollLeft + el.clientWidth) / pps / 30) * 30;
            if (endSec > scrolledEnd) setScrolledEnd(endSec);
          }}
        >
          <div className="timeline-content" style={{ width: contentW, height: RULER_H + layers * ROW_H }}>
            <Ruler pps={pps} fps={project.fps} scrollRef={scrollRef} onPointerDown={onScrubHandleDown} />
            <div className="tracks" style={{ top: RULER_H, height: layers * ROW_H }} onPointerDown={onTracksPointerDown} onContextMenu={tracksMenu}>
              {Array.from({ length: layers }, (_, i) => {
                const st = project.layers?.[i];
                return <div key={i} className={`track-row ${st?.hidden ? 'hidden' : ''} ${st?.locked ? 'locked' : ''}`} style={{ top: i * ROW_H, height: ROW_H }} />;
              })}
              <Items project={project} pps={pps} selected={selected} others={others} onPointerDown={onItemPointerDown} onMenu={itemMenu} />
              {marquee && <div className="tl-marquee" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />}
              {hint?.guide != null && <div className="tl-guide" style={{ left: hint.guide * pps }} />}
            </div>
            <Playhead pps={pps} onPointerDown={onScrubHandleDown} />
          </div>
        </div>
      </div>
      {hint && (
        <div className="tl-drag-label" style={{ left: hint.x + 14, top: hint.y - 34 }}>
          {hint.label}
        </div>
      )}
      {menu && <ContextMenu menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}

/** レイヤーの見出し：名前（番号）、表示・非表示、ロック。右クリックや「⋯」でメニュー */
function LayerHead({ layer, state, onMenu }: { layer: number; state: LayerState | undefined; onMenu: (e: React.MouseEvent) => void }) {
  return (
    <div className={`layer-head ${state?.hidden ? 'hidden' : ''} ${state?.locked ? 'locked' : ''}`} style={{ height: ROW_H }} onContextMenu={onMenu}>
      <button className="layer-name" title="レイヤーのメニュー" onClick={onMenu}>
        {state?.name || layer}
      </button>
      <button
        className={`layer-btn ${state?.hidden ? 'on' : ''}`}
        title={state?.hidden ? '表示する' : '非表示にする（音も消えます）'}
        aria-label={`レイヤー${layer}を${state?.hidden ? '表示' : '非表示に'}する`}
        aria-pressed={!!state?.hidden}
        onClick={() => setLayerState(layer, { hidden: !state?.hidden })}
      >
        {state?.hidden ? '🚫' : '👁'}
      </button>
      <button
        className={`layer-btn ${state?.locked ? 'on' : ''}`}
        title={state?.locked ? 'ロックを外す' : 'ロックする（動かせなくなります）'}
        aria-label={`レイヤー${layer}を${state?.locked ? 'ロック解除' : 'ロック'}する`}
        aria-pressed={!!state?.locked}
        onClick={() => setLayerState(layer, { locked: !state?.locked })}
      >
        {state?.locked ? '🔒' : '🔓'}
      </button>
    </div>
  );
}

function ContextMenu({ menu, onClose }: { menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: menu.x, y: menu.y });
  // 画面からはみ出さない位置に出す
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ x: Math.max(4, Math.min(menu.x, window.innerWidth - r.width - 4)), y: Math.max(4, Math.min(menu.y, window.innerHeight - r.height - 4)) });
  }, [menu]);
  useEffect(() => {
    const close = (e: Event) => {
      if (e.type === 'keydown' && (e as KeyboardEvent).key !== 'Escape') return;
      if (e.type === 'pointerdown' && ref.current?.contains(e.target as Node)) return;
      onClose();
    };
    window.addEventListener('pointerdown', close, true);
    window.addEventListener('keydown', close);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', close, true);
      window.removeEventListener('keydown', close);
      window.removeEventListener('blur', close);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="ctx-menu" role="menu" style={{ left: pos.x, top: pos.y }}>
      {menu.items.map((it) => (
        <button
          key={it.label}
          role="menuitem"
          className={it.danger ? 'danger' : ''}
          disabled={it.disabled}
          onClick={() => {
            onClose();
            it.run();
          }}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

const Items = memo(function Items({
  project,
  pps,
  selected,
  others,
  onPointerDown,
  onMenu,
}: {
  project: Project;
  pps: number;
  selected: Set<string>;
  others: Map<string, Participant>;
  onPointerDown: (e: React.PointerEvent, item: TimelineItem, mode: DragMode) => void;
  onMenu: (e: React.MouseEvent, item: TimelineItem) => void;
}) {
  return (
    <>
      {project.items.map((item) => (
        <div
          key={item.id}
          className={`tl-item kind-${item.kind} ${selected.has(item.id) ? 'selected' : ''} ${project.layers?.[item.layer]?.hidden ? 'dim' : ''} ${project.layers?.[item.layer]?.locked ? 'locked' : ''}`}
          style={{
            left: item.start * pps,
            width: Math.max(2, item.duration * pps),
            top: item.layer * ROW_H + 3,
            height: ROW_H - 6,
            ...(others.has(item.id) ? { boxShadow: `0 0 0 2px ${others.get(item.id)!.color}` } : {}),
          }}
          title={`${KIND_LABEL[item.kind]}: ${itemLabel(project, item)}`}
          onPointerDown={(e) => onPointerDown(e, item, 'move')}
          onContextMenu={(e) => onMenu(e, item)}
        >
          <span className="tl-handle left" onPointerDown={(e) => onPointerDown(e, item, 'left')} />
          <span className="tl-label">
            {item.kind === 'audio' && item.tts ? '🗣' : KIND_ICON[item.kind]} {itemLabel(project, item)}
          </span>
          {others.has(item.id) && (
            <span className="tl-who" style={{ background: others.get(item.id)!.color }}>
              {others.get(item.id)!.name}
            </span>
          )}
          {hasAnyEffect(item) && (
            <span className="tl-fx" title="エフェクトあり">
              ✨
            </span>
          )}
          <span className="tl-handle right" onPointerDown={(e) => onPointerDown(e, item, 'right')} />
        </div>
      ))}
    </>
  );
});

function Ruler({
  pps,
  fps,
  scrollRef,
  onPointerDown,
}: {
  pps: number;
  fps: number;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  onPointerDown: (e: React.PointerEvent) => void;
}) {
  // 長い動画でも重くならないよう、目盛りは見えている範囲だけ描く
  const [view, setView] = useState({ left: 0, width: 2000 });
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      setView((v) => (v.left === el.scrollLeft && v.width === el.clientWidth ? v : { left: el.scrollLeft, width: el.clientWidth }));
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    update();
    el.addEventListener('scroll', schedule, { passive: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', schedule);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [scrollRef]);

  const step = rulerStep(pps);
  const from = Math.max(0, Math.floor((view.left - 200) / pps / step)) * step;
  const to = (view.left + view.width + 200) / pps;
  const ticks = [];
  for (let i = Math.round(from / step); i * step <= to; i++) {
    const t = i * step;
    ticks.push(
      <div key={i} className="tick" style={{ left: t * pps }}>
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
