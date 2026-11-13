import type { Fx, Project, TextStyle, TimelineItem } from '../types';
import { defaultTextStyle } from '../state/defaults';

const KINDS = new Set(['text', 'image', 'video', 'audio']);

interface LegacyVoice {
  kind: 'voice';
  id: string;
  layer: number;
  start: number;
  duration: number;
  characterId: string;
  text: string;
  audioAssetId: string | null;
  audioOffset: number;
  volume: number;
  showSubtitle: boolean;
}

interface LegacyVisual {
  blur?: number;
  mosaic?: number;
  fadeIn?: number;
  fadeOut?: number;
  slideIn?: { direction: string; duration: number } | null;
  zoomIn?: { from: number; duration: number } | null;
}

interface LegacyAudio {
  bass?: number;
  beep?: boolean;
  noise?: number;
  fadeIn?: number;
  fadeOut?: number;
}

/** エフェクトが「決まった数個の設定」だった頃のデータを、エフェクトの一覧（fx / afx）に直す */
function migrateEffects(item: TimelineItem): TimelineItem {
  const old = item as TimelineItem & { effects?: LegacyVisual; audioEffects?: LegacyAudio };
  if (!old.effects && !old.audioEffects) return item;
  const { effects: v, audioEffects: a, ...rest } = old;
  const out = rest as TimelineItem & { fx?: Fx[]; afx?: Fx[] };
  let n = 0;
  const fx = (type: string, p: Fx['p']): Fx => ({ id: `${item.id}-m${n++}`, type, p });
  if (v && out.kind !== 'audio' && !out.fx) {
    const list: Fx[] = [];
    if (v.fadeIn || v.fadeOut) list.push(fx('fadeInOut', { tin: v.fadeIn ?? 0, tout: v.fadeOut ?? 0, ease: 'linear' }));
    if (v.slideIn) list.push(fx('offscreenInOut', { dir: v.slideIn.direction, tin: v.slideIn.duration, tout: 0, ease: 'out' }));
    if (v.zoomIn) list.push(fx('zoomInOut', { scale: v.zoomIn.from * 100, tin: v.zoomIn.duration, tout: 0, ease: 'out' }));
    if (v.mosaic) list.push(fx('mosaic', { size: v.mosaic }));
    if (v.blur) list.push(fx('blur', { r: v.blur }));
    if (list.length) out.fx = list;
  }
  if (a && (out.kind === 'audio' || out.kind === 'video') && !out.afx) {
    const list: Fx[] = [];
    if (a.beep) list.push(fx('tone', {}));
    if (a.bass) list.push(fx('bass', { gain: a.bass }));
    if (a.noise) list.push(fx('noise', { amt: Math.round(a.noise * 100) }));
    if (a.fadeIn || a.fadeOut) list.push(fx('afade', { tin: a.fadeIn ?? 0, tout: a.fadeOut ?? 0 }));
    if (list.length) out.afx = list;
  }
  return out;
}

/**
 * 読み込んだJSONを現在の形式にそろえる。形式が変わったらここに変換を足す。
 * v1（キャラクター・セリフ機能があった版）のセリフは、音声アイテムとテキストアイテムに分けて残す。
 */
export function migrateProject(raw: unknown): Project {
  const p = raw as Partial<Project> & { characters?: { id: string; subtitle?: TextStyle }[] };
  if (!p || typeof p !== 'object' || !Array.isArray(p.items)) {
    throw new Error('プロジェクトファイルの形式が正しくありません。');
  }
  const width = p.width ?? 1920;
  const height = p.height ?? 1080;
  const items: TimelineItem[] = [];
  for (const it of p.items as (TimelineItem | LegacyVoice | { kind: string })[]) {
    if (KINDS.has(it.kind)) {
      items.push(migrateEffects(it as TimelineItem));
    } else if (it.kind === 'voice') {
      const v = it as LegacyVoice;
      if (v.audioAssetId) {
        items.push({ kind: 'audio', id: v.id, layer: v.layer, start: v.start, duration: v.duration, assetId: v.audioAssetId, sourceOffset: v.audioOffset, volume: v.volume });
      }
      if (v.showSubtitle && v.text) {
        const style = p.characters?.find((c) => c.id === v.characterId)?.subtitle ?? defaultTextStyle(width, height);
        items.push({ kind: 'text', id: `${v.id}-text`, layer: v.layer + 1, start: v.start, duration: v.duration, text: v.text, style: { ...style } });
      }
    }
    // 立ち絵アイテムは機能ごと無くなったので捨てる
  }
  return {
    version: 2,
    id: p.id ?? crypto.randomUUID(),
    name: p.name ?? '無題',
    width,
    height,
    fps: p.fps ?? 30,
    backgroundColor: p.backgroundColor ?? '#000000',
    items,
    assets: p.assets ?? {},
    ...(p.layers ? { layers: p.layers } : {}),
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  };
}
