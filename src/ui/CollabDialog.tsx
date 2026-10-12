// 共同作業：招待リンクを作る・参加している人を見る・やめる。
import { useState } from 'react';
import { editorState, useEditor } from '../state/store';
import { inviteLink, joinCollab, myName, setMyName, startCollab, stopCollab, useCollab } from '../collab/client';
import { applyShareText, hasShareServer, shareRoom, voicevoxKey, voicevoxUrl } from '../voice/voicevox';
import { Field, Modal } from './common';

const close = () => useCollab.setState({ dialogOpen: false });

/** 上のバーの「👥」ボタン。共同作業中は人数を出す */
export function CollabButton() {
  const status = useCollab((s) => s.status);
  const users = useCollab((s) => s.users.length);
  const active = status !== 'off';
  return (
    <button
      className={`act-btn collab-btn ${active ? `on ${status}` : ''}`}
      title={active ? '共同作業中' : 'リンクを送って共同作業'}
      aria-label="共同作業"
      onClick={() => useCollab.setState({ dialogOpen: true })}
    >
      <span className="collab-icon" aria-hidden="true">
        👥
      </span>
      <span className="act-label collab-long">{active ? (status === 'online' ? `${users}人で編集中` : 'つないでいます…') : '共同作業'}</span>
      <span className="act-label collab-short">{active ? (status === 'online' ? `${users}人` : '接続中') : '共同'}</span>
    </button>
  );
}

export function CollabDialog() {
  const open = useCollab((s) => s.dialogOpen);
  if (!open) return null;
  return <CollabPanel />;
}

function CollabPanel() {
  const { status, users, room, server, transfers, error } = useCollab();
  const project = useEditor((s) => s.project);
  const [name, setName] = useState(myName);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [, force] = useState(0);
  const active = status !== 'off';
  const link = active && server && room ? inviteLink(server, voicevoxKey(), room) : null;

  const start = async () => {
    if (name.trim()) setMyName(name);
    setBusy(true);
    try {
      await startCollab();
    } catch (err) {
      editorState().toast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    if (!link) return;
    if (navigator.share) {
      await navigator.share({ title: `「${project.name}」を一緒に編集`, url: link }).catch(() => undefined);
    } else {
      await navigator.clipboard?.writeText(link);
      setCopied(true);
    }
  };

  return (
    <Modal title="👥 共同作業" onClose={close} wide>
      <div className="form">
        <Field label="あなたの名前" hint="ほかの人の画面に表示されます">
          <input
            type="text"
            value={name}
            maxLength={30}
            placeholder="例：たこきん"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setMyName(name)}
          />
        </Field>

        {!active && !hasShareServer() && (
          <div className="notice">
            <p>
              共同作業には「共有サーバー」が必要です。共有サーバーを動かしている人（VOICEVOX を共有している人）から届いた共有リンクを開くか、ここに貼り付けてください。
            </p>
            <input
              type="text"
              value=""
              placeholder="https://…#voicevox=…（共有リンク・招待リンクを貼り付け）"
              onChange={(e) => {
                const room = shareRoom(e.target.value);
                if (applyShareText(e.target.value)) {
                  if (room) {
                    joinCollab(voicevoxUrl(), voicevoxKey(), room);
                    editorState().toast('共同作業に参加しています…');
                  } else editorState().toast('共有サーバーを設定しました');
                  force((n) => n + 1);
                } else if (e.target.value.trim()) {
                  editorState().toast('共有リンクの形が正しくありません', 'error');
                }
              }}
            />
            <p className="small muted">自分で共有サーバーを動かす方法は、README の「友達と VOICEVOX を共有する」を見てください。</p>
          </div>
        )}

        {!active && hasShareServer() && (
          <>
            <p>
              今のプロジェクト「<strong>{project.name}</strong>」を共有サーバーに置いて、招待リンクを作ります。リンクを開いた人は同じプロジェクトを一緒に編集できます。
            </p>
            <div className="button-row">
              <button className="btn primary" disabled={busy} onClick={() => void start()}>
                {busy ? '準備中…' : '👥 共同作業を始める'}
              </button>
            </div>
            <p className="small muted">
              動画・画像・音楽も共有サーバー（あなたか、サーバーを動かしている人のパソコン）に送られます。共有サーバーを閉じると、共同作業もできなくなります。
            </p>
          </>
        )}

        {active && (
          <>
            <p className={status === 'online' ? 'notice ok' : 'notice'}>
              {status === 'online' ? `共同作業中：${users.length}人が参加しています` : '共有サーバーにつないでいます…'}
            </p>
            {error && <p className="notice error">{error}</p>}
            <ul className="collab-users">
              {users.map((u) => (
                <li key={u.id}>
                  <span className="dot" style={{ background: u.color }} />
                  {u.name}
                </li>
              ))}
            </ul>
            {(transfers.up > 0 || transfers.down > 0) && (
              <p className="small muted">
                素材を{transfers.up > 0 ? `送っています（${transfers.up}個）` : ''}
                {transfers.down > 0 ? `受け取っています（${transfers.down}個）` : ''}…
              </p>
            )}
            {link && (
              <>
                <h4>招待リンク</h4>
                <p className="small muted">このリンクを送った人は、このプロジェクトを編集できます。知らない人には送らないでください。</p>
                <textarea readOnly rows={3} value={link} onFocus={(e) => e.currentTarget.select()} />
                <div className="button-row">
                  <button className="btn primary" onClick={() => void share()}>
                    {copied ? 'コピーしました' : '招待リンクを送る'}
                  </button>
                  <button
                    className="btn"
                    onClick={() => {
                      void navigator.clipboard?.writeText(link).then(() => setCopied(true));
                    }}
                  >
                    コピー
                  </button>
                </div>
              </>
            )}
            <hr />
            <button
              className="btn danger"
              onClick={() => {
                stopCollab(true);
                editorState().toast('共同作業をやめました（このプロジェクトは手元に残ります）');
              }}
            >
              共同作業をやめる
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
