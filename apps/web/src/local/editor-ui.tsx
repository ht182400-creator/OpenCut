/**
 * 编辑器共享 UI 片段（W-08 第二批）：样式常量、时间轴组件与空档帧工具。
 * 从 `routes/editor.tsx` 抽离，保持单个代码文件不超过 500 行。
 */
import type { CSSProperties } from 'react'

import type { TimelineClip } from './timeline'

/** 预览帧尺寸。 */
export const PREVIEW_WIDTH = 320
export const PREVIEW_HEIGHT = 180

/** 深色面板内的主文字色 / 次要文字色。 */
export const TEXT_MAIN = '#e5e7eb'
export const TEXT_MUTED = '#94a3b8'

export const PANEL_STYLE: CSSProperties = {
  background: '#111827',
  border: '1px solid #334155',
  borderRadius: 8,
  padding: 16,
  marginBottom: 12,
  color: TEXT_MAIN,
}
export const BUTTON_STYLE: CSSProperties = {
  background: '#334155',
  color: TEXT_MAIN,
  border: '1px solid #475569',
  borderRadius: 6,
  padding: '7px 12px',
  fontSize: 13,
  cursor: 'pointer',
  display: 'inline-block',
}
const TRACK_STYLE: CSSProperties = {
  position: 'relative',
  height: 36,
  background: '#1f2937',
  borderRadius: 6,
  overflow: 'hidden',
}

/** 时间轴片段：在 core 的 TimedElement 之外额外携带素材裁剪起点。 */
export interface CoreElement extends TimelineClip {
  id: string
  startTime: number
  duration: number
  trimStart: number
}

/** 空档帧：不透明黑底，交给 core 叠加图层。 */
export function blankFrame(): Uint8Array {
  const pixels = new Uint8Array(PREVIEW_WIDTH * PREVIEW_HEIGHT * 4)
  for (let offset = 3; offset < pixels.length; offset += 4) pixels[offset] = 255
  return pixels
}

/**
 * 可点击的时间轴：按 ticks 归一化定位，选中片段后可执行删除/分割。
 * @param props 元素、选中项与回调
 * @returns {React.ReactElement} 时间轴
 */
export function Timeline(props: {
  elements: CoreElement[]
  selectedId: string | null
  onSelect?: (id: string) => void
}) {
  const total = Math.max(...props.elements.map((item) => item.startTime + item.duration), 1)
  return (
    <div style={TRACK_STYLE}>
      {props.elements.map((element) => (
        <div
          key={element.id}
          onClick={() => props.onSelect?.(element.id)}
          title={`${element.id}: ${element.startTime} + ${element.duration} ticks, trim=${element.trimStart}`}
          style={{
            position: 'absolute',
            left: `${(element.startTime / total) * 100}%`,
            width: `${(element.duration / total) * 100}%`,
            height: '100%',
            background: element.id.includes('intro') || element.id.includes('title')
              ? '#6366f1'
              : '#22c55e',
            color: '#ffffff',
            fontSize: 12,
            padding: '8px 6px',
            boxSizing: 'border-box',
            borderRight: '1px solid #111827',
            outline: props.selectedId === element.id ? '2px solid #fbbf24' : 'none',
            outlineOffset: -2,
            cursor: props.onSelect ? 'pointer' : 'default',
          }}
        >
          {element.id}
        </div>
      ))}
    </div>
  )
}
