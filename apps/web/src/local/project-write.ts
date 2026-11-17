/**
 * 项目格式写回接线（批 7.5）：把 UI 编辑的元素字段合并进 `ProjectView`，
 * 经 I-01 适配层调用 core `writeClassicProject` 生成经典版 v31 JSON 并下载。
 *
 * 纯函数（view 合并）与浏览器下载分离，前者可独立单测；
 * core 负责 additive-only 保真（未知字段保留、不新增/删除实体），本模块不直接碰 wasm glue。
 */

import type { EditorAdapter, ProjectView, ProjectWriteResult } from './editor-adapter';
import type { CoreElement } from './editor-ui';

/** 写回时的画布尺寸来源（批 7.2 resolution）。 */
export interface WriteCanvasSize {
  width: number;
  height: number;
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
 * @returns 合并后的新 ProjectView
 */
export function buildWriteView(
  project: ProjectView,
  elements: readonly CoreElement[],
  canvas?: WriteCanvasSize,
): ProjectView {
  const edits = new Map(elements.map((element) => [element.id, element]));
  return {
    ...project,
    ...(canvas ? { canvas: { width: canvas.width, height: canvas.height } } : {}),
    scenes: project.scenes.map((scene) => ({
      ...scene,
      tracks: scene.tracks.map((track) => ({
        ...track,
        elements: track.elements.map((element) => {
          const edit = edits.get(element.id);
          if (!edit) return element;
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
        }),
      })),
    })),
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
 * @returns 写回结果与中文提示
 */
export function saveProjectJson(
  adapter: EditorAdapter,
  originalJson: string,
  view: ProjectView,
  filename: string,
): SaveProjectResult {
  try {
    const result: ProjectWriteResult = adapter.writeClassicProject(originalJson, view);
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
