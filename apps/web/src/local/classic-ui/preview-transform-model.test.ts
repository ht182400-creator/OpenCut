import { describe, expect, it } from 'vitest';

import {
  MIN_BOX_SIZE_PERCENT,
  boxFromTransform,
  pointerAngleDeg,
  rotateByPointer,
  transformFromBox,
  type SelectionBox,
} from './preview-transform-model';
import type { ElementTransform } from '../element-composite';

/** 身份变换（满幅）。 */
const IDENTITY: ElementTransform = {
  opacity: 1, positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotate: 0,
};
const WIDTH = 320;
const HEIGHT = 180;

/** 第二档：预览 transform box 写回的映射与旋转纯函数回归。 */
describe('preview-transform-model', () => {
  it('身份变换映射为满幅选框（left/top=0，宽高=100）', () => {
    expect(boxFromTransform(IDENTITY, WIDTH, HEIGHT)).toEqual({
      left: 0, top: 0, width: 100, height: 100, rotation: 0,
    });
  });

  it('缩放 0.5 + 平移半幅 → 选框居中且宽高 50%', () => {
    const box = boxFromTransform(
      { ...IDENTITY, scaleX: 0.5, scaleY: 0.5, positionX: 80, positionY: 45 },
      WIDTH, HEIGHT,
    );
    expect(box.width).toBe(50);
    expect(box.height).toBe(50);
    // centerX = 50 + 80/320*100 = 75 → left = 75 - 25 = 50
    expect(box.left).toBe(50);
    // centerY = 50 + 45/180*100 = 75 → top = 75 - 25 = 50
    expect(box.top).toBe(50);
  });

  it('box → transform → box 往返一致（中心/缩放/旋转）', () => {
    const original: SelectionBox = { left: 12, top: 8, width: 40, height: 30, rotation: 37 };
    const transform = transformFromBox(original, WIDTH, HEIGHT);
    const restored = boxFromTransform(transform, WIDTH, HEIGHT);
    expect(restored.left).toBeCloseTo(original.left, 6);
    expect(restored.top).toBeCloseTo(original.top, 6);
    expect(restored.width).toBeCloseTo(original.width, 6);
    expect(restored.height).toBeCloseTo(original.height, 6);
    expect(restored.rotation).toBe(original.rotation);
  });

  it('不合法画布尺寸（0/负数/NaN/undefined）回落兜底且不产生 NaN', () => {
    for (const size of [0, -10, Number.NaN, undefined]) {
      const box = boxFromTransform(IDENTITY, size as number, size as number);
      expect(Number.isFinite(box.left)).toBe(true);
      expect(Number.isFinite(box.width)).toBe(true);
      expect(box.width).toBe(100);
    }
  });

  it('过小选框夹逼到最小边长，超范围旋转夹逼到 ±360', () => {
    const transform = transformFromBox(
      { left: 10, top: 10, width: 0, height: -5, rotation: 999 },
      WIDTH, HEIGHT,
    );
    expect(transform.scaleX).toBeGreaterThanOrEqual(MIN_BOX_SIZE_PERCENT / 100);
    expect(transform.scaleY).toBeGreaterThanOrEqual(MIN_BOX_SIZE_PERCENT / 100);
    expect(transform.rotate).toBe(360);
  });

  it('超小/超大缩放经 normalize 夹逼到 SCALE 域', () => {
    const tiny = transformFromBox({ left: 50, top: 50, width: -100, height: -100, rotation: 0 }, WIDTH, HEIGHT);
    const huge = transformFromBox({ left: 0, top: 0, width: 100000, height: 100000, rotation: 0 }, WIDTH, HEIGHT);
    expect(tiny.scaleX).toBeGreaterThan(0);
    expect(huge.scaleX).toBeLessThanOrEqual(100);
  });

  it('pointerAngleDeg：右 0°、下 90°、左 180°、上 -90°', () => {
    expect(pointerAngleDeg(0, 0, 10, 0)).toBe(0);
    expect(pointerAngleDeg(0, 0, 0, 10)).toBe(90);
    expect(pointerAngleDeg(0, 0, -10, 0)).toBe(180);
    expect(pointerAngleDeg(0, 0, 0, -10)).toBe(-90);
  });

  it('rotateByPointer：跨 ±180 走最短路径（350°→10° 得 +20 而非 -340）', () => {
    expect(rotateByPointer(350, 10, 0)).toBe(20);
    expect(rotateByPointer(10, 350, 0)).toBe(-20);
  });

  it('rotateByPointer：接近 90° 倍数时吸附', () => {
    expect(rotateByPointer(0, 88, 0)).toBe(90);
    expect(rotateByPointer(0, 92, 0)).toBe(90);
    expect(rotateByPointer(0, 178, 0)).toBe(180);
  });

  it('rotateByPointer：远离吸附阈值时保留原角度', () => {
    expect(rotateByPointer(0, 45, 10)).toBe(55);
  });

  it('rotateByPointer：结果始终夹逼到 [-360,360]', () => {
    expect(rotateByPointer(0, 10, 720)).toBe(360);
    expect(rotateByPointer(0, -10, -720)).toBe(-360);
  });
})
