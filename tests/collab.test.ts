import { describe, expect, it } from 'vitest';
import { produce } from 'immer';
import { applyOps, diffProjects } from '../src/collab/ops';
import { createProject, defaultTextStyle } from '../src/state/defaults';
import type { Project, TextItem } from '../src/types';

const text = (id: string, start = 0): TextItem => ({ kind: 'text', id, layer: 4, start, duration: 2, text: id, style: defaultTextStyle(1920, 1080) });

describe('collab ops', () => {
  const base: Project = { ...createProject(), items: [text('a'), text('b', 3)] };

  it('reports only what changed', () => {
    const next = produce(base, (d) => {
      d.items[0].start = 1;
      d.items.push(text('c', 6));
      d.name = '新しい名前';
    });
    const ops = diffProjects(base, next);
    expect(ops.map((o) => o.op).sort()).toEqual(['item', 'item', 'meta']);
    expect(diffProjects(next, next)).toEqual([]);
  });

  it('round-trips: applying the diff reproduces the new project', () => {
    const next = produce(base, (d) => {
      d.items.splice(1, 1);
      d.items[0].text = 'こんにちは';
      d.assets.x = { id: 'x', name: 'x.png', kind: 'image', mime: 'image/png', size: 1 };
      d.backgroundColor = '#123456';
    });
    const result = applyOps(base, diffProjects(base, next));
    expect(result.items).toEqual(next.items);
    expect(result.assets).toEqual(next.assets);
    expect(result.backgroundColor).toBe('#123456');
    // 元のプロジェクトは変わらない
    expect(base.items).toHaveLength(2);
  });

  it('merges concurrent edits to different items, last write wins on the same item', () => {
    const mine = produce(base, (d) => void (d.items[0].start = 5));
    const theirs = produce(base, (d) => void (d.items[1].text = '友達の変更'));
    const server = applyOps(applyOps(base, diffProjects(base, mine)), diffProjects(base, theirs));
    expect(server.items.find((i) => i.id === 'a')!.start).toBe(5);
    expect((server.items.find((i) => i.id === 'b') as TextItem).text).toBe('友達の変更');

    const lateA = produce(base, (d) => void (d.items[0].start = 9));
    expect(applyOps(server, diffProjects(base, lateA)).items.find((i) => i.id === 'a')!.start).toBe(9);
  });

  it('keeps untouched references so a re-diff after a remote apply is empty', () => {
    const remote = diffProjects(base, produce(base, (d) => void (d.items[1].start = 10)));
    const local = applyOps(base, remote);
    const lastSent = applyOps(base, remote);
    expect(diffProjects(lastSent, local)).toEqual([]);
  });
});
