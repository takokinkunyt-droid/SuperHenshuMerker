// プロジェクトのデータモデル。時間はすべて秒、座標は出力解像度（既定1920x1080）上のピクセル。

export type AssetKind = 'image' | 'video' | 'audio';

export interface AssetMeta {
  id: string;
  name: string;
  kind: AssetKind;
  mime: string;
  size: number;
  /** 動画・音声の長さ */
  duration?: number;
  width?: number;
  height?: number;
}

export interface TextStyle {
  fontFamily: string;
  fontSize: number;
  bold: boolean;
  color: string;
  strokeColor: string;
  strokeWidth: number;
  /** 文字の中心位置 */
  x: number;
  /** 最終行の下端位置 */
  y: number;
  /** この幅を超えたら折り返す */
  maxWidth: number;
}

export interface VoiceSettings {
  /** VOICEVOXのスタイルID。未設定なら音声ファイル読み込みのみ */
  speakerId: number | null;
  /** クレジット表記用（例: ずんだもん） */
  speakerName: string;
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
}

/** 同じサイズの透過PNGパーツを重ねて立ち絵を作る */
export interface TachieParts {
  base: string | null;
  eyesOpen: string | null;
  eyesClosed: string | null;
  mouthClosed: string | null;
  mouthHalf: string | null;
  mouthOpen: string | null;
}

export interface Character {
  id: string;
  name: string;
  color: string;
  voice: VoiceSettings;
  tachie: TachieParts;
  /** 立ち絵の中心X・下端Y・拡大率 */
  tachieX: number;
  tachieY: number;
  tachieScale: number;
  tachieFlip: boolean;
  subtitle: TextStyle;
}

interface ItemBase {
  id: string;
  layer: number;
  start: number;
  duration: number;
}

export interface Placement {
  x: number;
  y: number;
  scale: number;
  opacity: number;
}

export interface VoiceItem extends ItemBase {
  kind: 'voice';
  characterId: string;
  text: string;
  audioAssetId: string | null;
  /** 音声の出どころ。VOICEVOXで作った音声だけ、セリフ変更時に作り直す */
  audioOrigin?: 'voicevox' | 'file';
  /** 音声素材のどこから再生するか（分割時に使う） */
  audioOffset: number;
  volume: number;
  showSubtitle: boolean;
}

export interface TachieItem extends ItemBase {
  kind: 'tachie';
  characterId: string;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  text: string;
  style: TextStyle;
}

export interface ImageItem extends ItemBase, Placement {
  kind: 'image';
  assetId: string;
}

export interface VideoItem extends ItemBase, Placement {
  kind: 'video';
  assetId: string;
  sourceOffset: number;
  volume: number;
}

export interface AudioItem extends ItemBase {
  kind: 'audio';
  assetId: string;
  sourceOffset: number;
  volume: number;
}

export type TimelineItem = VoiceItem | TachieItem | TextItem | ImageItem | VideoItem | AudioItem;
export type ItemKind = TimelineItem['kind'];

export interface Project {
  version: 1;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  characters: Character[];
  items: TimelineItem[];
  assets: Record<string, AssetMeta>;
  createdAt: number;
  updatedAt: number;
}
