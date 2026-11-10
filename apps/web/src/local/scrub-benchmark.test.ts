import { describe, expect, it } from 'vitest';

import { formatBenchmark, measureFrameCost } from './scrub-benchmark';

/** scrub 基准回归（W-09 收尾）。 */
describe('measureFrameCost', () => {
  it('按采样次数调用帧源并逐帧递增索引', () => {
    const seen: number[] = [];
    const result = measureFrameCost((index) => {
      seen.push(index);
      return new Uint8Array(4);
    }, 5);
    expect(seen).toEqual([0, 1, 2, 3, 4]);
    expect(result.samples).toBe(5);
  });

  it('耗时非负且峰值不小于均值', () => {
    const result = measureFrameCost(() => new Uint8Array(320 * 180 * 4), 8);
    expect(result.avgMs).toBeGreaterThanOrEqual(0);
    expect(result.maxMs).toBeGreaterThanOrEqual(result.avgMs);
  });

  it('阈值判定使用峰值', () => {
    const result = measureFrameCost(() => new Uint8Array(4), 3, 1000);
    expect(result.pass).toBe(true);
    expect(result.thresholdMs).toBe(1000);
  });

  it('非法采样次数被拒绝', () => {
    expect(() => measureFrameCost(() => new Uint8Array(4), 0)).toThrow(/正数/);
    expect(() => measureFrameCost(() => new Uint8Array(4), Number.NaN)).toThrow(/正数/);
  });

  it('帧源抛错时向上传播', () => {
    expect(() =>
      measureFrameCost(() => {
        throw new Error('core 合成失败');
      }, 3),
    ).toThrow(/core 合成失败/);
  });
});

describe('formatBenchmark', () => {
  it('达标与超标文案', () => {
    expect(formatBenchmark({ samples: 30, avgMs: 1.2, maxMs: 2.5, thresholdMs: 16, pass: true }))
      .toBe('30 帧 · 平均 1.2ms / 峰值 2.5ms · 阈值 16ms 达标');
    expect(formatBenchmark({ samples: 30, avgMs: 20, maxMs: 30, thresholdMs: 16, pass: false }))
      .toContain('超标');
  });
});
