// プロジェクトのデータモデル。時間はすべて秒、座標は出力解像度（例: 1920x1080、1080x1920）上のピクセル。

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
  /** 文字の影（null・未設定でなし） */
  shadow?: TextShadow | null;
  /** 文字の後ろの背景（帯）（null・未設定でなし） */
  background?: TextBackground | null;
}

export interface TextShadow {
  color: string;
  /** ぼかし（ピクセル） */
  blur: number;
  /** 影のずれ（ピクセル、右・下が正） */
  offsetX: number;
  offsetY: number;
}

export interface TextBackground {
  color: string;
  /** 不透明度 0〜1 */
  opacity: number;
  /** 文字のまわりの余白（ピクセル） */
  padding: number;
  /** 角の丸み（ピクセル） */
  radius: number;
}

/** 合成音声（VOICEVOX）の設定 */
export interface VoiceSettings {
  speakerId: number;
  /** クレジット表記用（例: ずんだもん） */
  speakerName: string;
  /** 一覧での表示名（例: ずんだもん（ノーマル）） */
  styleLabel: string;
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
}

/** 合成音声で作った音声アイテムが覚えておく情報（あとで文字を直して作り直せる） */
export interface TtsInfo extends VoiceSettings {
  text: string;
  /** 一緒に作った字幕（テキストアイテム）のID */
  subtitleId?: string | null;
}

export type SlideDirection = 'left' | 'right' | 'top' | 'bottom';

/** 映像エフェクト（画像・動画・テキスト）。未設定の項目は「なし」 */
export interface VisualEffects {
  /** ぼかしの強さ（画面上のピクセル、0でなし） */
  blur?: number;
  /** モザイクの1マスの大きさ（ピクセル、0でなし） */
  mosaic?: number;
  /** フェードイン・アウトの秒数 */
  fadeIn?: number;
  fadeOut?: number;
  /** 画面外からスライドして入ってくる */
  slideIn?: { direction: SlideDirection; duration: number } | null;
  /** 拡大縮小しながら入ってくる（from 倍の大きさから 1 倍へ） */
  zoomIn?: { from: number; duration: number } | null;
}

/** 音声エフェクト（音楽・動画の音声） */
export interface AudioEffects {
  /** 低音強化（dB、0でなし） */
  bass?: number;
  /** 元の音の代わりにピー音を鳴らす */
  beep?: boolean;
  /** ザーッというノイズを混ぜる量（0〜1） */
  noise?: number;
  /** 音量のフェードイン・アウトの秒数 */
  fadeIn?: number;
  fadeOut?: number;
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
  /** 回転（度、時計回り） */
  rotation?: number;
}

export interface TextItem extends ItemBase {
  kind: 'text';
  text: string;
  style: TextStyle;
  /** 回転（度、時計回り） */
  rotation?: number;
  effects?: VisualEffects;
}

export interface ImageItem extends ItemBase, Placement {
  kind: 'image';
  assetId: string;
  effects?: VisualEffects;
}

export interface VideoItem extends ItemBase, Placement {
  kind: 'video';
  assetId: string;
  sourceOffset: number;
  volume: number;
  effects?: VisualEffects;
  audioEffects?: AudioEffects;
}

export interface AudioItem extends ItemBase {
  kind: 'audio';
  assetId: string;
  sourceOffset: number;
  volume: number;
  audioEffects?: AudioEffects;
  /** 合成音声で作った音声なら、その読み上げ内容 */
  tts?: TtsInfo;
}

export type TimelineItem = TextItem | ImageItem | VideoItem | AudioItem;
export type ItemKind = TimelineItem['kind'];

export interface Project {
  version: 2;
  id: string;
  name: string;
  width: number;
  height: number;
  fps: number;
  backgroundColor: string;
  items: TimelineItem[];
  assets: Record<string, AssetMeta>;
  createdAt: number;
  updatedAt: number;
}
