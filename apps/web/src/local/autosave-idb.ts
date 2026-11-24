/**
 * U-03：自动保存的 IndexedDB 后端与 localStorage 一次性迁移。
 *
 * 职责边界：
 * - 这里只负责「介质」：建库、读写、迁移原始字符串；
 * - schema 校验与信封结构仍由 project-autosave.ts 统一负责，两条读写路径共用；
 * - IndexedDB 不可用或事务失败时降级到 localStorage，不阻断编辑；
 * - 迁移标记写在 localStorage，成功后不重复搬运旧数据。
 */

import {
  AUTOSAVE_STORAGE_KEY,
  defaultAutosaveStorage,
  type AsyncAutosaveStorage,
  type AutosaveStorage,
} from './project-autosave';

/** IndexedDB 数据库名（版本升级时递增并在此集中维护）。 */
const AUTOSAVE_DB_NAME = 'opencut-autosave';
const AUTOSAVE_DB_VERSION = 1;
const AUTOSAVE_STORE_NAME = 'entries';

/** 迁移完成标记键：写在旧介质（localStorage），避免每次启动重复迁移。 */
export const AUTOSAVE_MIGRATION_KEY = 'opencut-autosave-migrated-v1';
/** 迁移标记值。 */
const MIGRATION_DONE = '1';

/**
 * 打开（或首次建库）自动保存数据库；任何失败都以 Promise reject 上抛，由复合后端降级。
 * @returns {Promise<IDBDatabase>} 打开的数据库
 */
function openAutosaveDb(): Promise<IDBDatabase> {
  return new Promise<IDBDatabase>((resolve, reject) => {
    try {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('INDEXEDDB_UNAVAILABLE'));
        return;
      }
      const request = indexedDB.open(AUTOSAVE_DB_NAME, AUTOSAVE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(AUTOSAVE_STORE_NAME)) {
          db.createObjectStore(AUTOSAVE_STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('INDEXEDDB_OPEN_FAILED'));
      request.onblocked = () => reject(new Error('INDEXEDDB_BLOCKED'));
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * 执行一次 IDB 事务，等事务 complete 后再 resolve，保证写入真正落盘。
 * @param mode 事务模式
 * @param action 在对象仓上发起请求的函数
 * @returns {Promise<T>} 请求结果
 */
function runTransaction<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openAutosaveDb().then((db) => new Promise<T>((resolve, reject) => {
    try {
      const transaction = db.transaction(AUTOSAVE_STORE_NAME, mode);
      const request = action(transaction.objectStore(AUTOSAVE_STORE_NAME));
      // definite assignment：readwrite 的 put/delete 结果未被读取，但事务 complete 时请求已成功。
      let result!: T;
      request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => { db.close(); resolve(result); };
      transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('INDEXEDDB_TX_FAILED')); };
      transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('INDEXEDDB_TX_ABORTED')); };
    } catch (error) {
      db.close();
      reject(error);
    }
  }));
}

/**
 * 纯 IndexedDB 后端；失败时抛错，由 defaultAutosaveBackend 统一降级。
 * @returns {AsyncAutosaveStorage} 异步存储后端
 */
export function indexedDbAutosaveStorage(): AsyncAutosaveStorage {
  return {
    async getItem(key) {
      const value = await runTransaction<string | undefined>('readonly', (store) => store.get(key));
      return value ?? null;
    },
    async setItem(key, value) {
      await runTransaction('readwrite', (store) => store.put(value, key));
    },
    async removeItem(key) {
      await runTransaction('readwrite', (store) => store.delete(key));
    },
  };
}

/**
 * 默认异步后端：IndexedDB 优先，任何失败降级到 localStorage（若可用）。
 * @param fallback 降级用的同步存储，缺省取浏览器 localStorage
 * @returns {AsyncAutosaveStorage} 带降级的异步存储后端
 */
export function defaultAutosaveBackend(
  fallback: AutosaveStorage | null = defaultAutosaveStorage(),
): AsyncAutosaveStorage {
  const idb = indexedDbAutosaveStorage();
  return {
    async getItem(key) {
      try {
        return await idb.getItem(key);
      } catch {
        return fallback?.getItem(key) ?? null;
      }
    },
    async setItem(key, value) {
      try {
        await idb.setItem(key, value);
      } catch {
        fallback?.setItem(key, value);
      }
    },
    async removeItem(key) {
      try {
        await idb.removeItem(key);
      } catch {
        fallback?.removeItem(key);
      }
    },
  };
}

/** 迁移结果：migrated 表示本次真的搬了数据，skipped 表示无需迁移。 */
export interface AutosaveMigrationResult {
  migrated: boolean
  skipped: boolean
  /** 迁移失败原因（不抛给调用方，便于诊断，不写标记以便下次重试）。 */
  error?: string
}

/**
 * localStorage → IndexedDB 一次性迁移。
 * 只搬运原始字符串（键不变），不解析业务字段，避免与 schema 校验耦合；
 * 仅基本结构合法（可解析且有 projectKey/state）才搬运，损坏旧数据不迁移。
 * @param legacy 旧同步存储（localStorage）
 * @param target 新异步存储（IndexedDB）
 * @param flagStorage 迁移标记存储，缺省与 legacy 相同
 * @returns {Promise<AutosaveMigrationResult>} 迁移结果
 */
export async function migrateLegacyAutosave(
  legacy: AutosaveStorage | null,
  target: AsyncAutosaveStorage,
  flagStorage: AutosaveStorage | null = legacy,
): Promise<AutosaveMigrationResult> {
  if (!legacy || !flagStorage) return { migrated: false, skipped: true };
  try {
    if (flagStorage.getItem(AUTOSAVE_MIGRATION_KEY) === MIGRATION_DONE) {
      return { migrated: false, skipped: true };
    }
    const raw = legacy.getItem(AUTOSAVE_STORAGE_KEY);
    if (!raw) {
      // 没有旧数据也写标记，避免每次启动都重复探测。
      flagStorage.setItem(AUTOSAVE_MIGRATION_KEY, MIGRATION_DONE);
      return { migrated: false, skipped: true };
    }
    let parsed: { projectKey?: unknown; state?: unknown } | null = null;
    try {
      parsed = JSON.parse(raw) as { projectKey?: unknown; state?: unknown };
    } catch {
      // 旧数据已损坏，丢弃并写标记，避免每次启动反复解析。
      flagStorage.setItem(AUTOSAVE_MIGRATION_KEY, MIGRATION_DONE);
      return { migrated: false, skipped: true };
    }
    if (!parsed || typeof parsed.projectKey !== 'string' || !parsed.state) {
      flagStorage.setItem(AUTOSAVE_MIGRATION_KEY, MIGRATION_DONE);
      return { migrated: false, skipped: true };
    }
    await target.setItem(AUTOSAVE_STORAGE_KEY, raw);
    flagStorage.setItem(AUTOSAVE_MIGRATION_KEY, MIGRATION_DONE);
    return { migrated: true, skipped: false };
  } catch (error) {
    // 不写标记，下次启动可重试；不抛给调用方，避免阻断编辑。
    return { migrated: false, skipped: false, error: error instanceof Error ? error.message : String(error) };
  }
}
