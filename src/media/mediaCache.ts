// 素材の実行時キャッシュ（デコード済み画像・音声、動画要素、口パク用の音量）。
// 保存は assetStorage、ここは読み込んだものを使い回すだけ。
import type { AssetMeta } from '../types';
import { getAsset } from '../persist/assetStorage';
import { computeEnvelope, levelAt } from './lipsync';

type Listener = () => void;

export const MIX_SAMPLE_RATE = 48000;

class MediaCache {
  private projectId = '';
  private blobs = new Map<string, Blob>();
  private images = new Map<string, ImageBitmap>();
  private audio = new Map<string, AudioBuffer | null>();
  private envelopes = new Map<string, Float32Array>();
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
    this.envelopes.clear();
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
      const buffer = await decodeAudio(blob);
      this.setAudio(asset.id, buffer);
    } else {
      if (!this.videos.has(asset.id)) this.videos.set(asset.id, await this.createVideo(asset.id, blob));
      // 動画の音声トラックも同じ仕組みで鳴らす（音声が無い動画はnull）
      this.setAudio(asset.id, await decodeAudio(blob).catch(() => null));
    }
  }

  setAudio(assetId: string, buffer: AudioBuffer | null) {
    this.audio.set(assetId, buffer);
    if (buffer) {
      const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
      this.envelopes.set(assetId, computeEnvelope(channels, buffer.sampleRate));
    }
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
    return new Promise((resolve, reject) => {
      video.onloadeddata = () => resolve(video);
      video.onerror = () => reject(new Error('この動画形式は再生できません'));
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

  lipLevel(assetId: string | null, t: number): number {
    return assetId ? levelAt(this.envelopes.get(assetId), t) : 0;
  }
}

let decodeCtx: OfflineAudioContext | null = null;

export async function decodeAudio(blob: Blob): Promise<AudioBuffer> {
  decodeCtx ??= new OfflineAudioContext(2, 1, MIX_SAMPLE_RATE);
  return decodeCtx.decodeAudioData(await blob.arrayBuffer());
}

export const media = new MediaCache();
