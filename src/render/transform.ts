// プレビュー上での直接操作（選択・拡大縮小・回転）のための幾何計算。描画やDOMに依存しない純粋関数。
import type { TextStyle, TimelineItem } from '../types';
import type { Box } from './effects';

export interface Point {
  x: number;
  y: number;
}

export const center = (b: Box): Point => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

export function itemRotation(item: TimelineItem): number {
  if (item.kind === 'text' || item.kind === 'image' || item.kind === 'video') return item.rotation ?? 0;
  return 0;
}

/** 点 p を c を中心に deg 度（時計回り）回す */
export function rotatePoint(p: Point, c: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - c.x;
  const dy = p.y - c.y;
  return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
}

/** 回転した外枠の中に点が入っているか（pad だけ広めに判定する） */
export function hitBox(box: Box, rotation: number, p: Point, pad = 0): boolean {
  const local = rotation ? rotatePoint(p, center(box), -rotation) : p;
  return local.x >= box.x - pad && local.x <= box.x + box.w + pad && local.y >= box.y - pad && local.y <= box.y + box.h + pad;
}

/** 中心から見た点の角度（度、右が0・時計回り） */
export const angleOf = (p: Point, c: Point) => (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;

/** 角度を -180〜180 にそろえ、0・90・180・-90 度の近く（threshold 度以内）なら吸着させる */
export function snapAngle(deg: number, threshold = 4): number {
  let a = ((((deg + 180) % 360) + 360) % 360) - 180;
  for (const target of [-180, -90, 0, 90, 180]) {
    if (Math.abs(a - target) <= threshold) a = target === -180 ? 180 : target;
  }
  return Math.round(a * 10) / 10;
}

/**
 * テキストを外枠の中心を基準に k 倍する。文字の大きさ・縁取り・折り返し幅をまとめて変え、
 * 外枠の中心がずれないように位置（下端）を動かす。
 */
export function scaleTextStyle(style: TextStyle, box: Box, k: number): TextStyle {
  const c = center(box);
  return {
    ...style,
    fontSize: Math.max(4, Math.round(style.fontSize * k * 10) / 10),
    strokeWidth: Math.round(style.strokeWidth * k * 10) / 10,
    maxWidth: Math.max(20, Math.round(style.maxWidth * k)),
    y: Math.round(c.y + (style.y - c.y) * k),
  };
}
