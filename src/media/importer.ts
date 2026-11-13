// ファイルを素材として取り込む：種類を判定し、長さやサイズを調べてストレージに保存する。
import type { AssetKind, AssetMeta } from '../types';
import { uid } from '../state/defaults';
import { putAsset } from '../persist/assetStorage';
import { STREAM_OVER_SEC, decodeAudioFile, media, probeAudioDuration } from './mediaCache';

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

/** 動画の圧縮形式（h264・hevc など）を調べる。調べられなければ null */
async function videoCodec(blob: Blob): Promise<string | null> {
  try {
    const { Input, BlobSource, ALL_FORMATS } = await import('mediabunny');
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    try {
      return (await input.getPrimaryVideoTrack())?.codec ?? null;
    } finally {
      input.dispose();
    }
  } catch {
    return null;
  }
}

/** このブラウザで映像を再生できない動画だったときの説明 */
async function unplayableMessage(blob: Blob, name: string): Promise<string> {
  const codec = await videoCodec(blob);
  if (codec === 'hevc') {
    return (
      `「${name}」は HEVC（H.265・高効率）形式の動画で、このブラウザ／パソコンでは映像を再生できません。` +
      'iPhone の 4K・60fps の動画はこの形式です。次のどれかを試してください：' +
      '① Windows は Microsoft Store の「HEVC ビデオ拡張機能」を入れて Edge で開く　' +
      '② iPhone・iPad・Mac の Safari で開く　' +
      '③ iPhone の「設定 → カメラ → フォーマット → 互換性優先」にして撮り直す（1080p・60fps まで）　' +
      '④ 動画を H.264 の MP4 に変換してから読み込む'
    );
  }
  return `「${name}」は、このブラウザでは映像を再生できない形式です${codec ? `（${codec}）` : ''}。H.264 の MP4 に変換してから読み込んでください。`;
}

function probeVideo(blob: Blob, name: string): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    v.playsInline = true;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      URL.revokeObjectURL(url);
      fn();
    };
    const fail = () => void unplayableMessage(blob, name).then((msg) => finish(() => reject(new Error(msg))));
    // いつまでも返事が無いとき（一部のスマホで起きる）も、待ち続けずにエラーにする
    const timer = setTimeout(fail, 30000);
    v.onloadedmetadata = () => {
      const { duration, videoWidth: width, videoHeight: height } = v;
      // 音声だけ読めて映像が読めない（幅が0）のは、映像の形式に対応していないとき
      if (!width || !height) fail();
      else finish(() => resolve({ duration, width, height }));
    };
    v.onerror = fail;
    v.src = url;
  });
}

/** Blobを素材として保存し、メタ情報を返す（プロジェクトへの登録は呼び出し側で行う） */
export async function importBlob(
  projectId: string,
  blob: Blob,
  name: string,
  onProgress?: (ratio: number) => void,
  /** 取り込めたが注意が必要なとき（ブラウザ内に保存できなかった、など）に呼ぶ */
  onWarn?: (message: string) => void,
): Promise<AssetMeta> {
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
    // 長い音声は全部をデコードせず、長さだけ調べる（再生するときに少しずつ読む）
    const probed = await probeAudioDuration(blob);
    if (probed && probed > STREAM_OVER_SEC) {
      meta.duration = probed;
    } else {
      const buffer = await decodeAudioFile(blob);
      meta.duration = buffer.duration;
      media.setAudio(meta.id, buffer);
    }
  } else {
    Object.assign(meta, await probeVideo(blob, name));
  }

  try {
    await putAsset(projectId, meta.id, blob, onProgress);
  } catch (err) {
    // ブラウザ内に保存できなくても、選んだファイルをそのまま使って編集は続けられるようにする
    console.warn('素材を保存できませんでした', err);
    onWarn?.(`「${name}」はブラウザ内に保存できませんでしたが、このまま編集・書き出しはできます。ページを開き直したときは、素材の一覧の「選び直す」から同じファイルを選んでください。（${err instanceof Error ? err.message : String(err)}）`);
  }
  media.primeBlob(meta.id, blob);
  await media.ensure(meta);
  return meta;
}
