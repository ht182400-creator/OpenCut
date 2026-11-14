import { describe, expect, it } from 'vitest';

import { matchShortcut, SHORTCUT_HELP } from './editor-shortcuts';
import {
  DEFAULT_EXPORT_SETTINGS,
  buildExportProfile,
  containerShortName,
  exportFilename,
} from './export-settings';
import {
  SNAPSHOT_FORMAT,
  SNAPSHOT_VERSION,
  createSnapshot,
  parseSnapshot,
  snapshotToJson,
} from './project-snapshot';

const key = (value: string, extra: Record<string, unknown> = {}) =>
  matchShortcut({ key: value, ...extra });

describe('编辑器快捷键（UI 第三批）', () => {
  it('播放与逐帧定位', () => {
    expect(key(' ')).toBe('togglePlay');
    expect(key('Spacebar')).toBe('togglePlay');
    expect(key('ArrowLeft')).toBe('prevFrame');
    expect(key('ArrowRight')).toBe('nextFrame');
    expect(key('Home')).toBe('firstFrame');
    expect(key('End')).toBe('lastFrame');
  });

  it('剪辑动作不区分大小写', () => {
    expect(key('Delete')).toBe('deleteSelected');
    expect(key('Backspace')).toBe('deleteSelected');
    expect(key('s')).toBe('splitAtPlayhead');
    expect(key('S')).toBe('splitAtPlayhead');
    expect(key('i')).toBe('trimIn');
    expect(key('O')).toBe('trimOut');
  });

  it('输入框与修饰键组合不劫持', () => {
    expect(matchShortcut({ key: ' ', target: { tagName: 'INPUT' } })).toBeNull();
    expect(matchShortcut({ key: 's', target: { isContentEditable: true } })).toBeNull();
    expect(key('z', { ctrlKey: true })).toBeNull();
    expect(key('z', { metaKey: true })).toBeNull();
    expect(key('s', { altKey: true })).toBeNull();
  });

  it('未知键返回 null 且帮助文本覆盖既有历史快捷键', () => {
    expect(key('F5')).toBeNull();
    expect(SHORTCUT_HELP).toContain('Ctrl/Cmd+Z');
  });
});

const sampleInput = {
  name: '示例项目',
  fps: 30,
  ticksPerFrame: 4000,
  ticksPerSecond: 120000,
  frameCount: 90,
  savedAt: '2026-11-14T00:00:00.000Z',
  elements: [
    { id: 'clip-intro', startTime: 0, duration: 120000, trimStart: 0, trimEnd: 120000, mediaUrl: 'a.mp4' },
    { id: 'clip-body', startTime: 120000, duration: 240000, trimStart: 5000, trimEnd: 240000 },
  ],
};

describe('项目快照（UI 第三批）', () => {
  it('构造与解析往返一致，且丢弃运行时额外字段', () => {
    const snapshot = createSnapshot(sampleInput);
    expect(snapshot.format).toBe(SNAPSHOT_FORMAT);
    expect(snapshot.version).toBe(SNAPSHOT_VERSION);
    expect(snapshot.savedAt).toBe(sampleInput.savedAt);
    expect(snapshot.elements[0]).not.toHaveProperty('mediaUrl');
    const parsed = parseSnapshot(snapshotToJson(snapshot));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.snapshot).toEqual(snapshot);
  });

  it('非法输入返回稳定错误码', () => {
    expect(parseSnapshot('{ 坏')).toEqual({ ok: false, error: 'INVALID_JSON' });
    expect(parseSnapshot('null')).toEqual({ ok: false, error: 'INVALID_JSON' });
    const base = createSnapshot(sampleInput);
    expect(parseSnapshot(JSON.stringify({ ...base, format: 'other' }))).toEqual({ ok: false, error: 'UNSUPPORTED_FORMAT' });
    expect(parseSnapshot(JSON.stringify({ ...base, version: 99 }))).toEqual({ ok: false, error: 'UNSUPPORTED_VERSION' });
    expect(parseSnapshot(JSON.stringify({ ...base, elements: 'x' }))).toEqual({ ok: false, error: 'INVALID_ELEMENTS' });
    expect(parseSnapshot(JSON.stringify({ ...base, elements: [] }))).toEqual({ ok: false, error: 'EMPTY_PROJECT' });
    expect(parseSnapshot(JSON.stringify({ ...base, elements: [{ id: 'x' }] }))).toEqual({ ok: false, error: 'INVALID_ELEMENTS' });
  });

  it('缺失的元数据回退到安全默认值', () => {
    const base = createSnapshot(sampleInput);
    const parsed = parseSnapshot(JSON.stringify({
      format: base.format, version: base.version, elements: base.elements,
    }));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.snapshot.name).toBe('未命名项目');
      expect(parsed.snapshot.ticksPerFrame).toBe(4000);
    }
  });
});

describe('导出设置（UI 第三批）', () => {
  it('合并 profile 不修改原对象且码率有下限', () => {
    const base = { width: 320, height: 180, includeAudio: false, videoBitrateBps: 1 };
    const merged = buildExportProfile(base, { ...DEFAULT_EXPORT_SETTINGS, bitrateBps: 2_500_000 });
    expect(merged.includeAudio).toBe(true);
    expect(merged.videoBitrateBps).toBe(2_500_000);
    expect(base.videoBitrateBps).toBe(1);
    expect(buildExportProfile(base, { ...DEFAULT_EXPORT_SETTINGS, bitrateBps: -5 }).videoBitrateBps).toBe(1);
  });

  it('容器决定文件名与短名', () => {
    expect(exportFilename(DEFAULT_EXPORT_SETTINGS)).toBe('opencut-export.mp4');
    expect(exportFilename({ ...DEFAULT_EXPORT_SETTINGS, container: 'webm' })).toBe('opencut-export.webm');
    expect(exportFilename({ ...DEFAULT_EXPORT_SETTINGS, container: 'webm-av1' })).toBe('opencut-export-av1.webm');
    expect(containerShortName({ ...DEFAULT_EXPORT_SETTINGS, container: 'webm-av1' })).toBe('AV1 WebM');
  });
});
