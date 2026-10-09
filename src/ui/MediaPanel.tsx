import { useEditor } from '../state/store';
import type { AssetMeta } from '../types';
import { importAndPlace, importAsset, placeAsset, removeAsset } from '../state/actions';
import { FileButton } from './common';

export const VISUAL_ACCEPT = 'video/*,image/*,.mp4,.mov,.webm,.m4v,.png,.jpg,.jpeg,.webp,.gif';
export const AUDIO_ACCEPT = 'audio/*,.mp3,.wav,.m4a,.aac,.ogg,.oga,.opus,.flac';

/** 素材を追加するボタン群（パネルとタイムラインの両方で使う） */
export function AddButtons({ compact }: { compact?: boolean }) {
  return (
    <>
      <FileButton multiple className="btn add-btn" accept={VISUAL_ACCEPT} title="動画・画像を再生位置から順に並べます" onFiles={(f) => void importAndPlace(f)}>
        🎞 {compact ? '動画・画像' : '動画・画像を追加'}
      </FileButton>
      <FileButton multiple className="btn add-btn" accept={AUDIO_ACCEPT} title="音楽・効果音を再生位置に置きます" onFiles={(f) => void importAndPlace(f, 'audio')}>
        🎵 {compact ? '音楽' : '音楽・音声を追加'}
      </FileButton>
    </>
  );
}

const KIND_ICON = { image: '🖼', video: '🎞', audio: '🎵' } as const;

function formatSize(bytes: number) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)}GB`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(1)}MB`;
  return `${Math.ceil(bytes / 1e3)}KB`;
}

export function MediaPanel() {
  const assets = useEditor((s) => s.project.assets);
  const list = Object.values(assets).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  return (
    <aside className="panel side">
      <h3 className="panel-title">素材</h3>
      <div className="button-row stack">
        <AddButtons />
        <FileButton
          multiple
          className="btn ghost small"
          accept={`${VISUAL_ACCEPT},${AUDIO_ACCEPT}`}
          title="タイムラインには置かずに素材として読み込みます"
          onFiles={async (files) => {
            for (const f of files) await importAsset(f, f.name);
          }}
        >
          読み込みのみ（あとで配置）
        </FileButton>
      </div>
      <p className="muted small">
        動画（MP4・MOV・WebM）、画像（PNG・JPG）、音楽（MP3・WAV・M4A など）に対応。画面へのドラッグ＆ドロップでも追加できます。素材はブラウザ内に保存され、外部には送信されません。
      </p>
      <ul className="asset-list">
        {list.map((a) => (
          <AssetRow key={a.id} asset={a} />
        ))}
        {!list.length && <li className="muted small">まだ素材がありません</li>}
      </ul>
    </aside>
  );
}

function AssetRow({ asset }: { asset: AssetMeta }) {
  return (
    <li className="asset-row">
      <span className="asset-icon">{KIND_ICON[asset.kind]}</span>
      <span className="asset-name" title={asset.name}>
        {asset.name}
        <small>
          {asset.duration ? `${asset.duration.toFixed(1)}秒 · ` : ''}
          {asset.width ? `${asset.width}×${asset.height} · ` : ''}
          {formatSize(asset.size)}
        </small>
      </span>
      <button className="btn small" onClick={() => placeAsset(asset)} title="再生位置に配置">
        配置
      </button>
      <button className="icon-btn" onClick={() => removeAsset(asset.id)} title="素材を削除" aria-label={`${asset.name}を削除`}>
        ✕
      </button>
    </li>
  );
}
