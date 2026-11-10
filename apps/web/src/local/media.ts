/**
 * 真实媒体解码（W-08 / W-09）：浏览器负责解码，Rust core 负责合成与帧契约。
 *
 * 用原生 `<video>` + canvas 逐帧抽取**代理尺寸**的 RGBA 帧（W-09：即使 4K 素材
 * 也只解到 320×180，预览与合成的像素量恒定），零第三方解码依赖；
 * 音频用 Web Audio `decodeAudioData` 解成 planar PCM（无音轨时静默降级）。
 * 缓存分三级：内存 LRU → IndexedDB 持久化 → 逐帧 seek 解码；
 * 后两级命中都会跳过重新解码，刷新页面后仍能复用代理帧。
 */

import { createToneAudio, decodeAudioFromFile, type PcmAudio } from './audio';
import { exportProjectToMp4 } from './export';
import {
  buildCacheKey,
  frameCache,
  type FrameCacheStats,
  type CachedMedia,
} from './frame-cache';
import { frameStore, type FrameStoreStats } from './frame-store';

/** 解码结果：按帧索引缓存的代理 RGBA8 像素与可选音轨。 */
export interface DecodedMedia {
  name: string;
  frames: Uint8Array[];
  audio: PcmAudio | null;
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
  /** 本次是否命中任一级代理缓存。 */
  fromCache: boolean;
  /** 缓存未命中时实际解码耗时（毫秒），命中时为读取耗时。 */
  decodeMilliseconds: number;
  /** 命中来源，仅用于界面展示。 */
  cacheDetail?: string;
  /** 本次解码结果是否成功写入持久化层。 */
  persisted?: boolean;
}

/** 单次解码的最大帧数，避免长项目逐帧 seek 过慢。 */
export const MAX_DECODE_FRAMES = 90;

/** 抽帧选项（宽高即代理尺寸）。 */
export interface DecodeOptions {
  width: number;
  height: number;
  fps: number;
  frameCount: number;
  onProgress?: (done: number, total: number) => void;
}

/** 是否为浏览器可解码的视频文件。 */
export function isVideoFile(file: File): boolean {
  return file.type.startsWith('video/') || /\.(mp4|webm|mov|m4v|ogv)$/i.test(file.name);
}

/**
 * 计算第 i 帧对应的媒体时间（秒），并夹到视频时长内。
 * @param frameIndex 帧索引
 * @param fps 帧率
 * @param durationSeconds 媒体时长
 * @returns {number} 秒
 */
export function frameTimeSeconds(
  frameIndex: number,
  fps: number,
  durationSeconds: number,
): number {
  const target = frameIndex / fps;
  const upperBound = Math.max(durationSeconds - 1 / fps, 0);
  return Math.min(Math.max(target, 0), upperBound);
}

/** 等待 seek 完成并确保新画面已呈现。 */
function seekTo(video: HTMLVideoElement, seconds: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      video.removeEventListener('seeked', onSeeked);
      reject(new Error(`视频抽帧超时（目标 ${seconds.toFixed(2)}s）`));
    }, 8000);
    const onSeeked = () => {
      window.clearTimeout(timer);
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      const withFrameCallback = video as HTMLVideoElement & {
        requestVideoFrameCallback?: (callback: () => void) => number;
      };
      if (typeof withFrameCallback.requestVideoFrameCallback === 'function') {
        withFrameCallback.requestVideoFrameCallback(finish);
        window.setTimeout(finish, 150);
      } else {
        window.setTimeout(finish, 30);
      }
    };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.currentTime = seconds;
  });
}

/** 清空内存与持久化代理缓存（素材变更或用户手动失效）。 */
export async function clearFrameCache(): Promise<void> {
  frameCache.clear();
  await frameStore.clear();
}

/** 读取内存代理帧缓存统计，用于量化命中率与内存占用。 */
export function getFrameCacheStats(): FrameCacheStats {
  return frameCache.stats();
}

/** 读取 IndexedDB 持久化统计。 */
export function getPersistedCacheStats(): Promise<FrameStoreStats> {
  return frameStore.stats();
}

/**
 * 解码本地视频文件并抽取指定数量的代理 RGBA 帧与可选音轨。
 * 依次查内存 LRU、IndexedDB，都未命中才逐帧 seek；结果写回两级缓存。
 * @param file 用户选择的视频文件
 * @param options 代理尺寸、帧率与数量
 * @returns {Promise<DecodedMedia>} 缓存的帧像素与 PCM
 */
export async function decodeVideoFile(
  file: File,
  options: DecodeOptions,
): Promise<DecodedMedia> {
  if (!isVideoFile(file)) {
    throw new Error('请选择视频文件（mp4 / webm 等）');
  }
  const cacheKey = buildCacheKey({
    name: file.name,
    size: file.size,
    lastModified: file.lastModified,
    width: options.width,
    height: options.height,
    fps: options.fps,
    frameCount: options.frameCount,
  });

  const fromMemory = frameCache.get(cacheKey);
  if (fromMemory) {
    return {
      name: file.name, ...fromMemory,
      fromCache: true, decodeMilliseconds: 0, cacheDetail: '内存缓存',
    };
  }

  const persistedStart = performance.now();
  const fromStore = await frameStore.load(cacheKey);
  if (fromStore) {
    frameCache.hydrate(cacheKey, fromStore);
    return {
      name: file.name, ...fromStore,
      fromCache: true,
      decodeMilliseconds: Math.round(performance.now() - persistedStart),
      cacheDetail: '持久化缓存',
    };
  }

  const started = performance.now();
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('浏览器无法解码该视频文件'));
    });
    const audio = await decodeAudioFromFile(file);
    const duration = Number.isFinite(video.duration) && video.duration > 0
      ? video.duration
      : options.frameCount / options.fps;
    const canvas = document.createElement('canvas');
    canvas.width = options.width;
    canvas.height = options.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法创建 2D 画布用于抽帧');

    const frames: Uint8Array[] = [];
    for (let frameIndex = 0; frameIndex < options.frameCount; frameIndex += 1) {
      const seconds = frameTimeSeconds(frameIndex, options.fps, duration);
      await seekTo(video, seconds);
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      frames.push(new Uint8Array(pixels));
      options.onProgress?.(frameIndex + 1, options.frameCount);
    }

    const cachedValue: CachedMedia = {
      frames,
      audio,
      durationSeconds: duration,
      fps: options.fps,
      width: options.width,
      height: options.height,
    };
    frameCache.set(cacheKey, cachedValue);
    const persisted = await frameStore.save(cacheKey, cachedValue);
    return {
      name: file.name,
      ...cachedValue,
      fromCache: false,
      decodeMilliseconds: Math.round(performance.now() - started),
      persisted,
    };
  } finally {
    URL.revokeObjectURL(url);
    video.removeAttribute('src');
    video.load();
  }
}

/** 取某帧（超出范围时循环复用，保证短素材也能导出长项目）。 */
export function mediaFrameAt(media: DecodedMedia, frameIndex: number): Uint8Array {
  if (media.frames.length === 0) {
    throw new Error('素材没有可用帧');
  }
  return media.frames[frameIndex % media.frames.length];
}

/**
 * 把代理帧编码成低分辨率 MP4「代理文件」，可下载、跨设备复用或重新导入。
 * 只包含视频轨（不含音轨），因为它是预览用的轻量副本。
 * @param media 已解码的代理媒体
 * @returns {Promise<File>} 代理 MP4 文件
 */
export async function createProxyFile(media: DecodedMedia): Promise<File> {
  const fps = media.fps > 0 ? media.fps : 30;
  const result = await exportProjectToMp4({
    width: media.width,
    height: media.height,
    fps,
    frameCount: media.frames.length,
    ticksPerFrame: 120000 / fps,
    profile: {},
    params: {},
    frameSource: (index) => media.frames[index],
  });
  const baseName = media.name.replace(/\.[^.]+$/, '');
  return new File([result.blob], `proxy-${baseName}.mp4`, {
    type: 'video/mp4',
    lastModified: 0,
  });
}

/**
 * 现场生成一段带 AAC 音轨的真实 MP4 作为演示素材（固定 lastModified 以便缓存命中）。
 * 画面是渐变背景 + 横向移动的白色方块，音轨是 440Hz 正弦波。
 * @returns {Promise<File>} 可作为输入重新导入的视频文件
 */
export async function createDemoVideoFile(
  width = 320,
  height = 180,
  fps = 30,
  frameCount = 60,
): Promise<File> {
  const frameSource = (frameIndex: number): Uint8Array => {
    const pixels = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = Math.round(30 + (100 * x) / width);
        pixels[offset + 1] = Math.round(40 + (80 * y) / height);
        pixels[offset + 2] = 130;
        pixels[offset + 3] = 255;
      }
    }
    const left = Math.round((frameIndex / frameCount) * (width - 40));
    for (let y = 60; y < 120 && y < height; y += 1) {
      for (let x = left; x < left + 40 && x < width; x += 1) {
        const offset = (y * width + x) * 4;
        pixels[offset] = 255;
        pixels[offset + 1] = 255;
        pixels[offset + 2] = 255;
        pixels[offset + 3] = 255;
      }
    }
    return pixels;
  };
  const result = await exportProjectToMp4({
    width,
    height,
    fps,
    frameCount,
    ticksPerFrame: 120000 / fps,
    profile: {},
    params: {},
    frameSource,
    audioSource: createToneAudio(frameCount / fps),
  });
  return new File([result.blob], 'demo-clip.mp4', {
    type: 'video/mp4',
    lastModified: 0,
  });
}

/** 4K 基准素材的 H.264 Level 5.1；Baseline 3.1 的分辨率上限不足以承载 3840×2160。 */
export const BENCHMARK_4K_CODEC = 'avc1.640033';

/**
 * 生成指定分辨率的基准素材（W-09 收尾）：灰底 + 移动白块。
 * 用 `Uint32Array.fill` 批量写像素，避免 4K 逐像素循环；
 * 导入后仍由 `decodeVideoFile` 抽成恒定 320×180 代理帧。
 * @param width 源宽度
 * @param height 源高度
 * @param fps 帧率
 * @param frameCount 帧数（4K 编码较慢，默认 4 帧）
 * @returns {Promise<File>} 可作为输入重新导入的 MP4
 */
export async function createBenchmarkVideoFile(
  width = 3840,
  height = 2160,
  fps = 30,
  frameCount = 4,
): Promise<File> {
  const block = Math.min(240, Math.max(16, Math.round(width / 8)));
  const frameSource = (frameIndex: number): Uint8Array => {
    const pixels = new Uint8Array(width * height * 4);
    const view = new Uint32Array(pixels.buffer);
    view.fill(0xff3c3c3c);
    const left = Math.round((frameIndex / Math.max(frameCount, 1)) * (width - block));
    const top = Math.round(height / 2 - block / 2);
    for (let y = top; y < top + block; y += 1) {
      view.fill(0xffffffff, y * width + left, y * width + left + block);
    }
    return pixels;
  };
  const result = await exportProjectToMp4({
    width,
    height,
    fps,
    frameCount,
    ticksPerFrame: 120000 / fps,
    profile: {},
    params: {},
    frameSource,
    codec: BENCHMARK_4K_CODEC,
  });
  return new File([result.blob], `benchmark-${width}x${height}.mp4`, {
    type: 'video/mp4',
    lastModified: 0,
  });
}
