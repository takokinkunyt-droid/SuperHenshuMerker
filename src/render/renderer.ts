// 1フレームを描く共通処理。プレビューと書き出しで同じ関数を使うので、見た目がずれない。
import type { Placement, Project, TextStyle, TimelineItem, VideoItem } from '../types';
import { isActiveAt } from '../state/timeline';

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

  for (const item of visibleItems(project, t)) {
    switch (item.kind) {
      case 'image':
        drawPlaced(ctx, src.image(item.assetId), item);
        break;
      case 'video':
        drawPlaced(ctx, src.videoFrame(item, t - item.start + item.sourceOffset), item);
        break;
      case 'text':
        drawText(ctx, item.text, item.style);
        break;
    }
  }
  ctx.restore();
}

function drawPlaced(ctx: Ctx, d: Drawable | null, p: Placement) {
  if (!d || p.opacity <= 0) return;
  const w = d.width * p.scale;
  const h = d.height * p.scale;
  ctx.globalAlpha = Math.min(1, p.opacity);
  ctx.drawImage(d.source, p.x - w / 2, p.y - h / 2, w, h);
  ctx.globalAlpha = 1;
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

export function drawText(ctx: Ctx, text: string, style: TextStyle) {
  ctx.font = fontOf(style);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const lines = wrapLines((s) => ctx.measureText(s).width, text, style.maxWidth);
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
