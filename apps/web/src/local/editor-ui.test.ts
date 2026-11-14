import { describe, expect, it } from 'vitest';

import { formatTimecode, rulerTicks, snapTicks } from './editor-ui';

describe('时间轴产品化纯函数（经典版 UI 同步第二批）', () => {
  it('rulerTicks 每秒一个刻度并封顶', () => {
    expect(rulerTicks(360000, 120000)).toEqual([0, 120000, 240000, 360000]);
    expect(rulerTicks(0, 120000)).toEqual([0]);
    expect(rulerTicks(120000 * 1000, 120000, 5)).toHaveLength(6);
  });

  it('formatTimecode 输出 mm:ss.ff', () => {
    expect(formatTimecode(0, 4000, 120000)).toBe('00:00.00');
    expect(formatTimecode(45, 4000, 120000)).toBe('00:01.15');
    expect(formatTimecode(90, 4000, 120000)).toBe('00:03.00');
  });

  it('snapTicks 关闭吸附时只四舍五入', () => {
    expect(snapTicks(12345, [0, 120000], 4000, 1000, false)).toBe(12345);
  });

  it('snapTicks 开启时先量化到帧网格', () => {
    expect(snapTicks(12345, [], 4000, 1, true)).toBe(12000);
  });

  it('snapTicks 仅吸附阈值内的最近边界', () => {
    expect(snapTicks(121000, [120000], 4000, 2000, true)).toBe(120000);
    expect(snapTicks(100000, [120000], 4000, 2000, true)).toBe(100000);
  });
});
