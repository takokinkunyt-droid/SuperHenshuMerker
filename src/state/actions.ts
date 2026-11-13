// UIから呼ぶ編集操作。ストアの更新に、素材の保存などの非同期処理を組み合わせる。
import type { AssetKind, AssetMeta, ImageItem, LayerState, TextItem, TimelineItem, VideoItem } from '../types';
import { editorState } from './store';
import { ASPECTS, LAYER, defaultTextStyle, uid, type AspectKey } from './defaults';
import { findFreeLayer, itemEnd, recenterItems, splitItem } from './timeline';
import { importBlob, kindOf } from '../media/importer';
import { media } from '../media/mediaCache';
import { putAsset } from '../persist/assetStorage';
import { itemBaseBox } from '../render/renderer';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** 画像を置いたときの既定の表示時間 */
const IMAGE_DURATION = 5;

// ---------- 素材 ----------

export async function importAsset(file: Blob, name: string): Promise<AssetMeta | null> {
  const s = editorState();
  try {
    // 大きなファイルは保存に時間がかかるので、進み具合を出す
    const big = file.size > 200 * 1024 * 1024;
    const meta = await importBlob(s.project.id, file, name, big ? (r) => s.setBusy(`「${name}」を保存中… ${Math.round(r * 100)}%`) : undefined, (msg) => s.toast(msg, 'error'));
    if (big) s.setBusy(null);
    s.edit((d) => {
      d.assets[meta.id] = meta;
    });
    return meta;
  } catch (err) {
    if (file.size > 200 * 1024 * 1024) s.setBusy(null);
    s.toast(errorText(err), 'error');
    return null;
  }
}

/** 素材のファイルが見つからなくなったとき（保存できなかった大きなファイルなど）に、同じファイルを選び直す */
export async function relinkAsset(asset: AssetMeta, file: Blob): Promise<void> {
  const s = editorState();
  if (kindOf({ name: asset.name, type: file.type || asset.mime }) !== asset.kind) {
    s.toast('種類の違うファイルです。元と同じファイルを選んでください。', 'error');
    return;
  }
  media.relink(asset.id, file);
  // 保存できればしておく（できなくても、このまま使える）
  void putAsset(s.project.id, asset.id, file).catch(() => undefined);
  await media.ensure(asset);
  s.bumpMedia();
  if (media.isFailed(asset.id)) s.toast(`「${asset.name}」を読み込めませんでした`, 'error');
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
  // 追加したらすぐプレビュー上で文字を入力できるようにする
  s.setEditingText(item.id);
}

export function updateItem(id: string, patch: Partial<TimelineItem>): void {
  editorState().edit((d) => {
    const item = d.items.find((it) => it.id === id);
    if (item) Object.assign(item, patch);
  });
}

export function deleteItem(id: string): void {
  deleteItems([id]);
}

export function deleteItems(ids: string[]): void {
  if (!ids.length) return;
  const s = editorState();
  const gone = new Set(ids);
  s.edit((d) => {
    d.items = d.items.filter((it) => !gone.has(it.id));
  });
  s.setSelection(s.selectedIds.filter((id) => !gone.has(id)));
}

/** 選択中のすべてのアイテム（無ければ空） */
export function selectedItems(): TimelineItem[] {
  const s = editorState();
  const ids = new Set(s.selectedIds);
  return s.project.items.filter((it) => ids.has(it.id));
}

/** 選択中のアイテム（選択が無ければ再生位置にあるすべてのアイテム）を再生位置で分割する */
export function splitAtPlayhead(): void {
  const s = editorState();
  const t = s.currentTime;
  const under = s.project.items.filter((it) => t > it.start && t < itemEnd(it) && !s.project.layers?.[it.layer]?.locked);
  const selected = under.filter((it) => s.selectedIds.includes(it.id));
  const victims = selected.length ? selected : under;
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

/**
 * アイテムのまとまりを、位置関係を保ったまま shift 秒ずらして置く。
 * 同じレイヤーが空いていなければ、空いているレイヤーに置く。
 */
function placeCopies(sources: TimelineItem[], shift: number): string[] {
  const s = editorState();
  const placed: TimelineItem[] = [];
  const all = [...s.project.items];
  for (const src of [...sources].sort((a, b) => a.layer - b.layer || a.start - b.start)) {
    const start = Math.max(0, src.start + shift);
    const copy = { ...structuredClone(src), id: uid(), start } as TimelineItem;
    copy.layer = findFreeLayer(all, start, start + src.duration, src.layer);
    // 字幕つきの読み上げを複製したとき、元の字幕を書き換えないようにする
    if (copy.kind === 'audio' && copy.tts) copy.tts = { ...copy.tts, subtitleId: null };
    all.push(copy);
    placed.push(copy);
  }
  s.edit((d) => {
    d.items.push(...placed);
  });
  const ids = placed.map((it) => it.id);
  s.setSelection(ids);
  return ids;
}

export function duplicateItem(id: string): void {
  duplicateItems([id]);
}

/** 選んだアイテムを、そのすぐ後ろに複製する */
export function duplicateItems(ids: string[]): void {
  const s = editorState();
  const set = new Set(ids);
  const sources = s.project.items.filter((it) => set.has(it.id));
  if (!sources.length) return;
  const first = Math.min(...sources.map((it) => it.start));
  const last = Math.max(...sources.map(itemEnd));
  placeCopies(sources, last - first);
}

export function copyItem(id: string): void {
  copyItems([id]);
}

/** 選んだアイテムをコピーする */
export function copyItems(ids: string[]): void {
  const s = editorState();
  const set = new Set(ids);
  const items = s.project.items.filter((it) => set.has(it.id));
  if (!items.length) return;
  s.setClipboard({ projectId: s.project.id, items: structuredClone(items) });
  s.toast(items.length > 1 ? `${items.length}個コピーしました（「ペースト」で再生位置に貼り付け）` : 'コピーしました（「ペースト」で再生位置に貼り付け）');
}

/**
 * コピーしたアイテムを貼り付ける（at を省くと再生位置）。
 * layer を指定すると、一番上のアイテムがそのレイヤーに来るように置く。
 */
export function pasteItem(at?: number, layer?: number): void {
  const s = editorState();
  const clip = s.clipboard;
  if (!clip?.items.length) return;
  // 素材を使うアイテムは、その素材があるプロジェクトの中でだけ貼り付けられる
  const usable = clip.items.filter((it) => !('assetId' in it) || s.project.assets[it.assetId]);
  if (!usable.length) {
    s.toast('この素材は今のプロジェクトに無いため貼り付けられません', 'error');
    return;
  }
  const first = Math.min(...usable.map((it) => it.start));
  const top = Math.min(...usable.map((it) => it.layer));
  const moved = layer === undefined ? usable : usable.map((it) => ({ ...it, layer: it.layer - top + layer }) as TimelineItem);
  placeCopies(moved, (at ?? s.currentTime) - first);
}

// ---------- レイヤー ----------

export function setLayerState(layer: number, patch: Partial<LayerState>): void {
  editorState().edit((d) => {
    const layers = (d.layers ??= {});
    const next = { ...layers[layer], ...patch };
    for (const k of Object.keys(next) as (keyof LayerState)[]) if (!next[k]) delete next[k];
    if (Object.keys(next).length) layers[layer] = next;
    else delete layers[layer];
  });
}

/** レイヤー番号を付け替える（アイテムと、レイヤーの表示・ロック・名前の両方） */
function remapLayers(map: (layer: number) => number | null): void {
  editorState().edit((d) => {
    d.items = d.items.filter((it) => map(it.layer) !== null);
    for (const it of d.items) it.layer = map(it.layer)!;
    const next: Record<string, LayerState> = {};
    for (const [k, v] of Object.entries(d.layers ?? {})) {
      const to = map(Number(k));
      if (to !== null) next[to] = v;
    }
    d.layers = next;
  });
}

/** at の位置に空のレイヤーを入れる（それ以降は1つずつ下がる） */
export function insertLayer(at: number): void {
  remapLayers((l) => (l >= at ? l + 1 : l));
}

/** レイヤーを、置いてあるアイテムごと削除する（それ以降は1つずつ上がる） */
export function removeLayer(at: number): void {
  const s = editorState();
  remapLayers((l) => (l === at ? null : l > at ? l - 1 : l));
  const alive = new Set(editorState().project.items.map((it) => it.id));
  s.setSelection(s.selectedIds.filter((id) => alive.has(id)));
}

/** レイヤーを、となりのレイヤーと入れ替える */
export function swapLayers(a: number, b: number): void {
  if (a < 0 || b < 0 || a === b) return;
  remapLayers((l) => (l === a ? b : l === b ? a : l));
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

export type AlignH = 'left' | 'center' | 'right';
export type AlignV = 'top' | 'middle' | 'bottom';

/** 画面の余白（5%）・中央にぴったり合わせる */
export function alignItem(id: string, h: AlignH | null, v: AlignV | null): void {
  const s = editorState();
  const item = s.project.items.find((it) => it.id === id);
  if (!item) return;
  const box = itemBaseBox(item, s.project);
  if (!box) return;
  const { width: W, height: H } = s.project;
  const marginX = W * 0.05;
  const marginY = H * 0.05;
  const dx = h === 'left' ? marginX - box.x : h === 'center' ? W / 2 - (box.x + box.w / 2) : h === 'right' ? W - marginX - (box.x + box.w) : 0;
  const dy = v === 'top' ? marginY - box.y : v === 'middle' ? H / 2 - (box.y + box.h / 2) : v === 'bottom' ? H - marginY - (box.y + box.h) : 0;
  s.edit((d) => {
    const it = d.items.find((x) => x.id === id);
    if (!it) return;
    if (it.kind === 'text') {
      it.style.x = Math.round(it.style.x + dx);
      it.style.y = Math.round(it.style.y + dy);
    } else if (it.kind === 'image' || it.kind === 'video') {
      it.x = Math.round(it.x + dx);
      it.y = Math.round(it.y + dy);
    }
  });
}
