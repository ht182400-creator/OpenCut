/**
 * 音频调度（W-08 第三批）：闭合 `PRIORITY.md` 中 W-08 标注的「音频调度」风险。
 *
 * 浏览器负责解码（Web Audio `decodeAudioData`）与编码（WebCodecs `AudioEncoder`），
 * Rust core 的 `FramePlan` 累积采样思路用于保证音画同步：
 * `cumulative(i) = floor(i * sampleRate / fps)`，第 i 帧采样数为 `cum(i+1) - cum(i)`，
 * 避免 29.97 / 23.976 等非整数帧率下的累计漂移。
 *
 * 所有浏览器 API 通过自定义接口访问，避免 DOM lib 的 WebCodecs 类型差异。
 */

import type { TimelineClip } from './timeline';

/** AAC-LC 的 WebCodecs codec 字符串（经典版亦使用 `mp4a.40.2`）。 */
export const AUDIO_CODEC = 'mp4a.40.2';
/** 音频采样率与声道数。 */
export const AUDIO_SAMPLE_RATE = 48000;
export const AUDIO_CHANNELS = 2;
/** AAC 编码码率。 */
export const AUDIO_BITRATE = 128000;
/** 每个 AAC 编码块的采样数（AAC-LC 帧长）。 */
export const AAC_FRAME_SAMPLES = 1024;
/** 演示音源频率（Hz）。 */
export const DEMO_TONE_FREQUENCY = 440;
/**
 * 波形抽样允许的最大 PCM 样本数，与 Rust core `ocx-render::waveform::MAX_PCM_SAMPLES` 对齐。
 * 超过此值 core 返回 TOO_MANY_PCM_SAMPLES，故送 core 前先等距降采样到该上限。
 */
export const WAVEFORM_MAX_PCM_SAMPLES = 4_096_000;

/** 解码后的 planar PCM 音频。 */
export interface PcmAudio {
  /** 每个声道一个 Float32Array，长度相同。 */
  channels: Float32Array[];
  sampleRate: number;
  durationSeconds: number;
}

interface AudioBufferLike {
  numberOfChannels: number;
  sampleRate: number;
  duration: number;
  getChannelData(channel: number): Float32Array;
}

interface AudioContextLike {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  close(): Promise<void>;
}

interface AudioContextConstructor {
  new (init?: { sampleRate?: number }): AudioContextLike;
}

interface AudioDataLike {
  close(): void;
}

interface AudioDataConstructor {
  new (init: {
    format: string;
    sampleRate: number;
    numberOfFrames: number;
    numberOfChannels: number;
    timestamp: number;
    data: Float32Array;
  }): AudioDataLike;
}

export interface AudioEncoderLike {
  configure(config: Record<string, unknown>): void;
  encode(data: AudioDataLike): void;
  flush(): Promise<void>;
  close(): void;
  readonly state: string;
}

interface AudioEncoderConstructor {
  new (init: {
    output: (chunk: unknown, meta?: unknown) => void;
    error: (error: Error) => void;
  }): AudioEncoderLike;
}

/** 当前环境是否支持 AAC 编码（导出前能力探测，见 `PRIORITY.md` §4.5）。 */
export async function isAacEncodingSupported(): Promise<boolean> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const ctor = scope.AudioEncoder as (AudioEncoderConstructor & {
    isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported?: boolean }>;
  }) | undefined;
  if (!ctor || typeof scope.AudioData === 'undefined') return false;
  try {
    const result = await ctor.isConfigSupported?.({
      codec: AUDIO_CODEC,
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: AUDIO_CHANNELS,
      bitrate: AUDIO_BITRATE,
    });
    return result?.supported === true;
  } catch {
    return false;
  }
}

/** 创建 AudioEncoder 实例；调用方负责 close。 */
export function createAudioEncoder(
  onChunk: (chunk: unknown, meta?: unknown) => void,
  onError: (error: Error) => void,
): AudioEncoderLike {
  const scope = globalThis as unknown as Record<string, unknown>;
  const ctor = scope.AudioEncoder as AudioEncoderConstructor | undefined;
  if (!ctor) throw new Error('当前浏览器不支持 AudioEncoder');
  return new ctor({ output: onChunk, error: onError });
}

/** 构造 f32-planar 的 AudioData。 */
export function createAudioData(data: Float32Array, timestampMicros: number): AudioDataLike {
  const scope = globalThis as unknown as Record<string, unknown>;
  const ctor = scope.AudioData as AudioDataConstructor | undefined;
  if (!ctor) throw new Error('当前浏览器不支持 AudioData');
  return new ctor({
    format: 'f32-planar',
    sampleRate: AUDIO_SAMPLE_RATE,
    numberOfFrames: data.length / AUDIO_CHANNELS,
    numberOfChannels: AUDIO_CHANNELS,
    timestamp: timestampMicros,
    data,
  });
}

/**
 * 从媒体文件解码音频；无音轨或解码失败时返回 null（静默降级为无声导出）。
 * @param file 媒体文件
 * @returns {Promise<PcmAudio | null>} PCM 或 null
 */
export async function decodeAudioFromFile(file: File): Promise<PcmAudio | null> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const ctor = scope.AudioContext as AudioContextConstructor | undefined;
  if (!ctor) return null;
  const context = new ctor({ sampleRate: AUDIO_SAMPLE_RATE });
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const channels: Float32Array[] = [];
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      channels.push(new Float32Array(buffer.getChannelData(channel)));
    }
    if (channels.length === 0 || channels[0].length === 0) return null;
    return {
      channels,
      sampleRate: buffer.sampleRate,
      durationSeconds: buffer.duration,
    };
  } catch {
    return null;
  } finally {
    await context.close();
  }
}

/** 第 i 帧边界处的累积采样数（与 core `FramePlan` 同思路，防漂移）。 */
export function cumulativeSamples(frameIndex: number, sampleRate: number, fps: number): number {
  return Math.floor((frameIndex * sampleRate) / fps);
}

/** 取第 i 帧应包含的采样数。 */
export function samplesForFrame(frameIndex: number, sampleRate: number, fps: number): number {
  return cumulativeSamples(frameIndex + 1, sampleRate, fps)
    - cumulativeSamples(frameIndex, sampleRate, fps);
}

/** 把 planar 声道数据按 AAC 块切出一段（不足时零填充）。 */
export function planarChunk(
  channels: Float32Array[],
  startSample: number,
  frameSamples: number,
): Float32Array {
  const result = new Float32Array(frameSamples * AUDIO_CHANNELS);
  for (let channel = 0; channel < AUDIO_CHANNELS; channel += 1) {
    const source = channels[Math.min(channel, channels.length - 1)];
    const offset = channel * frameSamples;
    for (let index = 0; index < frameSamples; index += 1) {
      const position = startSample + index;
      result[offset + index] = position < source.length ? source[position] : 0;
    }
  }
  return result;
}

/** 生成演示用正弦波 PCM（双声道同相）。 */
export function createToneAudio(durationSeconds: number, sampleRate = AUDIO_SAMPLE_RATE): PcmAudio {
  const sampleCount = Math.floor(durationSeconds * sampleRate);
  const mono = new Float32Array(sampleCount);
  for (let index = 0; index < sampleCount; index += 1) {
    mono[index] = 0.25 * Math.sin((2 * Math.PI * DEMO_TONE_FREQUENCY * index) / sampleRate);
  }
  return {
    channels: [mono, new Float32Array(mono)],
    sampleRate,
    durationSeconds,
  };
}

/**
 * 把 planar 多声道降混为单声道（批 7.3）：取各声道同位置样本绝对值的最大值并保留符号，
 * 这样任一声道的峰值都能在波形上体现；空声道数组返回空 Float32Array。
 * @param audio 解码后的 planar PCM
 * @returns 单声道 Float32Array
 */
export function mixdownToMono(audio: PcmAudio): Float32Array {
  if (audio.channels.length === 0) return new Float32Array(0);
  const length = audio.channels[0].length;
  const mono = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let peak = 0;
    for (const channel of audio.channels) {
      const value = channel[index] ?? 0;
      if (Math.abs(value) > Math.abs(peak)) peak = value;
    }
    mono[index] = peak;
  }
  return mono;
}

/**
 * 波形抽样前的等距降采样：样本数超过上限时，按等比分桶、每桶取绝对值最大的样本（保留符号），
 * 保证峰值不丢失且与 core 的峰值检测语义一致；未超限则原样返回（不复制）。
 * 这样任意时长的素材（如 2 分钟视频 ≈ 576 万样本 @48kHz）都能生成真实波形，
 * 不会触发 core 的 TOO_MANY_PCM_SAMPLES。
 * @param samples 已降混的单声道 PCM
 * @param maxSamples 输出样本数上限，缺省为核心上限
 * @returns 长度不超过 maxSamples 的 Float32Array
 */
export function downsampleForWaveform(
  samples: Float32Array,
  maxSamples: number = WAVEFORM_MAX_PCM_SAMPLES,
): Float32Array {
  if (maxSamples <= 0) return new Float32Array(0);
  if (samples.length <= maxSamples) return samples;
  const output = new Float32Array(maxSamples);
  for (let index = 0; index < maxSamples; index += 1) {
    // 整数区间，避免浮点累积误差；与 core waveform_peaks 的分桶方式一致。
    const start = Math.floor((samples.length * index) / maxSamples);
    const end = Math.floor((samples.length * (index + 1)) / maxSamples);
    let peak = 0;
    for (let cursor = start; cursor < end; cursor += 1) {
      const value = samples[cursor];
      if (Number.isFinite(value) && Math.abs(value) > Math.abs(peak)) peak = value;
    }
    output[index] = peak;
  }
  return output;
}

/** 构建时间轴音频的选项。 */
export interface TimelineAudioOptions {
  clips: TimelineClip[];
  frameCount: number;
  fps: number;
  ticksPerFrame: number;
  sourceAudio: PcmAudio;
  ticksPerSecond: number;
}

/**
 * 按「片段 → 素材时间」映射重排音频，使删除/分割真正改变声音（与视频帧映射同源）。
 * 空档填静音；素材比项目短时循环复用。
 * @param options 时间轴与音源
 * @returns {PcmAudio} 与项目帧数严格对齐的 PCM
 */
export function buildTimelineAudio(options: TimelineAudioOptions): PcmAudio {
  const { clips, frameCount, fps, ticksPerFrame, sourceAudio, ticksPerSecond } = options;
  const sampleRate = sourceAudio.sampleRate;
  const totalSamples = cumulativeSamples(frameCount, sampleRate, fps);
  const output = Array.from(
    { length: AUDIO_CHANNELS },
    () => new Float32Array(totalSamples),
  );
  const sourceLength = sourceAudio.channels[0]?.length ?? 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const projectTicks = frame * ticksPerFrame;
    const clip = clips.find(
      (item) => projectTicks >= item.startTime && projectTicks < item.startTime + item.duration,
    );
    const frameStart = cumulativeSamples(frame, sampleRate, fps);
    const frameLength = cumulativeSamples(frame + 1, sampleRate, fps) - frameStart;
    if (!clip || sourceLength === 0) continue;

    const sourceTicks = clip.trimStart + (projectTicks - clip.startTime);
    const sourceStart = Math.floor((sourceTicks / ticksPerSecond) * sampleRate);
    for (let channel = 0; channel < AUDIO_CHANNELS; channel += 1) {
      const source = sourceAudio.channels[Math.min(channel, sourceAudio.channels.length - 1)];
      for (let index = 0; index < frameLength; index += 1) {
        const position = (sourceStart + index) % sourceLength;
        output[channel][frameStart + index] = source[position];
      }
    }
  }

  return {
    channels: output,
    sampleRate,
    durationSeconds: totalSamples / sampleRate,
  };
}

/** 计算导出所需的 AAC 块数量（末尾不足一块也编码，零填充）。 */
export function audioChunkCount(totalSamples: number): number {
  return Math.ceil(totalSamples / AAC_FRAME_SAMPLES);
}
