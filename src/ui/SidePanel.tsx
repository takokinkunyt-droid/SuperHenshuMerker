import { useEffect, useState } from 'react';
import { editorState, useEditor } from '../state/store';
import type { AssetMeta, Character, TachieParts } from '../types';
import {
  addCharacter,
  addScript,
  bulkAssignAudio,
  importAndPlace,
  importAsset,
  placeAsset,
  removeAsset,
  removeCharacter,
  setTachieFromFolder,
  setTachiePart,
  synthesizeMissing,
  updateCharacter,
} from '../state/actions';
import { media } from '../media/mediaCache';
import { useVoicevox } from '../voice/voicevoxStore';
import { DEFAULT_VOICEVOX_URL, setVoicevoxUrl, voicevoxUrl } from '../voice/voicevox';
import { AUDIO_NOTICE, ColorInput, CommitText, Field, FileButton, SliderNumber } from './common';
import { TachiePlacement, TextStyleEditor } from './Inspector';

type Tab = 'chars' | 'script' | 'assets';

export function SidePanel() {
  const [tab, setTab] = useState<Tab>('chars');
  return (
    <aside className="panel side">
      <div className="tabs" role="tablist">
        {(
          [
            ['chars', 'キャラクター'],
            ['script', '台本'],
            ['assets', '素材'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} role="tab" aria-selected={tab === key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="tab-body">
        {tab === 'chars' && <CharacterPanel />}
        {tab === 'script' && <ScriptPanel />}
        {tab === 'assets' && <AssetPanel />}
      </div>
    </aside>
  );
}

// ---------------- キャラクター ----------------

function CharacterPanel() {
  const characters = useEditor((s) => s.project.characters);
  const selectedId = useEditor((s) => s.selectedCharacterId);
  const ch = characters.find((c) => c.id === selectedId) ?? characters[0];
  return (
    <>
      <div className="chips">
        {characters.map((c) => (
          <button
            key={c.id}
            className={`chip ${c.id === ch?.id ? 'active' : ''}`}
            style={{ ['--chip-color' as string]: c.color }}
            onClick={() => editorState().selectCharacter(c.id)}
          >
            {c.name}
          </button>
        ))}
        <button className="chip add" onClick={addCharacter} title="キャラクターを追加">
          ＋
        </button>
      </div>
      {ch && <CharacterEditor key={ch.id} ch={ch} />}
    </>
  );
}

function CharacterEditor({ ch }: { ch: Character }) {
  const set = (recipe: (c: Character) => void) => updateCharacter(ch.id, recipe);
  return (
    <div className="form">
      <Field label="名前">
        <CommitText value={ch.name} onCommit={(v) => set((c) => void (c.name = v || c.name))} />
      </Field>
      <Field label="色">
        <ColorInput value={ch.color} onChange={(v) => set((c) => void (c.color = v))} />
      </Field>

      <details open>
        <summary>声（VOICEVOX）</summary>
        <VoiceSettingsEditor ch={ch} />
      </details>

      <details open>
        <summary>立ち絵</summary>
        <TachieEditor ch={ch} />
        <TachiePlacement ch={ch} />
      </details>

      <details>
        <summary>字幕</summary>
        <TextStyleEditor style={ch.subtitle} onChange={(p) => set((c) => void Object.assign(c.subtitle, p))} />
      </details>

      <button className="btn danger" onClick={() => confirm(`${ch.name} と、そのセリフ・立ち絵をすべて削除しますか？`) && removeCharacter(ch.id)}>
        このキャラクターを削除
      </button>
    </div>
  );
}

function VoiceSettingsEditor({ ch }: { ch: Character }) {
  const { status, error, styles, refresh } = useVoicevox();
  const [url, setUrl] = useState(voicevoxUrl);
  const set = (recipe: (c: Character) => void) => updateCharacter(ch.id, recipe);
  const v = ch.voice;
  // 話者を設定済みなら、話者一覧を取りに一度だけ自動で接続する
  useEffect(() => {
    if (v.speakerId !== null && useVoicevox.getState().status === 'idle') void refresh();
  }, [v.speakerId, refresh]);
  return (
    <div className="form nested">
      <Field label="エンジンURL">
        <input
          type="text"
          value={url}
          placeholder={DEFAULT_VOICEVOX_URL}
          onChange={(e) => setUrl(e.target.value)}
          onBlur={() => setVoicevoxUrl(url || DEFAULT_VOICEVOX_URL)}
        />
      </Field>
      <div className="button-row">
        <button
          className="btn"
          onClick={() => {
            setVoicevoxUrl(url || DEFAULT_VOICEVOX_URL);
            void refresh();
          }}
        >
          {status === 'loading' ? '接続中…' : status === 'ok' ? '再読み込み' : 'VOICEVOXに接続'}
        </button>
        <span className={`status-dot ${status}`}>{status === 'ok' ? `接続済み（${styles.length}スタイル）` : status === 'error' ? '未接続' : ''}</span>
      </div>
      {status === 'error' && (
        <div className="notice error">
          <p>{error}</p>
          <p>
            VOICEVOXを起動したまま、エンジンの設定ページ{' '}
            <a href={`${voicevoxUrl()}/setting`} target="_blank" rel="noreferrer">
              {voicevoxUrl()}/setting
            </a>{' '}
            を開き、「Allow Origin」に <code>{location.origin}</code> を入れて保存し、VOICEVOXを再起動してください。
          </p>
          <p>
            コマンドで起動する場合は <code>run --allow_origin {location.origin}</code>。ブラウザに「ローカルネットワークへのアクセス」の確認が出たら許可してください。
          </p>
          <p>iPad・Chromebookなど VOICEVOX が動かない環境では、「音声ファイルを割り当て」を使ってください。</p>
        </div>
      )}
      <Field label="話者">
        <select
          value={v.speakerId ?? ''}
          onChange={(e) => {
            const id = e.target.value === '' ? null : Number(e.target.value);
            const style = styles.find((s) => s.id === id);
            set((c) => {
              c.voice.speakerId = id;
              c.voice.speakerName = style?.speakerName ?? (id === null ? '' : c.voice.speakerName);
            });
          }}
        >
          <option value="">なし（音声ファイルを使う）</option>
          {v.speakerId !== null && !styles.some((s) => s.id === v.speakerId) && (
            <option value={v.speakerId}>
              {v.speakerName || '話者'}（ID {v.speakerId}）
            </option>
          )}
          {styles.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Field>
      {v.speakerId !== null && (
        <>
          <Field label="話速">
            <SliderNumber value={v.speedScale} min={0.5} max={2} step={0.05} onChange={(x) => set((c) => void (c.voice.speedScale = x))} />
          </Field>
          <Field label="音高">
            <SliderNumber value={v.pitchScale} min={-0.15} max={0.15} step={0.01} onChange={(x) => set((c) => void (c.voice.pitchScale = x))} />
          </Field>
          <Field label="抑揚">
            <SliderNumber value={v.intonationScale} min={0} max={2} step={0.05} onChange={(x) => set((c) => void (c.voice.intonationScale = x))} />
          </Field>
          <Field label="音量">
            <SliderNumber value={v.volumeScale} min={0} max={2} step={0.05} onChange={(x) => set((c) => void (c.voice.volumeScale = x))} />
          </Field>
          <p className="muted small">
            VOICEVOXの音声を使った動画には「VOICEVOX:{v.speakerName || '話者名'}」のクレジット表記が必要です（書き出し画面で自動生成します）。各キャラクターの利用規約も確認してください。
          </p>
        </>
      )}
    </div>
  );
}

const PART_LABELS: [keyof TachieParts, string][] = [
  ['base', '体（ベース）'],
  ['eyesOpen', '目・開'],
  ['eyesClosed', '目・閉'],
  ['mouthClosed', '口・閉'],
  ['mouthHalf', '口・半開き'],
  ['mouthOpen', '口・開'],
];

function TachieEditor({ ch }: { ch: Character }) {
  return (
    <div className="tachie-parts">
      <p className="muted small">同じ大きさの透過PNGパーツを重ねて表示します。未設定ならシンプルな仮キャラが表示されます。</p>
      <div className="parts-grid">
        {PART_LABELS.map(([part, label]) => (
          <PartSlot key={part} ch={ch} part={part} label={label} />
        ))}
      </div>
      <FileButton
        multiple
        accept="image/*"
        title="ファイル名（base, eye_open, eye_close, mouth_open, mouth_half, mouth_close など）から自動で割り当てます"
        onFiles={async (files) => {
          const n = await setTachieFromFolder(ch.id, files);
          editorState().toast(n ? `${n}個のパーツを割り当てました` : 'ファイル名からパーツを判別できませんでした', n ? 'info' : 'error');
        }}
      >
        パーツをまとめて読み込む
      </FileButton>
    </div>
  );
}

function useAssetUrl(assetId: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!assetId) return setUrl(null);
    let objectUrl: string | null = null;
    let cancelled = false;
    void media.blob(assetId).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setUrl(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [assetId]);
  return url;
}

function PartSlot({ ch, part, label }: { ch: Character; part: keyof TachieParts; label: string }) {
  const assetId = ch.tachie[part];
  const url = useAssetUrl(assetId);
  return (
    <div className="part-slot">
      <FileButton className="part-thumb" accept="image/*" title={`${label}の画像を選ぶ`} onFiles={(f) => setTachiePart(ch.id, part, f[0])}>
        {url ? <img src={url} alt={label} /> : <span>＋</span>}
      </FileButton>
      <span className="part-label">
        {label}
        {assetId && (
          <button className="link" onClick={() => setTachiePart(ch.id, part, null)} aria-label={`${label}を外す`}>
            ✕
          </button>
        )}
      </span>
    </div>
  );
}

// ---------------- 台本 ----------------

function ScriptPanel() {
  const characters = useEditor((s) => s.project.characters);
  const busy = useEditor((s) => s.busy);
  const [script, setScript] = useState('');
  const [charId, setCharId] = useState(characters[0]?.id ?? '');
  const effectiveChar = characters.some((c) => c.id === charId) ? charId : characters[0]?.id ?? '';
  const example = characters
    .slice(0, 2)
    .map((c, i) => `${c.name}：${i === 0 ? 'こんにちは！今日は動画の作り方を解説するよ。' : 'よろしくお願いします。'}`)
    .join('\n');
  return (
    <div className="form">
      <p className="muted small">
        1行に1セリフ。「キャラ名：セリフ」と書くとそのキャラのセリフになります。名前の無い行は直前のキャラが話します。
      </p>
      <textarea className="script" rows={12} value={script} placeholder={example} onChange={(e) => setScript(e.target.value)} />
      <Field label="最初のキャラ">
        <select value={effectiveChar} onChange={(e) => setCharId(e.target.value)}>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <button
        className="btn primary"
        disabled={!script.trim() || !!busy}
        onClick={async () => {
          const n = await addScript(script, effectiveChar);
          if (n) {
            editorState().toast(`${n}個のセリフを追加しました`);
            setScript('');
          }
        }}
      >
        台本をタイムラインに追加
      </button>
      <hr />
      <button className="btn" disabled={!!busy} onClick={() => void synthesizeMissing()}>
        未作成のセリフ音声をまとめて作成（VOICEVOX）
      </button>
      <FileButton
        multiple
        accept="audio/*,.wav,.mp3,.m4a,.ogg"
        title="ファイル名順に、音声の無いセリフへ前から割り当てます"
        onFiles={async (files) => {
          const n = await bulkAssignAudio(files);
          editorState().toast(n ? `${n}個のセリフに音声を割り当てました` : '音声の無いセリフがありません');
        }}
      >
        音声ファイルを一括割り当て
      </FileButton>
      <p className="muted small">
        一括割り当ては、ファイル名の順（例: 001.wav, 002.wav …）に、音声の無いセリフへ前から割り当てます。{AUDIO_NOTICE}
      </p>
    </div>
  );
}

// ---------------- 素材 ----------------

const KIND_ICON = { image: '🖼', video: '🎞', audio: '🎵' } as const;

function formatSize(bytes: number) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  return `${Math.ceil(bytes / 1e3)}KB`;
}

function AssetPanel() {
  const assets = useEditor((s) => s.project.assets);
  const list = Object.values(assets).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return (
    <div className="form">
      <div className="button-row">
        <FileButton multiple className="btn primary" accept="image/*,video/*,audio/*" onFiles={(files) => void importAndPlace(files)}>
          素材を読み込んで配置
        </FileButton>
        <FileButton
          multiple
          accept="image/*,video/*,audio/*"
          onFiles={async (files) => {
            for (const f of files) await importAsset(f, f.name);
          }}
        >
          読み込みのみ
        </FileButton>
      </div>
      <p className="muted small">PNG/JPG、MP4、MP3/WAV に対応。画面にドラッグ＆ドロップしても読み込めます。素材はブラウザ内に保存され、外部へは送信されません。</p>
      <ul className="asset-list">
        {list.map((a) => (
          <AssetRow key={a.id} asset={a} />
        ))}
        {!list.length && <li className="muted">まだ素材がありません</li>}
      </ul>
    </div>
  );
}

function AssetRow({ asset }: { asset: AssetMeta }) {
  return (
    <li className="asset-row">
      <span className="asset-icon">{KIND_ICON[asset.kind]}</span>
      <span className="asset-name" title={asset.name}>
        {asset.name}
        <small>
          {asset.duration ? `${asset.duration.toFixed(1)}秒 · ` : ''}
          {asset.width ? `${asset.width}×${asset.height} · ` : ''}
          {formatSize(asset.size)}
        </small>
      </span>
      <button className="btn small" onClick={() => placeAsset(asset)} title="再生位置に配置">
        配置
      </button>
      <button className="icon-btn" onClick={() => removeAsset(asset.id)} title="素材を削除">
        ✕
      </button>
    </li>
  );
}
