import { useEffect, useRef, useState, type ReactNode } from 'react';

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      <span className="field-control">{children}</span>
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

/**
 * 数値入力。入力中は文字列のまま持ち、確定（Enter・フォーカス外し）で反映する。
 * ドラッグ操作は range と組み合わせる。
 */
export function NumberInput({
  value,
  onChange,
  step = 1,
  min,
  max,
  digits = 2,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  max?: number;
  digits?: number;
}) {
  const format = (v: number) => String(Number(v.toFixed(digits)));
  const [text, setText] = useState(format(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(format(value));
  }, [value]);
  const commit = () => {
    let v = Number(text);
    if (!Number.isFinite(v)) return setText(format(value));
    if (min !== undefined) v = Math.max(min, v);
    if (max !== undefined) v = Math.min(max, v);
    if (v !== value) onChange(v);
    setText(format(v));
  };
  return (
    <input
      className="num"
      type="number"
      value={text}
      step={step}
      min={min}
      max={max}
      onFocus={() => (focused.current = true)}
      onBlur={() => {
        focused.current = false;
        commit();
      }}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function SliderNumber(props: {
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  digits?: number;
}) {
  return (
    <span className="slider-number">
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
      <NumberInput {...props} />
    </span>
  );
}

export function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />;
}

/** 確定時だけ反映するテキスト入力（1文字ごとにUndo履歴を作らない） */
export function CommitText({
  value,
  onCommit,
  multiline,
  placeholder,
}: {
  value: string;
  onCommit: (v: string) => void;
  multiline?: boolean;
  placeholder?: string;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const commit = () => {
    if (text !== value) onCommit(text);
  };
  return multiline ? (
    <textarea
      value={text}
      rows={3}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
      }}
    />
  ) : (
    <input
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
      }}
    />
  );
}

export function FileButton({
  accept,
  multiple,
  onFiles,
  children,
  className = 'btn',
  title,
}: {
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} title={title} onClick={() => ref.current?.click()}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        hidden
        accept={accept}
        multiple={multiple}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length) onFiles(files);
        }}
      />
    </>
  );
}

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="閉じる">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export const AUDIO_NOTICE =
  '読み込んだ音声の利用条件（商用利用・クレジット表記など）は、その音声を作ったサービスやソフトの規約に従ってください。';
