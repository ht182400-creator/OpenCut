import { describe, expect, it } from 'vitest';

import {
  FrameStore,
  FRAME_STORE_DB_NAME,
  FRAME_STORE_NAME,
  MemoryFrameStore,
  createDefaultBackend,
  frameStore,
  type FrameStoreBackend,
  type PersistedEntry,
} from './frame-store';
import type { CachedMedia } from './frame-cache';

/** 构造最小缓存条目。 */
function media(frameCount = 2): CachedMedia {
  return {
    frames: Array.from({ length: frameCount }, () => new Uint8Array(4)),
    audio: null,
    durationSeconds: frameCount / 30,
    fps: 30,
    width: 320,
    height: 180,
  };
}

/** 全部操作抛错的后端，用于验证静默降级。 */
const throwingBackend: FrameStoreBackend = {
  async get() { throw new Error('blocked'); },
  async put() { throw new Error('quota exceeded'); },
  async clear() { throw new Error('blocked'); },
  async stats() { throw new Error('blocked'); },
};

/** 代理帧持久化回归（W-09 第二批）：用内存后端覆盖读写与异常分支，不依赖浏览器。 */
describe('MemoryFrameStore', () => {
  it('put/get 往返并保留元数据', async () => {
    const backend = new MemoryFrameStore();
    const record: PersistedEntry = {
      key: 'a', value: media(3), savedAt: 123, bytes: 12,
    };
    await backend.put(record);
    expect(await backend.get('a')).toEqual(record);
  });

  it('clear 与 stats', async () => {
    const backend = new MemoryFrameStore();
    await backend.put({ key: 'a', value: media(), savedAt: 1, bytes: 8 });
    expect(await backend.stats()).toEqual({ entries: 1, bytes: 8 });
    await backend.clear();
    expect(await backend.stats()).toEqual({ entries: 0, bytes: 0 });
    expect(await backend.get('a')).toBeNull();
  });
});

describe('FrameStore 往返', () => {
  it('save/load 还原帧与音轨', async () => {
    const store = new FrameStore(new MemoryFrameStore());
    const value = media(3);
    value.audio = {
      channels: [new Float32Array([0.5, -0.5]), new Float32Array([0.25, -0.25])],
      sampleRate: 48000,
      durationSeconds: 0.1,
    };
    expect(await store.save('k', value)).toBe(true);
    const loaded = await store.load('k');
    expect(loaded?.frames).toHaveLength(3);
    expect(Array.from(loaded?.audio?.channels[0] ?? [])).toEqual([0.5, -0.5]);
    expect(await store.stats()).toEqual({ entries: 1, bytes: 12 + 16 });
  });

  it('未命中的 key 返回 null', async () => {
    const store = new FrameStore(new MemoryFrameStore());
    expect(await store.load('missing')).toBeNull();
  });

  it('clear 清空持久化记录', async () => {
    const store = new FrameStore(new MemoryFrameStore());
    await store.save('a', media());
    expect(await store.clear()).toBe(true);
    expect(await store.stats()).toEqual({ entries: 0, bytes: 0 });
  });
});

describe('FrameStore 异常降级', () => {
  it('后端抛错时 load 返回 null、save/clear 返回 false、stats 归零', async () => {
    const store = new FrameStore(throwingBackend);
    expect(await store.load('k')).toBeNull();
    expect(await store.save('k', media())).toBe(false);
    expect(await store.clear()).toBe(false);
    expect(await store.stats()).toEqual({ entries: 0, bytes: 0 });
  });
});

describe('默认后端与常量', () => {
  it('Node 无 IndexedDB 时降级为内存后端', () => {
    expect(createDefaultBackend()).toBeInstanceOf(MemoryFrameStore);
  });

  it('共享单例可用且数据库名稳定', () => {
    expect(FRAME_STORE_DB_NAME).toBe('opencut-proxy-frames');
    expect(FRAME_STORE_NAME).toBe('frames');
    expect(frameStore).toBeInstanceOf(FrameStore);
  });
});
