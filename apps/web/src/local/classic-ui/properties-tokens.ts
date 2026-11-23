/**
 * 经典版 UI 像素级 1:1 改造 · 批 4 属性面板尺寸/文案/参数注册表 token。
 *
 * 来源：<opencut-classic>/apps/web/src/components/editor/panels/properties/ 下的
 * - index.tsx（三种状态/左侧 tab 栏）、empty-view.tsx（空状态）
 * - registry.tsx（按类型 tab 与 paramKeys）、components/element-params-tab.tsx（字段渲染）
 * - components/keyframe-toggle.tsx（关键帧菱形开关）、components/section.tsx（间距）
 * - components/ui/number-field.tsx（NumberField 尺寸）、<opencut-classic>/apps/web/src/params/registry.ts（参数定义）
 *
 * 这些值与经典版逐项对齐，由 properties-tokens.test.ts 在源码可用时逐项比对。
 * 组件逻辑为本地重写（Vite + React），不拷贝经典版状态库与 Next.js 代码。
 */

/** 左侧 tab 栏尺寸（index.tsx：h-8 w-8 / gap-0.5 / p-1）。 */
export const PROPERTIES_TAB_SIZE_PX = 32;
export const PROPERTIES_TAB_GAP_PX = 2;
export const PROPERTIES_TABBAR_PADDING_PX = 4;

/** 空状态（empty-view.tsx：gap-3 / 文本块 gap-2 / p-4）。 */
export const PROPERTIES_EMPTY_GAP_PX = 12;
export const PROPERTIES_EMPTY_TEXT_GAP_PX = 8;
export const PROPERTIES_EMPTY_PADDING_PX = 16;
export const PROPERTIES_EMPTY_PRIMARY = "It's empty here";
export const PROPERTIES_EMPTY_SECONDARY = 'Click an element on the timeline to edit its properties';
export const PROPERTIES_MULTI_SELECT_SUFFIX = ' elements selected.0';

/** Section/字段间距（section.tsx：p-4 pt-0→覆盖 pt-4；gap-3.5/gap-2；label h-4）。 */
export const PROPERTIES_SECTION_CONTENT_PADDING_PX = 16;
export const PROPERTIES_SECTION_FIELDS_GAP_PX = 14;
export const PROPERTIES_FIELD_INNER_GAP_PX = 8;
export const PROPERTIES_LABEL_ROW_HEIGHT_PX = 16;
export const PROPERTIES_LABEL_GAP_PX = 6;

/** NumberField 尺寸与数字图标（number-field.tsx：h-7 / 14px icon / SUFFIX_GAP_PX=6）。 */
export const PROPERTIES_NUMBER_FIELD_HEIGHT_PX = 28;
export const PROPERTIES_NUMBER_ICON_SIZE_PX = 14;
export const PROPERTIES_SUFFIX_GAP_PX = 6;

/** 关键帧开关（keyframe-toggle.tsx：svg size-3.5=14px；title 模板）。 */
export const PROPERTIES_KEYFRAME_ICON_SIZE_PX = 14;
export const PROPERTIES_KEYFRAME_TITLE_PREFIX = 'Toggle ';
export const PROPERTIES_KEYFRAME_TITLE_SUFFIX = ' keyframe';

/** 控件类型映射（property-param-field.tsx）。 */
export type ParamControl = 'number' | 'boolean' | 'select' | 'color' | 'text' | 'font';

/** 单个参数定义（params/registry.ts 的 ElementParamDefinition 子集）。 */
export interface ParamDefinition {
  key: string
  label: string
  control: ParamControl
  defaultValue: number | string | boolean
  min?: number
  max?: number
  step?: number
  keyframable: boolean
  options?: readonly string[]
  /** 依赖字段（如 background.* 仅在 background.enabled=true 时显示）。 */
  dependsOn?: string
}

/** transform.position/scale/rotate + opacity/blendMode（params/registry.ts visualElementParams）。 */
export const VISUAL_ELEMENT_PARAMS: readonly ParamDefinition[] = [
  { key: 'transform.positionX', label: 'Position X', control: 'number', defaultValue: 0, min: -100000, step: 1, keyframable: true },
  { key: 'transform.positionY', label: 'Position Y', control: 'number', defaultValue: 0, min: -100000, step: 1, keyframable: true },
  { key: 'transform.scaleX', label: 'Scale X', control: 'number', defaultValue: 1, min: 0.01, step: 0.01, keyframable: true },
  { key: 'transform.scaleY', label: 'Scale Y', control: 'number', defaultValue: 1, min: 0.01, step: 0.01, keyframable: true },
  { key: 'transform.rotate', label: 'Rotate', control: 'number', defaultValue: 0, min: -360, max: 360, step: 1, keyframable: true },
  { key: 'opacity', label: 'Opacity', control: 'number', defaultValue: 1, min: 0, max: 1, step: 0.01, keyframable: true },
  { key: 'blendMode', label: 'Blend Mode', control: 'select', defaultValue: 'normal', options: ['normal', 'darken', 'multiply', 'color-burn', 'lighten', 'screen', 'plus-lighter', 'color-dodge', 'overlay', 'soft-light', 'hard-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'], keyframable: false },
] as const;

/** P2 矩形遮罩参数（编辑后由 element-composite 的 readRectMask 消费）。 */
export const MASK_ELEMENT_PARAMS: readonly ParamDefinition[] = [
  { key: 'mask.enabled', label: 'Enable Mask', control: 'boolean', defaultValue: false, keyframable: false },
  { key: 'mask.left', label: 'Mask Left', control: 'number', defaultValue: 0, min: 0, max: 1, step: 0.01, keyframable: true, dependsOn: 'mask.enabled' },
  { key: 'mask.top', label: 'Mask Top', control: 'number', defaultValue: 0, min: 0, max: 1, step: 0.01, keyframable: true, dependsOn: 'mask.enabled' },
  { key: 'mask.right', label: 'Mask Right', control: 'number', defaultValue: 1, min: 0, max: 1, step: 0.01, keyframable: true, dependsOn: 'mask.enabled' },
  { key: 'mask.bottom', label: 'Mask Bottom', control: 'number', defaultValue: 1, min: 0, max: 1, step: 0.01, keyframable: true, dependsOn: 'mask.enabled' },
] as const;

/** P2 基础调色效果参数（编辑后由 element-composite 的 readColorAdjust 消费）。 */
export const EFFECT_ELEMENT_PARAMS: readonly ParamDefinition[] = [
  { key: 'effects.brightness', label: 'Brightness', control: 'number', defaultValue: 1, min: 0, max: 4, step: 0.01, keyframable: true },
  { key: 'effects.contrast', label: 'Contrast', control: 'number', defaultValue: 1, min: 0, max: 4, step: 0.01, keyframable: true },
  { key: 'effects.saturate', label: 'Saturate', control: 'number', defaultValue: 1, min: 0, max: 4, step: 0.01, keyframable: true },
] as const;

/** volume/muted（audioElementParams）。 */
export const AUDIO_ELEMENT_PARAMS: readonly ParamDefinition[] = [
  { key: 'volume', label: 'Volume', control: 'number', defaultValue: 0, min: -60, max: 20, step: 0.01, keyframable: true },
  { key: 'muted', label: 'Muted', control: 'boolean', defaultValue: false, keyframable: false },
] as const;

/** 第二档项 2：播放速度（speed），video/audio 类型生效，取帧按倍率推进。 */
export const SPEED_ELEMENT_PARAMS: readonly ParamDefinition[] = [
  { key: 'speed', label: 'Speed', control: 'number', defaultValue: 1, min: 0.25, max: 4, step: 0.25, keyframable: false },
] as const;

/** 文本 17 项参数（textElementParams），背景 6 项依赖 background.enabled。 */
export const TEXT_ELEMENT_PARAMS: readonly ParamDefinition[] = [
  { key: 'content', label: 'Content', control: 'text', defaultValue: 'Default text', keyframable: false },
  { key: 'fontFamily', label: 'Font Family', control: 'font', defaultValue: 'Arial', keyframable: false },
  { key: 'fontSize', label: 'Font Size', control: 'number', defaultValue: 15, min: 1, step: 1, keyframable: true },
  { key: 'color', label: 'Color', control: 'color', defaultValue: '#ffffff', keyframable: true },
  { key: 'textAlign', label: 'Text Align', control: 'select', defaultValue: 'center', options: ['left', 'center', 'right'], keyframable: false },
  { key: 'fontWeight', label: 'Font Weight', control: 'select', defaultValue: 'normal', options: ['normal', 'bold'], keyframable: false },
  { key: 'fontStyle', label: 'Font Style', control: 'select', defaultValue: 'normal', options: ['normal', 'italic'], keyframable: false },
  { key: 'textDecoration', label: 'Text Decoration', control: 'select', defaultValue: 'none', options: ['none', 'underline', 'line-through'], keyframable: false },
  { key: 'letterSpacing', label: 'Letter Spacing', control: 'number', defaultValue: 0, min: -100, step: 0.1, keyframable: true },
  { key: 'lineHeight', label: 'Line Height', control: 'number', defaultValue: 1.2, min: 0.1, step: 0.1, keyframable: true },
  { key: 'background.enabled', label: 'Background Enabled', control: 'boolean', defaultValue: false, keyframable: false },
  { key: 'background.color', label: 'Background Color', control: 'color', defaultValue: '#000000', keyframable: true, dependsOn: 'background.enabled' },
  { key: 'background.cornerRadius', label: 'Background Radius', control: 'number', defaultValue: 0, min: 0, max: 100, step: 1, keyframable: true, dependsOn: 'background.enabled' },
  { key: 'background.paddingX', label: 'Background Padding X', control: 'number', defaultValue: 30, min: 0, step: 1, keyframable: true, dependsOn: 'background.enabled' },
  { key: 'background.paddingY', label: 'Background Padding Y', control: 'number', defaultValue: 42, min: 0, step: 1, keyframable: true, dependsOn: 'background.enabled' },
  { key: 'background.offsetX', label: 'Background Offset X', control: 'number', defaultValue: 0, min: -100000, step: 1, keyframable: true, dependsOn: 'background.enabled' },
  { key: 'background.offsetY', label: 'Background Offset Y', control: 'number', defaultValue: 0, min: -100000, step: 1, keyframable: true, dependsOn: 'background.enabled' },
] as const;

/** 按元素类型的左侧 tab（registry.tsx；顺序即图标栏从上到下）。 */
export const PROPERTIES_TABS_BY_TYPE = {
  text: ['text', 'transform', 'blending'],
  video: ['transform', 'audio', 'speed', 'blending', 'masks', 'effects'],
  image: ['transform', 'blending', 'masks', 'effects'],
  sticker: ['transform', 'blending', 'effects'],
  graphic: ['graphic', 'transform', 'blending', 'masks', 'effects'],
  audio: ['audio', 'speed'],
  effect: ['effects'],
} as const;

/** 各类型的默认 tab（registry.tsx）。 */
export const PROPERTIES_DEFAULT_TAB_BY_TYPE = {
  text: 'text', video: 'transform', image: 'transform', sticker: 'transform',
  graphic: 'graphic', audio: 'audio', effect: 'effects',
} as const;

/** tab 英文 label（与经典版一致）。 */
export const PROPERTIES_TAB_LABELS = {
  transform: 'Transform', blending: 'Blending', audio: 'Audio', speed: 'Speed',
  text: 'Text', effects: 'Effects', masks: 'Masks', graphic: 'Graphic',
} as const;

/** 元素类型 → 参数集组合（registry.ts:334-352）。 */
export const PROPERTIES_PARAMS_BY_TYPE = {
  video: ['visual', 'audio'], image: ['visual'], text: ['text', 'visual'],
  sticker: ['visual'], graphic: ['visual'], audio: ['audio'], effect: [],
} as const;

/** 参数集默认展示顺序（registry.tsx paramKeys）。 */
export const TRANSFORM_PARAM_KEYS = ['transform.positionX', 'transform.positionY', 'transform.scaleX', 'transform.scaleY', 'transform.rotate'] as const;
export const BLENDING_PARAM_KEYS = ['opacity', 'blendMode'] as const;
export const AUDIO_PARAM_KEYS = ['volume', 'muted'] as const;
export const TEXT_PARAM_KEYS = [
  'content', 'fontFamily', 'fontSize', 'color', 'textAlign', 'fontWeight', 'fontStyle',
  'textDecoration', 'letterSpacing', 'lineHeight',
  'background.enabled', 'background.color', 'background.cornerRadius',
  'background.paddingX', 'background.paddingY', 'background.offsetX', 'background.offsetY',
] as const;

/** 经典版数值约束常量（defaults / audio-constants / text-background）。 */
export const MIN_TRANSFORM_SCALE = 0.01;
export const VOLUME_DB_MIN = -60;
export const VOLUME_DB_MAX = 20;
export const CORNER_RADIUS_MIN = 0;
export const CORNER_RADIUS_MAX = 100;
