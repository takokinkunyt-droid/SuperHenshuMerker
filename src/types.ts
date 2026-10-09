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
