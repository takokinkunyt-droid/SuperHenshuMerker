import { useEffect, useRef, useState } from 'react';
import { useEditor } from '../state/store';
import { checkExportSupport, exportVideo, outputSize, type ExportSupport } from '../export/exporter';
import { downloadBlob, safeFileName } from '../persist/session';
import { playback } from '../media/playback';
import { formatTime, projectDuration } from '../state/timeline';
import { Modal } from './common';

type Phase =
  | { kind: 'idle' }
  | { kind: 'running'; ratio: number; label: string }
  | { kind: 'done'; seconds: number; file: File | null; savedName: string }
  | { kind: 'error'; message: string };

function describe(s: ExportSupport): string {
  if (!s.webCodecs) return 'このブラウザは動画の書き出し（WebCodecs）に対応していません。最新のChrome・Edge・Safariを使ってください。';
  if (!s.video) return 'このブラウザでは動画をエンコードできません。';
  if (s.container === 'mp4') {
    return s.audio === 'aac'
      ? 'MP4（H.264 + AAC）で書き出します。'
      : 'MP4（H.264 + AAC）で書き出します。このブラウザはAACに対応していないため、音声は内蔵のエンコーダーで変換します（少し時間がかかります）。';
  }
  return `このブラウザはH.264に対応していないため、WebM（${s.video?.toUpperCase()}${s.audio ? ' + Opus' : '、音声なし'}）で書き出します。`;
}

const canPickFile = typeof window !== 'undefined' && 'showSaveFilePicker' in window;
/** スマホなど、ファイルの共有（写真アプリへの保存など）ができる環境か */
const canShareFile = (file: File) => typeof navigator !== 'undefined' && !!navigator.canShare?.({ files: [file] });
/** 指で操作する端末（スマホ・タブレット）か */
const isTouchDevice = () => typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

export function ExportDialog({ onClose }: { onClose: () => void }) {
  const project = useEditor((s) => s.project);
  const [support, setSupport] = useState<ExportSupport | null>(null);
  const [shortSide, setShortSide] = useState(1080);
  const [direct, setDirect] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const abortRef = useRef<AbortController | null>(null);
  const duration = projectDuration(project);
  const size = outputSize(project, shortSide);

  useEffect(() => {
    void checkExportSupport(size.width, size.height, project.fps).then(setSupport);
  }, [size.width, size.height, project.fps]);

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
        shortSide,
        fileHandle,
        signal: abort.signal,
        onProgress: (ratio, label) => setPhase({ kind: 'running', ratio, label }),
      });
      const name = `${safeFileName(project.name)}.${result.extension}`;
      const file = result.blob ? new File([result.blob], name, { type: result.blob.type }) : null;
      // パソコンではそのままダウンロード。スマホはボタンから保存・共有してもらう
      // （時間のかかる処理のあとの自動ダウンロードは、スマホのブラウザに止められることがあるため）
      if (file && !isTouchDevice()) downloadBlob(file, name);
      setPhase({ kind: 'done', seconds: result.seconds, file, savedName: fileHandle ? fileHandle.name : name });
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
        <label className="field">
          <span className="field-label">画質</span>
          <select value={shortSide} disabled={running} onChange={(e) => setShortSide(Number(e.target.value))}>
            <option value={1080}>フルHD（{outputSize(project, 1080).width}×{outputSize(project, 1080).height}）</option>
            <option value={720}>HD（{outputSize(project, 720).width}×{outputSize(project, 720).height}・速い）</option>
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
            <span className="muted small">書き出し中は画面を閉じたり、別のアプリに切り替えたりしないでください。</span>
          </div>
        )}
        {phase.kind === 'done' && (
          <>
            <p className="notice ok">
              書き出しが完了しました（{phase.savedName}）。所要時間 {phase.seconds.toFixed(1)}秒
            </p>
            {phase.file && (
              <div className="button-row">
                {canShareFile(phase.file) && (
                  <button
                    className="btn primary"
                    onClick={() => void navigator.share({ files: [phase.file!], title: project.name }).catch(() => undefined)}
                  >
                    共有・写真に保存
                  </button>
                )}
                <button className="btn" onClick={() => downloadBlob(phase.file!, phase.file!.name)}>
                  ファイルとして保存
                </button>
              </div>
            )}
          </>
        )}
        {phase.kind === 'error' && <p className="notice error">{phase.message}</p>}

        <div className="button-row">
          {running ? (
            <button className="btn danger" onClick={() => abortRef.current?.abort()}>
              中止
            </button>
          ) : (
            <button className="btn primary" disabled={!support?.video || duration <= 0} onClick={() => void start()}>
              {phase.kind === 'done' ? 'もう一度書き出す' : '書き出し開始'}
            </button>
          )}
          <button className="btn" disabled={running} onClick={onClose}>
            閉じる
          </button>
        </div>
        <p className="muted small">使った音楽・映像の利用条件（著作権・クレジット表記など）は、それぞれの提供元の規約に従ってください。</p>
      </div>
    </Modal>
  );
}
