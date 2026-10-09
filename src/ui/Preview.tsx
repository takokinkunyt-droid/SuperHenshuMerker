import { useEffect, useRef, useState } from 'react';
import { editorState, useEditor } from '../state/store';
import { drawFrame } from '../render/renderer';
import { previewSource, syncVideos } from '../render/previewSource';
import { media } from '../media/mediaCache';
import { playback } from '../media/playback';
import { formatTime, projectDuration } from '../state/timeline';
import type { TimelineItem } from '../types';

const QUALITY_KEY = 'shm.previewScale';

function loadQuality(): number {
  try {
    return Number(localStorage.getItem(QUALITY_KEY)) || 0.5;
  } catch {
    return 0.5;
  }
}

/** プレビュー上でドラッグして動かせる位置を返す */
function positionOf(item: TimelineItem | undefined): { x: number; y: number } | null {
  if (!item) return null;
  if (item.kind === 'image' || item.kind === 'video') return { x: item.x, y: item.y };
  if (item.kind === 'text') return { x: item.style.x, y: item.style.y };
  return null;
}

function applyPosition(id: string, x: number, y: number) {
  editorState().editTransient((d) => {
    const item = d.items.find((it) => it.id === id);
    if (!item) return;
    if (item.kind === 'image' || item.kind === 'video') Object.assign(item, { x, y });
    else if (item.kind === 'text') Object.assign(item.style, { x, y });
  });
}

export function Preview() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [quality, setQuality] = useState(loadQuality);
  const project = useEditor((s) => s.project);
  const playing = useEditor((s) => s.playing);
  const currentTime = useEditor((s) => s.currentTime);
  const duration = projectDuration(project);

  // 状態が変わったら次のアニメーションフレームで描き直す
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    let raf = 0;
    const draw = () => {
      raf = 0;
      const s = editorState();
      const { width, height } = s.project;
      const w = Math.round(width * quality);
      const h = Math.round(height * quality);
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      syncVideos(s.project, s.currentTime, s.playing);
      drawFrame(ctx, s.project, s.currentTime, previewSource, quality);
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(draw);
    };
    schedule();
    const unsubStore = useEditor.subscribe((s, prev) => {
      if (s.project !== prev.project || s.currentTime !== prev.currentTime || s.mediaVersion !== prev.mediaVersion || s.playing !== prev.playing)
        schedule();
    });
    const unsubMedia = media.onChange(schedule);
    return () => {
      unsubStore();
      unsubMedia();
      cancelAnimationFrame(raf);
    };
  }, [quality]);

  const drag = useRef<{ id: string; sx: number; sy: number; x: number; y: number } | null>(null);
  const toProject = (e: React.PointerEvent) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * project.width,
      y: ((e.clientY - rect.top) / rect.height) * project.height,
    };
  };

  const selected = useEditor((s) => s.project.items.find((it) => it.id === s.selectedItemId));
  const pos = positionOf(selected);

  return (
    <div className="preview-panel">
      <div className="preview-stage">
        <div
          className="preview-frame"
          style={{ aspectRatio: `${project.width} / ${project.height}`, ['--aspect' as string]: project.width / project.height }}
        >
          <canvas
            ref={canvasRef}
            className={pos ? 'draggable' : ''}
            onPointerDown={(e) => {
              if (!selected || !pos) return;
              const p = toProject(e);
              drag.current = { id: selected.id, sx: p.x, sy: p.y, x: pos.x, y: pos.y };
              editorState().beginGesture();
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              const d = drag.current;
              if (!d) return;
              const p = toProject(e);
              applyPosition(d.id, Math.round(d.x + p.x - d.sx), Math.round(d.y + p.y - d.sy));
            }}
            onPointerUp={() => {
              if (!drag.current) return;
              drag.current = null;
              editorState().endGesture();
            }}
          />
          {project.items.length === 0 && (
            <div className="preview-empty">
              下の「🎞 動画・画像」「🎵 音楽」「T テキスト」から追加してください
              <br />
              （ファイルをここへドラッグ＆ドロップしてもOK）
            </div>
          )}
        </div>
      </div>
      <div className="transport">
        <button className="icon-btn" title="先頭へ (Home)" onClick={() => playback.seek(0)}>
          ⏮
        </button>
        <button
          className="icon-btn"
          title="1フレーム戻る (←)"
          onClick={() => playback.seek(Math.max(0, currentTime - 1 / project.fps))}
        >
          ◀︎
        </button>
        <button className="play-btn" title="再生／停止 (Space)" onClick={() => playback.toggle()}>
          {playing ? '❚❚' : '▶'}
        </button>
        <button className="icon-btn" title="1フレーム進む (→)" onClick={() => playback.seek(currentTime + 1 / project.fps)}>
          ▶︎
        </button>
        <span className="timecode">
          {formatTime(currentTime, project.fps)} / {formatTime(duration, project.fps)}
        </span>
        <span className="spacer" />
        <label className="quality">
          <span className="quality-label">プレビュー画質</span>
          <select
            value={quality}
            onChange={(e) => {
              const v = Number(e.target.value);
              setQuality(v);
              try {
                localStorage.setItem(QUALITY_KEY, String(v));
              } catch {
                // 保存できなくても動作には影響しない
              }
            }}
          >
            <option value={0.25}>画質：低</option>
            <option value={0.5}>画質：中</option>
            <option value={1}>画質：高</option>
          </select>
        </label>
      </div>
    </div>
  );
}
