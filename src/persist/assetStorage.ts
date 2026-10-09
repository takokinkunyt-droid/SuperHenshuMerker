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

export async function putAsset(projectId: string, assetId: string, blob: Blob): Promise<void> {
  if (await canWriteOpfs()) {
    const dir = await opfsProjectDir(projectId, true);
    if (dir) {
      const handle = await dir.getFileHandle(assetId, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    }
  }
  await idbPut(STORE_BLOBS, blob, blobKey(projectId, assetId));
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
