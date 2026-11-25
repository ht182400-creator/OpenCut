/**
 * 经典版 UI 像素级 1:1 改造 · 批 3 素材面板（本地重写，不拷贝经典版 React/zustand 源码）。
 *
 * 结构对照经典版 `components/editor/panels/assets/`：
 * - 外层 panel + 竖排 9 tab + 竖向分隔 + 内容区（index.tsx）
 * - 内容区统一 44px PanelView 头 + 可滚动区（views/base-panel.tsx）
 * - Media：112px auto-fill 网格、16:9 缩略图、时长徽标、名称、hover 加号、拖入 overlay（views/assets.tsx）
 * - 其余 tab：英文文案与经典版一致的骨架视图；core 未提供的能力明确标注占位。
 *
 * 尺寸来自 assets-tokens.ts；图标为按经典版同位置形状本地绘制的 SVG。
 */

import { useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent, ReactNode, RefObject } from 'react';

import {
  ASSETS_ADD_BUTTON_OFFSET_PX,
  ASSETS_ADD_BUTTON_SIZE_PX,
  ASSETS_CARD_INNER_GAP_PX,
  ASSETS_CARD_NAME_FONT_REM,
  ASSETS_CARD_NAME_MAX_CHARS,
  ASSETS_DRAG_OVERLAY_WIDTH_PX,
  ASSETS_DRAG_OVERLAY_Z_INDEX,
  ASSETS_DURATION_BADGE_BG,
  ASSETS_DURATION_BADGE_OFFSET_PX,
  ASSETS_EFFECTS_GRID_MIN_PX,
  ASSETS_GRID_COLUMN_WIDTH_PX,
  ASSETS_GRID_GAP_PX,
  ASSETS_PANEL_CONTENT_PADDING_X_PX,
  ASSETS_PANEL_HEADER_HEIGHT_PX,
  ASSETS_PANEL_HEADER_PADDING_LEFT_PX,
  ASSETS_PANEL_HEADER_PADDING_RIGHT_PX,
  ASSETS_PANEL_SCROLL_TOP_PADDING_PX,
  ASSETS_STICKERS_GRID_MAX_PX,
  ASSETS_STICKERS_GRID_MIN_PX,
  ASSETS_TAB_GAP_PX,
  ASSETS_TABBAR_PADDING_PX,
  ASSETS_TAB_KEYS,
  ASSETS_TAB_LABELS,
  ASSETS_TAB_SIZE_PX,
  TIMELINE_DRAG_MIME,
} from './assets-tokens';
import {
  DEFAULT_ASSET_SORT,
  sortAssets,
  toggleSort,
  type AssetSort,
  type AssetSortKey,
} from '../asset-sort';
import {
  collectCategories,
  filterEffects,
  filterSounds,
  filterStickers,
  type AssetCatalog,
  type CatalogEffect,
  type CatalogSound,
  type CatalogSticker,
} from '../asset-catalog';

/** 素材条目（对应经典版 MediaAssetData 的最小可视子集）。 */
export interface AssetItem {
  id: string
  name: string
  /** image / video / audio；决定占位图标与时长徽标。 */
  type: 'image' | 'video' | 'audio'
  /** 秒；仅 video/audio 显示。 */
  duration?: number
  /** 图片/视频缩略图地址；缺省用主题色占位。 */
  thumbnailUrl?: string
}

/** 拖入时间轴的载荷（与经典版 TimelineDragData 的 key 对齐；内容为本工程最小子集）。 */
export interface AssetDragPayload {
  kind: 'media' | 'text' | 'graphic' | 'audio'
  id: string
  name: string
  mediaType?: AssetItem['type']
  content?: string
  /** 第二档项 2：图形形状（rectangle/ellipse/triangle/line）。 */
  shape?: string
  /** D 档：音效静态文件路径（kind=audio）。 */
  soundSrc?: string
  /** D 档：贴纸 SVG 路径（kind=graphic）。 */
  stickerSrc?: string
}

export interface AssetsPanelProps {
  projectFileRef: RefObject<HTMLInputElement | null>
  videoFileRef: RefObject<HTMLInputElement | null>
  otioFileRef: RefObject<HTMLInputElement | null>
  /** 导入项目 JSON / 视频素材：走统一文件解码。 */
  onImportFile: (file?: File) => void
  onOtioFile: (file?: File) => void
  onDemo: () => void
  /** 素材列表（含已导入文件；由调用方在解码成功后追加）。 */
  assets: AssetItem[]
  sourceName: string
  mediaStatus: string
  /** settings tab 的内容（当前工程为导出设置 + 诊断，见差异登记）。 */
  settingsContent?: ReactNode
  /** 素材卡「加到时间轴」回调；core 暂无新增元素能力时由调用方标注占位。 */
  onAddToTimeline?: (payload: AssetDragPayload) => void
  /** D 档：本地素材目录（音效/贴纸/效果预设）。 */
  catalog?: AssetCatalog
  /** D 档：点击效果预设应用到选中元素。 */
  onApplyEffect?: (effect: CatalogEffect) => void
  /** D 档：音效收藏切换（持久化由调用方负责）。 */
  onToggleFavorite?: (soundId: string) => void
  /** D 档：已收藏音效 id 集合。 */
  favorites?: ReadonlySet<string>
}

/** 经典版同位置图标 path（本地绘制，避免图标包版本差异）。 */
const TAB_ICON_PATHS: Record<string, string[]> = {
  media: ['M3 6h18v12H3z', 'M7 6v12', 'M17 6v12', 'M3 10h4', 'M3 14h4', 'M17 10h4', 'M17 14h4'],
  sounds: ['M4 14v-2a8 8 0 0 1 16 0v2', 'M4 14h3v6H4z', 'M17 14h3v6h-3z'],
  text: ['M4 6V4h16v2', 'M9 20h6', 'M12 4v16'],
  stickers: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M8 14s1.5 2 4 2 4-2 4-2', 'M9 9h.01', 'M15 9h.01'],
  effects: ['M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z', 'M19 15l.8 1.8L22 18l-2.2 1.2L19 21l-.8-1.8L16 18l2.2-1.2z'],
  transitions: ['M4 12h14', 'M14 7l5 5-5 5', 'M2 7v10'],
  captions: ['M3 5h18v14H3z', 'M10 10H7v4h3', 'M17 10h-3v4h3'],
  adjustment: ['M4 7h9', 'M17 7h3', 'M4 17h3', 'M11 17h9', 'M15 5v4', 'M8 15v4'],
  settings: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18', 'M12 8v4l3 2'],
}

/** 按名字取本地 SVG（缺失时回退 media）。 */
function TabIcon({ name }: { name: string }): ReactNode {
  const paths = TAB_ICON_PATHS[name] ?? TAB_ICON_PATHS.media
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((d, index) => <path key={index} d={d} />)}
    </svg>
  )
}

/** 卡片缩略图占位图标（image/video/audio 三种最小形状）。 */
function MediaTypeGlyph({ type }: { type: AssetItem['type'] }): ReactNode {
  const d = type === 'audio'
    ? 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0'
    : type === 'image'
      ? 'M3 5h18v14H3z M3 16l5-5 4 4 3-3 6 6'
      : 'M6 4h12v16H6z M10 8l5 4-5 4z'
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {d.split(' M').map((seg, i) => <path key={i} d={i === 0 ? seg : `M${seg}`} />)}
    </svg>
  )
}

/** 秒 → m:ss（与经典版时长徽标一致）。 */
function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

/** 名称截断规则：>8 字符保留前 16 + … + 后 3（与经典版 draggable-item 一致）。 */
function truncateName(name: string): string {
  return name.length > ASSETS_CARD_NAME_MAX_CHARS
    ? `${name.slice(0, 16)}…${name.slice(-3)}`
    : name
}

/** PanelView 统一外壳：44px 标题头 + 可滚动内容区。 */
function PanelView({ title, actions, children, contentStyle }: {
  title: string
  actions?: ReactNode
  children: ReactNode
  contentStyle?: CSSProperties
}) {
  return (
    <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        flex: '0 0 auto', height: ASSETS_PANEL_HEADER_HEIGHT_PX,
        display: 'flex', alignItems: 'center', gap: 8,
        paddingLeft: ASSETS_PANEL_HEADER_PADDING_LEFT_PX,
        paddingRight: ASSETS_PANEL_HEADER_PADDING_RIGHT_PX,
        borderBottom: '1px solid var(--border)', background: 'var(--background)',
        fontSize: 'var(--text-sm)', color: 'var(--muted-foreground)',
      }}>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
        {actions}
      </div>
      <div className="classic-assets-scroll" style={{
        flex: 1, minHeight: 0, overflowY: 'auto', width: '100%',
        paddingTop: ASSETS_PANEL_SCROLL_TOP_PADDING_PX,
        paddingLeft: ASSETS_PANEL_CONTENT_PADDING_X_PX,
        paddingRight: ASSETS_PANEL_CONTENT_PADDING_X_PX,
        ...contentStyle,
      }}>
        {children}
      </div>
    </div>
  )
}

/** 通用「即将推出」占位视图（经典版 transitions/adjustment 的 coming soon 文案）。 */
function ComingSoon({ label }: { label: string }) {
  return (
    <PanelView title={label}>
      <p style={{ padding: 16, color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>
        {label} view coming soon...
      </p>
    </PanelView>
  )
}

/** U-01 素材排序控件文案与符号（集中放置，避免业务 JSX 里散落裸字符串）。 */
const ASSET_SORT_LABEL = 'Sort';
const ASSET_SORT_TITLE_PREFIX = 'Sort by ';
const ASSET_SORT_ARROW_ASC = ' ↑';
const ASSET_SORT_ARROW_DESC = ' ↓';

/** U-01：素材排序按钮（键 + 英文标签，与经典版 UI 文案一致）。 */
const ASSET_SORT_CONTROLS: ReadonlyArray<{ key: AssetSortKey; label: string }> = [
  { key: 'original', label: 'Original' },
  { key: 'name', label: 'Name' },
  { key: 'duration', label: 'Duration' },
  { key: 'type', label: 'Type' },
];

/**
 * 排序按钮上的方向箭头：原序无方向不显示，仅激活键按当前方向显示。
 * @param sort 当前排序配置
 * @param key 按钮对应的排序键
 * @returns {string} 带前导空格的箭头符号，或空串
 */
function sortArrow(sort: AssetSort, key: AssetSortKey): string {
  if (sort.key !== key || key === 'original') return '';
  return sort.direction === 'asc' ? ASSET_SORT_ARROW_ASC : ASSET_SORT_ARROW_DESC;
}

/** 素材卡：16:9 缩略图 + 时长徽标 + 名称 + hover 加号 + 拖入时间轴。 */
function AssetCard({ item, onAdd }: { item: AssetItem; onAdd?: (payload: AssetDragPayload) => void }) {
  const [dragging, setDragging] = useState(false)
  const payload: AssetDragPayload = {
    kind: 'media', id: item.id, name: item.name, mediaType: item.type,
  }
  const onDragStart = (event: DragEvent<HTMLDivElement>) => {
    try {
      event.dataTransfer.setData(TIMELINE_DRAG_MIME, JSON.stringify(payload))
      event.dataTransfer.effectAllowed = 'copy'
      // 用 1×1 透明图替代浏览器默认拖拽快照，贴近经典版 setDragImage(emptyImg,0,0)
      const empty = document.createElement('img')
      empty.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'
      event.dataTransfer.setDragImage(empty, 0, 0)
      setDragging(true)
    } catch {
      setDragging(false)
    }
  }
  return (
    <div style={{ position: 'relative', width: ASSETS_GRID_COLUMN_WIDTH_PX, cursor: 'default' }}
      draggable onDragStart={onDragStart} onDragEnd={() => setDragging(false)}
      data-asset-id={item.id} data-asset-type={item.type}
      title={`${item.name}${item.duration !== undefined ? ` · ${formatDuration(item.duration)}` : ''}`}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: ASSETS_CARD_INNER_GAP_PX }}>
        <div style={{
          position: 'relative', aspectRatio: '16 / 9', width: '100%', overflow: 'hidden',
          background: 'var(--muted)', borderRadius: 'var(--radius-sm)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'var(--muted-foreground)',
        }}>
          {item.thumbnailUrl
            ? <img src={item.thumbnailUrl} alt={item.name} loading="lazy"
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
            : <MediaTypeGlyph type={item.type} />}
          {item.type === 'video' && item.duration !== undefined && (
            <span style={{
              position: 'absolute', right: ASSETS_DURATION_BADGE_OFFSET_PX,
              bottom: ASSETS_DURATION_BADGE_OFFSET_PX,
              background: ASSETS_DURATION_BADGE_BG, color: '#fff',
              padding: '0 4px', borderRadius: 'var(--radius-sm)',
              fontSize: 'var(--text-xs)', lineHeight: 1.4,
            }}>{formatDuration(item.duration)}</span>
          )}
          {onAdd && (
            <button type="button" className="classic-asset-add"
              title="Add to timeline" aria-label={`Add ${item.name} to timeline`}
              onClick={() => onAdd(payload)}
              style={{
                position: 'absolute', right: ASSETS_ADD_BUTTON_OFFSET_PX,
                bottom: ASSETS_ADD_BUTTON_OFFSET_PX,
                width: ASSETS_ADD_BUTTON_SIZE_PX, height: ASSETS_ADD_BUTTON_SIZE_PX,
                borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)',
                background: 'var(--background)', color: 'var(--foreground)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, lineHeight: 1, opacity: 0,
              }}>＋</button>
          )}
        </div>
        <span style={{
          width: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left',
          color: 'var(--muted-foreground)', fontSize: `${ASSETS_CARD_NAME_FONT_REM}rem`,
        }}>{truncateName(item.name)}</span>
      </div>
      {dragging && (
        <div style={{
          position: 'fixed', zIndex: ASSETS_DRAG_OVERLAY_Z_INDEX, pointerEvents: 'none',
          width: ASSETS_DRAG_OVERLAY_WIDTH_PX, padding: 4,
          borderRadius: 'var(--radius-sm)', background: 'var(--muted)',
          boxShadow: '0 8px 24px rgba(0,0,0,.35)', opacity: 0.9,
          fontSize: 'var(--text-xs)', textAlign: 'center', overflow: 'hidden',
        }}>{item.name}</div>
      )}
    </div>
  )
}

/** Media 视图：Import 按钮 + U-01 排序控件 + 素材网格 + 拖入态。 */
function MediaView({ props }: { props: AssetsPanelProps }) {
  const [sort, setSort] = useState<AssetSort>(DEFAULT_ASSET_SORT);
  // 排序只作用于展示顺序，不改 props.assets；切走 tab 后 state 重置为原序（U-01 本地 state 口径）。
  const sortedAssets = useMemo(() => sortAssets(props.assets, sort), [props.assets, sort]);
  return (
    <PanelView title="Assets" actions={
      <button type="button" className="classic-button" title="Import"
        style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
        onClick={() => props.videoFileRef.current?.click()}>Import</button>
    }>
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
        <label className="classic-button" style={{ padding: '2px 8px', fontSize: 'var(--text-xs)', textAlign: 'center' }}>
          项目 JSON
          <input ref={props.projectFileRef} type="file" accept=".json,application/json" style={{ display: 'none' }}
            onChange={(event) => props.onImportFile(event.target.files?.[0])} />
        </label>
        <label className="classic-button" style={{ padding: '2px 8px', fontSize: 'var(--text-xs)', textAlign: 'center' }}>
          视频
          <input ref={props.videoFileRef} type="file" accept="video/*,.mp4,.webm" style={{ display: 'none' }}
            onChange={(event) => props.onImportFile(event.target.files?.[0])} />
        </label>
        <label className="classic-button" style={{ padding: '2px 8px', fontSize: 'var(--text-xs)', textAlign: 'center' }}>
          OTIO
          <input ref={props.otioFileRef} type="file" accept=".otio,application/json" style={{ display: 'none' }}
            onChange={(event) => props.onOtioFile(event.target.files?.[0])} />
        </label>
        <button type="button" className="classic-button" style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}
          onClick={props.onDemo}>Demo</button>
      </div>
      <div style={{ display: 'flex', gap: 4, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>{ASSET_SORT_LABEL}</span>
        {ASSET_SORT_CONTROLS.map(({ key, label }) => {
          // 点击已激活键翻转方向，点击其他键切到该键升序；Original 恢复导入顺序。
          const active = sort.key === key;
          return (
            <button key={key} type="button" className="classic-button"
              data-testid={`asset-sort-${key}`} data-active={active} aria-pressed={active}
              title={`${ASSET_SORT_TITLE_PREFIX}${label}`}
              onClick={() => setSort(current => toggleSort(current, key))}
              style={{
                padding: '2px 8px', fontSize: 'var(--text-xs)',
                background: active ? 'var(--accent)' : undefined,
                color: active ? 'var(--accent-foreground)' : undefined,
              }}>
              {label}{sortArrow(sort, key)}
            </button>
          );
        })}
      </div>
      {sortedAssets.length > 0 ? (
        <div className="classic-assets-grid" style={{
          display: 'grid', gap: ASSETS_GRID_GAP_PX,
          gridTemplateColumns: `repeat(auto-fill, ${ASSETS_GRID_COLUMN_WIDTH_PX}px)`,
        }}>
          {sortedAssets.map((item) => (
            <AssetCard key={item.id} item={item} onAdd={props.onAddToTimeline} />
          ))}
        </div>
      ) : (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16,
          padding: 32, textAlign: 'center', borderRadius: 'var(--radius-lg)',
          background: 'color-mix(in srgb, var(--foreground) 5%, transparent)',
          color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)',
        }}>
          <MediaTypeGlyph type="image" />
          <span>Drag and drop videos, photos, and audio files here</span>
          <span>{props.mediaStatus}</span>
          <span>{props.sourceName}</span>
        </div>
      )}
    </PanelView>
  )
}

/** 第二档项 2：图形卡片默认时长（秒）。 */
const GRAPHIC_DEFAULT_DURATION_SECONDS = 3;

/** 第二档项 2：可选图形形状（放 Text 视图，与 Default text 并列）。 */
const GRAPHIC_CARD_SHAPES: ReadonlyArray<{ shape: string; label: string }> = [
  { shape: 'rectangle', label: 'Rectangle' },
  { shape: 'ellipse', label: 'Ellipse' },
  { shape: 'triangle', label: 'Triangle' },
  { shape: 'line', label: 'Line' },
];

/**
 * 可拖入时间轴的通用素材卡（文字/图形共用）。
 * @param label 卡片显示名
 * @param payload 拖入载荷
 * @param onAdd 点击添加回调
 * @param preview 卡片预览样式
 */
function SimpleAssetCard({ label, payload, onAdd, preview }: {
  label: string; payload: AssetDragPayload; onAdd?: (payload: AssetDragPayload) => void; preview?: CSSProperties
}) {
  return (
    <div style={{
      width: ASSETS_GRID_COLUMN_WIDTH_PX, aspectRatio: '1',
      background: 'var(--accent)', borderRadius: 'var(--radius-sm)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      fontSize: 'var(--text-xs)', color: 'var(--accent-foreground)', cursor: 'grab', ...preview,
    }} draggable data-asset-kind={payload.kind} data-asset-shape={payload.shape}
      onDragStart={(event) => {
        event.dataTransfer.setData(TIMELINE_DRAG_MIME, JSON.stringify(payload))
        event.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => onAdd?.(payload)}>{label}</div>
  )
}

/** Text 视图：经典版「Default text」+ 第二档项 2 的四个图形卡。 */
function TextView({ onAdd }: { onAdd?: (payload: AssetDragPayload) => void }) {
  const payload: AssetDragPayload = { kind: 'text', id: 'temp-text-id', name: 'Default text', content: 'Default text' }
  return (
    <PanelView title="Text">
      <SimpleAssetCard label="Default text" payload={payload} onAdd={onAdd} />
      <div style={{ marginTop: 12, color: 'var(--muted-foreground)', fontSize: 'var(--text-xs)' }}>Graphic</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
        {GRAPHIC_CARD_SHAPES.map(({ shape, label }) => (
          <SimpleAssetCard key={shape} label={label} onAdd={onAdd}
            payload={{
              kind: 'graphic', id: `temp-graphic-${shape}`, name: label, shape,
              content: String(GRAPHIC_DEFAULT_DURATION_SECONDS),
            }}
            preview={{ background: 'var(--muted)', color: 'var(--foreground)' }} />
        ))}
      </div>
    </PanelView>
  )
}

/** 分类按钮行（共用样式，D 档）。 */
function CategoryRow({ categories, active, onSelect, testId }: {
  categories: readonly string[]
  active: string
  onSelect: (category: string) => void
  testId: string
}) {
  return (
    <div className={testId} style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap' }}>
      {categories.map((category) => (
        <button key={category} type="button" className="classic-button"
          data-active={category === active} data-testid={`${testId}-${category}`}
          onClick={() => onSelect(category)}
          style={{ padding: '2px 8px', fontSize: 'var(--text-xs)', opacity: category === active ? 1 : 0.65 }}>
          {category}
        </button>
      ))}
    </div>
  )
}

/** Stickers 视图：搜索 + 分类 + 真实 SVG 贴纸网格（可拖入时间轴/点击添加）。 */
function StickersView({ stickers, onAdd }: {
  stickers: readonly CatalogSticker[]
  onAdd?: (payload: AssetDragPayload) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const categories = useMemo(() => collectCategories(stickers), [stickers])
  const visible = useMemo(() => filterStickers(stickers, query, category), [stickers, query, category])
  return (
    <PanelView title="Stickers">
      <input type="search" placeholder="Search..." aria-label="Search stickers"
        data-testid="sticker-search" value={query} onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', marginBottom: 8, padding: '4px 8px', background: 'var(--input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--foreground)', fontSize: 'var(--text-sm)' }} />
      <CategoryRow categories={categories} active={category} onSelect={setCategory} testId="sticker-categories" />
      <div data-testid="sticker-grid" style={{
        display: 'grid', gap: 8,
        gridTemplateColumns: `repeat(auto-fill, minmax(${ASSETS_STICKERS_GRID_MIN_PX}px, ${ASSETS_STICKERS_GRID_MAX_PX}px))`,
      }}>
        {visible.length === 0 && <p style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>No stickers available yet.</p>}
        {visible.map((sticker) => {
          const payload: AssetDragPayload = {
            kind: 'text', id: `sticker-${sticker.id}`, name: sticker.name,
            content: sticker.char, stickerSrc: sticker.src,
          }
          return (
            <div key={sticker.id} data-testid={`sticker-${sticker.id}`}
              draggable onDragStart={(event) => {
                event.dataTransfer.setData(TIMELINE_DRAG_MIME, JSON.stringify(payload))
                event.dataTransfer.effectAllowed = 'copy'
              }} onClick={() => onAdd?.(payload)}
              title={`${sticker.name}（点击加入时间轴 / 拖入轨道）`}
              className="classic-asset-card" style={{ cursor: 'pointer', textAlign: 'center' }}>
              <img src={sticker.src} alt={sticker.name} width={48} height={48}
                style={{ display: 'block', margin: '0 auto', imageRendering: 'auto' }} />
              <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 'var(--text-xs)' }}>{sticker.name}</span>
            </div>
          )
        })}
      </div>
    </PanelView>
  )
}

/** Sounds 视图：搜索 + 分类 + 试听 + 收藏 + 拖入时间轴。 */
function SoundsView({ sounds, favorites, onToggleFavorite, onAdd }: {
  sounds: readonly CatalogSound[]
  favorites?: ReadonlySet<string>
  onToggleFavorite?: (soundId: string) => void
  onAdd?: (payload: AssetDragPayload) => void
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('all')
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const categories = useMemo(() => collectCategories(sounds), [sounds])
  const visible = useMemo(() => filterSounds(sounds, query, category), [sounds, query, category])

  /** 点击卡片试听/停止；同一音效再次点击停止。 */
  const togglePreview = (sound: CatalogSound) => {
    if (playingId === sound.id) {
      audioRef.current?.pause()
      setPlayingId(null)
      return
    }
    try {
      if (!audioRef.current) audioRef.current = new Audio()
      audioRef.current.src = sound.src
      void audioRef.current.play()
      setPlayingId(sound.id)
    } catch {
      setPlayingId(null)
    }
  }

  return (
    <PanelView title="Sounds">
      <input type="search" placeholder="Search sound effects" aria-label="Search sound effects"
        data-testid="sound-search" value={query} onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', marginBottom: 8, padding: '4px 8px', background: 'var(--input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--foreground)', fontSize: 'var(--text-sm)' }} />
      <CategoryRow categories={categories} active={category} onSelect={setCategory} testId="sound-categories" />
      <div data-testid="sound-grid" style={{ display: 'grid', gap: 6 }}>
        {visible.length === 0 && <p style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>No sounds available</p>}
        {visible.map((sound) => {
          const payload: AssetDragPayload = {
            kind: 'audio', id: `sound-${sound.id}`, name: sound.name,
            mediaType: 'audio', soundSrc: sound.src,
          }
          const favorite = favorites?.has(sound.id) ?? false
          return (
            <div key={sound.id} data-testid={`sound-${sound.id}`}
              draggable onDragStart={(event) => {
                event.dataTransfer.setData(TIMELINE_DRAG_MIME, JSON.stringify(payload))
                event.dataTransfer.effectAllowed = 'copy'
              }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
              <button type="button" data-testid={`sound-play-${sound.id}`}
                onClick={() => togglePreview(sound)}
                aria-label={playingId === sound.id ? `停止 ${sound.name}` : `试听 ${sound.name}`}
                style={{ background: 'none', border: 'none', color: 'var(--foreground)', cursor: 'pointer' }}>
                {playingId === sound.id ? '■' : '▶'}
              </button>
              <span style={{ flex: 1, fontSize: 'var(--text-sm)' }}>{sound.name}</span>
              <span style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-xs)' }}>{(sound.durationMs / 1000).toFixed(1)}s</span>
              <button type="button" data-testid={`sound-fav-${sound.id}`}
                onClick={() => onToggleFavorite?.(sound.id)}
                aria-label={favorite ? `取消收藏 ${sound.name}` : `收藏 ${sound.name}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: favorite ? 'var(--primary)' : 'var(--muted-foreground)' }}>
                {favorite ? '★' : '☆'}
              </button>
              <button type="button" data-testid={`sound-add-${sound.id}`}
                onClick={() => onAdd?.(payload)} title={`加入时间轴：${sound.name}`}
                style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--foreground)' }}>+</button>
            </div>
          )
        })}
      </div>
    </PanelView>
  )
}

/** Effects 视图：真实预设网格（CSS 渐变预览 + 点击应用到选中元素）。 */
function EffectsView({ effects, onApply }: {
  effects: readonly CatalogEffect[]
  onApply?: (effect: CatalogEffect) => void
}) {
  const [category, setCategory] = useState('all')
  const categories = useMemo(() => collectCategories(effects), [effects])
  const visible = useMemo(() => filterEffects(effects, category), [effects, category])
  return (
    <PanelView title="Effects">
      <CategoryRow categories={categories} active={category} onSelect={setCategory} testId="effect-categories" />
      <div data-testid="effect-grid" style={{
        display: 'grid', gap: 8,
        gridTemplateColumns: `repeat(auto-fill, minmax(${ASSETS_EFFECTS_GRID_MIN_PX}px, 1fr))`,
      }}>
        {visible.length === 0 && <p style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>No effects available.</p>}
        {visible.map((effect) => {
          const gradient = effect.preview.kind === 'gradient'
            ? `linear-gradient(135deg, ${effect.preview.colors.join(', ')})`
            : 'var(--muted)'
          return (
            <button key={effect.id} type="button" data-testid={`effect-${effect.id}`}
              onClick={() => onApply?.(effect)}
              title={`应用效果：${effect.name}`}
              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, textAlign: 'center' }}>
              <div data-testid={`effect-preview-${effect.id}`}
                style={{ height: 64, background: gradient, borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }} />
              <span style={{ display: 'block', marginTop: 4, fontSize: 'var(--text-xs)' }}>{effect.name}</span>
            </button>
          )
        })}
      </div>
    </PanelView>
  )
}

/** Captions 视图：Import + 语言选择 + Generate transcript（转写能力属批 7）。 */
function CaptionsView() {
  return (
    <PanelView title="Captions" contentStyle={{ paddingLeft: 0, paddingRight: 0, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', gap: 8, padding: '0 8px 8px' }}>
        <button type="button" className="classic-button" style={{ padding: '2px 8px', fontSize: 'var(--text-xs)' }}>Import</button>
      </div>
      <div style={{ padding: '0 8px', color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>Select a language</div>
      <button type="button" className="classic-button" disabled
        style={{ margin: 'auto 8px 8px', width: 'calc(100% - 16px)', opacity: 0.6 }}>Generate transcript</button>
    </PanelView>
  )
}

/**
 * 素材面板（1:1 外壳 + 九 tab）。settings tab 内容由调用方注入（当前工程为导出/诊断，见差异登记）。
 * @param props 素材列表、导入回调与 settings 内容
 * @returns {React.ReactElement} 素材面板
 */
export function AssetsPanel(props: AssetsPanelProps) {
  const [activeTab, setActiveTab] = useState<string>('media')
  const tabBar = useMemo(() => (
    <div className="classic-tabbar" role="tablist" aria-label="Asset panel"
      style={{ gap: ASSETS_TAB_GAP_PX, padding: ASSETS_TABBAR_PADDING_PX }}>
      {ASSETS_TAB_KEYS.map((key) => (
        <button key={key} type="button" className="classic-tab" role="tab"
          aria-selected={activeTab === key} data-active={activeTab === key}
          title={ASSETS_TAB_LABELS[key]} aria-label={ASSETS_TAB_LABELS[key]}
          style={{ width: ASSETS_TAB_SIZE_PX, height: ASSETS_TAB_SIZE_PX }}
          onClick={() => setActiveTab(key)}>
          <TabIcon name={key} />
        </button>
      ))}
    </div>
  ), [activeTab])

  let content: ReactNode
  switch (activeTab) {
    case 'media':
      content = <MediaView props={props} />
      break
    case 'text':
      content = <TextView onAdd={props.onAddToTimeline} />
      break
    case 'stickers':
      content = <StickersView stickers={props.catalog?.stickers ?? []} onAdd={props.onAddToTimeline} />
      break
    case 'sounds':
      content = <SoundsView sounds={props.catalog?.sounds ?? []}
        favorites={props.favorites} onToggleFavorite={props.onToggleFavorite}
        onAdd={props.onAddToTimeline} />
      break
    case 'effects':
      content = <EffectsView effects={props.catalog?.effects ?? []} onApply={props.onApplyEffect} />
      break
    case 'captions':
      content = <CaptionsView />
      break
    case 'settings':
      content = props.settingsContent ?? <ComingSoon label="Settings" />
      break
    case 'transitions':
    case 'adjustment':
    default:
      content = <ComingSoon label={ASSETS_TAB_LABELS[activeTab as keyof typeof ASSETS_TAB_LABELS] ?? 'Assets'} />
      break
  }

  return (
    <section className="panel classic-panel classic-panel-row"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault()
        props.onImportFile(event.dataTransfer.files[0])
      }}>
      {tabBar}
      <div className="classic-tab-separator" />
      <div className="classic-panel-content" role="tabpanel">{content}</div>
    </section>
  )
}
