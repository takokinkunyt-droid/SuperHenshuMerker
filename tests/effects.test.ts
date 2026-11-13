import { describe, expect, it } from 'vitest';
import { slideOffset, snapBox, snapLines, textBox } from '../src/render/effects';
import { computeFx, fxMatrix, transformedBounds } from '../src/render/itemFx';
import { VISUAL_FX, type FxCtx } from '../src/fx/visual';
import { AUDIO_FX, fadeEnvelope } from '../src/fx/audio';
import { migrateProject } from '../src/persist/migrate';
import type { Fx } from '../src/types';
import { defaultTextStyle } from '../src/state/defaults';

const project = { width: 1920, height: 1080 };
const box = { x: 860, y: 440, w: 200, h: 200 };

const ctxAt = (local: number, dur = 10): FxCtx => ({ local, dur, box, W: project.width, H: project.height, seed: 0.3 });
const fx = (type: string, p: Fx['p'] = {}, extra: Partial<Fx> = {}): Fx => ({ id: type, type, p, ...extra });

describe('visual effects', () => {
  it('fades in and out', () => {
    const list = [fx('fadeInOut', { tin: 1, tout: 2, ease: 'linear' })];
    expect(computeFx(list, ctxAt(0), false).st.alpha).toBe(0);
    expect(computeFx(list, ctxAt(0.5), false).st.alpha).toBeCloseTo(0.5);
    expect(computeFx(list, ctxAt(5), false).st.alpha).toBe(1);
    expect(computeFx(list, ctxAt(9), false).st.alpha).toBeCloseTo(0.5);
  });

  it('slides in from fully off-screen and ends in place', () => {
    const list = [fx('offscreenInOut', { dir: 'left', tin: 1, tout: 0 })];
    const start = computeFx(list, ctxAt(0, 5), false).st;
    expect(box.x + box.w + start.dx).toBe(0); // 右端がちょうど画面の左端
    expect(computeFx(list, ctxAt(1, 5), false).st.dx).toBeCloseTo(0);
    expect(slideOffset('bottom', box, project)).toEqual({ dx: 0, dy: 1080 - 440 });
    expect(slideOffset('top', box, project)).toEqual({ dx: 0, dy: -640 });
  });

  it('stacks effects, skips disabled ones, and animates a value across the item', () => {
    const list = [fx('zoom', { all: { a: 100, b: 200 } }), fx('rot', { angle: 90 }), fx('opacity', { v: 50 }, { off: true })];
    const st = computeFx(list, ctxAt(5), false).st;
    expect(st.sx).toBeCloseTo(1.5);
    expect(st.rot).toBe(90);
    expect(st.alpha).toBe(1);
  });

  it('collects picture effects in order and drops the ones with nothing to do', () => {
    const list = [fx('blur', { r: 0 }), fx('mosaic'), fx('blurInOut', { tin: 1, tout: 0 }), fx('shuffleInOut')];
    expect(computeFx(list, ctxAt(5), false).steps.map((s) => s.def.type)).toEqual(['mosaic']);
    expect(computeFx(list, ctxAt(0.2), false).steps.map((s) => s.def.type)).toEqual(['mosaic', 'blurInOut']);
    expect(computeFx(list, ctxAt(0.2), true).st.shuffle).toBeGreaterThan(0);
  });

  it('builds a matrix that rotates and scales around the box center', () => {
    const st = computeFx([fx('rot', { angle: 90 }), fx('zoom', { all: 200 })], ctxAt(1), false).st;
    const m = fxMatrix(st, box, 0);
    const b = transformedBounds(m, box);
    expect(b.x + b.w / 2).toBeCloseTo(960);
    expect(b.y + b.h / 2).toBeCloseTo(540);
    expect(b.w).toBeCloseTo(400);
  });

  it('has unique effect types and valid defaults', () => {
    const types = [...VISUAL_FX.map((d) => d.type)];
    expect(new Set(types).size).toBe(types.length);
    const audio = AUDIO_FX.map((d) => d.type);
    expect(new Set(audio).size).toBe(audio.length);
    for (const d of [...VISUAL_FX, ...AUDIO_FX]) {
      for (const p of d.params) {
        if (p.t === 'num') expect(p.def >= p.min && p.def <= p.max, `${d.name} ${p.label}`).toBe(true);
        if (p.t === 'sel') expect(p.opts.some((o) => o[0] === p.def), `${d.name} ${p.label}`).toBe(true);
      }
    }
  });

  it('converts old fixed effect settings into effect lists', () => {
    const old = { version: 2, items: [
      { kind: 'image', id: 'a', layer: 0, start: 0, duration: 5, assetId: 'x', x: 0, y: 0, scale: 1, opacity: 1, effects: { blur: 8, fadeIn: 1, slideIn: { direction: 'top', duration: 0.6 } } },
      { kind: 'audio', id: 'b', layer: 1, start: 0, duration: 5, assetId: 'y', sourceOffset: 0, volume: 1, audioEffects: { beep: true, bass: 6 } },
    ] };
    const p = migrateProject(old);
    const img = p.items[0] as { fx?: Fx[]; effects?: unknown };
    expect(img.effects).toBeUndefined();
    expect(img.fx?.map((f) => f.type)).toEqual(['fadeInOut', 'offscreenInOut', 'blur']);
    expect((p.items[1] as { afx?: Fx[] }).afx?.map((f) => f.type)).toEqual(['tone', 'bass']);
    expect(migrateProject(p).items).toEqual(p.items); // もう一度かけても変わらない
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
    expect(fadeEnvelope(2, 1, 0, 10)).toBe(0);
    expect(fadeEnvelope(2, 1, 1, 10)).toBeCloseTo(0.5);
    expect(fadeEnvelope(2, 1, 5, 10)).toBe(1);
    expect(fadeEnvelope(2, 1, 9.5, 10)).toBeCloseTo(0.5);
    expect(fadeEnvelope(0, 0, 3, 10)).toBe(1);
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
