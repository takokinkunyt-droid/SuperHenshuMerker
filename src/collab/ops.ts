// 共同作業でやりとりする「変更」。プロジェクト全体ではなく、アイテム・素材ごとの追加／更新／削除と、
// プロジェクトの設定の変更だけを送る。同じアイテムを同時に変えたときは、あとから届いた方が残る。
// （同じ形式を tools/voicevox-share.mjs のサーバー側でも扱う）
import type { AssetMeta, Project, TimelineItem } from '../types';

export const META_FIELDS = ['name', 'width', 'height', 'fps', 'backgroundColor'] as const;
type MetaField = (typeof META_FIELDS)[number];

export type Op =
  | { op: 'item'; item: TimelineItem }
  | { op: 'delItem'; id: string }
  | { op: 'asset'; asset: AssetMeta }
  | { op: 'delAsset'; id: string }
  | { op: 'meta'; fields: Partial<Pick<Project, MetaField>> };

/**
 * 2つのプロジェクトの違いを変更の一覧にする。
 * Immer で更新したプロジェクトは変わっていない部分が同じオブジェクトのままなので、参照の比較で見分けられる。
 */
export function diffProjects(prev: Project, next: Project): Op[] {
  if (prev === next) return [];
  const ops: Op[] = [];

  const fields: Partial<Pick<Project, MetaField>> = {};
  let metaChanged = false;
  for (const k of META_FIELDS) {
    if (prev[k] !== next[k]) {
      (fields as Record<string, unknown>)[k] = next[k];
      metaChanged = true;
    }
  }
  if (metaChanged) ops.push({ op: 'meta', fields });

  if (prev.assets !== next.assets) {
    for (const [id, asset] of Object.entries(next.assets)) if (prev.assets[id] !== asset) ops.push({ op: 'asset', asset });
    for (const id of Object.keys(prev.assets)) if (!(id in next.assets)) ops.push({ op: 'delAsset', id });
  }

  if (prev.items !== next.items) {
    const before = new Map(prev.items.map((it) => [it.id, it]));
    const now = new Set<string>();
    for (const it of next.items) {
      now.add(it.id);
      if (before.get(it.id) !== it) ops.push({ op: 'item', item: it });
    }
    for (const id of before.keys()) if (!now.has(id)) ops.push({ op: 'delItem', id });
  }
  return ops;
}

/** 変更の一覧をプロジェクトに当てはめた新しいプロジェクトを返す（元のプロジェクトは変えない） */
export function applyOps(project: Project, ops: Op[]): Project {
  if (!ops.length) return project;
  let items = project.items;
  let assets = project.assets;
  let meta: Partial<Project> = {};
  const touchItems = () => {
    if (items === project.items) items = [...items];
  };
  const touchAssets = () => {
    if (assets === project.assets) assets = { ...assets };
  };
  for (const o of ops) {
    switch (o.op) {
      case 'item': {
        touchItems();
        const i = items.findIndex((it) => it.id === o.item.id);
        if (i >= 0) items[i] = o.item;
        else items.push(o.item);
        break;
      }
      case 'delItem':
        touchItems();
        items = items.filter((it) => it.id !== o.id);
        break;
      case 'asset':
        touchAssets();
        assets[o.asset.id] = o.asset;
        break;
      case 'delAsset':
        touchAssets();
        delete assets[o.id];
        break;
      case 'meta':
        meta = { ...meta, ...o.fields };
        break;
    }
  }
  return { ...project, ...meta, items, assets };
}
