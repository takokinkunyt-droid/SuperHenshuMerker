// ユーザーのPCで動くVOICEVOXエンジンにブラウザから接続して、合成音声を作る。
// localhost 以外（GitHub Pages など）から使うときは、エンジン側でこのページのオリジンを許可する必要がある。
import type { VoiceSettings } from '../types';

export const DEFAULT_VOICEVOX_URL = 'http://127.0.0.1:50021';
const URL_KEY = 'shm.voicevoxUrl';
const PASS_KEY = 'shm.voicevoxKey';

export interface VoicevoxStyle {
  id: number;
  /** 例: ずんだもん（ノーマル） */
  label: string;
  speakerName: string;
}

export function voicevoxUrl(): string {
  try {
    return localStorage.getItem(URL_KEY) || DEFAULT_VOICEVOX_URL;
  } catch {
    return DEFAULT_VOICEVOX_URL;
  }
}

export function setVoicevoxUrl(url: string) {
  try {
    localStorage.setItem(URL_KEY, url.replace(/\/+$/, ''));
  } catch {
    // 保存できなくても今回の接続には使える
  }
}

/** 友達のVOICEVOX（共有サーバー）に入るための合言葉 */
export function voicevoxKey(): string {
  try {
    return localStorage.getItem(PASS_KEY) || '';
  } catch {
    return '';
  }
}

export function setVoicevoxKey(key: string) {
  try {
    if (key) localStorage.setItem(PASS_KEY, key);
    else localStorage.removeItem(PASS_KEY);
  } catch {
    // 保存できなくても今回の接続には使える
  }
}

/** 自分のパソコンのVOICEVOXか（共有サーバーではないか） */
export function isLocalVoicevox(url = voicevoxUrl()): boolean {
  return /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/|$)/.test(url);
}

/**
 * 共有リンク（…#voicevox=URL&key=合言葉）で開かれたら、読み上げの接続先を設定してリンクから消す。
 * 設定したら true を返す。
 */
export function applyShareLink(): boolean {
  if (typeof location === 'undefined' || !location.hash.includes('voicevox=')) return false;
  const ok = applyShareText(location.hash);
  if (ok) history.replaceState(null, '', location.pathname + location.search);
  return ok;
}

/** 貼り付けられた共有リンク（の一部）から接続先と合言葉を取り出して設定する。できたら true */
export function applyShareText(text: string): boolean {
  const i = text.indexOf('voicevox=');
  if (i < 0) return false;
  const params = new URLSearchParams(text.slice(i).trim());
  const url = params.get('voicevox');
  if (!url || !/^https?:\/\//.test(url)) return false;
  setVoicevoxUrl(url);
  setVoicevoxKey(params.get('key') ?? '');
  return true;
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const key = voicevoxKey();
  const headers = new Headers(init.headers);
  if (key) headers.set('Authorization', `Bearer ${key}`);
  let res: Response;
  try {
    res = await fetch(`${voicevoxUrl()}${path}`, { ...init, headers });
  } catch {
    const local = isLocalVoicevox() && !key;
    const phone = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;
    throw new Error(
      local && phone
        ? 'このスマホには読み上げの接続先が設定されていません。VOICEVOXを持っている人から届いた「共有リンク」を開くか、「共有リンク」欄に貼り付けてください。'
        : local
          ? 'VOICEVOXに接続できません。VOICEVOXが起動しているか、このページからの接続を許可しているか確認してください。'
          : '読み上げサーバーに接続できません。共有している人のパソコンで共有サーバー（黒い画面）が動いているか確認し、新しい共有リンクを送ってもらってください。',
    );
  }
  if (res.status === 401) throw new Error('合言葉が違います。共有リンクをもう一度開いてください。');
  if (!res.ok) throw new Error(`VOICEVOXがエラーを返しました (${res.status})`);
  return res;
}

export async function fetchStyles(): Promise<VoicevoxStyle[]> {
  const res = await call('/speakers');
  const speakers = (await res.json()) as { name: string; styles: { name: string; id: number; type?: string }[] }[];
  return speakers.flatMap((sp) =>
    sp.styles
      // 歌唱用のスタイルは読み上げに使えないので除く
      .filter((st) => !st.type || st.type === 'talk')
      .map((st) => ({ id: st.id, speakerName: sp.name, label: `${sp.name}（${st.name}）` })),
  );
}

/** テキストを読み上げたWAVを返す */
export async function synthesize(text: string, voice: VoiceSettings): Promise<Blob> {
  const speaker = voice.speakerId;
  const queryRes = await call(`/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { method: 'POST' });
  const query = await queryRes.json();
  query.speedScale = voice.speedScale;
  query.pitchScale = voice.pitchScale;
  query.intonationScale = voice.intonationScale;
  query.volumeScale = voice.volumeScale;
  query.prePhonemeLength = 0.05;
  query.postPhonemeLength = 0.1;
  const res = await call(`/synthesis?speaker=${speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  return new Blob([await res.arrayBuffer()], { type: 'audio/wav' });
}
