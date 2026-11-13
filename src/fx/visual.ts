// 映像エフェクトの一覧（登録簿）。
import type { Fx } from '../types';
import { MOTION_FX } from './visualMotion';
import { BLEND_FX, SHADER_FX } from './visualShaders';
import type { VisualDef } from './visualTypes';

export const VISUAL_FX: VisualDef[] = [...MOTION_FX, ...SHADER_FX, BLEND_FX];

const byType = new Map(VISUAL_FX.map((d) => [d.type, d]));

export const visualDef = (type: string): VisualDef | undefined => byType.get(type);

/** 有効なエフェクトと、その定義 */
export function activeVisual(list: Fx[] | undefined): { fx: Fx; def: VisualDef }[] {
  const out: { fx: Fx; def: VisualDef }[] = [];
  for (const fx of list ?? []) {
    if (fx.off) continue;
    const def = byType.get(fx.type);
    if (def) out.push({ fx, def });
  }
  return out;
}

export * from './visualTypes';
