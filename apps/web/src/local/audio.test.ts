import { describe, expect, it } from 'vitest';

import {
  AUDIO_CHANNELS,
  AUDIO_SAMPLE_RATE,
  AAC_FRAME_SAMPLES,
  audioChunkCount,
  buildTimelineAudio,
  createToneAudio,
  cumulativeSamples,
  planarChunk,
  samplesForFrame,
  type PcmAudio,
} from './audio';
import type { TimelineClip } from './timeline';

const TICKS_PER_SECOND = 120000;

/** 音频调度纯函数回归（W-08 第三批）：不启动浏览器编解码。 */
describe('累积采样与音画同步', () => {
  it('30fps@48kHz 每帧 1600 采样且累计无漂移', () => {
    expect(samplesForFrame(0, AUDIO_SAMPLE_RATE, 30)).toBe(1600);
    expect(cumulativeSamples(90, AUDIO_SAMPLE_RATE, 30)).toBe(144000);
    const sum = Array.from({ length: 90 }, (_, i) => samplesForFrame(i, AUDIO_SAMPLE_RATE, 30))
      .reduce((left, right) => left + right, 0);
    expect(sum).toBe(144000);
  });

  it('29.97fps 交替 1601/1602，与 core FramePlan 一致', () => {
    const fps = 30000 / 1001;
    expect(samplesForFrame(0, AUDIO_SAMPLE_RATE, fps)).toBe(1601);
    expect(samplesForFrame(1, AUDIO_SAMPLE_RATE, fps)).toBe(1602);
    const sum = Array.from({ length: 30 }, (_, i) => samplesForFrame(i, AUDIO_SAMPLE_RATE, fps))
      .reduce((left, right) => left + right, 0);
    expect(sum).toBe(48048);
  });
});

describe('planar 音频切块', () => {
  const channels = [
    new Float32Array([1, 2, 3, 4]),
    new Float32Array([-1, -2, -3, -4]),
  ];

  it('按声道连续拼接并零填充不足部分', () => {
    const chunk = planarChunk(channels, 1, AAC_FRAME_SAMPLES);
    expect(chunk.length).toBe(AAC_FRAME_SAMPLES * AUDIO_CHANNELS);
    expect(Array.from(chunk.slice(0, 3))).toEqual([2, 3, 4]);
    expect(chunk[3]).toBe(0);
    expect(chunk[AAC_FRAME_SAMPLES]).toBe(-2);
  });

  it('AAC 块数向上取整', () => {
    expect(audioChunkCount(0)).toBe(0);
    expect(audioChunkCount(1)).toBe(1);
    expect(audioChunkCount(AAC_FRAME_SAMPLES + 1)).toBe(2);
  });
});

describe('演示音源与时间轴重排', () => {
  const clips: TimelineClip[] = [
    { id: 'intro', startTime: 0, duration: TICKS_PER_SECOND, trimStart: 0 },
    {
      id: 'body', startTime: TICKS_PER_SECOND, duration: 2 * TICKS_PER_SECOND,
      trimStart: TICKS_PER_SECOND,
    },
  ];
  const baseOptions = {
    frameCount: 90,
    fps: 30,
    ticksPerFrame: 4000,
    ticksPerSecond: TICKS_PER_SECOND,
  };

  it('生成双声道正弦音源', () => {
    const tone = createToneAudio(2);
    expect(tone.channels).toHaveLength(AUDIO_CHANNELS);
    expect(tone.channels[0].length).toBe(96000);
    expect(Math.abs(tone.channels[0][120])).toBeGreaterThan(0);
  });

  it('时间轴音频长度与项目帧数严格对齐', () => {
    const audio = buildTimelineAudio({ ...baseOptions, clips, sourceAudio: createToneAudio(2) });
    expect(audio.channels[0].length).toBe(cumulativeSamples(90, AUDIO_SAMPLE_RATE, 30));
    expect(audio.durationSeconds).toBeCloseTo(3, 6);
  });

  it('删除首片段后首帧音频改从素材 1s 处开始（剪辑改变声音）', () => {
    const source: PcmAudio = createToneAudio(2);
    const before = buildTimelineAudio({ ...baseOptions, clips, sourceAudio: source });
    const afterDelete: TimelineClip[] = [{ ...clips[1], startTime: 0 }];
    const after = buildTimelineAudio({
      ...baseOptions, clips: afterDelete, frameCount: 60, sourceAudio: source,
    });
    expect(after.channels[0].length).toBe(96000);
    expect(after.channels[0][0]).not.toBe(before.channels[0][0]);
    expect(after.channels[0][0]).toBeCloseTo(source.channels[0][AUDIO_SAMPLE_RATE], 6);
  });

  it('空档填静音', () => {
    const audio = buildTimelineAudio({
      ...baseOptions, clips: [], sourceAudio: createToneAudio(2),
    });
    expect(audio.channels[0].every((sample) => sample === 0)).toBe(true);
  });
});
