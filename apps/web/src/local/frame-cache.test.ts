import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MAX_CACHE_ENTRIES,
  FrameCache,
  buildCacheKey,
  cachedMediaBytes,
  frameCache,
  type CachedMedia,
} from './frame-cache';

/** 代理帧缓存回归（W-09）：纯内存逻辑，不依赖浏览器。 */
describe('缓存 key', () => {
  const base = {
    name: 'clip.mp4', size: 12345, lastModified: 1700000000000,
    width: 320, height: 180, fps: 30, frameCount: 90,
  };

  it('相同指纹生成相同 key', () => {
    expect(buildCacheKey(base)).toBe(buildCacheKey({ ...base }));
  });

  it('素材内容、代理尺寸、帧率、帧数任一变化即失效', () => {
    expect(buildCacheKey({ ...base, size: 12346 })).not.toBe(buildCacheKey(base));
    expect(buildCacheKey({ ...base, lastModified: 1700000000001 })).not.toBe(buildCacheKey(base));
    expect(buildCacheKey({ ...base, width: 640 })).not.toBe(buildCacheKey(base));
    expect(buildCacheKey({ ...base, fps: 30000 / 1001 })).not.toBe(buildCacheKey(base));
    expect(buildCacheKey({ ...base, frameCount: 60 })).not.toBe(buildCacheKey(base));
  });
});

/** 构造一份最小缓存条目。 */
function entry(frameCount: number): CachedMedia {
  return {
    frames: Array.from({ length: frameCount }, () => new Uint8Array(4)),
    audio: null,
    durationSeconds: frameCount / 30,
    fps: 30,
    width: 320,
    height: 180,
  };
}

describe('FrameCache LRU 与统计', () => {
  it('set/get 命中，未命中返回 null', () => {
    const cache = new FrameCache();
    expect(cache.get('missing')).toBeNull();
    cache.set('a', entry(2));
    expect(cache.get('a')?.frames).toHaveLength(2);
    expect(cache.stats()).toMatchObject({ hits: 1, misses: 1, entries: 1, cachedFrames: 2 });
  });

  it('容量满时淘汰最久未用项，命中会刷新顺序', () => {
    const cache = new FrameCache(2);
    cache.set('a', entry(1));
    cache.set('b', entry(1));
    expect(cache.get('a')).not.toBeNull();
    cache.set('c', entry(1));
    expect(cache.get('b')).toBeNull();
    expect(cache.get('a')).not.toBeNull();
    expect(cache.get('c')).not.toBeNull();
    expect(cache.stats().entries).toBe(2);
  });

  it('clear 清空条目但保留命中/未命中累计', () => {
    const cache = new FrameCache();
    cache.set('a', entry(1));
    cache.get('a');
    cache.clear();
    expect(cache.stats().entries).toBe(0);
    expect(cache.stats().hits).toBe(1);
    expect(cache.get('a')).toBeNull();
  });

  it('重复 set 同一 key 不增加条目数', () => {
    const cache = new FrameCache();
    cache.set('a', entry(1));
    cache.set('a', entry(2));
    expect(cache.stats().entries).toBe(1);
    expect(cache.get('a')?.frames).toHaveLength(2);
  });

  it('字节统计包含帧与音轨', () => {
    const value = entry(3);
    value.audio = {
      channels: [new Float32Array(100), new Float32Array(100)],
      sampleRate: 48000,
      durationSeconds: 0.1,
    };
    expect(cachedMediaBytes(value)).toBe(12 + 800);
  });

  it('共享单例默认容量为 3', () => {
    expect(DEFAULT_MAX_CACHE_ENTRIES).toBe(3);
    expect(frameCache.stats().entries).toBeGreaterThanOrEqual(0);
  });
});
