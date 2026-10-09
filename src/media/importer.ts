// ファイルを素材として取り込む：種類を判定し、長さやサイズを調べてストレージに保存する。
import type { AssetKind, AssetMeta } from '../types';
import { uid } from '../state/defaults';
import { putAsset } from '../persist/assetStorage';
import { decodeAudioFile, media } from './mediaCache';

const EXT_KIND: Record<string, AssetKind> = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', bmp: 'image', svg: 'image',
  mp4: 'video', webm: 'video', mov: 'video', m4v: 'video',
  mp3: 'audio', wav: 'audio', ogg: 'audio', m4a: 'audio', aac: 'audio', flac: 'audio', opus: 'audio',
};

const EXT_MIME: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
};

export function kindOf(file: { name: string; type: string }): AssetKind | null {
  const top = file.type.split('/')[0];
  if (top === 'image' || top === 'video' || top === 'audio') return top;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  return EXT_KIND[ext] ?? null;
}

function probeVideo(blob: Blob): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.onloadedmetadata = () => {
      resolve({ duration: v.duration, width: v.videoWidth, height: v.videoHeight });
      URL.revokeObjectURL(url);
    };
    v.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('この動画形式はブラウザで読み込めません'));
    };
    v.src = url;
  });
}

/** Blobを素材として保存し、メタ情報を返す（プロジェクトへの登録は呼び出し側で行う） */
export async function importBlob(projectId: string, blob: Blob, name: string): Promise<AssetMeta> {
  const kind = kindOf({ name, type: blob.type });
  if (!kind) throw new Error(`${name}: 対応していないファイル形式です`);
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const meta: AssetMeta = { id: uid(), name, kind, mime: blob.type || EXT_MIME[ext] || 'application/octet-stream', size: blob.size };

  if (kind === 'image') {
    const bmp = await createImageBitmap(blob);
    meta.width = bmp.width;
    meta.height = bmp.height;
    bmp.close();
  } else if (kind === 'audio') {
    const buffer = await decodeAudioFile(blob);
    meta.duration = buffer.duration;
    media.setAudio(meta.id, buffer);
  } else {
    Object.assign(meta, await probeVideo(blob));
  }

  await putAsset(projectId, meta.id, blob);
  media.primeBlob(meta.id, blob);
  await media.ensure(meta);
  return meta;
}
