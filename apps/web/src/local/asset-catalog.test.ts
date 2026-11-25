/** 本地素材目录纯函数测试（正常/边界/异常全覆盖）。 */
import { describe, expect, it } from 'vitest'

import {
  collectCategories,
  EMPTY_CATALOG,
  filterEffects,
  filterSounds,
  filterStickers,
  type CatalogEffect,
  type CatalogSound,
  type CatalogSticker,
} from './asset-catalog'

const sounds: CatalogSound[] = [
  { id: 'a', name: 'Click', src: '/a.ogg', durationMs: 100, tags: ['ui', 'click'], category: 'ui' },
  { id: 'b', name: 'Bong', src: '/b.ogg', durationMs: 200, tags: ['musical'], category: 'musical' },
  { id: 'c', name: 'Glass Break', src: '/c.ogg', durationMs: 300, tags: ['foley'], category: 'foley' },
]

const stickers: CatalogSticker[] = [
  { id: 's1', name: 'Grin', src: '/1.svg', char: '😀', width: 128, height: 128, category: 'face', tags: ['smile'] },
  { id: 's2', name: 'Rocket', src: '/2.svg', char: '🚀', width: 128, height: 128, category: 'object', tags: ['launch'] },
]

const effects: CatalogEffect[] = [
  { id: 'e1', name: 'Vivid', category: 'color', params: {}, preview: { kind: 'gradient', colors: [] } },
  { id: 'e2', name: 'Noir', category: 'color', params: {}, preview: { kind: 'gradient', colors: [] } },
  { id: 'e3', name: 'Basic', category: 'basic', params: {}, preview: { kind: 'gradient', colors: [] } },
]

describe('filterSounds 音效过滤', () => {
  it('不过滤时返回全集', () => {
    expect(filterSounds(sounds, '', 'all')).toEqual(sounds)
  })

  it('按名称大小写不敏感匹配', () => {
    expect(filterSounds(sounds, 'CLICK', 'all').map((s) => s.id)).toEqual(['a'])
  })

  it('按标签匹配', () => {
    expect(filterSounds(sounds, 'foley', 'all').map((s) => s.id)).toEqual(['c'])
  })

  it('按分类过滤', () => {
    expect(filterSounds(sounds, '', 'musical').map((s) => s.id)).toEqual(['b'])
  })

  it('边界：空数组、无命中、纯空格查询', () => {
    expect(filterSounds([], 'a', 'all')).toEqual([])
    expect(filterSounds(sounds, 'nonexistent', 'all')).toEqual([])
    expect(filterSounds(sounds, '   ', 'all')).toEqual(sounds)
  })
})

describe('filterStickers 贴纸过滤', () => {
  it('按名称与标签匹配', () => {
    expect(filterStickers(stickers, 'grin', 'all').map((s) => s.id)).toEqual(['s1'])
    expect(filterStickers(stickers, 'launch', 'all').map((s) => s.id)).toEqual(['s2'])
  })

  it('分类与搜索联合过滤（交集）', () => {
    expect(filterStickers(stickers, 'rocket', 'face')).toEqual([])
    expect(filterStickers(stickers, 'rocket', 'object').map((s) => s.id)).toEqual(['s2'])
  })

  it('边界：空数组', () => {
    expect(filterStickers([], '', 'all')).toEqual([])
  })
})

describe('filterEffects 效果过滤', () => {
  it('all 返回副本（不修改原数组）', () => {
    const result = filterEffects(effects, 'all')
    expect(result).toEqual(effects)
    expect(result).not.toBe(effects)
  })

  it('按分类过滤', () => {
    expect(filterEffects(effects, 'color').map((e) => e.id)).toEqual(['e1', 'e2'])
  })

  it('边界：空数组与无命中分类', () => {
    expect(filterEffects([], 'all')).toEqual([])
    expect(filterEffects(effects, 'nonexistent')).toEqual([])
  })
})

describe('collectCategories 分类集合', () => {
  it('含 all 且去重排序', () => {
    expect(collectCategories(sounds)).toEqual(['all', 'foley', 'musical', 'ui'])
  })

  it('边界：空数组只返回 all', () => {
    expect(collectCategories([])).toEqual(['all'])
  })
})

describe('EMPTY_CATALOG 降级常量', () => {
  it('四项均为空结构', () => {
    expect(EMPTY_CATALOG.sounds).toEqual([])
    expect(EMPTY_CATALOG.stickers).toEqual([])
    expect(EMPTY_CATALOG.effects).toEqual([])
    expect(EMPTY_CATALOG.settings).toEqual({ fpsOptions: [], aspectRatios: [], backgrounds: [] })
  })
})
