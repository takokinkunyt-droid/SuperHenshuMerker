// 合成音声（VOICEVOX）で音声を作ってタイムラインに置く、作り直す、クレジットを作る。
import type { AudioItem, Project, TextItem, TtsInfo, VoiceSettings } from '../types';
import { editorState } from './store';
import { LAYER, defaultTextStyle, uid } from './defaults';
import { findFreeLayer } from './timeline';
import { importBlob } from '../media/importer';
import { synthesize } from '../voice/voicevox';

/** 音声と音声の間の間（秒） */
const GAP = 0.2;
const VOICE_KEY = 'shm.voice';

export function loadLastVoice(): VoiceSettings | null {
  try {
    const raw = localStorage.getItem(VOICE_KEY);
    return raw ? (JSON.parse(raw) as VoiceSettings) : null;
  } catch {
    return null;
  }
}

export function saveLastVoice(voice: VoiceSettings) {
  try {
    localStorage.setItem(VOICE_KEY, JSON.stringify(voice));
  } catch {
    // 保存できなくても今回は使える
  }
}

/** 1行を1つの音声として作り、再生位置から順に並べる。字幕を付けるなら同じ長さのテキストも置く */
export async function speakAndPlace(lines: string[], voice: VoiceSettings, withSubtitle: boolean): Promise<number> {
  const s = editorState();
  const texts = lines.map((l) => l.trim()).filter(Boolean);
  let at = s.currentTime;
  let made = 0;
  try {
    for (let i = 0; i < texts.length; i++) {
      s.setBusy(`音声を作成中… ${i + 1} / ${texts.length}`);
      const text = texts[i];
      const wav = await synthesize(text, voice);
      const meta = await importBlob(editorState().project.id, wav, `${voice.speakerName}_${text.slice(0, 16)}.wav`);
      const duration = meta.duration ?? 1;
      const start = at;
      editorState().edit((d) => {
        d.assets[meta.id] = meta;
        const subtitleId = withSubtitle ? uid() : null;
        const audio: AudioItem = {
          kind: 'audio',
          id: uid(),
          assetId: meta.id,
          start,
          duration,
          sourceOffset: 0,
          volume: 1,
          layer: findFreeLayer(d.items, start, start + duration, LAYER.audio),
          tts: { ...voice, text, subtitleId },
        };
        d.items.push(audio);
        if (subtitleId) {
          const sub: TextItem = {
            kind: 'text',
            id: subtitleId,
            text,
            start,
            duration,
            layer: findFreeLayer(d.items, start, start + duration, LAYER.text),
            style: defaultTextStyle(d.width, d.height),
          };
          d.items.push(sub);
        }
      });
      at = start + duration + GAP;
      made++;
    }
  } finally {
    editorState().setBusy(null);
  }
  return made;
}

/** 読み上げの文字や声を変えて、音声を作り直す。一緒に作った字幕も文字と長さを合わせる */
export async function regenerateTts(itemId: string, change: Partial<TtsInfo>): Promise<void> {
  const s = editorState();
  const item = s.project.items.find((it): it is AudioItem => it.id === itemId && it.kind === 'audio');
  if (!item?.tts) return;
  const tts: TtsInfo = { ...item.tts, ...change };
  if (!tts.text.trim()) return;
  s.setBusy('音声を作り直しています…');
  try {
    const wav = await synthesize(tts.text, tts);
    const meta = await importBlob(editorState().project.id, wav, `${tts.speakerName}_${tts.text.slice(0, 16)}.wav`);
    const duration = meta.duration ?? item.duration;
    editorState().edit((d) => {
      d.assets[meta.id] = meta;
      const it = d.items.find((x): x is AudioItem => x.id === itemId && x.kind === 'audio');
      if (!it) return;
      it.assetId = meta.id;
      it.sourceOffset = 0;
      it.duration = duration;
      it.tts = tts;
      const sub = tts.subtitleId ? d.items.find((x): x is TextItem => x.id === tts.subtitleId && x.kind === 'text') : undefined;
      if (sub) {
        sub.text = tts.text;
        sub.start = it.start;
        sub.duration = duration;
      }
    });
  } catch (err) {
    editorState().toast(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    editorState().setBusy(null);
  }
}

/** 使った合成音声の話者から、動画の説明欄に貼るクレジットを作る（例: VOICEVOX:ずんだもん） */
export function buildCredits(project: Project): string {
  const names = new Set<string>();
  for (const it of project.items) if (it.kind === 'audio' && it.tts) names.add(it.tts.speakerName);
  return [...names].map((n) => `VOICEVOX:${n}`).join('\n');
}
