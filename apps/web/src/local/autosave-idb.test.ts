import { describe, expect, it } from 'vitest';

import {
  AUTOSAVE_STORAGE_KEY,
  defaultAutosaveStorage,
  persistAutosave,
  persistAutosaveAsync,
  readAutosaveAsync,
  type AsyncAutosaveStorage,
  type AutosaveState,
} from './project-autosave';
import {
  AUTOSAVE_MIGRATION_KEY,
  defaultAutosaveBackend,
  migrateLegacyAutosave,
} from './autosave-idb';

/** 构造最小合法编辑现场。 */
function makeState(overrides: Partial<AutosaveState> = {}): AutosaveState {
  return {
    elements: [],
    sourceName: '内置示例项目',
    frameIndex: 42,
    resolution: { label: '1920 × 1080', width: 1920, height: 1080 },
    selectedId: null,
    adjustments: [],
    ...overrides,
  };
}

/** 内存同步存储桩（模拟旧 localStorage）。 */
function memorySyncStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

/** 内存异步存储桩（模拟 IndexedDB 后端）。 */
function memoryAsyncStorage() {
  const map = new Map<string, string>();
  return {
    getItem: async (key: string) => map.get(key) ?? null,
    setItem: async (key: string, value: string) => void map.set(key, value),
    removeItem: async (key: string) => void map.delete(key),
  };
}

/** 写入失败的异步存储桩（模拟配额满）。 */
function failingAsyncStorage(): AsyncAutosaveStorage {
  return {
    getItem: async () => null,
    setItem: async () => { throw new Error('QUOTA_EXCEEDED'); },
    removeItem: async () => {},
  };
}

/** U-03：异步读写往返与降级。 */
describe('autosave 异步读写', () => {
  it('异步写入后按项目键读回', async () => {
    const backend = memoryAsyncStorage();
    expect(await persistAutosaveAsync(makeState(), 'proj-a', backend, '2026-11-24T00:00:00Z')).toBe(true);
    const saved = await readAutosaveAsync(backend, 'proj-a');
    expect(saved?.state.frameIndex).toBe(42);
    expect(saved?.projectKey).toBe('proj-a');
    expect(saved?.savedAt).toBe('2026-11-24T00:00:00Z');
  });

  it('项目不匹配或存储为空时返回 null', async () => {
    const backend = memoryAsyncStorage();
    await persistAutosaveAsync(makeState(), 'proj-a', backend);
    expect(await readAutosaveAsync(backend, 'proj-b')).toBeNull();
    expect(await readAutosaveAsync(memoryAsyncStorage(), 'proj-a')).toBeNull();
    expect(await readAutosaveAsync(null, 'proj-a')).toBeNull();
  });

  it('后端写入抛错时返回 false 且不污染已有数据', async () => {
    expect(await persistAutosaveAsync(makeState(), 'proj-a', failingAsyncStorage())).toBe(false);
    expect(await persistAutosaveAsync(makeState(), '', memoryAsyncStorage())).toBe(false);
  });

  it('IndexedDB 不可用时降级读取旧 localStorage 数据', async () => {
    const fallback = memorySyncStorage();
    persistAutosave(makeState(), 'legacy-proj', fallback);
    // Node 测试环境无 indexedDB，主后端必然失败，应回退到注入的同步存储。
    const backend = defaultAutosaveBackend(fallback);
    const saved = await readAutosaveAsync(backend, 'legacy-proj');
    expect(saved?.state.frameIndex).toBe(42);
    await backend.setItem(AUTOSAVE_STORAGE_KEY, 'new-value');
    expect(fallback.getItem(AUTOSAVE_STORAGE_KEY)).toBe('new-value');
    await backend.removeItem(AUTOSAVE_STORAGE_KEY);
    expect(fallback.getItem(AUTOSAVE_STORAGE_KEY)).toBeNull();
  });

  it('无降级后端时读写不抛异常', async () => {
    const backend = defaultAutosaveBackend(null);
    expect(await backend.getItem(AUTOSAVE_STORAGE_KEY)).toBeNull();
    await expect(backend.setItem('k', 'v')).resolves.toBeUndefined();
    await expect(backend.removeItem('k')).resolves.toBeUndefined();
  });
});

/** U-03：localStorage → IndexedDB 一次性迁移。 */
describe('autosave 迁移', () => {
  it('合法旧数据迁移到新后端并写入标记', async () => {
    const legacy = memorySyncStorage();
    persistAutosave(makeState(), 'legacy-proj', legacy);
    const target = memoryAsyncStorage();
    const result = await migrateLegacyAutosave(legacy, target);
    expect(result).toEqual({ migrated: true, skipped: false });
    expect(await target.getItem(AUTOSAVE_STORAGE_KEY)).toBe(legacy.getItem(AUTOSAVE_STORAGE_KEY));
    expect(legacy.getItem(AUTOSAVE_MIGRATION_KEY)).toBe('1');
  });

  it('已有迁移标记时跳过，不重复搬运', async () => {
    const legacy = memorySyncStorage();
    persistAutosave(makeState(), 'legacy-proj', legacy);
    legacy.setItem(AUTOSAVE_MIGRATION_KEY, '1');
    const target = memoryAsyncStorage();
    const result = await migrateLegacyAutosave(legacy, target);
    expect(result.skipped).toBe(true);
    expect(await target.getItem(AUTOSAVE_STORAGE_KEY)).toBeNull();
  });

  it('无旧数据时跳过但仍写标记，避免重复探测', async () => {
    const legacy = memorySyncStorage();
    const target = memoryAsyncStorage();
    const result = await migrateLegacyAutosave(legacy, target);
    expect(result.skipped).toBe(true);
    expect(legacy.getItem(AUTOSAVE_MIGRATION_KEY)).toBe('1');
    expect(await target.getItem(AUTOSAVE_STORAGE_KEY)).toBeNull();
  });

  it('旧数据损坏时不迁移，防止污染新后端', async () => {
    const legacy = memorySyncStorage();
    legacy.setItem(AUTOSAVE_STORAGE_KEY, '{broken');
    const target = memoryAsyncStorage();
    const result = await migrateLegacyAutosave(legacy, target);
    expect(result.skipped).toBe(true);
    expect(await target.getItem(AUTOSAVE_STORAGE_KEY)).toBeNull();
    expect(legacy.getItem(AUTOSAVE_MIGRATION_KEY)).toBe('1');
  });

  it('目标写入失败时不写标记，保留下次重试机会', async () => {
    const legacy = memorySyncStorage();
    persistAutosave(makeState(), 'legacy-proj', legacy);
    const result = await migrateLegacyAutosave(legacy, failingAsyncStorage());
    expect(result.migrated).toBe(false);
    expect(result.error).toContain('QUOTA_EXCEEDED');
    expect(legacy.getItem(AUTOSAVE_MIGRATION_KEY)).toBeNull();
  });

  it('缺少旧存储或标记存储时安全跳过', async () => {
    const target = memoryAsyncStorage();
    expect((await migrateLegacyAutosave(null, target)).skipped).toBe(true);
    const legacy = memorySyncStorage();
    persistAutosave(makeState(), 'legacy-proj', legacy);
    expect((await migrateLegacyAutosave(legacy, target, null)).skipped).toBe(true);
  });

  it('默认本地存储工厂返回可注入实现', () => {
    // Node 环境可能没有 localStorage，工厂必须返回 null 或具备三个方法，不能抛错。
    const storage = defaultAutosaveStorage();
    if (storage) {
      expect(typeof storage.getItem).toBe('function');
      expect(typeof storage.setItem).toBe('function');
      expect(typeof storage.removeItem).toBe('function');
    } else {
      expect(storage).toBeNull();
    }
  });
});
