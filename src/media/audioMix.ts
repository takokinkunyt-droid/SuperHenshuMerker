// 音を鳴らすアイテム（音楽・効果音・動画の音声）をAudioContextに並べる。
// プレビュー再生（AudioContext）と書き出し（OfflineAudioContext）で共通。
import type { AudioEffects, Project } from '../types';
import { itemEnd } from '../state/timeline';
import { media } from './mediaCache';

/** 低音強化で持ち上げる帯域（これより低い音） */
const BASS_FREQUENCY = 150;
/** ピー音の高さと大きさ */
const BEEP_FREQUENCY = 1000;
const BEEP_LEVEL = 0.25;
/** ノイズ量1のときの大きさ */
const NOISE_LEVEL = 0.35;

/** 音量の包絡線（フェードイン・アウト）。アイテム内の時刻 local での倍率 */
export function fadeEnvelope(fx: AudioEffects | undefined, local: number, duration: number): number {
  let g = 1;
  if (fx?.fadeIn && fx.fadeIn > 0) g *= Math.min(1, Math.max(0, local / fx.fadeIn));
  if (fx?.fadeOut && fx.fadeOut > 0) g *= Math.min(1, Math.max(0, (duration - local) / fx.fadeOut));
  return g;
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** ループ再生用のホワイトノイズ（2秒） */
function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseBuffers.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(ctx, buf);
  }
  return buf;
}

export function scheduleAudio(ctx: BaseAudioContext, project: Project, fromTime: number, when: number): AudioScheduledSourceNode[] {
  const nodes: AudioScheduledSourceNode[] = [];
  for (const item of project.items) {
    if (item.kind !== 'audio' && item.kind !== 'video') continue;
    const fx = item.audioEffects;
    if (item.volume <= 0 || itemEnd(item) <= fromTime) continue;
    const buffer = media.audioBuffer(item.assetId);
    const beep = !!fx?.beep;
    const noise = Math.max(0, fx?.noise ?? 0);
    // 鳴らすものが何も無ければ飛ばす
    if (!buffer && !beep && noise <= 0) continue;

    const skip = Math.max(0, fromTime - item.start);
    const sourceStart = item.sourceOffset + skip;
    // ピー音・ノイズはアイテムの長さいっぱい、元の音は素材の長さまで
    const length = buffer && !beep ? Math.min(item.duration - skip, buffer.duration - sourceStart) : item.duration - skip;
    if (length <= 0) continue;
    const startAt = when + Math.max(0, item.start - fromTime);
    const endAt = startAt + length;

    // 音量とフェード：区切り点の間を直線でつなぐと包絡線と一致する
    const out = ctx.createGain();
    const points = [skip, fx?.fadeIn ?? 0, item.duration - (fx?.fadeOut ?? 0), skip + length]
      .filter((p) => p >= skip && p <= skip + length)
      .sort((a, b) => a - b);
    points.forEach((p, i) => {
      const value = item.volume * fadeEnvelope(fx, p, item.duration);
      const at = startAt + (p - skip);
      if (i === 0) out.gain.setValueAtTime(value, at);
      else out.gain.linearRampToValueAtTime(value, at);
    });
    out.connect(ctx.destination);

    // 低音強化
    let input: AudioNode = out;
    if (fx?.bass && fx.bass > 0) {
      const shelf = ctx.createBiquadFilter();
      shelf.type = 'lowshelf';
      shelf.frequency.value = BASS_FREQUENCY;
      shelf.gain.value = fx.bass;
      shelf.connect(out);
      input = shelf;
    }

    if (beep) {
      // ピー音：元の音は鳴らさず、その間ずっと「ピー」を鳴らす
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = BEEP_FREQUENCY;
      const g = ctx.createGain();
      g.gain.value = BEEP_LEVEL;
      osc.connect(g).connect(input);
      osc.start(startAt);
      osc.stop(endAt);
      nodes.push(osc);
    } else if (buffer) {
      const node = ctx.createBufferSource();
      node.buffer = buffer;
      node.connect(input);
      node.start(startAt, sourceStart, length);
      nodes.push(node);
    }

    if (noise > 0) {
      const src = ctx.createBufferSource();
      src.buffer = noiseBuffer(ctx);
      src.loop = true;
      const g = ctx.createGain();
      g.gain.value = Math.min(1, noise) * NOISE_LEVEL;
      src.connect(g).connect(input);
      src.start(startAt);
      src.stop(endAt);
      nodes.push(src);
    }
  }
  return nodes;
}
