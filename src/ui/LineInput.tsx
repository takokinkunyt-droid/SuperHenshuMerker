import { useRef, useState } from 'react';
import { editorState, useEditor } from '../state/store';
import { addLine } from '../state/actions';

/** キャラを選んでセリフを入力すると、音声・字幕・立ち絵がまとめて追加される入力欄 */
export function LineInput() {
  const characters = useEditor((s) => s.project.characters);
  const selected = useEditor((s) => s.selectedCharacterId);
  const busy = useEditor((s) => s.busy);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = characters.find((c) => c.id === selected) ?? characters[0];

  const submit = async () => {
    if (!current || !text.trim() || pending) return;
    const value = text;
    setText('');
    setPending(true);
    try {
      await addLine(current.id, value);
    } finally {
      setPending(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="line-input">
      <div className="line-chars">
        {characters.map((c, i) => (
          <button
            key={c.id}
            className={`chip ${c.id === current?.id ? 'active' : ''}`}
            style={{ ['--chip-color' as string]: c.color }}
            title={`${c.name}（Alt+${i + 1}）`}
            onClick={() => {
              editorState().selectCharacter(c.id);
              inputRef.current?.focus();
            }}
          >
            {c.name}
          </button>
        ))}
      </div>
      <input
        ref={inputRef}
        className="line-text"
        type="text"
        value={text}
        placeholder={current ? `${current.name}のセリフを入力して Enter` : 'キャラクターを追加してください'}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
            e.preventDefault();
            void submit();
          }
          if (e.altKey && /^[1-9]$/.test(e.key)) {
            const c = characters[Number(e.key) - 1];
            if (c) {
              e.preventDefault();
              editorState().selectCharacter(c.id);
            }
          }
        }}
      />
      <button className="btn primary" disabled={!text.trim() || pending} onClick={() => void submit()}>
        {pending ? '作成中…' : '追加'}
      </button>
      {busy && <span className="busy">{busy}</span>}
    </div>
  );
}
