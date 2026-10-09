// UIから呼ぶ編集操作。ストアの更新に、素材の保存や音声合成などの非同期処理を組み合わせる。
import type { AssetMeta, Character, ImageItem, TachieParts, TextItem, TimelineItem, VideoItem, VoiceItem } from '../types';
import { editorState } from './store';
import { LAYER, MIN_ITEM_DURATION, VOICE_GAP, createCharacter, defaultTextStyle, uid } from './defaults';
import {
  createVoiceItem,
  ensureTachieCovers,
  estimateDuration,
  findFreeLayer,
  itemEnd,
  nextVoiceStart,
  parseScript,
  rippleAfter,
  splitItem,
} from './timeline';
import { importBlob } from '../media/importer';
import { synthesize } from '../voice/voicevox';
import { media } from '../media/mediaCache';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ---------- セリフ ----------

/** セリフを1つ追加する。キャラにVOICEVOX話者があれば音声も作る */
export async function addLine(characterId: string, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) return;
  const s = editorState();
  const start = nextVoiceStart(s.project);
  const item = createVoiceItem(s.project, characterId, trimmed, start, estimateDuration(trimmed));
  s.edit((d) => {
    d.items.push(item);
    ensureTachieCovers(d, characterId, item.start, itemEnd(item));
  });
  s.selectItem(item.id);
  s.setTime(item.start);
  const ch = s.project.characters.find((c) => c.id === characterId);
  if (ch?.voice.speakerId != null) await synthesizeItem(item.id);
}

/** 台本をまとめて追加し、VOICEVOX話者のあるキャラは順に音声を作る */
export async function addScript(script: string, defaultCharacterId: string): Promise<number> {
  const s = editorState();
  const lines = parseScript(script, s.project.characters, defaultCharacterId);
  if (!lines.length) return 0;
  const created: VoiceItem[] = [];
  s.edit((d) => {
    let start = nextVoiceStart(d);
    for (const line of lines) {
      const item = createVoiceItem(d, line.characterId, line.text, start, estimateDuration(line.text));
      d.items.push(item);
      ensureTachieCovers(d, line.characterId, item.start, itemEnd(item));
      created.push(item);
      start = itemEnd(item) + VOICE_GAP;
    }
  });
  const needVoice = created.filter(
    (it) => editorState().project.characters.find((c) => c.id === it.characterId)?.voice.speakerId != null,
  );
  await synthesizeMany(needVoice.map((it) => it.id));
  return lines.length;
}

export async function synthesizeMany(ids: string[]): Promise<void> {
  const s = editorState();
  for (let i = 0; i < ids.length; i++) {
    s.setBusy(`音声を作成中… ${i + 1} / ${ids.length}`);
    try {
      await synthesizeItem(ids[i], { quiet: true });
    } catch (err) {
      s.toast(errorText(err), 'error');
      break;
    }
  }
  s.setBusy(null);
}

/** 音声がまだ無い（またはテキストが変わった）セリフをすべて合成し直す */
export async function synthesizeMissing(): Promise<void> {
  const { project } = editorState();
  const ids = project.items
    .filter(
      (it): it is VoiceItem =>
        it.kind === 'voice' &&
        !it.audioAssetId &&
        project.characters.find((c) => c.id === it.characterId)?.voice.speakerId != null,
    )
    .sort((a, b) => a.start - b.start)
    .map((it) => it.id);
  if (!ids.length) {
    editorState().toast('音声が未作成のセリフはありません（話者が設定されたキャラのみ対象）');
    return;
  }
  await synthesizeMany(ids);
}

export async function synthesizeItem(itemId: string, opts: { quiet?: boolean } = {}): Promise<void> {
  const s = editorState();
  const item = s.project.items.find((it): it is VoiceItem => it.id === itemId && it.kind === 'voice');
  if (!item) return;
  const ch = s.project.characters.find((c) => c.id === item.characterId);
  if (!ch) return;
  try {
    const wav = await synthesize(item.text, ch.voice);
    const meta = await importBlob(s.project.id, wav, `${ch.name}_${item.text.slice(0, 16)}.wav`);
    attachVoiceAudio(itemId, meta, 'voicevox');
  } catch (err) {
    if (opts.quiet) throw err;
    s.toast(errorText(err), 'error');
  }
}

/** セリフに音声素材を割り当て、長さを音声に合わせて後ろを詰める */
export function attachVoiceAudio(itemId: string, meta: AssetMeta, origin: 'voicevox' | 'file'): void {
  editorState().edit((d) => {
    d.assets[meta.id] = meta;
    const item = d.items.find((it): it is VoiceItem => it.id === itemId && it.kind === 'voice');
    if (!item) return;
    const oldEnd = item.start + item.duration;
    const newDuration = Math.max(MIN_ITEM_DURATION, meta.duration ?? item.duration);
    item.audioAssetId = meta.id;
    item.audioOrigin = origin;
    item.audioOffset = 0;
    item.duration = newDuration;
    rippleAfter(d, oldEnd, newDuration - (oldEnd - item.start), item.id);
    ensureTachieCovers(d, item.characterId, item.start, item.start + item.duration);
  });
}

export async function assignAudioFile(itemId: string, file: File): Promise<void> {
  const s = editorState();
  try {
    const meta = await importBlob(s.project.id, file, file.name);
    if (meta.kind !== 'audio') throw new Error('音声ファイルを選んでください');
    attachVoiceAudio(itemId, meta, 'file');
  } catch (err) {
    s.toast(errorText(err), 'error');
  }
}

/** 音声ファイルをファイル名順に、音声が無いセリフへ前から順に割り当てる */
export async function bulkAssignAudio(files: File[]): Promise<number> {
  const s = editorState();
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, 'ja', { numeric: true }));
  const targets = s.project.items
    .filter((it): it is VoiceItem => it.kind === 'voice' && !it.audioAssetId)
    .sort((a, b) => a.start - b.start);
  let count = 0;
  for (let i = 0; i < Math.min(sorted.length, targets.length); i++) {
    s.setBusy(`音声を割り当て中… ${i + 1} / ${Math.min(sorted.length, targets.length)}`);
    await assignAudioFile(targets[i].id, sorted[i]);
    count++;
  }
  s.setBusy(null);
  return count;
}

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

/** 素材をタイムラインの再生位置に置く */
export function placeAsset(meta: AssetMeta, at = editorState().currentTime): string {
  const s = editorState();
  const { project } = s;
  const fit = (w = project.width, h = project.height) => Math.min(1, project.width / w, project.height / h);
  const id = uid();
  let item: TimelineItem;
  if (meta.kind === 'audio') {
    const duration = meta.duration ?? 5;
    item = { kind: 'audio', id, assetId: meta.id, start: at, duration, sourceOffset: 0, volume: 0.5, layer: findFreeLayer(project.items, at, at + duration, LAYER.bgm) };
  } else if (meta.kind === 'video') {
    const duration = meta.duration ?? 5;
    item = {
      kind: 'video', id, assetId: meta.id, start: at, duration, sourceOffset: 0, volume: 1,
      x: project.width / 2, y: project.height / 2, scale: fit(meta.width, meta.height), opacity: 1,
      layer: findFreeLayer(project.items, at, at + duration, LAYER.background),
    } satisfies VideoItem;
  } else {
    // 画像は既定でセリフ全体の長さ（最低5秒）
    const duration = Math.max(5, nextVoiceStart(project) - at);
    item = {
      kind: 'image', id, assetId: meta.id, start: at, duration,
      x: project.width / 2, y: project.height / 2, scale: fit(meta.width, meta.height), opacity: 1,
      layer: findFreeLayer(project.items, at, at + duration, LAYER.background),
    } satisfies ImageItem;
  }
  s.edit((d) => {
    d.items.push(item);
  });
  s.selectItem(id);
  return id;
}

export async function importAndPlace(files: File[]): Promise<void> {
  const s = editorState();
  for (let i = 0; i < files.length; i++) {
    s.setBusy(`素材を読み込み中… ${i + 1} / ${files.length}`);
    const meta = await importAsset(files[i], files[i].name);
    if (meta) placeAsset(meta);
  }
  s.setBusy(null);
}

export function removeAsset(assetId: string): void {
  const s = editorState();
  const used =
    s.project.items.some((it) => ('assetId' in it && it.assetId === assetId) || (it.kind === 'voice' && it.audioAssetId === assetId)) ||
    s.project.characters.some((c) => Object.values(c.tachie).includes(assetId));
  if (used) {
    s.toast('この素材はタイムラインか立ち絵で使われているため削除できません', 'error');
    return;
  }
  s.edit((d) => {
    delete d.assets[assetId];
  });
}

// ---------- アイテム ----------

export function addTextItem(): void {
  const s = editorState();
  const at = s.currentTime;
  const item: TextItem = {
    kind: 'text',
    id: uid(),
    text: 'テキスト',
    start: at,
    duration: 3,
    layer: findFreeLayer(s.project.items, at, at + 3, LAYER.text),
    style: defaultTextStyle({ y: 200, fontSize: 80, strokeColor: '#000000' }),
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

export function splitAtPlayhead(): void {
  const s = editorState();
  const t = s.currentTime;
  const target =
    s.project.items.find((it) => it.id === s.selectedItemId && t > it.start && t < itemEnd(it)) ??
    // 選択が無ければ再生位置にあるアイテムをすべて分割
    null;
  const victims = target ? [target] : s.project.items.filter((it) => t > it.start && t < itemEnd(it));
  if (!victims.length) return;
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

// ---------- キャラクター ----------

export function addCharacter(): void {
  const s = editorState();
  const ch = createCharacter(`キャラ${s.project.characters.length + 1}`, s.project.characters.length);
  s.edit((d) => {
    d.characters.push(ch);
  });
  s.selectCharacter(ch.id);
}

export function updateCharacter(id: string, recipe: (c: Character) => void): void {
  editorState().edit((d) => {
    const ch = d.characters.find((c) => c.id === id);
    if (ch) recipe(ch as Character);
  });
}

export function removeCharacter(id: string): void {
  const s = editorState();
  if (s.project.characters.length <= 1) {
    s.toast('キャラクターは最低1人必要です', 'error');
    return;
  }
  s.edit((d) => {
    d.characters = d.characters.filter((c) => c.id !== id);
    d.items = d.items.filter((it) => !('characterId' in it && it.characterId === id));
  });
  s.selectCharacter(s.project.characters[0]?.id ?? null);
}

export async function setTachiePart(characterId: string, part: keyof TachieParts, file: File | null): Promise<void> {
  if (!file) {
    updateCharacter(characterId, (c) => {
      c.tachie[part] = null;
    });
    return;
  }
  const meta = await importAsset(file, file.name);
  if (!meta) return;
  if (meta.kind !== 'image') {
    editorState().toast('立ち絵には画像（PNG推奨）を指定してください', 'error');
    return;
  }
  updateCharacter(characterId, (c) => {
    c.tachie[part] = meta.id;
  });
}

/**
 * 「base.png / eyes_open.png / mouth_open.png …」のようなファイル名から、
 * 立ち絵パーツをまとめて割り当てる。
 */
export async function setTachieFromFolder(characterId: string, files: File[]): Promise<number> {
  const rules: [keyof TachieParts, RegExp][] = [
    ['eyesClosed', /(eye|目).*(close|閉|とじ)|目閉/i],
    ['eyesOpen', /(eye|目)/i],
    ['mouthHalf', /(mouth|口).*(half|半|mid)/i],
    ['mouthOpen', /(mouth|口).*(open|開|あ)/i],
    ['mouthClosed', /(mouth|口)/i],
    ['base', /(base|body|体|素体|全身)/i],
  ];
  let count = 0;
  const used = new Set<keyof TachieParts>();
  for (const file of files) {
    const name = file.name.replace(/\.[^.]+$/, '');
    const rule = rules.find(([part, re]) => !used.has(part) && re.test(name));
    if (!rule) continue;
    used.add(rule[0]);
    await setTachiePart(characterId, rule[0], file);
    count++;
  }
  return count;
}

export function primeProjectMedia(): void {
  const { project } = editorState();
  media.setProject(project.id);
  void media.ensureAll(Object.values(project.assets));
}
