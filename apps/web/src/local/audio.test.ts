import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  AUDIO_CHANNELS,
  AUDIO_SAMPLE_RATE,
  AAC_FRAME_SAMPLES,
  audioChunkCount,
  buildTimelineAudio,
  createToneAudio,
  cumulativeSamples,
  downsampleForWaveform,
  isAacEncodingSupported,
  mixdownToMono,
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

/** 批 7.3：多声道降混为单声道，供 core 波形抽样。 */
describe('mixdownToMono 波形降混', () => {
  it('取各声道同位置绝对值最大的样本并保留符号', () => {
    const audio: PcmAudio = {
      channels: [
        new Float32Array([0.1, -0.8, 0.3]),
        new Float32Array([0.5, 0.2, -0.6]),
      ],
      sampleRate: 48000,
      durationSeconds: 1,
    };
    const mono = Array.from(mixdownToMono(audio));
    expect(mono).toHaveLength(3);
    expect(mono[0]).toBeCloseTo(0.5, 6);
    expect(mono[1]).toBeCloseTo(-0.8, 6);
    expect(mono[2]).toBeCloseTo(-0.6, 6);
  });

  it('单声道输入原样返回（值相等）', () => {
    const audio: PcmAudio = {
      channels: [new Float32Array([0, 0.25, -0.5, 1])],
      sampleRate: 48000,
      durationSeconds: 1,
    };
    expect(Array.from(mixdownToMono(audio))).toEqual([0, 0.25, -0.5, 1]);
  });

  it('边界：空声道数组返回空 Float32Array', () => {
    const audio: PcmAudio = { channels: [], sampleRate: 48000, durationSeconds: 0 };
    expect(mixdownToMono(audio).length).toBe(0);
  });

  it('边界：长度不等的声道按 0 处理缺失样本', () => {
    const audio: PcmAudio = {
      channels: [new Float32Array([0.9, 0.1]), new Float32Array([0.2])],
      sampleRate: 48000,
      durationSeconds: 1,
    };
    const mono = Array.from(mixdownToMono(audio));
    expect(mono).toHaveLength(2);
    expect(mono[0]).toBeCloseTo(0.9, 6);
    expect(mono[1]).toBeCloseTo(0.1, 6);
  });
});

/** 批 7.3 修复：超长素材送 core 前峰值保真降采样，避免 TOO_MANY_PCM_SAMPLES。 */
describe('downsampleForWaveform 降采样', () => {
  it('未超限原样返回（同一引用，不复制）', () => {
    const samples = new Float32Array([0.1, -0.5, 0.9]);
    expect(downsampleForWaveform(samples, 10)).toBe(samples);
  });

  it('超限时按等比分桶、每桶取绝对值最大并保留符号', () => {
    // 8 样本降到 4：桶 [0,2)=0.1,-0.8→-0.8；[2,4)=0.3,0→0.3；[4,6)=0,-0.2→-0.2；[6,8)=1,0.3→1。
    const samples = new Float32Array([0.1, -0.8, 0.3, 0, 0, -0.2, 1, 0.3]);
    const out = Array.from(downsampleForWaveform(samples, 4));
    expect(out).toHaveLength(4);
    expect(out[0]).toBeCloseTo(-0.8, 6);
    expect(out[1]).toBeCloseTo(0.3, 6);
    expect(out[2]).toBeCloseTo(-0.2, 6);
    expect(out[3]).toBeCloseTo(1, 6);
  });

  it('峰值不丢失：满幅样本所在桶仍为满幅', () => {
    const samples = new Float32Array(1000).fill(0.01);
    samples[777] = 1;
    const out = downsampleForWaveform(samples, 10);
    expect(Math.max(...out)).toBeCloseTo(1, 6);
  });

  it('边界：maxSamples<=0 返回空数组；空输入原样返回', () => {
    expect(downsampleForWaveform(new Float32Array([1, 2]), 0).length).toBe(0);
    expect(downsampleForWaveform(new Float32Array([1, 2]), -3).length).toBe(0);
    const empty = new Float32Array(0);
    expect(downsampleForWaveform(empty, 4)).toBe(empty);
  });

  it('非有限值按 0 处理，不传播 NaN', () => {
    const samples = new Float32Array([Number.NaN, Number.POSITIVE_INFINITY, -0.5, 0.2]);
    const out = downsampleForWaveform(samples, 2);
    expect(Array.from(out).every(Number.isFinite)).toBe(true);
    expect(out[0]).toBe(0);
    expect(out[1]).toBeCloseTo(-0.5, 6);
  });
});

/** Firefox 音频兼容回归（W-08 第七批）：AAC 能力探测全分支覆盖。 */
describe('isAacEncodingSupported 能力探测', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('Node/无 AudioEncoder 环境返回 false', async () => {
    vi.stubGlobal('AudioEncoder', undefined);
    vi.stubGlobal('AudioData', undefined);
    expect(await isAacEncodingSupported()).toBe(false);
  });

  it('模拟 Firefox：AudioEncoder 存在但 AAC 配置不支持时返回 false', async () => {
    const isConfigSupported = vi.fn(async () => ({ supported: false }));
    vi.stubGlobal('AudioEncoder', Object.assign(function MockEncoder() {}, { isConfigSupported }));
    vi.stubGlobal('AudioData', function MockAudioData() {});
    expect(await isAacEncodingSupported()).toBe(false);
    expect(isConfigSupported).toHaveBeenCalledWith(expect.objectContaining({ codec: 'mp4a.40.2' }));
  });

  it('配置支持时返回 true，并把采样率/声道/码率传入探测', async () => {
    const isConfigSupported = vi.fn(async () => ({ supported: true }));
    vi.stubGlobal('AudioEncoder', Object.assign(function MockEncoder() {}, { isConfigSupported }));
    vi.stubGlobal('AudioData', function MockAudioData() {});
    expect(await isAacEncodingSupported()).toBe(true);
    expect(isConfigSupported).toHaveBeenCalledWith({
      codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000,
    });
  });

  it('探测抛异常时静默返回 false，不向上传播', async () => {
    const isConfigSupported = vi.fn(async () => { throw new Error('platform codec unavailable') });
    vi.stubGlobal('AudioEncoder', Object.assign(function MockEncoder() {}, { isConfigSupported }));
    vi.stubGlobal('AudioData', function MockAudioData() {});
    expect(await isAacEncodingSupported()).toBe(false);
  });
});
