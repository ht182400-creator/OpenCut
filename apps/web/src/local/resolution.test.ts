import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RESOLUTION,
  PROXY_HEIGHT,
  PROXY_WIDTH,
  RESOLUTION_PRESETS,
  formatResolution,
  isValidResolution,
  resolutionLabel,
} from './resolution';

/** 批 7.2 可变分辨率：预设、校验与格式化纯函数的回归网。 */
describe('分辨率预设', () => {
  it('默认分辨率是 320×180，保持历史回归', () => {
    expect(DEFAULT_RESOLUTION.width).toBe(320);
    expect(DEFAULT_RESOLUTION.height).toBe(180);
    expect(PROXY_WIDTH).toBe(320);
    expect(PROXY_HEIGHT).toBe(180);
  });

  it('所有预设均为正偶数且 16:9，满足 WebCodecs 编码约束', () => {
    expect(RESOLUTION_PRESETS.length).toBeGreaterThan(0);
    for (const preset of RESOLUTION_PRESETS) {
      expect(isValidResolution(preset.width, preset.height)).toBe(true);
      expect(preset.width * 9).toBe(preset.height * 16);
    }
  });

  it('预设宽高互不重复', () => {
    const keys = RESOLUTION_PRESETS.map((preset) => `${preset.width}x${preset.height}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('isValidResolution 校验', () => {
  it('合法值：正偶数宽高', () => {
    expect(isValidResolution(320, 180)).toBe(true);
    expect(isValidResolution(2, 2)).toBe(true);
  });

  it('边界：奇数宽或高不合法', () => {
    expect(isValidResolution(321, 180)).toBe(false);
    expect(isValidResolution(320, 181)).toBe(false);
  });

  it('边界：0、负数、小数不合法', () => {
    expect(isValidResolution(0, 180)).toBe(false);
    expect(isValidResolution(320, 0)).toBe(false);
    expect(isValidResolution(-320, 180)).toBe(false);
    expect(isValidResolution(320.5, 180)).toBe(false);
    expect(isValidResolution(320, Number.NaN)).toBe(false);
  });
});

describe('格式化与文案', () => {
  it('formatResolution 输出「宽×高」', () => {
    expect(formatResolution(320, 180)).toBe('320×180');
    expect(formatResolution(1280, 720)).toBe('1280×720');
  });

  it('resolutionLabel 命中预设返回带说明的 label', () => {
    expect(resolutionLabel(320, 180)).toBe('320 × 180（代理）');
    expect(resolutionLabel(640, 360)).toBe('640 × 360');
  });

  it('resolutionLabel 未命中预设回退到纯尺寸文本', () => {
    expect(resolutionLabel(800, 600)).toBe('800×600');
  });
});
