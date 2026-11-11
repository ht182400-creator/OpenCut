/**
 * 真实导出（W-07 第二批 / W-08 / W-07 DoD 补完）：帧源 + 可选音源 → VideoFrame/AudioData
 * → VideoEncoder/AudioEncoder → MP4（H.264 + AAC）或 WebM（VP9 + Opus）容器。
 *
 * 帧源可替换：默认 core 确定性合成帧，W-08 起可用「core.compositeFrameRgba(浏览器解码帧)」。
 * 音源可替换：W-08 第三批起用 `buildTimelineAudio` 产出与项目帧严格对齐的 PCM，
 * 按 `FramePlan` 的累积采样思路切片编码，保证音画同步。
 * 两种容器共用同一编码循环与帧源，仅 codec / muxer / MIME 不同；
 * 预览与导出共用同一帧源；所有浏览器 API 通过自定义接口访问，避免 DOM lib 类型差异。
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import {
  AAC_FRAME_SAMPLES,
  AUDIO_BITRATE,
  AUDIO_CHANNELS,
  AUDIO_CODEC,
  AUDIO_SAMPLE_RATE,
  audioChunkCount,
  createAudioData,
  createAudioEncoder,
  planarChunk,
  type AudioEncoderLike,
  type PcmAudio,
} from './audio';
import type { EditorAdapter } from './editor-adapter';

/** H.264 baseline 的 WebCodecs codec 字符串。 */
export const EXPORT_CODEC = 'avc1.42001f';
/** 关键帧间隔（帧）。 */
export const KEY_FRAME_INTERVAL = 30;
/** 每处理多少帧让出一次主线程，避免长时间阻塞 UI。 */
export const YIELD_EVERY_FRAMES = 8;
/** 默认视频码率。 */
export const DEFAULT_EXPORT_BITRATE = 2_000_000;
/** WebM 容器使用的 VP9 profile（level 1.0、8bit）。 */
export const WEBM_VIDEO_CODEC = 'vp09.00.10.08';
/** WebM 容器使用的 Opus 音频 codec 与码率。 */
export const WEBM_AUDIO_CODEC = 'opus';
export const WEBM_AUDIO_BITRATE = 96_000;
/** 导出容器类型。 */
export type ExportContainer = 'mp4' | 'webm';

interface VideoFrameLike {
  close(): void;
}

interface VideoFrameConstructor {
  new (
    data: Uint8Array,
    init: {
      format: string;
      codedWidth: number;
      codedHeight: number;
      timestamp: number;
    },
  ): VideoFrameLike;
}

interface VideoEncoderLike {
  configure(config: Record<string, unknown>): void;
  encode(frame: VideoFrameLike, options?: Record<string, unknown>): void;
  flush(): Promise<void>;
  close(): void;
  readonly state: string;
}

interface VideoEncoderConstructor {
  new (init: {
    output: (chunk: unknown, meta?: unknown) => void;
    error: (error: Error) => void;
  }): VideoEncoderLike;
}

/** 校验导出参数，返回可读的中文错误。 */
export function validateExportOptions(options: {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
}): string | null {
  if (options.width <= 0 || options.height <= 0 || options.width % 2 !== 0 || options.height % 2 !== 0) {
    return '导出宽高必须是正偶数；请检查项目设置后重试';
  }
  if (!Number.isFinite(options.fps) || options.fps <= 0) {
    return '帧率必须为正数；请检查项目设置后重试';
  }
  if (!Number.isInteger(options.frameCount) || options.frameCount <= 0) {
    return '导出帧数必须为正整数；请缩短时长或调整帧率后重试';
  }
  return null;
}

/** 当前环境是否具备视频导出能力。 */
export function isExportSupported(): boolean {
  const scope = globalThis as unknown as Record<string, unknown>;
  return typeof scope.VideoEncoder !== 'undefined' && typeof scope.VideoFrame !== 'undefined';
}

/** WebM 导出前探测 Opus 音频编码能力；不支持时降级为纯视频。 */
export async function isOpusEncodingSupported(): Promise<boolean> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const ctor = scope.AudioEncoder as {
    isConfigSupported?: (config: Record<string, unknown>) => Promise<{ supported?: boolean }>;
  } | undefined;
  if (!ctor || typeof scope.AudioData === 'undefined') return false;
  try {
    const result = await ctor.isConfigSupported?.({
      codec: WEBM_AUDIO_CODEC,
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: AUDIO_CHANNELS,
      bitrate: WEBM_AUDIO_BITRATE,
    });
    return result?.supported === true;
  } catch {
    return false;
  }
}

/** 导出选项：`frameSource` 优先于 `adapter`；`audioSource` 可选。 */
export interface ExportOptions {
  adapter?: EditorAdapter;
  frameSource?: (frameIndex: number) => Uint8Array;
  audioSource?: PcmAudio;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  ticksPerFrame: number;
  profile: unknown;
  params: unknown;
  /** 视频编码 codec 字符串；高分辨率素材需更高 H.264 Level（如 4K 用 avc1.640033）。 */
  codec?: string;
  /** 进度回调：已完成帧数 / 总帧数。 */
  onProgress?: (done: number, total: number) => void;
}

/** 导出结果：可直接创建下载链接的 Blob 与统计信息。 */
export interface ExportResult {
  blob: Blob;
  bytes: number;
  frameCount: number;
  durationSeconds: number;
  hasAudio: boolean;
}

/** 取第 i 帧像素：优先真实素材帧源，否则回退 core 合成帧。 */
function framePixels(options: ExportOptions, frameIndex: number): Uint8Array {
  if (options.frameSource) {
    return options.frameSource(frameIndex);
  }
  if (options.adapter) {
    return options.adapter.renderFrameRgba({
      frameIndex,
      timeTicks: frameIndex * options.ticksPerFrame,
      durationTicks: options.ticksPerFrame,
      profile: options.profile,
      params: options.params,
    });
  }
  throw new Error('导出缺少帧源；请提供 frameSource 或 adapter');
}

/** muxer 的最小公共接口，隔离 mp4-muxer 与 webm-muxer 的声明差异。 */
interface MuxerLike {
  addVideoChunk: (chunk: unknown, meta?: unknown) => void;
  addAudioChunk: (chunk: unknown, meta?: unknown) => void;
  finalize: () => void;
}

/** 导出目标缓冲的最小接口。 */
interface TargetLike {
  buffer: ArrayBuffer;
}

/** 每种容器的 codec、MIME 与 muxer 配置。 */
interface ContainerConfig {
  muxer: MuxerLike;
  target: TargetLike;
  mime: string;
  videoCodec: string;
  audioCodec: string;
  audioBitrate: number;
  videoExtra: Record<string, unknown>;
}

/**
 * 按容器构造 muxer；两种容器都从同一帧源与音源编码。
 * @param options 导出选项
 * @param container 目标容器
 * @param hasAudio 是否带音轨
 * @returns {ContainerConfig} muxer 与编码配置
 */
function createContainer(
  options: ExportOptions,
  container: ExportContainer,
  hasAudio: boolean,
): ContainerConfig {
  if (container === 'webm') {
    const target = new WebmTarget();
    const muxer = new WebmMuxer({
      target,
      video: {
        codec: 'V_VP9',
        width: options.width,
        height: options.height,
        frameRate: options.fps,
      },
      ...(hasAudio
        ? {
            audio: {
              codec: 'A_OPUS' as const,
              numberOfChannels: AUDIO_CHANNELS,
              sampleRate: AUDIO_SAMPLE_RATE,
            },
          }
        : {}),
      firstTimestampBehavior: 'offset',
    });
    return {
      muxer: muxer as unknown as MuxerLike,
      target: target as unknown as TargetLike,
      mime: 'video/webm',
      videoCodec: WEBM_VIDEO_CODEC,
      audioCodec: WEBM_AUDIO_CODEC,
      audioBitrate: WEBM_AUDIO_BITRATE,
      videoExtra: {},
    };
  }
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: options.width,
      height: options.height,
      frameRate: options.fps,
    },
    ...(hasAudio
      ? {
          audio: {
            codec: 'aac' as const,
            numberOfChannels: AUDIO_CHANNELS,
            sampleRate: AUDIO_SAMPLE_RATE,
          },
        }
      : {}),
    fastStart: 'in-memory',
  });
  return {
    muxer: muxer as unknown as MuxerLike,
    target: target as unknown as TargetLike,
    mime: 'video/mp4',
    videoCodec: EXPORT_CODEC,
    audioCodec: AUDIO_CODEC,
    audioBitrate: AUDIO_BITRATE,
    videoExtra: { avc: { format: 'avc' } },
  };
}

/**
 * 编码并封装为 MP4 或 WebM；异常转中文提示并清理编码器。
 * @param options 导出选项
 * @param container 目标容器
 * @returns {Promise<ExportResult>} 视频 Blob 与统计
 */
async function runExport(
  options: ExportOptions,
  container: ExportContainer,
): Promise<ExportResult> {
  const invalid = validateExportOptions(options);
  if (invalid) throw new Error(invalid);
  if (!isExportSupported()) {
    throw new Error('当前浏览器不支持 WebCodecs 导出；请使用支持 VideoEncoder 的浏览器');
  }
  if (!options.frameSource && !options.adapter) {
    throw new Error('导出缺少帧源；请提供 frameSource 或 adapter');
  }

  const scope = globalThis as unknown as Record<string, unknown>;
  const EncoderCtor = scope.VideoEncoder as VideoEncoderConstructor;
  const FrameCtor = scope.VideoFrame as VideoFrameConstructor;
  const hasAudio = Boolean(options.audioSource);
  const config = createContainer(options, container, hasAudio);
  const addVideoChunk = config.muxer.addVideoChunk.bind(config.muxer);
  const addAudioChunk = config.muxer.addAudioChunk.bind(config.muxer);

  let encoderError: Error | null = null;
  const videoEncoder = new EncoderCtor({
    output: (chunk, meta) => addVideoChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    },
  });
  let audioEncoder: AudioEncoderLike | null = null;
  if (options.audioSource) {
    audioEncoder = createAudioEncoder(
      (chunk, meta) => addAudioChunk(chunk, meta),
      (error) => {
        encoderError = error;
      },
    );
  }

  try {
    videoEncoder.configure({
      codec: container === 'webm' ? config.videoCodec : options.codec ?? config.videoCodec,
      width: options.width,
      height: options.height,
      bitrate: DEFAULT_EXPORT_BITRATE,
      framerate: options.fps,
      ...config.videoExtra,
    });
    audioEncoder?.configure({
      codec: config.audioCodec,
      sampleRate: AUDIO_SAMPLE_RATE,
      numberOfChannels: AUDIO_CHANNELS,
      bitrate: config.audioBitrate,
    });

    for (let frameIndex = 0; frameIndex < options.frameCount; frameIndex += 1) {
      if (encoderError) throw encoderError;
      const pixels = framePixels(options, frameIndex);
      const frame = new FrameCtor(pixels, {
        format: 'RGBA',
        codedWidth: options.width,
        codedHeight: options.height,
        timestamp: Math.round((frameIndex * 1_000_000) / options.fps),
      });
      videoEncoder.encode(frame, { keyFrame: frameIndex % KEY_FRAME_INTERVAL === 0 });
      frame.close();
      options.onProgress?.(frameIndex + 1, options.frameCount);
      if (frameIndex % YIELD_EVERY_FRAMES === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    if (audioEncoder && options.audioSource) {
      const totalSamples = options.audioSource.channels[0]?.length ?? 0;
      const chunks = audioChunkCount(totalSamples);
      for (let index = 0; index < chunks; index += 1) {
        if (encoderError) throw encoderError;
        const data = planarChunk(
          options.audioSource.channels,
          index * AAC_FRAME_SAMPLES,
          AAC_FRAME_SAMPLES,
        );
        const audioData = createAudioData(
          data,
          Math.round((index * AAC_FRAME_SAMPLES * 1_000_000) / AUDIO_SAMPLE_RATE),
        );
        audioEncoder.encode(audioData);
        audioData.close();
      }
    }

    await videoEncoder.flush();
    if (audioEncoder) await audioEncoder.flush();
    if (encoderError) throw encoderError;
    config.muxer.finalize();

    const blob = new Blob([config.target.buffer], { type: config.mime });
    return {
      blob,
      bytes: blob.size,
      frameCount: options.frameCount,
      durationSeconds: options.frameCount / options.fps,
      hasAudio,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`视频导出失败：${detail}`);
  } finally {
    if (videoEncoder.state !== 'closed') videoEncoder.close();
    if (audioEncoder && audioEncoder.state !== 'closed') audioEncoder.close();
  }
}

/**
 * 导出为 MP4（H.264 + AAC）；`codec` 可覆盖高分辨率所需的 H.264 Level。
 * @param options 导出选项
 * @returns {Promise<ExportResult>} MP4 Blob 与统计
 */
export function exportProjectToMp4(options: ExportOptions): Promise<ExportResult> {
  return runExport(options, 'mp4');
}

/**
 * 导出为 WebM（VP9 + Opus）；与 MP4 共用同一帧源、音源与帧计划，
 * 因此同一项目的帧数、时长与音画对齐完全一致（W-07 DoD）。
 * @param options 导出选项
 * @returns {Promise<ExportResult>} WebM Blob 与统计
 */
export function exportProjectToWebM(options: ExportOptions): Promise<ExportResult> {
  return runExport(options, 'webm');
}
