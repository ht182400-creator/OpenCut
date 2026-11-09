/**
 * 代理帧持久化（W-09 第二批）：把代理 RGBA 帧与 PCM 存入 IndexedDB，跨刷新复用。
 *
 * 所有操作都静默降级：隐私模式、配额超限或 IndexedDB 不可用时返回 null / false，
 * 主流程自动退回「纯内存 LRU + 重新解码」，绝不阻断导入。
 * 存储后端可注入，便于 Node 单测用内存实现覆盖读写/异常分支。
 */

import { cachedMediaBytes, type CachedMedia } from './frame-cache';

/** 持久化 schema 版本；升级时旧记录整体失效。 */
export const FRAME_STORE_SCHEMA_VERSION = 1;
export const FRAME_STORE_DB_NAME = 'opencut-proxy-frames';
export const FRAME_STORE_NAME = 'frames';

/** 一条持久化记录。 */
export interface PersistedEntry {
  key: string;
  value: CachedMedia;
  savedAt: number;
  bytes: number;
}

/** 持久化统计。 */
export interface FrameStoreStats {
  entries: number;
  bytes: number;
}

/** 可注入的存储后端。 */
export interface FrameStoreBackend {
  get(key: string): Promise<PersistedEntry | null>;
  put(entry: PersistedEntry): Promise<void>;
  clear(): Promise<void>;
  stats(): Promise<FrameStoreStats>;
}

/** 内存后端：单测与 IndexedDB 不可用时的降级实现。 */
export class MemoryFrameStore implements FrameStoreBackend {
  private readonly entries = new Map<string, PersistedEntry>();

  async get(key: string): Promise<PersistedEntry | null> {
    return this.entries.get(key) ?? null;
  }

  async put(entry: PersistedEntry): Promise<void> {
    this.entries.set(entry.key, entry);
  }

  async clear(): Promise<void> {
    this.entries.clear();
  }

  async stats(): Promise<FrameStoreStats> {
    let bytes = 0;
    for (const entry of this.entries.values()) bytes += entry.bytes;
    return { entries: this.entries.size, bytes };
  }
}

interface DatabaseScope {
  indexedDB?: IDBFactory;
}

/** 打开（或创建）持久化数据库。 */
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const factory = (globalThis as unknown as DatabaseScope).indexedDB;
    if (!factory) {
      reject(new Error('IndexedDB 不可用'));
      return;
    }
    const request = factory.open(FRAME_STORE_DB_NAME, FRAME_STORE_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(FRAME_STORE_NAME)) {
        database.createObjectStore(FRAME_STORE_NAME, { keyPath: 'key' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
  });
}

/** 在单个事务里执行一个 object store 请求。 */
async function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(FRAME_STORE_NAME, mode);
      const request = run(transaction.objectStore(FRAME_STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 操作失败'));
    });
  } finally {
    database.close();
  }
}

/** 基于 IndexedDB 的存储后端。 */
export class IndexedDbFrameStore implements FrameStoreBackend {
  async get(key: string): Promise<PersistedEntry | null> {
    const entry = await withStore<PersistedEntry | undefined>(
      'readonly',
      (store) => store.get(key) as IDBRequest<PersistedEntry | undefined>,
    );
    return entry ?? null;
  }

  async put(entry: PersistedEntry): Promise<void> {
    await withStore<IDBValidKey>('readwrite', (store) => store.put(entry));
  }

  async clear(): Promise<void> {
    await withStore<undefined>('readwrite', (store) => store.clear() as IDBRequest<undefined>);
  }

  async stats(): Promise<FrameStoreStats> {
    const all = await withStore<PersistedEntry[]>(
      'readonly',
      (store) => store.getAll() as IDBRequest<PersistedEntry[]>,
    );
    return {
      entries: all.length,
      bytes: all.reduce((sum, entry) => sum + entry.bytes, 0),
    };
  }
}

/** 带异常降级的持久化门面。 */
export class FrameStore {
  constructor(private readonly backend: FrameStoreBackend) {}

  /** 读取缓存；失败返回 null。 */
  async load(key: string): Promise<CachedMedia | null> {
    try {
      return (await this.backend.get(key))?.value ?? null;
    } catch {
      return null;
    }
  }

  /** 写入缓存；返回是否成功。 */
  async save(key: string, value: CachedMedia): Promise<boolean> {
    try {
      await this.backend.put({
        key,
        value,
        savedAt: Date.now(),
        bytes: cachedMediaBytes(value),
      });
      return true;
    } catch {
      return false;
    }
  }

  /** 清空全部持久化记录；返回是否成功。 */
  async clear(): Promise<boolean> {
    try {
      await this.backend.clear();
      return true;
    } catch {
      return false;
    }
  }

  /** 读取统计；失败返回零值。 */
  async stats(): Promise<FrameStoreStats> {
    try {
      return await this.backend.stats();
    } catch {
      return { entries: 0, bytes: 0 };
    }
  }
}

/** 选择后端：浏览器有 IndexedDB 则用之，否则退回内存。 */
export function createDefaultBackend(): FrameStoreBackend {
  const factory = (globalThis as unknown as DatabaseScope).indexedDB;
  return factory ? new IndexedDbFrameStore() : new MemoryFrameStore();
}

/** 全页面共享的持久化实例。 */
export const frameStore = new FrameStore(createDefaultBackend());
