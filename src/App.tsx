import { lazy, Suspense, useEffect, useState } from 'react';
import { editorState, useEditor } from './state/store';
import { useSaveStatus } from './persist/session';
import { copyItem, deleteItem, duplicateItem, importAndPlace, pasteItem, splitAtPlayhead } from './state/actions';
import { playback } from './media/playback';
import { MediaPanel } from './ui/MediaPanel';
import { MobileNav } from './ui/MobileNav';
import { EditActions } from './ui/EditActions';
import { Preview } from './ui/Preview';
import { Inspector } from './ui/Inspector';
import { Timeline } from './ui/Timeline';
import { ProjectDialog } from './ui/ProjectDialog';
import { AboutDialog } from './ui/AboutDialog';

// 書き出し（Mediabunny）は重いので、使うときに読み込む
const ExportDialog = lazy(() => import('./ui/ExportDialog').then((m) => ({ default: m.ExportDialog })));

const SAVE_LABEL = { saved: '保存済み', pending: '未保存', saving: '保存中…', error: '保存に失敗' } as const;

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable || (tag === 'INPUT' && !['checkbox', 'range', 'button', 'color'].includes((el as HTMLInputElement).type));
}

function useShortcuts(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = editorState();
      const mod = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (mod && key === 'y') {
        e.preventDefault();
        s.redo();
      } else if (mod && key === 'd') {
        e.preventDefault();
        if (s.selectedItemId) duplicateItem(s.selectedItemId);
      } else if (mod && key === 'c') {
        if (s.selectedItemId) {
          e.preventDefault();
          copyItem(s.selectedItemId);
        }
      } else if (mod && key === 'v') {
        if (s.clipboard) {
          e.preventDefault();
          pasteItem();
        }
      } else if (mod) {
        return;
      } else if (e.key === ' ') {
        e.preventDefault();
        playback.toggle();
      } else if (key === 's') {
        splitAtPlayhead();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && s.selectedItemId) {
        e.preventDefault();
        deleteItem(s.selectedItemId);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / s.project.fps;
        playback.seek(Math.max(0, s.currentTime + (e.key === 'ArrowLeft' ? -step : step)));
      } else if (e.key === 'Home') {
        playback.seek(0);
      } else if (e.key === 'Escape') {
        s.selectItem(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

export function App() {
  const projectName = useEditor((s) => s.project.name);
  const toasts = useEditor((s) => s.toasts);
  const saveStatus = useSaveStatus((s) => s.status);
  const [dialog, setDialog] = useState<'export' | 'project' | 'about' | null>(null);
  const [dragging, setDragging] = useState(false);
  const [compat, setCompat] = useState<string | null>(null);

  useShortcuts(dialog === null);

  // 起動時に書き出しの対応状況を調べ、できないことがあれば案内する
  useEffect(() => {
    void import('./export/exporter').then(async ({ checkExportSupport }) => {
      const s = await checkExportSupport();
      if (!s.webCodecs || !s.video) setCompat('このブラウザは動画の書き出し（WebCodecs）に対応していません。編集はできますが、書き出しには最新のChrome・Edge・Safariを使ってください。');
      else if (s.container === 'webm') setCompat('このブラウザはH.264に非対応のため、動画はWebM形式で書き出されます。');
    });
  }, []);

  return (
    <div
      className="app"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target || !e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) void importAndPlace(files);
      }}
    >
      <header className="header">
        <div className="brand">
          <img src="./icon.svg" alt="" width={26} height={26} />
          <span>スーパー編集メーカー</span>
        </div>
        <button className="btn ghost project-btn" onClick={() => setDialog('project')} title="プロジェクトの切り替え・保存">
          📁 <span className="project-name">{projectName}</span>
        </button>
        <span className={`save-status ${saveStatus}`}>{SAVE_LABEL[saveStatus]}</span>
        <span className="spacer" />
        <EditActions />
        <button className="btn ghost" onClick={() => setDialog('about')} aria-label="使い方">
          ？<span className="help-label"> 使い方</span>
        </button>
        <button className="btn primary" onClick={() => setDialog('export')}>
          書き出し
        </button>
      </header>
      {compat && (
        <div className="banner">
          {compat}
          <button className="icon-btn" onClick={() => setCompat(null)} aria-label="閉じる">
            ✕
          </button>
        </div>
      )}
      <main className="workspace">
        <MediaPanel />
        <Preview />
        <Inspector />
      </main>
      <Timeline />
      <MobileNav />

      {dialog === 'export' && (
        <Suspense fallback={null}>
          <ExportDialog onClose={() => setDialog(null)} />
        </Suspense>
      )}
      {dialog === 'project' && <ProjectDialog onClose={() => setDialog(null)} />}
      {dialog === 'about' && <AboutDialog onClose={() => setDialog(null)} />}
      {dragging && <div className="drop-overlay">ここにドロップして素材を追加</div>}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`} onClick={() => editorState().dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  );
}
