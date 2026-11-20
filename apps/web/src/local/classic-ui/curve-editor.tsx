/**
 * P3 长尾批 3 · 可视化关键帧曲线编辑器。
 *
 * 经典版属性面板在参数旁提供关键帧曲线视图；本组件把 element-model 的动画轨道
 * 渲染成可交互 SVG 曲线：拖动关键点改 time/value、双击空白加点、右键删点、缓动切换。
 * 所有改动经 ClipPatch 的 params.__animations 上送 editor，与预览采样共用同一数据。
 */

import { useMemo, useRef, useState, type ReactNode } from 'react'
import type { ClipPatch, CoreElement } from '../editor-ui'
import {
  ANIMATION_TRACKS_KEY,
  readAnimationTracks,
  sampleKeyframes,
  upsertKeyframe,
  type AnimationKeyframe,
} from '../element-model'
import {
  EFFECT_ELEMENT_PARAMS,
  MASK_ELEMENT_PARAMS,
  TEXT_ELEMENT_PARAMS,
  VISUAL_ELEMENT_PARAMS,
  AUDIO_ELEMENT_PARAMS,
  type ParamDefinition,
} from './properties-tokens'
import {
  CURVE_CHART,
  buildCurvePoints,
  removeKeyframeAt,
  resolveValueRange,
  timeToX,
  valueToY,
  xToTime,
  yToValue,
} from './curve-editor-model'

/** 曲线编辑器 UI 文案与几何常量（避免裸字符串/数字）。 */
const UI = Object.freeze({
  TITLE: 'Animation Curves',
  EMPTY: '点击参数旁菱形关键帧按钮后，在此编辑曲线',
  HINT: '拖动关键点改数值 · 双击空白添加 · 右键删除',
  EASING_LABEL: '缓动',
  TRACK_GAP_PX: 8,
  LABEL_WIDTH_PX: 92,
  CHART_MIN_WIDTH_PX: 120,
  /** SVG viewBox 宽（内部坐标系，与实际渲染宽度解耦）。 */
  CHART_VIEW_WIDTH: 320,
  GRID_LINES: 4,
  EASINGS: ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const,
})

/** 所有可关键帧参数定义（按展示顺序去重）。 */
const KEYFRAMABLE_PARAMS: readonly ParamDefinition[] = [
  ...VISUAL_ELEMENT_PARAMS,
  ...AUDIO_ELEMENT_PARAMS,
  ...TEXT_ELEMENT_PARAMS,
  ...MASK_ELEMENT_PARAMS,
  ...EFFECT_ELEMENT_PARAMS,
].filter((param) => param.keyframable && param.control === 'number')

/** 当前拖动状态：参数 key + 关键帧索引。 */
interface DragState {
  key: string
  index: number
}

/** 图表中一条参数轨道。 */
interface CurveTrack {
  key: string
  label: string
  definition: ParamDefinition | undefined
  frames: AnimationKeyframe[]
}

export interface CurveEditorProps {
  selected: CoreElement | null
  /** 播放头绝对 ticks，画播放头竖线。 */
  playheadTicks?: number
  /** 动画轨道写回回调。 */
  onChange?: (patch: ClipPatch) => void
}

/**
 * 曲线编辑器：把选中元素的动画轨道渲染为可交互 SVG 折线。
 * @param props selected/playheadTicks/onChange
 * @returns {ReactNode} 编辑器面板
 */
export function CurveEditor({ selected, playheadTicks, onChange }: CurveEditorProps): ReactNode {
  const svgRefs = useRef<Record<string, SVGSVGElement | null>>({})
  const [drag, setDrag] = useState<DragState | null>(null)
  const [selectedPoint, setSelectedPoint] = useState<DragState | null>(null)

  const tracks = useMemo<CurveTrack[]>(() => {
    if (!selected) return []
    const raw = readAnimationTracks(selected)
    return Object.entries(raw)
      .filter(([, frames]) => Array.isArray(frames) && frames.length > 0)
      .map(([key, frames]) => ({
        key,
        label: KEYFRAMABLE_PARAMS.find((p) => p.key === key)?.label ?? key,
        definition: KEYFRAMABLE_PARAMS.find((p) => p.key === key),
        frames: frames.map((f) => ({ ...f })),
      }))
  }, [selected])

  /** 把新轨道表写回元素（经 ClipPatch，editor 同步预览与文档）。 */
  const commitTracks = (nextTracks: Record<string, AnimationKeyframe[]>) => {
    onChange?.({ params: { [ANIMATION_TRACKS_KEY]: nextTracks } })
  }

  /** 把当前元素某参数轨道的某帧替换为新帧并写回。 */
  const updateFrame = (key: string, index: number, patch: Partial<AnimationKeyframe>) => {
    if (!selected) return
    const raw = readAnimationTracks(selected)
    const frames = raw[key] ?? []
    if (!frames[index]) return
    const next = frames.map((frame, i) => i === index ? { ...frame, ...patch } : { ...frame })
    const tracksAfter = { ...raw, [key]: next.sort((a, b) => a.time - b.time) }
    // 排序后索引可能变化，重新定位被改帧（按 time+value 精确匹配）。
    const sortedIndex = tracksAfter[key].findIndex((f) => f.time === patch.time && f.value === patch.value)
    commitTracks(tracksAfter)
    return sortedIndex >= 0 ? sortedIndex : index
  }

  /** 在给定位置新增关键帧（双击空白）。 */
  const addFrameAt = (key: string, time: number, value: number) => {
    if (!selected) return
    const withFrame = upsertKeyframe(selected, key, {
      time, value, easing: 'linear',
    })
    commitTracks((withFrame.params?.[ANIMATION_TRACKS_KEY] ?? {}) as Record<string, AnimationKeyframe[]>)
  }

  /** 删除一个关键帧（右键点）。 */
  const deleteFrameAt = (key: string, index: number) => {
    if (!selected) return
    commitTracks(removeKeyframeAt(readAnimationTracks(selected), key, index))
    setSelectedPoint(null)
  }

  /**
   * 把鼠标事件换算为 viewBox 坐标（preserveAspectRatio=none 拉伸，需按比例映射）。
   * @returns {x, y} viewBox 坐标，SVG 缺失时返回 null
   */
  const toChartPoint = (event: React.MouseEvent<SVGSVGElement>, key: string) => {
    const svg = svgRefs.current[key]
    if (!svg) return null
    const rect = svg.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0) return null
    return {
      x: (event.clientX - rect.left) * (UI.CHART_VIEW_WIDTH / rect.width),
      y: (event.clientY - rect.top) * (CURVE_CHART.TRACK_HEIGHT_PX / rect.height),
    }
  }

  return (
    <div className="classic-curve-editor" data-testid="classic-curve-editor"
      style={{ display: 'flex', flexDirection: 'column', gap: UI.TRACK_GAP_PX, padding: 8, overflow: 'auto' }}>
      <div style={{ fontSize: 'var(--text-sm)', fontWeight: 600 }}>{UI.TITLE}</div>
      {tracks.length === 0 ? (
        <div style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-xs)' }}>{UI.EMPTY}</div>
      ) : (
        <>
          <div style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-xs)' }}>{UI.HINT}</div>
          {tracks.map((track) => {
            const duration = selected ? selected.duration : 0
            const range = resolveValueRange(
              track.definition?.min, track.definition?.max, track.frames,
              typeof track.definition?.defaultValue === 'number' ? track.definition.defaultValue : 0,
            )
            const height = CURVE_CHART.TRACK_HEIGHT_PX
            const sample = (t: number) => sampleKeyframes(track.frames, t) ?? 0
            const points = buildCurvePoints(track.frames, sample, duration, UI.CHART_VIEW_WIDTH, range, height)
            const playheadX = playheadTicks !== undefined && selected
              ? timeToX(Math.max(0, playheadTicks - selected.startTime), duration, UI.CHART_VIEW_WIDTH)
              : null
            return (
              <div key={track.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span title={track.key}
                  style={{ width: UI.LABEL_WIDTH_PX, flex: '0 0 auto', fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {track.label}
                </span>
                <svg ref={(el) => { svgRefs.current[track.key] = el }} width="100%" height={height}
                  viewBox={`0 0 ${UI.CHART_VIEW_WIDTH} ${height}`} preserveAspectRatio="none"
                  data-testid={`curve-track-${track.key}`}
                  style={{ background: 'var(--background)', border: '1px solid var(--border)', borderRadius: 4, cursor: 'crosshair' }}
                  onMouseMove={(event) => {
                    if (!drag || drag.key !== track.key) return
                    const point = toChartPoint(event, track.key)
                    if (!point) return
                    const newTime = xToTime(point.x, duration, UI.CHART_VIEW_WIDTH)
                    const newValue = yToValue(point.y, range, height)
                    const idx = updateFrame(track.key, drag.index, { time: newTime, value: newValue })
                    if (idx !== undefined) setDrag({ key: track.key, index: idx })
                  }}
                  onMouseUp={() => setDrag(null)}
                  onMouseLeave={() => setDrag(null)}
                  onDoubleClick={(event) => {
                    const point = toChartPoint(event, track.key)
                    if (!point) return
                    addFrameAt(track.key, xToTime(point.x, duration, UI.CHART_VIEW_WIDTH), yToValue(point.y, range, height))
                  }}>
                  {/* 网格横线 */}
                  {Array.from({ length: UI.GRID_LINES + 1 }, (_, i) => (
                    <line key={`h${i}`} x1={0} x2={UI.CHART_VIEW_WIDTH}
                      y1={(i / UI.GRID_LINES) * height} y2={(i / UI.GRID_LINES) * height}
                      stroke="var(--border)" strokeWidth={0.5} />
                  ))}
                  {/* 播放头竖线 */}
                  {playheadX !== null && (
                    <line x1={playheadX} x2={playheadX} y1={0} y2={height} stroke="var(--primary)" strokeDasharray="3 2" strokeWidth={1} />
                  )}
                  {/* 曲线折线 */}
                  {points && <polyline points={points} fill="none" stroke="var(--primary)" strokeWidth={1.5} />}
                  {/* 关键帧点（菱形） */}
                  {track.frames.map((frame, index) => {
                    const cx = timeToX(frame.time, duration, UI.CHART_VIEW_WIDTH)
                    const cy = valueToY(frame.value, range, height)
                    const active = selectedPoint?.key === track.key && selectedPoint.index === index
                    return (
                      <rect key={index} x={cx - CURVE_CHART.POINT_RADIUS_PX} y={cy - CURVE_CHART.POINT_RADIUS_PX}
                        width={CURVE_CHART.POINT_RADIUS_PX * 2} height={CURVE_CHART.POINT_RADIUS_PX * 2}
                        transform={`rotate(45 ${cx} ${cy})`}
                        fill={active ? 'var(--primary)' : 'var(--background)'}
                        stroke="var(--primary)" strokeWidth={1.5}
                        data-testid={`curve-point-${track.key}-${index}`}
                        style={{ cursor: 'grab' }}
                        onMouseDown={(event) => {
                          event.stopPropagation()
                          setSelectedPoint({ key: track.key, index })
                          setDrag({ key: track.key, index })
                        }}
                        onContextMenu={(event) => { event.preventDefault(); deleteFrameAt(track.key, index) }} />
                    )
                  })}
                </svg>
              </div>
            )
          })}
          {/* 选中点的缓动切换 */}
          {selectedPoint && (() => {
            const track = tracks.find((t) => t.key === selectedPoint.key)
            const frame = track?.frames[selectedPoint.index]
            if (!frame) return null
            return (
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-xs)' }}>
                {UI.EASING_LABEL}
                <select value={frame.easing} data-testid="curve-easing-select"
                  onChange={(event) => updateFrame(selectedPoint.key, selectedPoint.index, {
                    easing: event.target.value as AnimationKeyframe['easing'],
                  })}>
                  {UI.EASINGS.map((easing) => <option key={easing} value={easing}>{easing}</option>)}
                </select>
              </label>
            )
          })()}
        </>
      )}
    </div>
  )
}
