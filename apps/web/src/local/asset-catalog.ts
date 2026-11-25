/**
 * 本地素材目录（UI 长尾 D 档）：读取 `public/assets/asset-catalog.json`，
 * 提供搜索/分类过滤纯函数。数据源为 CC0/CC BY 素材，见 `public/assets/ATTRIBUTION.md`。
 */

/** 音效条目。 */
export interface CatalogSound {
  id: string
  name: string
  src: string
  durationMs: number
  tags: string[]
  category: string
}

/** 贴纸条目。 */
export interface CatalogSticker {
  id: string
  name: string
  src: string
  /** 对应 Unicode emoji 字符；加入时间轴时作为文字元素内容，预览 canvas 可直接渲染。 */
  char: string
  width: number
  height: number
  category: string
  tags: string[]
}

/** 效果预设条目（参数 key 与 properties-tokens 的 EFFECT_ELEMENT_PARAMS 对齐）。 */
export interface CatalogEffect {
  id: string
  name: string
  category: string
  params: Record<string, number>
  preview: { kind: 'gradient'; colors: string[] } | { kind: 'src'; src: string }
}

/** 设置枚举。 */
export interface CatalogSettings {
  fpsOptions: number[]
  aspectRatios: string[]
  backgrounds: Array<{ id: string; label: string; value: string }>
}

/** 完整目录。 */
export interface AssetCatalog {
  version: number
  sounds: CatalogSound[]
  stickers: CatalogSticker[]
  effects: CatalogEffect[]
  settings: CatalogSettings
}

/** 目录文件静态路径（Vite public 根目录）。 */
export const ASSET_CATALOG_URL = '/assets/asset-catalog.json'

/** 空目录常量（加载失败时降级，保证 UI 不崩）。 */
export const EMPTY_CATALOG: AssetCatalog = {
  version: 1,
  sounds: [],
  stickers: [],
  effects: [],
  settings: { fpsOptions: [], aspectRatios: [], backgrounds: [] },
}

/**
 * 异步加载素材目录。失败返回空目录，不抛错（UI 降级为空态）。
 * @returns 素材目录
 */
export async function loadAssetCatalog(): Promise<AssetCatalog> {
  try {
    const response = await fetch(ASSET_CATALOG_URL)
    if (!response.ok) return EMPTY_CATALOG
    const data: unknown = await response.json()
    return isCatalog(data) ? data : EMPTY_CATALOG
  } catch {
    return EMPTY_CATALOG
  }
}

/** 运行时校验目录结构（避免坏 JSON 污染 UI）。 */
function isCatalog(value: unknown): value is AssetCatalog {
  if (!value || typeof value !== 'object') return false
  const c = value as Record<string, unknown>
  return Array.isArray(c.sounds) && Array.isArray(c.stickers)
    && Array.isArray(c.effects) && !!c.settings && typeof c.settings === 'object'
}

/**
 * 按关键词与分类过滤音效（名称/标签大小写不敏感）。
 * @param sounds 音效全集
 * @param query 搜索词
 * @param category 分类（'all' 表示不过滤）
 * @returns 过滤结果
 */
export function filterSounds(
  sounds: readonly CatalogSound[],
  query: string,
  category: string,
): CatalogSound[] {
  const q = query.trim().toLowerCase()
  return sounds.filter((s) => {
    if (category !== 'all' && s.category !== category) return false
    if (!q) return true
    return s.name.toLowerCase().includes(q) || s.tags.some((tag) => tag.toLowerCase().includes(q))
  })
}

/**
 * 按关键词与分类过滤贴纸。
 * @param stickers 贴纸全集
 * @param query 搜索词
 * @param category 分类（'all' 表示不过滤）
 * @returns 过滤结果
 */
export function filterStickers(
  stickers: readonly CatalogSticker[],
  query: string,
  category: string,
): CatalogSticker[] {
  const q = query.trim().toLowerCase()
  return stickers.filter((s) => {
    if (category !== 'all' && s.category !== category) return false
    if (!q) return true
    return s.name.toLowerCase().includes(q) || s.tags.some((tag) => tag.toLowerCase().includes(q))
  })
}

/**
 * 按分类过滤效果预设。
 * @param effects 效果全集
 * @param category 分类（'all' 表示不过滤）
 * @returns 过滤结果
 */
export function filterEffects(
  effects: readonly CatalogEffect[],
  category: string,
): CatalogEffect[] {
  return category === 'all' ? [...effects] : effects.filter((e) => e.category === category)
}

/**
 * 取某分类集合（用于渲染分类按钮，含 'all'）。
 * @param items 资产全集
 * @returns 分类列表
 */
export function collectCategories(
  items: readonly { category: string }[],
): string[] {
  return ['all', ...Array.from(new Set(items.map((item) => item.category))).sort()]
}
