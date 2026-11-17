/**
 * 经典版 UI 像素级 1:1 改造 · 批 4 属性面板（本地重写，不拷贝经典版 React/zustand 源码）。
 *
 * 结构对照经典版 `components/editor/panels/properties/`：
 * - 三种状态：未选中空状态（It's empty here）、多选、单选（左侧 32px 图标 tab + 右侧滚动参数区）
 * - 参数字段：label 在上、输入在下、label 左侧关键帧菱形开关
 * - 注册表按元素类型分发（text/video/image/sticker/graphic/audio/effect）
 *
 * 边界：core 只支持时间属性（start/duration/trim）编辑，transform/opacity/text 等参数
 * 为只读占位（属批 7 core 扩展），工程真实可编辑的时间字段放在专属 Timing tab。
 * 尺寸/文案来自 properties-tokens.ts；图标为本地绘制 SVG。
 */

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { ClipPatch, CoreElement } from '../editor-ui';
import {
  AUDIO_ELEMENT_PARAMS,
  PROPERTIES_EMPTY_GAP_PX,
  PROPERTIES_EMPTY_PADDING_PX,
  PROPERTIES_EMPTY_PRIMARY,
  PROPERTIES_EMPTY_SECONDARY,
  PROPERTIES_EMPTY_TEXT_GAP_PX,
  PROPERTIES_FIELD_INNER_GAP_PX,
  PROPERTIES_KEYFRAME_ICON_SIZE_PX,
  PROPERTIES_KEYFRAME_TITLE_PREFIX,
  PROPERTIES_KEYFRAME_TITLE_SUFFIX,
  PROPERTIES_LABEL_GAP_PX,
  PROPERTIES_LABEL_ROW_HEIGHT_PX,
  PROPERTIES_MULTI_SELECT_SUFFIX,
  PROPERTIES_NUMBER_FIELD_HEIGHT_PX,
  PROPERTIES_NUMBER_ICON_SIZE_PX,
  PROPERTIES_PARAMS_BY_TYPE,
  PROPERTIES_SECTION_CONTENT_PADDING_PX,
  PROPERTIES_SECTION_FIELDS_GAP_PX,
  PROPERTIES_SUFFIX_GAP_PX,
  PROPERTIES_TABBAR_PADDING_PX,
  PROPERTIES_TAB_GAP_PX,
  PROPERTIES_TAB_LABELS,
  PROPERTIES_TAB_SIZE_PX,
  PROPERTIES_TABS_BY_TYPE,
  TEXT_ELEMENT_PARAMS,
  VISUAL_ELEMENT_PARAMS,
  type ParamDefinition,
} from './properties-tokens';

/** 面板选中项（当前工程只有 main 轨视频片段；type 固定 video，保留扩展位）。 */
export interface PropertiesSelection {
  element: CoreElement
  elementType?: 'video' | 'text' | 'image' | 'audio' | 'sticker' | 'graphic' | 'effect'
}

export interface PropertiesPanelProps {
  selected: CoreElement | null
  /** 选中元素数量（>1 显示多选文案；当前工程单轨只会是 0 或 1）。 */
  selectedCount?: number
  onChange?: (patch: ClipPatch) => void
}

/** tab 图标 path（本地绘制，形状对齐经典版 Hugeicons）。 */
const TAB_ICON_PATHS: Record<string, string[]> = {
  transform: ['M4 9V4h5', 'M20 15v5h-5', 'M4 4l6 6', 'M20 20l-6-6', 'M15 4h5v5', 'M9 20H4v-5', 'M20 4l-6 6', 'M4 20l6-6'],
  blending: ['M12 3s6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 6-10 6-10z'],
  audio: ['M9 18V5l12-2v13', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0', 'M21 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0'],
  speed: ['M12 14l4-4', 'M12 3a9 9 0 1 0 9 9', 'M12 3v3'],
  text: ['M4 6V4h16v2', 'M9 20h6', 'M12 4v16'],
  effects: ['M12 3l1.8 4.2L18 9l-4.2 1.8L12 15l-1.8-4.2L6 9l4.2-1.8z'],
  masks: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
  graphic: ['M12 3l9 5-9 5-9-5z', 'M3 13l9 5 9-5'],
}

/** 按名字取 tab 图标 SVG。 */
function TabIcon({ name }: { name: string }): ReactNode {
  const paths = TAB_ICON_PATHS[name] ?? TAB_ICON_PATHS.transform
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths.map((d, index) => <path key={index} d={d} />)}
    </svg>
  )
}

/** 空状态齿轮图标（经典版 Settings05Icon 同位置形状）。 */
function EmptyGear(): ReactNode {
  return (
    <svg width={40} height={40} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={1} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.6a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  )
}

/** 关键帧菱形开关（label 左侧，本地状态仅视觉占位；动画关键帧属批 7）。 */
function KeyframeToggle({ param, active, onToggle }: {
  param: ParamDefinition
  active: boolean
  onToggle: () => void
}) {
  return (
    <button type="button" aria-pressed={active}
      title={`${PROPERTIES_KEYFRAME_TITLE_PREFIX}${param.label.toLowerCase()}${PROPERTIES_KEYFRAME_TITLE_SUFFIX}`}
      onClick={onToggle}
      style={{
        width: PROPERTIES_KEYFRAME_ICON_SIZE_PX, height: PROPERTIES_KEYFRAME_ICON_SIZE_PX,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: 'none', background: 'transparent', cursor: 'pointer', padding: 0,
        color: active ? 'var(--primary)' : 'var(--muted-foreground)',
      }}>
      <svg width={PROPERTIES_KEYFRAME_ICON_SIZE_PX} height={PROPERTIES_KEYFRAME_ICON_SIZE_PX}
        viewBox="0 0 14 14" fill={active ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.2} aria-hidden="true">
        <path d="M7 1.5L12.5 7 7 12.5 1.5 7z" />
      </svg>
    </button>
  )
}

/** 参数字段：label（含关键帧开关）在上、输入框在下，全部只读占位。 */
function ParamField({ param, keyframes, onKeyframe }: {
  param: ParamDefinition
  keyframes: Record<string, boolean>
  onKeyframe: (key: string) => void
}) {
  const commonInput: CSSProperties = {
    width: '100%', height: PROPERTIES_NUMBER_FIELD_HEIGHT_PX, boxSizing: 'border-box',
    background: 'var(--accent)', color: 'var(--foreground)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
    padding: `0 ${PROPERTIES_NUMBER_ICON_SIZE_PX / 2}px`, fontSize: 'var(--text-sm)',
  }
  let control: ReactNode
  switch (param.control) {
    case 'boolean':
      control = (
        <input type="checkbox" disabled checked={Boolean(param.defaultValue)}
          aria-label={param.label} style={{ accentColor: 'var(--primary)' }} />
      )
      break
    case 'select':
      control = (
        <select disabled aria-label={param.label} value={String(param.defaultValue)} style={commonInput}>
          {(param.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      )
      break
    case 'text':
      control = <textarea disabled aria-label={param.label} value={String(param.defaultValue)}
        style={{ ...commonInput, height: 60, padding: 6, resize: 'vertical' }} />
      break
    case 'color':
      control = (
        <div style={{ display: 'flex', alignItems: 'center', gap: PROPERTIES_SUFFIX_GAP_PX }}>
          <input type="color" disabled aria-label={param.label} value={String(param.defaultValue)}
            style={{ width: PROPERTIES_NUMBER_FIELD_HEIGHT_PX, height: PROPERTIES_NUMBER_FIELD_HEIGHT_PX, padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent' }} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>{String(param.defaultValue)}</span>
        </div>
      )
      break
    default:
      control = (
        <input type="number" disabled aria-label={param.label}
          value={String(param.defaultValue)}
          style={{ ...commonInput, paddingLeft: `${PROPERTIES_NUMBER_ICON_SIZE_PX + PROPERTIES_SUFFIX_GAP_PX}px` }} />
      )
      break
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: PROPERTIES_FIELD_INNER_GAP_PX }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: PROPERTIES_LABEL_GAP_PX,
        height: PROPERTIES_LABEL_ROW_HEIGHT_PX,
        fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)', fontWeight: 500,
      }}>
        {param.keyframable && (
          <KeyframeToggle param={param} active={Boolean(keyframes[param.key])}
            onToggle={() => onKeyframe(param.key)} />
        )}
        <span>{param.label}</span>
      </div>
      {control}
    </div>
  )
}

/** 参数集 TAB 渲染：按 paramKeys 顺序过滤显示字段（依赖字段仅 enabled 时显示）。 */
function ParamsSection({ params, keys, keyframes, onKeyframe }: {
  params: readonly ParamDefinition[]
  keys: readonly string[]
  keyframes: Record<string, boolean>
  onKeyframe: (key: string) => void
}) {
  return (
    <div style={{ padding: PROPERTIES_SECTION_CONTENT_PADDING_PX, display: 'flex', flexDirection: 'column', gap: PROPERTIES_SECTION_FIELDS_GAP_PX }}>
      {keys.map((key) => {
        const param = params.find((item) => item.key === key)
        if (!param) return null
        if (param.dependsOn && !keyframes[param.dependsOn]) return null
        return <ParamField key={key} param={param} keyframes={keyframes} onKeyframe={onKeyframe} />
      })}
    </div>
  )
}

/** 安全读取 trimEnd：core 的 CoreElement 类型缺该字段但运行时快照包含，做兼容断言。 */
function readTrimEnd(element: CoreElement): number {
  return (element as CoreElement & { trimEnd?: number }).trimEnd ?? 0
}

/** 工程专属 Timing tab：真实可编辑的时间字段 + 批 7.5 文本字段（name/content）。 */
function TimingSection({ selected, onChange }: {
  selected: CoreElement
  onChange?: (patch: ClipPatch) => void
}) {
  const initialDraft = (): Record<keyof ClipPatch, string> => ({
    startTime: String(selected.startTime), duration: String(selected.duration),
    trimStart: String(selected.trimStart), trimEnd: String(readTrimEnd(selected)),
    name: selected.name ?? '', content: selected.content ?? '',
  })
  const [draft, setDraft] = useState<Record<keyof ClipPatch, string>>(initialDraft)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setDraft(initialDraft())
    setError(null)
  }, [selected])
  // 数值字段子集：key 限定为四个 tick 字段，避免把 name/content 当数字解析。
  type NumericKey = 'startTime' | 'duration' | 'trimStart' | 'trimEnd'
  const fields: Array<{ key: NumericKey; label: string }> = [
    { key: 'startTime', label: 'Start (ticks)' },
    { key: 'duration', label: 'Duration (ticks)' },
    { key: 'trimStart', label: 'Trim In (ticks)' },
    { key: 'trimEnd', label: 'Trim Out (ticks)' },
  ]
  const numberInputStyle: CSSProperties = {
    width: '100%', height: PROPERTIES_NUMBER_FIELD_HEIGHT_PX, boxSizing: 'border-box',
    background: 'var(--accent)', color: 'var(--foreground)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
    padding: `0 ${PROPERTIES_NUMBER_ICON_SIZE_PX / 2}px`, fontSize: 'var(--text-sm)',
  }
  return (
    <div style={{ padding: PROPERTIES_SECTION_CONTENT_PADDING_PX, display: 'flex', flexDirection: 'column', gap: PROPERTIES_SECTION_FIELDS_GAP_PX }}>
      {fields.map(({ key, label }) => (
        <div key={key} style={{ display: 'flex', flexDirection: 'column', gap: PROPERTIES_FIELD_INNER_GAP_PX }}>
          <span style={{ height: PROPERTIES_LABEL_ROW_HEIGHT_PX, fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>{label}</span>
          <input type="number" min={0} step={1000} aria-label={label} value={draft[key]}
            onChange={(event) => setDraft((prev) => ({ ...prev, [key]: event.target.value }))}
            style={numberInputStyle} />
        </div>
      ))}
      {/* 批 7.5：类型特化文本字段，编辑后经 core 写回经典版 JSON。 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: PROPERTIES_FIELD_INNER_GAP_PX }}>
        <span style={{ height: PROPERTIES_LABEL_ROW_HEIGHT_PX, fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>Name</span>
        <input type="text" aria-label="Element Name" value={draft.name}
          onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
          style={numberInputStyle} />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: PROPERTIES_FIELD_INNER_GAP_PX }}>
        <span style={{ height: PROPERTIES_LABEL_ROW_HEIGHT_PX, fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>Content</span>
        <input type="text" aria-label="Element Content" value={draft.content}
          onChange={(event) => setDraft((prev) => ({ ...prev, content: event.target.value }))}
          style={numberInputStyle} />
      </div>
      <div style={{ display: 'flex', gap: PROPERTIES_FIELD_INNER_GAP_PX }}>
        <button type="button" className="classic-button" disabled={!onChange} onClick={() => {
          const patch: ClipPatch = {}
          for (const { key } of fields) {
            const value = Number(draft[key])
            if (!Number.isFinite(value) || value < 0) { setError('Fields must be non-negative numbers'); return }
            patch[key] = Math.round(value)
          }
          // 批 7.5：仅当文本字段与选中值不同才写入，避免误覆盖原值。
          if (draft.name !== (selected.name ?? '')) patch.name = draft.name
          if (draft.content !== (selected.content ?? '')) patch.content = draft.content
          setError(null)
          onChange?.(patch)
        }}>Apply</button>
        <button type="button" className="classic-button" onClick={() => {
          setDraft(initialDraft())
          setError(null)
        }}>Reset</button>
      </div>
      {error && <p style={{ color: 'var(--destructive)', fontSize: 'var(--text-xs)', margin: 0 }}>{error}</p>}
    </div>
  )
}

/**
 * 属性面板（1:1 外壳 + 按类型 tab + 参数注册表）。core 未覆盖的参数为只读占位，
 * 工程真实可编辑的时间字段在专属 Timing tab（差异登记）。
 * @param props 选中元素、数量与编辑回调
 * @returns {React.ReactElement} 属性面板
 */
export function PropertiesPanel(props: PropertiesPanelProps) {
  const elementType: keyof typeof PROPERTIES_TABS_BY_TYPE = 'video'
  const tabs = useMemo(() => [...PROPERTIES_TABS_BY_TYPE[elementType], 'timing' as const], [])
  const [activeTab, setActiveTab] = useState<string>('transform')
  const [keyframes, setKeyframes] = useState<Record<string, boolean>>({ 'background.enabled': false })

  const onKeyframe = (key: string) => {
    setKeyframes((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const count = props.selectedCount ?? (props.selected ? 1 : 0)
  if (count > 1) {
    return (
      <section className="panel classic-panel" data-testid="classic-properties"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <p style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>
          {count}{PROPERTIES_MULTI_SELECT_SUFFIX}
        </p>
      </section>
    )
  }
  if (!props.selected) {
    return (
      <section className="panel classic-panel" data-testid="classic-properties"
        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: PROPERTIES_EMPTY_GAP_PX, padding: PROPERTIES_EMPTY_PADDING_PX, height: '100%',
        }}>
          <span style={{ color: 'color-mix(in srgb, var(--muted-foreground) 75%, transparent)' }}><EmptyGear /></span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: PROPERTIES_EMPTY_TEXT_GAP_PX, textAlign: 'center' }}>
            <span style={{ fontSize: '1.125rem', fontWeight: 500 }}>{PROPERTIES_EMPTY_PRIMARY}</span>
            <span style={{ color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>{PROPERTIES_EMPTY_SECONDARY}</span>
          </div>
        </div>
      </section>
    )
  }

  const paramsForType: readonly string[] = PROPERTIES_PARAMS_BY_TYPE[elementType]
  const params: ParamDefinition[] = [
    ...(paramsForType.includes('text') ? TEXT_ELEMENT_PARAMS : []),
    ...(paramsForType.includes('visual') ? VISUAL_ELEMENT_PARAMS : []),
    ...(paramsForType.includes('audio') ? AUDIO_ELEMENT_PARAMS : []),
  ]

  let content: ReactNode
  if (activeTab === 'timing') {
    content = <TimingSection selected={props.selected} onChange={props.onChange} />
  } else if (activeTab === 'transform') {
    content = <ParamsSection params={params} keys={['transform.positionX', 'transform.positionY', 'transform.scaleX', 'transform.scaleY', 'transform.rotate']} keyframes={keyframes} onKeyframe={onKeyframe} />
  } else if (activeTab === 'blending') {
    content = <ParamsSection params={params} keys={['opacity', 'blendMode']} keyframes={keyframes} onKeyframe={onKeyframe} />
  } else if (activeTab === 'audio') {
    content = <ParamsSection params={params} keys={['volume', 'muted']} keyframes={keyframes} onKeyframe={onKeyframe} />
  } else if (activeTab === 'text') {
    content = <ParamsSection params={params} keys={TEXT_ELEMENT_PARAMS.map((p) => p.key)} keyframes={keyframes} onKeyframe={onKeyframe} />
  } else {
    content = (
      <div style={{ padding: PROPERTIES_SECTION_CONTENT_PADDING_PX, color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>
        {PROPERTIES_TAB_LABELS[activeTab as keyof typeof PROPERTIES_TAB_LABELS] ?? activeTab} 参数需 core 扩展（批 7），当前为占位。
      </div>
    )
  }

  return (
    <section className="panel classic-panel classic-panel-row" data-testid="classic-properties" style={{ height: '100%' }}>
      <div className="classic-tabbar" role="tablist" aria-label="Properties"
        style={{ gap: PROPERTIES_TAB_GAP_PX, padding: PROPERTIES_TABBAR_PADDING_PX }}>
        {tabs.map((tab) => (
          <button key={tab} type="button" className="classic-tab" role="tab"
            aria-selected={activeTab === tab} data-active={activeTab === tab}
            title={tab === 'timing' ? 'Timing' : PROPERTIES_TAB_LABELS[tab]}
            aria-label={tab === 'timing' ? 'Timing' : PROPERTIES_TAB_LABELS[tab]}
            style={{ width: PROPERTIES_TAB_SIZE_PX, height: PROPERTIES_TAB_SIZE_PX }}
            onClick={() => setActiveTab(tab)}>
            <TabIcon name={tab} />
          </button>
        ))}
      </div>
      <div className="classic-tab-separator" />
      <div className="classic-panel-content" role="tabpanel">{content}</div>
    </section>
  )
}
