// プロジェクトをZIP（project.json＋素材）として書き出し・読み込みする。
import { strFromU8, strToU8, unzip, zip, type Zippable } from 'fflate';
import type { Project } from '../types';
import { getAsset, putAsset } from './assetStorage';
import { migrateProject } from './migrate';

export async function exportProjectZip(project: Project): Promise<Blob> {
  const files: Zippable = {
    'project.json': strToU8(JSON.stringify(project, null, 2)),
  };
  for (const asset of Object.values(project.assets)) {
    const blob = await getAsset(project.id, asset.id);
    if (!blob) continue;
    // 圧縮済みの動画・音声・画像は再圧縮しない
    files[`assets/${asset.id}`] = [new Uint8Array(await blob.arrayBuffer()), { level: 0 }];
  }
  const data = await new Promise<Uint8Array>((resolve, reject) =>
    zip(files, (err, out) => (err ? reject(err) : resolve(out))),
  );
  return new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' });
}

export async function importProjectZip(file: Blob): Promise<Project> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const entries = await new Promise<Record<string, Uint8Array>>((resolve, reject) =>
    unzip(bytes, (err, out) => (err ? reject(err) : resolve(out))),
  );
  const json = entries['project.json'];
  if (!json) throw new Error('project.json が見つかりません。スーパー編集メーカーのZIPではないようです。');
  const project = migrateProject(JSON.parse(strFromU8(json)));
  for (const asset of Object.values(project.assets)) {
    const data = entries[`assets/${asset.id}`];
    if (data) await putAsset(project.id, asset.id, new Blob([data as Uint8Array<ArrayBuffer>], { type: asset.mime }));
  }
  return project;
}
