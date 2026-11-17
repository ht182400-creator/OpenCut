/**
 * 帧缩略图工具（批 7.4）：从已解码的代理帧选代表帧，经 core 下采样为缩略图，
 * 再转成 data URL 供素材卡 `<img>` 与时间轴视频片段显示真实画面。
 *
 * 纯函数（帧选择 / 缓存 key）与浏览器 canvas 转换分离，前者可独立单测；
 * core 下采样经 `editor-adapter` I-01 入口调用（本模块不直接 import wasm glue）。
 */

import type { EditorAdapter } from './editor-adapter';

/** 缩略图缓存 key 的 schema 版本；结构变更时旧 key 整体失效。 */
export const THUMBNAIL_CACHE_SCHEMA_VERSION = 1;

/** 素材卡缩略图默认尺寸（16:9，与 assets-tokens 卡片 112px 宽对齐）。 */
export const ASSET_THUMBNAIL_WIDTH = 112;
export const ASSET_THUMBNAIL_HEIGHT = 63;

/** 时间轴单片段内平铺的缩略图数量上限（防止长片段 DOM 爆炸）。 */
export const MAX_TIMELINE_THUMBNAILS = 12;

/** 生成缩略图缓存 key 所需的素材与帧参数。 */
export interface ThumbnailCacheKeyInput {
  /** 素材指纹（name|size|lastModified 由调用方拼好）。 */
  fingerprint: string;
  /** 帧索引。 */
  frameIndex: number;
  /** 目标宽高。 */
  width: number;
  height: number;
}

/**
 * 构造稳定的缩略图缓存 key：素材指纹、帧索引、目标尺寸任一变化即失效。
 * @param input 素材指纹与帧参数
 * @returns {string} 缓存 key
 */
export function buildThumbnailCacheKey(input: ThumbnailCacheKeyInput): string {
  return [
    `t${THUMBNAIL_CACHE_SCHEMA_VERSION}`,
    input.fingerprint,
    input.frameIndex,
    `${input.width}x${input.height}`,
  ].join('|');
}

/**
 * 从 `frameCount` 帧中均匀选出至多 `count` 个代表帧索引（含首尾、去重、升序）。
 * @param frameCount 总帧数
 * @param count 期望缩略图数量
 * @returns {number[]} 代表帧索引（frameCount<=0 时返回空数组）
 */
export function pickThumbnailFrameIndices(frameCount: number, count: number): number[] {
  if (frameCount <= 0 || count <= 0) return [];
  const target = Math.min(count, frameCount);
  if (target === 1) return [0];
  const indices = new Set<number>();
  for (let slot = 0; slot < target; slot += 1) {
    // 首尾必取；中间按等间距取整，Set 去重避免小数帧数下重复。
    const index = Math.round((slot * (frameCount - 1)) / (target - 1));
    indices.add(Math.min(frameCount - 1, Math.max(0, index)));
  }
  return Array.from(indices).sort((a, b) => a - b);
}

/**
 * 把 RGBA8 像素（行优先）转成 data URL（PNG），供 `<img>` 显示。
 * 用 2D canvas 的 putImageData 写入像素再 toDataURL，不引入第三方库。
 * @param pixels RGBA8 像素缓冲，长度须为 width*height*4
 * @param width 像素宽
 * @param height 像素高
 * @returns {string} PNG data URL；环境无 canvas 或尺寸非法时返回空串
 */
export function rgbaToDataUrl(pixels: Uint8Array, width: number, height: number): string {
  if (width <= 0 || height <= 0 || pixels.length < width * height * 4) return '';
  try {
    if (typeof document === 'undefined') return '';
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) return '';
    // 精确拷贝成独立 Uint8ClampedArray：直接传 pixels.buffer 在 SharedArrayBuffer
    // 场景会落到错误的 ImageData 重载（批 7.2 wasm glue 曾踩同类坑）。
    const rgba = new Uint8ClampedArray(width * height * 4);
    rgba.set(pixels.subarray(0, width * height * 4));
    context.putImageData(new ImageData(rgba, width, height), 0, 0);
    return canvas.toDataURL('image/png');
  } catch {
    // canvas 被 Tainted 或内存不足时静默降级为空，由调用方显示占位图标。
    return '';
  }
}

/**
 * 用 core 把一帧代理帧下采样成缩略图 data URL。
 * @param adapter I-01 适配层入口
 * @param frame 源帧 RGBA8
 * @param srcWidth 源帧宽
 * @param srcHeight 源帧高
 * @param width 缩略图宽
 * @param height 缩略图高
 * @returns {string} PNG data URL；core 失败或环境无 canvas 时返回空串
 */
export function makeThumbnailDataUrl(
  adapter: EditorAdapter,
  frame: Uint8Array,
  srcWidth: number,
  srcHeight: number,
  width: number,
  height: number,
): string {
  try {
    const thumb = adapter.makeThumbnail(frame, {
      srcWidth, srcHeight, width, height,
    });
    return rgbaToDataUrl(thumb, width, height);
  } catch {
    // core 校验失败时降级为空，由调用方显示占位图标，不抛出打断 UI。
    return '';
  }
}

/**
 * 内存缩略图缓存：按素材指纹 + 帧索引 + 尺寸缓存 data URL，命中直接复用。
 * LRU 淘汰由容量上限控制，避免长片缩略图占满内存。
 */
export class ThumbnailCache {
  private readonly entries = new Map<string, string>();

  private hits = 0;

  private misses = 0;

  constructor(private readonly maxEntries = 64) {}

  /** 读取缓存；命中刷新 LRU 顺序。 */
  get(key: string): string | null {
    const value = this.entries.get(key);
    if (value === undefined) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    this.entries.delete(key);
    this.entries.set(key, value);
    return value;
  }

  /** 写入缓存；超出容量淘汰最久未用项。 */
  set(key: string, value: string): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** 清空缓存。 */
  clear(): void {
    this.entries.clear();
  }

  /** 读取命中统计快照。 */
  stats(): { hits: number; misses: number; entries: number } {
    return { hits: this.hits, misses: this.misses, entries: this.entries.size };
  }
}

/** 全页面共享的缩略图缓存实例。 */
export const thumbnailCache = new ThumbnailCache();
