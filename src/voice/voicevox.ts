// ユーザーのPCで動くVOICEVOXエンジンにブラウザから接続する。
// エンジン側でCORSを許可する起動オプション（例: --cors_policy_mode all）が必要。
import type { VoiceSettings } from '../types';

export const DEFAULT_VOICEVOX_URL = 'http://127.0.0.1:50021';
const URL_KEY = 'shm.voicevoxUrl';

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

async function call(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${voicevoxUrl()}${path}`, init);
  } catch {
    throw new Error(
      'VOICEVOXエンジンに接続できません。エンジンが起動しているか、CORSを許可する設定になっているか確認してください。',
    );
  }
  if (!res.ok) throw new Error(`VOICEVOXエンジンがエラーを返しました (${res.status})`);
  return res;
}

export async function fetchStyles(): Promise<VoicevoxStyle[]> {
  const res = await call('/speakers');
  const speakers = (await res.json()) as { name: string; styles: { name: string; id: number }[] }[];
  return speakers.flatMap((sp) =>
    sp.styles.map((st) => ({ id: st.id, speakerName: sp.name, label: `${sp.name}（${st.name}）` })),
  );
}

/** テキストを読み上げたWAVを返す */
export async function synthesize(text: string, voice: VoiceSettings): Promise<Blob> {
  if (voice.speakerId === null) throw new Error('VOICEVOXの話者が設定されていません');
  const speaker = voice.speakerId;
  const queryRes = await call(`/audio_query?text=${encodeURIComponent(text)}&speaker=${speaker}`, { method: 'POST' });
  const query = await queryRes.json();
  query.speedScale = voice.speedScale;
  query.pitchScale = voice.pitchScale;
  query.intonationScale = voice.intonationScale;
  query.volumeScale = voice.volumeScale;
  query.prePhonemeLength = 0.05;
  query.postPhonemeLength = 0.05;
  const res = await call(`/synthesis?speaker=${speaker}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  return new Blob([await res.arrayBuffer()], { type: 'audio/wav' });
}
