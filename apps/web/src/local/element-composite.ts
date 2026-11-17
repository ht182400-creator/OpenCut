/**
 * 元素变换与文字合成的纯计算（P0 参数驱动预览/导出）。
 *
 * 设计要点：
 * - 变换（位移/缩放/旋转/透明度）用 CPU 逐像素最近邻采样实现，预览与导出共用
 *   `frameSource`，因此两者结果一致，不是只改视觉状态的占位；
 * - 文字栅格化需要字体引擎，浏览器内用 OffscreenCanvas/Canvas2D 把文本写进像素缓冲，
 *   同样经 `frameSource` 进入预览与导出；布局计算是纯函数，可在 Node 单测覆盖；
 * - 所有函数无外部副作用（除惰性创建的共享 canvas），异常由调用方统一提示。
 */

import type { CoreElement } from './editor-ui';
import {
  DEFAULT_TEXT_COLOR,
  DEFAULT_TEXT_FONT_SIZE_PX,
  IDENTITY_VISUAL_PARAMS,
  normalizeElementParams,
} from './element-model';

/** 参与画面合成的变换参数（像素单位 / 角度）。 */
export interface ElementTransform {
  opacity: number;
  positionX: number;
  positionY: number;
  scaleX: number;
  scaleY: number;
  rotate: number;
}

/** 文字布局（传给 Canvas2D 的纯数据）。 */
export interface TextLayout {
  text: string;
  x: number;
  y: number;
  fontSizePx: number;
  color: string;
  fontFamily: string;
  fontWeight: string;
  fontStyle: string;
  align: 'left' | 'center' | 'right';
  baseline: 'top' | 'middle' | 'bottom';
  decoration: 'none' | 'underline' | 'line-through';
  backgroundEnabled: boolean;
  backgroundColor: string;
}

const DEFAULT_FONT_FAMILY = 'Arial';
const FULL_ROTATION_DEG = 360;
const DEG_TO_RAD = Math.PI / 180;

/**
 * 从元素参数提取变换（缺省 identity）。
 * @param element 目标元素（可为空）
 * @returns {ElementTransform} 变换参数
 */
export function transformFromElement(element: CoreElement | null): ElementTransform {
  const params = normalizeElementParams(element?.params);
  return {
    opacity: params.opacity,
    positionX: params.positionX,
    positionY: params.positionY,
    scaleX: params.scaleX,
    scaleY: params.scaleY,
    rotate: params.rotate,
  };
}

/**
 * 判断变换是否为 identity（无需重采样，直接返回底图）。
 * @param transform 变换参数
 * @returns {boolean} 是否 identity
 */
export function isIdentityTransform(transform: ElementTransform): boolean {
  return transform.opacity === IDENTITY_VISUAL_PARAMS.opacity
    && transform.positionX === 0 && transform.positionY === 0
    && transform.scaleX === 1 && transform.scaleY === 1
    && transform.rotate === 0;
}

/**
 * 把 RGBA8 底图按变换合成到同尺寸输出缓冲（透明黑底 + 最近邻采样）。
 *
 * 逆映射：对每个输出像素 (dx,dy)，先减去位移、反向旋转、反向缩放得到源坐标；
 * 落在源范围内则拷贝（透明度乘以 opacity），否则保持透明。这样位移/缩放/旋转
 * 都会真实改变像素，而不是叠加演示色块。
 *
 * @param source 源 RGBA8 像素
 * @param transform 变换参数
 * @param width 帧宽（像素）
 * @param height 帧高（像素）
 * @returns {Uint8Array} 合成后的 RGBA8 像素
 */
export function composeTransform(
  source: Uint8Array,
  transform: ElementTransform,
  width: number,
  height: number,
): Uint8Array {
  const expected = width * height * 4;
  if (!Number.isFinite(expected) || expected <= 0 || source.length < expected) return source;
  if (isIdentityTransform(transform)) return source;

  const output = new Uint8Array(expected);
  const cx = width / 2;
  const cy = height / 2;
  const angle = ((transform.rotate % FULL_ROTATION_DEG) * DEG_TO_RAD);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const invScaleX = transform.scaleX === 0 ? 0 : 1 / transform.scaleX;
  const invScaleY = transform.scaleY === 0 ? 0 : 1 / transform.scaleY;
  const alpha = Math.min(1, Math.max(0, transform.opacity));

  for (let dy = 0; dy < height; dy += 1) {
    for (let dx = 0; dx < width; dx += 1) {
      const px = dx - cx - transform.positionX;
      const py = dy - cy - transform.positionY;
      const rx = px * cos - py * sin;
      const ry = px * sin + py * cos;
      const sx = Math.round(cx + rx * invScaleX);
      const sy = Math.round(cy + ry * invScaleY);
      if (sx < 0 || sx >= width || sy < 0 || sy >= height) continue;
      const srcIndex = (sy * width + sx) * 4;
      const dstIndex = (dy * width + dx) * 4;
      output[dstIndex] = source[srcIndex];
      output[dstIndex + 1] = source[srcIndex + 1];
      output[dstIndex + 2] = source[srcIndex + 2];
      output[dstIndex + 3] = Math.round(source[srcIndex + 3] * alpha);
    }
  }
  return output;
}

/**
 * 计算文字布局（纯函数，供单测与浏览器栅格化共用）。
 * @param element 文字元素
 * @param width 帧宽
 * @param height 帧高
 * @returns {TextLayout} 布局数据
 */
export function resolveTextLayout(
  element: CoreElement,
  width: number,
  height: number,
): TextLayout {
  const params = normalizeElementParams(element.params);
  const pickString = (key: string, fallback: string): string => {
    const value = params[key];
    return typeof value === 'string' ? value : fallback;
  };
  return {
    text: typeof element.content === 'string' && element.content.length > 0
      ? element.content
      : String(params.content ?? ''),
    x: width / 2 + params.positionX,
    y: height / 2 + params.positionY,
    fontSizePx: Math.max(1, Number(params.fontSize ?? DEFAULT_TEXT_FONT_SIZE_PX)),
    color: pickString('color', DEFAULT_TEXT_COLOR),
    fontFamily: pickString('fontFamily', DEFAULT_FONT_FAMILY),
    fontWeight: pickString('fontWeight', 'normal'),
    fontStyle: pickString('fontStyle', 'normal'),
    align: pickString('textAlign', 'center') as TextLayout['align'],
    baseline: 'middle',
    decoration: pickString('textDecoration', 'none') as TextLayout['decoration'],
    backgroundEnabled: params['background.enabled'] === true,
    backgroundColor: pickString('background.color', '#000000'),
  };
}

/** 惰性复用的离屏画布（仅浏览器环境创建）。 */
let sharedCanvas: {
  width: number;
  height: number;
  getContext(kind: '2d'): {
    clearRect(x: number, y: number, w: number, h: number): void;
    fillRect(x: number, y: number, w: number, h: number): void;
    fillText(text: string, x: number, y: number): void;
    getImageData(x: number, y: number, w: number, h: number): { data: Uint8ClampedArray };
    font: string;
    textAlign: string;
    textBaseline: string;
    fillStyle: string;
  } | null;
} | null = null;

/**
 * 创建或复用离屏画布（浏览器用 OffscreenCanvas，退化用 document.createElement）。
 * @param width 帧宽
 * @param height 帧高
 * @returns {object | null} 画布上下文，环境不支持时返回 null
 */
function ensureCanvas(width: number, height: number): NonNullable<typeof sharedCanvas> | null {
  try {
    const scope = globalThis as unknown as {
      OffscreenCanvas?: new (w: number, h: number) => NonNullable<typeof sharedCanvas>;
      document?: { createElement(tag: string): NonNullable<typeof sharedCanvas> };
    };
    if (!sharedCanvas) {
      if (scope.OffscreenCanvas) sharedCanvas = new scope.OffscreenCanvas(width, height);
      else if (scope.document) sharedCanvas = scope.document.createElement('canvas');
      else return null;
    }
    if (sharedCanvas.width !== width) sharedCanvas.width = width;
    if (sharedCanvas.height !== height) sharedCanvas.height = height;
    return sharedCanvas;
  } catch {
    return null;
  }
}

/**
 * 把文字按布局栅格化为 RGBA8 像素（浏览器内真实绘制，非占位）。
 * @param layout 文字布局
 * @param transform 元素变换（opacity 乘到 alpha）
 * @param width 帧宽
 * @param height 帧高
 * @returns {Uint8Array | null} 文字图层像素；环境不支持时返回 null
 */
export function rasterizeText(
  layout: TextLayout,
  transform: ElementTransform,
  width: number,
  height: number,
): Uint8Array | null {
  const canvas = ensureCanvas(width, height);
  const context = canvas?.getContext('2d');
  if (!canvas || !context) return null;
  try {
    context.clearRect(0, 0, width, height);
    if (layout.backgroundEnabled) {
      context.fillStyle = layout.backgroundColor;
      context.fillRect(0, 0, width, height);
    }
    context.font = `${layout.fontStyle} ${layout.fontWeight} ${layout.fontSizePx}px ${layout.fontFamily}`;
    context.textAlign = layout.align;
    context.textBaseline = layout.baseline;
    context.fillStyle = layout.color;
    context.fillText(layout.text, layout.x, layout.y);
    const image = context.getImageData(0, 0, width, height).data;
    const pixels = new Uint8Array(width * height * 4);
    const alpha = Math.min(1, Math.max(0, transform.opacity));
    for (let index = 0; index < pixels.length; index += 4) {
      pixels[index] = image[index];
      pixels[index + 1] = image[index + 1];
      pixels[index + 2] = image[index + 2];
      pixels[index + 3] = Math.round(image[index + 3] * alpha);
    }
    return pixels;
  } catch {
    return null;
  }
}
