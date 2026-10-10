import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Project, TimelineItem } from '../types';
import { createProject } from './defaults';

const HISTORY_LIMIT = 200;

export interface Toast {
  id: number;
  kind: 'info' | 'error';
  text: string;
}

interface EditorState {
  project: Project;
  past: Project[];
  future: Project[];
  /** ドラッグ中など、まとめて1回のUndoにしたい操作の開始時点 */
  gestureBase: Project | null;

  selectedItemId: string | null;
  /** プレビュー上で文字を編集中のテキストアイテム */
  editingTextId: string | null;
  /** スマホで下から出すパネル */
  sheet: 'media' | 'edit' | null;
  /** コピーしたアイテム（同じプロジェクトの中で貼り付けに使う） */
  clipboard: { projectId: string; item: TimelineItem } | null;
  currentTime: number;
  playing: boolean;
  pxPerSec: number;
  /** 素材の読み込み完了などで描画をやり直すためのカウンタ */
  mediaVersion: number;
  toasts: Toast[];
  busy: string | null;

  edit: (recipe: (draft: Draft<Project>) => void) => void;
  editTransient: (recipe: (draft: Draft<Project>) => void) => void;
  beginGesture: () => void;
  endGesture: () => void;
  /** まとめ操作を取り消して、始める前の状態に戻す（履歴は増やさない） */
  cancelGesture: () => void;
  undo: () => void;
  redo: () => void;
  loadProject: (project: Project) => void;

  selectItem: (id: string | null) => void;
  setEditingText: (id: string | null) => void;
  setSheet: (sheet: 'media' | 'edit' | null) => void;
  setClipboard: (clip: { projectId: string; item: TimelineItem } | null) => void;
  setTime: (t: number) => void;
  setPlaying: (playing: boolean) => void;
  setPxPerSec: (v: number) => void;
  bumpMedia: () => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  setBusy: (label: string | null) => void;
}

let toastSeq = 0;

const touch = (draft: Draft<Project>) => {
  draft.updatedAt = Date.now();
};

export const useEditor = create<EditorState>()((set, get) => ({
  project: createProject(),
  past: [],
  future: [],
  gestureBase: null,
  selectedItemId: null,
  editingTextId: null,
  sheet: null,
  clipboard: null,
  currentTime: 0,
  playing: false,
  pxPerSec: 80,
  mediaVersion: 0,
  toasts: [],
  busy: null,

  edit: (recipe) => {
    const { project, past, gestureBase } = get();
    const next = produce(project, (d) => {
      recipe(d);
      touch(d);
    });
    if (next === project) return;
    if (gestureBase) {
      set({ project: next });
      return;
    }
    set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [] });
  },

  editTransient: (recipe) => {
    const { project } = get();
    set({ project: produce(project, recipe) });
  },

  beginGesture: () => set({ gestureBase: get().project }),

  endGesture: () => {
    const { gestureBase, project, past } = get();
    if (!gestureBase) return;
    if (gestureBase === project) {
      set({ gestureBase: null });
      return;
    }
    set({
      gestureBase: null,
      project: produce(project, touch),
      past: [...past, gestureBase].slice(-HISTORY_LIMIT),
      future: [],
    });
  },

  cancelGesture: () => {
    const { gestureBase } = get();
    if (gestureBase) set({ project: gestureBase, gestureBase: null });
  },

  undo: () => {
    const { past, project, future } = get();
    const prev = past[past.length - 1];
    if (!prev) return;
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future] });
  },

  redo: () => {
    const { past, project, future } = get();
    const next = future[0];
    if (!next) return;
    set({ project: next, past: [...past, project], future: future.slice(1) });
  },

  loadProject: (project) =>
    set({
      project,
      past: [],
      future: [],
      gestureBase: null,
      selectedItemId: null,
      editingTextId: null,
      sheet: null,
      currentTime: 0,
      playing: false,
    }),

  selectItem: (id) => set((s) => ({ selectedItemId: id, editingTextId: s.editingTextId === id ? id : null })),
  setEditingText: (id) => set({ editingTextId: id, ...(id ? { selectedItemId: id } : {}) }),
  setSheet: (sheet) => set({ sheet }),
  setClipboard: (clipboard) => set({ clipboard }),
  setTime: (t) => set({ currentTime: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setPxPerSec: (v) => set({ pxPerSec: Math.min(600, Math.max(5, v)) }),
  bumpMedia: () => set((s) => ({ mediaVersion: s.mediaVersion + 1 })),
  toast: (text, kind = 'info') => {
    const id = ++toastSeq;
    set((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 8000 : 4000);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setBusy: (busy) => set({ busy }),
}));

export const editorState = () => useEditor.getState();
