import { describe, expect, it } from 'vitest';

import {
  clipAtTime,
  clipsToEditTimeline,
  clipsToOtioText,
  editTimelineToClips,
  framesForDuration,
  mapProjectFrame,
  moveClipBy,
  moveClipClamped,
  otioImportToClips,
  plannedFrameCount,
  resizeClipEdge,
  splitClipAt,
  TICKS_PER_SECOND,
  timelineDuration,
  trimClipInAt,
  trimClipOutAt,
  type EditTimelineView,
  type TimelineClip,
} from './timeline';
import type { EditorAdapter } from './editor-adapter';

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

/** 裁剪入出点与片段平移回归（W-08 第四批）。 */
describe('裁剪与平移', () => {
  const clips: TimelineClip[] = [
    { id: 'intro', startTime: 0, duration: TICKS_PER_SECOND, trimStart: 0 },
    {
      id: 'body', startTime: TICKS_PER_SECOND, duration: 2 * TICKS_PER_SECOND,
      trimStart: TICKS_PER_SECOND,
    },
  ];

  it('入点推到播放头：位置不动、素材入点后移、时长缩短', () => {
    const result = trimClipInAt(clips, 'body', 2 * TICKS_PER_SECOND);
    expect(result[1]).toMatchObject({
      startTime: TICKS_PER_SECOND,
      duration: TICKS_PER_SECOND,
      trimStart: 2 * TICKS_PER_SECOND,
    });
    expect(result[0]).toBe(clips[0]);
  });

  it('入点裁剪后画面随素材入点改变', () => {
    const trimmed = trimClipInAt(clips, 'body', 2 * TICKS_PER_SECOND);
    // 项目 1.1s：裁剪前素材 1.1s → 帧 33；裁剪后素材 2.1s → 帧 63
    expect(mapProjectFrame(clips, 1.1 * TICKS_PER_SECOND, 30, 200).sourceFrameIndex).toBe(33);
    expect(mapProjectFrame(trimmed, 1.1 * TICKS_PER_SECOND, 30, 200).sourceFrameIndex).toBe(63);
  });

  it('出点缩到播放头：只改时长，素材入点不变', () => {
    const result = trimClipOutAt(clips, 'intro', TICKS_PER_SECOND / 2);
    expect(result[0]).toMatchObject({
      startTime: 0, duration: TICKS_PER_SECOND / 2, trimStart: 0,
    });
    expect(result[1]).toBe(clips[1]);
  });

  it('播放头不在片段内部或目标缺失时原样返回', () => {
    expect(trimClipInAt(clips, 'body', TICKS_PER_SECOND / 2)).toBe(clips);
    expect(trimClipInAt(clips, 'body', 5 * TICKS_PER_SECOND)).toBe(clips);
    expect(trimClipOutAt(clips, 'body', TICKS_PER_SECOND)).toBe(clips);
    expect(trimClipOutAt(clips, 'body', 5 * TICKS_PER_SECOND)).toBe(clips);
    expect(trimClipInAt(clips, 'missing', TICKS_PER_SECOND)).toBe(clips);
  });

  it('平移只改起点并夹到 0，素材入点不变', () => {
    const moved = moveClipBy(clips, 'intro', 10 * TICKS_PER_SECOND);
    expect(moved[0]).toMatchObject({ startTime: 10 * TICKS_PER_SECOND, trimStart: 0 });
    expect(mapProjectFrame(moved, 10.5 * TICKS_PER_SECOND, 30, 400).clipId).toBe('intro');
    const clamped = moveClipBy(clips, 'intro', -TICKS_PER_SECOND);
    expect(clamped[0]).toMatchObject({ startTime: 0 });
    expect(moveClipBy(clips, 'intro', 0)).toBe(clips);
    expect(moveClipBy(clips, 'missing', TICKS_PER_SECOND)).toBe(clips);
  });

  it('拖拽夹取：目标保持在前后邻居之间且不重叠', () => {
    const moved = moveClipClamped(clips, 'body', 2 * TICKS_PER_SECOND);
    expect(moved[1].startTime).toBe(2 * TICKS_PER_SECOND);
    expect(moved[1].duration).toBe(2 * TICKS_PER_SECOND);
    expect(moved[1].trimStart).toBe(TICKS_PER_SECOND);
  });

  it('拖拽越过后邻居时被夹到「邻居起点 − 自身时长」', () => {
    const moved = moveClipClamped(clips, 'intro', 99 * TICKS_PER_SECOND);
    // body 起点 1s，intro 时长 1s → 上限 0，保持原位
    expect(moved[0].startTime).toBe(0);
    expect(moved).toBe(clips);
  });

  it('拖拽越过前邻居时被夹到前邻居结束处', () => {
    const spread: TimelineClip[] = [
      { id: 'a', startTime: 0, duration: TICKS_PER_SECOND, trimStart: 0 },
      { id: 'b', startTime: 5 * TICKS_PER_SECOND, duration: TICKS_PER_SECOND, trimStart: 0 },
    ];
    const moved = moveClipClamped(spread, 'b', -99 * TICKS_PER_SECOND);
    expect(moved[1].startTime).toBe(TICKS_PER_SECOND);
  });

  it('末片段可自由右移，起点不能为负', () => {
    const moved = moveClipClamped(clips, 'body', 9 * TICKS_PER_SECOND);
    expect(moved[1].startTime).toBe(9 * TICKS_PER_SECOND);
    expect(moveClipClamped(clips, 'missing', TICKS_PER_SECOND)).toBe(clips);
  });

  it('约束后的片段按时间排序仍两两不重叠', () => {
    const moved = moveClipClamped(clips, 'body', 4 * TICKS_PER_SECOND);
    const ordered = [...moved].sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i].startTime).toBeGreaterThanOrEqual(
        ordered[i - 1].startTime + ordered[i - 1].duration,
      );
    }
  });

  it('拖右边缘向内缩短时长，素材入点与位置不变', () => {
    const result = resizeClipEdge(clips, 'intro', 'right', -TICKS_PER_SECOND / 2, 4000);
    expect(result[0]).toMatchObject({
      startTime: 0, duration: TICKS_PER_SECOND / 2, trimStart: 0,
    });
  });

  it('拖右边缘向外延长但不能压到后邻居', () => {
    const result = resizeClipEdge(clips, 'intro', 'right', 99 * TICKS_PER_SECOND, 4000);
    // body 起点 1s → intro 时长上限 1s，即原值
    expect(result[0].duration).toBe(TICKS_PER_SECOND);
    expect(result).toBe(clips);
  });

  it('拖左边缘 head-trim：位置不动，素材入点增加、时长缩短', () => {
    const result = resizeClipEdge(clips, 'body', 'left', TICKS_PER_SECOND / 2, 4000);
    expect(result[1]).toMatchObject({
      startTime: TICKS_PER_SECOND,
      duration: 1.5 * TICKS_PER_SECOND,
      trimStart: 1.5 * TICKS_PER_SECOND,
    });
    // 项目 1.1s 的素材帧由 33 变为 48，画面随裁剪改变
    expect(mapProjectFrame(result, 1.1 * TICKS_PER_SECOND, 30, 200).sourceFrameIndex).toBe(48);
  });

  it('拖左边缘向外可恢复被裁掉的素材，但不能让 trimStart 为负', () => {
    const trimmed = resizeClipEdge(clips, 'body', 'left', TICKS_PER_SECOND / 2, 4000);
    const restored = resizeClipEdge(trimmed, 'body', 'left', -99 * TICKS_PER_SECOND, 4000);
    expect(restored[1].trimStart).toBe(0);
    expect(restored[1].duration).toBeGreaterThan(trimmed[1].duration);
    expect(restored[1].startTime).toBe(TICKS_PER_SECOND);
  });

  it('边缘裁剪受最小时长约束，未知 id 返回原引用', () => {
    const result = resizeClipEdge(clips, 'intro', 'right', -99 * TICKS_PER_SECOND, 4000);
    expect(result[0].duration).toBe(4000);
    expect(resizeClipEdge(clips, 'missing', 'left', 1, 4000)).toBe(clips);
  });

  it('调整后片段按时间排序仍两两不重叠', () => {
    const result = resizeClipEdge(clips, 'intro', 'right', -TICKS_PER_SECOND / 4, 4000);
    const ordered = [...result].sort((a, b) => a.startTime - b.startTime);
    for (let i = 1; i < ordered.length; i += 1) {
      expect(ordered[i].startTime).toBeGreaterThanOrEqual(
        ordered[i - 1].startTime + ordered[i - 1].duration,
      );
    }
  });

  it('plannedFrameCount 走 core 帧计划并至少 1 帧', () => {
    const adapter = {
      evaluate: (request: { durationTicks: number }) => ({
        frameCount: Math.round(request.durationTicks / 4000),
        ticksPerFrame: 4000,
      }),
    } as unknown as Pick<EditorAdapter, 'evaluate'>;
    expect(plannedFrameCount(clips, adapter, {})).toBe(90);
    expect(plannedFrameCount([], adapter, {})).toBe(1);
  });
});
