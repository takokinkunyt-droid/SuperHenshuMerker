import { useEffect, useState } from 'react';
import { useEditor } from '../state/store';
import { deleteProject, listProjects, type ProjectSummary } from '../persist/projects';
import { downloadProjectZip, importZipFile, newProject, openProject, useSaveStatus } from '../persist/session';
import { FileButton, Modal } from './common';
import { ASPECTS } from '../state/defaults';

export function ProjectDialog({ onClose }: { onClose: () => void }) {
  const current = useEditor((s) => s.project.id);
  const toast = useEditor((s) => s.toast);
  const persisted = useSaveStatus((s) => s.persisted);
  const [list, setList] = useState<ProjectSummary[]>([]);
  const reload = () => void listProjects().then(setList);
  useEffect(reload, []);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <Modal title="プロジェクト" onClose={onClose} wide>
      <div className="button-row">
        {ASPECTS.map((a) => (
          <button key={a.key} className="btn primary" onClick={() => run(() => newProject(a.key))}>
            ＋ 新規 {a.key}
          </button>
        ))}
        <button className="btn" onClick={() => run(downloadProjectZip)}>
          現在のプロジェクトをZIPで保存
        </button>
        <FileButton accept=".zip,application/zip" onFiles={(f) => run(() => importZipFile(f[0]))}>
          ZIPから読み込む
        </FileButton>
      </div>
      <p className="muted small">
        プロジェクトと素材はこのブラウザの中に自動保存されます。
        {persisted ? '（永続保存が許可されています）' : '（ブラウザの容量が足りなくなると消える可能性があるため、大事なプロジェクトはZIPでも保存してください）'}
      </p>
      <table className="project-table">
        <thead>
          <tr>
            <th>名前</th>
            <th>更新日時</th>
            <th>アイテム数</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {list.map((p) => (
            <tr key={p.id} className={p.id === current ? 'current' : ''}>
              <td>{p.name}</td>
              <td>{new Date(p.updatedAt).toLocaleString('ja-JP')}</td>
              <td>{p.itemCount}</td>
              <td className="actions">
                {p.id === current ? (
                  <span className="muted">編集中</span>
                ) : (
                  <>
                    <button className="btn small" onClick={() => run(() => openProject(p.id))}>
                      開く
                    </button>
                    <button
                      className="btn small danger"
                      onClick={async () => {
                        if (!confirm(`「${p.name}」を削除しますか？素材も削除され、元に戻せません。`)) return;
                        await deleteProject(p.id);
                        reload();
                      }}
                    >
                      削除
                    </button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  );
}
