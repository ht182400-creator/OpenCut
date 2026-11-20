/**
 * P0 本地自动保存：把当前编辑状态（元素、时间轴、分辨率等）防抖写入 localStorage，
 * 刷新页面后自动恢复，做到「刷新不丢」。
 *
 * 设计约束（与 clip-history.ts 对齐）：
 * - 存储后端可注入，便于 Node 单测覆盖读/写/损坏/配额异常分支；
 * - localStorage 不可用（隐私模式/配额）时静默降级，不阻断编辑；
 * - 按项目标识隔离，避免不同项目互相覆盖；
 * - schema 带版本号，结构不合法整体作废。
 */

import type { CoreElement } from './editor-ui';
import type { RippleAdjustment } from './editor-ui';
import type { ResolutionPreset } from './resolution';

/** 自动保存存储键（带版本，升级时可整体失效）。 */
export const AUTOSAVE_STORAGE_KEY = 'opencut-autosave-v1';
/** 当前 schema 版本；结构升级时递增，旧数据作废。 */
export const AUTOSAVE_SCHEMA_VERSION = 1;
/** 防抖时长（毫秒）：每次编辑后等待多久落盘。 */
export const AUTOSAVE_DEBOUNCE_MS = 800;

/** 可注入的存储后端（与 HistoryStorage 同构）。 */
export interface AutosaveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 落盘的编辑状态。 */
/** 轨道标志（P4 批 6）：trackId → 静音/隐藏，仅本地 autosave 持久化。 */
export interface TrackFlagsState {
  muted: string[]
  hidden: string[]
}

/** 书签（P4 批 6）：本地 autosave 持久化，不写回经典版 JSON（core 无字段）。 */
export interface BookmarkState {
  id: string
  ticks: number
  name: string
}

export interface AutosaveState {
  elements: CoreElement[];
  frameIndex: number;
  selectedId: string | null;
  adjustments: RippleAdjustment[];
  resolution: ResolutionPreset;
  sourceName: string;
  /** P4 批 6：轨道静音/隐藏（可选，旧 autosave 无此字段也能读）。 */
  trackFlags?: TrackFlagsState
  /** P4 批 6：书签（可选）。 */
  bookmarks?: BookmarkState[]
}

/** 持久化信封：schema 版本 + 项目标识 + 状态。 */
export interface PersistedAutosave {
  version: number;
  projectKey: string;
  savedAt: string;
  state: AutosaveState;
}

/** 选择默认存储；不可用时返回 null（所有自动保存静默降级）。 */
export function defaultAutosaveStorage(): AutosaveStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 校验恢复出来的元素结构是否合法（防止损坏 JSON 污染时间轴）。
 * @param value 待校验值
 * @returns {boolean} 是否合法
 */
function isValidElement(value: unknown): value is CoreElement {
  if (!value || typeof value !== 'object') return false;
  const element = value as Record<string, unknown>;
  return typeof element.id === 'string'
    && Number.isFinite(element.startTime)
    && Number.isFinite(element.duration)
    && Number.isFinite(element.trimStart);
}

/**
 * 读取并校验持久化状态；版本不符/项目不匹配/结构损坏时返回 null。
 * @param storage 存储后端
 * @param projectKey 当前项目标识
 * @returns {PersistedAutosave | null} 合法持久化内容
 */
export function readAutosave(
  storage: AutosaveStorage | null,
  projectKey: string,
): PersistedAutosave | null {
  if (!storage || !projectKey) return null;
  try {
    const raw = storage.getItem(AUTOSAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedAutosave;
    if (parsed?.version !== AUTOSAVE_SCHEMA_VERSION || parsed?.projectKey !== projectKey) return null;
    const state = parsed.state;
    if (!state || !Array.isArray(state.elements) || !state.elements.every(isValidElement)) return null;
    if (!Number.isFinite(state.frameIndex) || !state.resolution) return null;
    if (!Array.isArray(state.adjustments)) return null;
    // P4 批 6：可选字段若存在必须结构合法，否则整体作废（防止损坏数据污染）。
    if (state.trackFlags !== undefined) {
      const flags = state.trackFlags as TrackFlagsState;
      if (!flags || !Array.isArray(flags.muted) || !flags.muted.every((id) => typeof id === 'string')
        || !Array.isArray(flags.hidden) || !flags.hidden.every((id) => typeof id === 'string')) return null;
    }
    if (state.bookmarks !== undefined) {
      if (!Array.isArray(state.bookmarks) || !state.bookmarks.every((b) =>
        b && typeof b.id === 'string' && Number.isFinite(b.ticks) && typeof b.name === 'string')) return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/**
 * 写入自动保存；失败返回 false（配额/隐私模式不阻断编辑）。
 * @param state 当前编辑状态
 * @param projectKey 项目标识
 * @param storage 存储后端
 * @param savedAt ISO 时间戳（可注入便于单测）
 * @returns {boolean} 是否写入成功
 */
export function persistAutosave(
  state: AutosaveState,
  projectKey: string,
  storage: AutosaveStorage | null,
  savedAt: string = new Date().toISOString(),
): boolean {
  if (!storage || !projectKey) return false;
  try {
    const envelope: PersistedAutosave = {
      version: AUTOSAVE_SCHEMA_VERSION,
      projectKey,
      savedAt,
      state,
    };
    storage.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(envelope));
    return true;
  } catch {
    return false;
  }
}

/**
 * 清除当前项目的自动保存（如用户主动加载项目 JSON 时避免旧状态覆盖）。
 * @param storage 存储后端
 * @returns {boolean} 是否清除成功
 */
export function clearAutosave(storage: AutosaveStorage | null): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(AUTOSAVE_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
