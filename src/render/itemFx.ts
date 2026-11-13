// アイテムに積まれた映像エフェクトから、「どう変形して描くか」と「描いたあとにかける加工」を計算する。
import type { Fx } from '../types';
import { resolveParams, type Resolved } from '../fx/params';
import { activeVisual, identityXForm, type FxCtx, type Uniforms, type VisualDef, type XForm } from '../fx/visual';
import type { Box } from './effects';

export interface FxStep {
  def: VisualDef;
  p: Resolved;
  extra: Uniforms;
}

export interface ItemFx {
  st: XForm;
  /** 描いた絵にかける加工（並び順のとおり） */
  steps: FxStep[];
}

export function computeFx(list: Fx[] | undefined, c: FxCtx, isText: boolean): ItemFx {
  const st = identityXForm();
  const steps: FxStep[] = [];
  for (const { fx, def } of activeVisual(list)) {
    if (def.textOnly && !isText) continue;
    const p = resolveParams(fx, def.params, c.local, c.dur);
    def.x?.(st, p, c);
    if (def.glsl) {
      const extra = def.u ? def.u(p, c) : {};
      if (extra) steps.push({ def, p, extra });
    }
  }
  return { st, steps };
}

/** 2次元の変形行列 [a, b, c, d, e, f]（Canvas の transform と同じ並び） */
export type Mat = [number, number, number, number, number, number];

const mul = (m: Mat, n: Mat): Mat => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

const rad = (deg: number) => (deg * Math.PI) / 180;

/** 外枠の中心（＋中心位置のずらし）を基準に、移動 → 回転 → 傾き → 拡大の順で変形する行列 */
export function fxMatrix(st: XForm, box: Box, rotation: number): Mat {
  const cx = box.x + box.w / 2 + st.ax;
  const cy = box.y + box.h / 2 + st.ay;
  const r = rad(rotation + st.rot);
  let m: Mat = [1, 0, 0, 1, st.dx + cx, st.dy + cy];
  if (r) m = mul(m, [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0]);
  if (st.skx || st.sky) m = mul(m, [1, Math.tan(rad(st.sky)), Math.tan(rad(st.skx)), 1, 0, 0]);
  if (st.sx !== 1 || st.sy !== 1) m = mul(m, [st.sx, 0, 0, st.sy, 0, 0]);
  return mul(m, [1, 0, 0, 1, -cx, -cy]);
}

/** 変形後の外枠を囲む、傾いていない四角 */
export function transformedBounds(m: Mat, box: Box): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const [px, py] of [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x, box.y + box.h],
    [box.x + box.w, box.y + box.h],
  ]) {
    const x = m[0] * px + m[2] * py + m[4];
    const y = m[1] * px + m[3] * py + m[5];
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const SHUFFLE_CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHJKLMNPQRSTUVWXYZ#$%&?';

/** テキストの文字を、割合 k だけ別の文字に入れ替える（時刻ごとに変わる） */
export function shuffleText(line: string, k: number, tick: number): string {
  if (k <= 0) return line;
  let out = '';
  let i = 0;
  for (const ch of line) {
    i++;
    const h = Math.sin(i * 12.9898 + tick * 78.233) * 43758.5453;
    const r = h - Math.floor(h);
    if (ch.trim() && r < k) {
      const h2 = Math.sin(i * 4.1 + tick * 1.7) * 9301.7;
      out += SHUFFLE_CHARS[Math.floor((h2 - Math.floor(h2)) * SHUFFLE_CHARS.length)];
    } else out += ch;
  }
  return out;
}
