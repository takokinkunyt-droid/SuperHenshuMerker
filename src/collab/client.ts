// 共同作業のクライアント。共有サーバー（tools/voicevox-share.mjs）を通して、同じプロジェクトを複数人で編集する。
//
// - 自分の変更：編集するたびに、前回送った状態との違い（アイテム単位）をサーバーへ送る（ドラッグ中は間引く）
// - 相手の変更：サーバーからのお知らせ（Server-Sent Events）で受け取り、自分のプロジェクトと「元に戻す」履歴に当てはめる
// - 素材：新しい素材は分けてアップロードし、相手の素材は必要になったらダウンロードする
// - つながり直したとき：サーバーの内容に、つながっていない間の自分の変更を足して送り直す
import { create } from 'zustand';
import type { AssetMeta, Project } from '../types';
import { applyOps, diffProjects, type Op } from './ops';
import { editorState, useEditor } from '../state/store';
import { getAsset, putAsset } from '../persist/assetStorage';
import { saveProject } from '../persist/projects';
import { media } from '../media/mediaCache';
import { voicevoxKey, voicevoxUrl } from '../voice/voicevox';

export interface Participant {
  id: string;
  name: string;
  color: string;
  selected: string | null;
}

interface CollabState {
  status: 'off' | 'connecting' | 'online' | 'reconnecting';
  room: string | null;
  server: string | null;
  users: Participant[];
  /** 素材のアップロード・ダウンロードの進み具合 */
  transfers: { up: number; down: number };
  error: string | null;
  dialogOpen: boolean;
}

export const useCollab = create<CollabState>(() => ({
  status: 'off',
  room: null,
  server: null,
  users: [],
  transfers: { up: 0, down: 0 },
  error: null,
  dialogOpen: false,
}));

const CHUNK = 8 * 1024 * 1024;
const NAME_KEY = 'shm.collabName';
const SESSIONS_KEY = 'shm.collabSessions';

export const clientId = (() => {
  try {
    const k = 'shm.collabClient';
    let id = sessionStorage.getItem(k);
    if (!id) {
      id = Math.random().toString(36).slice(2, 10);
      sessionStorage.setItem(k, id);
    }
    return id;
  } catch {
    return Math.random().toString(36).slice(2, 10);
  }
})();

export function myName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || '';
  } catch {
    return '';
  }
}

export function setMyName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name.trim().slice(0, 30));
  } catch {
    // 保存できなくても今回は使える
  }
  if (session) void session.sendPresence();
}

interface SavedSession {
  server: string;
  key: string;
}

function savedSessions(): Record<string, SavedSession> {
  try {
    return JSON.parse(localStorage.getItem(SESSIONS_KEY) || '{}');
  } catch {
    return {};
  }
}

function rememberSession(room: string, s: SavedSession | null) {
  try {
    const all = savedSessions();
    if (s) all[room] = s;
    else delete all[room];
    localStorage.setItem(SESSIONS_KEY, JSON.stringify(all));
  } catch {
    // 保存できなくても今回は使える
  }
}

/** 招待リンク（開くと共有サーバーの設定と共同作業への参加をまとめて行う） */
export function inviteLink(server: string, key: string, room: string): string {
  const base = typeof location !== 'undefined' ? location.origin + location.pathname : '';
  return `${base}#voicevox=${encodeURIComponent(server)}&key=${encodeURIComponent(key)}&room=${encodeURIComponent(room)}`;
}

class Session {
  private es: EventSource | null = null;
  /** サーバーが持っている（はずの）状態。ここからの違いを送る */
  private synced: Project | null = null;
  private applying = false;
  private sending: Promise<void> = Promise.resolve();
  private unsub: (() => void) | null = null;
  private uploaded = new Set<string>();
  private downloading = new Set<string>();
  private presenceTimer = 0;
  private flushTimer = 0;
  private retryTimer = 0;
  /** 送ったがまだ届いたと確認できていない変更 */
  private outbox = new Map<number, Op[]>();
  private outboxSeq = 0;
  private gen = 0;
  private stopped = false;

  constructor(
    readonly server: string,
    readonly key: string,
    readonly room: string,
  ) {}

  private url(path: string) {
    return `${this.server}/collab/${encodeURIComponent(this.room)}${path}`;
  }

  private async request(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.key}`);
    const res = await fetch(this.url(path), { ...init, headers });
    if (res.status === 401) throw new Error('合言葉が違います。招待リンクをもう一度開いてください。');
    return res;
  }

  /** 変更のお知らせを受け取り始める */
  connect() {
    useCollab.setState({ status: 'connecting', room: this.room, server: this.server, error: null });
    this.listen();

    // 自分の変更を見張る
    this.unsub = useEditor.subscribe((s, prev) => {
      if (this.applying || !this.synced) return;
      if (s.project.id !== this.room) return;
      if (s.selectedItemId !== prev.selectedItemId) this.schedulePresence();
      if (s.project === prev.project) return;
      if (s.gestureBase) this.scheduleFlush(); // ドラッグ中・文字の入力中は間引いて送る（相手にも動きが見える）
      else this.flush();
    });
  }

  private scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = window.setTimeout(() => {
      this.flushTimer = 0;
      this.flush();
    }, 250);
  }

  private listen() {
    const q = new URLSearchParams({ client: clientId, name: myName() || 'ゲスト', key: this.key });
    const es = new EventSource(this.url(`/events?${q}`));
    this.es = es;
    es.addEventListener('snapshot', (e) => this.onSnapshot(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('ops', (e) => this.onOps(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('presence', (e) => useCollab.setState({ users: JSON.parse((e as MessageEvent).data) }));
    es.onerror = () => {
      if (this.stopped) return;
      useCollab.setState({ status: 'reconnecting' });
      // 通信が切れただけなら EventSource が自動でつなぎ直す。エラーが返ってきたときは諦めてしまうので、自分でつなぎ直す
      if (es.readyState === EventSource.CLOSED) {
        clearTimeout(this.retryTimer);
        this.retryTimer = window.setTimeout(() => void this.relisten(), 3000);
      }
    };
  }

  private async relisten() {
    if (this.stopped) return;
    try {
      const res = await this.request('/project');
      // サーバーにプロジェクトが無い（データを消した・別のパソコンで起動した）ときは、手元の内容を置き直す
      const local = editorState().project;
      if (res.status === 404 && local.id === this.room) {
        await this.request('/project', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ project: local }),
        });
        this.uploaded.clear();
        void this.uploadAll(Object.values(local.assets));
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('合言葉')) {
        useCollab.setState({ error: err.message });
        return;
      }
    }
    if (!this.stopped) this.listen();
  }

  /** 前回送った状態との違いを送る */
  private flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = 0;
    const current = editorState().project;
    if (!this.synced || current.id !== this.room) return;
    const ops = diffProjects(this.synced, current);
    if (!ops.length) return;
    this.synced = current;
    this.send(ops);
  }

  private send(ops: Op[]) {
    for (const o of ops) if (o.op === 'asset') void this.upload(o.asset);
    const id = ++this.outboxSeq;
    this.outbox.set(id, ops);
    const gen = this.gen;
    this.sending = this.sending.then(async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        // つながり直したときは、届いていない変更をまとめて送り直すので、ここでは送らない
        if (gen !== this.gen || this.stopped) return;
        try {
          const res = await this.request('/ops', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ client: clientId, ops }),
          });
          if (res.ok) {
            this.outbox.delete(id);
            return;
          }
        } catch {
          // 少し待って送り直す
        }
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      }
      useCollab.setState({ error: '変更を送れませんでした。つながり直したときに送り直します。' });
    });
  }

  private onSnapshot({ project }: { project: Project; rev: number }) {
    const s = editorState();
    const local = s.project.id === this.room ? s.project : null;
    // まだ届いていない変更と、つながっていない間に自分が変えた分は、サーバーの内容に足して送り直す
    const unsent = local ? [...this.outbox.values()].flat() : [];
    this.outbox.clear();
    this.gen++;
    const pending = [...unsent, ...(local && this.synced ? diffProjects(this.synced, local) : [])];
    const merged = applyOps(project, pending);
    this.applying = true;
    try {
      if (local) s.replaceProjectRemote(merged);
      else s.loadProject(merged);
    } finally {
      this.applying = false;
    }
    media.setProject(merged.id);
    this.synced = project;
    void saveProject(merged);
    useCollab.setState({ status: 'online', error: null });
    if (pending.length) this.flush();
    void this.fetchMissingAssets(Object.values(merged.assets));
    void this.sendPresence();
  }

  private onOps({ ops, from }: { ops: Op[]; from: string }) {
    if (from === clientId || !this.synced) return; // 自分の変更はもう当てはめてある
    this.synced = applyOps(this.synced, ops);
    this.applying = true;
    try {
      editorState().applyRemoteOps(ops);
    } finally {
      this.applying = false;
    }
    const assets = ops.flatMap((o) => (o.op === 'asset' ? [o.asset] : []));
    if (assets.length) void this.fetchMissingAssets(assets);
  }

  private schedulePresence() {
    clearTimeout(this.presenceTimer);
    this.presenceTimer = window.setTimeout(() => void this.sendPresence(), 150);
  }

  async sendPresence() {
    try {
      await this.request('/presence', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client: clientId, name: myName() || 'ゲスト', selected: editorState().selectedItemId }),
      });
    } catch {
      // 次の機会に送る
    }
  }

  /** 素材を分けてアップロードする（1回の通信が大きくなりすぎないように） */
  async upload(asset: AssetMeta): Promise<void> {
    if (this.uploaded.has(asset.id)) return;
    this.uploaded.add(asset.id);
    const blob = await getAsset(this.room, asset.id);
    if (!blob) return;
    useCollab.setState((s) => ({ transfers: { ...s.transfers, up: s.transfers.up + 1 } }));
    try {
      for (let offset = 0; offset < blob.size; offset += CHUNK) {
        const part = blob.slice(offset, Math.min(blob.size, offset + CHUNK));
        let ok = false;
        for (let attempt = 0; attempt < 4 && !ok; attempt++) {
          try {
            const res = await this.request(`/assets/${asset.id}?offset=${offset}&total=${blob.size}`, { method: 'PUT', body: part });
            ok = res.ok;
          } catch {
            ok = false;
          }
          if (!ok) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
        if (!ok) throw new Error(`素材「${asset.name}」をアップロードできませんでした`);
      }
    } catch (err) {
      this.uploaded.delete(asset.id);
      useCollab.setState({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      useCollab.setState((s) => ({ transfers: { ...s.transfers, up: s.transfers.up - 1 } }));
    }
  }

  async uploadAll(assets: AssetMeta[]) {
    for (const a of assets) await this.upload(a);
  }

  /** 手元に無い素材をダウンロードする。相手がまだアップロード中なら、終わるまで待つ */
  private async fetchMissingAssets(assets: AssetMeta[]) {
    for (const asset of assets) {
      if (this.downloading.has(asset.id)) continue;
      if (await getAsset(this.room, asset.id)) {
        this.uploaded.add(asset.id);
        continue;
      }
      this.downloading.add(asset.id);
      useCollab.setState((s) => ({ transfers: { ...s.transfers, down: s.transfers.down + 1 } }));
      void (async () => {
        try {
          for (let attempt = 0; attempt < 60 && !this.stopped; attempt++) {
            const res = await this.request(`/assets/${asset.id}`).catch(() => null);
            if (res?.ok) {
              const blob = new Blob([await res.arrayBuffer()], { type: asset.mime });
              await putAsset(this.room, asset.id, blob);
              this.uploaded.add(asset.id);
              media.primeBlob(asset.id, blob);
              await media.ensure(asset);
              editorState().bumpMedia();
              return;
            }
            await new Promise((r) => setTimeout(r, Math.min(10_000, 1000 + attempt * 1000)));
          }
        } finally {
          this.downloading.delete(asset.id);
          useCollab.setState((s) => ({ transfers: { ...s.transfers, down: s.transfers.down - 1 } }));
        }
      })();
    }
  }

  stop() {
    this.stopped = true;
    this.es?.close();
    this.unsub?.();
    clearTimeout(this.presenceTimer);
    clearTimeout(this.flushTimer);
    clearTimeout(this.retryTimer);
    useCollab.setState({ status: 'off', room: null, server: null, users: [], error: null });
  }
}

let session: Session | null = null;

export function currentSession() {
  return session;
}

/** 今のプロジェクトで共同作業を始める（プロジェクトと素材を共有サーバーに置く） */
export async function startCollab(): Promise<string> {
  const server = voicevoxUrl();
  const key = voicevoxKey();
  if (!key) throw new Error('共同作業には共有サーバーが必要です。');
  const { project } = editorState();
  stopCollab();
  const s = new Session(server, key, project.id);
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  let res: Response;
  try {
    res = await fetch(`${server}/collab/${encodeURIComponent(project.id)}/project`, { method: 'PUT', headers, body: JSON.stringify({ project }) });
  } catch {
    throw new Error('共有サーバーに接続できません。共有サーバー（黒い画面）が動いているか確認してください。');
  }
  if (res.status === 401) throw new Error('合言葉が違います。共有リンクをもう一度開いてください。');
  if (!res.ok) throw new Error(`共有サーバーがエラーを返しました（${res.status}）`);
  session = s;
  rememberSession(project.id, { server, key });
  s.connect();
  void s.uploadAll(Object.values(project.assets));
  return inviteLink(server, key, project.id);
}

/** 招待リンクから共同作業に参加する */
export function joinCollab(server: string, key: string, room: string) {
  stopCollab();
  session = new Session(server, key, room);
  rememberSession(room, { server, key });
  session.connect();
}

/** 共同作業をやめる（手元のプロジェクトはそのまま残る） */
export function stopCollab(forget = false) {
  if (session && forget) rememberSession(session.room, null);
  session?.stop();
  session = null;
}

/** 共同作業中だったプロジェクトを開いたら、つなぎ直す */
export function resumeCollabFor(projectId: string) {
  if (session?.room === projectId) return;
  const saved = savedSessions()[projectId];
  if (saved) joinCollab(latestServer(saved), saved.key, projectId);
  else stopCollab();
}

/**
 * 共有サーバーは起動し直すと URL が変わる。合言葉が同じなら、最後に開いた共有リンクの URL につなぐ
 */
function latestServer(saved: SavedSession): string {
  return saved.key === voicevoxKey() && voicevoxUrl() ? voicevoxUrl() : saved.server;
}

/** 新しい共有リンクを開いたとき、共同作業中ならその URL につなぎ直す */
export function retargetCollab() {
  if (!session) return;
  const server = latestServer({ server: session.server, key: session.key });
  if (server !== session.server) joinCollab(server, session.key, session.room);
}
