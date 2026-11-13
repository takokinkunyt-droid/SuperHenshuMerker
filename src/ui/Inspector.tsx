import { useEditor } from '../state/store';
import type { AudioItem, Placement, TextBackground, TextShadow, TextStyle, TimelineItem } from '../types';
import { ASPECTS, MIN_ITEM_DURATION, aspectOf, type AspectKey } from '../state/defaults';
import { alignItem, deleteItem, setAspect, updateItem } from '../state/actions';
import { regenerateTts } from '../state/ttsActions';
import { useVoicevox } from '../voice/voicevoxStore';
import { VoicevoxHelp } from './TtsDialog';
import { useEffect } from 'react';
import { ColorInput, CommitText, Field, NumberInput, SliderNumber } from './common';
import { SheetHeader } from './MobileNav';
import { FxList } from './FxEditor';
import { FontPicker } from './FontPicker';

const KIND_TITLE: Record<TimelineItem['kind'], string> = {
  text: 'テキスト',
  image: '画像',
  video: '動画',
  audio: '音楽・音声',
};

export function Inspector() {
  const item = useEditor((s) => s.project.items.find((it) => it.id === s.selectedItemId));
  const open = useEditor((s) => s.sheet === 'edit');
  return (
    <aside className={`panel inspector ${open ? 'sheet-open' : ''}`}>
      <SheetHeader title={item ? '編集' : 'プロジェクト設定'} />
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
        <Field label="画面の比率">
          <select value={aspectOf(project.width, project.height) ?? ''} onChange={(e) => setAspect(e.target.value as AspectKey)}>
            {!aspectOf(project.width, project.height) && <option value="">カスタム</option>}
            {ASPECTS.map((a) => (
              <option key={a.key} value={a.key}>
                {a.label}
              </option>
            ))}
          </select>
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
      {item.kind !== 'audio' && <AlignButtons id={item.id} />}
      {item.kind === 'text' && (
        <div className="form">
          <Field label="テキスト">
            <CommitText multiline value={item.text} onCommit={(text) => update({ text })} />
          </Field>
          <Field label="回転(度)">
            <SliderNumber value={item.rotation ?? 0} min={-180} max={180} step={1} digits={0} onChange={(rotation) => update({ rotation })} />
          </Field>
          <TextStyleEditor style={item.style} onChange={(style) => update({ style: { ...item.style, ...style } })} />
        </div>
      )}
      {(item.kind === 'image' || item.kind === 'video') && (
        <>
          <FitButtons assetId={item.assetId} onChange={(p) => update(p)} />
          <PlacementEditor value={item} onChange={(p) => update(p)} />
        </>
      )}
      {item.kind === 'audio' && item.tts && <TtsEditor item={item} />}
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
      {item.kind !== 'audio' && <FxList item={item} kind="fx" />}
      {(item.kind === 'video' || item.kind === 'audio') && <FxList item={item} kind="afx" />}
    </>
  );
}

/** 画面の端（余白5%）や中央にぴったり合わせるボタン */
function AlignButtons({ id }: { id: string }) {
  return (
    <div className="align-grid" role="group" aria-label="配置をそろえる">
      <span className="field-label">そろえる</span>
      <div className="button-row">
        <button className="btn small" title="左の余白に合わせる" onClick={() => alignItem(id, 'left', null)}>
          ⇤ 左
        </button>
        <button className="btn small" title="左右の中央に合わせる" onClick={() => alignItem(id, 'center', null)}>
          ↔ 中央
        </button>
        <button className="btn small" title="右の余白に合わせる" onClick={() => alignItem(id, 'right', null)}>
          右 ⇥
        </button>
      </div>
      <span />
      <div className="button-row">
        <button className="btn small" title="上の余白に合わせる" onClick={() => alignItem(id, null, 'top')}>
          ⤒ 上
        </button>
        <button className="btn small" title="上下の中央に合わせる" onClick={() => alignItem(id, null, 'middle')}>
          ↕ 中央
        </button>
        <button className="btn small" title="下の余白に合わせる" onClick={() => alignItem(id, null, 'bottom')}>
          下 ⤓
        </button>
      </div>
    </div>
  );
}

/** 画面の中央に、全体が見える大きさ／画面いっぱいの大きさで置き直す */
function FitButtons({ assetId, onChange }: { assetId: string; onChange: (p: Partial<Placement>) => void }) {
  const project = useEditor((s) => s.project);
  const asset = project.assets[assetId];
  if (!asset?.width || !asset.height) return null;
  const sx = project.width / asset.width;
  const sy = project.height / asset.height;
  const center = { x: project.width / 2, y: project.height / 2 };
  return (
    <div className="button-row fit-buttons">
      <button className="btn small" onClick={() => onChange({ ...center, scale: Math.min(sx, sy) })}>
        全体を表示
      </button>
      <button className="btn small" onClick={() => onChange({ ...center, scale: Math.max(sx, sy) })}>
        画面いっぱい
      </button>
    </div>
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
      <Field label="回転(度)">
        <SliderNumber value={value.rotation ?? 0} min={-180} max={180} step={1} digits={0} onChange={(rotation) => onChange({ rotation })} />
      </Field>
    </div>
  );
}

export function TextStyleEditor({ style, onChange }: { style: TextStyle; onChange: (s: Partial<TextStyle>) => void }) {
  return (
    <>
      <Field label="フォント">
        <FontPicker value={style.fontFamily} onChange={(fontFamily) => onChange({ fontFamily })} />
      </Field>
      <div className="font-sample" style={{ fontFamily: style.fontFamily, fontWeight: style.bold ? 700 : 400 }}>
        あいうえお 漢字 ABC 123
      </div>
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
      <TextShadowEditor style={style} onChange={onChange} />
      <TextBackgroundEditor style={style} onChange={onChange} />
    </>
  );
}

function TextShadowEditor({ style, onChange }: { style: TextStyle; onChange: (s: Partial<TextStyle>) => void }) {
  const sh = style.shadow;
  const set = (p: Partial<TextShadow>) => sh && onChange({ shadow: { ...sh, ...p } });
  return (
    <details className="effects" open={!!sh}>
      <summary>影</summary>
      <div className="form nested">
        <Field label="影をつける">
          <input
            type="checkbox"
            checked={!!sh}
            onChange={(e) =>
              onChange({
                shadow: e.target.checked
                  ? { color: '#000000', blur: Math.round(style.fontSize * 0.12), offsetX: Math.round(style.fontSize * 0.06), offsetY: Math.round(style.fontSize * 0.06) }
                  : null,
              })
            }
          />
        </Field>
        {sh && (
          <>
            <Field label="影の色">
              <ColorInput value={sh.color} onChange={(color) => set({ color })} />
            </Field>
            <Field label="ぼかし">
              <SliderNumber value={sh.blur} min={0} max={60} step={1} digits={0} onChange={(blur) => set({ blur })} />
            </Field>
            <Field label="横のずれ">
              <SliderNumber value={sh.offsetX} min={-40} max={40} step={1} digits={0} onChange={(offsetX) => set({ offsetX })} />
            </Field>
            <Field label="縦のずれ">
              <SliderNumber value={sh.offsetY} min={-40} max={40} step={1} digits={0} onChange={(offsetY) => set({ offsetY })} />
            </Field>
          </>
        )}
      </div>
    </details>
  );
}

function TextBackgroundEditor({ style, onChange }: { style: TextStyle; onChange: (s: Partial<TextStyle>) => void }) {
  const bg = style.background;
  const set = (p: Partial<TextBackground>) => bg && onChange({ background: { ...bg, ...p } });
  return (
    <details className="effects" open={!!bg}>
      <summary>背景（帯）</summary>
      <div className="form nested">
        <Field label="背景をつける">
          <input
            type="checkbox"
            checked={!!bg}
            onChange={(e) =>
              onChange({
                background: e.target.checked
                  ? { color: '#000000', opacity: 0.6, padding: Math.round(style.fontSize * 0.3), radius: Math.round(style.fontSize * 0.2) }
                  : null,
              })
            }
          />
        </Field>
        {bg && (
          <>
            <Field label="背景の色">
              <ColorInput value={bg.color} onChange={(color) => set({ color })} />
            </Field>
            <Field label="不透明度">
              <SliderNumber value={bg.opacity} min={0} max={1} step={0.05} onChange={(opacity) => set({ opacity })} />
            </Field>
            <Field label="余白">
              <SliderNumber value={bg.padding} min={0} max={120} step={1} digits={0} onChange={(padding) => set({ padding })} />
            </Field>
            <Field label="角の丸み">
              <SliderNumber value={bg.radius} min={0} max={120} step={1} digits={0} onChange={(radius) => set({ radius })} />
            </Field>
          </>
        )}
      </div>
    </details>
  );
}

/** 合成音声で作った音声：読み上げる文字や声を変えて作り直す */
function TtsEditor({ item }: { item: AudioItem }) {
  const tts = item.tts!;
  const busy = useEditor((s) => s.busy);
  const { status, styles, refresh } = useVoicevox();
  useEffect(() => {
    if (status === 'idle') void refresh();
  }, [status, refresh]);
  return (
    <details className="effects" open>
      <summary>読み上げ（{tts.styleLabel}）</summary>
      <div className="form nested">
        <Field label="読み上げる文字" hint="変えると音声を作り直します（字幕も一緒に変わります）">
          <CommitText multiline value={tts.text} onCommit={(text) => void regenerateTts(item.id, { text })} />
        </Field>
        <Field label="声">
          <select
            value={tts.speakerId}
            onChange={(e) => {
              const st = styles.find((x) => x.id === Number(e.target.value));
              if (st) void regenerateTts(item.id, { speakerId: st.id, speakerName: st.speakerName, styleLabel: st.label });
            }}
          >
            {!styles.some((x) => x.id === tts.speakerId) && <option value={tts.speakerId}>{tts.styleLabel}</option>}
            {styles.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="話速" hint="入力して確定すると作り直します">
          <NumberInput value={tts.speedScale} min={0.5} max={2} step={0.05} onChange={(speedScale) => void regenerateTts(item.id, { speedScale })} />
        </Field>
        <button className="btn" disabled={!!busy} onClick={() => void regenerateTts(item.id, {})}>
          {busy ?? '音声を作り直す'}
        </button>
        {status === 'error' && <VoicevoxHelp error={null} />}
      </div>
    </details>
  );
}
