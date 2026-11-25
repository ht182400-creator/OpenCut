/**
 * 编辑器元素模型（P0 闭环）：元素的类型/参数契约与纯函数操作。
 *
 * 经典版实证（FEATURE_PARITY.md 附录 A）表明「新增文字/媒体到时间轴」是纯前端
 * 编辑器应用层逻辑（构建元素 → placement 找空位 → 写回内存 tracks → undo），
 * 不依赖 Rust core。本模块即这层轻量 editor store 的核心，全部为无 DOM 纯函数，
 * 便于用边界值/异常/竞态用例充分覆盖。
 */

import type { CoreElement } from './editor-ui';
import type { TimelineClip } from './timeline';

/** 可识别的元素类型（与经典版 elementType 字符串对齐）。 */
export type ElementKind =
  // C 档：字幕元素类型与 core ElementType::Caption 字符串一致（7.1 批已支持 read→write 保真）。
  | 'text' | 'caption' | 'video' | 'image' | 'audio' | 'sticker' | 'graphic' | 'effect';

/** 参与画面合成的变换参数（P0 驱动预览/导出的字段）。 */
export interface ElementVisualParams {
  opacity: number;
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
}

/**
 * 元素参数集合：变换参数为强类型必填，其余字段按 key 透传（经典版参数注册表很长，
 * P0 不逐项建模，但必须保真存储，避免编辑一次就把未知参数抹掉）。
 */
export interface ElementParams extends ElementVisualParams {
  content?: string;
  fontSize?: number;
  color?: string;
  [key: string]: unknown;
}

/** 文字片段默认时长（秒）；来源：经典版默认文字片段接近 5s。 */
export const DEFAULT_TEXT_DURATION_SECONDS = 5;
/** 媒体片段缺省时长（秒）；素材卡片无 duration 时的兜底。 */
export const DEFAULT_MEDIA_DURATION_SECONDS = 8;
/** 新片段之间的最小间隔（ticks），避免首尾紧贴难以点选。 */
export const DEFAULT_ELEMENT_GAP_TICKS = 0;
/** 时间单位：每秒 ticks，与 Rust core / timeline.ts 一致。 */
export const TICKS_PER_SECOND = 120000;

/** 变换参数取值域（防止非法值污染画面合成）。 */
export const OPACITY_MIN = 0;
export const OPACITY_MAX = 1;
export const SCALE_MIN = 0.01;
export const SCALE_MAX = 100;
export const POSITION_LIMIT_PX = 1_000_000;
export const ROTATE_MIN_DEG = -360;
export const ROTATE_MAX_DEG = 360;

/** 新建元素的默认变换参数（identity 变换：不改变画面）。 */
export const IDENTITY_VISUAL_PARAMS: Readonly<ElementVisualParams> = Object.freeze({
  opacity: 1,
  positionX: 0,
  positionY: 0,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
});

/** 默认文字内容，与经典版 Text 卡片一致。 */
export const DEFAULT_TEXT_CONTENT = 'Default text';
/** 默认文字字号（px）与颜色，供预览绘制使用。 */
export const DEFAULT_TEXT_FONT_SIZE_PX = 32;
export const DEFAULT_TEXT_COLOR = '#ffffff';

/** 生成元素 id 的前缀（便于在时间轴/日志中辨认来源）。 */
export const TEXT_ID_PREFIX = 'text';
export const MEDIA_ID_PREFIX = 'media';
/** 第二档项 2：图形元素 id 前缀。 */
export const GRAPHIC_ID_PREFIX = 'graphic';
/** C 档：字幕元素 id 前缀（便于在时间轴/写回 JSON 中辨认来源）。 */
export const CAPTION_ID_PREFIX = 'caption';
/** C 档：字幕默认字号（px），比普通文字小一档，贴近经典版字幕观感。 */
export const DEFAULT_CAPTION_FONT_SIZE_PX = 24;
/** C 档：字幕默认位置相对画布中心的 Y 偏移比例（正值向下，经典版字幕靠底部）。 */
export const CAPTION_POSITION_Y_RATIO = 0.36;
/** 构建字幕时估算默认 Y 偏移的参考画布高度（px）；实际帧尺寸由调用方覆盖。 */
const BASE_CAPTION_CANVAS_HEIGHT_PX = 180;

/**
 * 把任意输入夹逼到 [min, max]；非有限值回落到 fallback。
 * @param value 待校验数值
 * @param min 下界
 * @param max 上界
 * @param fallback 非法时回落值
 * @returns {number} 合法数值
 */
function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

/**
 * 归一化元素参数：必填变换字段夹逼到合法域，未知字段原样透传。
 * @param raw 任意参数输入（可能来自持久化或经典版 JSON）
 * @returns {ElementParams} 归一化后的新对象（不改入参）
 */
export function normalizeElementParams(raw?: Partial<ElementParams> | null): ElementParams {
  const source = raw && typeof raw === 'object' ? raw : {};
  const result: ElementParams = {
    ...source,
    opacity: clampNumber(source.opacity, OPACITY_MIN, OPACITY_MAX, IDENTITY_VISUAL_PARAMS.opacity),
    positionX: clampNumber(source.positionX, -POSITION_LIMIT_PX, POSITION_LIMIT_PX, IDENTITY_VISUAL_PARAMS.positionX),
    positionY: clampNumber(source.positionY, -POSITION_LIMIT_PX, POSITION_LIMIT_PX, IDENTITY_VISUAL_PARAMS.positionY),
    scaleX: clampNumber(source.scaleX, SCALE_MIN, SCALE_MAX, IDENTITY_VISUAL_PARAMS.scaleX),
    scaleY: clampNumber(source.scaleY, SCALE_MIN, SCALE_MAX, IDENTITY_VISUAL_PARAMS.scaleY),
    rotate: clampNumber(source.rotate, ROTATE_MIN_DEG, ROTATE_MAX_DEG, IDENTITY_VISUAL_PARAMS.rotate),
  };
  return result;
}

/**
 * 读取单个参数值：优先取元素的显式参数，否则回落到注册表默认值。
 * @param element 元素（可为空）
 * @param key 参数 key
 * @param fallback 默认值
 * @returns {number | string | boolean} 参数值
 */
export function readParamValue(
  element: CoreElement | null,
  key: string,
  fallback: number | string | boolean,
): number | string | boolean {
  const value = element?.params?.[key];
  if (typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }
  return fallback;
}

/**
 * 生成带前缀的唯一 id；优先用 crypto.randomUUID，缺失时回落到时间戳+随机数。
 * @param prefix id 前缀
 * @returns {string} 唯一 id
 */
export function makeElementId(prefix: string): string {
  const scope = globalThis as unknown as { crypto?: { randomUUID?: () => string } };
  const random = scope.crypto?.randomUUID?.()
    ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  return `${prefix}-${random}`;
}

/**
 * 自动 placement：从期望起点开始，向后寻找能容纳 duration 的空档（跳过已占用片段）。
 * 相当于经典版 `resolveTrackPlacement` 的 auto 模式：不覆盖既有片段、不留负起点。
 * @param clips 已存在的片段（任意顺序）
 * @param desiredStart 期望起点（ticks），负数按 0 处理
 * @param duration 新片段时长（ticks），负数按 0 处理
 * @param gapTicks 片段间最小间隔（ticks）
 * @returns {number} 实际可插入的起点（ticks）
 */
export function resolveAutoPlacement(
  clips: readonly TimelineClip[],
  desiredStart: number,
  duration: number,
  gapTicks: number = DEFAULT_ELEMENT_GAP_TICKS,
): number {
  const safeStart = Number.isFinite(desiredStart) ? Math.max(0, Math.round(desiredStart)) : 0;
  const safeDuration = Number.isFinite(duration) ? Math.max(0, Math.round(duration)) : 0;
  const safeGap = Number.isFinite(gapTicks) ? Math.max(0, Math.round(gapTicks)) : 0;
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);

  // 最多扫描 clips.length + 1 轮：每轮至少跳过一个重叠片段，保证终止。
  let candidate = safeStart;
  for (let round = 0; round <= sorted.length; round += 1) {
    const blocker = sorted.find(
      (clip) => candidate < clip.startTime + clip.duration + safeGap
        && candidate + safeDuration + safeGap > clip.startTime,
    );
    if (!blocker) return candidate;
    candidate = blocker.startTime + blocker.duration + safeGap;
  }
  return candidate;
}

/**
 * 秒 → ticks；非法秒数按默认值兜底。
 * @param seconds 秒数
 * @param ticksPerSecond 每秒 ticks
 * @param fallbackSeconds 非法时的秒数
 * @returns {number} ticks
 */
export function secondsToTicks(
  seconds: number | undefined,
  ticksPerSecond: number,
  fallbackSeconds: number,
): number {
  const safeTps = Number.isFinite(ticksPerSecond) && ticksPerSecond > 0 ? ticksPerSecond : TICKS_PER_SECOND;
  const safeSeconds = typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0
    ? seconds : fallbackSeconds;
  return Math.round(safeSeconds * safeTps);
}

/**
 * 构建文字元素（起点由调用方按 placement 结果提供）。
 * @param input 构建参数
 * @returns {CoreElement} 文字元素
 */
export function buildTextElement(input: {
  id: string;
  content: string;
  startTime: number;
  durationTicks?: number;
  ticksPerSecond?: number;
  name?: string;
}): CoreElement {
  const tps = input.ticksPerSecond ?? TICKS_PER_SECOND;
  return {
    id: input.id,
    name: input.name ?? input.content,
    elementType: 'text',
    startTime: Math.max(0, Math.round(input.startTime)),
    duration: input.durationTicks ?? secondsToTicks(DEFAULT_TEXT_DURATION_SECONDS, tps, DEFAULT_TEXT_DURATION_SECONDS),
    trimStart: 0,
    content: input.content,
    params: normalizeElementParams({ content: input.content }),
  };
}

/**
 * C 档：构建字幕元素（SRT/ASS 导入的单条片段）。
 * 字幕与 text 共享 content/params 文本通道，但 elementType 保留 'caption'
 * 让经典版 JSON 读回时语义不丢；位置默认靠画布下方，可被参数覆盖。
 * @param input 构建参数
 * @returns {CoreElement} 字幕元素
 */
export function buildCaptionElement(input: {
  id: string;
  content: string;
  startTime: number;
  durationTicks: number;
  ticksPerSecond?: number;
  name?: string;
  positionXPx?: number;
  positionYPx?: number;
}): CoreElement {
  // 字幕默认落在画布中下方（Y 偏移 = 画布高度 × 比例），X 居中不偏移。
  const positionY = input.positionYPx ?? Math.round(BASE_CAPTION_CANVAS_HEIGHT_PX * CAPTION_POSITION_Y_RATIO);
  return {
    id: input.id,
    name: input.name ?? input.content,
    elementType: 'caption',
    startTime: Math.max(0, Math.round(input.startTime)),
    duration: Math.max(1, Math.round(input.durationTicks)),
    trimStart: 0,
    content: input.content,
    params: normalizeElementParams({
      content: input.content,
      fontSize: DEFAULT_CAPTION_FONT_SIZE_PX,
      color: DEFAULT_TEXT_COLOR,
      positionX: input.positionXPx ?? 0,
      positionY,
      textAlign: 'center',
    }),
  };
}

/**
 * 构建媒体元素（视频/音频/图片），时长来自素材卡片真实 duration。
 * @param input 构建参数
 * @returns {CoreElement} 媒体元素
 */
export function buildMediaElement(input: {
  id: string;
  name: string;
  elementType: ElementKind;
  startTime: number;
  durationSeconds?: number;
  ticksPerSecond?: number;
  mediaId?: string;
}): CoreElement {
  const tps = input.ticksPerSecond ?? TICKS_PER_SECOND;
  return {
    id: input.id,
    name: input.name,
    elementType: input.elementType,
    startTime: Math.max(0, Math.round(input.startTime)),
    duration: secondsToTicks(input.durationSeconds, tps, DEFAULT_MEDIA_DURATION_SECONDS),
    trimStart: 0,
    // D 档：媒体来源 id 必须落到元素上，否则 autosave/写回都会丢失素材引用。
    ...(input.mediaId !== undefined ? { mediaId: input.mediaId } : {}),
    params: normalizeElementParams(),
  };
}

/**
 * 构建图形元素（第二档项 2：graphic 参数走透传字段）。
 * @param input 构建参数
 * @returns {CoreElement} 图形元素
 */
export function buildGraphicElement(input: {
  id: string;
  name: string;
  startTime: number;
  shape?: string;
  durationTicks?: number;
  ticksPerSecond?: number;
}): CoreElement {
  const tps = input.ticksPerSecond ?? TICKS_PER_SECOND;
  return {
    id: input.id,
    name: input.name,
    elementType: 'graphic',
    startTime: Math.max(0, Math.round(input.startTime)),
    duration: input.durationTicks ?? secondsToTicks(DEFAULT_TEXT_DURATION_SECONDS, tps, DEFAULT_TEXT_DURATION_SECONDS),
    trimStart: 0,
    params: normalizeElementParams({
      'graphic.shape': input.shape ?? 'rectangle',
      'graphic.fill': '#ffffff',
      'graphic.stroke': 'transparent',
      'graphic.strokeWidth': 0,
      'graphic.cornerRadius': 0,
    }),
  };
}

/**
 * 插入元素并按 startTime 稳定排序；重复 id 视为错误（避免写回合并时歧义）。
 * @param clips 现有片段
 * @param element 新片段
 * @returns {CoreElement[]} 新数组（不改入参）
 */
export function insertElement(clips: readonly CoreElement[], element: CoreElement): CoreElement[] {
  if (clips.some((clip) => clip.id === element.id)) {
    throw new Error(`元素 id 已存在：${element.id}`);
  }
  return [...clips, element].sort((a, b) => a.startTime - b.startTime);
}

/**
 * 按 id 删除元素；id 不存在时原样返回（不做无意义的历史记录）。
 * @param clips 现有片段
 * @param id 待删除 id
 * @returns {CoreElement[]} 新数组或原引用
 */
export function removeElementById(clips: readonly CoreElement[], id: string): CoreElement[] {
  return clips.some((clip) => clip.id === id) ? clips.filter((clip) => clip.id !== id) : [...clips];
}

/**
 * U-05：把片段移动到目标轨并更新起始时间；main 轨用缺省 trackId 表示，保持旧数据兼容。
 * 不改变其他字段、不改入参；id 不存在时原样返回，避免无意义的历史记录。
 * @param clips 现有片段
 * @param id 待移动片段 id
 * @param startTicks 目标起始 ticks（负值按 0）
 * @param targetTrackId 目标轨 id
 * @returns {CoreElement[]} 新数组或原引用
 */
export function moveElementToTrack(
  clips: readonly CoreElement[],
  id: string,
  startTicks: number,
  targetTrackId: string,
): CoreElement[] {
  const index = clips.findIndex((clip) => clip.id === id);
  if (index < 0) return [...clips];
  const safeStart = Number.isFinite(startTicks) ? Math.max(0, startTicks) : 0;
  const trackId = targetTrackId && targetTrackId !== 'main' ? targetTrackId : undefined;
  return clips.map((clip, position) => {
    if (position !== index) return clip;
    const next = { ...clip, startTime: safeStart };
    if (trackId === undefined) delete next.trackId;
    else next.trackId = trackId;
    return next;
  });
}

/**
 * 合并参数补丁到元素（归一化后写回），无变化时返回原引用。
 * @param element 目标元素
 * @param patch 参数补丁
 * @returns {CoreElement} 新元素或原引用
 */
export function patchElementParams(
  element: CoreElement,
  patch: Partial<ElementParams>,
): CoreElement {
  const merged = normalizeElementParams({ ...element.params, ...patch });
  const before = JSON.stringify(element.params ?? {});
  const after = JSON.stringify(merged);
  return before === after ? element : { ...element, params: merged };
}

/* ========================================================================
 * P2 关键帧：真实动画数据模型 + 播放头插值采样（纯 TS，无 core/WASM 依赖）。
 * 每个参数可挂一组关键帧；frameSource 每帧按 timeTicks 插值求值得静态参数再合成。
 * ====================================================================== */

/** 单个关键帧：相对片段起点的时间（ticks）+ 数值 + 缓动方式。 */
export interface AnimationKeyframe {
  time: number
  value: number
  easing: 'linear' | 'easeIn' | 'easeOut' | 'easeInOut'
}

/** 参数 → 关键帧轨道。 */
export type AnimationTracks = Record<string, AnimationKeyframe[]>

/** 动画数据在 ElementParams 中的固定 key（避免与用户参数混淆）。 */
export const ANIMATION_TRACKS_KEY = '__animations'

/** 默认缓动。 */
export const DEFAULT_KEYFRAME_EASING: AnimationKeyframe['easing'] = 'linear'

/**
 * 参数注册表点分 key → ElementParams 扁平字段的映射（属性面板与关键帧共用）。
 * 经典版用 transform.positionX 等点分 key，而本工程 params 存扁平 positionX，
 * 采样时必须映射，否则关键帧写入点分 key 不会驱动画面。
 */
export const PARAM_KEY_TO_FLAT: Readonly<Record<string, string>> = Object.freeze({
  'transform.positionX': 'positionX',
  'transform.positionY': 'positionY',
  'transform.scaleX': 'scaleX',
  'transform.scaleY': 'scaleY',
  'transform.rotate': 'rotate',
})

/**
 * 把注册表单参数 key 归一到实际存储字段（点分→扁平，其余保持）。
 * @param key 参数 key
 * @returns {string} 存储字段 key
 */
export function toFlatParamKey(key: string): string {
  return PARAM_KEY_TO_FLAT[key] ?? key
}

/**
 * 读取元素的关键帧轨道（无则空对象，不改入参）。
 * @param element 元素
 * @returns {AnimationTracks} 轨道表
 */
export function readAnimationTracks(element: CoreElement | null): AnimationTracks {
  const raw = element?.params?.[ANIMATION_TRACKS_KEY]
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as AnimationTracks : {}
}

/**
 * 对缓动进度应用 ease 曲线（0..1 → 0..1）。
 * @param t 线性进度
 * @param easing 缓动方式
 * @returns {number} 缓动后进度
 */
export function applyEasing(t: number, easing: AnimationKeyframe['easing']): number {
  const clamped = Math.min(1, Math.max(0, t))
  switch (easing) {
    case 'easeIn': return clamped * clamped
    case 'easeOut': return 1 - (1 - clamped) * (1 - clamped)
    case 'easeInOut': return clamped < 0.5
      ? 2 * clamped * clamped
      : 1 - Math.pow(-2 * clamped + 2, 2) / 2
    case 'linear':
    default: return clamped
  }
}

/**
 * 在时间点对一组关键帧插值求值（区间外用端点值，空轨道返回 null）。
 * @param frames 关键帧轨道（按 time 升序）
 * @param time 相对片段起点的 ticks
 * @returns {number | null} 插值结果
 */
export function sampleKeyframes(frames: readonly AnimationKeyframe[], time: number): number | null {
  if (frames.length === 0) return null
  const sorted = [...frames].sort((a, b) => a.time - b.time)
  if (time <= sorted[0].time) return sorted[0].value
  const last = sorted[sorted.length - 1]
  if (time >= last.time) return last.value
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const current = sorted[index]
    const next = sorted[index + 1]
    if (time >= current.time && time <= next.time) {
      const span = next.time - current.time
      const linear = span === 0 ? 0 : (time - current.time) / span
      const eased = applyEasing(linear, current.easing)
      return current.value + (next.value - current.value) * eased
    }
  }
  return last.value
}

/**
 * 在给定时间把元素参数里的动画轨道求值成静态参数（供预览/导出合成使用）。
 * 无动画时原样返回；有动画时仅覆盖对应参数 key，保留其余字段。
 * @param element 元素
 * @param timeTicks 播放头绝对 ticks
 * @returns {ElementParams} 求值后的参数
 */
export function sampleParamsAtTime(element: CoreElement, timeTicks: number): ElementParams {
  const params = normalizeElementParams(element.params)
  const tracks = readAnimationTracks(element)
  const keys = Object.keys(tracks)
  if (keys.length === 0) return params
  const relativeTime = timeTicks - element.startTime
  const result: ElementParams = { ...params }
  for (const key of keys) {
    const value = sampleKeyframes(tracks[key], relativeTime)
    if (value !== null) result[toFlatParamKey(key)] = value
  }
  return result
}

/**
 * 添加/更新一个关键帧（写入元素 params 的动画轨道），返回新元素。
 * @param element 元素
 * @param key 参数 key
 * @param frame 关键帧
 * @returns {CoreElement} 新元素
 */
export function upsertKeyframe(
  element: CoreElement,
  key: string,
  frame: AnimationKeyframe,
): CoreElement {
  try {
    const tracks = readAnimationTracks(element)
    const existing = tracks[key] ?? []
    const next = existing.filter((item) => item.time !== frame.time)
    next.push(frame)
    tracks[key] = next.sort((a, b) => a.time - b.time)
    return {
      ...element,
      params: { ...normalizeElementParams(element.params), [ANIMATION_TRACKS_KEY]: tracks },
    }
  } catch {
    return element
  }
}

/**
 * 删除一个参数的关键帧轨道。
 * @param element 元素
 * @param key 参数 key
 * @returns {CoreElement} 新元素
 */
export function removeKeyframeTrack(element: CoreElement, key: string): CoreElement {
  const tracks = readAnimationTracks(element)
  if (!tracks[key]) return element
  delete tracks[key]
  return {
    ...element,
    params: { ...normalizeElementParams(element.params), [ANIMATION_TRACKS_KEY]: tracks },
  }
}
