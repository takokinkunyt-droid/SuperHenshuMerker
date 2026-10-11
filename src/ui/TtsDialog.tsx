// 合成音声（VOICEVOX）で読み上げ音声を作って、再生位置から並べるパネル。
import { useEffect, useRef, useState } from 'react';
import { editorState, useEditor } from '../state/store';
import type { VoiceSettings } from '../types';
import { useVoicevox } from '../voice/voicevoxStore';
import { DEFAULT_VOICEVOX_URL, applyShareText, isLocalVoicevox, setVoicevoxKey, setVoicevoxUrl, synthesize, voicevoxKey, voicevoxUrl } from '../voice/voicevox';
import { loadLastVoice, saveLastVoice, speakAndPlace } from '../state/ttsActions';
import { Field, Modal, SliderNumber } from './common';

const DEFAULT_VOICE: Omit<VoiceSettings, 'speakerId' | 'speakerName' | 'styleLabel'> = {
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
};

/** VOICEVOXに接続できないときの案内 */
export function VoicevoxHelp({ error }: { error: string | null }) {
  // 合言葉を使っている＝友達の共有サーバーにつないでいる
  if (!isLocalVoicevox() || voicevoxKey()) {
    return (
      <div className="notice error">
        {error && <p>{error}</p>}
        <p>共有している人に、パソコンで共有サーバーが動いているか確認して、新しい共有リンクを送ってもらってください。</p>
      </div>
    );
  }
  if (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches) {
    return (
      <div className="notice error">
        {error && <p>{error}</p>}
        <p className="small">
          LINEで受け取ったリンクは、LINEの中ではなく「ブラウザで開く」（Safari／Chrome）で開いてください。または、届いたリンクをコピーして、上の「共有リンク」欄に貼り付けてください。
        </p>
      </div>
    );
  }
  return (
    <div className="notice error">
      {error && <p>{error}</p>}
      <p>パソコンでVOICEVOXを起動してから「接続」を押してください。このページから使うには、最初に1回だけ次の設定が必要です。</p>
      <ol className="small">
        <li>
          VOICEVOXを起動したまま、ブラウザで{' '}
          <a href={`${voicevoxUrl()}/setting`} target="_blank" rel="noreferrer">
            {voicevoxUrl()}/setting
          </a>{' '}
          を開く
        </li>
        <li>
          「Allow Origin」に <code>{location.origin}</code> を入れて保存
        </li>
        <li>VOICEVOXを再起動する</li>
      </ol>
      <p className="small">ブラウザに「ローカルネットワークへのアクセス」の確認が出たら許可してください。スマホではVOICEVOXが動かないため、パソコンで使ってください。</p>
    </div>
  );
}

export function TtsDialog() {
  const open = useEditor((s) => s.ttsOpen);
  if (!open) return null;
  return <TtsPanel onClose={() => editorState().setTtsOpen(false)} />;
}

function TtsPanel({ onClose }: { onClose: () => void }) {
  const { status, error, styles, refresh } = useVoicevox();
  const busy = useEditor((s) => s.busy);
  const [url, setUrl] = useState(voicevoxUrl);
  const [key, setKey] = useState(voicevoxKey);
  const last = loadLastVoice();
  const [speakerId, setSpeakerId] = useState<number | null>(last?.speakerId ?? null);
  const [params, setParams] = useState({ ...DEFAULT_VOICE, ...(last ?? {}) });
  const [text, setText] = useState('');
  const [subtitle, setSubtitle] = useState(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    if (status === 'idle') void refresh();
  }, [status, refresh]);

  const style = styles.find((s) => s.id === speakerId) ?? null;
  const voice: VoiceSettings | null = style
    ? { ...params, speakerId: style.id, speakerName: style.speakerName, styleLabel: style.label }
    : null;
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  const connect = () => {
    setVoicevoxUrl(url || DEFAULT_VOICEVOX_URL);
    setVoicevoxKey(key.trim());
    void refresh();
  };

  const preview = async () => {
    if (!voice) return;
    try {
      const wav = await synthesize(lines[0] ?? 'こんにちは。テストです。', voice);
      audioRef.current?.pause();
      const a = new Audio(URL.createObjectURL(wav));
      audioRef.current = a;
      await a.play();
    } catch (err) {
      editorState().toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  const create = async () => {
    if (!voice || !lines.length) return;
    saveLastVoice(voice);
    try {
      const n = await speakAndPlace(lines, voice, subtitle);
      editorState().toast(`${n}個の音声を作成して配置しました`);
      setText('');
      onClose();
    } catch (err) {
      editorState().toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <Modal title="🗣 読み上げ（合成音声）" onClose={onClose} wide>
      <div className="form">
        <Field label="共有リンク" hint="友達から届いたリンクを貼り付けると、接続先と合言葉が自動で入ります">
          <input
            type="text"
            value=""
            placeholder="https://…#voicevox=…（ここに貼り付け）"
            onChange={(e) => {
              if (applyShareText(e.target.value)) {
                setUrl(voicevoxUrl());
                setKey(voicevoxKey());
                void refresh();
                editorState().toast('共有リンクから接続先を設定しました');
              } else if (e.target.value.trim()) {
                editorState().toast('共有リンクの形が正しくありません。届いたリンクをそのまま貼り付けてください', 'error');
              }
            }}
          />
        </Field>
        <Field label="VOICEVOX">
          <span className="slider-number">
            <input type="text" value={url} placeholder={DEFAULT_VOICEVOX_URL} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn" onClick={connect}>
              {status === 'loading' ? '接続中…' : status === 'ok' ? '再接続' : '接続'}
            </button>
          </span>
        </Field>
        <Field label="合言葉" hint="友達のVOICEVOXを使うときだけ（共有リンクを開けば自動で入ります）">
          <input type="password" value={key} autoComplete="off" placeholder="自分のパソコンなら空のまま" onChange={(e) => setKey(e.target.value)} />
        </Field>
        {status === 'ok' && (
          <p className="muted small">
            接続済み（{styles.length}種類の声）・接続先：{isLocalVoicevox() && !voicevoxKey() ? 'このパソコンのVOICEVOX' : '共有サーバー'}
          </p>
        )}
        {status === 'error' && <VoicevoxHelp error={error} />}

        <Field label="声">
          <select value={speakerId ?? ''} onChange={(e) => setSpeakerId(e.target.value === '' ? null : Number(e.target.value))}>
            <option value="">選んでください</option>
            {styles.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="話速">
          <SliderNumber value={params.speedScale} min={0.5} max={2} step={0.05} onChange={(v) => setParams({ ...params, speedScale: v })} />
        </Field>
        <Field label="音高">
          <SliderNumber value={params.pitchScale} min={-0.15} max={0.15} step={0.01} onChange={(v) => setParams({ ...params, pitchScale: v })} />
        </Field>
        <Field label="抑揚">
          <SliderNumber value={params.intonationScale} min={0} max={2} step={0.05} onChange={(v) => setParams({ ...params, intonationScale: v })} />
        </Field>
        <Field label="音量">
          <SliderNumber value={params.volumeScale} min={0} max={2} step={0.05} onChange={(v) => setParams({ ...params, volumeScale: v })} />
        </Field>

        <label className="field-label" htmlFor="tts-text">
          読み上げる文章（1行ごとに1つの音声になり、再生位置から順に並びます）
        </label>
        <textarea
          id="tts-text"
          className="script"
          rows={6}
          value={text}
          placeholder={'こんにちは！\n今日は動画の作り方を紹介します。'}
          onChange={(e) => setText(e.target.value)}
        />
        <label className="check-row">
          <input type="checkbox" checked={subtitle} onChange={(e) => setSubtitle(e.target.checked)} /> 同じ文章の字幕（テキスト）も一緒に追加する
        </label>
        <div className="button-row">
          <button className="btn primary" disabled={!voice || !lines.length || !!busy} onClick={() => void create()}>
            {busy ?? `音声を作成して配置（${lines.length}個）`}
          </button>
          <button className="btn" disabled={!voice || !!busy} onClick={() => void preview()}>
            ▶ 試し聞き
          </button>
        </div>
        <p className="muted small">
          VOICEVOXの声を使った動画には「VOICEVOX:キャラ名」のクレジット表記が必要です（書き出し画面に自動で表示されます）。声ごとの利用規約も確認してください。
        </p>
      </div>
    </Modal>
  );
}
