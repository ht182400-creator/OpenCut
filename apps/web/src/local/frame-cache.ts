/**
 * 代理帧缓存（W-09 / H12）：按素材指纹缓存低分辨率 RGBA 帧与 PCM。
 *
 * 抽帧始终缩放到代理尺寸（默认 320×180），因此即使导入 4K 素材，
 * 预览与合成的像素量恒定；重复导入同一素材直接命中缓存，不再逐帧 seek。
 * Map 的插入顺序用于 LRU：命中时移到末尾，容量满时淘汰最久未用项。
 */

import type { PcmAudio } from './audio';

/** 默认最多缓存几份素材（避免 4K 长片占满内存）。 */
export const DEFAULT_MAX_CACHE_ENTRIES = 3;

/** 生成缓存 key 所需的素材与解码参数。 */
export interface FrameCacheKeyInput {
  name: string;
  size: number;
  lastModified: number;
  width: number;
  height: number;
  fps: number;
  frameCount: number;
}

/**
 * 构造稳定的缓存 key；素材内容、代理尺寸、帧率或帧数任一变化即失效。
 * @param input 素材指纹与解码参数
 * @returns {string} 缓存 key
 */
export function buildCacheKey(input: FrameCacheKeyInput): string {
  return [
    input.name,
    input.size,
    input.lastModified,
    input.width,
    input.height,
    input.fps.toFixed(6),
    input.frameCount,
  ].join('|');
}

/** 缓存的代理帧与音轨（不含文件名，文件名在命中时由调用方补齐）。 */
export interface CachedMedia {
  frames: Uint8Array[];
  audio: PcmAudio | null;
  durationSeconds: number;
  fps: number;
  width: number;
  height: number;
}

/** 缓存统计，用于量化命中率与内存占用。 */
export interface FrameCacheStats {
  hits: number;
  misses: number;
  entries: number;
  cachedFrames: number;
  cachedBytes: number;
}

interface CacheEntry {
  value: CachedMedia;
  createdAt: number;
}

/** 计算一份缓存条目的近似字节数。 */
export function cachedMediaBytes(value: CachedMedia): number {
  const frameBytes = (value.frames[0]?.byteLength ?? 0) * value.frames.length;
  const audioBytes = value.audio
    ? value.audio.channels.reduce((sum, channel) => sum + channel.byteLength, 0)
    : 0;
  return frameBytes + audioBytes;
}

/** 内存 LRU 代理帧缓存。 */
export class FrameCache {
  private readonly entries = new Map<string, CacheEntry>();

  private hits = 0;

  private misses = 0;

  constructor(private readonly maxEntries = DEFAULT_MAX_CACHE_ENTRIES) {}

  /** 读取缓存；命中会刷新 LRU 顺序。 */
  get(key: string): CachedMedia | null {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    this.hits += 1;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  /** 写入缓存；超出容量时淘汰最久未用项。 */
  set(key: string, value: CachedMedia): void {
    this.entries.delete(key);
    this.entries.set(key, { value, createdAt: Date.now() });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  /** 清空全部缓存（素材变更或用户手动失效）。 */
  clear(): void {
    this.entries.clear();
  }

  /** 读取统计快照。 */
  stats(): FrameCacheStats {
    let cachedFrames = 0;
    let cachedBytes = 0;
    for (const entry of this.entries.values()) {
      cachedFrames += entry.value.frames.length;
      cachedBytes += cachedMediaBytes(entry.value);
    }
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      cachedFrames,
      cachedBytes,
    };
  }
}

/** 全页面共享的代理帧缓存实例。 */
export const frameCache = new FrameCache();
