// 1フレームを描く共通処理。プレビューと書き出しで同じ関数を使うので、見た目がずれない。
import type { Character, Placement, Project, TextStyle, TimelineItem, VideoItem, VoiceItem } from '../types';
import { isActiveAt, itemEnd } from '../state/timeline';
import { isBlinking, mouthFor, type MouthShape } from '../media/lipsync';

export interface Drawable {
  source: CanvasImageSource;
  width: number;
  height: number;
}

/** 描画に必要な素材の取り出し口。プレビューと書き出しで中身を差し替える */
export interface FrameSource {
  image(assetId: string | null): Drawable | null;
  videoFrame(item: VideoItem, sourceTime: number): Drawable | null;
  lipLevel(assetId: string | null, sourceTime: number): number;
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

  const characters = new Map(project.characters.map((c) => [c.id, c]));
  for (const item of visibleItems(project, t)) {
    switch (item.kind) {
      case 'image':
        drawPlaced(ctx, src.image(item.assetId), item);
        break;
      case 'video':
        drawPlaced(ctx, src.videoFrame(item, t - item.start + item.sourceOffset), item);
        break;
      case 'tachie': {
        const ch = characters.get(item.characterId);
        if (ch) drawTachie(ctx, ch, mouthAt(project, ch.id, t, src), isBlinking(t, ch.id), src);
        break;
      }
      case 'voice': {
        const ch = characters.get(item.characterId);
        if (ch && item.showSubtitle && item.text) drawText(ctx, item.text, ch.subtitle);
        break;
      }
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

/** そのキャラが時刻tに喋っていれば、音量から口の形を決める */
function mouthAt(project: Project, characterId: string, t: number, src: FrameSource): MouthShape {
  const voice = project.items.find(
    (it): it is VoiceItem => it.kind === 'voice' && it.characterId === characterId && isActiveAt(it, t),
  );
  if (!voice) return 'closed';
  if (!voice.audioAssetId) {
    // 音声未設定のセリフは一定のリズムで口を動かす（終わり際は閉じる）
    if (itemEnd(voice) - t < 0.15) return 'closed';
    const phase = Math.floor((t - voice.start) / 0.12) % 3;
    return phase === 0 ? 'open' : phase === 1 ? 'half' : 'closed';
  }
  return mouthFor(src.lipLevel(voice.audioAssetId, t - voice.start + voice.audioOffset));
}

export function drawTachie(ctx: Ctx, ch: Character, mouth: MouthShape, blink: boolean, src: FrameSource) {
  const parts = ch.tachie;
  const base = src.image(parts.base);
  ctx.save();
  if (ch.tachieFlip) {
    ctx.translate(ch.tachieX * 2, 0);
    ctx.scale(-1, 1);
  }
  if (!base) {
    drawPlaceholderTachie(ctx, ch, mouth, blink);
    ctx.restore();
    return;
  }
  const w = base.width * ch.tachieScale;
  const h = base.height * ch.tachieScale;
  const x = ch.tachieX - w / 2;
  const y = ch.tachieY - h;
  const layer = (d: Drawable | null) => {
    if (d) ctx.drawImage(d.source, x, y, w, h);
  };
  layer(base);
  layer(src.image(blink ? parts.eyesClosed ?? parts.eyesOpen : parts.eyesOpen));
  const mouthPart =
    mouth === 'open'
      ? parts.mouthOpen ?? parts.mouthHalf ?? parts.mouthClosed
      : mouth === 'half'
        ? parts.mouthHalf ?? parts.mouthOpen ?? parts.mouthClosed
        : parts.mouthClosed;
  layer(src.image(mouthPart));
  ctx.restore();
}

/** 立ち絵画像が未設定のときの仮の立ち絵（口パク・目パチ付き） */
function drawPlaceholderTachie(ctx: Ctx, ch: Character, mouth: MouthShape, blink: boolean) {
  const s = ch.tachieScale;
  const cx = ch.tachieX;
  const bottom = ch.tachieY;
  ctx.fillStyle = ch.color;
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 6 * s;
  // 胴体
  ctx.beginPath();
  ctx.roundRect(cx - 170 * s, bottom - 330 * s, 340 * s, 400 * s, 120 * s);
  ctx.fill();
  ctx.stroke();
  // 頭
  ctx.fillStyle = '#fde3cf';
  ctx.beginPath();
  ctx.arc(cx, bottom - 470 * s, 170 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // 髪
  ctx.fillStyle = ch.color;
  ctx.beginPath();
  ctx.arc(cx, bottom - 490 * s, 172 * s, Math.PI * 1.02, Math.PI * 1.98);
  ctx.fill();
  // 目
  ctx.fillStyle = '#222';
  ctx.strokeStyle = '#222';
  for (const dx of [-60, 60]) {
    if (blink) {
      ctx.lineWidth = 8 * s;
      ctx.beginPath();
      ctx.moveTo(cx + (dx - 22) * s, bottom - 470 * s);
      ctx.lineTo(cx + (dx + 22) * s, bottom - 470 * s);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.ellipse(cx + dx * s, bottom - 470 * s, 16 * s, 26 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // 口
  const mh = mouth === 'open' ? 34 : mouth === 'half' ? 16 : 4;
  ctx.fillStyle = '#9b2c2c';
  ctx.beginPath();
  ctx.ellipse(cx, bottom - 385 * s, 30 * s, mh * s, 0, 0, Math.PI * 2);
  ctx.fill();
  // 名前
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${44 * s}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ch.name, cx, bottom - 150 * s);
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
