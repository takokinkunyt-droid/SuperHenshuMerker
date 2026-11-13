// エフェクトの設定項目（パラメーター）の型と、時刻ごとの値の計算。
// 数値の項目は「開始の値 → 終了の値」を指定すると、アイテムの長さに合わせて変化する（YMM4 の「移動」に相当）。
import type { AnimValue, Fx, FxValue } from '../types';

export type ParamDef =
  | { k: string; label: string; t: 'num'; def: number; min: number; max: number; step: number; unit?: string; anim?: boolean }
  | { k: string; label: string; t: 'color'; def: string }
  | { k: string; label: string; t: 'sel'; def: string; opts: [string, string][] }
  | { k: string; label: string; t: 'bool'; def: boolean };

/** 数値の項目（min〜max のスライダー） */
export const N = (k: string, label: string, def: number, min: number, max: number, step = 1, unit?: string): ParamDef => ({
  k,
  label,
  t: 'num',
  def,
  min,
  max,
  step,
  unit,
});
/** 途中で変化させない数値（効果時間など） */
export const NF = (k: string, label: string, def: number, min: number, max: number, step = 1, unit?: string): ParamDef => ({
  k,
  label,
  t: 'num',
  def,
  min,
  max,
  step,
  unit,
  anim: false,
});
export const C = (k: string, label: string, def: string): ParamDef => ({ k, label, t: 'color', def });
export const B = (k: string, label: string, def = false): ParamDef => ({ k, label, t: 'bool', def });
export const S = (k: string, label: string, def: string, opts: [string, string][]): ParamDef => ({ k, label, t: 'sel', def, opts });

// ---------------- イージング ----------------

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

export const EASES: Record<string, { label: string; f: (p: number) => number }> = {
  linear: { label: '直線', f: (p) => p },
  in: { label: '加速', f: (p) => p * p * p },
  out: { label: '減速', f: (p) => 1 - Math.pow(1 - p, 3) },
  inout: { label: '加減速', f: (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2) },
  back: { label: '行き過ぎて戻る', f: (p) => 1 + 2.70158 * Math.pow(p - 1, 3) + 1.70158 * Math.pow(p - 1, 2) },
  bounce: {
    label: 'バウンド',
    f: (p) => {
      const n = 7.5625;
      const d = 2.75;
      if (p < 1 / d) return n * p * p;
      if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
      if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
      return n * (p -= 2.625 / d) * p + 0.984375;
    },
  },
  elastic: {
    label: 'ばね',
    f: (p) => (p === 0 || p === 1 ? p : Math.pow(2, -10 * p) * Math.sin((p * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  },
};

export const EASE_OPTS: [string, string][] = Object.entries(EASES).map(([k, v]) => [k, v.label]);

export function ease(name: string | undefined, p: number): number {
  return (EASES[name ?? 'linear'] ?? EASES.linear).f(clamp01(p));
}

export const isAnim = (v: FxValue | undefined): v is AnimValue => typeof v === 'object' && v !== null;

export type Resolved = Record<string, number | string | boolean>;

/** アイテム内の時刻 local での各項目の値。保存されていない項目は既定値 */
export function resolveParams(fx: Fx, params: ParamDef[], local: number, duration: number): Resolved {
  const out: Resolved = {};
  const progress = duration > 0 ? clamp01(local / duration) : 0;
  for (const d of params) {
    const v = fx.p[d.k];
    if (v === undefined || v === null) out[d.k] = d.def;
    else if (isAnim(v)) out[d.k] = v.a + (v.b - v.a) * ease(v.ease, progress);
    else out[d.k] = v;
  }
  return out;
}

/** 新しく追加するエフェクトの初期値（既定値と違うものだけを保存するので空でよい） */
export function newFx(type: string, id: string, p: Record<string, FxValue> = {}): Fx {
  return { id, type, p };
}

// ---------------- 登場・退場で共通の項目 ----------------

/** 登場・退場エフェクトの共通項目：登場にかける時間、退場にかける時間、動き方 */
export const IO_PARAMS: ParamDef[] = [
  NF('tin', '登場の時間', 0.5, 0, 5, 0.05, '秒'),
  NF('tout', '退場の時間', 0.5, 0, 5, 0.05, '秒'),
  S('ease', '動き方', 'out', EASE_OPTS),
];

/**
 * 登場・退場の進み具合。0 = いつもの状態、1 = 完全に登場前／退場後。
 * 登場と退場が重なる短いアイテムでは大きい方を使う。
 */
export function ioAmount(p: Resolved, local: number, duration: number): number {
  const tin = Number(p.tin) || 0;
  const tout = Number(p.tout) || 0;
  const e = String(p.ease);
  let k = 0;
  if (tin > 0 && local < tin) k = Math.max(k, 1 - ease(e, local / tin));
  if (tout > 0 && duration - local < tout) k = Math.max(k, 1 - ease(e, (duration - local) / tout));
  return clamp01(k);
}

/** 色（#rrggbb）を 0〜1 の RGB にする */
export function rgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return [1, 1, 1];
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** 文字列から決まる乱数の種（同じアイテムは毎回同じ動きになる） */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

/** 0〜1 の決まった乱数 */
export function rand(n: number, seed: number): number {
  const x = Math.sin(n * 127.1 + seed * 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** なめらかに変わる乱数（-1〜1）。t が1進むごとに次の値へ移る */
export function smoothNoise(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const u = f * f * (3 - 2 * f);
  return (rand(i, seed) * (1 - u) + rand(i + 1, seed) * u) * 2 - 1;
}
