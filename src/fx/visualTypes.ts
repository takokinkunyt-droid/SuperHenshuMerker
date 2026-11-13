// 映像エフェクトの定義の型。
// エフェクトは2種類ある：
//   x    … 位置・大きさ・回転・不透明度などを変える（描く前に計算する）
//   glsl … 描いた絵そのものを加工する（WebGL のシェーダー。並び順のとおりに重ねがけする）
import type { Box } from '../render/effects';
import type { ParamDef, Resolved } from './params';

export type VisualCat = 'inout' | 'anim' | 'draw' | 'filter' | 'deco' | 'comp' | 'camera' | 'layout';

export const VISUAL_CATS: [VisualCat, string][] = [
  ['inout', '登場退場'],
  ['anim', 'アニメーション'],
  ['draw', '描画'],
  ['filter', '加工'],
  ['deco', '装飾'],
  ['comp', '合成'],
  ['layout', '配置'],
  ['camera', 'カメラ'],
];

/** エフェクトを計算するときの状況 */
export interface FxCtx {
  /** アイテムの中での時刻（秒）と、アイテムの長さ */
  local: number;
  dur: number;
  /** エフェクトをかける前のアイテムの外枠（プロジェクト座標） */
  box: Box;
  /** 画面の大きさ（プロジェクト座標） */
  W: number;
  H: number;
  /** アイテムごとに決まる乱数の種 */
  seed: number;
}

/** 描く前に決める変形。すべてのエフェクトの結果を足し合わせる */
export interface XForm {
  dx: number;
  dy: number;
  sx: number;
  sy: number;
  /** 回転（度） */
  rot: number;
  /** 傾き（度） */
  skx: number;
  sky: number;
  alpha: number;
  /** 回転・拡大の中心を、外枠の中心からずらす量 */
  ax: number;
  ay: number;
  /** 重ね方（Canvas の globalCompositeOperation） */
  blend: GlobalCompositeOperation;
  /** テキストの文字を入れ替える割合（0〜1） */
  shuffle: number;
}

export const identityXForm = (): XForm => ({ dx: 0, dy: 0, sx: 1, sy: 1, rot: 0, skx: 0, sky: 0, alpha: 1, ax: 0, ay: 0, blend: 'source-over', shuffle: 0 });

export type Uniforms = Record<string, number | number[]>;

export interface VisualDef {
  type: string;
  /** YMM4 での名前に合わせた表示名 */
  name: string;
  cat: VisualCat;
  /** 検索用の別名 */
  kw?: string;
  params: ParamDef[];
  /** テキストだけに使える */
  textOnly?: boolean;
  x?: (st: XForm, p: Resolved, c: FxCtx) => void;
  /** `vec4 fx(vec2 uv)` を定義する GLSL。設定項目は `p_名前` で参照できる */
  glsl?: string;
  /** シェーダーを何回かけるか（ぼかしは縦・横の2回） */
  passes?: number;
  /** 追加で渡す値。null を返すと、この瞬間は何もしない */
  u?: (p: Resolved, c: FxCtx) => Uniforms | null;
}
