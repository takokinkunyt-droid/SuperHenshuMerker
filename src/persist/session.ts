// 起動時の読み込み、自動保存、プロジェクトの切り替え。
import { create } from 'zustand';
import type { Project } from '../types';
import { editorState, useEditor } from '../state/store';
import { createProject } from '../state/defaults';
import { primeProjectMedia } from '../state/actions';
import { playback } from '../media/playback';
import { lastProjectId, loadStoredProject, requestPersistentStorage, saveProject } from './projects';
import { exportProjectZip, importProjectZip } from './zip';
import { migrateProject } from './migrate';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export const useSaveStatus = create<{ status: SaveStatus; persisted: boolean }>(() => ({
  status: 'saved',
  persisted: false,
}));

let timer: ReturnType<typeof setTimeout> | undefined;
let lastSaved: Project | null = null;

async function flush() {
  clearTimeout(timer);
  const { project } = editorState();
  if (project === lastSaved) return;
  useSaveStatus.setState({ status: 'saving' });
  try {
    await saveProject(project);
    lastSaved = project;
    useSaveStatus.setState({ status: 'saved' });
  } catch (err) {
    console.error(err);
    useSaveStatus.setState({ status: 'error' });
  }
}

function switchTo(project: Project) {
  playback.pause();
  editorState().loadProject(project);
  primeProjectMedia();
  lastSaved = null;
  void flush();
}

export async function boot(): Promise<void> {
  useSaveStatus.setState({ persisted: await requestPersistentStorage() });
  let project: Project | null = null;
  try {
    const id = await lastProjectId();
    if (id) {
      const stored = await loadStoredProject(id);
      if (stored) project = migrateProject(stored);
    }
  } catch (err) {
    console.warn('前回のプロジェクトを読み込めませんでした', err);
  }
  switchTo(project ?? createProject());

  // 編集のたびに1秒後に自動保存（ドラッグ中は保存しない）
  useEditor.subscribe((s, prev) => {
    if (s.project === prev.project || s.gestureBase) return;
    useSaveStatus.setState({ status: 'pending' });
    clearTimeout(timer);
    timer = setTimeout(flush, 1000);
  });
  window.addEventListener('pagehide', () => void flush());
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flush();
  });
}

export async function newProject() {
  await flush();
  switchTo(createProject());
}

export async function openProject(id: string) {
  await flush();
  const stored = await loadStoredProject(id);
  if (!stored) throw new Error('プロジェクトが見つかりません');
  switchTo(migrateProject(stored));
}

export function saveNow() {
  return flush();
}

export function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'project';

export async function downloadProjectZip() {
  await flush();
  const { project } = editorState();
  downloadBlob(await exportProjectZip(project), `${safeFileName(project.name)}.shm.zip`);
}

export async function importZipFile(file: File) {
  await flush();
  const project = await importProjectZip(file);
  switchTo(project);
}
