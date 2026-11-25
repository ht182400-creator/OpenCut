/**
 * media.ts 纯函数与缓存分支测试（ISTQB 组件测试级别）。
 * 覆盖：MAX_DECODE_FRAMES 常量、isVideoFile 真/假/大小写/空名、
 * frameTimeSeconds 边界、mediaFrameAt 边界与越界回退、getFrameCacheStats/clearFrameCache、
 * getPersistedCacheStats。视频解码主体需要 HTMLVideoElement（E2E 覆盖），这里测可注入的纯逻辑。
 */

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BENCHMARK_4K_CODEC,
  MAX_DECODE_FRAMES,
  clearFrameCache,
  frameTimeSeconds,
  getFrameCacheStats,
  getPersistedCacheStats,
  isVideoFile,
  mediaFrameAt,
  type DecodedMedia,
} from './media'

/** 每个用例后恢复 spy。 */
afterEach(() => vi.restoreAllMocks())

/** 构造最小 DecodedMedia。 */
function makeMedia(): DecodedMedia {
  return {
    name: 'v.mp4',
    frames: [new Uint8Array([1, 2, 3, 4]), new Uint8Array([5, 6, 7, 8])],
    audio: null,
    width: 2,
    height: 2,
    savedAt: 1,
  } as unknown as DecodedMedia
}

describe('media.ts 常量与文件类型判定', () => {
  it('解码帧上限与基准编码为固定契约', () => {
    expect(MAX_DECODE_FRAMES).toBe(90)
    expect(BENCHMARK_4K_CODEC).toBe('avc1.640033')
  })

  it('isVideoFile：合法扩展名（大小写不敏感）', () => {
    for (const name of ['a.mp4', 'b.webm', 'c.MOV', 'd.m4v', 'e.ogv']) {
      expect(isVideoFile(new File(['x'], name, { type: '' }))).toBe(true)
    }
  })

  it('isVideoFile：非视频/无扩展名/空名拒绝', () => {
    for (const name of ['a.txt', 'b.png', 'noext', '']) {
      expect(isVideoFile(new File(['x'], name, { type: '' }))).toBe(false)
    }
  })
})

describe('media.ts 帧时间与帧取样', () => {
  it('frameTimeSeconds：0 帧、常规帧、越界裁剪到媒体末尾', () => {
    expect(frameTimeSeconds(0, 30, 10)).toBe(0)
    expect(frameTimeSeconds(30, 30, 10)).toBe(1)
    expect(frameTimeSeconds(1, 120, 10)).toBeCloseTo(1 / 120, 6)
    // 超出时长的帧被裁剪到 duration - 1/fps，不产生越界 seek。
    expect(frameTimeSeconds(9999, 30, 2)).toBeCloseTo(2 - 1 / 30, 6)
  })

  it('mediaFrameAt：正常帧返回对应像素', () => {
    expect(Array.from(mediaFrameAt(makeMedia(), 0))).toEqual([1, 2, 3, 4])
    expect(Array.from(mediaFrameAt(makeMedia(), 1))).toEqual([5, 6, 7, 8])
  })

  it('mediaFrameAt：越界帧回退到最后一帧（安全降级）', () => {
    const media = makeMedia()
    expect(Array.from(mediaFrameAt(media, 99))).toEqual([5, 6, 7, 8])
  })
})

describe('media.ts 缓存统计与清理', () => {
  it('getFrameCacheStats 返回统计对象（hits/misses 等）', () => {
    const stats = getFrameCacheStats()
    expect(stats).toHaveProperty('hits')
    expect(stats).toHaveProperty('misses')
  })

  it('getPersistedCacheStats 返回 Promise 统计', async () => {
    const stats = await getPersistedCacheStats()
    expect(stats).toHaveProperty('entries')
  })

  it('clearFrameCache 不抛错（内存+持久化双层清理）', async () => {
    await expect(clearFrameCache()).resolves.toBeUndefined()
  })
})
