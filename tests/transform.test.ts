import { describe, expect, it } from 'vitest';
import { angleOf, hitBox, rotatePoint, scaleTextStyle, snapAngle } from '../src/render/transform';
import { defaultTextStyle } from '../src/state/defaults';

describe('transform geometry', () => {
  const box = { x: 100, y: 100, w: 200, h: 50 };

  it('hit-tests rotated boxes', () => {
    // 回転なしなら横長の端は当たり、上下にはみ出した点は外れる
    expect(hitBox(box, 0, { x: 290, y: 125 })).toBe(true);
    expect(hitBox(box, 0, { x: 200, y: 200 })).toBe(false);
    // 90度回すと縦長になる
    expect(hitBox(box, 90, { x: 290, y: 125 })).toBe(false);
    expect(hitBox(box, 90, { x: 200, y: 210 })).toBe(true);
  });

  it('rotates points clockwise around a center', () => {
    const p = rotatePoint({ x: 10, y: 0 }, { x: 0, y: 0 }, 90);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(10);
    expect(angleOf({ x: 0, y: 10 }, { x: 0, y: 0 })).toBeCloseTo(90);
  });

  it('snaps angles near right angles and normalizes', () => {
    expect(snapAngle(3)).toBe(0);
    expect(snapAngle(88)).toBe(90);
    expect(snapAngle(45)).toBe(45);
    expect(snapAngle(270)).toBe(-90);
    expect(snapAngle(-178)).toBe(180);
  });

  it('scales text around the box center', () => {
    const style = defaultTextStyle(1920, 1080); // fontSize 70, y 950
    const b = { x: 800, y: 870, w: 320, h: 80 }; // 中心 y = 910
    const scaled = scaleTextStyle(style, b, 2);
    expect(scaled.fontSize).toBe(style.fontSize * 2);
    expect(scaled.strokeWidth).toBeCloseTo(style.strokeWidth * 2);
    expect(scaled.maxWidth).toBe(style.maxWidth * 2);
    expect(scaled.y).toBe(910 + (style.y - 910) * 2);
    expect(scaled.x).toBe(style.x);
  });
});
