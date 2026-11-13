// 1フレームを描く共通処理。プレビューと書き出しで同じ関数を使うので、見た目がずれない。
import type { Placement, Project, TextItem, TextStyle, TimelineItem, VideoItem } from '../types';
import { isActiveAt } from '../state/timeline';
import { expandBox, placedBox, textBox, textGlyphBox, type Box } from './effects';
import { computeFx, fxMatrix, shuffleText, transformedBounds, type ItemFx } from './itemFx';
import { runShaders, shadersAvailable } from '../fx/glRunner';
import { seedOf } from '../fx/params';

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
    .filter((it) => it.kind !== 'audio' && isActiveAt(it, t) && !project.layers?.[it.layer]?.hidden)
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
    const local = t - item.start;
    // 素材と外枠を先に決める（エフェクトの基準になる）
    let draw: (c: Ctx, fx: ItemFx) => void;
    let box: Box;
    if (item.kind === 'text') {
      if (!item.text) continue;
      const lines = layoutText(ctx, item.text, item.style);
      box = textBox(item.style, lines.widths);
      draw = (c, fx) => {
        const tick = Math.floor(local * 20);
        const shown = fx.st.shuffle > 0 ? lines.lines.map((l, i) => shuffleText(l, fx.st.shuffle, tick + i * 7)) : lines.lines;
        drawTextLines(c, shown, lines.widths, item.style);
      };
    } else {
      const d = item.kind === 'image' ? src.image(item.assetId) : src.videoFrame(item, local + item.sourceOffset);
      if (!d || item.opacity <= 0) continue;
      box = placedBox(item, d.width, d.height);
      draw = (c) => drawPlaced(c, d, item);
    }
    const fx = computeFx(item.fx, { local, dur: item.duration, box, W: project.width, H: project.height, seed: seedOf(item.id) }, item.kind === 'text');
    drawWithEffects(ctx, fx, local, item.duration, box, scale, item.rotation ?? 0, seedOf(item.id), draw);
  }
}

/** エフェクトをかけて1つのアイテムを描く */
function drawWithEffects(
  ctx: Ctx,
  fx: ItemFx,
  local: number,
  duration: number,
  box: Box,
  scale: number,
  rotation: number,
  seed: number,
  draw: (c: Ctx, fx: ItemFx) => void,
) {
  const { st, steps } = fx;
  if (st.alpha <= 0 || st.sx === 0 || st.sy === 0) return;
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;

  // 絵を加工するエフェクトがあるときは、アイテムだけを別のキャンバスに描いてから加工して重ねる
  const layered = steps.length > 0 && shadersAvailable();
  const target = layered ? scratch('item', W, H) : null;
  const c = target ? target.ctx : ctx;
  if (target) c.clearRect(0, 0, W, H);

  const m = fxMatrix(st, box, rotation);
  c.save();
  c.setTransform(scale, 0, 0, scale, 0, 0);
  c.transform(...m);
  if (!target) {
    c.globalAlpha = Math.min(1, st.alpha);
    c.globalCompositeOperation = st.blend;
  }
  draw(c, fx);
  c.restore();
  if (!target) return;

  const b = transformedBounds(m, box);
  const out = runShaders(target.canvas, W, H, steps, {
    k: scale,
    t: local,
    d: duration,
    seed,
    box: [(b.x * scale) / W, (b.y * scale) / H, (b.w * scale) / W, (b.h * scale) / H],
  });
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = Math.min(1, st.alpha);
  ctx.globalCompositeOperation = st.blend;
  ctx.drawImage(out ?? target.canvas, 0, 0);
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

function drawTextLines(ctx: Ctx, lines: string[], widths: number[], style: TextStyle) {
  // 背景（帯）：文字の外枠に余白を足した角丸の四角
  const bg = style.background;
  if (bg && bg.opacity > 0) {
    const b = expandBox(textGlyphBox(style, widths), bg.padding);
    ctx.save();
    ctx.globalAlpha *= Math.min(1, bg.opacity);
    ctx.fillStyle = bg.color;
    ctx.beginPath();
    if (typeof ctx.roundRect === 'function') ctx.roundRect(b.x, b.y, b.w, b.h, Math.min(bg.radius, b.h / 2, b.w / 2));
    else ctx.rect(b.x, b.y, b.w, b.h);
    ctx.fill();
    ctx.restore();
  }

  ctx.save();
  ctx.font = fontOf(style);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const sh = style.shadow;
  // キャンバスの影は拡大縮小の影響を受けないので、出力の倍率を掛けておく
  const m = ctx.getTransform();
  const k = Math.hypot(m.a, m.b) || 1;
  const setShadow = (on: boolean) => {
    ctx.shadowColor = on && sh ? sh.color : 'transparent';
    ctx.shadowBlur = on && sh ? sh.blur * k : 0;
    ctx.shadowOffsetX = on && sh ? sh.offsetX * k : 0;
    ctx.shadowOffsetY = on && sh ? sh.offsetY * k : 0;
  };
  const lineHeight = style.fontSize * 1.25;
  const descent = style.fontSize * 0.2;
  lines.forEach((line, i) => {
    const y = style.y - descent - (lines.length - 1 - i) * lineHeight;
    // 影は一番外側（縁取りがあれば縁取り）にだけ付け、二重に濃くならないようにする
    if (style.strokeWidth > 0) {
      setShadow(true);
      ctx.strokeStyle = style.strokeColor;
      ctx.lineWidth = style.strokeWidth * 2;
      ctx.strokeText(line, style.x, y);
      setShadow(false);
    } else {
      setShadow(true);
    }
    ctx.fillStyle = style.color;
    ctx.fillText(line, style.x, y);
    setShadow(false);
  });
  ctx.restore();
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

/** テキストを折り返した行（プレビュー上の文字入力欄を、描かれる文字にぴったり重ねるのに使う） */
export function measureTextLines(text: string, style: TextStyle): string[] {
  return layoutText(scratch('measure', 1, 1).ctx, text, style).lines;
}
