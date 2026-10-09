// タイムライン操作の純粋関数群。ストアやUIから使い、単体テストもここに対して書く。
import type { Project, TimelineItem } from '../types';
import { MIN_ITEM_DURATION, uid } from './defaults';

export const itemEnd = (item: TimelineItem): number => item.start + item.duration;

export function projectDuration(project: Project): number {
  let end = 0;
  for (const item of project.items) end = Math.max(end, itemEnd(item));
  return end;
}

export const isActiveAt = (item: TimelineItem, t: number): boolean => t >= item.start && t < itemEnd(item);

/** 時刻tでアイテムを2つに分ける。tがアイテムの内側でなければnull */
export function splitItem(item: TimelineItem, t: number): [TimelineItem, TimelineItem] | null {
  const local = t - item.start;
  if (local < MIN_ITEM_DURATION || item.duration - local < MIN_ITEM_DURATION) return null;
  const first = { ...item, duration: local } as TimelineItem;
  const second = { ...item, id: uid(), start: t, duration: item.duration - local } as TimelineItem;
  if (second.kind === 'video' || second.kind === 'audio') second.sourceOffset += local;
  return [first, second];
}

/**
 * 左端を動かしたときの新しい開始位置・長さ・素材オフセットを計算する。
 * 素材の先頭より前には伸ばせない。
 */
export function trimStart(item: TimelineItem, newStart: number): Partial<TimelineItem> {
  const end = itemEnd(item);
  let start = Math.min(Math.max(0, newStart), end - MIN_ITEM_DURATION);
  let delta = start - item.start;
  if ((item.kind === 'video' || item.kind === 'audio') && item.sourceOffset + delta < 0) {
    delta = -item.sourceOffset;
    start = item.start + delta;
  }
  const patch: Partial<TimelineItem> = { start, duration: end - start };
  if (item.kind === 'video' || item.kind === 'audio') (patch as { sourceOffset: number }).sourceOffset = item.sourceOffset + delta;
  return patch;
}

export function overlaps(items: TimelineItem[], layer: number, start: number, end: number, ignoreId?: string): boolean {
  return items.some((it) => it.id !== ignoreId && it.layer === layer && it.start < end && itemEnd(it) > start);
}

/** preferredから順に、指定区間が空いているレイヤーを探す */
export function findFreeLayer(items: TimelineItem[], start: number, end: number, preferred: number): number {
  for (let layer = preferred; layer < preferred + 100; layer++) {
    if (!overlaps(items, layer, start, end)) return layer;
  }
  return preferred;
}

/**
 * 画面サイズを変えたとき、画面の中心からの位置関係を保って座標をずらす。
 * テキストの折り返し幅は新しい画面幅に収まるようにする。（project を直接書き換える）
 */
export function recenterItems(project: Project, oldWidth: number, oldHeight: number): void {
  const dx = (project.width - oldWidth) / 2;
  const dy = (project.height - oldHeight) / 2;
  for (const it of project.items) {
    if (it.kind === 'image' || it.kind === 'video') {
      it.x += dx;
      it.y += dy;
    } else if (it.kind === 'text') {
      it.style.x += dx;
      // 下寄せのテキスト（字幕など）は画面下からの距離を保つ
      it.style.y = it.style.y > oldHeight / 2 ? it.style.y + (project.height - oldHeight) : it.style.y + dy;
      it.style.maxWidth = Math.min(it.style.maxWidth, Math.round(project.width * 0.9));
    }
  }
}

/** 0.5秒刻みなど、画面上で区切りの良い目盛り間隔を選ぶ */
export function rulerStep(pxPerSec: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s * pxPerSec >= 70) ?? 600;
}

export function formatTime(sec: number, fps = 30): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  const f = Math.floor((s - Math.floor(s)) * fps + 1e-6);
  return `${m}:${String(ss).padStart(2, '0')}.${String(f).padStart(2, '0')}`;
}
