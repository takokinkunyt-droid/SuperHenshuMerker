// 素材の実行時キャッシュ（デコード済み画像・音声、動画要素）。
// 保存は assetStorage、ここは読み込んだものを使い回すだけ。
import type { AssetMeta } from '../types';
import { getAsset } from '../persist/assetStorage';

type Listener = () => void;

export const MIX_SAMPLE_RATE = 48000;
/** これより長い音声（動画の音声も）は、全部をメモリに展開せず、必要な部分だけを少しずつ読む */
export const STREAM_OVER_SEC = 150;
/** 少しずつ読むときの1かたまりの長さ */
export const CHUNK_SEC = 10;
/** メモリに置いておくかたまりの数（10秒×24個＝4分ぶん） */
const CHUNK_CACHE = 24;
/** これより大きい画像は縮めて持つ（スマホのメモリを使い切らないように） */
const MAX_IMAGE_SIDE = 4096;

export interface ImageDrawable {
  source: ImageBitmap;
  /** 元の画像の大きさ（縮めて持っていても、描くときはこの大きさとして扱う） */
  width: number;
  height: number;
}

class MediaCache {
  private projectId = '';
  private blobs = new Map<string, Blob>();
  private images = new Map<string, ImageDrawable>();
  private streams = new Map<string, AudioStream>();
  private audio = new Map<string, AudioBuffer | null>();
  private videos = new Map<string, HTMLVideoElement>();
  private urls = new Map<string, string>();
  private pending = new Map<string, Promise<void>>();
  private failed = new Set<string>();
  private listeners = new Set<Listener>();

  onChange(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  /** プロジェクトが切り替わったらキャッシュを捨てる */
  setProject(projectId: string) {
    if (this.projectId === projectId) return;
    this.projectId = projectId;
    for (const v of this.videos.values()) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    for (const url of this.urls.values()) URL.revokeObjectURL(url);
    for (const img of this.images.values()) img.source.close();
    for (const st of this.streams.values()) st.dispose();
    this.streams.clear();
    this.blobs.clear();
    this.images.clear();
    this.audio.clear();
    this.videos.clear();
    this.urls.clear();
    this.pending.clear();
    this.failed.clear();
  }

  /** 読み込んだばかりのファイルを登録し、ストレージからの読み直しを省く */
  primeBlob(assetId: string, blob: Blob) {
    this.blobs.set(assetId, blob);
  }

  async blob(assetId: string): Promise<Blob | null> {
    const hit = this.blobs.get(assetId);
    if (hit) return hit;
    const blob = await getAsset(this.projectId, assetId);
    if (blob) this.blobs.set(assetId, blob);
    return blob;
  }

  isFailed(assetId: string) {
    return this.failed.has(assetId);
  }

  /** 素材をデコードしてキャッシュに載せる。何度呼んでもよい */
  ensure(asset: AssetMeta): Promise<void> {
    const key = asset.id;
    if (this.failed.has(key)) return Promise.resolve();
    if (asset.kind === 'image' && this.images.has(key)) return Promise.resolve();
    if (asset.kind === 'audio' && this.audio.has(key)) return Promise.resolve();
    if (asset.kind === 'video' && this.videos.has(key) && this.audio.has(key)) return Promise.resolve();
    let p = this.pending.get(key);
    if (!p) {
      p = this.load(asset)
        .catch((err) => {
          console.warn('素材の読み込みに失敗', asset.name, err);
          this.failed.add(key);
        })
        .finally(() => {
          this.pending.delete(key);
          this.emit();
        });
      this.pending.set(key, p);
    }
    return p;
  }

  ensureAll(assets: AssetMeta[]): Promise<void> {
    return Promise.all(assets.map((a) => this.ensure(a))).then(() => undefined);
  }

  private async load(asset: AssetMeta) {
    const blob = await this.blob(asset.id);
    if (!blob) throw new Error('素材ファイルが見つかりません');
    if (asset.kind === 'image') {
      this.images.set(asset.id, await loadImage(blob));
      return;
    }
    if (asset.kind === 'video' && !this.videos.has(asset.id)) this.videos.set(asset.id, await this.createVideo(asset.id, blob));
    // 長い音声は少しずつ読む（全部を展開すると1時間で1GBを超えてしまう）
    if ((asset.duration ?? 0) > STREAM_OVER_SEC) {
      const stream = await AudioStream.open(blob).catch(() => null);
      if (stream) {
        this.streams.set(asset.id, stream);
        this.setAudio(asset.id, null);
        return;
      }
    }
    // 動画の音声トラックも同じ仕組みで鳴らす（音声が無い動画はnull）
    this.setAudio(asset.id, asset.kind === 'audio' ? await decodeAudioFile(blob) : await decodeTrackAudio(blob).catch(() => null));
  }

  /** 少しずつ読む音声（長い素材だけ）。短い素材は audioBuffer を使う */
  stream(assetId: string | null): AudioStream | null {
    return assetId ? this.streams.get(assetId) ?? null : null;
  }

  setAudio(assetId: string, buffer: AudioBuffer | null) {
    this.audio.set(assetId, buffer);
  }

  private createVideo(assetId: string, blob: Blob): Promise<HTMLVideoElement> {
    const url = URL.createObjectURL(blob);
    this.urls.set(assetId, url);
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.src = url;
    video.addEventListener('seeked', () => this.emit());
    video.addEventListener('loadeddata', () => this.emit());
    // iOSは操作が無いと映像データを読み込まないことがあるので、メタデータが読めた時点で使えることにする
    return new Promise((resolve, reject) => {
      video.onloadedmetadata = () => resolve(video);
      video.onerror = () => reject(new Error('この動画形式は再生できません'));
      video.load();
    });
  }

  image(assetId: string | null): ImageDrawable | null {
    return assetId ? this.images.get(assetId) ?? null : null;
  }

  audioBuffer(assetId: string | null): AudioBuffer | null {
    return assetId ? this.audio.get(assetId) ?? null : null;
  }

  video(assetId: string): HTMLVideoElement | null {
    return this.videos.get(assetId) ?? null;
  }

  allVideos(): IterableIterator<[string, HTMLVideoElement]> {
    return this.videos.entries();
  }
}

async function loadImage(blob: Blob): Promise<ImageDrawable> {
  const full = await createImageBitmap(blob);
  const { width, height } = full;
  const side = Math.max(width, height);
  if (side <= MAX_IMAGE_SIDE) return { source: full, width, height };
  const k = MAX_IMAGE_SIDE / side;
  const small = await createImageBitmap(full, { resizeWidth: Math.round(width * k), resizeHeight: Math.round(height * k), resizeQuality: 'high' });
  full.close();
  return { source: small, width, height };
}

type AudioSink = { buffers(start?: number, end?: number): AsyncGenerator<{ buffer: AudioBuffer; timestamp: number }, void, unknown> };

/** 最近使ったかたまりの一覧（古いものから捨てる） */
const chunkLru: { stream: AudioStream; idx: number }[] = [];

/**
 * 長い音声を、10秒ずつのかたまりに分けて必要なときだけデコードする。
 * ファイル全体をメモリに読み込まないので、何時間の素材でも扱える。
 */
export class AudioStream {
  private chunks = new Map<number, AudioBuffer>();
  private pending = new Map<number, Promise<AudioBuffer | null>>();
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;

  private constructor(
    private input: { dispose(): void },
    private sink: AudioSink,
    readonly duration: number,
    readonly sampleRate: number,
    readonly channels: number,
  ) {}

  static async open(blob: Blob): Promise<AudioStream | null> {
    const { Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track || !(await track.canDecode())) {
        input.dispose();
        return null;
      }
      const duration = await track.computeDuration();
      return new AudioStream(input, new AudioBufferSink(track), duration, track.sampleRate, track.numberOfChannels);
    } catch (err) {
      input.dispose();
      throw err;
    }
  }

  get chunkCount() {
    return Math.max(1, Math.ceil(this.duration / CHUNK_SEC));
  }

  /** すでに読んであるかたまり（無ければ undefined） */
  cached(idx: number): AudioBuffer | undefined {
    return this.chunks.get(idx);
  }

  /** idx 番目のかたまり（idx×10秒 から10秒ぶん）を読む */
  load(idx: number): Promise<AudioBuffer | null> {
    const hit = this.chunks.get(idx);
    if (hit) return Promise.resolve(hit);
    let p = this.pending.get(idx);
    if (!p) {
      p = this.queue.then(() => this.decode(idx)).catch(() => null);
      this.queue = p;
      this.pending.set(idx, p);
      void p.finally(() => this.pending.delete(idx));
    }
    return p;
  }

  private async decode(idx: number): Promise<AudioBuffer | null> {
    if (this.disposed || idx < 0 || idx >= this.chunkCount) return null;
    const start = idx * CHUNK_SEC;
    const end = Math.min(this.duration, start + CHUNK_SEC);
    const sr = this.sampleRate;
    const length = Math.max(1, Math.round((end - start) * sr));
    const out = new AudioBuffer({ length, numberOfChannels: this.channels, sampleRate: sr });
    for await (const { buffer, timestamp } of this.sink.buffers(start, end)) {
      let offset = Math.round((timestamp - start) * sr);
      let from = 0;
      if (offset < 0) {
        from = -offset;
        offset = 0;
      }
      const n = Math.min(buffer.length - from, length - offset);
      if (n <= 0) continue;
      for (let c = 0; c < Math.min(this.channels, buffer.numberOfChannels); c++) {
        out.copyToChannel(buffer.getChannelData(c).subarray(from, from + n), c, offset);
      }
    }
    if (this.disposed) return null;
    this.chunks.set(idx, out);
    chunkLru.push({ stream: this, idx });
    while (chunkLru.length > CHUNK_CACHE) {
      const old = chunkLru.shift()!;
      old.stream.chunks.delete(old.idx);
    }
    return out;
  }

  dispose() {
    this.disposed = true;
    this.chunks.clear();
    for (let i = chunkLru.length - 1; i >= 0; i--) if (chunkLru[i].stream === this) chunkLru.splice(i, 1);
    this.input.dispose();
  }
}

/** 音声・動画ファイルの音声の長さを、全部デコードせずに調べる。調べられなければ null */
export async function probeAudioDuration(blob: Blob): Promise<number | null> {
  try {
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) return null;
      const d = await track.computeDuration();
      return Number.isFinite(d) && d > 0 ? d : null;
    } finally {
      input.dispose();
    }
  } catch {
    return null;
  }
}

let decodeCtx: OfflineAudioContext | null = null;

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  decodeCtx ??= new OfflineAudioContext(2, 1, MIX_SAMPLE_RATE);
  return decodeCtx.decodeAudioData(await blob.arrayBuffer());
}

export const media = new MediaCache();

/** 音楽・音声ファイルをデコードする。ブラウザが直接扱えない形式はMediabunnyで読む */
export async function decodeAudioFile(blob: Blob): Promise<AudioBuffer> {
  try {
    return await decodeAudio(blob);
  } catch {
    const buffer = await decodeTrackAudio(blob).catch(() => null);
    if (!buffer) throw new Error('この音声ファイルの形式には対応していません（MP3・WAV・M4A・AAC・OGGなどを使ってください）');
    return buffer;
  }
}

/**
 * ファイルの音声トラックだけを少しずつデコードして1本のAudioBufferにする。
 * ファイル全体をメモリに読み込まないので、スマホで撮った大きな動画でも扱える。
 */
export async function decodeTrackAudio(blob: Blob): Promise<AudioBuffer | null> {
  const { Input, BlobSource, ALL_FORMATS, AudioBufferSink } = await import('mediabunny');
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track || !(await track.canDecode())) return null;
    const duration = await track.computeDuration();
    const { sampleRate, numberOfChannels } = track;
    const out = new AudioBuffer({ length: Math.max(1, Math.ceil(duration * sampleRate)), numberOfChannels, sampleRate });
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      const offset = Math.round(timestamp * sampleRate);
      if (offset < 0 || offset >= out.length) continue;
      for (let c = 0; c < Math.min(numberOfChannels, buffer.numberOfChannels); c++) {
        out.copyToChannel(buffer.getChannelData(c).subarray(0, out.length - offset), c, offset);
      }
    }
    return out;
  } finally {
    input.dispose();
  }
}
