// 動画の書き出し：WebCodecsでブラウザ内エンコードし、Mediabunnyでファイルに格納する。
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec,
  type WrappedCanvas,
} from 'mediabunny';
import type { Project, VideoItem } from '../types';
import { MIX_SAMPLE_RATE, media } from '../media/mediaCache';
import { scheduleAudio } from '../media/audioMix';
import { isActiveAt, itemEnd, projectDuration } from '../state/timeline';
import { drawFrame, type Drawable, type FrameSource } from '../render/renderer';

export interface ExportSupport {
  webCodecs: boolean;
  video: VideoCodec | null;
  /** 'aac'（ネイティブ）／'aac-wasm'（WASMエンコーダーで補う）／'opus'／null */
  audio: 'aac' | 'aac-wasm' | 'opus' | null;
  container: 'mp4' | 'webm' | null;
}

export async function checkExportSupport(width = 1920, height = 1080, fps = 30): Promise<ExportSupport> {
  const webCodecs = typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined';
  if (!webCodecs) return { webCodecs, video: null, audio: null, container: null };
  const opts = { width, height, frameRate: fps, quality: QUALITY_HIGH };
  if (await canEncodeVideo('avc', opts)) {
    const aac = await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: MIX_SAMPLE_RATE });
    // AACが無い環境（Firefox、Linuxなど）は、WASM製のAACエンコーダーで補ってMP4にする
    return { webCodecs, video: 'avc', audio: aac ? 'aac' : 'aac-wasm', container: 'mp4' };
  }
  for (const codec of ['vp9', 'vp8'] as const) {
    if (await canEncodeVideo(codec, opts)) {
      const opus = await canEncodeAudio('opus', { numberOfChannels: 2, sampleRate: MIX_SAMPLE_RATE });
      return { webCodecs, video: codec, audio: opus ? 'opus' : null, container: 'webm' };
    }
  }
  return { webCodecs, video: null, audio: null, container: null };
}

export interface ExportOptions {
  /** 出力の高さ（幅は比率から決まる） */
  height: number;
  /** 指定するとディスクへ逐次書き込む（長尺でもメモリを使い切らない） */
  fileHandle?: FileSystemFileHandle;
  signal?: AbortSignal;
  onProgress?: (ratio: number, label: string) => void;
}

export interface ExportResult {
  blob: Blob | null;
  extension: string;
  seconds: number;
}

let aacRegistered = false;

async function prepareAudioCodec(support: ExportSupport): Promise<AudioCodec | null> {
  if (support.audio === 'aac-wasm') {
    if (!aacRegistered) {
      const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
      registerAacEncoder();
      aacRegistered = true;
    }
    return 'aac';
  }
  return support.audio;
}

class AbortError extends Error {
  constructor() {
    super('書き出しを中止しました');
    this.name = 'AbortError';
  }
}

export async function exportVideo(project: Project, opts: ExportOptions): Promise<ExportResult> {
  const began = performance.now();
  const duration = projectDuration(project);
  if (duration <= 0) throw new Error('タイムラインが空です');

  const scale = opts.height / project.height;
  // H.264は幅・高さが偶数である必要がある
  const outW = Math.round((project.width * scale) / 2) * 2;
  const outH = Math.round(opts.height / 2) * 2;
  const fps = project.fps;

  const support = await checkExportSupport(outW, outH, fps);
  if (!support.video || !support.container) {
    throw new Error('このブラウザは動画のエンコード（WebCodecs）に対応していません。最新のChrome・Edge・Safariをお試しください。');
  }
  const audioCodec = await prepareAudioCodec(support);
  const progress = opts.onProgress ?? (() => undefined);
  const checkAbort = () => {
    if (opts.signal?.aborted) throw new AbortError();
  };

  progress(0, '素材を読み込み中…');
  await media.ensureAll(Object.values(project.assets));
  await document.fonts?.ready;
  checkAbort();

  // 1. 全音声を1本にミックスする
  progress(0, '音声をミックス中…');
  const totalSamples = Math.ceil(duration * MIX_SAMPLE_RATE);
  const offline = new OfflineAudioContext(2, Math.max(1, totalSamples), MIX_SAMPLE_RATE);
  scheduleAudio(offline, project, 0, 0);
  const mixed = await offline.startRendering();
  checkAbort();

  // 2. 出力ファイルを準備する
  const writable = opts.fileHandle ? await opts.fileHandle.createWritable() : null;
  const target = writable ? new StreamTarget(writable, { chunked: true }) : new BufferTarget();
  const format =
    support.container === 'mp4'
      ? new Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' })
      : new WebMOutputFormat();
  const output = new Output({ format, target });

  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(outW, outH) : Object.assign(document.createElement('canvas'), { width: outW, height: outH });
  const ctx = canvas.getContext('2d', { alpha: false }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  const videoSource = new CanvasSource(canvas, { codec: support.video, quality: QUALITY_HIGH, keyFrameInterval: 2 });
  output.addVideoTrack(videoSource, { frameRate: fps });
  const audioSource = audioCodec ? new AudioBufferSource({ codec: audioCodec, quality: QUALITY_HIGH }) : null;
  if (audioSource) output.addAudioTrack(audioSource);

  // 3. 動画素材のフレーム取り出し口を用意する（アイテムごとに必要な時刻だけデコード）
  const videoFrames = new VideoFrameProvider(fps);
  const frameDrawables = new Map<string, Drawable | null>();
  const source: FrameSource = {
    image(assetId) {
      const img = media.image(assetId);
      return img ? { source: img, width: img.width, height: img.height } : null;
    },
    videoFrame(item) {
      return frameDrawables.get(item.id) ?? null;
    },
    lipLevel(assetId, t) {
      return media.lipLevel(assetId, t);
    },
  };

  try {
    await output.start();
    const frameCount = Math.ceil(duration * fps);
    let audioWritten = 0;
    for (let i = 0; i < frameCount; i++) {
      checkAbort();
      const t = i / fps;
      frameDrawables.clear();
      for (const item of project.items) {
        if (item.kind === 'video' && isActiveAt(item, t)) frameDrawables.set(item.id, await videoFrames.frame(item, i));
      }
      drawFrame(ctx, project, t, source, outW / project.width);
      await videoSource.add(t, 1 / fps);

      // 音声は映像と交互に1秒ずつ渡す（片方だけが溜まり続けないように）
      if (audioSource) {
        const until = Math.min(totalSamples, Math.ceil(((i + 1) / fps + 1) * MIX_SAMPLE_RATE));
        if (until - audioWritten >= MIX_SAMPLE_RATE || i === frameCount - 1) {
          await audioSource.add(sliceBuffer(mixed, audioWritten, until));
          audioWritten = until;
        }
      }
      if (i % 5 === 0) progress(i / frameCount, `フレーム ${i + 1} / ${frameCount}`);
    }
    if (audioSource && audioWritten < totalSamples) await audioSource.add(sliceBuffer(mixed, audioWritten, totalSamples));

    progress(1, 'ファイルを仕上げ中…');
    await output.finalize();
  } catch (err) {
    if (output.state !== 'finalized' && output.state !== 'canceled') await output.cancel().catch(() => undefined);
    throw err;
  } finally {
    videoFrames.dispose();
  }

  const extension = support.container;
  const blob =
    target instanceof BufferTarget && target.buffer
      ? new Blob([target.buffer], { type: support.container === 'mp4' ? 'video/mp4' : 'video/webm' })
      : null;
  return { blob, extension, seconds: (performance.now() - began) / 1000 };
}

function sliceBuffer(buffer: AudioBuffer, from: number, to: number): AudioBuffer {
  const length = Math.max(1, to - from);
  const out = new AudioBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    out.copyToChannel(buffer.getChannelData(c).subarray(from, from + length), c);
  }
  return out;
}

/** 動画アイテムのフレームを、書き出しの時刻順にまとめてデコードする */
class VideoFrameProvider {
  private sinks = new Map<string, Promise<CanvasSink | null>>();
  private iterators = new Map<string, AsyncGenerator<WrappedCanvas | null, void, unknown>>();
  private inputs: Input[] = [];

  constructor(private fps: number) {}

  private sink(assetId: string): Promise<CanvasSink | null> {
    let p = this.sinks.get(assetId);
    if (!p) {
      p = (async () => {
        const blob = await media.blob(assetId);
        if (!blob) return null;
        const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
        this.inputs.push(input);
        const track = await input.getPrimaryVideoTrack();
        if (!track || !(await track.canDecode())) return null;
        return new CanvasSink(track, { poolSize: 2 });
      })();
      this.sinks.set(assetId, p);
    }
    return p;
  }

  async frame(item: VideoItem, frameIndex: number): Promise<Drawable | null> {
    let it = this.iterators.get(item.id);
    if (!it) {
      const sink = await this.sink(item.assetId);
      if (!sink) return null;
      const fps = this.fps;
      const endFrame = Math.ceil(itemEnd(item) * fps);
      const offset = item.sourceOffset - item.start;
      const times = function* () {
        for (let f = frameIndex; f < endFrame; f++) yield Math.max(0, f / fps + offset);
      };
      it = sink.canvasesAtTimestamps(times());
      this.iterators.set(item.id, it);
    }
    const next = await it.next();
    const wrapped = next.done ? null : next.value;
    if (!wrapped) return null;
    return { source: wrapped.canvas, width: wrapped.canvas.width, height: wrapped.canvas.height };
  }

  dispose() {
    for (const it of this.iterators.values()) void it.return(undefined);
    for (const input of this.inputs) input.dispose();
  }
}

/** 使ったVOICEVOX話者とキャラから、動画の説明欄に貼るクレジットを作る */
export function buildCredits(project: Project): string {
  const usedChars = new Set(project.items.filter((it) => it.kind === 'voice').map((it) => (it as { characterId: string }).characterId));
  const speakers = new Set<string>();
  for (const ch of project.characters) {
    if (usedChars.has(ch.id) && ch.voice.speakerId !== null && ch.voice.speakerName) speakers.add(ch.voice.speakerName);
  }
  const lines = [...speakers].map((name) => `VOICEVOX:${name}`);
  return lines.join('\n');
}
