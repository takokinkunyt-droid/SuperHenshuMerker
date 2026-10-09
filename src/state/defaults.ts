import type { Project, TextStyle } from '../types';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/** レイヤーの既定の使い分け（番号が大きいほど手前に描画） */
export const LAYER = {
  visual: 0,
  text: 4,
  audio: 7,
} as const;

export const MIN_LAYERS = 10;
export const MIN_ITEM_DURATION = 1 / 30;

/** 画面の比率のプリセット（短い辺を1080にそろえる） */
export const ASPECTS = [
  { key: '16:9', label: '16:9（横長・YouTube）', width: 1920, height: 1080 },
  { key: '9:16', label: '9:16（縦長・ショート動画）', width: 1080, height: 1920 },
  { key: '1:1', label: '1:1（正方形）', width: 1080, height: 1080 },
] as const;

export type AspectKey = (typeof ASPECTS)[number]['key'];

export function aspectOf(width: number, height: number): AspectKey | null {
  return ASPECTS.find((a) => a.width === width && a.height === height)?.key ?? null;
}

export const FONT_FAMILIES = [
  'sans-serif',
  '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif',
  '"Hiragino Maru Gothic ProN", "BIZ UDPGothic", "Rounded Mplus 1c", sans-serif',
  '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
  'monospace',
];

/** 画面サイズに合わせたテキストの既定スタイル（画面の下寄り中央） */
export function defaultTextStyle(width: number, height: number, overrides: Partial<TextStyle> = {}): TextStyle {
  const short = Math.min(width, height);
  return {
    fontFamily: FONT_FAMILIES[1],
    fontSize: Math.round(short * 0.065),
    bold: true,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: Math.round(short * 0.007),
    x: Math.round(width / 2),
    y: Math.round(height * 0.88),
    maxWidth: Math.round(width * 0.85),
    ...overrides,
  };
}

export function createProject(name = '新しいプロジェクト', aspect: AspectKey = '16:9'): Project {
  const now = Date.now();
  const { width, height } = ASPECTS.find((a) => a.key === aspect) ?? ASPECTS[0];
  return {
    version: 2,
    id: uid(),
    name,
    width,
    height,
    fps: 30,
    backgroundColor: '#000000',
    items: [],
    assets: {},
    createdAt: now,
    updatedAt: now,
  };
}
