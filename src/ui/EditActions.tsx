// 上のバーの編集ボタン（複製・コピー・ペースト・戻す・やり直す）。
import { editorState, useEditor } from '../state/store';
import { copyItem, duplicateItem, pasteItem } from '../state/actions';

const ICONS = {
  duplicate: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
      <path d="M14 11v6M11 14h6" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </>
  ),
  paste: (
    <>
      <path d="M9 4h6v3H9z" />
      <path d="M15 5h3a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3" />
      <path d="M9 12h6M9 16h4" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3" />,
  redo: <path d="m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3" />,
};

function ActionButton({ icon, label, title, disabled, onClick }: { icon: keyof typeof ICONS; label: string; title: string; disabled: boolean; onClick: () => void }) {
  return (
    <button className="act-btn" disabled={disabled} title={title} aria-label={label} onClick={onClick}>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        {ICONS[icon]}
      </svg>
      <span className="act-label">{label}</span>
    </button>
  );
}

export function EditActions() {
  const selectedId = useEditor((s) => s.selectedItemId);
  const canPaste = useEditor((s) => !!s.clipboard);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  return (
    <div className="edit-actions" role="toolbar" aria-label="編集">
      <ActionButton icon="duplicate" label="複製" title="選んだアイテムを複製 (Ctrl+D)" disabled={!selectedId} onClick={() => selectedId && duplicateItem(selectedId)} />
      <ActionButton icon="copy" label="コピー" title="選んだアイテムをコピー (Ctrl+C)" disabled={!selectedId} onClick={() => selectedId && copyItem(selectedId)} />
      <ActionButton icon="paste" label="ペースト" title="再生位置に貼り付け (Ctrl+V)" disabled={!canPaste} onClick={pasteItem} />
      <ActionButton icon="undo" label="戻す" title="元に戻す (Ctrl+Z)" disabled={!canUndo} onClick={() => editorState().undo()} />
      <ActionButton icon="redo" label="やり直す" title="やり直す (Ctrl+Shift+Z)" disabled={!canRedo} onClick={() => editorState().redo()} />
    </div>
  );
}
