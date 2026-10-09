// UIから呼ぶ編集操作。ストアの更新に、素材の保存などの非同期処理を組み合わせる。
import type { AssetKind, AssetMeta, ImageItem, TextItem, TimelineItem, VideoItem } from '../types';
import { editorState } from './store';
import { ASPECTS, LAYER, defaultTextStyle, uid, type AspectKey } from './defaults';
import { findFreeLayer, itemEnd, recenterItems, splitItem } from './timeline';
import { importBlob, kindOf } from '../media/importer';
import { media } from '../media/mediaCache';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 画像を置いたときの既定の表示時間 */
const IMAGE_DURATION = 5;

// ---------- 素材 ----------

export async function importAsset(file: Blob, name: string): Promise<AssetMeta | null> {
  const s = editorState();
  try {
    const meta = await importBlob(s.project.id, file, name);
    s.edit((d) => {
      d.assets[meta.id] = meta;
    });
    return meta;
  } catch (err) {
    s.toast(errorText(err), 'error');
    return null;
  }
}

/** 素材をタイムラインに置く。映像は画面に収まる大きさにする */
export function placeAsset(meta: AssetMeta, at = editorState().currentTime): TimelineItem {
  const s = editorState();
  const { project } = s;
  const fit = (w = project.width, h = project.height) => Math.min(project.width / w, project.height / h);
  const id = uid();
  let item: TimelineItem;
  if (meta.kind === 'audio') {
    const duration = meta.duration ?? 5;
    item = { kind: 'audio', id, assetId: meta.id, start: at, duration, sourceOffset: 0, volume: 1, layer: findFreeLayer(project.items, at, at + duration, LAYER.audio) };
  } else if (meta.kind === 'video') {
    const duration = meta.duration ?? 5;
    item = {
      kind: 'video', id, assetId: meta.id, start: at, duration, sourceOffset: 0, volume: 1,
      x: project.width / 2, y: project.height / 2, scale: fit(meta.width, meta.height), opacity: 1,
      layer: findFreeLayer(project.items, at, at + duration, LAYER.visual),
    } satisfies VideoItem;
  } else {
    item = {
      kind: 'image', id, assetId: meta.id, start: at, duration: IMAGE_DURATION,
      x: project.width / 2, y: project.height / 2, scale: fit(meta.width, meta.height), opacity: 1,
      layer: findFreeLayer(project.items, at, at + IMAGE_DURATION, LAYER.visual),
    } satisfies ImageItem;
  }
  s.edit((d) => {
    d.items.push(item);
  });
  s.selectItem(id);
  return item;
}

/**
 * ファイルを読み込んでタイムラインに置く。
 * 動画・画像は再生位置から順に並べ、音楽・音声は再生位置にそろえて重ねる。
 */
export async function importAndPlace(files: File[], only?: AssetKind): Promise<void> {
  const s = editorState();
  let visualAt = s.currentTime;
  const audioAt = s.currentTime;
  const targets = only ? files.filter((f) => kindOf(f) === only) : files;
  if (only && targets.length < files.length) s.toast(`${only === 'audio' ? '音楽・音声' : '対応する'}ファイル以外は読み込みませんでした`, 'error');
  for (let i = 0; i < targets.length; i++) {
    s.setBusy(`読み込み中… ${i + 1} / ${targets.length}`);
    const meta = await importAsset(targets[i], targets[i].name);
    if (!meta) continue;
    if (meta.kind === 'audio') {
      placeAsset(meta, audioAt);
    } else {
      visualAt = itemEnd(placeAsset(meta, visualAt));
    }
  }
  s.setBusy(null);
}

export function removeAsset(assetId: string): void {
  const s = editorState();
  if (s.project.items.some((it) => 'assetId' in it && it.assetId === assetId)) {
    s.toast('この素材はタイムラインで使われているため削除できません', 'error');
    return;
  }
  s.edit((d) => {
    delete d.assets[assetId];
  });
}

// ---------- アイテム ----------

export function addTextItem(): void {
  const s = editorState();
  const { width, height } = s.project;
  const at = s.currentTime;
  const item: TextItem = {
    kind: 'text',
    id: uid(),
    text: 'テキスト',
    start: at,
    duration: 3,
    layer: findFreeLayer(s.project.items, at, at + 3, LAYER.text),
    style: defaultTextStyle(width, height),
  };
  s.edit((d) => {
    d.items.push(item);
  });
  s.selectItem(item.id);
}

export function updateItem(id: string, patch: Partial<TimelineItem>): void {
  editorState().edit((d) => {
    const item = d.items.find((it) => it.id === id);
    if (item) Object.assign(item, patch);
  });
}

export function deleteItem(id: string): void {
  const s = editorState();
  s.edit((d) => {
    d.items = d.items.filter((it) => it.id !== id);
  });
  if (s.selectedItemId === id) s.selectItem(null);
}

/** 選択中のアイテム（選択が無ければ再生位置にあるすべてのアイテム）を再生位置で分割する */
export function splitAtPlayhead(): void {
  const s = editorState();
  const t = s.currentTime;
  const selected = s.project.items.find((it) => it.id === s.selectedItemId && t > it.start && t < itemEnd(it));
  const victims = selected ? [selected] : s.project.items.filter((it) => t > it.start && t < itemEnd(it));
  if (!victims.length) {
    s.toast('再生位置（赤い線）をアイテムの上に合わせてから分割してください');
    return;
  }
  s.edit((d) => {
    for (const v of victims) {
      const parts = splitItem(v, t);
      if (!parts) continue;
      const idx = d.items.findIndex((it) => it.id === v.id);
      d.items.splice(idx, 1, ...parts);
    }
  });
}

export function duplicateItem(id: string): void {
  const s = editorState();
  const item = s.project.items.find((it) => it.id === id);
  if (!item) return;
  const start = itemEnd(item);
  const copy = { ...structuredClone(item), id: uid(), start } as TimelineItem;
  copy.layer = findFreeLayer(s.project.items, start, start + item.duration, item.layer);
  s.edit((d) => {
    d.items.push(copy);
  });
  s.selectItem(copy.id);
}

// ---------- プロジェクト ----------

/** 画面の比率（16:9・9:16・1:1）を切り替える */
export function setAspect(key: AspectKey): void {
  const preset = ASPECTS.find((a) => a.key === key);
  if (!preset) return;
  editorState().edit((d) => {
    if (d.width === preset.width && d.height === preset.height) return;
    const oldWidth = d.width;
    const oldHeight = d.height;
    d.width = preset.width;
    d.height = preset.height;
    recenterItems(d, oldWidth, oldHeight);
  });
}

export function primeProjectMedia(): void {
  const { project } = editorState();
  media.setProject(project.id);
  void media.ensureAll(Object.values(project.assets));
}
