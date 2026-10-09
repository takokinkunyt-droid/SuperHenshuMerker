import { describe, expect, it } from 'vitest';
import { computeEnvelope, isBlinking, levelAt, mouthFor } from '../src/media/lipsync';
import { wrapLines } from '../src/render/renderer';

describe('lip sync envelope', () => {
  it('is near zero for silence and high for loud sections', () => {
    const rate = 1000;
    const ch = new Float32Array(rate * 2);
    for (let i = rate; i < rate * 2; i++) ch[i] = Math.sin(i / 3) * 0.8;
    const env = computeEnvelope([ch], rate, 10);
    expect(env).toHaveLength(20);
    expect(levelAt(env, 0.5, 10)).toBe(0);
    expect(levelAt(env, 1.5, 10)).toBeGreaterThan(0.9);
    expect(mouthFor(levelAt(env, 0.5, 10))).toBe('closed');
    expect(mouthFor(levelAt(env, 1.5, 10))).toBe('open');
  });
});

describe('blink', () => {
  it('is deterministic and brief', () => {
    let closed = 0;
    for (let f = 0; f < 30 * 40; f++) if (isBlinking(f / 30, 'char')) closed++;
    // 40秒で10回前後、1回あたり3〜4フレーム
    expect(closed).toBeGreaterThan(20);
    expect(closed).toBeLessThan(60);
    expect(isBlinking(12.34, 'x')).toBe(isBlinking(12.34, 'x'));
  });
});

describe('wrapLines', () => {
  it('wraps by width and respects newlines', () => {
    const measure = (s: string) => [...s].length * 10;
    expect(wrapLines(measure, 'あいうえおかきくけこ', 40)).toEqual(['あいうえ', 'おかきく', 'けこ']);
    expect(wrapLines(measure, 'ab\ncd', 100)).toEqual(['ab', 'cd']);
  });
});
