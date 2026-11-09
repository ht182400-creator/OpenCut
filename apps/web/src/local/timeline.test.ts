import { describe, expect, it } from 'vitest';

import {
  clipAtTime,
  mapProjectFrame,
  splitClipAt,
  TICKS_PER_SECOND,
  type TimelineClip,
} from './timeline';

/** 片段级素材映射与分割的纯函数回归（W-08 第二批）。 */
describe('片段与素材帧映射', () => {
  const clips: TimelineClip[] = [
    { id: 'intro', startTime: 0, duration: TICKS_PER_SECOND, trimStart: 0 },
    {
      id: 'body', startTime: TICKS_PER_SECOND, duration: 2 * TICKS_PER_SECOND,
      trimStart: TICKS_PER_SECOND,
    },
  ];

  it('按项目片段定位命中者', () => {
    expect(clipAtTime(clips, 0)?.id).toBe('intro');
    expect(clipAtTime(clips, TICKS_PER_SECOND)?.id).toBe('body');
    expect(clipAtTime(clips, 3 * TICKS_PER_SECOND)).toBeNull();
  });

  it('项目帧映射到素材帧：不同片段指向不同素材时间', () => {
    expect(mapProjectFrame(clips, 0, 30, 60).sourceFrameIndex).toBe(0);
    // 项目 1s 命中 body，其 trimStart=1s → 素材帧 30
    expect(mapProjectFrame(clips, TICKS_PER_SECOND, 30, 60).sourceFrameIndex).toBe(30);
    expect(mapProjectFrame(clips, TICKS_PER_SECOND, 30, 60).clipId).toBe('body');
  });

  it('删除首片段后，首帧改从素材 1s 处开始（剪辑真正改变画面）', () => {
    const afterDelete: TimelineClip[] = [
      { ...clips[1], startTime: 0 },
    ];
    expect(mapProjectFrame(afterDelete, 0, 30, 60).sourceFrameIndex).toBe(30);
    expect(mapProjectFrame(clips, 0, 30, 60).sourceFrameIndex).toBe(0);
  });

  it('空档返回 null 映射', () => {
    const empty: TimelineClip[] = [];
    expect(mapProjectFrame(empty, 0, 30, 60)).toEqual({
      clipId: null, sourceFrameIndex: null,
    });
  });

  it('短素材按帧数循环复用', () => {
    // 项目 2s 命中 body（trimStart=1s）→ 素材帧 60；素材仅 40 帧 → 60 % 40 = 20
    const mapping = mapProjectFrame(clips, 2 * TICKS_PER_SECOND, 30, 40);
    expect(mapping.sourceFrameIndex).toBe(20);
  });

  it('素材帧数为 0 时明确报错', () => {
    expect(() => mapProjectFrame(clips, 0, 30, 0)).toThrow(/没有可用帧/);
  });
});

describe('splitClipAt', () => {
  const clips: TimelineClip[] = [
    { id: 'a', startTime: 0, duration: 2 * TICKS_PER_SECOND, trimStart: 0 },
  ];

  it('切点位于片段内部时切成两段且素材时间连续', () => {
    const result = splitClipAt(clips, 'a', TICKS_PER_SECOND);
    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ id: 'a', startTime: 0, duration: TICKS_PER_SECOND });
    expect(result[1]).toMatchObject({
      startTime: TICKS_PER_SECOND, duration: TICKS_PER_SECOND,
      trimStart: TICKS_PER_SECOND,
    });
    expect(result[1].id).not.toBe('a');
  });

  it('切点在端点或未知片段时原样返回', () => {
    expect(splitClipAt(clips, 'a', 0)).toBe(clips);
    expect(splitClipAt(clips, 'a', 2 * TICKS_PER_SECOND)).toBe(clips);
    expect(splitClipAt(clips, 'missing', TICKS_PER_SECOND)).toBe(clips);
  });

  it('重复分割生成唯一 id', () => {
    const once = splitClipAt(clips, 'a', TICKS_PER_SECOND);
    const twice = splitClipAt(once, 'a', TICKS_PER_SECOND / 2);
    expect(new Set(twice.map((clip) => clip.id)).size).toBe(twice.length);
    expect(twice).toHaveLength(3);
  });
});
