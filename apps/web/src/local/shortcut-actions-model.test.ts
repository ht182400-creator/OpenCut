import { describe, expect, it } from 'vitest';

import type { TimelineClip } from './timeline';
import {
  jumpBackwardFiveSeconds,
  jumpForwardFiveSeconds,
  seekBackwardOneSecond,
  seekBySeconds,
  seekForwardOneSecond,
  SHORTCUT_TICKS_PER_SECOND,
  splitAndRemoveLeft,
  splitAndRemoveRight,
  toggleBookmarkAt,
} from './shortcut-actions-model';

/** 造一个片段。 */
function clip(id: string, start: number, duration: number): TimelineClip {
  return { id, startTime: start, duration, trimStart: 0 };
}

/** 第二档项 3：快捷键新增动作纯逻辑回归。 */
describe('shortcut-actions-model', () => {
  it('seek ±1s / ±5s 按帧率换算，首尾夹逼', () => {
    expect(seekForwardOneSecond(0, 30, 300)).toBe(30);
    expect(seekBackwardOneSecond(0, 30, 300)).toBe(0);
    expect(jumpForwardFiveSeconds(0, 30, 300)).toBe(150);
    expect(jumpBackwardFiveSeconds(10, 30, 300)).toBe(0);
    expect(seekForwardOneSecond(290, 30, 300)).toBe(299);
    expect(jumpForwardFiveSeconds(299, 30, 300)).toBe(299);
  });

  it('异常输入（NaN/负帧率/零帧数/非法偏移）安全回落', () => {
    expect(seekBySeconds(Number.NaN, 30, 100, 1)).toBe(0);
    expect(seekBySeconds(10, 0, 100, 1)).toBe(40);
    expect(seekBySeconds(10, 30, 0, 1)).toBe(0);
    expect(seekBySeconds(10, 30, 100, Number.NaN)).toBe(10);
    expect(seekBySeconds(-5, 30, 100, -1)).toBe(0);
  });

  it('TICKS 常量与模型层一致', () => {
    expect(SHORTCUT_TICKS_PER_SECOND).toBe(120000);
  });

  it('split-left：切点分割后删左留右，右半前移且 trim 累加', () => {
    const clips = [clip('a', 0, 240000), clip('b', 300000, 120000)];
    const next = splitAndRemoveLeft(clips, 'a', 120000);
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual({ id: 'a', startTime: 0, duration: 120000, trimStart: 120000 });
    expect(next[1]).toEqual(clip('b', 300000, 120000));
  });

  it('split-right：删右留左，其余片段不变', () => {
    const clips = [clip('a', 0, 240000), clip('b', 300000, 120000)];
    const next = splitAndRemoveRight(clips, 'a', 120000);
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(clip('a', 0, 120000));
    expect(next[1]).toEqual(clip('b', 300000, 120000));
  });

  it('split 切点不在片段内部（起点/终点/片段外/未知 id）返回原引用', () => {
    const clips = [clip('a', 0, 240000)];
    expect(splitAndRemoveLeft(clips, 'a', 0)).toBe(clips);
    expect(splitAndRemoveRight(clips, 'a', 240000)).toBe(clips);
    expect(splitAndRemoveLeft(clips, 'a', -1)).toBe(clips);
    expect(splitAndRemoveRight(clips, 'unknown', 120000)).toBe(clips);
  });

  it('split-left：目标 id 已有 #2 后缀时生成唯一右半 id 并正确前移', () => {
    // splitClipAt 会跳过已占用 id，右半命名为 a#3；此处确保删除的是左半 'a' 并保留右半内容。
    const clips = [clip('a', 0, 240000), clip('a#2', 500000, 60000)];
    const next = splitAndRemoveLeft(clips, 'a', 120000);
    expect(next.some((item) => item.id === 'a')).toBe(true);
    expect(next.find((item) => item.id === 'a')?.trimStart).toBe(120000);
  });

  it('toggle-bookmark：同一 ticks 再按删除，不同 ticks 新增，不改入参', () => {
    const original = [{ id: 'b1', ticks: 100, name: 'B1' }];
    expect(toggleBookmarkAt(original, 100, 'b2', 'B2')).toEqual([]);
    const next = toggleBookmarkAt(original, 200, 'b2', 'B2');
    expect(next).toEqual([...original, { id: 'b2', ticks: 200, name: 'B2' }]);
    expect(original).toHaveLength(1);
  });
})
