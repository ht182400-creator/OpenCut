/**
 * 经典版 UI 同步第三批：项目快照（保存 / 加载当前剪辑决策）。
 *
 * 与经典版项目 JSON、OTIO 交换格式互不替代：快照是 OpenCut 自身的轻量工作区格式，
 * 只保存可编辑片段与时间基准，方便中断后原样恢复。所有函数都是纯函数，可单测。
 */

export const SNAPSHOT_FORMAT = 'opencut-snapshot';
export const SNAPSHOT_VERSION = 1;

/** 快照里的片段字段（只保留可编辑决策，不持久化媒体二进制）。 */
export interface SnapshotElement {
  id: string;
  startTime: number;
  duration: number;
  trimStart: number;
  trimEnd: number;
}

export interface ProjectSnapshot {
  format: typeof SNAPSHOT_FORMAT;
  version: number;
  name: string;
  fps: number;
  ticksPerFrame: number;
  ticksPerSecond: number;
  frameCount: number;
  elements: SnapshotElement[];
  savedAt: string;
}

export interface SnapshotInput {
  name: string;
  fps: number;
  ticksPerFrame: number;
  ticksPerSecond: number;
  frameCount: number;
  /** 结构类型兼容：运行时的 CoreElement 带额外字段，构造时会被裁掉。 */
  elements: ReadonlyArray<SnapshotElement>;
  savedAt?: string;
}

/** 稳定错误码，供 UI 显示中文提示。 */
export type SnapshotError =
  | 'INVALID_JSON'
  | 'UNSUPPORTED_FORMAT'
  | 'UNSUPPORTED_VERSION'
  | 'INVALID_ELEMENTS'
  | 'EMPTY_PROJECT';

export type ParseSnapshotResult =
  | { ok: true; snapshot: ProjectSnapshot }
  | { ok: false; error: SnapshotError };

/**
 * 由当前工作区构造快照（丢弃片段上的额外字段，避免把运行时状态写进文件）。
 * @param input 工作区数据
 * @returns {ProjectSnapshot} 快照
 */
export function createSnapshot(input: SnapshotInput): ProjectSnapshot {
  return {
    format: SNAPSHOT_FORMAT,
    version: SNAPSHOT_VERSION,
    name: input.name,
    fps: input.fps,
    ticksPerFrame: input.ticksPerFrame,
    ticksPerSecond: input.ticksPerSecond,
    frameCount: input.frameCount,
    elements: input.elements.map((element) => ({
      id: element.id,
      startTime: element.startTime,
      duration: element.duration,
      trimStart: element.trimStart,
      trimEnd: element.trimEnd,
    })),
    savedAt: input.savedAt ?? new Date(0).toISOString(),
  };
}

/** 序列化为可下载 JSON 文本。 */
export function snapshotToJson(snapshot: ProjectSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}

function validNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * 解析并校验快照文本；任何异常都返回稳定错误码，不抛异常。
 * @param text 快照 JSON 文本
 * @returns {ParseSnapshotResult} 成功给快照，失败给错误码
 */
export function parseSnapshot(text: string): ParseSnapshotResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'INVALID_JSON' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'INVALID_JSON' };
  const value = raw as Record<string, unknown>;
  if (value.format !== SNAPSHOT_FORMAT) return { ok: false, error: 'UNSUPPORTED_FORMAT' };
  if (value.version !== SNAPSHOT_VERSION) return { ok: false, error: 'UNSUPPORTED_VERSION' };
  if (!Array.isArray(value.elements)) return { ok: false, error: 'INVALID_ELEMENTS' };
  if (value.elements.length === 0) return { ok: false, error: 'EMPTY_PROJECT' };
  const elements: SnapshotElement[] = [];
  for (const item of value.elements) {
    if (!item || typeof item !== 'object') return { ok: false, error: 'INVALID_ELEMENTS' };
    const element = item as Record<string, unknown>;
    if (
      typeof element.id !== 'string' ||
      !validNumber(element.startTime) ||
      !validNumber(element.duration) ||
      !validNumber(element.trimStart) ||
      !validNumber(element.trimEnd)
    ) {
      return { ok: false, error: 'INVALID_ELEMENTS' };
    }
    elements.push({
      id: element.id,
      startTime: element.startTime,
      duration: element.duration,
      trimStart: element.trimStart,
      trimEnd: element.trimEnd,
    });
  }
  return {
    ok: true,
    snapshot: {
      format: SNAPSHOT_FORMAT,
      version: SNAPSHOT_VERSION,
      name: typeof value.name === 'string' ? value.name : '未命名项目',
      fps: validNumber(value.fps) ? value.fps : 30,
      ticksPerFrame: validNumber(value.ticksPerFrame) ? value.ticksPerFrame : 4000,
      ticksPerSecond: validNumber(value.ticksPerSecond) ? value.ticksPerSecond : 120000,
      frameCount: validNumber(value.frameCount) ? value.frameCount : 1,
      elements,
      savedAt: typeof value.savedAt === 'string' ? value.savedAt : '',
    },
  };
}
