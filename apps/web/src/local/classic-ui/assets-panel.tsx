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

import { useMemo, useState } from 'react';
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
  kind: 'media' | 'text'
  id: string
  name: string
  mediaType?: AssetItem['type']
  content?: string
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

/** Media 视图：Import 按钮 + 网格/列表切换占位 + 素材网格 + 拖入态。 */
function MediaView({ props }: { props: AssetsPanelProps }) {
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
      {props.assets.length > 0 ? (
        <div className="classic-assets-grid" style={{
          display: 'grid', gap: ASSETS_GRID_GAP_PX,
          gridTemplateColumns: `repeat(auto-fill, ${ASSETS_GRID_COLUMN_WIDTH_PX}px)`,
        }}>
          {props.assets.map((item) => (
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

/** Text 视图：经典版单卡「Default text」，拖入载荷为 text。 */
function TextView({ onAdd }: { onAdd?: (payload: AssetDragPayload) => void }) {
  const payload: AssetDragPayload = { kind: 'text', id: 'temp-text-id', name: 'Default text', content: 'Default text' }
  return (
    <PanelView title="Text">
      <div style={{
        width: ASSETS_GRID_COLUMN_WIDTH_PX, aspectRatio: '1',
        background: 'var(--accent)', borderRadius: 'var(--radius-sm)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 'var(--text-xs)', color: 'var(--accent-foreground)', cursor: 'grab',
      }} draggable
        onDragStart={(event) => {
          event.dataTransfer.setData(TIMELINE_DRAG_MIME, JSON.stringify(payload))
          event.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={() => onAdd?.(payload)}>Default text</div>
    </PanelView>
  )
}

/** Stickers 视图：搜索 + 分类占位 + 网格（数据源属批 7，当前为空态）。 */
function StickersView() {
  return (
    <PanelView title="Stickers">
      <input type="search" placeholder="Search..." aria-label="Search stickers"
        style={{ width: '100%', marginBottom: 8, padding: '4px 8px', background: 'var(--input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--foreground)', fontSize: 'var(--text-sm)' }} />
      <div style={{ display: 'flex', gap: 6, marginBottom: 8, fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>Sticker categories</div>
      <div style={{
        display: 'grid', gap: 8,
        gridTemplateColumns: `repeat(auto-fill, minmax(${ASSETS_STICKERS_GRID_MIN_PX}px, ${ASSETS_STICKERS_GRID_MAX_PX}px))`,
      }}>
        <p style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>No stickers available yet.</p>
      </div>
    </PanelView>
  )
}

/** Sounds 视图：搜索 + 筛选占位 + 空态（真实音频源属批 7）。 */
function SoundsView() {
  return (
    <PanelView title="Sounds">
      <input type="search" placeholder="Search sound effects" aria-label="Search sound effects"
        style={{ width: '100%', marginBottom: 8, padding: '4px 8px', background: 'var(--input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--foreground)', fontSize: 'var(--text-sm)' }} />
      <p style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>No sounds available</p>
    </PanelView>
  )
}

/** Effects 视图：96px 网格骨架（effect 注册数据属批 7）。 */
function EffectsView() {
  return (
    <PanelView title="Effects">
      <div style={{
        display: 'grid', gap: 8,
        gridTemplateColumns: `repeat(auto-fill, minmax(${ASSETS_EFFECTS_GRID_MIN_PX}px, 1fr))`,
      }}>
        <p style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>No effects available.</p>
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
      content = <StickersView />
      break
    case 'sounds':
      content = <SoundsView />
      break
    case 'effects':
      content = <EffectsView />
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
