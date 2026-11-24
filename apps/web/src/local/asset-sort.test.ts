import { describe, expect, it } from 'vitest';

import type { AssetItem } from './classic-ui/assets-panel';
import { DEFAULT_ASSET_SORT, sortAssets, toggleSort, type AssetSort } from './asset-sort';

const item = (id: string, name: string, type: AssetItem['type'], duration?: number): AssetItem =>
  ({ id, name, type, ...(duration === undefined ? {} : { duration }) });

const SAMPLE: AssetItem[] = [
  item('a', 'beta', 'video', 12),
  item('b', 'Alpha', 'image'),
  item('c', 'gamma', 'audio', 3),
  item('d', 'Delta', 'video', 12),
  item('e', 'epsilon', 'audio', Number.NaN),
];

/** 默认排序配置锁定：保持经典版导入顺序。 */
describe('asset-sort 默认配置', () => {
  it('默认保持导入顺序', () => {
    expect(DEFAULT_ASSET_SORT).toEqual({ key: 'original', direction: 'asc' });
  });

  it('original 排序（含 desc）都不改变列表顺序', () => {
    const originalIds = SAMPLE.map(x => x.id);
    expect(sortAssets(SAMPLE, DEFAULT_ASSET_SORT).map(x => x.id)).toEqual(originalIds);
    expect(sortAssets(SAMPLE, { key: 'original', direction: 'desc' }).map(x => x.id)).toEqual(originalIds);
  });
});

/** 名称排序：大小写不敏感、升降序。 */
describe('sortAssets 名称排序', () => {
  it('asc 大小写不敏感', () => {
    const ids = sortAssets(SAMPLE, { key: 'name', direction: 'asc' }).map(x => x.id);
    // Alpha(b) → beta(a) → Delta(d) → epsilon(e) → gamma(c)：忽略大小写后按字母序。
    expect(ids).toEqual(['b', 'a', 'd', 'e', 'c']);
  });

  it('desc 为 asc 的完整反转', () => {
    const ids = sortAssets(SAMPLE, { key: 'name', direction: 'desc' }).map(x => x.id);
    expect(ids).toEqual(['c', 'e', 'd', 'a', 'b']);
  });
});

/** 时长排序：升序、降序无时长恒末尾、NaN 视为无时长。 */
describe('sortAssets 时长排序', () => {
  it('asc 按时长升序且无时长/NaN 排末尾', () => {
    const ids = sortAssets(SAMPLE, { key: 'duration', direction: 'asc' }).map(x => x.id);
    expect(ids).toEqual(['c', 'a', 'd', 'b', 'e']);
  });

  it('desc 有值降序但无时长/NaN 仍在末尾（不翻转到头部）', () => {
    const ids = sortAssets(SAMPLE, { key: 'duration', direction: 'desc' }).map(x => x.id);
    expect(ids).toEqual(['a', 'd', 'c', 'b', 'e']);
  });
});

/** 类型排序：image < video < audio。 */
describe('sortAssets 类型排序', () => {
  it('asc 按 image→video→audio', () => {
    const ids = sortAssets(SAMPLE, { key: 'type', direction: 'asc' }).map(x => x.id);
    expect(ids).toEqual(['b', 'a', 'd', 'c', 'e']);
  });
});

/** 边界：空数组、单元素、不改入参、未知类型不崩。 */
describe('sortAssets 边界', () => {
  it('空数组返回空', () => {
    expect(sortAssets([], { key: 'name', direction: 'asc' })).toEqual([]);
  });

  it('不改入参顺序', () => {
    const copy = [...SAMPLE];
    const result = sortAssets(SAMPLE, { key: 'duration', direction: 'desc' });
    expect(SAMPLE).toEqual(copy);
    expect(result).not.toBe(SAMPLE);
  });

  it('未知类型按 0 处理不崩', () => {
    const odd = item('x', 'x', 'weird' as AssetItem['type'], 1);
    expect(() => sortAssets([odd, ...SAMPLE], { key: 'type', direction: 'asc' })).not.toThrow();
  });
});

/** toggleSort 交互：同键翻转、异键重置升序。 */
describe('toggleSort', () => {
  it('同键翻转方向、异键重置 asc', () => {
    expect(toggleSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' });
    expect(toggleSort({ key: 'name', direction: 'desc' }, 'name')).toEqual({ key: 'name', direction: 'asc' });
    const next: AssetSort = toggleSort({ key: 'name', direction: 'desc' }, 'duration');
    expect(next).toEqual({ key: 'duration', direction: 'asc' });
  });
});
