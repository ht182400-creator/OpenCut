import { describe, expect, it } from 'vitest';

import type { EditorAdapter } from './editor-adapter';
import {
  ASSET_THUMBNAIL_HEIGHT,
  ASSET_THUMBNAIL_WIDTH,
  MAX_TIMELINE_THUMBNAILS,
  THUMBNAIL_CACHE_SCHEMA_VERSION,
  ThumbnailCache,
  buildThumbnailCacheKey,
  makeThumbnailDataUrl,
  pickThumbnailFrameIndices,
  rgbaToDataUrl,
} from './thumbnail';

/** 批 7.4 帧缩略图：纯函数与缓存回归（不启动浏览器 canvas）。 */
describe('缩略图缓存 key', () => {
  it('含 schema 版本、素材指纹、帧索引与目标尺寸', () => {
    const key = buildThumbnailCacheKey({
      fingerprint: 'video|123|456', frameIndex: 7, width: 112, height: 63,
    });
    expect(key).toBe(`t${THUMBNAIL_CACHE_SCHEMA_VERSION}|video|123|456|7|112x63`);
  });

  it('任一参数变化即产生不同 key', () => {
    const base = { fingerprint: 'f', frameIndex: 1, width: 112, height: 63 };
    const keys = [
      buildThumbnailCacheKey(base),
      buildThumbnailCacheKey({ ...base, frameIndex: 2 }),
      buildThumbnailCacheKey({ ...base, width: 224 }),
      buildThumbnailCacheKey({ ...base, height: 126 }),
      buildThumbnailCacheKey({ ...base, fingerprint: 'g' }),
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('pickThumbnailFrameIndices 代表帧选择', () => {
  it('首尾必取且均匀分布', () => {
    // 跨度用 (frameCount-1)=89，slot 2 处 round(2*89/3)=59。
    expect(pickThumbnailFrameIndices(90, 4)).toEqual([0, 30, 59, 89]);
  });

  it('count=1 时只取第 0 帧', () => {
    expect(pickThumbnailFrameIndices(90, 1)).toEqual([0]);
  });

  it('count 大于帧数时按帧数截断且不重复', () => {
    expect(pickThumbnailFrameIndices(3, 10)).toEqual([0, 1, 2]);
  });

  it('边界：帧数或 count 为 0/负数返回空', () => {
    expect(pickThumbnailFrameIndices(0, 4)).toEqual([]);
    expect(pickThumbnailFrameIndices(90, 0)).toEqual([]);
    expect(pickThumbnailFrameIndices(-1, 4)).toEqual([]);
  });

  it('小数帧数去重后仍升序', () => {
    const indices = pickThumbnailFrameIndices(7, MAX_TIMELINE_THUMBNAILS);
    expect(indices[0]).toBe(0);
    expect(indices[indices.length - 1]).toBe(6);
    expect(indices.every((value, i) => i === 0 || value > indices[i - 1])).toBe(true);
  });
});

describe('浏览器 canvas 降级', () => {
  it('Node 环境无 document 时 rgbaToDataUrl 返回空串', () => {
    const pixels = new Uint8Array(ASSET_THUMBNAIL_WIDTH * ASSET_THUMBNAIL_HEIGHT * 4).fill(128);
    expect(rgbaToDataUrl(pixels, ASSET_THUMBNAIL_WIDTH, ASSET_THUMBNAIL_HEIGHT)).toBe('');
  });

  it('非法尺寸或缓冲不足返回空串', () => {
    expect(rgbaToDataUrl(new Uint8Array(4), 0, 10)).toBe('');
    expect(rgbaToDataUrl(new Uint8Array(4), 2, 2)).toBe('');
  });

  it('core 抽样失败时 makeThumbnailDataUrl 降级为空而非抛出', () => {
    const adapter = {
      makeThumbnail: () => { throw new Error('INVALID_THUMBNAIL_INPUT'); },
    } as unknown as EditorAdapter;
    expect(makeThumbnailDataUrl(adapter, new Uint8Array(16), 2, 2, 1, 1)).toBe('');
  });

  it('core 成功但无 canvas 时返回空串', () => {
    const adapter = {
      makeThumbnail: () => new Uint8Array(4).fill(200),
    } as unknown as EditorAdapter;
    expect(makeThumbnailDataUrl(adapter, new Uint8Array(16), 2, 2, 1, 1)).toBe('');
  });
});

describe('ThumbnailCache LRU 缓存', () => {
  it('命中刷新顺序、未命中计数正确', () => {
    const cache = new ThumbnailCache(2);
    expect(cache.get('a')).toBeNull();
    cache.set('a', 'url-a');
    cache.set('b', 'url-b');
    expect(cache.get('a')).toBe('url-a');
    cache.set('c', 'url-c');
    expect(cache.get('b')).toBeNull(); // b 最久未用被淘汰
    expect(cache.get('c')).toBe('url-c');
    expect(cache.stats().hits).toBe(2);
    expect(cache.stats().misses).toBe(2);
  });

  it('重复写入同一 key 不增加条目', () => {
    const cache = new ThumbnailCache(4);
    cache.set('a', 'url-1');
    cache.set('a', 'url-2');
    expect(cache.get('a')).toBe('url-2');
    expect(cache.stats().entries).toBe(1);
  });

  it('clear 清空条目并保留累计统计', () => {
    const cache = new ThumbnailCache();
    cache.set('a', 'url-a');
    cache.get('a');
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.stats().entries).toBe(0);
    expect(cache.stats().hits).toBe(1);
  });
});
