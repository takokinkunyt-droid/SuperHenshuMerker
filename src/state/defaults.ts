import type { Character, Project, TextStyle } from '../types';

export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36);

/** レイヤーの既定の使い分け（番号が大きいほど手前に描画） */
export const LAYER = {
  background: 0,
  tachieBase: 1,
  voice: 5,
  text: 6,
  bgm: 7,
} as const;

export const MIN_LAYERS = 10;
export const MIN_ITEM_DURATION = 1 / 30;
/** セリフとセリフの間の既定の間 */
export const VOICE_GAP = 0.2;

export const FONT_FAMILIES = [
  'sans-serif',
  '"Hiragino Kaku Gothic ProN", "Yu Gothic", "Noto Sans JP", sans-serif',
  '"Hiragino Maru Gothic ProN", "BIZ UDPGothic", "Rounded Mplus 1c", sans-serif',
  '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", serif',
  'monospace',
];

export function defaultTextStyle(overrides: Partial<TextStyle> = {}): TextStyle {
  return {
    fontFamily: FONT_FAMILIES[1],
    fontSize: 64,
    bold: true,
    color: '#ffffff',
    strokeColor: '#202020',
    strokeWidth: 8,
    x: 960,
    y: 1030,
    maxWidth: 1600,
    ...overrides,
  };
}

const CHARACTER_COLORS = ['#4caf50', '#e91e63', '#2196f3', '#ff9800', '#9c27b0', '#00bcd4'];

export function createCharacter(name: string, index: number): Character {
  const color = CHARACTER_COLORS[index % CHARACTER_COLORS.length];
  // 2人目以降は左右に振り分ける
  const right = index % 2 === 0;
  return {
    id: uid(),
    name,
    color,
    voice: {
      speakerId: null,
      speakerName: '',
      speedScale: 1,
      pitchScale: 0,
      intonationScale: 1,
      volumeScale: 1,
    },
    tachie: {
      base: null,
      eyesOpen: null,
      eyesClosed: null,
      mouthClosed: null,
      mouthHalf: null,
      mouthOpen: null,
    },
    tachieX: right ? 1600 : 320,
    tachieY: 1080,
    tachieScale: 1,
    tachieFlip: false,
    subtitle: defaultTextStyle({ strokeColor: darken(color) }),
  };
}

function darken(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.45).toString(16).padStart(2, '0');
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

export function createProject(name = '新しいプロジェクト'): Project {
  const now = Date.now();
  return {
    version: 1,
    id: uid(),
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    backgroundColor: '#2a3a4a',
    characters: [createCharacter('キャラA', 0), createCharacter('キャラB', 1)],
    items: [],
    assets: {},
    createdAt: now,
    updatedAt: now,
  };
}
