/**
 * 编辑器版本快照（W-09 第三批 / M6 起步，U-02 扩为编辑器快照）：
 * 记录每次编辑后的片段、书签、轨道标志、选中态与 ripple 调整，支持撤销/重做与回溯。
 *
 * 纯函数层（createHistory / pushSnapshot / moveHistory / canUndo / canRedo）不依赖 React，
 * 便于单测；`useClipHistory` 在其上封装状态、快捷键与恢复回调。
 * 快照保存深拷贝，编辑后的对象变化不会污染历史；旧持久化条目缺新增字段时按空值归一化。
 */

import { useEffect, useRef, useState } from 'react';

import type { RippleAdjustment } from './editor-ui';
import type { BookmarkState, TrackFlagsState } from './project-autosave';
import type { TimelineClip } from './timeline';

/**
 * 一次编辑后需要随撤销/重做一起恢复的编辑器状态。
 * clips 之外的字段由调用方通过 getter 提供，避免改动所有 record 调用方的签名。
 */
export interface EditorSnapshotState {
  clips: TimelineClip[];
  bookmarks: BookmarkState[];
  trackFlags: TrackFlagsState;
  selectedId: string | null;
  adjustments: RippleAdjustment[];
}

/** 调用方提供的编辑器侧状态（clips 由 record 参数单独传入）。 */
export type HistoryParts = Omit<EditorSnapshotState, 'clips'>;

/** 一次编辑后的不可变编辑器快照（保留旧类型名以兼容既有调用方）。 */
export interface TimelineSnapshot extends EditorSnapshotState {
  id: number;
  label: string;
  at: number;
}

/** 历史状态：entries 按时间顺序，index 指向当前生效的快照。 */
export interface HistoryState {
  entries: TimelineSnapshot[];
  index: number;
}

/** 最多保留的快照数，避免长时间编辑占满内存。 */
export const MAX_HISTORY = 50;

/** 缺省编辑器侧状态；无编辑器上下文（单测/初始态）时使用。 */
export const EMPTY_HISTORY_PARTS: HistoryParts = {
  bookmarks: [], trackFlags: { muted: [], hidden: [] }, selectedId: null, adjustments: [],
};

/** 复制片段集合，避免后续编辑改动历史条目。 */
function cloneClips(clips: TimelineClip[]): TimelineClip[] {
  return clips.map((clip) => ({ ...clip }));
}

/**
 * 深拷贝编辑器状态，保证恢复后的对象修改不污染历史条目。
 * @param state 编辑器状态
 * @returns {EditorSnapshotState} 深拷贝副本
 */
function cloneSnapshotState(state: EditorSnapshotState): EditorSnapshotState {
  return {
    clips: cloneClips(state.clips),
    bookmarks: state.bookmarks.map((bookmark) => ({ ...bookmark })),
    trackFlags: { muted: [...state.trackFlags.muted], hidden: [...state.trackFlags.hidden] },
    selectedId: state.selectedId,
    adjustments: state.adjustments.map((adjustment) => ({ ...adjustment })),
  };
}

/**
 * 归一化历史条目：旧格式只有 clips（或字段损坏）时给空值，保持 additive-only 兼容。
 * @param raw 可能是旧格式的原始条目
 * @returns {EditorSnapshotState} 字段齐全的编辑器状态
 */
function normalizeSnapshotState(raw: Partial<EditorSnapshotState> | undefined): EditorSnapshotState {
  const source = raw ?? {};
  const flags = source.trackFlags;
  return {
    clips: Array.isArray(source.clips) ? cloneClips(source.clips) : [],
    bookmarks: Array.isArray(source.bookmarks) ? source.bookmarks.map((bookmark) => ({ ...bookmark })) : [],
    trackFlags: {
      muted: Array.isArray(flags?.muted) ? [...flags.muted] : [],
      hidden: Array.isArray(flags?.hidden) ? [...flags.hidden] : [],
    },
    selectedId: typeof source.selectedId === 'string' ? source.selectedId : null,
    adjustments: Array.isArray(source.adjustments) ? source.adjustments.map((adjustment) => ({ ...adjustment })) : [],
  };
}

/**
 * 建立只含一条初始快照的历史（用于加载项目时重置）。
 * @param clips 初始片段
 * @param label 快照说明
 * @param parts 编辑器侧状态（缺省给空值，兼容旧调用）
 * @returns {HistoryState} 历史状态
 */
export function createHistory(
  clips: TimelineClip[],
  label = '初始时间轴',
  parts: Partial<HistoryParts> = {},
): HistoryState {
  const state = normalizeSnapshotState({ ...parts, clips });
  return { entries: [{ id: 0, label, at: 0, ...state }], index: 0 };
}

/**
 * 记录一次编辑：丢弃当前位置之后的 redo 分支，追加新快照并裁剪到容量上限。
 * 未显式传入的编辑器侧状态继承上一条快照，保证片段动作也携带完整现场。
 * @param state 当前历史
 * @param clips 编辑后的片段
 * @param label 动作说明
 * @param parts 本次动作改变的编辑器侧状态（覆盖继承值）
 * @returns {HistoryState} 新历史
 */
export function pushSnapshot(
  state: HistoryState,
  clips: TimelineClip[],
  label: string,
  parts: Partial<HistoryParts> = {},
): HistoryState {
  const kept = state.entries.slice(0, state.index + 1);
  const previous = kept[kept.length - 1];
  const snapshot = normalizeSnapshotState({ ...previous, ...parts, clips });
  const entry: TimelineSnapshot = {
    id: (previous?.id ?? -1) + 1,
    label,
    at: Date.now(),
    ...snapshot,
  };
  const entries = [...kept, entry].slice(-MAX_HISTORY);
  return { entries, index: entries.length - 1 };
}

/** 历史移动结果：clips 保留旧字段兼容既有调用，snapshot 为完整编辑器状态。 */
export interface HistoryMoveResult {
  state: HistoryState;
  clips: TimelineClip[] | null;
  snapshot: EditorSnapshotState | null;
}

/**
 * 在历史中前后移动；到头/到尾时返回 null 且不改变状态。
 * @param state 当前历史
 * @param delta -1 撤销 / +1 重做
 * @returns {HistoryMoveResult} 新状态、片段（兼容字段）与完整编辑器快照
 */
export function moveHistory(state: HistoryState, delta: -1 | 1): HistoryMoveResult {
  const index = state.index + delta;
  if (index < 0 || index >= state.entries.length) {
    return { state, clips: null, snapshot: null };
  }
  const entry = state.entries[index];
  return {
    state: { ...state, index },
    clips: cloneClips(entry.clips),
    snapshot: cloneSnapshotState(entry),
  };
}

/** 是否可撤销。 */
export function canUndo(state: HistoryState): boolean {
  return state.index > 0;
}

/** 是否可重做。 */
export function canRedo(state: HistoryState): boolean {
  return state.index < state.entries.length - 1;
}

/**
 * 历史摘要，用于界面显示。
 * @param state 当前历史
 * @returns {string} 形如「3 / 5 步 · 当前：删除选中片段」
 */
export function historyLabel(state: HistoryState): string {
  const current = state.entries[state.index];
  return `${state.index + 1} / ${state.entries.length} 步 · 当前：${current?.label ?? '—'}`;
}

/** 持久化键；仅保存片段集合，体积小，用 localStorage 即可。 */
export const HISTORY_STORAGE_KEY = 'opencut-clip-history-v1';

/** 可注入的存储后端，便于单测与隐私模式降级。 */
export interface HistoryStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 带项目标识的持久化内容。 */
export interface PersistedHistory {
  projectKey: string;
  state: HistoryState;
}

/** 选择默认存储；不可用时返回 null（所有持久化静默降级）。 */
export function defaultHistoryStorage(): HistoryStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/**
 * 写入历史；失败返回 false（配额/隐私模式不阻断编辑）。
 * @param state 历史状态
 * @param projectKey 项目标识
 * @param storage 存储后端
 * @returns {boolean} 是否成功
 */
export function persistHistory(
  state: HistoryState,
  projectKey: string,
  storage: HistoryStorage | null,
): boolean {
  if (!storage || !projectKey) return false;
  try {
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify({ projectKey, state }));
    return true;
  } catch {
    return false;
  }
}

/**
 * 读取并校验持久化历史；损坏或结构不合法时返回 null。
 * 旧条目缺新增字段（书签/轨道标志/选中态/adjustments）时按空值归一化。
 * @param storage 存储后端
 * @returns {PersistedHistory | null} 持久化内容
 */
export function readPersistedHistory(storage: HistoryStorage | null): PersistedHistory | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedHistory;
    const entries = parsed?.state?.entries;
    if (!parsed?.projectKey || !Array.isArray(entries) || entries.length === 0) return null;
    const { index } = parsed.state;
    if (!Number.isInteger(index) || index < 0 || index >= entries.length) return null;
    const normalized = entries.map((entry, position) => ({
      id: typeof entry?.id === 'number' ? entry.id : position,
      label: typeof entry?.label === 'string' ? entry.label : '',
      at: typeof entry?.at === 'number' ? entry.at : 0,
      ...normalizeSnapshotState(entry),
    }));
    return { projectKey: parsed.projectKey, state: { entries: normalized, index } };
  } catch {
    return null;
  }
}

/**
 * 当项目标识匹配时，取出当前指针指向的片段集合（副本）。
 * @param persisted 持久化内容
 * @param projectKey 当前项目标识
 * @returns {TimelineClip[] | null} 需要恢复的片段
 */
export function restoreProjectClips(
  persisted: PersistedHistory | null,
  projectKey: string,
): TimelineClip[] | null {
  if (!persisted || persisted.projectKey !== projectKey) return null;
  return cloneClips(persisted.state.entries[persisted.state.index].clips);
}

/**
 * 当项目标识匹配时，取出当前指针指向的完整编辑器快照（副本）。
 * @param persisted 持久化内容
 * @param projectKey 当前项目标识
 * @returns {EditorSnapshotState | null} 需要恢复的编辑器状态
 */
export function restoreProjectSnapshot(
  persisted: PersistedHistory | null,
  projectKey: string,
): EditorSnapshotState | null {
  if (!persisted || persisted.projectKey !== projectKey) return null;
  return cloneSnapshotState(persisted.state.entries[persisted.state.index]);
}

/**
 * 编辑器侧的历史 hook：提供记录、重置、撤销/重做与 Ctrl/Cmd+Z 快捷键。
 * 恢复的完整快照通过 `onRestore` 交回编辑器重新应用书签/轨道标志/帧计划。
 * @param onRestore 恢复回调（接收完整编辑器快照）
 * @param getParts 读取当前编辑器侧状态的 getter（避免改动所有 record 调用方）
 * @returns {object} 历史状态与操作
 */
export function useClipHistory(
  onRestore: (snapshot: EditorSnapshotState) => void,
  getParts: () => HistoryParts = () => EMPTY_HISTORY_PARTS,
) {
  const [state, setState] = useState<HistoryState>(
    () => readPersistedHistory(defaultHistoryStorage())?.state ?? createHistory([]),
  );
  const stateRef = useRef(state);
  const restoreRef = useRef(onRestore);
  const partsRef = useRef(getParts);
  const projectKeyRef = useRef('');
  const storageRef = useRef(defaultHistoryStorage());
  stateRef.current = state;
  restoreRef.current = onRestore;
  partsRef.current = getParts;

  /** 每次历史变化写回本地存储；项目尚未加载时不写，避免覆盖其他项目的历史。 */
  useEffect(() => {
    if (projectKeyRef.current) {
      persistHistory(state, projectKeyRef.current, storageRef.current);
    }
  }, [state]);

  /**
   * 记录一次编辑后的快照。
   * @param clips 编辑后的片段
   * @param label 动作说明
   * @param parts 本次动作改变的编辑器侧状态（覆盖 getter 读到的当前值）
   */
  const record = (clips: TimelineClip[], label: string, parts?: Partial<HistoryParts>) => {
    const current = partsRef.current();
    const merged = parts ? { ...current, ...parts } : current;
    setState((previous) => pushSnapshot(previous, clips, label, merged));
  };

  /** 加载项目：同项目则恢复持久化历史，否则新建；返回要恢复的编辑器快照。 */
  const reset = (clips: TimelineClip[], label: string, projectKey: string): EditorSnapshotState | null => {
    projectKeyRef.current = projectKey;
    const storage = storageRef.current;
    const persisted = readPersistedHistory(storage);
    const restored = restoreProjectSnapshot(persisted, projectKey);
    if (restored && persisted) {
      setState(persisted.state);
      persistHistory(persisted.state, projectKey, storage);
      // 项目刚加载，片段以项目基线为准，其余编辑器状态沿用历史。
      return { ...restored, clips: cloneClips(clips) };
    }
    const fresh = createHistory(clips, label, partsRef.current());
    setState(fresh);
    persistHistory(fresh, projectKey, storage);
    return null;
  };

  /** 在历史中移动并把恢复的完整快照交给编辑器。 */
  const travel = (delta: -1 | 1) => {
    const result = moveHistory(stateRef.current, delta);
    if (result.snapshot) {
      setState(result.state);
      restoreRef.current(result.snapshot);
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      event.preventDefault();
      travel(event.shiftKey ? 1 : -1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return {
    state,
    record,
    reset,
    undo: () => travel(-1),
    redo: () => travel(1),
    canUndo: canUndo(state),
    canRedo: canRedo(state),
    label: historyLabel(state),
  };
}
