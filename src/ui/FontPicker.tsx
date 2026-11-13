// フォントを選ぶ画面。名前で検索でき、種類ごとに絞り込める。それぞれのフォントで書いた見本を並べる。
import { useEffect, useState } from 'react';
import { FONT_CATS, FONT_OPTIONS, FONT_SAMPLE, type FontOption } from '../state/defaults';
import { Modal } from './common';

let previewsLoaded = false;

/** 見本用の小さなフォント（数文字だけ）を読み込む。本体のフォントは選んだときに初めて読み込まれる */
function loadPreviews(onDone: () => void) {
  if (previewsLoaded || typeof FontFace === 'undefined') return;
  previewsLoaded = true;
  const jobs = FONT_OPTIONS.filter((f) => f.preview).map((f) => {
    const face = new FontFace(`pv-${f.preview}`, `url(${import.meta.env.BASE_URL}font-previews/${f.preview}.woff2)`);
    return face.load().then(
      (loaded) => document.fonts.add(loaded),
      () => undefined,
    );
  });
  void Promise.all(jobs).then(onDone);
}

const nameOf = (family: string) => FONT_OPTIONS.find((f) => f.family === family)?.label ?? family.split(',')[0].replace(/"/g, '');

export function FontPicker({ value, onChange }: { value: string; onChange: (family: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn font-pick-btn" onClick={() => setOpen(true)} title="フォントを選ぶ">
        <span>{nameOf(value)}</span>
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <FontDialog
          value={value}
          onClose={() => setOpen(false)}
          onPick={(f) => {
            onChange(f.family);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function FontDialog({ value, onClose, onPick }: { value: string; onClose: () => void; onPick: (f: FontOption) => void }) {
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState('');
  const [, redraw] = useState(0);
  useEffect(() => loadPreviews(() => redraw((n) => n + 1)), []);
  const q = query.trim().toLowerCase();
  const shown = FONT_OPTIONS.filter((f) => (q ? f.label.toLowerCase().includes(q) : !cat || f.cat === cat));
  return (
    <Modal title={`フォントを選ぶ（${FONT_OPTIONS.length}種類）`} onClose={onClose} wide>
      <div className="fx-picker">
        <input type="search" autoFocus placeholder="名前で検索（例：明朝、ポップ、Zen）" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="fx-cats">
          <button className={`chip ${!cat && !q ? 'on' : ''}`} onClick={() => setCat('')}>
            すべて
          </button>
          {FONT_CATS.map(([k, label]) => (
            <button
              key={k}
              className={`chip ${cat === k && !q ? 'on' : ''}`}
              onClick={() => {
                setCat(k);
                setQuery('');
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="font-grid">
          {shown.map((f) => (
            <button key={f.family} className={`font-pick ${f.family === value ? 'on' : ''}`} onClick={() => onPick(f)}>
              <span className="font-pick-sample" style={{ fontFamily: f.preview ? `"pv-${f.preview}", ${f.family}` : f.family }}>
                {FONT_SAMPLE}
              </span>
              <span className="font-pick-name">
                {f.label}
                {f.kanaOnly && <em>かな・英数のみ</em>}
                {f.bold && <em>太字あり</em>}
              </span>
            </button>
          ))}
          {shown.length === 0 && <p className="muted">見つかりませんでした。</p>}
        </div>
        <p className="muted small">「端末のフォント」以外は、どの端末でも同じ見た目になります。フォントのデータは選んだときに読み込みます（1〜4MB）。</p>
      </div>
    </Modal>
  );
}
