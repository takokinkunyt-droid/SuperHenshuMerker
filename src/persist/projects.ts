import type { Project } from '../types';
import { STORE_META, STORE_PROJECTS, idbDelete, idbGet, idbGetAll, idbPut } from './idb';
import { deleteProjectAssets } from './assetStorage';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  itemCount: number;
}

export async function saveProject(project: Project): Promise<void> {
  await idbPut(STORE_PROJECTS, project);
  await idbPut(STORE_META, project.id, 'lastProjectId');
}

export async function loadStoredProject(id: string): Promise<Project | null> {
  return (await idbGet<Project>(STORE_PROJECTS, id)) ?? null;
}

export async function lastProjectId(): Promise<string | null> {
  return (await idbGet<string>(STORE_META, 'lastProjectId')) ?? null;
}

export async function listProjects(): Promise<ProjectSummary[]> {
  const all = await idbGetAll<Project>(STORE_PROJECTS);
  return all
    .map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt, itemCount: p.items.length }))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteProject(id: string): Promise<void> {
  await idbDelete(STORE_PROJECTS, id);
  await deleteProjectAssets(id);
}

/** ブラウザに保存領域を勝手に消さないよう求める（データ消失対策） */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (!navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
