// 口パク：音声の音量（RMS）を短い区間ごとに求め、しきい値で口の形を決める。音声の種類に関係なく使える。

export const ENVELOPE_RATE = 60; // 1秒あたりの区間数

export type MouthShape = 'closed' | 'half' | 'open';

/** チャンネルを平均したRMSを区間ごとに計算し、0〜1に正規化して返す */
export function computeEnvelope(channels: Float32Array[], sampleRate: number, rate = ENVELOPE_RATE): Float32Array {
  const length = channels[0]?.length ?? 0;
  const window = Math.max(1, Math.round(sampleRate / rate));
  const count = Math.ceil(length / window);
  const env = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const from = i * window;
    const to = Math.min(length, from + window);
    let sum = 0;
    for (const ch of channels) {
      for (let s = from; s < to; s++) sum += ch[s] * ch[s];
    }
    env[i] = Math.sqrt(sum / ((to - from) * channels.length));
  }
  // 大きな音の上位5%を1とみなす（突発的なノイズで全体が小さくならないように）
  const sorted = Array.from(env).filter((v) => v > 0).sort((a, b) => a - b);
  const ref = sorted.length ? sorted[Math.floor(sorted.length * 0.95)] : 0;
  if (ref > 0) for (let i = 0; i < count; i++) env[i] = Math.min(1, env[i] / ref);
  return env;
}

export function levelAt(env: Float32Array | undefined, t: number, rate = ENVELOPE_RATE): number {
  if (!env || t < 0) return 0;
  return env[Math.floor(t * rate)] ?? 0;
}

export function mouthFor(level: number): MouthShape {
  if (level > 0.45) return 'open';
  if (level > 0.15) return 'half';
  return 'closed';
}

/**
 * 目パチ：4秒ごとの区間の中で、キャラごとにずらした位置で0.12秒だけ目を閉じる。
 * 時刻から決まる値なので、プレビューと書き出しで同じ結果になる。
 */
export function isBlinking(t: number, seed: string): boolean {
  const period = 4;
  const segment = Math.floor(t / period);
  const offset = 0.5 + hash01(`${seed}:${segment}`) * 3;
  const local = t - segment * period - offset;
  return local >= 0 && local < 0.12;
}

function hash01(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}
