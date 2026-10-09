import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store';
import { buildCredits, checkExportSupport, exportVideo, type ExportSupport } from '../export/exporter';
import { downloadBlob, safeFileName } from '../persist/session';
import { playback } from '../media/playback';
import { formatTime, projectDuration } from '../state/timeline';
import { Modal } from './common';

type Phase = { kind: 'idle' } | { kind: 'running'; ratio: number; label: string } | { kind: 'done'; seconds: number; saved: string } | { kind: 'error'; message: string };

function describe(s: ExportSupport): string {
  if (!s.webCodecs) return 'このブラウザはWebCodecsに対応していないため書き出せません。';
  if (!s.video) return 'このブラウザでは動画をエンコードできません。';
  if (s.container === 'mp4') {
    return s.audio === 'aac'
      ? 'MP4（H.264 + AAC）で書き出します。'
      : 'MP4（H.264 + AAC）で書き出します。このブラウザはAACに対応していないため、音声は内蔵のWASMエンコーダーで変換します（少し時間がかかります）。';
  }
  return `このブラウザはH.264に対応していないため、WebM（${s.video?.toUpperCase()}${s.audio ? ' + Opus' : '、音声なし'}）で書き出します。`;
}

const canPickFile = typeof window !== 'undefined' && 'showSaveFilePicker' in window;

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const [support, setSupport] = useState<ExportSupport | null>(null);
  const [height, setHeight] = useState(1080);
  const [direct, setDirect] = useState(canPickFile);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const duration = projectDuration(project);
  const credits = buildCredits(project);
  const missing = project.items.filter((it) => it.kind === 'voice' && !it.audioAssetId).length;

  useEffect(() => {
    void checkExportSupport(Math.round((project.width * height) / project.height), height, project.fps).then(setSupport);
  }, [height, project.width, project.height, project.fps]);

  const start = async () => {
    playback.pause();
    const ext = support?.container ?? 'mp4';
    const fileName = `${safeFileName(project.name)}.${ext}`;
    let fileHandle: FileSystemFileHandle | undefined;
    if (direct && canPickFile) {
      try {
        fileHandle = await (window as unknown as { showSaveFilePicker: (o: unknown) => Promise<FileSystemFileHandle> }).showSaveFilePicker({
          suggestedName: fileName,
          types: [{ description: '動画', accept: { [ext === 'mp4' ? 'video/mp4' : 'video/webm']: [`.${ext}`] } }],
        });
      } catch {
        return; // 保存先の選択をキャンセル
      }
    }
    const abort = new AbortController();
    abortRef.current = abort;
    setPhase({ kind: 'running', ratio: 0, label: '準備中…' });
    try {
      const result = await exportVideo(project, {
        height,
        fileHandle,
        signal: abort.signal,
        onProgress: (ratio, label) => setPhase({ kind: 'running', ratio, label }),
      });
      if (result.blob) downloadBlob(result.blob, `${safeFileName(project.name)}.${result.extension}`);
      setPhase({ kind: 'done', seconds: result.seconds, saved: fileHandle ? fileHandle.name : `${safeFileName(project.name)}.${result.extension}` });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setPhase({ kind: 'error', message });
    } finally {
      abortRef.current = null;
    }
  };

  const running = phase.kind === 'running';
  return (
    <Modal title="動画の書き出し" onClose={() => (running ? undefined : onClose())}>
      <div className="form">
        <p>
          長さ <strong>{formatTime(duration, project.fps)}</strong> ・ {project.fps}fps
        </p>
        <p className={support && !support.video ? 'notice error' : 'muted'}>{support ? describe(support) : '対応状況を確認中…'}</p>
        {missing > 0 && <p className="notice">音声が未設定のセリフが{missing}個あります（字幕のみで書き出されます）。</p>}
        <label className="field">
          <span className="field-label">解像度</span>
          <select value={height} disabled={running} onChange={(e) => setHeight(Number(e.target.value))}>
            <option value={1080}>1080p（1920×1080）</option>
            <option value={720}>720p（1280×720・速い）</option>
          </select>
        </label>
        {canPickFile && (
          <label className="field">
            <span className="field-label">保存方法</span>
            <span>
              <input type="checkbox" checked={direct} disabled={running} onChange={(e) => setDirect(e.target.checked)} />{' '}
              保存先を選んで直接書き込む（長い動画でもメモリを使い切りません）
            </span>
          </label>
        )}

        {phase.kind === 'running' && (
          <div className="progress">
            <div className="progress-bar">
              <div style={{ width: `${(phase.ratio * 100).toFixed(1)}%` }} />
            </div>
            <span>
              {(phase.ratio * 100).toFixed(0)}% — {phase.label}
            </span>
          </div>
        )}
        {phase.kind === 'done' && (
          <p className="notice ok">
            書き出しが完了しました（{phase.saved}）。所要時間 {phase.seconds.toFixed(1)}秒（動画の長さの
            {(phase.seconds / Math.max(0.01, duration)).toFixed(2)}倍）
          </p>
        )}
        {phase.kind === 'error' && <p className="notice error">{phase.message}</p>}

        <div className="button-row">
          {running ? (
            <button className="btn danger" onClick={() => abortRef.current?.abort()}>
              中止
            </button>
          ) : (
            <button className="btn primary" disabled={!support?.video || duration <= 0} onClick={() => void start()}>
              書き出し開始
            </button>
          )}
          <button className="btn" disabled={running} onClick={onClose}>
            閉じる
          </button>
        </div>

        <h4>クレジット表記</h4>
        {credits ? (
          <>
            <p className="muted small">動画の概要欄などに記載してください。キャラクターごとの利用規約も確認してください。</p>
            <textarea readOnly rows={Math.min(6, credits.split('\n').length + 1)} value={credits} />
            <button
              className="btn small"
              onClick={() => {
                void navigator.clipboard.writeText(credits).then(() => setCopied(true));
              }}
            >
              {copied ? 'コピーしました' : 'コピー'}
            </button>
            <p className="muted small">
              規約：<a href="https://voicevox.hiroshiba.jp/term/" target="_blank" rel="noreferrer">VOICEVOX 利用規約</a>
            </p>
          </>
        ) : (
          <p className="muted small">VOICEVOXの音声は使われていません。読み込んだ音声・素材の利用条件は各提供元の規約に従ってください。</p>
        )}
      </div>
    </Modal>
  );
}
