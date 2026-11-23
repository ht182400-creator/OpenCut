import { describe, expect, it } from 'vitest';

import type { EditorAdapter, ProjectView } from './editor-adapter';
import type { CoreElement } from './editor-ui';
import {
  bookmarksFromProject,
  buildWriteView,
  saveProjectJson,
  trackFlagsFromProject,
} from './project-write';

/** 构造最小项目视图，含一个 main 轨元素。 */
function makeProject(): ProjectView {
  return {
    version: 31,
    projectId: 'p1',
    name: '测试项目',
    durationTicks: 1000,
    fps: { numerator: 30, denominator: 1 },
    canvas: { width: 320, height: 180 },
    currentSceneId: 's1',
    sceneCount: 1,
    scenes: [{
      id: 's1', name: '场景', isMain: true,
      tracks: [{
        id: 'main', trackType: 'video', elementCount: 1,
        elements: [{
          id: 'c1', elementType: 'video', startTime: 0, duration: 100,
          trimStart: 0, trimEnd: 100, name: '原名', mediaId: 'm1',
        }],
      }],
    }],
    warnings: [],
  };
}

/** 构造一个 UI 编辑后的元素。 */
function makeElement(patch: Partial<CoreElement> = {}): CoreElement {
  return {
    id: 'c1', startTime: 200, duration: 300, trimStart: 10, trimEnd: 290,
    name: '新名', content: '新正文', elementType: 'video', ...patch,
  };
}

/** 批 7.5 项目写回接线：view 合并纯函数与下载异常分支。 */
/** 第一档：轨道标志与书签读写闭环（additive-only）。 */
describe('trackFlags / bookmarks 项目视图读写', () => {
  it('从视图读取 muted/hidden 轨道与合法书签', () => {
    const project = makeProject();
    const track = project.scenes[0].tracks[0];
    track.muted = true;
    track.hidden = false;
    project.scenes[0].bookmarks = [
      { id: 'bm-1', ticks: 120000, name: 'Intro' },
      { id: 'bm-bad', ticks: NaN, name: '无效' },
    ];
    expect(trackFlagsFromProject(project)).toEqual({ muted: ['main'], hidden: [] });
    expect(bookmarksFromProject(project)).toEqual([{ id: 'bm-1', ticks: 120000, name: 'Intro' }]);
  });

  it('缺失字段返回空值，不伪造 false', () => {
    const project = makeProject();
    expect(trackFlagsFromProject(project)).toEqual({ muted: [], hidden: [] });
    expect(bookmarksFromProject(project)).toEqual([]);
    const view = buildWriteView(
      project, [], undefined,
      { muted: ['main'], hidden: ['main'] },
      [{ id: 'bm-1', ticks: 0, name: 'A' }],
    );
    // 视图原本无 muted/hidden → additive-only 不新增字段。
    expect(view.scenes[0].tracks[0].muted).toBeUndefined();
    expect(view.scenes[0].tracks[0].hidden).toBeUndefined();
    expect(view.scenes[0].bookmarks).toEqual([{ id: 'bm-1', ticks: 0, name: 'A' }]);
  });

  it('视图已有字段时写回更新后的轨道标志与书签', () => {
    const project = makeProject();
    project.scenes[0].tracks[0].muted = false;
    project.scenes[0].tracks[0].hidden = true;
    project.scenes[0].bookmarks = [];
    const view = buildWriteView(
      project, [], undefined,
      { muted: ['main'], hidden: [] },
      [{ id: 'bm-2', ticks: 42, name: 'B' }],
    );
    expect(view.scenes[0].tracks[0].muted).toBe(true);
    expect(view.scenes[0].tracks[0].hidden).toBe(false);
    expect(view.scenes[0].bookmarks).toEqual([{ id: 'bm-2', ticks: 42, name: 'B' }]);
  });
});

describe('buildWriteView 合并编辑', () => {
  it('按 id 覆盖已存在元素的字段', () => {
    const view = buildWriteView(makeProject(), [makeElement()]);
    const element = view.scenes[0].tracks[0].elements[0];
    expect(element.startTime).toBe(200);
    expect(element.duration).toBe(300);
    expect(element.trimStart).toBe(10);
    expect(element.trimEnd).toBe(290);
    expect(element.name).toBe('新名');
    expect(element.content).toBe('新正文');
  });

  it('保留 view 中未被编辑覆盖的字段（如 mediaId）', () => {
    const view = buildWriteView(makeProject(), [makeElement()]);
    const element = view.scenes[0].tracks[0].elements[0] as ProjectView['scenes'][0]['tracks'][0]['elements'][0] & { mediaId?: string };
    expect(element.mediaId).toBe('m1');
  });

  it('name/content 为 undefined 时不覆盖原值', () => {
    const view = buildWriteView(makeProject(), [makeElement({ name: undefined, content: undefined })]);
    const element = view.scenes[0].tracks[0].elements[0];
    expect(element.name).toBe('原名');
    expect(element.content).toBeUndefined();
  });

  it('canvas 覆盖生效，且未提供时保持原尺寸', () => {
    expect(buildWriteView(makeProject(), [], { width: 1280, height: 720 }).canvas)
      .toEqual({ width: 1280, height: 720 });
    expect(buildWriteView(makeProject(), []).canvas).toEqual({ width: 320, height: 180 });
  });

  it('不修改入参（纯函数）', () => {
    const project = makeProject();
    buildWriteView(project, [makeElement()], { width: 640, height: 360 });
    expect(project.canvas).toEqual({ width: 320, height: 180 });
    expect(project.scenes[0].tracks[0].elements[0].startTime).toBe(0);
  });

  it('无匹配 id 的编辑被忽略', () => {
    const view = buildWriteView(makeProject(), [makeElement({ id: 'unknown' })]);
    expect(view.scenes[0].tracks[0].elements[0].startTime).toBe(0);
  });

  it('边界：空项目场景与空元素列表不抛错', () => {
    const empty: ProjectView = { ...makeProject(), scenes: [] };
    expect(buildWriteView(empty, []).scenes).toEqual([]);
  });
});

/** saveProjectJson 的写回结果与异常分支（Node 无 document，用假 adapter 驱动）。 */
describe('saveProjectJson 写回', () => {
  it('core 返回失败时给出中文提示且不抛错', () => {
    const adapter = {
      writeClassicProject: () => ({ ok: false, error: 'VERSION_MISMATCH' }),
    } as unknown as EditorAdapter;
    const result = saveProjectJson(adapter, '{}', makeProject(), 'out.json');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('VERSION_MISMATCH');
  });

  it('core 抛异常时给出友好提示', () => {
    const adapter = {
      writeClassicProject: () => { throw new Error('boom'); },
    } as unknown as EditorAdapter;
    const result = saveProjectJson(adapter, '{}', makeProject(), 'out.json');
    expect(result.ok).toBe(false);
    expect(result.message).toContain('boom');
  });
});
