/**
 * 批 7.2 可变分辨率：帧尺寸的配置与校验纯函数（无浏览器依赖，便于单测）。
 *
 * 背景：core 的 `render_frame_rgba` / `composite_frame_rgba` 宽高均已参数化，
 * 代理帧缓存 key 也含 width/height（见 frame-cache.ts）。原先固定 320×180
 * 只是 TS 侧约定；本模块把「分辨率」提升为可配置项，供解码/合成/预览/导出
 * 全链路共享。默认仍是 320×180，保持既有回归不变（additive-only）。
 */

/** 一个可选的分辨率预设。 */
export interface ResolutionPreset {
  /** 界面显示文案（如「640 × 360」）。 */
  label: string;
  /** 帧宽（像素，WebCodecs 要求正偶数）。 */
  width: number;
  /** 帧高（像素，WebCodecs 要求正偶数）。 */
  height: number;
}

/** 预览代理基准尺寸：批 0~7.1 沿用的 320×180，作为默认值保持回归。 */
export const PROXY_WIDTH = 320;
export const PROXY_HEIGHT = 180;

/** 可选的 16:9 分辨率预设（全部为正偶数，满足 WebCodecs 编码约束）。 */
export const RESOLUTION_PRESETS: readonly ResolutionPreset[] = [
  { label: '320 × 180（代理）', width: PROXY_WIDTH, height: PROXY_HEIGHT },
  { label: '640 × 360', width: 640, height: 360 },
  { label: '1280 × 720', width: 1280, height: 720 },
];

/** 默认分辨率：与历史行为一致，避免未显式选择时改变输出尺寸。 */
export const DEFAULT_RESOLUTION: ResolutionPreset = RESOLUTION_PRESETS[0];

/**
 * 判断宽高是否是 WebCodecs 可用的分辨率（正整数且均为偶数）。
 * @param width 帧宽
 * @param height 帧高
 * @returns {boolean} 合法返回 true
 */
export function isValidResolution(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height)
    && width > 0 && height > 0
    && width % 2 === 0 && height % 2 === 0;
}

/**
 * 格式化分辨率为「宽×高」文本。
 * @param width 帧宽
 * @param height 帧高
 * @returns {string} 形如 `320×180`
 */
export function formatResolution(width: number, height: number): string {
  return `${width}×${height}`;
}

/**
 * 取分辨率的显示文案：命中预设用带说明的 label，否则回退到纯尺寸文本。
 * @param width 帧宽
 * @param height 帧高
 * @returns {string} 显示文案
 */
export function resolutionLabel(width: number, height: number): string {
  const preset = RESOLUTION_PRESETS.find(
    (item) => item.width === width && item.height === height,
  );
  return preset ? preset.label : formatResolution(width, height);
}
