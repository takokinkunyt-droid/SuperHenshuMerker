// 素材ファイルの保存先。OPFS（Origin Private File System）を優先し、使えなければ IndexedDB に置く。
import { STORE_BLOBS, idbDelete, idbGet, idbPut } from './idb';

async function opfsProjectDir(projectId: string, create: boolean): Promise<FileSystemDirectoryHandle | null> {
  try {
    if (!navigator.storage?.getDirectory) return null;
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle('projects', { create: true });
    return await projects.getDirectoryHandle(projectId, { create });
  } catch {
    return null;
  }
}

let opfsWritable: boolean | null = null;

async function canWriteOpfs(): Promise<boolean> {
  if (opfsWritable !== null) return opfsWritable;
  try {
    const dir = await opfsProjectDir('__probe__', true);
    if (!dir) return (opfsWritable = false);
    const handle = await dir.getFileHandle('probe', { create: true });
    opfsWritable = typeof (handle as FileSystemFileHandle & { createWritable?: unknown }).createWritable === 'function';
  } catch {
    opfsWritable = false;
  }
  return opfsWritable;
}

const blobKey = (projectId: string, assetId: string) => `${projectId}/${assetId}`;

/** 大きなファイルを保存するときの1回分の大きさ（進み具合を出すために分けて書く） */
const WRITE_CHUNK = 32 * 1024 * 1024;

/**
 * 素材を保存する。大きなファイルは少しずつ書き込み、進み具合（0〜1）を onProgress に知らせる。
 * 空き容量が足りないときは、わかりやすい説明つきのエラーにする。
 */
export async function putAsset(projectId: string, assetId: string, blob: Blob, onProgress?: (ratio: number) => void): Promise<void> {
  try {
    if (await canWriteOpfs()) {
      const dir = await opfsProjectDir(projectId, true);
      if (dir) {
        const handle = await dir.getFileHandle(assetId, { create: true });
        const writable = await handle.createWritable();
        try {
          for (let offset = 0; offset < blob.size || offset === 0; offset += WRITE_CHUNK) {
            await writable.write(blob.slice(offset, offset + WRITE_CHUNK));
            onProgress?.(Math.min(1, (offset + WRITE_CHUNK) / Math.max(1, blob.size)));
          }
          await writable.close();
        } catch (err) {
          await writable.abort().catch(() => undefined);
          await dir.removeEntry(assetId).catch(() => undefined);
          throw err;
        }
        return;
      }
    }
    await idbPut(STORE_BLOBS, blob, blobKey(projectId, assetId));
  } catch (err) {
    if (err instanceof DOMException && err.name === 'QuotaExceededError') {
      const est = await navigator.storage?.estimate?.().catch(() => null);
      const free = est?.quota && est.usage !== undefined ? `（残り約${((est.quota - est.usage) / 1e9).toFixed(1)}GB、ファイルは${(blob.size / 1e9).toFixed(1)}GB）` : '';
      throw new Error(`ブラウザの保存領域がいっぱいで、このファイルを取り込めません${free}。使っていないプロジェクトを「📁」から削除するか、パソコンの空き容量を増やしてください。`);
    }
    throw err;
  }
}

export async function getAsset(projectId: string, assetId: string): Promise<Blob | null> {
  const dir = await opfsProjectDir(projectId, false);
  if (dir) {
    try {
      const handle = await dir.getFileHandle(assetId);
      return await handle.getFile();
    } catch {
      // OPFSに無ければIndexedDBを見る
    }
  }
  return (await idbGet<Blob>(STORE_BLOBS, blobKey(projectId, assetId))) ?? null;
}

export async function deleteProjectAssets(projectId: string): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    const projects = await root.getDirectoryHandle('projects', { create: true });
    await projects.removeEntry(projectId, { recursive: true });
  } catch {
    // 無ければ何もしない
  }
  await idbDelete(STORE_BLOBS, IDBKeyRange.bound(`${projectId}/`, `${projectId}/￿`));
}
