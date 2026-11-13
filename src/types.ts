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

/** 数値の項目を、アイテムの始まりから終わりにかけて a → b に変化させる */
export interface AnimValue {
  a: number;
  b: number;
  /** 変化のしかた（直線・加速・減速など）。未設定は直線 */
  ease?: string;
}

export type FxValue = number | string | boolean | AnimValue;

/**
 * アイテムに積むエフェクト1つ分。種類（type）ごとの定義は src/fx にある。
 * 並び順のとおりに上から適用される。
 */
export interface Fx {
  id: string;
  type: string;
  /** true で一時的に無効 */
  off?: boolean;
  /** 設定値（既定値のままの項目は保存しない） */
  p: Record<string, FxValue>;
}

/** レイヤーごとの状態 */
export interface LayerState {
  /** 非表示（映像は描かず、音も鳴らさない） */
  hidden?: boolean;
  /** ロック（選択・移動できない） */
  locked?: boolean;
  name?: string;
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
  /** 映像エフェクト */
  fx?: Fx[];
}

export interface ImageItem extends ItemBase, Placement {
  kind: 'image';
  assetId: string;
  fx?: Fx[];
}

export interface VideoItem extends ItemBase, Placement {
  kind: 'video';
  assetId: string;
  sourceOffset: number;
  volume: number;
  fx?: Fx[];
  /** 音声エフェクト */
  afx?: Fx[];
}

export interface AudioItem extends ItemBase {
  kind: 'audio';
  assetId: string;
  sourceOffset: number;
  volume: number;
  afx?: Fx[];
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
  /** レイヤーの表示・ロック・名前（キーはレイヤー番号） */
  layers?: Record<string, LayerState>;
  createdAt: number;
  updatedAt: number;
}
