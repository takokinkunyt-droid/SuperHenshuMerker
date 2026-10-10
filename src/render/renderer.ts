// 1フレームを描く共通処理。プレビューと書き出しで同じ関数を使うので、見た目がずれない。
import type { Placement, Project, TextItem, TextStyle, TimelineItem, VideoItem, VisualEffects } from '../types';
import { isActiveAt } from '../state/timeline';
import { effectState, hasLayerEffect, placedBox, textBox, type Box } from './effects';

export interface Drawable {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/** 描画に必要な素材の取り出し口。プレビューと書き出しで中身を差し替える */
export interface FrameSource {
  image(assetId: string | null): Drawable | null;
  videoFrame(item: VideoItem, sourceTime: number): Drawable | null;
}

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export function visibleItems(project: Project, t: number): TimelineItem[] {
  return project.items
    .filter((it) => it.kind !== 'audio' && isActiveAt(it, t))
    .sort((a, b) => a.layer - b.layer || a.start - b.start);
}

/**
 * プロジェクトの時刻tの画面を描く。
 * @param scale 出力ピクセル／プロジェクト座標（プレビュー縮小や720p書き出しで使う）
 */
export function drawFrame(ctx: Ctx, project: Project, t: number, src: FrameSource, scale = 1): void {
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = project.backgroundColor;
  ctx.fillRect(0, 0, project.width, project.height);
  ctx.restore();

  for (const item of visibleItems(project, t)) {
    if (item.kind === 'audio') continue;
    // 素材と外枠を先に決める（スライド・拡大縮小の基準になる）
    let draw: (c: Ctx) => void;
    let box: Box;
    if (item.kind === 'text') {
      if (!item.text) continue;
      const lines = layoutText(ctx, item.text, item.style);
      box = textBox(item.style, lines.widths);
      draw = (c) => drawTextLines(c, lines.lines, item.style);
    } else {
      const d = item.kind === 'image' ? src.image(item.assetId) : src.videoFrame(item, t - item.start + item.sourceOffset);
      if (!d || item.opacity <= 0) continue;
      box = placedBox(item, d.width, d.height);
      draw = (c) => drawPlaced(c, d, item);
    }
    drawWithEffects(ctx, project, item.effects, t - item.start, item.duration, box, scale, item.rotation ?? 0, draw);
  }
}

/** エフェクト（フェード・スライド・拡大縮小・ぼかし・モザイク）をかけて1つのアイテムを描く */
function drawWithEffects(
  ctx: Ctx,
  project: Project,
  fx: VisualEffects | undefined,
  local: number,
  duration: number,
  box: Box,
  scale: number,
  rotation: number,
  draw: (c: Ctx) => void,
) {
  const st = effectState(fx, local, duration, box, project);
  if (st.alpha <= 0 || st.zoom <= 0) return;

  const layered = hasLayerEffect(fx);
  const target = layered ? scratch('item', ctx.canvas.width, ctx.canvas.height) : null;
  const c = target ? target.ctx : ctx;
  if (target) c.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  c.save();
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.translate(st.dx, st.dy);
  // 拡大縮小入場と回転は、どちらも外枠の中心を基準にする
  if (st.zoom !== 1 || rotation) {
    const cx = box.x + box.w / 2;
    const cy = box.y + box.h / 2;
    c.translate(cx, cy);
    if (rotation) c.rotate((rotation * Math.PI) / 180);
    if (st.zoom !== 1) c.scale(st.zoom, st.zoom);
    c.translate(-cx, -cy);
  }
  if (!target) c.globalAlpha = st.alpha;
  draw(c);
  c.restore();
  if (!target || !fx) return;

  // ぼかし・モザイクはアイテムだけを別のキャンバスに描いてから加工して重ねる
  let layer: AnyCanvas = target.canvas;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  if ((fx.mosaic ?? 0) > 0) {
    const block = Math.max(1, fx.mosaic! * scale);
    const sw = Math.max(1, Math.ceil(W / block));
    const sh = Math.max(1, Math.ceil(H / block));
    const small = scratch('mosaic-small', sw, sh);
    small.ctx.clearRect(0, 0, sw, sh);
    small.ctx.imageSmoothingEnabled = true;
    small.ctx.drawImage(layer, 0, 0, sw, sh);
    const big = scratch('mosaic', W, H);
    big.ctx.clearRect(0, 0, W, H);
    big.ctx.imageSmoothingEnabled = false;
    big.ctx.drawImage(small.canvas, 0, 0, sw * block, sh * block);
    layer = big.canvas;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = st.alpha;
  const blur = (fx.blur ?? 0) * scale;
  if (blur > 0 && supportsFilter(ctx)) {
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(layer, 0, 0);
  } else if (blur > 0) {
    // ctx.filter が使えないブラウザでは、縮小してから拡大してぼかす
    const k = Math.max(1, blur / 2);
    const sw = Math.max(1, Math.round(W / k));
    const sh = Math.max(1, Math.round(H / k));
    const small = scratch('blur-small', sw, sh);
    small.ctx.clearRect(0, 0, sw, sh);
    small.ctx.imageSmoothingEnabled = true;
    small.ctx.imageSmoothingQuality = 'high';
    small.ctx.drawImage(layer, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small.canvas, 0, 0, W, H);
  } else {
    ctx.drawImage(layer, 0, 0);
  }
  ctx.restore();
}

const scratches = new Map<string, { canvas: AnyCanvas; ctx: Ctx }>();

/** 作業用キャンバス（使い回す） */
function scratch(name: string, width: number, height: number) {
  let s = scratches.get(name);
  if (!s) {
    const canvas: AnyCanvas =
      typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : Object.assign(document.createElement('canvas'), { width, height });
    s = { canvas, ctx: canvas.getContext('2d') as Ctx };
    scratches.set(name, s);
  }
  if (s.canvas.width !== width || s.canvas.height !== height) {
    s.canvas.width = width;
    s.canvas.height = height;
  }
  return s;
}

let filterSupport: boolean | null = null;
function supportsFilter(ctx: Ctx): boolean {
  filterSupport ??= 'filter' in Object.getPrototypeOf(ctx);
  return filterSupport;
}

function drawPlaced(ctx: Ctx, d: Drawable, p: Placement) {
  const w = d.width * p.scale;
  const h = d.height * p.scale;
  ctx.globalAlpha *= Math.min(1, p.opacity);
  ctx.drawImage(d.source, p.x - w / 2, p.y - h / 2, w, h);
}

export function fontOf(style: TextStyle): string {
  return `${style.bold ? 'bold ' : ''}${style.fontSize}px ${style.fontFamily}`;
}

/** 改行と最大幅で行を分ける（日本語は1文字単位で折り返す） */
export function wrapLines(measure: (s: string) => number, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of [...para]) {
      if (line && measure(line + ch) > maxWidth) {
        out.push(line);
        line = ch;
      } else {
        line += ch;
      }
    }
    out.push(line);
  }
  return out;
}

/** テキストを行に分け、各行の幅を測る */
export function layoutText(ctx: Ctx, text: string, style: TextStyle) {
  ctx.save();
  ctx.font = fontOf(style);
  const lines = wrapLines((s) => ctx.measureText(s).width, text, style.maxWidth);
  const widths = lines.map((l) => ctx.measureText(l).width);
  ctx.restore();
  return { lines, widths };
}

/** テキストアイテムの外枠（プレビューでの吸着に使う） */
export function textItemBox(ctx: Ctx, item: TextItem): Box {
  return textBox(item.style, layoutText(ctx, item.text, item.style).widths);
}

function drawTextLines(ctx: Ctx, lines: string[], style: TextStyle) {
  ctx.font = fontOf(style);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const lineHeight = style.fontSize * 1.25;
  const descent = style.fontSize * 0.2;
  lines.forEach((line, i) => {
    const y = style.y - descent - (lines.length - 1 - i) * lineHeight;
    if (style.strokeWidth > 0) {
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth * 2;
      ctx.strokeText(line, style.x, y);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, style.x, y);
  });
}

/** エフェクトをかける前の、アイテムの外枠（吸着や整列に使う）。音声や読み込み前の素材は null */
export function itemBaseBox(item: TimelineItem, project: Project): Box | null {
  if (item.kind === 'text') return item.text ? textItemBox(scratch('measure', 1, 1).ctx, item) : null;
  if (item.kind === 'audio') return null;
  const asset = project.assets[item.assetId];
  if (!asset?.width || !asset.height) return null;
  return placedBox(item, asset.width, asset.height);
}

/** アイテムの位置（画像・動画は中心、テキストは中心と最終行の下端） */
export function itemPosition(item: TimelineItem): { x: number; y: number } | null {
  if (item.kind === 'image' || item.kind === 'video') return { x: item.x, y: item.y };
  if (item.kind === 'text') return { x: item.style.x, y: item.style.y };
  return null;
}
