// スマホ用の下のタブ。「タイムライン」「素材」「編集」を切り替える（素材と編集は下から出るパネル）。
import { editorState, useEditor } from '../state/store';

export function MobileNav() {
  const sheet = useEditor((s) => s.sheet);
  const hasSelection = useEditor((s) => !!s.selectedItemId);
  const set = (v: typeof sheet) => editorState().setSheet(v);
  return (
    <nav className="mobile-nav" aria-label="表示の切り替え">
      <button className={sheet === null ? 'active' : ''} onClick={() => set(null)}>
        <span className="nav-icon">🎬</span>
        タイムライン
      </button>
      <button className={sheet === 'media' ? 'active' : ''} onClick={() => set(sheet === 'media' ? null : 'media')}>
        <span className="nav-icon">📁</span>
        素材
      </button>
      <button className={`${sheet === 'edit' ? 'active' : ''} ${hasSelection ? 'has-selection' : ''}`} onClick={() => set(sheet === 'edit' ? null : 'edit')}>
        <span className="nav-icon">{hasSelection ? '✏️' : '⚙'}</span>
        {hasSelection ? '編集' : '設定'}
      </button>
    </nav>
  );
}

/** 下から出るパネルの見出し（スマホのときだけ表示） */
export function SheetHeader({ title }: { title: string }) {
  return (
    <div className="sheet-head">
      <span className="sheet-grip" />
      <strong>{title}</strong>
      <button className="icon-btn" aria-label="閉じる" onClick={() => editorState().setSheet(null)}>
        ✕
      </button>
    </div>
  );
}
