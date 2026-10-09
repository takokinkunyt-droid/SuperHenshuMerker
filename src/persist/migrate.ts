import type { Project, TextStyle, TimelineItem } from '../types';
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
      items.push(it as TimelineItem);
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
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  };
}
