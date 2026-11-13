// アイテムに積んだエフェクトの一覧と、その設定。映像エフェクトと音声エフェクトで共通。
// YMM4 と同じように、エフェクトを好きなだけ追加して、上から順にかかる。
import { useMemo, useState } from 'react';
import type { Fx, FxValue, TimelineItem } from '../types';
import { editorState } from '../state/store';
import { uid } from '../state/defaults';
import { EASE_OPTS, isAnim, type ParamDef } from '../fx/params';
import { VISUAL_CATS, VISUAL_FX } from '../fx/visual';
import { AUDIO_CATS, AUDIO_FX } from '../fx/audio';
import { ColorInput, Modal, SliderNumber } from './common';

type FxKey = 'fx' | 'afx';

interface AnyDef {
  type: string;
  name: string;
  cat: string;
  kw?: string;
  params: ParamDef[];
  textOnly?: boolean;
}

const CATALOG: Record<FxKey, { title: string; defs: AnyDef[]; cats: [string, string][] }> = {
  fx: { title: '映像エフェクト', defs: VISUAL_FX, cats: VISUAL_CATS },
  afx: { title: '音声エフェクト', defs: AUDIO_FX, cats: AUDIO_CATS },
};

function editList(itemId: string, key: FxKey, change: (list: Fx[]) => Fx[]) {
  editorState().edit((d) => {
    const it = d.items.find((x) => x.id === itemId) as (TimelineItem & { fx?: Fx[]; afx?: Fx[] }) | undefined;
    if (!it) return;
    const next = change((it[key] ?? []) as Fx[]);
    if (next.length) it[key] = next;
    else delete it[key];
  });
}

const digitsOf = (step: number) => (step >= 1 ? 0 : step >= 0.1 ? 1 : 2);

export function FxList({ item, kind }: { item: TimelineItem; kind: FxKey }) {
  const { title, defs } = CATALOG[kind];
  const list = ((item as { fx?: Fx[]; afx?: Fx[] })[kind] ?? []) as Fx[];
  const [picking, setPicking] = useState(false);
  /** たたんでいるエフェクト */
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const byType = useMemo(() => new Map(defs.map((d) => [d.type, d])), [defs]);

  const move = (i: number, by: number) =>
    editList(item.id, kind, (l) => {
      const j = i + by;
      if (j < 0 || j >= l.length) return l;
      const out = [...l];
      [out[i], out[j]] = [out[j], out[i]];
      return out;
    });

  return (
    <section className="fx-list">
      <h4 className="fx-title">
        {title}
        {list.length > 0 && <span className="fx-count">{list.length}</span>}
        <button className="btn small primary" onClick={() => setPicking(true)}>
          ＋ 追加
        </button>
      </h4>
      {list.length === 0 && <p className="muted small">「＋ 追加」から{title}を選んで重ねられます。</p>}
      {list.map((fx, i) => {
        const def = byType.get(fx.type);
        const open = !closed.has(fx.id);
        return (
          <div key={fx.id} className={`fx-card ${fx.off ? 'off' : ''}`}>
            <div className="fx-head">
              <button
                className="fx-toggle"
                aria-expanded={open}
                onClick={() =>
                  setClosed((s) => {
                    const n = new Set(s);
                    if (n.has(fx.id)) n.delete(fx.id);
                    else n.add(fx.id);
                    return n;
                  })
                }
              >
                <span className="fx-caret">{open ? '▾' : '▸'}</span>
                <span className="fx-name">{def?.name ?? `不明なエフェクト（${fx.type}）`}</span>
              </button>
              <input
                type="checkbox"
                title="オン／オフ"
                aria-label={`${def?.name ?? fx.type} を有効にする`}
                checked={!fx.off}
                onChange={(e) => editList(item.id, kind, (l) => l.map((x) => (x.id === fx.id ? { ...x, off: !e.target.checked } : x)))}
              />
              <button className="icon-btn" title="上へ（先にかける）" aria-label="上へ" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button className="icon-btn" title="下へ（後でかける）" aria-label="下へ" disabled={i === list.length - 1} onClick={() => move(i, 1)}>
                ↓
              </button>
              <button className="icon-btn" title="複製" aria-label="複製" onClick={() => editList(item.id, kind, (l) => [...l.slice(0, i + 1), { ...structuredClone(fx), id: uid() }, ...l.slice(i + 1)])}>
                ⧉
              </button>
              <button className="icon-btn" title="削除" aria-label="削除" onClick={() => editList(item.id, kind, (l) => l.filter((x) => x.id !== fx.id))}>
                ✕
              </button>
            </div>
            {open && def && (
              <div className="fx-params">
                {def.params.length === 0 && <p className="muted small">設定項目はありません。</p>}
                {def.params.map((d) => (
                  <ParamRow
                    key={d.k}
                    def={d}
                    value={fx.p[d.k]}
                    animatable={kind === 'fx'}
                    onChange={(v) =>
                      editList(item.id, kind, (l) =>
                        l.map((x) => {
                          if (x.id !== fx.id) return x;
                          const p = { ...x.p };
                          if (v === undefined) delete p[d.k];
                          else p[d.k] = v;
                          return { ...x, p };
                        }),
                      )
                    }
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
      {picking && (
        <FxPicker
          kind={kind}
          isText={item.kind === 'text'}
          onClose={() => setPicking(false)}
          onPick={(type) => {
            editList(item.id, kind, (l) => [...l, { id: uid(), type, p: {} }]);
            setPicking(false);
          }}
        />
      )}
    </section>
  );
}

function ParamRow({ def, value, animatable, onChange }: { def: ParamDef; value: FxValue | undefined; animatable: boolean; onChange: (v: FxValue | undefined) => void }) {
  if (def.t === 'num') {
    const digits = digitsOf(def.step);
    const canAnim = animatable && def.anim !== false;
    const label = `${def.label}${def.unit ? `（${def.unit}）` : ''}`;
    if (isAnim(value)) {
      return (
        <div className="fx-param anim">
          <span className="fx-param-label">
            {label}
            <button className="fx-anim-btn on" title="変化をやめて、ひとつの値にする" onClick={() => onChange(value.a)}>
              → 変化
            </button>
          </span>
          <label className="fx-sub">
            <span>始め</span>
            <SliderNumber value={value.a} min={def.min} max={def.max} step={def.step} digits={digits} onChange={(a) => onChange({ ...value, a })} />
          </label>
          <label className="fx-sub">
            <span>終わり</span>
            <SliderNumber value={value.b} min={def.min} max={def.max} step={def.step} digits={digits} onChange={(b) => onChange({ ...value, b })} />
          </label>
          <label className="fx-sub">
            <span>動き方</span>
            <select value={value.ease ?? 'linear'} onChange={(e) => onChange({ ...value, ease: e.target.value })}>
              {EASE_OPTS.map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      );
    }
    const v = typeof value === 'number' ? value : def.def;
    return (
      <div className="fx-param">
        <span className="fx-param-label">
          {label}
          {canAnim && (
            <button className="fx-anim-btn" title="アイテムの始めから終わりにかけて、値を変化させる" onClick={() => onChange({ a: v, b: v, ease: 'linear' })}>
              → 変化
            </button>
          )}
        </span>
        <SliderNumber value={v} min={def.min} max={def.max} step={def.step} digits={digits} onChange={(x) => onChange(x)} />
      </div>
    );
  }
  if (def.t === 'color') {
    return (
      <label className="fx-param row">
        <span className="fx-param-label">{def.label}</span>
        <ColorInput value={typeof value === 'string' ? value : def.def} onChange={(c) => onChange(c)} />
      </label>
    );
  }
  if (def.t === 'bool') {
    return (
      <label className="fx-param row">
        <span className="fx-param-label">{def.label}</span>
        <input type="checkbox" checked={typeof value === 'boolean' ? value : def.def} onChange={(e) => onChange(e.target.checked)} />
      </label>
    );
  }
  return (
    <label className="fx-param row">
      <span className="fx-param-label">{def.label}</span>
      <select value={typeof value === 'string' ? value : def.def} onChange={(e) => onChange(e.target.value)}>
        {def.opts.map(([k, l]) => (
          <option key={k} value={k}>
            {l}
          </option>
        ))}
      </select>
    </label>
  );
}

/** エフェクトを選ぶ画面。名前や別名で検索でき、種類ごとに絞り込める */
function FxPicker({ kind, isText, onClose, onPick }: { kind: FxKey; isText: boolean; onClose: () => void; onPick: (type: string) => void }) {
  const { title, defs, cats } = CATALOG[kind];
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<string>('');
  const q = query.trim().toLowerCase();
  const shown = defs.filter((d) => {
    if (d.textOnly && !isText) return false;
    if (q) return `${d.name} ${d.kw ?? ''}`.toLowerCase().includes(q);
    return !cat || d.cat === cat;
  });
  const catLabel = (c: string) => cats.find((x) => x[0] === c)?.[1] ?? '';
  return (
    <Modal title={`${title}を追加`} onClose={onClose} wide>
      <div className="fx-picker">
        <input type="search" autoFocus placeholder={`${defs.length}種類から検索（例：ぼかし、エコー）`} value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="fx-cats" role="tablist">
          <button className={`chip ${!cat && !q ? 'on' : ''}`} onClick={() => setCat('')}>
            すべて
          </button>
          {cats.map(([k, label]) => (
            <button key={k} className={`chip ${cat === k && !q ? 'on' : ''}`} onClick={() => { setCat(k); setQuery(''); }}>
              {label}
            </button>
          ))}
        </div>
        <div className="fx-grid">
          {shown.map((d) => (
            <button key={d.type} className="fx-pick" onClick={() => onPick(d.type)}>
              <span className="fx-pick-name">{d.name}</span>
              <span className="fx-pick-cat">{catLabel(d.cat)}</span>
            </button>
          ))}
          {shown.length === 0 && <p className="muted">見つかりませんでした。</p>}
        </div>
      </div>
    </Modal>
  );
}
