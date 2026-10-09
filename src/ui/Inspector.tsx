import { editorState, useEditor } from '../state/store';
import type { Character, Placement, TextStyle, TimelineItem, VoiceItem } from '../types';
import { FONT_FAMILIES, MIN_ITEM_DURATION } from '../state/defaults';
import { assignAudioFile, deleteItem, synthesizeItem, updateCharacter, updateItem } from '../state/actions';
import { media } from '../media/mediaCache';
import { playback } from '../media/playback';
import { AUDIO_NOTICE, ColorInput, CommitText, Field, FileButton, NumberInput, SliderNumber } from './common';

const KIND_TITLE: Record<TimelineItem['kind'], string> = {
  voice: 'セリフ',
  tachie: '立ち絵',
  text: 'テキスト',
  image: '画像',
  video: '動画',
  audio: '音声・BGM',
};

export function Inspector() {
  const item = useEditor((s) => s.project.items.find((it) => it.id === s.selectedItemId));
  return (
    <aside className="panel inspector">
      {item ? <ItemInspector item={item} /> : <ProjectInspector />}
    </aside>
  );
}

function ProjectInspector() {
  const project = useEditor((s) => s.project);
  const edit = useEditor((s) => s.edit);
  return (
    <>
      <h3 className="panel-title">プロジェクト</h3>
      <div className="form">
        <Field label="名前">
          <CommitText value={project.name} onCommit={(v) => edit((d) => void (d.name = v || '無題'))} />
        </Field>
        <Field label="背景色">
          <ColorInput value={project.backgroundColor} onChange={(v) => edit((d) => void (d.backgroundColor = v))} />
        </Field>
        <Field label="解像度">
          <span className="readonly">
            {project.width}×{project.height} / {project.fps}fps
          </span>
        </Field>
      </div>
      <p className="muted small">タイムラインのアイテムを選ぶと、ここで詳しく設定できます。</p>
    </>
  );
}

function ItemInspector({ item }: { item: TimelineItem }) {
  const update = (patch: Partial<TimelineItem>) => updateItem(item.id, patch);
  return (
    <>
      <h3 className="panel-title">
        {KIND_TITLE[item.kind]}
        <button className="btn small danger" onClick={() => deleteItem(item.id)}>
          削除
        </button>
      </h3>
      <div className="form">
        <Field label="開始(秒)">
          <NumberInput value={item.start} min={0} step={0.1} onChange={(v) => update({ start: v })} />
        </Field>
        <Field label="長さ(秒)">
          <NumberInput value={item.duration} min={MIN_ITEM_DURATION} step={0.1} onChange={(v) => update({ duration: v })} />
        </Field>
        <Field label="レイヤー">
          <NumberInput value={item.layer} min={0} step={1} digits={0} onChange={(v) => update({ layer: Math.round(v) })} />
        </Field>
      </div>
      {item.kind === 'voice' && <VoiceInspector item={item} />}
      {item.kind === 'tachie' && <TachieInspector characterId={item.characterId} />}
      {item.kind === 'text' && (
        <div className="form">
          <Field label="テキスト">
            <CommitText multiline value={item.text} onCommit={(text) => update({ text })} />
          </Field>
          <TextStyleEditor style={item.style} onChange={(style) => update({ style: { ...item.style, ...style } })} />
        </div>
      )}
      {(item.kind === 'image' || item.kind === 'video') && (
        <PlacementEditor value={item} onChange={(p) => update(p)} />
      )}
      {(item.kind === 'video' || item.kind === 'audio') && (
        <div className="form">
          <Field label="音量">
            <SliderNumber value={item.volume} min={0} max={2} step={0.05} onChange={(volume) => update({ volume })} />
          </Field>
          <Field label="素材の開始位置(秒)">
            <NumberInput value={item.sourceOffset} min={0} step={0.1} onChange={(sourceOffset) => update({ sourceOffset })} />
          </Field>
        </div>
      )}
    </>
  );
}

function VoiceInspector({ item }: { item: VoiceItem }) {
  const characters = useEditor((s) => s.project.characters);
  const asset = useEditor((s) => (item.audioAssetId ? s.project.assets[item.audioAssetId] : undefined));
  const ch = characters.find((c) => c.id === item.characterId);
  const update = (patch: Partial<VoiceItem>) => updateItem(item.id, patch);
  const canSynth = ch?.voice.speakerId != null;
  return (
    <div className="form">
      <Field label="キャラ">
        <select value={item.characterId} onChange={(e) => update({ characterId: e.target.value })}>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="セリフ" hint="Ctrl+Enterで確定">
        <CommitText
          multiline
          value={item.text}
          onCommit={(text) => {
            update({ text });
            // VOICEVOXで作った音声は、セリフを変えたら作り直す
            if (canSynth && item.audioOrigin !== 'file') void synthesizeItem(item.id);
          }}
        />
      </Field>
      <Field label="音声">
        <span className="readonly">{asset ? asset.name : '未設定（字幕のみ）'}</span>
      </Field>
      <div className="button-row">
        <button
          className="btn primary"
          disabled={!canSynth}
          title={canSynth ? 'VOICEVOXで読み上げ音声を作る' : 'キャラ設定でVOICEVOXの話者を選んでください'}
          onClick={async () => {
            editorState().setBusy('音声を作成中…');
            await synthesizeItem(item.id);
            editorState().setBusy(null);
          }}
        >
          {asset ? '音声を作り直す' : '音声を作成'}
        </button>
        <FileButton accept="audio/*,.wav,.mp3,.m4a,.ogg" onFiles={(files) => assignAudioFile(item.id, files[0])}>
          音声ファイルを割り当て
        </FileButton>
        <button
          className="btn"
          disabled={!asset}
          onClick={() => {
            const buf = media.audioBuffer(item.audioAssetId);
            if (buf) void playback.audition(buf, item.audioOffset, item.duration);
          }}
        >
          ▶ 試聴
        </button>
      </div>
      <p className="muted small">{AUDIO_NOTICE}</p>
      <Field label="音量">
        <SliderNumber value={item.volume} min={0} max={2} step={0.05} onChange={(volume) => update({ volume })} />
      </Field>
      <Field label="字幕を表示">
        <input type="checkbox" checked={item.showSubtitle} onChange={(e) => update({ showSubtitle: e.target.checked })} />
      </Field>
      <p className="muted small">字幕の見た目はキャラクター設定で変更します（プレビュー上でドラッグすると位置を動かせます）。</p>
    </div>
  );
}

function TachieInspector({ characterId }: { characterId: string }) {
  const ch = useEditor((s) => s.project.characters.find((c) => c.id === characterId));
  if (!ch) return null;
  return (
    <div className="form">
      <Field label="キャラ">
        <span className="readonly">{ch.name}</span>
      </Field>
      <TachiePlacement ch={ch} />
      <p className="muted small">立ち絵の画像はキャラクター設定で指定します。プレビュー上でドラッグすると位置を動かせます。</p>
    </div>
  );
}

export function TachiePlacement({ ch }: { ch: Character }) {
  const set = (recipe: (c: Character) => void) => updateCharacter(ch.id, recipe);
  return (
    <>
      <Field label="X（中心）">
        <NumberInput value={ch.tachieX} step={10} digits={0} onChange={(v) => set((c) => void (c.tachieX = v))} />
      </Field>
      <Field label="Y（下端）">
        <NumberInput value={ch.tachieY} step={10} digits={0} onChange={(v) => set((c) => void (c.tachieY = v))} />
      </Field>
      <Field label="拡大率">
        <SliderNumber value={ch.tachieScale} min={0.1} max={3} step={0.05} onChange={(v) => set((c) => void (c.tachieScale = v))} />
      </Field>
      <Field label="左右反転">
        <input type="checkbox" checked={ch.tachieFlip} onChange={(e) => set((c) => void (c.tachieFlip = e.target.checked))} />
      </Field>
    </>
  );
}

function PlacementEditor({ value, onChange }: { value: Placement; onChange: (p: Partial<Placement>) => void }) {
  return (
    <div className="form">
      <Field label="X（中心）">
        <NumberInput value={value.x} step={10} digits={0} onChange={(x) => onChange({ x })} />
      </Field>
      <Field label="Y（中心）">
        <NumberInput value={value.y} step={10} digits={0} onChange={(y) => onChange({ y })} />
      </Field>
      <Field label="拡大率">
        <SliderNumber value={value.scale} min={0.05} max={4} step={0.01} onChange={(scale) => onChange({ scale })} />
      </Field>
      <Field label="不透明度">
        <SliderNumber value={value.opacity} min={0} max={1} step={0.01} onChange={(opacity) => onChange({ opacity })} />
      </Field>
    </div>
  );
}

export function TextStyleEditor({ style, onChange }: { style: TextStyle; onChange: (s: Partial<TextStyle>) => void }) {
  return (
    <>
      <Field label="フォント">
        <select value={style.fontFamily} onChange={(e) => onChange({ fontFamily: e.target.value })}>
          {FONT_FAMILIES.map((f) => (
            <option key={f} value={f}>
              {f.split(',')[0].replace(/"/g, '')}
            </option>
          ))}
        </select>
      </Field>
      <Field label="サイズ">
        <SliderNumber value={style.fontSize} min={12} max={200} step={1} digits={0} onChange={(fontSize) => onChange({ fontSize })} />
      </Field>
      <Field label="太字">
        <input type="checkbox" checked={style.bold} onChange={(e) => onChange({ bold: e.target.checked })} />
      </Field>
      <Field label="文字色">
        <ColorInput value={style.color} onChange={(color) => onChange({ color })} />
      </Field>
      <Field label="縁取り色">
        <ColorInput value={style.strokeColor} onChange={(strokeColor) => onChange({ strokeColor })} />
      </Field>
      <Field label="縁取りの太さ">
        <SliderNumber value={style.strokeWidth} min={0} max={30} step={1} digits={0} onChange={(strokeWidth) => onChange({ strokeWidth })} />
      </Field>
      <Field label="X（中心）">
        <NumberInput value={style.x} step={10} digits={0} onChange={(x) => onChange({ x })} />
      </Field>
      <Field label="Y（下端）">
        <NumberInput value={style.y} step={10} digits={0} onChange={(y) => onChange({ y })} />
      </Field>
      <Field label="折り返し幅">
        <NumberInput value={style.maxWidth} min={100} step={50} digits={0} onChange={(maxWidth) => onChange({ maxWidth })} />
      </Field>
    </>
  );
}
