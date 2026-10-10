// プレビューの上に重ねる操作レイヤー。オブジェクトをタップで選び、ドラッグで移動、
// 角のつまみで拡大縮小、丸いつまみで回転、2本指でピンチ（拡大縮小＋回転）、テキストはその場で編集できる。
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { editorState, useEditor } from '../state/store';
import type { Project, TextItem, TimelineItem } from '../types';
import { itemBaseBox, visibleItems } from '../render/renderer';
import { snapBox, snapLines, type Box } from '../render/effects';
import { angleOf, center, hitBox, itemRotation, scaleTextStyle, snapAngle, type Point } from '../render/transform';
import { isActiveAt } from '../state/timeline';
import { updateItem } from '../state/actions';

/** この距離（画面上のピクセル）まで近づいたら吸着する */
const SNAP_SCREEN_PX = 10;
/** ダブルタップとみなす間隔 */
const DOUBLE_TAP_MS = 350;
/** これ以上動いたらタップではなくドラッグ */
const TAP_SLOP_PX = 6;

type Gesture =
  | { type: 'move'; item: TimelineItem; p0: Point; box: Box | null; lines: { xs: number[]; ys: number[] }; threshold: number; moved: boolean; client0: Point }
  | { type: 'scale'; item: TimelineItem; box: Box; d0: number }
  | { type: 'rotate'; item: TimelineItem; box: Box; a0: number }
  | { type: 'pinch'; item: TimelineItem; box: Box; d0: number; a0: number; mid0: Point };

interface Transform {
  dx: number;
  dy: number;
  k: number;
  rotation: number | null;
}

/** 操作を始めたときの状態 base に、移動・拡大縮小・回転をかけたものを書き込む */
function applyTransform(base: TimelineItem, box: Box | null, t: Transform) {
  editorState().editTransient((d) => {
    const it = d.items.find((x) => x.id === base.id);
    if (!it) return;
    if (it.kind === 'image' || it.kind === 'video') {
      const b = base as typeof it;
      it.x = Math.round(b.x + t.dx);
      it.y = Math.round(b.y + t.dy);
      it.scale = Math.max(0.01, Math.round(b.scale * t.k * 1000) / 1000);
      if (t.rotation !== null) it.rotation = t.rotation;
    } else if (it.kind === 'text') {
      const b = base as TextItem;
      const style = box && t.k !== 1 ? scaleTextStyle(b.style, box, t.k) : { ...b.style };
      style.x = Math.round(style.x + t.dx);
      style.y = Math.round(style.y + t.dy);
      it.style = style;
      if (t.rotation !== null) it.rotation = t.rotation;
    }
  });
}

/** その位置にある一番手前のアイテム */
function hitTest(project: Project, t: number, p: Point, pad: number): TimelineItem | null {
  const items = visibleItems(project, t);
  for (let i = items.length - 1; i >= 0; i--) {
    const box = itemBaseBox(items[i], project);
    if (box && hitBox(box, itemRotation(items[i]), p, pad)) return items[i];
  }
  return null;
}

export function PreviewInteraction({ frameRef }: { frameRef: React.RefObject<HTMLDivElement | null> }) {
  const project = useEditor((s) => s.project);
  const currentTime = useEditor((s) => s.currentTime);
  const selected = useEditor((s) => s.project.items.find((it) => it.id === s.selectedItemId));
  const editingId = useEditor((s) => s.editingTextId);
  // フォントの読み込みが終わると文字の外枠の大きさが変わるので、描き直す
  useEditor((s) => s.mediaVersion);
  const [guides, setGuides] = useState<{ xs: number[]; ys: number[] }>({ xs: [], ys: [] });
  const [frameWidth, setFrameWidth] = useState(0);
  const gesture = useRef<Gesture | null>(null);
  const interactRef = useRef<HTMLDivElement>(null);
  /** 開いているテキスト編集欄の内容を確定して閉じる */
  const commitEditor = useRef<(() => void) | null>(null);
  const pointers = useRef(new Map<number, Point>());
  const lastTap = useRef<{ id: string; at: number } | null>(null);

  // 画面上の大きさ（テキスト編集欄の文字サイズや、つまみの当たり判定に使う）
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameWidth(el.clientWidth));
    ro.observe(el);
    setFrameWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [frameRef]);

  const pxToProject = frameWidth ? project.width / frameWidth : 1;
  const toProject = (e: { clientX: number; clientY: number }): Point => {
    const rect = frameRef.current!.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * project.width, y: ((e.clientY - rect.top) / rect.height) * project.height };
  };

  const visible = selected && selected.kind !== 'audio' && isActiveAt(selected, currentTime);
  const box = visible ? itemBaseBox(selected, project) : null;
  const rotation = selected ? itemRotation(selected) : 0;

  const finish = () => {
    if (gesture.current) editorState().endGesture();
    gesture.current = null;
    setGuides({ xs: [], ys: [] });
  };

  // 2本目の指が置かれたら、ピンチ（拡大縮小＋回転）に切り替える
  const startPinch = () => {
    const g = gesture.current;
    const pts = [...pointers.current.values()];
    if (!g || pts.length < 2) return;
    const item = editorState().project.items.find((it) => it.id === g.item.id);
    const b = item ? itemBaseBox(item, editorState().project) : null;
    if (!item || !b) return;
    gesture.current = {
      type: 'pinch',
      item: structuredClone(item),
      box: b,
      d0: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
      a0: angleOf(pts[1], pts[0]),
      mid0: { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 },
    };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    // 文字の編集中に編集欄の外を触ったら、入力を確定して閉じ、そのまま普通の操作として続ける
    // （iPhoneは編集欄の外をタップしても入力欄が閉じないため、ここで閉じる）
    if (editorState().editingTextId) commitEditor.current?.();
    beginAt(e.pointerId, e);
  };

  /** 指（マウス）が置かれた位置で、選択・移動・ピンチを始める */
  const beginAt = (pointerId: number, e: { clientX: number; clientY: number }) => {
    interactRef.current?.setPointerCapture(pointerId);
    const p = toProject(e);
    pointers.current.set(pointerId, p);
    if (pointers.current.size === 2) {
      startPinch();
      return;
    }
    const s = editorState();
    // 一番手前のアイテムを選ぶ。何も無いところでも、選択中のアイテムの枠の近くならそれをつかむ
    const cur = s.project.items.find((it) => it.id === s.selectedItemId);
    const curBox = cur && cur.kind !== 'audio' && isActiveAt(cur, s.currentTime) ? itemBaseBox(cur, s.project) : null;
    const hit = hitTest(s.project, s.currentTime, p, 4 * pxToProject) ?? (cur && curBox && hitBox(curBox, itemRotation(cur), p, 12 * pxToProject) ? cur : null);
    if (!hit) {
      s.selectItem(null);
      return;
    }
    s.selectItem(hit.id);
    const others = s.project.items
      .filter((it) => it.id !== hit.id && it.kind !== 'audio' && isActiveAt(it, s.currentTime))
      .map((it) => itemBaseBox(it, s.project))
      .filter((b): b is Box => !!b);
    s.beginGesture();
    gesture.current = {
      type: 'move',
      item: structuredClone(hit),
      p0: p,
      box: itemBaseBox(hit, s.project),
      lines: snapLines(s.project, others),
      threshold: SNAP_SCREEN_PX * pxToProject,
      moved: false,
      client0: { x: e.clientX, y: e.clientY },
    };
  };

  const onHandleDown = (e: React.PointerEvent, type: 'scale' | 'rotate') => {
    e.stopPropagation();
    if (!selected || !box) return;
    frameRef.current?.querySelector<HTMLElement>('.preview-interact')?.setPointerCapture(e.pointerId);
    const p = toProject(e);
    pointers.current.set(e.pointerId, p);
    const c = center(box);
    editorState().beginGesture();
    gesture.current =
      type === 'scale'
        ? { type: 'scale', item: structuredClone(selected), box, d0: Math.max(1, Math.hypot(p.x - c.x, p.y - c.y)) }
        : { type: 'rotate', item: structuredClone(selected), box, a0: angleOf(p, c) - rotation };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toProject(e);
    pointers.current.set(e.pointerId, p);
    const g = gesture.current;
    if (!g) return;
    if (g.type === 'move') {
      if (!g.moved && Math.hypot(e.clientX - g.client0.x, e.clientY - g.client0.y) < TAP_SLOP_PX) return;
      g.moved = true;
      let dx = p.x - g.p0.x;
      let dy = p.y - g.p0.y;
      // Altキーを押している間は吸着しない
      if (g.box && !e.altKey) {
        const snap = snapBox({ ...g.box, x: g.box.x + dx, y: g.box.y + dy }, g.lines, g.threshold);
        dx += snap.dx;
        dy += snap.dy;
        setGuides({ xs: snap.guidesX, ys: snap.guidesY });
      }
      applyTransform(g.item, g.box, { dx, dy, k: 1, rotation: null });
    } else if (g.type === 'scale') {
      const c = center(g.box);
      const k = Math.max(0.05, Math.hypot(p.x - c.x, p.y - c.y) / g.d0);
      applyTransform(g.item, g.box, { dx: 0, dy: 0, k, rotation: null });
    } else if (g.type === 'rotate') {
      const a = angleOf(p, center(g.box)) - g.a0;
      applyTransform(g.item, g.box, { dx: 0, dy: 0, k: 1, rotation: e.shiftKey ? Math.round(a / 15) * 15 : snapAngle(a) });
    } else if (g.type === 'pinch') {
      const pts = [...pointers.current.values()];
      if (pts.length < 2) return;
      const d = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const rot = snapAngle(itemRotation(g.item) + angleOf(pts[1], pts[0]) - g.a0);
      applyTransform(g.item, g.box, { dx: mid.x - g.mid0.x, dy: mid.y - g.mid0.y, k: Math.max(0.05, d / Math.max(1, g.d0)), rotation: rot });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (g?.type === 'pinch' && pointers.current.size > 0) return; // 指がまだ残っている
    // 動かさずに離した＝タップ。同じテキストを続けて2回タップしたら編集
    if (g?.type === 'move' && !g.moved) {
      const now = performance.now();
      if (g.item.kind === 'text' && lastTap.current?.id === g.item.id && now - lastTap.current.at < DOUBLE_TAP_MS) {
        finish();
        editorState().setEditingText(g.item.id);
        lastTap.current = null;
        return;
      }
      lastTap.current = { id: g.item.id, at: now };
    }
    pointers.current.clear();
    finish();
  };

  const pct = (b: Box) => ({
    left: `${(b.x / project.width) * 100}%`,
    top: `${(b.y / project.height) * 100}%`,
    width: `${(b.w / project.width) * 100}%`,
    height: `${(b.h / project.height) * 100}%`,
  });

  const editing = editingId ? project.items.find((it): it is TextItem => it.id === editingId && it.kind === 'text') : undefined;
  const editingBox = editing && isActiveAt(editing, currentTime) ? itemBaseBox(editing, project) : null;

  return (
    <>
      <div
        ref={interactRef}
        className="preview-interact"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={() => {
          if (selected?.kind === 'text') editorState().setEditingText(selected.id);
        }}
      />
      {box && selected && !editing && (
        <div className={`tf-box ${box.y < project.height * 0.08 ? 'rot-below' : ''}`} style={{ ...pct(box), transform: `rotate(${rotation}deg)` }}>
          {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
            <span key={corner} className={`tf-handle ${corner}`} title="ドラッグで拡大縮小" onPointerDown={(e) => onHandleDown(e, 'scale')} />
          ))}
          <span className="tf-rotate-line" />
          <span className="tf-rotate" title="ドラッグで回転（Shiftで15°ずつ）" onPointerDown={(e) => onHandleDown(e, 'rotate')}>
            ⟳
          </span>
          {selected.kind === 'text' && (
            <button className="tf-edit" title="文字を編集" onPointerDown={(e) => e.stopPropagation()} onClick={() => editorState().setEditingText(selected.id)}>
              ✏ 編集
            </button>
          )}
        </div>
      )}
      {guides.xs.map((x) => (
        <div key={`x${x}`} className="guide vertical" style={{ left: `${(x / project.width) * 100}%` }} />
      ))}
      {guides.ys.map((y) => (
        <div key={`y${y}`} className="guide horizontal" style={{ top: `${(y / project.height) * 100}%` }} />
      ))}
      {editing && editingBox && (
        <TextEditor
          item={editing}
          box={editingBox}
          pct={pct}
          scale={frameWidth / project.width}
          commitRef={commitEditor}
          // 編集欄を指でドラッグしたら、確定してそのままテキストを動かす
          onDragOut={(pointerId, e) => beginAt(pointerId, e)}
        />
      )}
    </>
  );
}

/** プレビュー上でその場で文字を書き換える欄 */
function TextEditor({
  item,
  box,
  pct,
  scale,
  commitRef,
  onDragOut,
}: {
  item: TextItem;
  box: Box;
  pct: (b: Box) => React.CSSProperties;
  scale: number;
  commitRef: React.MutableRefObject<(() => void) | null>;
  onDragOut: (pointerId: number, start: { clientX: number; clientY: number }) => void;
}) {
  const [text, setText] = useState(item.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const closed = useRef(false);
  const textRef = useRef(text);
  textRef.current = text;
  const close = (commit: boolean) => {
    if (closed.current) return;
    closed.current = true;
    const value = textRef.current;
    if (commit && value !== item.text) updateItem(item.id, { text: value || ' ' });
    editorState().setEditingText(null);
  };
  useEffect(() => {
    commitRef.current = () => close(true);
    return () => {
      commitRef.current = null;
    };
  });
  const dragStart = useRef<{ id: number; x: number; y: number } | null>(null);
  // 欄は文字の外枠より少し広めにとり、短い文字でも入力しやすくする
  const minW = Math.max(box.w, item.style.fontSize * 6);
  const editBox = { x: box.x + box.w / 2 - minW / 2, y: box.y, w: minW, h: box.h };
  const s = item.style;
  return (
    <div className="tf-editor" style={pct(editBox)}>
      <textarea
        ref={ref}
        value={text}
        aria-label="テキストを編集"
        style={{
          fontSize: `${Math.max(16, s.fontSize * scale)}px`, // 16px未満だとiPhoneで画面が拡大されてしまう
          fontFamily: s.fontFamily,
          fontWeight: s.bold ? 700 : 400,
          color: s.color,
          WebkitTextStroke: s.strokeWidth > 0 ? `${Math.max(0.5, s.strokeWidth * scale * 0.5)}px ${s.strokeColor}` : undefined,
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => close(true)}
        onPointerDown={(e) => {
          dragStart.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
        }}
        onPointerMove={(e) => {
          const t = dragStart.current;
          if (!t || t.id !== e.pointerId || Math.hypot(e.clientX - t.x, e.clientY - t.y) < 8) return;
          dragStart.current = null;
          close(true);
          onDragOut(e.pointerId, { clientX: t.x, clientY: t.y });
        }}
        onPointerUp={() => (dragStart.current = null)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') close(false);
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) close(true);
        }}
      />
      <button className="btn primary small tf-done" onPointerDown={(e) => e.preventDefault()} onClick={() => close(true)}>
        完了
      </button>
    </div>
  );
}
