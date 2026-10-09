import { useEditor } from '../state/store';
import type { AudioEffects, Placement, SlideDirection, TextStyle, TimelineItem, VisualEffects } from '../types';
import { ASPECTS, FONT_FAMILIES, MIN_ITEM_DURATION, aspectOf, type AspectKey } from '../state/defaults';
import { alignItem, deleteItem, setAspect, updateItem } from '../state/actions';
import { ColorInput, CommitText, Field, NumberInput, SliderNumber } from './common';

const KIND_TITLE: Record<TimelineItem['kind'], string> = {
  text: 'テキスト',
  image: '画像',
  video: '動画',
  audio: '音楽・音声',
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
          <TextStyleEditor style={item.style} onChange={(style) => update({ style: { ...item.style, ...style } })} />
        </div>
      )}
      {(item.kind === 'image' || item.kind === 'video') && (
        <>
          <FitButtons assetId={item.assetId} onChange={(p) => update(p)} />
          <PlacementEditor value={item} onChange={(p) => update(p)} />
        </>
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
      {item.kind !== 'audio' && (
        <VisualEffectsEditor
          value={item.effects ?? {}}
          duration={item.duration}
          onChange={(p) => update({ effects: { ...item.effects, ...p } } as Partial<TimelineItem>)}
        />
      )}
      {(item.kind === 'video' || item.kind === 'audio') && (
        <AudioEffectsEditor
          value={item.audioEffects ?? {}}
          duration={item.duration}
          onChange={(p) => update({ audioEffects: { ...item.audioEffects, ...p } } as Partial<TimelineItem>)}
        />
      )}
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

const SLIDE_LABELS: [SlideDirection, string][] = [
  ['left', '左から'],
  ['right', '右から'],
  ['top', '上から'],
  ['bottom', '下から'],
];

function VisualEffectsEditor({ value, duration, onChange }: { value: VisualEffects; duration: number; onChange: (p: Partial<VisualEffects>) => void }) {
  const maxFade = Math.max(0.1, Math.min(10, duration));
  const zoomMode = !value.zoomIn ? '' : value.zoomIn.from < 1 ? 'small' : 'large';
  return (
    <details className="effects" open>
      <summary>映像エフェクト</summary>
      <div className="form nested">
        <Field label="ぼかし">
          <SliderNumber value={value.blur ?? 0} min={0} max={40} step={1} digits={0} onChange={(blur) => onChange({ blur })} />
        </Field>
        <Field label="モザイク" hint="マスの大きさ（0でなし）">
          <SliderNumber value={value.mosaic ?? 0} min={0} max={80} step={1} digits={0} onChange={(mosaic) => onChange({ mosaic })} />
        </Field>
        <Field label="フェードイン(秒)">
          <SliderNumber value={value.fadeIn ?? 0} min={0} max={maxFade} step={0.1} onChange={(fadeIn) => onChange({ fadeIn })} />
        </Field>
        <Field label="フェードアウト(秒)">
          <SliderNumber value={value.fadeOut ?? 0} min={0} max={maxFade} step={0.1} onChange={(fadeOut) => onChange({ fadeOut })} />
        </Field>
        <Field label="スライドイン" hint="画面の外から入ってくる">
          <select
            value={value.slideIn?.direction ?? ''}
            onChange={(e) =>
              onChange({
                slideIn: e.target.value ? { direction: e.target.value as SlideDirection, duration: value.slideIn?.duration ?? 0.6 } : null,
              })
            }
          >
            <option value="">なし</option>
            {SLIDE_LABELS.map(([d, label]) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        {value.slideIn && (
          <Field label="スライドの時間(秒)">
            <SliderNumber
              value={value.slideIn.duration}
              min={0.1}
              max={maxFade}
              step={0.1}
              onChange={(d) => onChange({ slideIn: { ...value.slideIn!, duration: d } })}
            />
          </Field>
        )}
        <Field label="拡大縮小で入場">
          <select
            value={zoomMode}
            onChange={(e) =>
              onChange({
                zoomIn: e.target.value
                  ? { from: e.target.value === 'small' ? 0.2 : 2, duration: value.zoomIn?.duration ?? 0.6 }
                  : null,
              })
            }
          >
            <option value="">なし</option>
            <option value="small">小さい状態から拡大</option>
            <option value="large">大きい状態から縮小</option>
          </select>
        </Field>
        {value.zoomIn && (
          <Field label="入場の時間(秒)">
            <SliderNumber
              value={value.zoomIn.duration}
              min={0.1}
              max={maxFade}
              step={0.1}
              onChange={(d) => onChange({ zoomIn: { ...value.zoomIn!, duration: d } })}
            />
          </Field>
        )}
      </div>
    </details>
  );
}

function AudioEffectsEditor({ value, duration, onChange }: { value: AudioEffects; duration: number; onChange: (p: Partial<AudioEffects>) => void }) {
  const maxFade = Math.max(0.1, Math.min(10, duration));
  return (
    <details className="effects" open>
      <summary>音声エフェクト</summary>
      <div className="form nested">
        <Field label="低音強化(dB)">
          <SliderNumber value={value.bass ?? 0} min={0} max={20} step={1} digits={0} onChange={(bass) => onChange({ bass })} />
        </Field>
        <Field label="ピー音" hint="元の音を消して「ピー」を鳴らす">
          <input type="checkbox" checked={!!value.beep} onChange={(e) => onChange({ beep: e.target.checked })} />
        </Field>
        <Field label="ノイズ" hint="ザーッという音を混ぜる">
          <SliderNumber value={value.noise ?? 0} min={0} max={1} step={0.05} onChange={(noise) => onChange({ noise })} />
        </Field>
        <Field label="フェードイン(秒)">
          <SliderNumber value={value.fadeIn ?? 0} min={0} max={maxFade} step={0.1} onChange={(fadeIn) => onChange({ fadeIn })} />
        </Field>
        <Field label="フェードアウト(秒)">
          <SliderNumber value={value.fadeOut ?? 0} min={0} max={maxFade} step={0.1} onChange={(fadeOut) => onChange({ fadeOut })} />
        </Field>
        <p className="muted small">一部だけピー音にしたいときは、その部分を「✂ 分割」で切り出してからピー音をオンにします。</p>
      </div>
    </details>
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
