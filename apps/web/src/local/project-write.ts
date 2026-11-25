/**
 * 项目格式写回接线（批 7.5）：把 UI 编辑的元素字段合并进 `ProjectView`，
 * 经 I-01 适配层调用 core `writeClassicProject` 生成经典版 v31 JSON 并下载。
 *
 * 纯函数（view 合并）与浏览器下载分离，前者可独立单测；
 * core 负责 additive-only 保真（未知字段保留、不新增/删除实体），本模块不直接碰 wasm glue。
 */

import type { EditorAdapter, ProjectView, ProjectTrackView, ProjectWriteResult } from './editor-adapter';
import type { CoreElement } from './editor-ui';
import type { ExtraTrackState } from './project-autosave';

/** 写回时的画布尺寸来源（批 7.2 resolution）。 */
export interface WriteCanvasSize {
  width: number;
  height: number;
}

/** 轨道静音/隐藏状态（第一档：从 autosave state 写回经典版 JSON）。 */
export interface WriteTrackFlags {
  muted: string[];
  hidden: string[];
}

/** 场景书签（第一档：原样透传；note 为可选备注，additive-only）。 */
export interface WriteBookmark {
  id: string;
  ticks: number;
  name: string;
  note?: string;
}

/**
 * U-06/U-07：把 autosave 新增轨转成写回视图轨道（追加到目标场景）。
 * @param track 新增轨状态
 * @param elements 属于该轨的编辑元素（U-07：分割/拖拽新增片段）
 * @returns 写回视图轨道
 */
function toWriteTrackView(
  track: ExtraTrackState,
  elements: readonly CoreElement[] = [],
): ProjectTrackView {
  const owned = elements.filter((element) => element.trackId === track.id);
  return {
    id: track.id,
    trackType: track.trackType,
    elementCount: owned.length,
    elements: owned.map((element) => ({
      id: element.id,
      elementType: element.elementType ?? 'video',
      startTime: element.startTime,
      duration: element.duration,
      trimStart: element.trimStart,
      trimEnd: element.trimEnd ?? element.duration,
      ...(element.name !== undefined ? { name: element.name } : {}),
      ...(element.content !== undefined ? { content: element.content } : {}),
      ...(element.params !== undefined ? { params: element.params } : {}),
    })),
    ...(track.muted !== undefined ? { muted: track.muted } : {}),
    ...(track.hidden !== undefined ? { hidden: track.hidden } : {}),
  };
}

/**
 * 判断编辑集合中是否存在原项目视图里不存在的新元素 id（分割/新增产生）。
 * U-07：新元素写回需显式打开 allowNewTracks 开关（与新增轨同一契约）。
 * @param project 原始项目视图
 * @param elements UI 编辑元素
 * @returns 存在新元素返回 true
 */
export function hasNewElements(
  project: ProjectView,
  elements: readonly CoreElement[],
): boolean {
  const originalIds = new Set(
    project.scenes.flatMap((scene) => scene.tracks.flatMap((track) => track.elements.map((element) => element.id))),
  );
  return elements.some((element) => !originalIds.has(element.id));
}

/**
 * 把编辑元素转成写回视图元素（已有轨的新增元素 U-07 用）。
 * @param element 编辑元素
 * @returns 写回视图元素
 */
function toWriteElement(element: CoreElement) {
  return {
    id: element.id,
    elementType: element.elementType ?? 'video',
    startTime: element.startTime,
    duration: element.duration,
    trimStart: element.trimStart,
    trimEnd: element.trimEnd ?? element.duration,
    ...(element.name !== undefined ? { name: element.name } : {}),
    ...(element.content !== undefined ? { content: element.content } : {}),
    ...(element.params !== undefined ? { params: element.params } : {}),
  };
}

/**
 * 归一化元素所属轨道 id（main 与缺省同轨）。
 * @param element 编辑元素
 * @returns 轨道 id
 */
function elementTrackId(element: CoreElement): string {
  return element.trackId && element.trackId !== 'main' ? element.trackId : 'main';
}

/**
 * 从项目视图读取轨道静音/隐藏标志（第一档：只读，供 UI 初始化）。
 *
 * @param project 归一化项目视图
 * @returns 静音/隐藏轨道 id 列表
 */
export function trackFlagsFromProject(project: ProjectView): WriteTrackFlags {
  const muted: string[] = [];
  const hidden: string[] = [];
  for (const scene of project.scenes) {
    for (const track of scene.tracks) {
      if (track.muted === true) muted.push(track.id);
      if (track.hidden === true) hidden.push(track.id);
    }
  }
  return { muted, hidden };
}

/**
 * 从项目视图读取场景书签（第一档：只接受 `{id,ticks,name}` 结构，损坏数据静默忽略）。
 *
 * @param project 归一化项目视图
 * @returns 合法书签列表
 */
export function bookmarksFromProject(project: ProjectView): WriteBookmark[] {
  for (const scene of project.scenes) {
    if (!Array.isArray(scene.bookmarks)) continue;
    return scene.bookmarks.filter((item): item is WriteBookmark => {
      if (item === null || typeof item !== 'object') return false;
      const value = item as Record<string, unknown>;
      return typeof value.id === 'string'
        && typeof value.ticks === 'number'
        && Number.isFinite(value.ticks)
        && typeof value.name === 'string'
        && (value.note === undefined || typeof value.note === 'string');
    }).map((item) => ({
      id: item.id, ticks: item.ticks, name: item.name,
      ...(typeof item.note === 'string' ? { note: item.note } : {}),
    }));
  }
  return [];
}

/**
 * 把 UI 编辑后的元素字段合并进项目视图，返回新的 ProjectView（不改入参）。
 *
 * 只按 id 覆盖已存在元素的 name/content/时间与 elementType；view 中未携带的字段
 * 保持原值；core 写回时再依据原始 JSON 保留未知字段，形成完整 additive-only 闭环。
 *
 * @param project 原始归一化项目视图
 * @param elements UI 当前可编辑元素（主轨）
 * @param canvas 可选画布尺寸覆盖（分辨率切换后写回）
 * @param trackFlags 可选轨道静音/隐藏状态（第一档）
 * @param bookmarks 可选场景书签（第一档）
 * @param extraTracks 可选新增轨道（U-06，追加到第一个场景）
 * @returns 合并后的新 ProjectView
 */
export function buildWriteView(
  project: ProjectView,
  elements: readonly CoreElement[],
  canvas?: WriteCanvasSize,
  trackFlags?: WriteTrackFlags,
  bookmarks?: readonly WriteBookmark[],
  extraTracks?: readonly ExtraTrackState[],
): ProjectView {
  const edits = new Map(elements.map((element) => [element.id, element]));
  const consumed = new Set<string>();
  const muted = trackFlags ? new Set(trackFlags.muted) : null;
  const hidden = trackFlags ? new Set(trackFlags.hidden) : null;
  return {
    ...project,
    ...(canvas ? { canvas: { width: canvas.width, height: canvas.height } } : {}),
    scenes: project.scenes.map((scene, index) => {
      // U-07：已有轨按 id 覆盖，且编辑元素的 trackId 必须属于该轨。
      const merged: ProjectTrackView[] = scene.tracks.map((track) => {
        const written = track.elements.map((element) => {
          const edit = edits.get(element.id);
          if (!edit || elementTrackId(edit) !== track.id) return element;
          consumed.add(edit.id);
          return {
            ...element,
            startTime: edit.startTime,
            duration: edit.duration,
            trimStart: edit.trimStart,
            trimEnd: edit.trimEnd ?? element.trimEnd,
            ...(edit.name !== undefined ? { name: edit.name } : {}),
            ...(edit.content !== undefined ? { content: edit.content } : {}),
            ...(edit.elementType !== undefined ? { elementType: edit.elementType } : {}),
            // P0：可视参数写回（含 opacity/position/scale/rotate 与文字字段）。
            ...(edit.params !== undefined ? { params: edit.params } : {}),
          };
        });
        // U-07：分割/新增产生的元素 id 在 view 中不存在，按 trackId 追加到对应轨。
        const added = elements
          .filter((element) => !consumed.has(element.id) && elementTrackId(element) === track.id)
          .map((element) => { consumed.add(element.id); return toWriteElement(element); });
        return {
          ...track,
          ...(muted && track.muted !== undefined ? { muted: muted.has(track.id) } : {}),
          ...(hidden && track.hidden !== undefined ? { hidden: hidden.has(track.id) } : {}),
          elements: [...written, ...added],
          elementCount: written.length + added.length,
        };
      });
      // U-06：新增轨追加到第一个场景，U-07：带上其编辑元素。
      if (index === 0 && extraTracks && extraTracks.length > 0) {
        merged.push(...extraTracks.map((track) => toWriteTrackView(track, elements)));
      }
      return {
        ...scene,
        ...(bookmarks !== undefined ? { bookmarks: bookmarks.map((item) => ({ ...item })) } : {}),
        tracks: merged,
      };
    }),
  };
}

/** 写回并下载的结果，供 UI 显示友好状态。 */
export interface SaveProjectResult {
  ok: boolean;
  message: string;
}

/**
 * 把当前编辑写回为经典版项目 JSON 并触发浏览器下载。
 * @param adapter I-01 适配层入口
 * @param originalJson 原始项目 JSON 文本（core 据此保留未知字段）
 * @param view 合并编辑后的项目视图
 * @param filename 下载文件名
 * @param allowNewTracks U-06：是否允许写回新增轨（默认 false 保持 additive-only）
 * @returns 写回结果与中文提示
 */
export function saveProjectJson(
  adapter: EditorAdapter,
  originalJson: string,
  view: ProjectView,
  filename: string,
  allowNewTracks = false,
): SaveProjectResult {
  try {
    const result: ProjectWriteResult = adapter.writeClassicProject(
      originalJson, view, allowNewTracks,
    );
    if (!result.ok || !result.project) {
      return { ok: false, message: `项目写回失败：${result.error ?? '未知错误'}` };
    }
    const blob = new Blob([result.project], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    return { ok: true, message: `项目已写回：${filename}` };
  } catch (error) {
    return { ok: false, message: `项目写回异常：${error instanceof Error ? error.message : String(error)}` };
  }
}
