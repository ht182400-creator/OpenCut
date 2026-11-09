/**
 * 真实导出（W-07 第二批）：core 合成帧 → VideoFrame → VideoEncoder → MP4 容器。
 *
 * 不依赖 GPU/H01 的原生渲染路径：像素由 `renderFrameRgba` 确定性生成，
 * 预览与导出共用同一份帧，因此导出结果可逐帧复现、可自动化校验。
 * 所有浏览器 API 通过自定义接口访问，避免依赖 DOM lib 的 WebCodecs 类型差异。
 */

import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { EditorAdapter } from './editor-adapter';

/** H.264 baseline 的 WebCodecs codec 字符串。 */
export const EXPORT_CODEC = 'avc1.42001f';
/** 关键帧间隔（帧）。 */
export const KEY_FRAME_INTERVAL = 30;
/** 每处理多少帧让出一次主线程，避免长时间阻塞 UI。 */
export const YIELD_EVERY_FRAMES = 8;
/** 默认视频码率。 */
export const DEFAULT_EXPORT_BITRATE = 2_000_000;

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

/** 当前环境是否具备真实导出能力。 */
export function isExportSupported(): boolean {
  const scope = globalThis as unknown as Record<string, unknown>;
  return typeof scope.VideoEncoder !== 'undefined' && typeof scope.VideoFrame !== 'undefined';
}

/** 导出选项。 */
export interface ExportOptions {
  adapter: EditorAdapter;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  ticksPerFrame: number;
  profile: unknown;
  params: unknown;
  /** 进度回调：已完成帧数 / 总帧数。 */
  onProgress?: (done: number, total: number) => void;
}

/** 导出结果：可直接创建下载链接的 Blob 与统计信息。 */
export interface ExportResult {
  blob: Blob;
  bytes: number;
  frameCount: number;
  durationSeconds: number;
}

/**
 * 编码并封装为 MP4；任何异常都会转成中文提示并清理编码器。
 * @param options 导出选项
 * @returns {Promise<ExportResult>} MP4 Blob 与统计
 */
export async function exportProjectToMp4(options: ExportOptions): Promise<ExportResult> {
  const invalid = validateExportOptions(options);
  if (invalid) throw new Error(invalid);
  if (!isExportSupported()) {
    throw new Error('当前浏览器不支持 WebCodecs 导出；请使用支持 VideoEncoder 的浏览器');
  }

  const scope = globalThis as unknown as Record<string, unknown>;
  const EncoderCtor = scope.VideoEncoder as VideoEncoderConstructor;
  const FrameCtor = scope.VideoFrame as VideoFrameConstructor;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: 'avc',
      width: options.width,
      height: options.height,
      frameRate: options.fps,
    },
    fastStart: 'in-memory',
  });
  const addChunk = muxer.addVideoChunk.bind(muxer) as (
    chunk: unknown,
    meta?: unknown,
  ) => void;

  let encoderError: Error | null = null;
  const encoder = new EncoderCtor({
    output: (chunk, meta) => addChunk(chunk, meta),
    error: (error) => {
      encoderError = error;
    },
  });

  try {
    encoder.configure({
      codec: EXPORT_CODEC,
      width: options.width,
      height: options.height,
      bitrate: DEFAULT_EXPORT_BITRATE,
      framerate: options.fps,
      avc: { format: 'avc' },
    });

    for (let frameIndex = 0; frameIndex < options.frameCount; frameIndex += 1) {
      if (encoderError) throw encoderError;
      const pixels = options.adapter.renderFrameRgba({
        frameIndex,
        timeTicks: frameIndex * options.ticksPerFrame,
        durationTicks: options.ticksPerFrame,
        profile: options.profile,
        params: options.params,
      });
      const frame = new FrameCtor(pixels, {
        format: 'RGBA',
        codedWidth: options.width,
        codedHeight: options.height,
        timestamp: Math.round((frameIndex * 1_000_000) / options.fps),
      });
      encoder.encode(frame, { keyFrame: frameIndex % KEY_FRAME_INTERVAL === 0 });
      frame.close();
      options.onProgress?.(frameIndex + 1, options.frameCount);
      if (frameIndex % YIELD_EVERY_FRAMES === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
      }
    }

    await encoder.flush();
    if (encoderError) throw encoderError;
    muxer.finalize();
    const blob = new Blob([target.buffer], { type: 'video/mp4' });
    return {
      blob,
      bytes: blob.size,
      frameCount: options.frameCount,
      durationSeconds: options.frameCount / options.fps,
    };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`视频导出失败：${detail}`);
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
}
