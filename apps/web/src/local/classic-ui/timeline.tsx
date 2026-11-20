/**
 * 经典版 UI 像素级 1:1 改造 · 批 2 时间轴组件（本地重写）。
 *
 * 结构参照经典版 <opencut-classic>/apps/web/src/timeline/components/index.tsx：
 * toolbar（h-10）+ 轨道头列（112px）+ ruler（22px）+ bookmark 行（16px）+
 * 多轨片段层 + playhead + snap indicator；尺寸/层级/配色取自 timeline-tokens.ts。
 *
 * 组件逻辑为本地重写：不使用经典版 zustand/Next.js 依赖，编辑仍经 core 适配层。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent } from 'react'

import { formatTimecode, snapTicks } from '../editor-ui'
import type { CoreElement, RippleAdjustment } from '../editor-ui'
import type { AssetDragPayload } from './assets-panel'
import { TIMELINE_DRAG_MIME } from './assets-tokens'
import {
  BASE_TIMELINE_PIXELS_PER_SECOND,
  ELEMENT_RING_WIDTH_PX,
  FALLBACK_CONTAINER_WIDTH,
  MIN_TICK_SPACING_PX,
  TIMELINE_BOOKMARK_ROW_HEIGHT_PX,
  TIMELINE_CONTENT_TOP_PADDING_PX,
  TIMELINE_INDICATOR_LINE_WIDTH_PX,
  TIMELINE_LAYERS,
  TIMELINE_MARQUEE_MIN_PX,
  TIMELINE_RULER_HEIGHT_PX,
  TIMELINE_TRACK_HEIGHTS_PX,
  TIMELINE_ZOOM_BUTTON_FACTOR,
  TIMELINE_ZOOM_MAX,
  getCenteredLineLeft,
  getCumulativeHeightBefore,
  getRulerConfig,
  getTimelinePaddingPx,
  getTimelineZoomMin,
  getTotalTracksHeight,
  getTrackHeight,
  formatRulerLabel,
  normalizeTimelineRect,
  rectsIntersect,
  shouldShowLabel,
  sliderToZoom,
  timelineTimeToPixels,
  zoomToSlider,
} from './timeline-tokens'
import type { ClassicTrackType, TimelineRect } from './timeline-tokens'

/** 时间轴单条轨道视图（main 轨用可编辑 elements，其余轨只读展示）。 */
export interface ClassicTimelineTrack {
  id: string
  trackType: string
  elements: CoreElement[]
  label?: string
}

/** 工具栏动作（由 editor.tsx 提供，图标仅作视觉，不绑定经典版 action 名）。 */
export interface TimelineAction {
  label: string
  onClick: () => void
  disabled?: boolean
  icon?: string
}

/** 拖拽模式：整段移动、左右裁剪、播放头定位。 */
type TimelineDragMode = 'move' | 'left' | 'right' | 'playhead'

/** 一次拖拽的上下文，全部换算为像素→ticks。 */
interface TimelineDrag {
  id: string
  mode: TimelineDragMode
  startX: number
  startTicks: number
  origDuration: number
  pixelsPerSecond: number
  proposed: number
  delta: number
  snapTarget: number | null
}

/** 片段拖拽时的即时预览位置。 */
interface ClipPreview {
  id: string
  start: number
  duration: number
}

/** 工具栏按钮的默认图标顺序（与经典版 ToolbarLeftSection 对齐）。 */
const ACTION_ICONS = ['scissor', 'alignLeft', 'alignRight', 'move', 'duplicate', 'freeze', 'trash'] as const

/** 标尺刻度上限，超长时间轴按间隔截断，防止 DOM 爆炸。 */
const MAX_RULER_TICKS = 1000

/** 播放头圆点直径（经典版 size-3 = 0.75rem）。 */
const PLAYHEAD_KNOB_SIZE_PX = 12

/** 图标路径表：按经典版同位置形状本地绘制。 */
const ICON_PATHS: Record<string, string> = {
  video: 'M8 5v14l11-7z',
  text: 'M4 7V4h16v3 M9 20h6 M12 4v16',
  audio: 'M9 18V5l12-2v13 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0',
  graphic: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  effect: 'M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z',
  volume: 'M11 5L6 9H2v6h4l5 4V5z M15.5 8.5a5 5 0 0 1 0 7',
  volumeOff: 'M11 5L6 9H2v6h4l5 4V5z M22 9l-6 6 M16 9l6 6',
  eye: 'M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4',
  eyeOff: 'M3 3l18 18 M10.6 5.2A10 10 0 0 1 12 5c7 0 10 7 10 7a18 18 0 0 1-2.2 3.2 M6.2 6.2C3.5 8 2 12 2 12s3 7 10 7a10 10 0 0 0 3.7-.7',
  magnet: 'M6 3v9a6 6 0 0 0 12 0V3h-4v9a2 2 0 0 1-4 0V3z',
  searchMinus: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M8 11h6 M20 20l-4-4',
  searchPlus: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M8 11h6 M11 8v6 M20 20l-4-4',
  scissor: 'M6 6l12 12 M18 6L6 18 M6 6a2 2 0 1 1-4 0 2 2 0 0 1 4 0 M6 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0',
  alignLeft: 'M4 4v16 M8 7l6 5-6 5z',
  alignRight: 'M20 4v16 M16 7l-6 5 6 5z',
  move: 'M12 3v18 M3 12h18 M9 6l3-3 3 3 M9 18l3 3 3-3',
  duplicate: 'M8 8h12v12H8z M4 16V4h12',
  freeze: 'M12 2v20 M4 6l16 12 M20 6L4 18',
  trash: 'M3 6h18 M8 6V4h8v2 M6 6l1 15h10l1-15',
  bookmark: 'M6 3h12v18l-6-4-6 4z',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
}

/** 本地图标：按经典版同位置形状绘制的 SVG path。 */
function TimelineIcon({ name, size = 16 }: { name: string; size?: number }) {
  const path = ICON_PATHS[name] ?? ICON_PATHS.video
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {path.split(' M').map((segment, index) => (
        <path key={index} d={index === 0 ? segment : `M${segment}`} />
      ))}
    </svg>
  )
}

/** 把项目轨道类型映射到经典版轨道类型（未知类型按 text 轨高度处理）。 */
function toTrackType(value: string): ClassicTrackType {
  return value in TIMELINE_TRACK_HEIGHTS_PX ? (value as ClassicTrackType) : 'text'
}

/**
 * P2 框选命中纯函数：按矩形与片段几何（ticks→px、轨道累计高度）求交。
 * 与渲染位置同一口径，独立成函数便于单测。
 * @param tracks 轨道视图
 * @param zoom 当前缩放
 * @param ticksPerSecond 每秒 ticks
 * @param rect 框选矩形（内容坐标 px）
 * @returns {string[]} 命中的片段 id
 */
function collectMarqueeHits(
  tracks: readonly ClassicTimelineTrack[],
  zoom: number,
  ticksPerSecond: number,
  rect: TimelineRect,
): string[] {
  // 框选矩形是相对滚动视口的内容坐标，含 ruler + bookmarks 的顶部偏移；
  // 片段 top 从 tracks 容器算起，需扣除该偏移才能同一口径比较。
  const trackAreaTop = TIMELINE_RULER_HEIGHT_PX + TIMELINE_BOOKMARK_ROW_HEIGHT_PX
  const hitRect: TimelineRect = {
    left: rect.left,
    right: rect.right,
    top: rect.top - trackAreaTop,
    bottom: rect.bottom - trackAreaTop,
  }
  const types = tracks.map((track) => toTrackType(track.trackType))
  const hits: string[] = []
  tracks.forEach((track, trackIndex) => {
    const trackType = types[trackIndex]
    const top = getCumulativeHeightBefore(types, trackIndex) + TIMELINE_CONTENT_TOP_PADDING_PX
    const height = getTrackHeight(trackType)
    track.elements.forEach((element) => {
      const left = timelineTimeToPixels(element.startTime, zoom, ticksPerSecond)
      const width = Math.max(2, timelineTimeToPixels(element.duration, zoom, ticksPerSecond))
      if (rectsIntersect(hitRect, { left, top, right: left + width, bottom: top + height })) {
        hits.push(element.id)
      }
    })
  })
  return hits
}

/** 时间轴面板：多轨 + 标尺 + 播放头 + 吸附指示 + 缩放拖拽。 */
export function ClassicTimeline(props: {
  tracks: ClassicTimelineTrack[]
  mainTrackId: string
  sceneName: string
  selectedId: string | null
  /** P1：多选集合（主选中仍由 selectedId 表达；集合非空时一并高亮）。 */
  selectedIds?: readonly string[]
  /** P1：点击片段；additive=Cmd/Ctrl 加选，range=Shift 区间选。 */
  onSelect: (id: string, additive: boolean, range: boolean) => void
  /** P2：空白处框选命中片段；additive=Shift 加框取并集。 */
  onBoxSelect?: (hitIds: string[], additive: boolean) => void
  /** P0：素材卡拖放到轨道时，按落点 ticks 回调插入（载荷经经典版 MIME 传递）。 */
  onDropAsset?: (payload: AssetDragPayload, atTicks: number) => void
  actions: TimelineAction[]
  statusText: string
  adjustments: RippleAdjustment[]
  frameIndex: number
  frameCount: number
  ticksPerFrame: number
  ticksPerSecond: number
  fps: number
  onSeek: (frameIndex: number) => void
  onMoveClip?: (clipId: string, proposedStart: number) => void
  onResizeClip?: (clipId: string, edge: 'left' | 'right', deltaTicks: number) => void
  /** 批 7.3：元素 id → 真实峰值数组（0~255）；缺省时对 audio 轨渲染占位线。 */
  waveforms?: ReadonlyMap<string, Uint8Array>
  /** 批 7.4：元素 id → 真实帧缩略图 data URL；缺省时视频片段保留纯色占位。 */
  videoThumbnails?: ReadonlyMap<string, string>
  /** P4 批 6：外部持久化的轨道标志（静音/隐藏轨道 id）。 */
  mutedTrackIds?: readonly string[]
  hiddenTrackIds?: readonly string[]
  /** P4 批 6：轨道标志变更回调（autosave 持久化）。 */
  onToggleTrackFlag?: (trackId: string, flag: 'muted' | 'hidden') => void
  /** P4 批 6：外部持久化的书签。 */
  bookmarks?: ReadonlyArray<{ id: string; ticks: number; name: string }>
  /** P4 批 6：书签增删改回调。 */
  onBookmarksChange?: (bookmarks: Array<{ id: string; ticks: number; name: string }>) => void
}) {
  const [zoomLevel, setZoomLevel] = useState(1)
  const [snapping, setSnapping] = useState(true)
  const [preview, setPreview] = useState<ClipPreview | null>(null)
  const [snapLine, setSnapLine] = useState<number | null>(null)
  /** P4 批 6：轨道标志由外部 autosave 状态派生（无回调时退回本地 state）。 */
  const [localMutedTracks, setLocalMutedTracks] = useState<ReadonlySet<string>>(() => new Set())
  const [localHiddenTracks, setLocalHiddenTracks] = useState<ReadonlySet<string>>(() => new Set())
  const mutedTracks = useMemo(() => new Set(props.mutedTrackIds ?? localMutedTracks), [props.mutedTrackIds, localMutedTracks])
  const hiddenTracks = useMemo(() => new Set(props.hiddenTrackIds ?? localHiddenTracks), [props.hiddenTrackIds, localHiddenTracks])
  /** P2：框选橡皮筋的当前矩形（内容坐标 px），null 表示未框选。 */
  const [marquee, setMarquee] = useState<TimelineRect | null>(null)

  const containerRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<TimelineDrag | null>(null)
  /** P2：框选起点（内容坐标 px）与是否加框，null 表示未开始。 */
  const marqueeStartRef = useRef<{ x: number; y: number; additive: boolean } | null>(null)
  /** P2：框选当前矩形 ref（供全局 mouseup 读取，避免 stale closure）。 */
  const marqueeRectRef = useRef<TimelineRect | null>(null)
  /** P2：命中计算所需的渲染快照 ref。 */
  const marqueeDataRef = useRef({
    tracks: props.tracks,
    trackTypes: [] as ClassicTrackType[],
    zoom: 1,
    ticksPerSecond: props.ticksPerSecond,
  })
  const boxSelectRef = useRef(props.onBoxSelect)
  const moveRef = useRef(props.onMoveClip)
  const resizeRef = useRef(props.onResizeClip)
  const seekRef = useRef(props.onSeek)
  const tracksRef = useRef(props.tracks)
  const zoomRef = useRef(zoomLevel)
  const snappingRef = useRef(snapping)
  const configRef = useRef({
    ticksPerFrame: props.ticksPerFrame,
    ticksPerSecond: props.ticksPerSecond,
    frameCount: props.frameCount,
  })
  moveRef.current = props.onMoveClip
  resizeRef.current = props.onResizeClip
  seekRef.current = props.onSeek
  tracksRef.current = props.tracks
  zoomRef.current = zoomLevel
  snappingRef.current = snapping
  configRef.current = {
    ticksPerFrame: props.ticksPerFrame,
    ticksPerSecond: props.ticksPerSecond,
    frameCount: props.frameCount,
  }
  boxSelectRef.current = props.onBoxSelect

  const trackTypes = useMemo(
    () => props.tracks.map((track) => toTrackType(track.trackType)),
    [props.tracks],
  )
  const durationTicks = useMemo(() => {
    const elementEnd = props.tracks.reduce(
      (max, track) => track.elements.reduce(
        (inner, element) => Math.max(inner, element.startTime + element.duration), max,
      ), 0,
    )
    const framesEnd = props.frameCount * props.ticksPerFrame
    return Math.max(elementEnd, framesEnd, 1)
  }, [props.tracks, props.frameCount, props.ticksPerFrame])

  const containerWidth = scrollRef.current?.clientWidth ?? FALLBACK_CONTAINER_WIDTH
  const minZoom = getTimelineZoomMin(durationTicks, containerWidth, props.ticksPerSecond)
  const safeZoom = Math.max(minZoom, Math.min(TIMELINE_ZOOM_MAX, zoomLevel))
  const pixelsPerSecond = BASE_TIMELINE_PIXELS_PER_SECOND * safeZoom
  const contentWidth = timelineTimeToPixels(durationTicks, safeZoom, props.ticksPerSecond)
  const paddingPx = getTimelinePaddingPx(containerWidth, safeZoom, minZoom)
  const timelineWidth = Math.max(contentWidth + paddingPx, containerWidth)
  // P2：框选命中计算依赖的渲染快照，每次渲染同步到 ref。
  marqueeDataRef.current = {
    tracks: props.tracks,
    trackTypes,
    zoom: safeZoom,
    ticksPerSecond: props.ticksPerSecond,
  }

  const rulerConfig = useMemo(
    () => getRulerConfig(safeZoom, props.fps),
    [safeZoom, props.fps],
  )
  const rulerTicks = useMemo(() => {
    const durationSeconds = durationTicks / props.ticksPerSecond
    const interval = rulerConfig.tickIntervalSeconds
    const count = Math.min(Math.ceil(durationSeconds / interval) + 1, MAX_RULER_TICKS)
    return Array.from({ length: count }, (_, index) => {
      const seconds = index * interval
      return {
        seconds,
        ticks: Math.round(seconds * props.ticksPerSecond),
        showLabel: shouldShowLabel(seconds, rulerConfig.labelIntervalSeconds),
      }
    })
  }, [durationTicks, props.ticksPerSecond, rulerConfig])

  const playheadTicks = props.frameIndex * props.ticksPerFrame
  const playheadLeft = getCenteredLineLeft(
    timelineTimeToPixels(playheadTicks, safeZoom, props.ticksPerSecond),
  )
  const tracksHeight = getTotalTracksHeight(trackTypes)

  /** 标尺/轨道背景按下：定位播放头。 */
  const seekAt = (clientX: number) => {
    const rect = scrollRef.current?.getBoundingClientRect()
    if (!rect || !seekRef.current) return
    const ticks = ((clientX - rect.left + (scrollRef.current?.scrollLeft ?? 0)) / pixelsPerSecond)
      * configRef.current.ticksPerSecond
    const frame = Math.round(ticks / configRef.current.ticksPerFrame)
    seekRef.current(Math.max(0, Math.min(frame, configRef.current.frameCount - 1)))
  }

  /**
   * P2：把鼠标事件换算为滚动内容坐标（含 scrollLeft/Top），供框选矩形使用。
   * @param clientX 视口 x
   * @param clientY 视口 y
   * @returns {ContentPoint | null} 内容坐标，滚动容器缺失时返回 null
   */
  const toContentPoint = (clientX: number, clientY: number) => {
    const viewport = scrollRef.current
    if (!viewport) return null
    const rect = viewport.getBoundingClientRect()
    return {
      x: clientX - rect.left + viewport.scrollLeft,
      y: clientY - rect.top + viewport.scrollTop,
    }
  }

  /**
   * P2：轨道空白处按下开始框选；additive=Shift 加框。片段按下不触发（由 startDrag 处理）。
   * @param event 鼠标事件
   */
  const startMarquee = (event: ReactMouseEvent) => {
    if (!props.onBoxSelect || event.button !== 0) return
    const point = toContentPoint(event.clientX, event.clientY)
    if (!point) return
    event.preventDefault()
    marqueeStartRef.current = { x: point.x, y: point.y, additive: event.shiftKey }
    setMarquee({ left: point.x, top: point.y, right: point.x, bottom: point.y })
  }

  /** 片段按下：开始移动/裁剪/播放头拖拽（只读轨道禁止编辑）。 */
  const startDrag = (
    event: ReactMouseEvent,
    element: CoreElement,
    mode: TimelineDragMode,
    readOnly: boolean,
  ) => {
    if (mode === 'playhead') {
      if (!props.onSeek) return
      event.preventDefault()
      dragRef.current = {
        id: '', mode, startX: event.clientX, startTicks: 0, origDuration: 0,
        pixelsPerSecond, proposed: 0, delta: 0, snapTarget: null,
      }
      seekAt(event.clientX)
      return
    }
    if (readOnly || (mode === 'move' && !moveRef.current) || (mode !== 'move' && !resizeRef.current)) return
    event.preventDefault()
    event.stopPropagation()
    dragRef.current = {
      id: element.id, mode, startX: event.clientX,
      startTicks: element.startTime, origDuration: element.duration,
      pixelsPerSecond, proposed: element.startTime, delta: 0, snapTarget: null,
    }
  }

  /** 全局 mouse 事件：拖拽预览与提交；依赖 ref 避免 stale closure。 */
  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const start = marqueeStartRef.current
      if (start) {
        const viewport = scrollRef.current
        if (viewport && boxSelectRef.current) {
          const rect = viewport.getBoundingClientRect()
          const point = {
            x: event.clientX - rect.left + viewport.scrollLeft,
            y: event.clientY - rect.top + viewport.scrollTop,
          }
          const delta = Math.abs(point.x - start.x) + Math.abs(point.y - start.y)
          if (delta >= TIMELINE_MARQUEE_MIN_PX) {
            const next = normalizeTimelineRect(start.x, start.y, point.x, point.y)
            marqueeRectRef.current = next
            setMarquee(next)
          }
        }
        return
      }
      const drag = dragRef.current
      if (!drag) return
      if (drag.mode === 'playhead') {
        seekAt(event.clientX)
        return
      }
      const { ticksPerSecond, ticksPerFrame, frameCount } = configRef.current
      const deltaTicks = Math.round(
        ((event.clientX - drag.startX) / drag.pixelsPerSecond) * ticksPerSecond,
      )
      if (drag.mode === 'move') {
        const boundaries = [
          0,
          frameCount * ticksPerFrame,
          ...tracksRef.current
            .filter((track) => track.id === tracksRef.current.find((t) => t.elements.some((e) => e.id === drag.id))?.id)
            .flatMap((track) => track.elements
              .filter((item) => item.id !== drag.id)
              .flatMap((item) => [item.startTime, item.startTime + item.duration])),
        ]
        const thresholdTicks = Math.max(1, (8 / drag.pixelsPerSecond) * ticksPerSecond)
        const raw = Math.max(0, drag.startTicks + deltaTicks)
        drag.proposed = snapTicks(raw, boundaries, ticksPerFrame, thresholdTicks, snappingRef.current)
        drag.snapTarget = snappingRef.current && boundaries.some(
          (boundary) => Math.abs(boundary - raw) <= thresholdTicks,
        ) ? drag.proposed : null
        setSnapLine(drag.snapTarget)
        setPreview({ id: drag.id, start: drag.proposed, duration: drag.origDuration })
      } else {
        const direction = drag.mode === 'right' ? 1 : -1
        const raw = drag.origDuration + direction * deltaTicks
        const shown = snappingRef.current && ticksPerFrame > 0
          ? Math.max(ticksPerFrame, Math.round(raw / ticksPerFrame) * ticksPerFrame)
          : Math.max(1, raw)
        drag.delta = direction * (shown - drag.origDuration)
        drag.snapTarget = null
        setSnapLine(null)
        setPreview({
          id: drag.id,
          start: drag.mode === 'left' ? drag.startTicks + drag.origDuration - shown : drag.startTicks,
          duration: shown,
        })
      }
    }
    const onUp = () => {
      const start = marqueeStartRef.current
      if (start) {
        marqueeStartRef.current = null
        const rect = marqueeRectRef.current
        marqueeRectRef.current = null
        setMarquee(null)
        if (rect && boxSelectRef.current) {
          const data = marqueeDataRef.current
          const hits = collectMarqueeHits(data.tracks, data.zoom, data.ticksPerSecond, rect)
          if (hits.length > 0 || !start.additive) boxSelectRef.current(hits, start.additive)
        }
        return
      }
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      setPreview(null)
      setSnapLine(null)
      if (drag.mode === 'move' && drag.proposed !== drag.startTicks) {
        moveRef.current?.(drag.id, drag.proposed)
      } else if ((drag.mode === 'left' || drag.mode === 'right') && drag.delta !== 0) {
        resizeRef.current?.(drag.id, drag.mode, drag.delta)
      }
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [])

  /** 缩放后播放头跑出视口时自动居中（经典版 useTimelineZoom 的简化行为）。 */
  useEffect(() => {
    const viewport = scrollRef.current
    if (!viewport) return
    const x = timelineTimeToPixels(playheadTicks, safeZoom, props.ticksPerSecond)
    if (x < viewport.scrollLeft + 20 || x > viewport.scrollLeft + viewport.clientWidth - 20) {
      viewport.scrollLeft = Math.max(0, x - viewport.clientWidth / 2)
    }
  }, [playheadTicks, safeZoom, props.ticksPerSecond])

  /** ctrl/meta + wheel 缩放；shift 或横向 delta 滚动；原生监听器阻止浏览器缩放。 */
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let pending = 0
    let rafId: ReturnType<typeof requestAnimationFrame> | null = null
    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault()
        pending += event.deltaY
        if (rafId === null) {
          rafId = requestAnimationFrame(() => {
            const capped = Math.sign(pending) * Math.min(Math.abs(pending), 30)
            const factor = Math.exp(-capped / 300)
            setZoomLevel((current) => Math.max(minZoom, Math.min(TIMELINE_ZOOM_MAX, current * factor)))
            pending = 0
            rafId = null
          })
        }
        return
      }
      const viewport = scrollRef.current
      if (!viewport) return
      event.preventDefault()
      if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
        viewport.scrollLeft += Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY
      } else {
        viewport.scrollTop += event.deltaY
      }
    }
    container.addEventListener('wheel', onWheel, { passive: false, capture: true })
    return () => {
      container.removeEventListener('wheel', onWheel, { capture: true })
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [minZoom])

  /** 缩放按钮：按经典版 factor 步进。 */
  const handleZoom = (direction: 'in' | 'out') => {
    setZoomLevel((current) => direction === 'in'
      ? Math.min(TIMELINE_ZOOM_MAX, current * TIMELINE_ZOOM_BUTTON_FACTOR)
      : Math.max(minZoom, current / TIMELINE_ZOOM_BUTTON_FACTOR))
  }

  /**
   * P0：素材卡拖放落地。按落点 X 与当前缩放/滚动换算 ticks，吸附到帧网格后回调插入。
   * 只接受本应用经典版 MIME 的载荷，避免误吞外部拖入内容。
   */
  const handleAssetDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    if (!props.onDropAsset) return
    const raw = event.dataTransfer.getData(TIMELINE_DRAG_MIME)
    if (!raw) return
    event.preventDefault()
    try {
      const payload = JSON.parse(raw) as AssetDragPayload
      if (payload.kind !== 'text' && payload.kind !== 'media') return
      const rect = event.currentTarget.getBoundingClientRect()
      const relativeX = Math.max(0, event.clientX - rect.left)
      const seconds = relativeX / pixelsPerSecond
      const rawTicks = seconds * props.ticksPerSecond
      const snapped = Math.max(0, Math.round(rawTicks / props.ticksPerFrame) * props.ticksPerFrame)
      props.onDropAsset(payload, snapped)
    } catch {
      // 载荷损坏时忽略，不影响其他拖放（如文件导入）。
    }
  }

  /**
   * 切换轨道静音/隐藏：有外部回调则上送 autosave 持久化，否则退回本地 state。
   * 注意：写回经典版 JSON 需扩 core 契约（写回见台账差异）。
   */
  const toggleTrackFlag = (trackId: string, kind: 'mute' | 'hide') => {
    const flag = kind === 'mute' ? 'muted' : 'hidden'
    if (props.onToggleTrackFlag) {
      props.onToggleTrackFlag(trackId, flag)
      return
    }
    const setter = kind === 'mute' ? setLocalMutedTracks : setLocalHiddenTracks
    setter((previous) => {
      const next = new Set(previous)
      if (next.has(trackId)) next.delete(trackId)
      else next.add(trackId)
      return next
    })
  }

  return (
    <section className="panel classic-timeline" data-testid="classic-timeline" aria-label="Timeline">
      <div className="classic-timeline-toolbar">
        <div className="classic-timeline-toolbar-left">
          {props.actions.map((action, index) => (
            <button key={action.label} type="button" className="classic-timeline-tool-button"
              title={action.label} disabled={action.disabled} onClick={action.onClick}>
              <TimelineIcon name={action.icon ?? ACTION_ICONS[index] ?? 'move'} />
            </button>
          ))}
          <span className="classic-timeline-divider" />
          <button type="button" className="classic-timeline-tool-button" title="在播放头添加书签"
            data-testid="timeline-bookmark-add" disabled={!props.onBookmarksChange}
            onClick={() => {
              const ticks = props.frameIndex * props.ticksPerFrame
              const next = [...(props.bookmarks ?? []), {
                id: `bm-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                ticks, name: `书签 ${(props.bookmarks?.length ?? 0) + 1}`,
              }]
              props.onBookmarksChange?.(next)
            }}>
            <TimelineIcon name="bookmark" />
          </button>
        </div>
        <div className="classic-timeline-scene">
          <TimelineIcon name="layers" size={14} />
          <span>{props.sceneName}</span>
        </div>
        <div className="classic-timeline-toolbar-right">
          <button type="button" className={`classic-timeline-tool-button${snapping ? ' is-active' : ''}`}
            title="自动吸附" aria-pressed={snapping}
            onClick={() => setSnapping((value) => !value)}>
            <TimelineIcon name="magnet" />
          </button>
          <span className="classic-timeline-divider" />
          <button type="button" className="classic-timeline-tool-button" title="缩小"
            onClick={() => handleZoom('out')}><TimelineIcon name="searchMinus" /></button>
          <input type="range" className="classic-timeline-zoom" aria-label="时间轴缩放"
            min={0} max={1} step={0.005} value={zoomToSlider(safeZoom, minZoom)}
            onChange={(event) => setZoomLevel(sliderToZoom(Number(event.target.value), minZoom))} />
          <button type="button" className="classic-timeline-tool-button" title="放大"
            onClick={() => handleZoom('in')}><TimelineIcon name="searchPlus" /></button>
        </div>
      </div>

      <div className="classic-timeline-body" ref={containerRef}>
        <div className="classic-timeline-labels">
          <div className="classic-timeline-labels-header"
            style={{ height: TIMELINE_RULER_HEIGHT_PX + 16 + 2 }} />
          {props.tracks.map((track) => {
            const trackType = toTrackType(track.trackType)
            const isMuted = mutedTracks.has(track.id)
            const isHidden = hiddenTracks.has(track.id)
            return (
              <div key={track.id} className="classic-timeline-label-row"
                style={{
                  height: getTrackHeight(trackType),
                  background: track.elements.some((element) => element.id === props.selectedId)
                    ? 'var(--accent)' : undefined,
                }}>
                {trackType === 'video' || trackType === 'audio' ? (
                  <button type="button" className="classic-timeline-label-toggle" title={isMuted ? '取消静音' : '静音'}
                    onClick={() => toggleTrackFlag(track.id, 'mute')}>
                    <TimelineIcon name={isMuted ? 'volumeOff' : 'volume'} size={14} />
                  </button>
                ) : null}
                {trackType !== 'audio' ? (
                  <button type="button" className="classic-timeline-label-toggle" title={isHidden ? '显示' : '隐藏'}
                    onClick={() => toggleTrackFlag(track.id, 'hide')}>
                    <TimelineIcon name={isHidden ? 'eyeOff' : 'eye'} size={14} />
                  </button>
                ) : null}
                <span className="classic-timeline-label-icon"><TimelineIcon name={trackType} size={14} /></span>
                <span className="classic-timeline-label-name">{track.label ?? track.id}</span>
              </div>
            )
          })}
        </div>

        <div className="classic-timeline-scroll" ref={scrollRef}>
          <div className="classic-timeline-inner" style={{ width: timelineWidth }}>
            <div className="classic-timeline-ruler" style={{ height: TIMELINE_RULER_HEIGHT_PX }}
              onMouseDown={(event) => startDrag(event, { id: '', startTime: 0, duration: 0, trimStart: 0 }, 'playhead', false)}>
              {rulerTicks.map((tick) => {
                const left = timelineTimeToPixels(tick.ticks, safeZoom, props.ticksPerSecond)
                if (tick.showLabel) {
                  return (
                    <span key={tick.seconds} className="classic-timeline-ruler-label"
                      style={{ left }}>
                      {formatRulerLabel(tick.seconds, props.fps)}
                    </span>
                  )
                }
                return (
                  <span key={tick.seconds} className="classic-timeline-ruler-tick"
                    style={{ left, height: MIN_TICK_SPACING_PX / 3 }} />
                )
              })}
            </div>
            <div className="classic-timeline-bookmarks" data-testid="timeline-bookmarks"
              style={{ height: TIMELINE_BOOKMARK_ROW_HEIGHT_PX, position: 'relative' }}>
              {(props.bookmarks ?? []).map((bookmark) => {
                const left = timelineTimeToPixels(bookmark.ticks, safeZoom, props.ticksPerSecond)
                return (
                  <span key={bookmark.id} data-testid={`bookmark-${bookmark.id}`}
                    title={`${bookmark.name}（点击跳转 · 右键删除）`}
                    onClick={() => props.onSeek(Math.max(0, Math.round(bookmark.ticks / props.ticksPerFrame)))}
                    onContextMenu={(event) => {
                      event.preventDefault()
                      props.onBookmarksChange?.((props.bookmarks ?? []).filter((item) => item.id !== bookmark.id))
                    }}
                    style={{
                      position: 'absolute', left, top: 1, cursor: 'pointer',
                      fontSize: 10, color: 'var(--primary)', userSelect: 'none',
                      maxWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                    ◆ {bookmark.name}
                  </span>
                )
              })}
            </div>
            <div className="classic-timeline-tracks" style={{ height: tracksHeight + 2 }}
              onDragOver={(event) => { if (props.onDropAsset && event.dataTransfer.types.includes(TIMELINE_DRAG_MIME)) event.preventDefault() }}
              onDrop={handleAssetDrop}>
              {props.tracks.map((track, trackIndex) => {
                const trackType = toTrackType(track.trackType)
                const readOnly = track.id !== props.mainTrackId
                const top = getCumulativeHeightBefore(trackTypes, trackIndex) + 2
                return (
                  <div key={track.id} className="classic-timeline-track"
                    style={{
                      top,
                      height: getTrackHeight(trackType),
                      background: track.elements.some((element) => element.id === props.selectedId)
                        ? 'var(--accent)' : undefined,
                    }}
                    onMouseDown={(event) => {
                      if (event.target !== event.currentTarget) return
                      // P2：有框选回调时空白处拖动框选；否则退回定位播放头。
                      if (props.onBoxSelect) startMarquee(event)
                      else startDrag(
                        event, { id: '', startTime: 0, duration: 0, trimStart: 0 }, 'playhead', false,
                      )
                    }}>
                    {track.elements.length === 0 ? (
                      <div className="classic-timeline-empty" />
                    ) : track.elements.map((element) => {
                      const shownStart = preview?.id === element.id ? preview.start : element.startTime
                      const shownDuration = preview?.id === element.id ? preview.duration : element.duration
                      const left = timelineTimeToPixels(shownStart, safeZoom, props.ticksPerSecond)
                      const width = Math.max(2, timelineTimeToPixels(shownDuration, safeZoom, props.ticksPerSecond))
                      const isSelected = props.selectedId === element.id
                        || Boolean(props.selectedIds?.includes(element.id))
                      return (
                        <div key={element.id} className="classic-timeline-element"
                          data-track-type={trackType}
                          data-selected={isSelected}
                          title={`${element.id} · ${(shownDuration / props.ticksPerSecond).toFixed(2)}s${readOnly ? '（只读轨道）' : ''}`}
                          style={{
                            left, width,
                            height: getTrackHeight(trackType),
                            boxShadow: isSelected
                              ? `0 0 0 ${ELEMENT_RING_WIDTH_PX}px var(--primary)` : undefined,
                            opacity: hiddenTracks.has(track.id) ? 0.5 : undefined,
                          }}
                          onClick={(event) => props.onSelect(element.id, event.metaKey || event.ctrlKey, event.shiftKey)}
                          onMouseDown={(event) => startDrag(event, element, 'move', readOnly)}>
                          {(() => {
                            const thumbnailUrl = props.videoThumbnails?.get(element.id)
                            if (!thumbnailUrl || trackType !== 'video') return null
                            return (
                              <img className="classic-timeline-thumbnail" src={thumbnailUrl}
                                alt="" aria-hidden="true" draggable={false} />
                            )
                          })()}
                          {(() => {
                            const peaks = props.waveforms?.get(element.id)
                            if (!peaks || peaks.length === 0) return null
                            return (
                              <span className="classic-timeline-waveform" aria-hidden="true">
                                {Array.from(peaks, (peak, index) => (
                                  <i key={index}
                                    style={{ height: `${Math.max(2, Math.round(peak / 255 * 100))}%` }} />
                                ))}
                              </span>
                            )
                          })()}
                          <span className="classic-timeline-element-name">{element.id}</span>
                          {isSelected && !readOnly && (
                            <>
                              <span className="classic-timeline-handle left" title="裁剪入点"
                                onMouseDown={(event) => startDrag(event, element, 'left', false)} />
                              <span className="classic-timeline-handle right" title="裁剪出点"
                                onMouseDown={(event) => startDrag(event, element, 'right', false)} />
                            </>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
            <div className="classic-timeline-gutter"
              onMouseDown={(event) => startDrag(
                event, { id: '', startTime: 0, duration: 0, trimStart: 0 }, 'playhead', false,
              )} />
          </div>

          <div className="classic-timeline-playhead"
            style={{
              left: playheadLeft,
              height: '100%',
              width: TIMELINE_INDICATOR_LINE_WIDTH_PX,
              zIndex: TIMELINE_LAYERS.playhead,
            }}>
            <span className="classic-timeline-playhead-line" />
            <span className="classic-timeline-playhead-knob"
              style={{ width: PLAYHEAD_KNOB_SIZE_PX, height: PLAYHEAD_KNOB_SIZE_PX }}
              onMouseDown={(event) => startDrag(
                event, { id: '', startTime: 0, duration: 0, trimStart: 0 }, 'playhead', false,
              )} />
          </div>
          {snapLine !== null && (
            <div className="classic-timeline-snap"
              style={{
                left: getCenteredLineLeft(
                  timelineTimeToPixels(snapLine, safeZoom, props.ticksPerSecond),
                ),
                zIndex: TIMELINE_LAYERS.snapIndicator,
              }} />
          )}
          {marquee && (
            <div className="classic-timeline-marquee" data-testid="classic-timeline-marquee"
              style={{
                left: marquee.left,
                top: marquee.top,
                width: marquee.right - marquee.left,
                height: marquee.bottom - marquee.top,
                zIndex: TIMELINE_LAYERS.marquee,
              }} />
          )}
        </div>
      </div>

      <div className="classic-timeline-footer">
        <span className="classic-timeline-timecode">
          {formatTimecode(props.frameIndex, props.ticksPerFrame, props.ticksPerSecond)}
        </span>
        <span>{props.statusText}</span>
      </div>
    </section>
  )
}
