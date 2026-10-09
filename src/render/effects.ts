// 映像エフェクトの計算と、プレビューで位置を合わせるときの吸着計算（どちらも描画に依存しない純粋関数）。
import type { Project, SlideDirection, TextStyle, TimelineItem, VisualEffects } from '../types';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const easeOutCubic = (p: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, p)), 3);

/** テキストの外枠（折り返し済みの各行の幅から計算する） */
export function textBox(style: TextStyle, lineWidths: number[]): Box {
  const n = Math.max(1, lineWidths.length);
  const lineHeight = style.fontSize * 1.25;
  const w = Math.max(0, ...lineWidths) + style.strokeWidth * 2;
  const h = style.fontSize + (n - 1) * lineHeight + style.strokeWidth;
  return { x: style.x - w / 2, y: style.y - h + style.strokeWidth / 2, w, h };
}

/** 画像・動画の外枠 */
export function placedBox(p: { x: number; y: number; scale: number }, width: number, height: number): Box {
  const w = width * p.scale;
  const h = height * p.scale;
  return { x: p.x - w / 2, y: p.y - h / 2, w, h };
}

export interface EffectState {
  /** 不透明度に掛ける値 */
  alpha: number;
  /** 位置のずれ（スライドイン） */
  dx: number;
  dy: number;
  /** 外枠の中心を基準にした拡大率（拡大縮小入場） */
  zoom: number;
}

/** アイテム内の時刻 local での、フェード・スライド・拡大縮小の状態 */
export function effectState(fx: VisualEffects | undefined, local: number, duration: number, box: Box, project: Pick<Project, 'width' | 'height'>): EffectState {
  const state: EffectState = { alpha: 1, dx: 0, dy: 0, zoom: 1 };
  if (!fx) return state;
  if (fx.fadeIn && fx.fadeIn > 0) state.alpha *= Math.min(1, Math.max(0, local / fx.fadeIn));
  if (fx.fadeOut && fx.fadeOut > 0) state.alpha *= Math.min(1, Math.max(0, (duration - local) / fx.fadeOut));
  if (fx.slideIn && fx.slideIn.duration > 0) {
    const rest = 1 - easeOutCubic(local / fx.slideIn.duration);
    const off = slideOffset(fx.slideIn.direction, box, project);
    state.dx = off.dx * rest;
    state.dy = off.dy * rest;
  }
  if (fx.zoomIn && fx.zoomIn.duration > 0) {
    const p = easeOutCubic(local / fx.zoomIn.duration);
    state.zoom = fx.zoomIn.from + (1 - fx.zoomIn.from) * p;
  }
  return state;
}

/** 外枠が画面の外にちょうど隠れる位置までのずれ */
export function slideOffset(direction: SlideDirection, box: Box, project: Pick<Project, 'width' | 'height'>) {
  switch (direction) {
    case 'left':
      return { dx: -(box.x + box.w), dy: 0 };
    case 'right':
      return { dx: project.width - box.x, dy: 0 };
    case 'top':
      return { dx: 0, dy: -(box.y + box.h) };
    case 'bottom':
      return { dx: 0, dy: project.height - box.y };
  }
}

export function hasLayerEffect(fx: VisualEffects | undefined): boolean {
  return !!fx && ((fx.blur ?? 0) > 0 || (fx.mosaic ?? 0) > 0);
}

export function hasAnyEffect(item: TimelineItem): boolean {
  const fx = 'effects' in item ? item.effects : undefined;
  const afx = 'audioEffects' in item ? item.audioEffects : undefined;
  const visual = !!fx && (hasLayerEffect(fx) || !!fx.fadeIn || !!fx.fadeOut || !!fx.slideIn || !!fx.zoomIn);
  const audio = !!afx && (!!afx.bass || !!afx.beep || !!afx.noise || !!afx.fadeIn || !!afx.fadeOut);
  return visual || audio;
}

// ---------------- 吸着（スナップ） ----------------

export interface SnapResult {
  dx: number;
  dy: number;
  /** 吸着した縦線のX座標・横線のY座標（ガイド表示用） */
  guidesX: number[];
  guidesY: number[];
}

/** 吸着先の線：画面の端・中央・余白（5%）と、ほかのアイテムの端・中央 */
export function snapLines(project: Pick<Project, 'width' | 'height'>, others: Box[]): { xs: number[]; ys: number[] } {
  const { width: W, height: H } = project;
  const xs = [0, W * 0.05, W / 2, W * 0.95, W];
  const ys = [0, H * 0.05, H / 2, H * 0.95, H];
  for (const b of others) {
    xs.push(b.x, b.x + b.w / 2, b.x + b.w);
    ys.push(b.y, b.y + b.h / 2, b.y + b.h);
  }
  return { xs, ys };
}

function snapAxis(edges: number[], lines: number[], threshold: number): { delta: number; line: number | null } {
  let best = { delta: 0, line: null as number | null, dist: threshold };
  for (const e of edges) {
    for (const l of lines) {
      const dist = Math.abs(l - e);
      if (dist < best.dist) best = { delta: l - e, line: l, dist };
    }
  }
  return { delta: best.delta, line: best.line };
}

/** 外枠の左端・中央・右端（上端・中央・下端）が近くの線に重なるように、移動量を補正する */
export function snapBox(box: Box, lines: { xs: number[]; ys: number[] }, threshold: number): SnapResult {
  const sx = snapAxis([box.x, box.x + box.w / 2, box.x + box.w], lines.xs, threshold);
  const sy = snapAxis([box.y, box.y + box.h / 2, box.y + box.h], lines.ys, threshold);
  return {
    dx: sx.delta,
    dy: sy.delta,
    guidesX: sx.line === null ? [] : [sx.line],
    guidesY: sy.line === null ? [] : [sy.line],
  };
}
