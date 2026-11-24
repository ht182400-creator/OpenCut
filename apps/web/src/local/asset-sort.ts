/**
 * U-01：Media 素材列表排序纯函数（不触碰 React / core）。
 *
 * 排序键：原序 / 名称 / 时长 / 类型；方向：升 / 降。规则：
 * - 默认键 original 保持导入顺序，不破坏经典版默认插入序；
 * - 稳定排序：同键值保持原顺序（ES2019 Array.sort 保证稳定，这里仍显式保留索引兜底）；
 * - 无时长（image 或 duration 缺失）在「按时长」排序时恒排末尾，不随方向翻转到头部；
 * - 名称用显式小写比较（大小写不敏感、不依赖运行时 locale）；类型按 image < video < audio 固定序。
 */

import type { AssetItem } from './classic-ui/assets-panel';

/** 排序键。 */
export type AssetSortKey = 'original' | 'name' | 'duration' | 'type';

/** 排序方向。 */
export type AssetSortDirection = 'asc' | 'desc';

/** 排序配置。 */
export interface AssetSort {
  key: AssetSortKey
  direction: AssetSortDirection
}

/** 默认排序：保持导入顺序（经典版按导入序展示，不因新增排序功能打乱）。 */
export const DEFAULT_ASSET_SORT: AssetSort = { key: 'original', direction: 'asc' };

/** 类型序：image → video → audio。 */
const TYPE_ORDER: Record<AssetItem['type'], number> = {
  image: 0,
  video: 1,
  audio: 2,
};

/**
 * 比较两条素材的排序键（不含方向）。
 * @param a 左素材
 * @param b 右素材
 * @param key 排序键
 * @returns {number} 负数 a 在前，正数 b 在前，0 相等
 */
function compareByKey(a: AssetItem, b: AssetItem, key: AssetSortKey): number {
  switch (key) {
    case 'original':
      // 原序：比较结果恒为 0，sortAssets 的索引兜底会保留导入顺序。
      return 0;
    case 'name': {
      // 显式小写比较：不依赖运行时 locale 的 localeCompare 行为，顺序可预测。
      const left = a.name.toLowerCase();
      const right = b.name.toLowerCase();
      return left < right ? -1 : left > right ? 1 : 0;
    }
    case 'duration': {
      // 无时长恒排末尾：用 null 标志分离，避免 desc 时翻转到头部。
      const aHas = typeof a.duration === 'number' && Number.isFinite(a.duration);
      const bHas = typeof b.duration === 'number' && Number.isFinite(b.duration);
      if (!aHas && !bHas) return 0;
      if (!aHas) return 1;
      if (!bHas) return -1;
      return (a.duration as number) - (b.duration as number);
    }
    case 'type':
      return TYPE_ORDER[a.type] - TYPE_ORDER[b.type];
  }
}

/**
 * 按配置排序素材列表（返回新数组，不改入参）。
 * @param assets 原始素材列表
 * @param sort 排序配置（key + direction）
 * @returns {AssetItem[]} 排序后新数组；同键值保持原顺序
 */
export function sortAssets(
  assets: readonly AssetItem[],
  sort: AssetSort,
): AssetItem[] {
  const factor = sort.direction === 'desc' ? -1 : 1;
  return assets
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const result = compareByKey(left.item, right.item, sort.key) * factor;
      // desc 时无时长项仍应保持末尾：compareByKey 已返回固定符号，但乘 factor 会翻转；
      // 因此对 duration 的「无值 vs 有值」比较跳过 factor。
      if (sort.key === 'duration' && factor === -1) {
        const aHas = typeof left.item.duration === 'number' && Number.isFinite(left.item.duration);
        const bHas = typeof right.item.duration === 'number' && Number.isFinite(right.item.duration);
        if (aHas !== bHas) return aHas ? -1 : 1;
      }
      return result !== 0 ? result : left.index - right.index;
    })
    .map(({ item }) => item);
}

/**
 * 切换排序键：同键则翻转方向，异键则改为新键升序。
 * @param current 当前排序配置
 * @param key 点击的排序键
 * @returns {AssetSort} 新排序配置
 */
export function toggleSort(current: AssetSort, key: AssetSortKey): AssetSort {
  if (current.key !== key) return { key, direction: 'asc' };
  return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
}
