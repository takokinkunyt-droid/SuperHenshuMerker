import { describe, expect, it } from 'vitest';
import { effectState, slideOffset, snapBox, snapLines, textBox } from '../src/render/effects';
import { fadeEnvelope } from '../src/media/audioMix';
import { defaultTextStyle } from '../src/state/defaults';

const project = { width: 1920, height: 1080 };
const box = { x: 860, y: 440, w: 200, h: 200 };

describe('visual effects', () => {
  it('fades in and out', () => {
    const fx = { fadeIn: 1, fadeOut: 2 };
    expect(effectState(fx, 0, 10, box, project).alpha).toBe(0);
    expect(effectState(fx, 0.5, 10, box, project).alpha).toBeCloseTo(0.5);
    expect(effectState(fx, 5, 10, box, project).alpha).toBe(1);
    expect(effectState(fx, 9, 10, box, project).alpha).toBeCloseTo(0.5);
  });

  it('slides in from fully off-screen and ends in place', () => {
    const fx = { slideIn: { direction: 'left' as const, duration: 1 } };
    const start = effectState(fx, 0, 5, box, project);
    expect(box.x + box.w + start.dx).toBe(0); // 右端がちょうど画面の左端
    expect(effectState(fx, 1, 5, box, project).dx).toBeCloseTo(0);
    expect(slideOffset('bottom', box, project)).toEqual({ dx: 0, dy: 1080 - 440 });
    expect(slideOffset('top', box, project)).toEqual({ dx: 0, dy: -640 });
  });

  it('zooms from the given scale to 1', () => {
    const fx = { zoomIn: { from: 0.2, duration: 1 } };
    expect(effectState(fx, 0, 5, box, project).zoom).toBeCloseTo(0.2);
    expect(effectState(fx, 2, 5, box, project).zoom).toBe(1);
  });
});

describe('snapping', () => {
  const lines = snapLines(project, [{ x: 100, y: 100, w: 300, h: 100 }]);

  it('snaps the center of a box to the screen center', () => {
    const r = snapBox({ x: 856, y: 300, w: 200, h: 50 }, lines, 10);
    expect(r.dx).toBe(4);
    expect(r.guidesX).toEqual([960]);
  });

  it('snaps edges to other items and safe margins, and ignores far lines', () => {
    expect(snapBox({ x: 403, y: 600, w: 100, h: 40 }, lines, 10).dx).toBe(-3); // 他のアイテムの右端 400
    expect(snapBox({ x: 500, y: 1020, w: 100, h: 7 }, lines, 10).dy).toBe(1026 - 1027); // 下の余白 95%
    expect(snapBox({ x: 600, y: 700, w: 100, h: 40 }, lines, 10)).toMatchObject({ dx: 0, dy: 0, guidesX: [], guidesY: [] });
  });

  it('computes a text box that sits on the text baseline position', () => {
    const style = defaultTextStyle(1920, 1080);
    const b = textBox(style, [400, 300]);
    expect(b.x + b.w / 2).toBe(style.x);
    expect(b.w).toBe(400 + style.strokeWidth * 2);
    expect(b.y + b.h).toBeCloseTo(style.y + style.strokeWidth / 2);
  });
});

describe('audio fade envelope', () => {
  it('ramps volume at both ends', () => {
    const fx = { fadeIn: 2, fadeOut: 1 };
    expect(fadeEnvelope(fx, 0, 10)).toBe(0);
    expect(fadeEnvelope(fx, 1, 10)).toBeCloseTo(0.5);
    expect(fadeEnvelope(fx, 5, 10)).toBe(1);
    expect(fadeEnvelope(fx, 9.5, 10)).toBeCloseTo(0.5);
    expect(fadeEnvelope(undefined, 3, 10)).toBe(1);
  });
});

describe('text background and credits', () => {
  it('grows the text box by the background padding', async () => {
    const { textBox, textGlyphBox } = await import('../src/render/effects');
    const style = { ...defaultTextStyle(1920, 1080), background: { color: '#000', opacity: 0.6, padding: 20, radius: 10 } };
    const glyph = textGlyphBox(style, [300]);
    const b = textBox(style, [300]);
    expect(b.w).toBe(glyph.w + 40);
    expect(b.h).toBe(glyph.h + 40);
    expect(b.x).toBe(glyph.x - 20);
  });

  it('builds one VOICEVOX credit line per speaker', async () => {
    const { buildCredits } = await import('../src/state/ttsActions');
    const { createProject } = await import('../src/state/defaults');
    const p = createProject();
    const tts = (name: string) => ({ text: 'a', speakerId: 1, speakerName: name, styleLabel: name, speedScale: 1, pitchScale: 0, intonationScale: 1, volumeScale: 1 });
    const audio = (id: string, name?: string) => ({ kind: 'audio' as const, id, assetId: 'x', layer: 7, start: 0, duration: 1, sourceOffset: 0, volume: 1, ...(name ? { tts: tts(name) } : {}) });
    p.items.push(audio('a', 'ずんだもん'), audio('b', 'ずんだもん'), audio('c', '四国めたん'), audio('d'));
    expect(buildCredits(p)).toBe('VOICEVOX:ずんだもん\nVOICEVOX:四国めたん');
  });
});
