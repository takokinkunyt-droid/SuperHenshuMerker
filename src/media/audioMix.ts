// 音を鳴らすアイテム（音楽・効果音・動画の音声）をAudioContextに並べる。
// プレビュー再生（AudioContext）と書き出し（OfflineAudioContext）で共通。
//
// 短い素材はデコード済みの音声を1つのノードで鳴らす。
// 長い素材は10秒ずつのかたまり（mediaCache の AudioStream）を、必要になった分から順につないでいく。
import type { Project } from '../types';
import { itemEnd } from '../state/timeline';
import { buildAudioChain, ensureWorklets, hasWorklets, makesSound, type AudioEnv } from '../fx/audio';
import { CHUNK_SEC, MIX_SAMPLE_RATE, media } from './mediaCache';

/** 長い素材1つ分の「あとから音をつなぐ口」 */
export interface StreamFeed {
  assetId: string;
  input: AudioNode;
  /** 鳴り始めの時刻（ctx の時計）と、その時点での素材内の位置・鳴らす長さ */
  startAt: number;
  sourceStart: number;
  length: number;
  /** もうつないだ（または通り過ぎた）かたまりの番号 */
  done: Set<number>;
}

export interface Scheduled {
  ctx: BaseAudioContext;
  /** 止めるときに stop するノード */
  nodes: AudioScheduledSourceNode[];
  /** 止めるときに切り離す出口（エコーなどの余韻を残さない） */
  outs: AudioNode[];
  feeds: StreamFeed[];
}

/**
 * プロジェクトの fromTime 以降の音を、ctx の時刻 when から鳴るように並べる。
 * toTime を指定すると、それより後に始まるアイテムは並べない（書き出しを区切って行うとき用）。
 */
export function scheduleAudio(ctx: BaseAudioContext, project: Project, fromTime: number, when: number, toTime = Infinity): Scheduled {
  const sched: Scheduled = { ctx, nodes: [], outs: [], feeds: [] };
  for (const item of project.items) {
    if (item.kind !== 'audio' && item.kind !== 'video') continue;
    if (project.layers?.[item.layer]?.hidden) continue;
    if (item.volume <= 0 || itemEnd(item) <= fromTime || item.start >= toTime) continue;
    const buffer = media.audioBuffer(item.assetId);
    const stream = buffer ? null : media.stream(item.assetId);
    const sound = makesSound(item.afx);
    // 鳴らすものが何も無ければ飛ばす
    if (!buffer && !stream && !sound) continue;

    const skip = Math.max(0, fromTime - item.start);
    const sourceStart = item.sourceOffset + skip;
    const sourceLeft = (buffer?.duration ?? stream?.duration ?? 0) - sourceStart;
    const itemLeft = item.duration - skip;
    // 音波・ノイズはアイテムの長さいっぱい、元の音は素材の長さまで
    const length = sound ? itemLeft : Math.min(itemLeft, sourceLeft);
    if (length <= 0) continue;
    const startAt = when + Math.max(0, item.start - fromTime);
    const endAt = startAt + length;

    const out = ctx.createGain();
    out.gain.value = item.volume;
    out.connect(ctx.destination);
    sched.outs.push(out);

    const env: AudioEnv = { ctx, startAt, endAt, skip, dur: item.duration, sources: sched.nodes, worklets: hasWorklets(ctx) };
    const chain = buildAudioChain(item.afx, env);
    let input: AudioNode = out;
    if (chain) {
      chain.out.connect(out);
      input = chain.in;
    }

    const play = Math.min(length, sourceLeft);
    if (play <= 0) continue;
    if (buffer) {
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(input);
      node.start(startAt, sourceStart, play);
      sched.nodes.push(node);
    } else if (stream) {
      sched.feeds.push({ assetId: item.assetId, input, startAt, sourceStart, length: play, done: new Set() });
    }
  }
  return sched;
}

export interface ChunkRef {
  assetId: string;
  idx: number;
}

/**
 * 長い素材のかたまりのうち、ctx の時刻 horizon までに鳴り始めるものをつなぐ。
 * まだ読み込めていないかたまりを返す（読み込んでからもう一度呼ぶ）。
 */
export function pumpFeeds(sched: Scheduled, getChunk: (assetId: string, idx: number) => AudioBuffer | undefined, horizon: number): ChunkRef[] {
  const { ctx } = sched;
  const missing: ChunkRef[] = [];
  for (const feed of sched.feeds) {
    const sourceEnd = feed.sourceStart + feed.length;
    const last = Math.floor((sourceEnd - 1e-6) / CHUNK_SEC);
    for (let idx = Math.floor(feed.sourceStart / CHUNK_SEC); idx <= last; idx++) {
      if (feed.done.has(idx)) continue;
      const chunkStart = idx * CHUNK_SEC;
      const from = Math.max(chunkStart, feed.sourceStart);
      const to = Math.min(chunkStart + CHUNK_SEC, sourceEnd);
      let at = feed.startAt + (from - feed.sourceStart);
      if (at > horizon) break;
      const endAt = feed.startAt + (to - feed.sourceStart);
      if (endAt <= ctx.currentTime) {
        feed.done.add(idx); // もう通り過ぎた
        continue;
      }
      const buffer = getChunk(feed.assetId, idx);
      if (!buffer) {
        missing.push({ assetId: feed.assetId, idx });
        continue;
      }
      let offset = from - chunkStart;
      // 読み込みが間に合わなかったときは、途中から鳴らす
      const late = ctx.currentTime - at;
      if (late > 0) {
        offset += late + 0.02;
        at = ctx.currentTime + 0.02;
      }
      const duration = to - chunkStart - offset;
      feed.done.add(idx);
      if (duration <= 0) continue;
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(feed.input);
      node.start(at, offset, duration);
      sched.nodes.push(node);
    }
  }
  return missing;
}

/** 並べた音をすべて止める */
export function stopScheduled(sched: Scheduled | null) {
  if (!sched) return;
  for (const n of sched.nodes) {
    try {
      n.stop();
    } catch {
      // 開始前のノードは止める必要がない
    }
  }
  for (const o of sched.outs) o.disconnect();
  sched.nodes.length = 0;
  sched.outs.length = 0;
  sched.feeds.length = 0;
}

/** fromTime〜toTime の間に必要になる、長い素材のかたまりをすべて読み込む（書き出し用） */
export async function loadChunksFor(project: Project, fromTime: number, toTime: number): Promise<Map<string, AudioBuffer>> {
  const out = new Map<string, AudioBuffer>();
  for (const item of project.items) {
    if (item.kind !== 'audio' && item.kind !== 'video') continue;
    if (itemEnd(item) <= fromTime || item.start >= toTime) continue;
    const stream = media.stream(item.assetId);
    if (!stream) continue;
    const a = item.sourceOffset + Math.max(0, fromTime - item.start);
    const b = Math.min(stream.duration, item.sourceOffset + Math.min(item.duration, toTime - item.start));
    for (let idx = Math.floor(a / CHUNK_SEC); idx * CHUNK_SEC < b; idx++) {
      const key = `${item.assetId}:${idx}`;
      if (out.has(key)) continue;
      const buffer = await stream.load(idx);
      if (buffer) out.set(key, buffer);
    }
  }
  return out;
}

function sliceBuffer(buffer: AudioBuffer, from: number, to: number): AudioBuffer {
  const length = Math.max(1, to - from);
  const out = new AudioBuffer({ length, numberOfChannels: buffer.numberOfChannels, sampleRate: buffer.sampleRate });
  for (let c = 0; c < buffer.numberOfChannels; c++) out.copyToChannel(buffer.getChannelData(c).subarray(from, from + length), c);
  return out;
}

/** エコーなどの余韻が区切りで途切れないよう、区切りの少し手前から計算して、その分は捨てる */
const PREROLL_SEC = 3;

/**
 * 書き出し用に、プロジェクト全体の音を blockSec 秒ずつに区切ってミックスする。
 * 1時間の動画でも、メモリに置くのは1区間ぶんだけで済む。
 */
export class AudioMixer {
  readonly totalSamples: number;
  private blockSamples: number;
  private block: { start: number; buffer: AudioBuffer } | null = null;

  constructor(
    private project: Project,
    duration: number,
    blockSec: number,
  ) {
    this.totalSamples = Math.max(1, Math.ceil(duration * MIX_SAMPLE_RATE));
    this.blockSamples = Math.max(1, Math.round(blockSec * MIX_SAMPLE_RATE));
  }

  private async mix(startSample: number): Promise<{ start: number; buffer: AudioBuffer }> {
    const sr = MIX_SAMPLE_RATE;
    const length = Math.min(this.totalSamples, startSample + this.blockSamples) - startSample;
    const t0 = startSample / sr;
    const t1 = (startSample + length) / sr;
    const from = Math.max(0, t0 - PREROLL_SEC);
    const lead = Math.round((t0 - from) * sr);
    const offline = new OfflineAudioContext(2, lead + length, sr);
    await ensureWorklets(offline);
    const chunks = await loadChunksFor(this.project, from, t1);
    const sched = scheduleAudio(offline, this.project, from, 0, t1);
    pumpFeeds(sched, (id, idx) => chunks.get(`${id}:${idx}`), Infinity);
    const rendered = await offline.startRendering();
    return { start: startSample, buffer: lead ? sliceBuffer(rendered, lead, lead + length) : rendered };
  }

  /** from〜to（サンプル数）の音を、順番に並んだ AudioBuffer で返す。前から順に読むこと */
  async read(from: number, to: number): Promise<AudioBuffer[]> {
    const out: AudioBuffer[] = [];
    let pos = from;
    const end = Math.min(to, this.totalSamples);
    while (pos < end) {
      if (!this.block || pos < this.block.start || pos >= this.block.start + this.block.buffer.length) {
        this.block = await this.mix(Math.floor(pos / this.blockSamples) * this.blockSamples);
      }
      const stop = Math.min(end, this.block.start + this.block.buffer.length);
      out.push(sliceBuffer(this.block.buffer, pos - this.block.start, stop - this.block.start));
      pos = stop;
    }
    return out;
  }
}
