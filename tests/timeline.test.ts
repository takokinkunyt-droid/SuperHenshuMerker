import { describe, expect, it } from 'vitest';
import { createProject } from '../src/state/defaults';
import {
  ensureTachieCovers,
  estimateDuration,
  findFreeLayer,
  itemEnd,
  nextVoiceStart,
  parseScript,
  rippleAfter,
  splitItem,
  trimStart,
  createVoiceItem,
} from '../src/state/timeline';
import type { AudioItem, TachieItem, VoiceItem } from '../src/types';

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

describe('parseScript', () => {
  const p = createProject();
  const [a, b] = p.characters;

  it('assigns lines by name prefix and carries the speaker forward', () => {
    const lines = parseScript(`${a.name}：こんにちは\n続きの行\n\n${b.name}: やあ\n`, p.characters, a.id);
    expect(lines).toEqual([
      { characterId: a.id, text: 'こんにちは' },
      { characterId: a.id, text: '続きの行' },
      { characterId: b.id, text: 'やあ' },
    ]);
  });

  it('keeps colons that are not a known character name', () => {
    const lines = parseScript('時刻：12時です', p.characters, b.id);
    expect(lines).toEqual([{ characterId: b.id, text: '時刻：12時です' }]);
  });
});

describe('voice placement', () => {
  it('places new lines after the last one and creates a covering tachie item', () => {
    const p = createProject();
    const ch = p.characters[0];
    const v1 = createVoiceItem(p, ch.id, 'あいうえお', 0, 2);
    p.items.push(v1);
    ensureTachieCovers(p, ch.id, v1.start, itemEnd(v1));
    expect(nextVoiceStart(p)).toBeCloseTo(2.2);

    const v2 = createVoiceItem(p, ch.id, 'かきくけこ', 2.2, 1);
    p.items.push(v2);
    ensureTachieCovers(p, ch.id, v2.start, itemEnd(v2));

    const tachies = p.items.filter((it): it is TachieItem => it.kind === 'tachie');
    expect(tachies).toHaveLength(1);
    expect(tachies[0].start).toBe(0);
    expect(itemEnd(tachies[0])).toBeCloseTo(3.2);
  });

  it('ripples later items when a line gets longer', () => {
    const p = createProject();
    const ch = p.characters[0];
    const v1 = createVoiceItem(p, ch.id, 'a', 0, 1);
    const v2 = createVoiceItem(p, ch.id, 'b', 1.2, 1);
    p.items.push(v1, v2);
    ensureTachieCovers(p, ch.id, 0, 2.2);
    v1.duration = 1.5;
    rippleAfter(p, 1, 0.5, v1.id);
    expect((p.items.find((it) => it.id === v2.id) as VoiceItem).start).toBeCloseTo(1.7);
    const tachie = p.items.find((it) => it.kind === 'tachie')!;
    expect(itemEnd(tachie)).toBeCloseTo(2.7);
  });

  it('estimates a minimum duration for short text', () => {
    expect(estimateDuration('あ')).toBe(1);
    expect(estimateDuration('あいうえおかきくけこさしすせそ')).toBeGreaterThan(2);
  });
});
