import type { Project } from '../types';

/** 読み込んだJSONを現在の形式にそろえる。形式が変わったらここに変換を足す */
export function migrateProject(raw: unknown): Project {
  const p = raw as Partial<Project>;
  if (!p || typeof p !== 'object' || !Array.isArray(p.items) || !Array.isArray(p.characters)) {
    throw new Error('プロジェクトファイルの形式が正しくありません。');
  }
  return {
    version: 1,
    id: p.id ?? crypto.randomUUID(),
    name: p.name ?? '無題',
    width: p.width ?? 1920,
    height: p.height ?? 1080,
    fps: p.fps ?? 30,
    backgroundColor: p.backgroundColor ?? '#000000',
    characters: p.characters,
    items: p.items,
    assets: p.assets ?? {},
    createdAt: p.createdAt ?? Date.now(),
    updatedAt: p.updatedAt ?? Date.now(),
  };
}
