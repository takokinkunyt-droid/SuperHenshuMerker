// タイムライン操作の純粋関数群。ストアやUIから使い、単体テストもここに対して書く。
import type { Character, Project, TachieItem, TimelineItem, VoiceItem } from '../types';
import { LAYER, MIN_ITEM_DURATION, VOICE_GAP, uid } from './defaults';

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
  if (second.kind === 'voice') second.audioOffset += local;
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
  const offset = sourceOffsetOf(item);
  if (offset !== null && offset + delta < 0) {
    delta = -offset;
    start = item.start + delta;
  }
  const patch: Partial<TimelineItem> = { start, duration: end - start };
  if (item.kind === 'video' || item.kind === 'audio') (patch as { sourceOffset: number }).sourceOffset = item.sourceOffset + delta;
  if (item.kind === 'voice') (patch as { audioOffset: number }).audioOffset = item.audioOffset + delta;
  return patch;
}

function sourceOffsetOf(item: TimelineItem): number | null {
  if (item.kind === 'video' || item.kind === 'audio') return item.sourceOffset;
  if (item.kind === 'voice') return item.audioOffset;
  return null;
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

export function tachieLayerFor(project: Project, characterId: string): number {
  const index = project.characters.findIndex((c) => c.id === characterId);
  return Math.min(LAYER.tachieBase + Math.max(0, index), LAYER.voice - 1);
}

/** 次のセリフを置く位置：最後のセリフの直後 */
export function nextVoiceStart(project: Project): number {
  let end = 0;
  for (const item of project.items) if (item.kind === 'voice') end = Math.max(end, itemEnd(item) + VOICE_GAP);
  return end;
}

/** 音声がまだ無いセリフの仮の長さ（1文字0.15秒、最低1秒） */
export function estimateDuration(text: string): number {
  const chars = [...text.replace(/\s/g, '')].length;
  return Math.max(1, Math.round((chars * 0.15 + 0.5) * 30) / 30);
}

/**
 * キャラの立ち絵アイテムが [start, end) を覆うようにする。
 * 同じキャラの立ち絵アイテムが近くにあれば伸ばし、なければ新しく作る。（items を直接書き換える）
 */
export function ensureTachieCovers(project: Project, characterId: string, start: number, end: number): void {
  const tachies = project.items.filter(
    (it): it is TachieItem => it.kind === 'tachie' && it.characterId === characterId,
  );
  if (tachies.some((it) => it.start <= start && itemEnd(it) >= end)) return;

  // 区間より前から始まっている立ち絵のうち、いちばん後ろのものを伸ばす（キャラは画面に出しっぱなしにする）
  const candidate = tachies.filter((it) => it.start <= end).sort((a, b) => itemEnd(b) - itemEnd(a))[0];
  if (candidate) {
    const newStart = Math.min(candidate.start, start);
    const newEnd = Math.max(itemEnd(candidate), end);
    const layerItems = project.items.filter((it) => it.id !== candidate.id);
    if (!overlaps(layerItems, candidate.layer, newStart, newEnd)) {
      candidate.start = newStart;
      candidate.duration = newEnd - newStart;
      return;
    }
  }

  const preferred = tachieLayerFor(project, characterId);
  project.items.push({
    kind: 'tachie',
    id: uid(),
    characterId,
    layer: findFreeLayer(project.items, start, end, preferred),
    start,
    duration: end - start,
  });
}

export interface ScriptLine {
  characterId: string;
  text: string;
}

/**
 * 台本テキストを解析する。「キャラ名：セリフ」形式の行はそのキャラ、
 * それ以外は直前のキャラ（最初は既定キャラ）のセリフとして扱う。空行は無視。
 */
export function parseScript(script: string, characters: Character[], defaultCharacterId: string): ScriptLine[] {
  const lines: ScriptLine[] = [];
  let current = defaultCharacterId;
  for (const raw of script.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([^:：「]{1,20})[:：](.*)$/);
    if (m) {
      const name = m[1].trim();
      const ch = characters.find((c) => c.name === name);
      if (ch) {
        current = ch.id;
        const text = m[2].trim();
        if (text) lines.push({ characterId: current, text });
        continue;
      }
    }
    lines.push({ characterId: current, text: line });
  }
  return lines;
}

export function createVoiceItem(project: Project, characterId: string, text: string, start: number, duration: number): VoiceItem {
  return {
    kind: 'voice',
    id: uid(),
    layer: findFreeLayer(project.items, start, start + duration, LAYER.voice),
    start,
    duration,
    characterId,
    text,
    audioAssetId: null,
    audioOffset: 0,
    volume: 1,
    showSubtitle: true,
  };
}

/**
 * セリフの長さを変えたとき、後ろにあるアイテムを同じだけずらす（YMM4と同様の詰め動作）。
 * セリフレイヤー以外のアイテムは、変更前の終了位置より後ろに始まるものだけずらす。
 */
export function rippleAfter(project: Project, pivot: number, delta: number, ignoreId: string): void {
  if (Math.abs(delta) < 1e-6) return;
  for (const it of project.items) {
    if (it.id === ignoreId) continue;
    if (it.start >= pivot - 1e-6) it.start = Math.max(0, it.start + delta);
    else if (it.kind === 'tachie' && itemEnd(it) >= pivot - 1e-6) it.duration = Math.max(MIN_ITEM_DURATION, it.duration + delta);
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
