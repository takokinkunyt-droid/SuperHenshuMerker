import { create } from 'zustand';
import { produce, type Draft } from 'immer';
import type { Project, TimelineItem } from '../types';
import { applyOps, type Op } from '../collab/ops';
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

  /** 選択中のアイテム（複数選択のときは最後に選んだもの。設定パネルに出す） */
  selectedItemId: string | null;
  /** 選択中のすべてのアイテム */
  selectedIds: string[];
  /** プレビュー上で文字を編集中のテキストアイテム */
  editingTextId: string | null;
  /** スマホで下から出すパネル */
  sheet: 'media' | 'edit' | null;
  /** 合成音声（読み上げ）のパネルを開いているか */
  ttsOpen: boolean;
  /** コピーしたアイテム（同じプロジェクトの中で貼り付けに使う） */
  clipboard: { projectId: string; items: TimelineItem[] } | null;
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
  /** 共同作業の相手からの変更を当てはめる（自分の元に戻す履歴にも当てはめ、履歴は増やさない） */
  applyRemoteOps: (ops: Op[]) => void;
  /** 共同作業でサーバーの内容に置き換える（履歴は消す） */
  replaceProjectRemote: (project: Project) => void;
  redo: () => void;
  loadProject: (project: Project) => void;

  selectItem: (id: string | null) => void;
  /** 複数のアイテムを選ぶ（primary を省くと最後のもの） */
  setSelection: (ids: string[], primary?: string | null) => void;
  /** 選択に足す／選択から外す（Ctrl・Shift を押しながらのクリック） */
  toggleSelect: (id: string) => void;
  setEditingText: (id: string | null) => void;
  setSheet: (sheet: 'media' | 'edit' | null) => void;
  setTtsOpen: (open: boolean) => void;
  setClipboard: (clip: { projectId: string; items: TimelineItem[] } | null) => void;
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
  selectedIds: [],
  editingTextId: null,
  sheet: null,
  ttsOpen: false,
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

  applyRemoteOps: (ops) => {
    const { project, past, future, gestureBase } = get();
    set({
      project: applyOps(project, ops),
      past: past.map((p) => applyOps(p, ops)),
      future: future.map((p) => applyOps(p, ops)),
      gestureBase: gestureBase ? applyOps(gestureBase, ops) : null,
    });
  },

  replaceProjectRemote: (project) => set({ project, past: [], future: [], gestureBase: null }),

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
      selectedIds: [],
      editingTextId: null,
      sheet: null,
      currentTime: 0,
      playing: false,
    }),

  selectItem: (id) => set((s) => ({ selectedItemId: id, selectedIds: id ? [id] : [], editingTextId: s.editingTextId === id ? id : null })),
  setSelection: (ids, primary) =>
    set((s) => {
      const main = primary !== undefined && primary !== null && ids.includes(primary) ? primary : ids[ids.length - 1] ?? null;
      return { selectedIds: ids, selectedItemId: main, editingTextId: s.editingTextId === main ? main : null };
    }),
  toggleSelect: (id) => {
    const { selectedIds, setSelection } = get();
    if (selectedIds.includes(id)) setSelection(selectedIds.filter((x) => x !== id));
    else setSelection([...selectedIds, id], id);
  },
  setEditingText: (id) => set({ editingTextId: id, ...(id ? { selectedItemId: id, selectedIds: [id] } : {}) }),
  setSheet: (sheet) => set({ sheet }),
  setTtsOpen: (ttsOpen) => set({ ttsOpen }),
  setClipboard: (clipboard) => set({ clipboard }),
  setTime: (t) => set({ currentTime: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setPxPerSec: (v) => set({ pxPerSec: Math.min(600, Math.max(0.2, v)) }),
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
