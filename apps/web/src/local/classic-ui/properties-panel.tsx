/**
 * 经典版 UI 像素级 1:1 改造 · 批 4 属性面板（本地重写，不拷贝经典版 React/zustand 源码）。
 *
 * 结构对照经典版 `components/editor/panels/properties/`：
 * - 三种状态：未选中空状态（It's empty here）、多选、单选（左侧 32px 图标 tab + 右侧滚动参数区）
 * - 参数字段：label 在上、输入在下、label 左侧关键帧菱形开关
 * - 注册表按元素类型分发（text/video/image/sticker/graphic/audio/effect）
 *
 * P0 起参数字段改为「受控可编辑」：数值/文本/下拉等改动经 `ClipPatch` 上送，
 * 由 editor 写入元素 `params` 并驱动预览；不再有 disabled 只读占位。
 * 尺寸/文案来自 properties-tokens.ts；图标为本地绘制 SVG。
 */

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';

import type { ClipPatch, CoreElement } from '../editor-ui';
import {
  ANIMATION_TRACKS_KEY,
  DEFAULT_KEYFRAME_EASING,
  PARAM_KEY_TO_FLAT,
  normalizeElementParams,
  readAnimationTracks,
  removeKeyframeTrack,
  toFlatParamKey,
  upsertKeyframe,
} from '../element-model';
import {
  AUDIO_ELEMENT_PARAMS,
  EFFECT_ELEMENT_PARAMS,
  MASK_ELEMENT_PARAMS,
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
  PROPERTIES_DEFAULT_TAB_BY_TYPE,
  TEXT_ELEMENT_PARAMS,
  VISUAL_ELEMENT_PARAMS,
  type ParamDefinition,
} from './properties-tokens';
import { CurveEditor } from './curve-editor';

/** 属性面板支持的元素类型（与注册表 key 对齐）。 */
type PropertiesElementType = keyof typeof PROPERTIES_TABS_BY_TYPE;

/** 面板选中项（保留扩展位；实际类型取自 CoreElement.elementType）。 */
export interface PropertiesSelection {
  element: CoreElement
  elementType?: PropertiesElementType
}

export interface PropertiesPanelProps {
  selected: CoreElement | null
  /** 选中元素数量（>1 显示多选文案；当前工程单轨只会是 0 或 1）。 */
  selectedCount?: number
  /** 属性变更回调：时间字段与 params 以 ClipPatch 结构上送。 */
  onChange?: (patch: ClipPatch) => void
  /** P2：当前播放头绝对 ticks，供关键帧在播放头打点。 */
  playheadTicks?: number
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

/**
 * 把字符串元素类型归一到属性面板注册表的 key（未知类型按 video）。
 * @param value 元素类型字符串
 * @returns {PropertiesElementType} 注册表 key
 */
function toPropertiesElementType(value?: string): PropertiesElementType {
  return value && value in PROPERTIES_TABS_BY_TYPE
    ? value as PropertiesElementType
    : 'video'
}

/** 关键帧菱形开关（label 左侧；动画关键帧编辑属 P2，此处仅切换视觉标记）。 */
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

/** 把输入字符串按参数约束解析为合法值；非法返回 null。 */
function parseParamValue(param: ParamDefinition, raw: string): number | string | boolean | null {
  if (param.control === 'number') {
    const value = Number(raw)
    if (!Number.isFinite(value)) return null
    const min = param.min ?? -Infinity
    const max = param.max ?? Infinity
    return Math.min(max, Math.max(min, value))
  }
  if (param.control === 'boolean') return raw === 'true'
  return raw
}

/**
 * 参数字段：受控可编辑。数值/文本用本地草稿，失焦或按 Enter 时提交，
 * 避免逐字符上送污染撤销历史；下拉/勾选/颜色即时提交。
 */
function ParamField({ param, keyframes, onKeyframe, value, onChange }: {
  param: ParamDefinition
  keyframes: Record<string, boolean>
  onKeyframe: (key: string) => void
  value: number | string | boolean
  onChange?: (key: string, next: number | string | boolean) => void
}) {
  const [draft, setDraft] = useState(() => String(value))
  useEffect(() => { setDraft(String(value)) }, [value])

  const commonInput: CSSProperties = {
    width: '100%', height: PROPERTIES_NUMBER_FIELD_HEIGHT_PX, boxSizing: 'border-box',
    background: 'var(--accent)', color: 'var(--foreground)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-md)',
    padding: `0 ${PROPERTIES_NUMBER_ICON_SIZE_PX / 2}px`, fontSize: 'var(--text-sm)',
  }
  const commitDraft = () => {
    const parsed = parseParamValue(param, draft)
    if (parsed !== null && parsed !== value) onChange?.(param.key, parsed)
    else setDraft(String(value))
  }
  let control: ReactNode
  switch (param.control) {
    case 'boolean':
      control = (
        <input type="checkbox" checked={Boolean(value)}
          aria-label={param.label} style={{ accentColor: 'var(--primary)' }}
          onChange={(event) => onChange?.(param.key, event.target.checked)} />
      )
      break
    case 'select':
      control = (
        <select aria-label={param.label} value={String(value)} style={commonInput}
          onChange={(event) => onChange?.(param.key, event.target.value)}>
          {(param.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      )
      break
    case 'text':
      control = (
        <textarea aria-label={param.label} value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitDraft() } }}
          style={{ ...commonInput, height: 60, padding: 6, resize: 'vertical' }} />
      )
      break
    case 'color':
      control = (
        <div style={{ display: 'flex', alignItems: 'center', gap: PROPERTIES_SUFFIX_GAP_PX }}>
          <input type="color" aria-label={param.label} value={String(value)}
            style={{ width: PROPERTIES_NUMBER_FIELD_HEIGHT_PX, height: PROPERTIES_NUMBER_FIELD_HEIGHT_PX, padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'transparent' }}
            onChange={(event) => onChange?.(param.key, event.target.value)} />
          <span style={{ fontSize: 'var(--text-xs)', color: 'var(--muted-foreground)' }}>{String(value)}</span>
        </div>
      )
      break
    default:
      control = (
        <input type="number" aria-label={param.label}
          min={param.min} max={param.max} step={param.step}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commitDraft}
          onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); commitDraft() } }}
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

/**
 * 参数集 TAB 渲染：按 paramKeys 顺序过滤显示字段（依赖字段仅 enabled 时显示）。
 */
function ParamsSection({ params, keys, keyframes, onKeyframe, values, onParamChange }: {
  params: readonly ParamDefinition[]
  keys: readonly string[]
  keyframes: Record<string, boolean>
  onKeyframe: (key: string) => void
  values: Record<string, number | string | boolean>
  onParamChange: (key: string, value: number | string | boolean) => void
}) {
  return (
    <div style={{ padding: PROPERTIES_SECTION_CONTENT_PADDING_PX, display: 'flex', flexDirection: 'column', gap: PROPERTIES_SECTION_FIELDS_GAP_PX }}>
      {keys.map((key) => {
        const param = params.find((item) => item.key === key)
        if (!param) return null
        if (param.dependsOn && !keyframes[param.dependsOn]) return null
        return (
          <ParamField key={key} param={param} keyframes={keyframes} onKeyframe={onKeyframe}
            value={values[key] ?? param.defaultValue} onChange={onParamChange} />
        )
      })}
    </div>
  )
}

/** 安全读取 trimEnd：CoreElement 的可选字段做兼容断言。 */
function readTrimEnd(element: CoreElement): number {
  return element.trimEnd ?? 0
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
    params: '',
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
 * 属性面板（1:1 外壳 + 按类型 tab + 参数注册表）。P0 起参数字段受控可编辑，
 * 改动经 ClipPatch.params 上送，驱动预览；时间字段仍在 Timing tab。
 * @param props 选中元素、数量与编辑回调
 * @returns {React.ReactElement} 属性面板
 */
export function PropertiesPanel(props: PropertiesPanelProps) {
  const elementType = toPropertiesElementType(props.selected?.elementType)
  const tabs = useMemo(
    () => [...PROPERTIES_TABS_BY_TYPE[elementType], 'timing' as const],
    [elementType],
  )
  const defaultTab = PROPERTIES_DEFAULT_TAB_BY_TYPE[elementType] as string
  const [activeTab, setActiveTab] = useState<string>(defaultTab)
  /** P3 批 3：曲线编辑器视图开关（与参数 tab 并列，由关键帧轨道存在性启用）。 */
  const [showCurves, setShowCurves] = useState(false)

  // 元素类型变化时切到该类型的默认 tab，避免停留在不存在的 tab（如 text 的 Content）。
  useEffect(() => { setActiveTab(defaultTab) }, [defaultTab])

  // P2：关键帧开关状态从元素真实动画轨道派生（不再是纯本地视觉态）。
  const tracks = props.selected ? readAnimationTracks(props.selected) : {}
  const keyframes: Record<string, boolean> = {}
  for (const key of Object.keys(tracks)) keyframes[key] = (tracks[key]?.length ?? 0) > 0

  /**
   * P2：菱形开关 = 在播放头打/删关键帧。打点时取当前参数值写入动画轨道，
   * 由 element-composite 每帧采样插值；删除则移除整条轨道。
   */
  const onKeyframe = (key: string) => {
    if (!props.selected || !props.onChange) return
    const element = props.selected
    if (keyframes[key]) {
      props.onChange({ params: { [ANIMATION_TRACKS_KEY]: removeKeyframeTrack(element, key).params?.[ANIMATION_TRACKS_KEY] ?? {} } })
      return
    }
    const raw = element.params?.[toFlatParamKey(key)] ?? element.params?.[key]
    const value = typeof raw === 'number' ? raw : Number((params.find((p) => p.key === key)?.defaultValue) ?? 0)
    const relativeTime = Math.max(0, Math.round((props.playheadTicks ?? 0) - element.startTime))
    const withKeyframe = upsertKeyframe(element, key, {
      time: relativeTime, value: Number.isFinite(value) ? value : 0, easing: DEFAULT_KEYFRAME_EASING,
    })
    props.onChange({ params: { [ANIMATION_TRACKS_KEY]: withKeyframe.params?.[ANIMATION_TRACKS_KEY] ?? {} } })
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

  const selected = props.selected
  const normalized = normalizeElementParams(selected.params)
  const values: Record<string, number | string | boolean> = {
    opacity: normalized.opacity,
    positionX: normalized.positionX,
    positionY: normalized.positionY,
    scaleX: normalized.scaleX,
    scaleY: normalized.scaleY,
    rotate: normalized.rotate,
  }
  if (selected.content !== undefined) values.content = selected.content
  // 从透传字段中挑选基础类型值（颜色/字号/字体等），排除对象/数组。
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
      values[key] = value
    }
  }
  values.volume = typeof normalized.volume === 'number' ? normalized.volume : 0
  values.muted = typeof normalized.muted === 'boolean' ? normalized.muted : false
  // P2：遮罩/效果默认值（元素未显式设置时也要显示合理默认，避免输入框空值）。
  for (const param of [...MASK_ELEMENT_PARAMS, ...EFFECT_ELEMENT_PARAMS]) {
    if (values[param.key] === undefined) values[param.key] = param.defaultValue
  }

  // P2 修复：注册表用 transform.positionX 等点分 key，而 ElementParams 存扁平 positionX；
  // 这里先把扁平字段镜像成点分 key，编辑时再映射回去，避免改了面板却不驱动预览。
  const flatRecord = normalized as unknown as Record<string, number>
  for (const [dotted, flat] of Object.entries(PARAM_KEY_TO_FLAT)) {
    values[dotted] = flatRecord[flat]
  }

  const onParamChange = (key: string, value: number | string | boolean) => {
    // content 是 CoreElement 顶层字段（写回经典版 JSON 用），其余写入 params。
    if (key === 'content') props.onChange?.({ content: String(value) })
    else props.onChange?.({ params: { [toFlatParamKey(key)]: value } })
  }

  const paramsForType: readonly string[] = PROPERTIES_PARAMS_BY_TYPE[elementType]
  // P2：遮罩/效果参数按「该类型是否有对应 tab」决定（PROPERTIES_PARAMS_BY_TYPE 不含这两组）。
  const typeTabs: readonly string[] = PROPERTIES_TABS_BY_TYPE[elementType]
  const params: ParamDefinition[] = [
    ...(paramsForType.includes('text') ? TEXT_ELEMENT_PARAMS : []),
    ...(paramsForType.includes('visual') ? VISUAL_ELEMENT_PARAMS : []),
    ...(paramsForType.includes('audio') ? AUDIO_ELEMENT_PARAMS : []),
    ...(typeTabs.includes('masks') ? MASK_ELEMENT_PARAMS : []),
    ...(typeTabs.includes('effects') ? EFFECT_ELEMENT_PARAMS : []),
  ]

  let content: ReactNode
  if (showCurves) {
    content = <CurveEditor selected={selected} playheadTicks={props.playheadTicks} onChange={props.onChange} />
  } else if (activeTab === 'timing') {
    content = <TimingSection selected={selected} onChange={props.onChange} />
  } else if (activeTab === 'transform') {
    content = <ParamsSection params={params} keys={['transform.positionX', 'transform.positionY', 'transform.scaleX', 'transform.scaleY', 'transform.rotate']} keyframes={keyframes} onKeyframe={onKeyframe} values={values} onParamChange={onParamChange} />
  } else if (activeTab === 'blending') {
    content = <ParamsSection params={params} keys={['opacity', 'blendMode']} keyframes={keyframes} onKeyframe={onKeyframe} values={values} onParamChange={onParamChange} />
  } else if (activeTab === 'audio') {
    content = <ParamsSection params={params} keys={['volume', 'muted']} keyframes={keyframes} onKeyframe={onKeyframe} values={values} onParamChange={onParamChange} />
  } else if (activeTab === 'text') {
    content = <ParamsSection params={params} keys={TEXT_ELEMENT_PARAMS.map((p) => p.key)} keyframes={keyframes} onKeyframe={onKeyframe} values={values} onParamChange={onParamChange} />
  } else if (activeTab === 'masks') {
    content = <ParamsSection params={params} keys={MASK_ELEMENT_PARAMS.map((p) => p.key)} keyframes={keyframes} onKeyframe={onKeyframe} values={values} onParamChange={onParamChange} />
  } else if (activeTab === 'effects') {
    content = <ParamsSection params={params} keys={EFFECT_ELEMENT_PARAMS.map((p) => p.key)} keyframes={keyframes} onKeyframe={onKeyframe} values={values} onParamChange={onParamChange} />
  } else {
    content = (
      <div style={{ padding: PROPERTIES_SECTION_CONTENT_PADDING_PX, color: 'var(--muted-foreground)', fontSize: 'var(--text-sm)' }}>
        {PROPERTIES_TAB_LABELS[activeTab as keyof typeof PROPERTIES_TAB_LABELS] ?? activeTab} 参数暂未接入。
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
            style={{ width: PROPERTIES_TAB_SIZE_PX, height: PROPERTIES_TAB_SIZE_PX,
              opacity: showCurves ? 0.5 : 1 }}
            onClick={() => { setShowCurves(false); setActiveTab(tab) }}>
            <TabIcon name={tab} />
          </button>
        ))}
        {/* P3 批 3：曲线编辑器切换（有关键帧轨道时可用）。 */}
        <button type="button" className="classic-tab" role="tab"
          data-testid="properties-curves-toggle"
          aria-selected={showCurves} data-active={showCurves}
          title="Animation Curves" aria-label="Animation Curves"
          style={{ width: PROPERTIES_TAB_SIZE_PX, height: PROPERTIES_TAB_SIZE_PX }}
          onClick={() => setShowCurves((v) => !v)}>
          <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor"
            strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
            <path d="M3 17l5-6 4 3 5-8 4 4" />
          </svg>
        </button>
      </div>
      <div className="classic-tab-separator" />
      <div className="classic-panel-content" role="tabpanel">{content}</div>
    </section>
  )
}
