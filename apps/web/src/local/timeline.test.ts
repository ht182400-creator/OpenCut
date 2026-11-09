import { describe, expect, it } from 'vitest';

import {
  clipAtTime,
  clipsToEditTimeline,
  clipsToOtioText,
  editTimelineToClips,
  framesForDuration,
  mapProjectFrame,
  otioImportToClips,
  splitClipAt,
  TICKS_PER_SECOND,
  timelineDuration,
  type EditTimelineView,
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

/** OTIO 桥接回归（W-10 第二批）：往返不丢剪辑决策，Gap/音频轨不进入本地时间轴。 */
describe('OTIO 双向桥接', () => {
  const clips: TimelineClip[] = [
    { id: 'intro', startTime: 0, duration: TICKS_PER_SECOND, trimStart: 0 },
    {
      id: 'body', startTime: TICKS_PER_SECOND, duration: 2 * TICKS_PER_SECOND,
      trimStart: TICKS_PER_SECOND,
    },
  ];

  /** 构造只实现 otioImport/otioExport 的适配层桩。 */
  function stubAdapter(
    importResult: { ok: boolean; timeline?: unknown; error?: string },
    exportResult: { ok: boolean; otio?: string; error?: string },
  ) {
    return {
      otioImport: () => importResult,
      otioExport: () => exportResult,
    };
  }

  it('clips → 视图 → clips 往返保留剪辑决策', () => {
    const view = clipsToEditTimeline('demo', 30, clips, 'demo.mp4');
    expect(view.rate).toBe(30);
    expect(view.schemaVersion).toBe(1);
    expect(view.tracks).toHaveLength(1);
    expect(view.tracks[0].kind).toBe('Video');
    expect(view.tracks[0].clips[1]).toMatchObject({
      id: 'body', startTicks: TICKS_PER_SECOND,
      durationTicks: 2 * TICKS_PER_SECOND, sourceStartTicks: TICKS_PER_SECOND,
      mediaUrl: 'demo.mp4',
    });
    expect(editTimelineToClips(view)).toEqual(clips);
  });

  it('导入视图跳过 Gap 与音频轨', () => {
    const view: EditTimelineView = {
      name: 'mixed', schemaVersion: 1, rate: 30, warnings: [],
      tracks: [
        {
          id: 'main', name: 'main', kind: 'Video',
          clips: [
            { id: 'a', name: 'a', isGap: false, startTicks: 0, durationTicks: 1000, sourceStartTicks: 0, mediaUrl: null },
            { id: 'gap', name: 'gap', isGap: true, startTicks: 1000, durationTicks: 500, sourceStartTicks: 0, mediaUrl: null },
          ],
        },
        {
          id: 'A1', name: 'A1', kind: 'Audio',
          clips: [{ id: 'snd', name: 'snd', isGap: false, startTicks: 0, durationTicks: 1500, sourceStartTicks: 0, mediaUrl: null }],
        },
      ],
    };
    expect(editTimelineToClips(view)).toEqual([
      { id: 'a', startTime: 0, duration: 1000, trimStart: 0 },
    ]);
  });

  it('otioImportToClips 传播稳定错误码', () => {
    const adapter = stubAdapter({ ok: false, error: 'UNSUPPORTED_IO_VERSION' }, { ok: true, otio: '{}' });
    expect(() => otioImportToClips('{}', adapter)).toThrow(/UNSUPPORTED_IO_VERSION/);
  });

  it('otioExport 失败时抛出可读错误', () => {
    const adapter = stubAdapter({ ok: true, timeline: {} }, { ok: false, error: 'INVALID_EXPORT' });
    expect(() => clipsToOtioText(clips, 'demo', 30, null, adapter)).toThrow(/INVALID_EXPORT/);
  });

  it('clipsToOtioText 返回适配层给出的 OTIO 文本', () => {
    const adapter = stubAdapter(
      { ok: true, timeline: {} },
      { ok: true, otio: '{"OTIO_SCHEMA":"Timeline.1"}' },
    );
    expect(clipsToOtioText(clips, 'demo', 30, 'demo.mp4', adapter)).toBe(
      '{"OTIO_SCHEMA":"Timeline.1"}',
    );
  });

  it('时长换算与帧数换算', () => {
    expect(timelineDuration(clips)).toBe(3 * TICKS_PER_SECOND);
    // 3s 项目在 4000 ticks/帧（30fps）下需要 90 帧
    expect(framesForDuration(clips, 4000)).toBe(90);
    expect(framesForDuration([], 4000)).toBe(1);
  });
});
