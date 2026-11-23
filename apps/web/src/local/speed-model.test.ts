import { describe, expect, it } from 'vitest';

import { mapProjectFrame } from './timeline';
import type { TimelineClip } from './timeline';
import {
  DEFAULT_SPEED,
  SPEED_MAX,
  SPEED_MIN,
  mapProjectFrameWithSpeed,
  readSpeed,
} from './speed-model';

/** 每秒 ticks。 */
const TPS = 120000;
/** 造片段（带透传 params 的 TimelineClip 扩展）。 */
type SpeedClip = TimelineClip & { params?: Record<string, unknown> };
function clip(speed?: number): SpeedClip {
  return {
    id: 'c1', startTime: 0, duration: 5 * TPS, trimStart: 0,
    ...(speed === undefined ? {} : { params: { speed } }),
  };
}

/** 第二档项 2：speed 参数读取与倍速帧映射回归。 */
describe('speed-model', () => {
  it('readSpeed：缺失/非法/非正数回落默认值', () => {
    expect(readSpeed(null)).toBe(DEFAULT_SPEED);
    expect(readSpeed(clip())).toBe(DEFAULT_SPEED);
    expect(readSpeed(clip(Number.NaN))).toBe(DEFAULT_SPEED);
    expect(readSpeed(clip(0))).toBe(DEFAULT_SPEED);
    expect(readSpeed(clip(-2))).toBe(DEFAULT_SPEED);
    expect(readSpeed({ ...clip(), params: { speed: '1.5' } })).toBe(1.5);
  });

  it('readSpeed：夹逼到 [0.25,4]', () => {
    expect(readSpeed(clip(0.01))).toBe(SPEED_MIN);
    expect(readSpeed(clip(100))).toBe(SPEED_MAX);
    expect(readSpeed(clip(2))).toBe(2);
  });

  it('speed=1 与原映射函数逐项一致', () => {
    const clips = [clip(1)];
    for (const t of [0, 0.5 * TPS, TPS, 2.5 * TPS]) {
      expect(mapProjectFrameWithSpeed(clips, t, 30, 60)).toEqual(mapProjectFrame(clips, t, 30, 60));
    }
  });

  it('speed=2 快放：项目 1 秒取素材 2 秒帧', () => {
    const clips = [clip(2)];
    expect(mapProjectFrameWithSpeed(clips, TPS, 30, 90).sourceFrameIndex).toBe(60);
    expect(mapProjectFrame(clips, TPS, 30, 90).sourceFrameIndex).toBe(30);
  });

  it('speed=0.5 慢放：项目 1 秒取素材 0.5 秒帧', () => {
    const clips = [clip(0.5)];
    expect(mapProjectFrameWithSpeed(clips, TPS, 30, 90).sourceFrameIndex).toBe(15);
  });

  it('trimStart 参与倍速映射', () => {
    const clips = [{ ...clip(2), trimStart: TPS }];
    // 项目 1s → 素材 1s(trim) + 2s(经过×2) = 3s → 帧 90
    expect(mapProjectFrameWithSpeed(clips, TPS, 30, 120).sourceFrameIndex).toBe(90);
  });

  it('空档返回 null（不改变原函数行为）', () => {
    expect(mapProjectFrameWithSpeed([], TPS, 30, 60)).toEqual({ clipId: null, sourceFrameIndex: null });
  });

  it('素材帧循环：超大 speed 不产生越界索引', () => {
    const clips = [clip(4)];
    // 片段时长 5s，取 4s（仍在片段内）：素材时间 16s → 帧 480 % 7
    const result = mapProjectFrameWithSpeed(clips, 4 * TPS, 30, 7);
    expect(result.sourceFrameIndex).not.toBeNull();
    expect(result.sourceFrameIndex!).toBeGreaterThanOrEqual(0);
    expect(result.sourceFrameIndex!).toBeLessThan(7);
  });
})
