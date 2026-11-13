import { describe, expect, it } from 'vitest';
import { createProject, defaultTextStyle } from '../src/state/defaults';
import { canPlace, findFreeLayer, nearestLayerShift, recenterItems, splitItem, trimStart } from '../src/state/timeline';
import { migrateProject } from '../src/persist/migrate';
import { outputSize } from '../src/export/exporter';
import { wrapLines } from '../src/render/renderer';
import type { AudioItem, ImageItem, TextItem } from '../src/types';

const audio = (over: Partial<AudioItem> = {}): AudioItem => ({
  kind: 'audio', id: 'a', assetId: 'x', layer: 0, start: 1, duration: 4, sourceOffset: 0.5, volume: 1, ...over,
});

describe('splitItem', () => {
  it('splits a media item and advances the source offset of the second half', () => {
    const [a, b] = splitItem(audio(), 2.5)! as [AudioItem, AudioItem];
    expect(a).toMatchObject({ start: 1, duration: 1.5, sourceOffset: 0.5 });
    expect(b).toMatchObject({ start: 2.5, duration: 2.5, sourceOffset: 2 });
    expect(b.id).not.toBe(a.id);
  });

  it('returns null when the time is outside the item', () => {
    expect(splitItem(audio(), 0.5)).toBeNull();
    expect(splitItem(audio(), 5)).toBeNull();
  });
});

describe('trimStart', () => {
  it('moves the start and the source offset together', () => {
    expect(trimStart(audio(), 1.25)).toMatchObject({ start: 1.25, duration: 3.75, sourceOffset: 0.75 });
  });

  it('cannot extend before the beginning of the source', () => {
    expect(trimStart(audio(), 0)).toMatchObject({ start: 0.5, duration: 4.5, sourceOffset: 0 });
  });
});

describe('findFreeLayer', () => {
  it('skips layers that are occupied in the range', () => {
    const items = [audio({ layer: 3, start: 0, duration: 10 })];
    expect(findFreeLayer(items, 2, 4, 3)).toBe(4);
    expect(findFreeLayer(items, 11, 12, 3)).toBe(3);
  });
});

describe('aspect ratio', () => {
  it('creates vertical projects', () => {
    expect(createProject('x', '9:16')).toMatchObject({ width: 1080, height: 1920 });
  });

  it('keeps centered media centered and bottom text near the bottom when switching 16:9 -> 9:16', () => {
    const p = createProject('x', '16:9');
    const img: ImageItem = { kind: 'image', id: 'i', assetId: 'a', layer: 0, start: 0, duration: 5, x: 960, y: 540, scale: 1, opacity: 1 };
    const text: TextItem = { kind: 'text', id: 't', layer: 1, start: 0, duration: 5, text: 'a', style: defaultTextStyle(1920, 1080) };
    p.items.push(img, text);
    p.width = 1080;
    p.height = 1920;
    recenterItems(p, 1920, 1080);
    expect(img).toMatchObject({ x: 540, y: 960 });
    expect(1920 - text.style.y).toBeCloseTo(1080 - defaultTextStyle(1920, 1080).y);
    expect(text.style.x).toBe(540);
    expect(text.style.maxWidth).toBeLessThanOrEqual(1080 * 0.9);
  });

  it('computes the export size from the short side', () => {
    expect(outputSize({ width: 1080, height: 1920 }, 720)).toEqual({ width: 720, height: 1280 });
    expect(outputSize({ width: 1920, height: 1080 }, 720)).toEqual({ width: 1280, height: 720 });
  });
});

describe('migrateProject', () => {
  it('turns old voice lines into audio + text and drops tachie items', () => {
    const p = migrateProject({
      id: 'p', width: 1920, height: 1080, assets: {},
      characters: [{ id: 'c', subtitle: defaultTextStyle(1920, 1080, { color: '#ff0000' }) }],
      items: [
        { kind: 'voice', id: 'v', layer: 5, start: 1, duration: 2, characterId: 'c', text: 'こんにちは', audioAssetId: 'w', audioOffset: 0, volume: 1, showSubtitle: true },
        { kind: 'tachie', id: 't', layer: 1, start: 0, duration: 3, characterId: 'c' },
        { kind: 'image', id: 'i', layer: 0, start: 0, duration: 3, assetId: 'a', x: 0, y: 0, scale: 1, opacity: 1 },
      ],
    });
    expect(p.version).toBe(2);
    expect(p.items.map((it) => it.kind).sort()).toEqual(['audio', 'image', 'text']);
    const text = p.items.find((it) => it.kind === 'text') as TextItem;
    expect(text).toMatchObject({ text: 'こんにちは', start: 1, duration: 2 });
    expect(text.style.color).toBe('#ff0000');
  });
});

describe('wrapLines', () => {
  it('wraps by width and respects newlines', () => {
    const measure = (s: string) => [...s].length * 10;
    expect(wrapLines(measure, 'あいうえおかきくけこ', 40)).toEqual(['あいうえ', 'おかきく', 'けこ']);
    expect(wrapLines(measure, 'ab\ncd', 100)).toEqual(['ab', 'cd']);
  });
});

describe('formatTime', () => {
  it('shows minutes, and hours past one hour', async () => {
    const { formatTime, rulerStep } = await import('../src/state/timeline');
    expect(formatTime(65.5, 30)).toBe('1:05.15');
    expect(formatTime(3725, 30)).toBe('1:02:05.00');
    expect(rulerStep(0.2)).toBe(600);
  });
});

describe('placing a group of items', () => {
  const at = (id: string, layer: number, start: number, duration = 2): AudioItem => ({ kind: 'audio', id, assetId: 'x', layer, start, duration, sourceOffset: 0, volume: 1 });
  const items = [at('a', 0, 0), at('b', 1, 0), at('wall', 2, 1), at('far', 4, 0)];
  const none = () => false;

  it('rejects positions that overlap other items, go above layer 0, or land on a locked layer', () => {
    const moving = [items[0], items[1]];
    expect(canPlace(items, moving, 0, none)).toBe(true); // 自分たち同士は重なりに数えない
    expect(canPlace(items, moving, 1, none)).toBe(false); // b が wall にぶつかる
    expect(canPlace(items, moving, -1, none)).toBe(false);
    expect(canPlace(items, [at('a', 0, 5)], 3, (l) => l === 3)).toBe(false);
  });

  it('finds the nearest free layer shift, preferring the wanted one', () => {
    const moving = [items[0], items[1]];
    expect(nearestLayerShift(items, moving, 0, none)).toBe(0);
    expect(nearestLayerShift(items, moving, 1, none)).toBe(0); // 1つ下はふさがっているので、近い方（元の位置）
    expect(nearestLayerShift(items, moving, 3, none)).toBe(5); // 3は far、4も far にぶつかるので、その先
    expect(nearestLayerShift(items, [at('a', 0, 10)], 2, none)).toBe(2);
  });
});
