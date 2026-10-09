import { Modal } from './common';

const SHORTCUTS: [string, string][] = [
  ['Space', '再生／停止'],
  ['← / →', '1フレーム移動（Shiftで1秒）'],
  ['Home', '先頭へ'],
  ['S', '再生位置で分割'],
  ['Delete / Backspace', '選択アイテムを削除'],
  ['Ctrl+D', '選択アイテムを複製'],
  ['Ctrl+Z / Ctrl+Shift+Z（Ctrl+Y）', '元に戻す／やり直す'],
  ['Alt+1〜9', 'セリフ入力欄でキャラを切り替え'],
  ['Ctrl+ホイール', 'タイムラインの拡大・縮小'],
];

export function AboutDialog({ onClose }: { onClose: () => void }) {
  return (
    <Modal title="スーパー編集メーカーについて" onClose={onClose} wide>
      <p>
        ブラウザだけで「立ち絵＋字幕＋読み上げ音声」の解説動画を作れる編集ツールです。インストール不要で、編集・保存・書き出しはすべてブラウザの中で行われ、素材が外部に送信されることはありません。
      </p>
      <p className="notice">
        本ツールは「ゆっくりMovieMaker4（YMM4）」とは無関係の独自ツールです。ゆっくりボイス（AquesTalk）は搭載していません。
      </p>
      <h4>使い方</h4>
      <ol>
        <li>「キャラクター」タブで、キャラごとにVOICEVOXの話者や立ち絵パーツ（PNG）を設定します。</li>
        <li>下のセリフ入力欄でキャラを選んでセリフを入力するか、「台本」タブにまとめて貼り付けます。</li>
        <li>音声・字幕・立ち絵が自動でタイムラインに並びます。背景やBGMは「素材」タブかドラッグ＆ドロップで追加します。</li>
        <li>「書き出し」からMP4として保存します。</li>
      </ol>
      <h4>音声について</h4>
      <ul>
        <li>VOICEVOX：PCで起動したVOICEVOXエンジンに接続して音声を作ります（CORSの許可が必要）。使ったキャラのクレジット表記が必要です。</li>
        <li>音声ファイル：他のツールで作ったWAV/MP3をセリフに割り当てられます。利用条件は作成元の規約に従ってください。</li>
      </ul>
      <h4>ショートカット</h4>
      <table className="shortcut-table">
        <tbody>
          {SHORTCUTS.map(([k, v]) => (
            <tr key={k}>
              <td>
                <kbd>{k}</kbd>
              </td>
              <td>{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h4>使用しているソフトウェア</h4>
      <p className="muted small">
        React、Zustand、Immer、fflate（MIT）、Mediabunny・@mediabunny/aac-encoder（MPL-2.0、FFmpegのAACエンコーダーを含む）
      </p>
    </Modal>
  );
}
