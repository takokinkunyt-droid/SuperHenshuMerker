// 素材の実行時キャッシュ（デコード済み画像・音声、動画要素）。
// 保存は assetStorage、ここは読み込んだものを使い回すだけ。
import type { AssetMeta } from '../types';
import { getAsset } from '../persist/assetStorage';

type Listener = () => void;

export const MIX_SAMPLE_RATE = 48000;

class MediaCache {
  private projectId = '';
  private blobs = new Map<string, Blob>();
  private images = new Map<string, ImageBitmap>();
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
    for (const img of this.images.values()) img.close();
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
      this.images.set(asset.id, await createImageBitmap(blob));
    } else if (asset.kind === 'audio') {
      this.setAudio(asset.id, await decodeAudioFile(blob));
    } else {
      if (!this.videos.has(asset.id)) this.videos.set(asset.id, await this.createVideo(asset.id, blob));
      // 動画の音声トラックも同じ仕組みで鳴らす（音声が無い動画はnull）
      this.setAudio(asset.id, await decodeTrackAudio(blob).catch(() => null));
    }
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

  image(assetId: string | null): ImageBitmap | null {
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
