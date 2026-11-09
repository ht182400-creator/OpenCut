/**
 * 真实媒体解码（W-08）：浏览器负责解码，Rust core 负责合成与帧契约。
 *
 * 用原生 `<video>` + canvas 逐帧抽帧，零第三方解码依赖、支持浏览器能播的任何容器/编码；
 * 音频用 Web Audio `decodeAudioData` 解成 planar PCM（无音轨时静默降级）。
 * 抽出的 RGBA 帧交给 `composite_frame_rgba` 合成，预览与导出共用同一帧源。
 */

import { createToneAudio, decodeAudioFromFile, type PcmAudio } from './audio';
import { exportProjectToMp4 } from './export';

/** 解码结果：按帧索引缓存的 RGBA8 像素与可选音轨。 */
export interface DecodedMedia {
  name: string;
  frames: Uint8Array[];
  audio: PcmAudio | null;
  width: number;
  height: number;
  durationSeconds: number;
  fps: number;
}

/** 抽帧选项。 */
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

/**
 * 解码本地视频文件并抽取指定数量的 RGBA 帧与可选音轨。
 * @param file 用户选择的视频文件
 * @param options 抽帧尺寸、帧率与数量
 * @returns {Promise<DecodedMedia>} 缓存的帧像素与 PCM
 */
export async function decodeVideoFile(
  file: File,
  options: DecodeOptions,
): Promise<DecodedMedia> {
  if (!isVideoFile(file)) {
    throw new Error('请选择视频文件（mp4 / webm 等）');
  }
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
    return {
      name: file.name,
      frames,
      audio,
      width: options.width,
      height: options.height,
      durationSeconds: duration,
      fps: options.fps,
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
 * 现场生成一段带 AAC 音轨的真实 MP4 作为演示素材，供无素材时体验完整链路。
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
  return new File([result.blob], 'demo-clip.mp4', { type: 'video/mp4' });
}
