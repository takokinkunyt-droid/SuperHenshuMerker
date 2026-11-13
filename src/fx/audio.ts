// 音声エフェクトの一覧。1つのエフェクトは「入口と出口を持つ部品（Web Audio のノード）」を作る。
// アイテムの音は、積んだ順にこれらの部品を通ってから、アイテムの音量をかけて出力される。
import type { Fx } from '../types';
import { B, NF, S, resolveParams, type ParamDef, type Resolved } from './params';

export type AudioCat = 'basic' | 'fx' | 'voice' | 'filter';

export const AUDIO_CATS: [AudioCat, string][] = [
  ['basic', '基本'],
  ['fx', 'エフェクト'],
  ['voice', '声の加工'],
  ['filter', 'フィルター'],
];

/** 部品を作るときの状況 */
export interface AudioEnv {
  ctx: BaseAudioContext;
  /** 鳴り始め・鳴り終わりの時刻（ctx の時計） */
  startAt: number;
  endAt: number;
  /** 鳴り始めの時点での、アイテム内の時刻 */
  skip: number;
  /** アイテムの長さ */
  dur: number;
  /** あとで止めるノード（発振器など）を登録する */
  sources: AudioScheduledSourceNode[];
  /** AudioWorklet（audio-worklet.js）が読み込み済みか */
  worklets: boolean;
}

export interface AudioPart {
  in: AudioNode;
  out: AudioNode;
}

export interface AudioDef {
  type: string;
  name: string;
  cat: AudioCat;
  kw?: string;
  params: ParamDef[];
  build: (e: AudioEnv, p: Resolved) => AudioPart | null;
}

const num = (v: unknown) => Number(v) || 0;
const n = (k: string, label: string, def: number, min: number, max: number, step = 1, unit?: string) => NF(k, label, def, min, max, step, unit);

const single = (node: AudioNode): AudioPart => ({ in: node, out: node });

/** もとの音（dry）と加工した音（wet）を、それぞれの大きさで混ぜる */
function wetDry(e: AudioEnv, wetLevel: number, wet: (input: AudioNode, output: AudioNode) => void, dryLevel = 1): AudioPart {
  const input = e.ctx.createGain();
  const output = e.ctx.createGain();
  const dry = e.ctx.createGain();
  dry.gain.value = Math.min(1, Math.max(0, dryLevel));
  input.connect(dry).connect(output);
  const wetIn = e.ctx.createGain();
  const wetOut = e.ctx.createGain();
  wetOut.gain.value = Math.min(1, Math.max(0, wetLevel));
  input.connect(wetIn);
  wetOut.connect(output);
  wet(wetIn, wetOut);
  return { in: input, out: output };
}

/** ゆっくり揺れる信号（LFO）を作って target につなぐ */
function lfo(e: AudioEnv, rate: number, depth: number, target: AudioParam, type: OscillatorType = 'sine') {
  const osc = e.ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = rate;
  const g = e.ctx.createGain();
  g.gain.value = depth;
  osc.connect(g).connect(target);
  osc.start(e.startAt);
  osc.stop(e.endAt + 0.1);
  e.sources.push(osc);
}

function biquad(e: AudioEnv, type: BiquadFilterType, freq: number, q = 1, gain = 0): BiquadFilterNode {
  const f = e.ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = Math.min(e.ctx.sampleRate / 2 - 100, Math.max(10, freq));
  f.Q.value = q;
  f.gain.value = gain;
  return f;
}

function shaper(e: AudioEnv, f: (x: number) => number): WaveShaperNode {
  const ws = e.ctx.createWaveShaper();
  const curve = new Float32Array(2049);
  for (let i = 0; i < curve.length; i++) curve[i] = f((i / (curve.length - 1)) * 2 - 1);
  ws.curve = curve;
  ws.oversample = '2x';
  return ws;
}

function worklet(e: AudioEnv, name: string, options: Record<string, number>): AudioPart | null {
  if (!e.worklets || typeof AudioWorkletNode === 'undefined') return null;
  try {
    return single(new AudioWorkletNode(e.ctx, name, { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2], processorOptions: options }));
  } catch {
    return null;
  }
}

const noiseBuffers = new WeakMap<BaseAudioContext, AudioBuffer>();

/** ループ再生用のホワイトノイズ（2秒） */
function noiseSource(e: AudioEnv): AudioBufferSourceNode {
  let buf = noiseBuffers.get(e.ctx);
  if (!buf) {
    buf = e.ctx.createBuffer(1, e.ctx.sampleRate * 2, e.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    noiseBuffers.set(e.ctx, buf);
  }
  const src = e.ctx.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  src.start(e.startAt);
  src.stop(e.endAt + 0.1);
  e.sources.push(src);
  return src;
}

const impulses = new Map<string, AudioBuffer>();

/** 残響（リバーブ）用の、だんだん小さくなるノイズ */
function impulse(ctx: BaseAudioContext, seconds: number): AudioBuffer {
  const key = `${ctx.sampleRate}:${seconds.toFixed(2)}`;
  let buf = impulses.get(key);
  if (!buf) {
    const len = Math.max(1, Math.round(ctx.sampleRate * seconds));
    buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.5);
    }
    impulses.set(key, buf);
  }
  return buf;
}

/** 音量の包絡線（フェードイン・アウト）。アイテム内の時刻 local での倍率 */
export function fadeEnvelope(tin: number, tout: number, local: number, duration: number): number {
  let g = 1;
  if (tin > 0) g *= Math.min(1, Math.max(0, local / tin));
  if (tout > 0) g *= Math.min(1, Math.max(0, (duration - local) / tout));
  return g;
}

const FILTER = (type: string, name: string, kind: BiquadFilterType, freq: number, withQ: boolean, withGain: boolean, kw?: string): AudioDef => ({
  type,
  name,
  cat: 'filter',
  kw,
  params: [n('freq', '周波数', freq, 20, 20000, 10, 'Hz'), ...(withQ ? [n('q', '鋭さ（Q）', 1, 0.1, 30, 0.1)] : []), ...(withGain ? [n('gain', '増減', 6, -30, 30, 0.5, 'dB')] : [])],
  build: (e, p) => single(biquad(e, kind, num(p.freq), withQ ? num(p.q) : 0.707, withGain ? num(p.gain) : 0)),
});

const EQ_BANDS: [string, string, number][] = [
  ['b1', '100Hz（低音）', 100],
  ['b2', '400Hz', 400],
  ['b3', '1kHz（中音）', 1000],
  ['b4', '4kHz', 4000],
  ['b5', '10kHz（高音）', 10000],
];

export const AUDIO_FX: AudioDef[] = [
  // ---------------- 基本 ----------------
  {
    type: 'vol',
    name: '音量',
    cat: 'basic',
    params: [n('v', '音量', 100, 0, 400, 1, '%')],
    build: (e, p) => {
      const g = e.ctx.createGain();
      g.gain.value = num(p.v) / 100;
      return single(g);
    },
  },
  {
    type: 'volDb',
    name: '音量（dB）',
    cat: 'basic',
    params: [n('db', '音量', 0, -60, 24, 0.5, 'dB')],
    build: (e, p) => {
      const g = e.ctx.createGain();
      g.gain.value = Math.pow(10, num(p.db) / 20);
      return single(g);
    },
  },
  {
    type: 'pan',
    name: 'パン',
    cat: 'basic',
    kw: '左右 定位 ステレオ',
    params: [n('pan', '左 ↔ 右', 0, -100, 100, 1)],
    build: (e, p) => {
      if (!e.ctx.createStereoPanner) return null;
      const s = e.ctx.createStereoPanner();
      s.pan.value = num(p.pan) / 100;
      return single(s);
    },
  },
  {
    type: 'afade',
    name: 'フェードイン・アウト',
    cat: 'basic',
    params: [n('tin', 'フェードイン', 1, 0, 30, 0.1, '秒'), n('tout', 'フェードアウト', 1, 0, 30, 0.1, '秒')],
    build: (e, p) => {
      const g = e.ctx.createGain();
      const tin = num(p.tin);
      const tout = num(p.tout);
      const len = e.endAt - e.startAt;
      // 区切り点の間を直線でつなぐと包絡線と一致する
      const points = [e.skip, tin, e.dur - tout, e.skip + len].filter((t) => t >= e.skip && t <= e.skip + len).sort((a, b) => a - b);
      points.forEach((t, i) => {
        const v = fadeEnvelope(tin, tout, t, e.dur);
        const at = e.startAt + (t - e.skip);
        if (i === 0) g.gain.setValueAtTime(v, at);
        else g.gain.linearRampToValueAtTime(v, at);
      });
      return single(g);
    },
  },
  {
    type: 'mono',
    name: 'モノラル化',
    cat: 'basic',
    params: [],
    build: (e) => {
      const g = e.ctx.createGain();
      g.channelCount = 1;
      g.channelCountMode = 'explicit';
      g.channelInterpretation = 'speakers';
      return single(g);
    },
  },

  // ---------------- エフェクト ----------------
  {
    type: 'echo',
    name: 'エコー',
    cat: 'fx',
    kw: 'やまびこ 残響 こだま',
    params: [n('time', '間隔', 250, 10, 2000, 10, 'ミリ秒'), n('fb', 'くり返しの強さ', 45, 0, 95, 1, '%'), n('mix', '効果の量', 50, 0, 100, 1, '%')],
    build: (e, p) =>
      wetDry(e, num(p.mix) / 100, (input, output) => {
        const d = e.ctx.createDelay(2.1);
        d.delayTime.value = num(p.time) / 1000;
        const fb = e.ctx.createGain();
        fb.gain.value = Math.min(0.95, num(p.fb) / 100);
        input.connect(d);
        d.connect(fb).connect(d);
        d.connect(output);
      }),
  },
  {
    type: 'delay',
    name: 'ディレイ',
    cat: 'fx',
    kw: '遅延',
    params: [n('time', '遅らせる時間', 300, 0, 5000, 10, 'ミリ秒'), n('n', '回数', 1, 1, 6, 1, '回'), n('decay', '小さくなる割合', 50, 0, 100, 1, '%'), B('dry', 'もとの音も鳴らす', true)],
    build: (e, p) => {
      const input = e.ctx.createGain();
      const output = e.ctx.createGain();
      if (p.dry) input.connect(output);
      const count = Math.max(1, Math.round(num(p.n)));
      for (let i = 1; i <= count; i++) {
        const d = e.ctx.createDelay(Math.max(1, (num(p.time) / 1000) * count + 0.1));
        d.delayTime.value = (num(p.time) / 1000) * i;
        const g = e.ctx.createGain();
        g.gain.value = p.dry ? Math.pow(1 - num(p.decay) / 100, i) : Math.pow(1 - num(p.decay) / 100, i - 1);
        input.connect(d).connect(g).connect(output);
      }
      return { in: input, out: output };
    },
  },
  {
    type: 'reverb',
    name: 'リバーブ',
    cat: 'fx',
    kw: '残響 ホール お風呂 響き',
    params: [n('time', '響く長さ', 1.5, 0.1, 8, 0.1, '秒'), n('mix', '効果の量', 35, 0, 100, 1, '%')],
    build: (e, p) =>
      wetDry(e, num(p.mix) / 100, (input, output) => {
        const c = e.ctx.createConvolver();
        c.buffer = impulse(e.ctx, num(p.time));
        input.connect(c).connect(output);
      }),
  },
  {
    type: 'comp',
    name: 'コンプレッサー',
    cat: 'fx',
    kw: '音量をそろえる 圧縮',
    params: [n('th', 'しきい値', -24, -60, 0, 1, 'dB'), n('ratio', '圧縮の強さ', 4, 1, 20, 0.5), n('att', '効き始め', 5, 0, 200, 1, 'ミリ秒'), n('rel', '戻り', 150, 10, 1000, 10, 'ミリ秒'), n('gain', '持ち上げる量', 6, 0, 24, 0.5, 'dB')],
    build: (e, p) => {
      const c = e.ctx.createDynamicsCompressor();
      c.threshold.value = num(p.th);
      c.ratio.value = num(p.ratio);
      c.attack.value = num(p.att) / 1000;
      c.release.value = num(p.rel) / 1000;
      const g = e.ctx.createGain();
      g.gain.value = Math.pow(10, num(p.gain) / 20);
      c.connect(g);
      return { in: c, out: g };
    },
  },
  {
    type: 'limiter',
    name: 'リミッター',
    cat: 'fx',
    kw: '音割れ防止',
    params: [n('th', '上限', -3, -40, 0, 0.5, 'dB')],
    build: (e, p) => {
      const c = e.ctx.createDynamicsCompressor();
      c.threshold.value = num(p.th);
      c.knee.value = 0;
      c.ratio.value = 20;
      c.attack.value = 0.001;
      c.release.value = 0.08;
      return single(c);
    },
  },
  {
    type: 'expander',
    name: 'エクスパンダー',
    cat: 'fx',
    params: [n('th', 'しきい値', -35, -80, 0, 1, 'dB'), n('ratio', '強さ', 2, 1, 10, 0.1), n('att', '効き始め', 5, 0, 200, 1, 'ミリ秒'), n('rel', '戻り', 150, 10, 1000, 10, 'ミリ秒')],
    build: (e, p) => worklet(e, 'shm-dyn', { mode: 1, threshold: num(p.th), ratio: num(p.ratio), attack: num(p.att), release: num(p.rel) }),
  },
  {
    type: 'gate',
    name: 'ノイズゲート',
    cat: 'fx',
    kw: '小さい音を消す 雑音',
    params: [n('th', 'しきい値', -45, -80, 0, 1, 'dB'), n('att', '開く速さ', 3, 0, 200, 1, 'ミリ秒'), n('rel', '閉じる速さ', 120, 10, 1000, 10, 'ミリ秒')],
    build: (e, p) => worklet(e, 'shm-dyn', { mode: 0, threshold: num(p.th), ratio: 1, attack: num(p.att), release: num(p.rel) }),
  },
  {
    type: 'dist',
    name: 'ディストーション',
    cat: 'fx',
    kw: '歪み 音割れ',
    params: [n('drive', '歪みの強さ', 50, 0, 100, 1, '%'), n('level', '音量', 60, 0, 100, 1, '%')],
    build: (e, p) => {
      const k = 1 + (num(p.drive) / 100) * 40;
      const ws = shaper(e, (x) => Math.max(-1, Math.min(1, x * k)));
      const g = e.ctx.createGain();
      g.gain.value = num(p.level) / 100;
      ws.connect(g);
      return { in: ws, out: g };
    },
  },
  {
    type: 'tube',
    name: 'チューブディストーション',
    cat: 'fx',
    kw: '真空管 あたたかい歪み',
    params: [n('drive', '歪みの強さ', 50, 0, 100, 1, '%'), n('level', '音量', 80, 0, 100, 1, '%')],
    build: (e, p) => {
      const k = 1 + (num(p.drive) / 100) * 12;
      const ws = shaper(e, (x) => (x >= 0 ? Math.tanh(x * k) : Math.tanh(x * k * 0.6) * 0.9) / Math.tanh(k));
      const g = e.ctx.createGain();
      g.gain.value = num(p.level) / 100;
      ws.connect(g);
      return { in: ws, out: g };
    },
  },
  {
    type: 'tremolo',
    name: 'トレモロ',
    cat: 'fx',
    kw: '音量の揺れ',
    params: [n('rate', '揺れの速さ', 6, 0.1, 40, 0.1, '回/秒'), n('depth', '揺れの深さ', 60, 0, 100, 1, '%')],
    build: (e, p) => {
      const g = e.ctx.createGain();
      const d = num(p.depth) / 200;
      g.gain.value = 1 - d;
      lfo(e, num(p.rate), d, g.gain);
      return single(g);
    },
  },
  {
    type: 'vibrato',
    name: 'ビブラート',
    cat: 'fx',
    kw: '音程の揺れ',
    params: [n('rate', '揺れの速さ', 6, 0.1, 20, 0.1, '回/秒'), n('depth', '揺れの深さ', 3, 0, 20, 0.1, 'ミリ秒')],
    build: (e, p) => {
      const d = e.ctx.createDelay(0.1);
      d.delayTime.value = 0.025;
      lfo(e, num(p.rate), Math.min(0.024, num(p.depth) / 1000), d.delayTime);
      return single(d);
    },
  },
  {
    type: 'flanger',
    name: 'フランジャー',
    cat: 'fx',
    kw: 'ジェット うねり',
    params: [n('rate', 'うねりの速さ', 0.4, 0.05, 10, 0.05, '回/秒'), n('depth', '深さ', 3, 0, 10, 0.1, 'ミリ秒'), n('fb', 'くせの強さ', 50, 0, 90, 1, '%'), n('mix', '効果の量', 50, 0, 100, 1, '%')],
    build: (e, p) =>
      wetDry(e, num(p.mix) / 100, (input, output) => {
        const d = e.ctx.createDelay(0.05);
        d.delayTime.value = 0.005 + num(p.depth) / 1000;
        lfo(e, num(p.rate), num(p.depth) / 1000, d.delayTime);
        const fb = e.ctx.createGain();
        fb.gain.value = num(p.fb) / 100;
        input.connect(d);
        d.connect(fb).connect(d);
        d.connect(output);
      }),
  },
  {
    type: 'chorus',
    name: 'コーラス',
    cat: 'fx',
    kw: '厚み 広がり',
    params: [n('rate', '揺れの速さ', 1.2, 0.05, 10, 0.05, '回/秒'), n('depth', '深さ', 4, 0, 15, 0.1, 'ミリ秒'), n('mix', '効果の量', 50, 0, 100, 1, '%')],
    build: (e, p) =>
      wetDry(e, num(p.mix) / 100, (input, output) => {
        for (const [base, mult] of [
          [0.02, 1],
          [0.03, 1.3],
        ]) {
          const d = e.ctx.createDelay(0.1);
          d.delayTime.value = base;
          lfo(e, num(p.rate) * mult, num(p.depth) / 1000, d.delayTime);
          input.connect(d).connect(output);
        }
      }),
  },
  {
    type: 'phaser',
    name: 'フェイザー',
    cat: 'fx',
    kw: 'シュワシュワ',
    params: [n('rate', 'うねりの速さ', 0.5, 0.05, 10, 0.05, '回/秒'), n('depth', '深さ', 70, 0, 100, 1, '%'), n('mix', '効果の量', 50, 0, 100, 1, '%')],
    build: (e, p) =>
      wetDry(e, num(p.mix) / 100, (input, output) => {
        let node: AudioNode = input;
        for (let i = 0; i < 4; i++) {
          const f = biquad(e, 'allpass', 1000, 0.7);
          lfo(e, num(p.rate), 800 * (num(p.depth) / 100), f.frequency);
          node.connect(f);
          node = f;
        }
        node.connect(output);
      }),
  },
  {
    type: 'wah',
    name: 'ワウワウ',
    cat: 'fx',
    params: [n('rate', '速さ', 2, 0.1, 20, 0.1, '回/秒'), n('lo', '低い方', 400, 100, 4000, 10, 'Hz'), n('hi', '高い方', 2200, 200, 8000, 10, 'Hz'), n('q', '鋭さ', 4, 0.5, 20, 0.5)],
    build: (e, p) => {
      const lo = Math.min(num(p.lo), num(p.hi));
      const hi = Math.max(num(p.lo), num(p.hi));
      const f = biquad(e, 'bandpass', (lo + hi) / 2, num(p.q));
      lfo(e, num(p.rate), (hi - lo) / 2, f.frequency);
      const g = e.ctx.createGain();
      g.gain.value = 2;
      f.connect(g);
      return { in: f, out: g };
    },
  },
  {
    type: 'autoWah',
    name: 'オートワウ',
    cat: 'fx',
    params: [n('rate', '速さ', 5, 0.1, 20, 0.1, '回/秒'), n('depth', '深さ', 70, 0, 100, 1, '%')],
    build: (e, p) => {
      const f = biquad(e, 'lowpass', 1500, 5);
      lfo(e, num(p.rate), 1200 * (num(p.depth) / 100), f.frequency, 'triangle');
      return single(f);
    },
  },
  {
    type: 'noise',
    name: 'ノイズ',
    cat: 'fx',
    kw: 'ザー 雑音 砂嵐',
    params: [n('amt', 'ノイズの量', 30, 0, 100, 1, '%'), S('color', '種類', 'white', [['white', 'ホワイト（ザー）'], ['low', 'こもった音（ゴー）'], ['high', '高い音（シャー）']])],
    build: (e, p) => {
      const pass = e.ctx.createGain();
      const g = e.ctx.createGain();
      g.gain.value = (num(p.amt) / 100) * 0.35;
      let src: AudioNode = noiseSource(e);
      if (p.color !== 'white') {
        const f = biquad(e, p.color === 'low' ? 'lowpass' : 'highpass', p.color === 'low' ? 500 : 4000);
        src.connect(f);
        src = f;
      }
      src.connect(g).connect(pass);
      return single(pass);
    },
  },
  {
    type: 'tone',
    name: '音波',
    cat: 'fx',
    kw: 'ピー音 自主規制 ビープ 伏せ音',
    params: [
      n('freq', '高さ', 1000, 50, 8000, 10, 'Hz'),
      S('wave', '音の形', 'sine', [['sine', 'ピー（正弦波）'], ['square', 'ブー（矩形波）'], ['sawtooth', 'ギー（のこぎり波）'], ['triangle', 'ポー（三角波）']]),
      n('level', '大きさ', 25, 0, 100, 1, '%'),
      B('mute', 'もとの音を消す', true),
    ],
    build: (e, p) => {
      const input = e.ctx.createGain();
      const output = e.ctx.createGain();
      if (!p.mute) input.connect(output);
      else {
        // 入口をどこにもつながないと前の部品が止まってしまうことがあるので、音量0でつないでおく
        const z = e.ctx.createGain();
        z.gain.value = 0;
        input.connect(z).connect(output);
      }
      const osc = e.ctx.createOscillator();
      osc.type = p.wave as OscillatorType;
      osc.frequency.value = num(p.freq);
      const g = e.ctx.createGain();
      g.gain.value = num(p.level) / 100;
      osc.connect(g).connect(output);
      osc.start(e.startAt);
      osc.stop(e.endAt);
      e.sources.push(osc);
      return { in: input, out: output };
    },
  },
  {
    type: 'lofi',
    name: '低音質化',
    cat: 'fx',
    kw: '電話 ラジオ トランシーバー 無線 レトロ',
    params: [n('rate', '音の細かさ', 8000, 500, 44100, 100, 'Hz'), n('bits', 'ビット数', 8, 1, 16, 1, 'bit'), B('band', '電話のように帯域をせばめる', true)],
    build: (e, p) => {
      const input = e.ctx.createGain();
      let node: AudioNode = input;
      if (p.band) {
        const hp = biquad(e, 'highpass', 300);
        const lp = biquad(e, 'lowpass', 3400);
        node.connect(hp).connect(lp);
        node = lp;
      }
      const crush = worklet(e, 'shm-crush', { bits: num(p.bits), rate: num(p.rate) });
      if (crush) {
        node.connect(crush.in);
        node = crush.out;
      } else {
        // AudioWorklet が使えない環境では、段々の波形にするだけ
        const steps = Math.pow(2, Math.max(1, num(p.bits)) - 1);
        const ws = shaper(e, (x) => Math.round(x * steps) / steps);
        node.connect(ws);
        node = ws;
      }
      return { in: input, out: node };
    },
  },
  {
    type: 'stutter',
    name: '瞬間ループ',
    cat: 'fx',
    kw: 'スタッター どもり リピート',
    params: [n('len', 'くり返す長さ', 100, 10, 1000, 5, 'ミリ秒'), n('rep', 'くり返す回数', 3, 1, 16, 1, '回'), n('int', '間隔', 1000, 50, 10000, 50, 'ミリ秒')],
    build: (e, p) => worklet(e, 'shm-stutter', { length: num(p.len), repeats: num(p.rep), interval: num(p.int) }),
  },
  {
    type: 'bass',
    name: '低音強化',
    cat: 'fx',
    kw: 'ベースブースト 重低音',
    params: [n('gain', '強さ', 8, 0, 24, 0.5, 'dB'), n('freq', 'どこから下を上げるか', 150, 40, 500, 5, 'Hz')],
    build: (e, p) => single(biquad(e, 'lowshelf', num(p.freq), 1, num(p.gain))),
  },

  // ---------------- 声の加工 ----------------
  {
    type: 'pitch',
    name: '音程',
    cat: 'voice',
    kw: 'ピッチ 高さ キー ボイスチェンジャー',
    params: [n('semi', '高さ', 3, -24, 24, 0.5, '半音')],
    build: (e, p) => (num(p.semi) === 0 ? null : worklet(e, 'shm-pitch', { semitones: num(p.semi) })),
  },
  {
    type: 'robot',
    name: 'ロボット化',
    cat: 'voice',
    kw: '機械 ロボ声',
    params: [n('freq', '機械っぽさ', 50, 10, 400, 1, 'Hz'), n('mix', '効果の量', 100, 0, 100, 1, '%')],
    build: (e, p) =>
      wetDry(e, num(p.mix) / 100, (input, output) => {
        // 一定の高さの音を掛け合わせる（リング変調）
        const ring = e.ctx.createGain();
        ring.gain.value = 0;
        lfo(e, num(p.freq), 1, ring.gain);
        const boost = e.ctx.createGain();
        boost.gain.value = 1.6;
        input.connect(ring).connect(boost).connect(output);
      }, 1 - num(p.mix) / 100),
  },
  {
    type: 'whisper',
    name: 'ウィスパー',
    cat: 'voice',
    kw: 'ささやき 息',
    params: [n('mix', '効果の量', 100, 0, 100, 1, '%')],
    build: (e, p) =>
      wetDry(e, num(p.mix) / 100, (input, output) => {
        // 声にノイズを掛け合わせて、息だけの声のようにする
        const ring = e.ctx.createGain();
        ring.gain.value = 0;
        const g = e.ctx.createGain();
        g.gain.value = 2.5;
        noiseSource(e).connect(g).connect(ring.gain);
        const hp = biquad(e, 'highpass', 500);
        input.connect(ring).connect(hp).connect(output);
      }, 1 - num(p.mix) / 100),
  },
  {
    type: 'growl',
    name: 'グロウル',
    cat: 'voice',
    kw: 'デスボイス うなり声 ダミ声',
    params: [n('freq', 'うなりの速さ', 70, 20, 200, 1, 'Hz'), n('depth', '深さ', 70, 0, 100, 1, '%'), n('semi', '声の低さ', -3, -12, 0, 0.5, '半音')],
    build: (e, p) => {
      const input = e.ctx.createGain();
      let node: AudioNode = input;
      const shift = num(p.semi) !== 0 ? worklet(e, 'shm-pitch', { semitones: num(p.semi) }) : null;
      if (shift) {
        node.connect(shift.in);
        node = shift.out;
      }
      const am = e.ctx.createGain();
      const d = num(p.depth) / 200;
      am.gain.value = 1 - d;
      lfo(e, num(p.freq), d, am.gain, 'sawtooth');
      const ws = shaper(e, (x) => Math.tanh(x * 4) / Math.tanh(4));
      node.connect(am).connect(ws);
      return { in: input, out: ws };
    },
  },
  {
    type: 'falsetto',
    name: 'ファルセット',
    cat: 'voice',
    kw: '裏声 高い声',
    params: [n('semi', '高さ', 7, 0, 24, 0.5, '半音')],
    build: (e, p) => {
      const shift = worklet(e, 'shm-pitch', { semitones: num(p.semi) });
      if (!shift) return null;
      const hp = biquad(e, 'highpass', 250);
      const lp = biquad(e, 'lowpass', 6000);
      shift.out.connect(hp).connect(lp);
      return { in: shift.in, out: lp };
    },
  },

  // ---------------- フィルター ----------------
  {
    type: 'eq',
    name: 'イコライザー',
    cat: 'filter',
    kw: 'EQ 音質',
    params: EQ_BANDS.map(([k, label]) => n(k, label, 0, -24, 24, 0.5, 'dB')),
    build: (e, p) => {
      const input = e.ctx.createGain();
      let node: AudioNode = input;
      for (const [k, , freq] of EQ_BANDS) {
        if (!num(p[k])) continue;
        const f = biquad(e, 'peaking', freq, 1, num(p[k]));
        node.connect(f);
        node = f;
      }
      return { in: input, out: node };
    },
  },
  FILTER('lowpass', 'ローパスフィルタ', 'lowpass', 1000, true, false, 'こもらせる 壁越し 水中'),
  FILTER('highpass', 'ハイパスフィルタ', 'highpass', 300, true, false, '低音カット'),
  FILTER('bandpass', 'バンドパスフィルタ', 'bandpass', 1000, true, false),
  FILTER('notch', 'ノッチフィルタ', 'notch', 1000, true, false, '特定の音を消す'),
  FILTER('peak', 'ピークフィルタ', 'peaking', 1000, true, true),
  FILTER('lowshelf', 'ローシェルフフィルタ', 'lowshelf', 200, false, true),
  FILTER('highshelf', 'ハイシェルフフィルタ', 'highshelf', 4000, false, true),
];

const byType = new Map(AUDIO_FX.map((d) => [d.type, d]));

export const audioDef = (type: string): AudioDef | undefined => byType.get(type);

/**
 * アイテムの音声エフェクトを順につないだ部品を作る。エフェクトが無ければ null。
 * （数値は途中で変化させず、設定した値をそのまま使う）
 */
export function buildAudioChain(list: Fx[] | undefined, e: AudioEnv): AudioPart | null {
  let first: AudioNode | null = null;
  let last: AudioNode | null = null;
  for (const fx of list ?? []) {
    if (fx.off) continue;
    const def = byType.get(fx.type);
    if (!def) continue;
    const part = def.build(e, resolveParams(fx, def.params, 0, e.dur));
    if (!part) continue;
    if (last) last.connect(part.in);
    else first = part.in;
    last = part.out;
  }
  return first && last ? { in: first, out: last } : null;
}

/** もとの音が無くても鳴るエフェクト（音波・ノイズ）が付いているか */
export function makesSound(list: Fx[] | undefined): boolean {
  return !!list?.some((f) => !f.off && (f.type === 'tone' || f.type === 'noise'));
}

const workletLoads = new WeakMap<BaseAudioContext, Promise<boolean>>();
const workletReady = new WeakSet<BaseAudioContext>();

/** audio-worklet.js を読み込む（ctx ごとに1回）。使えない環境では false */
export function ensureWorklets(ctx: BaseAudioContext): Promise<boolean> {
  let p = workletLoads.get(ctx);
  if (!p) {
    p = (async () => {
      try {
        if (!ctx.audioWorklet) return false;
        await ctx.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio-worklet.js`);
        workletReady.add(ctx);
        return true;
      } catch (err) {
        console.warn('一部の音声エフェクト（AudioWorklet）が使えません', err);
        return false;
      }
    })();
    workletLoads.set(ctx, p);
  }
  return p;
}

export const hasWorklets = (ctx: BaseAudioContext) => workletReady.has(ctx);
