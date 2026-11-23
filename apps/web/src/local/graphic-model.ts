/**
 * Graphic 图形元素模型（第二档项 2）：形状参数解析 + 纯函数内外判定 + Canvas 栅格化。
 *
 * 与文字元素同构：参数存于 ElementParams 透传字段（graphic.*），
 * 栅格化产出 RGBA8 图层，由 frameSource 以 alpha 叠加到底图上。
 * 纯函数（readGraphicParams / isInsideShape / alphaBlend）无 DOM 依赖，便于边界/异常覆盖。
 */
import type { CoreElement } from './editor-ui';
import { normalizeElementParams } from './element-model';

/** 支持的图形形状。 */
export type GraphicShape = 'rectangle' | 'ellipse' | 'triangle' | 'line';

/** 默认形状。 */
export const DEFAULT_GRAPHIC_SHAPE: GraphicShape = 'rectangle';
/** 默认填充色（不透明白）。 */
export const DEFAULT_GRAPHIC_FILL = '#ffffff';
/** 默认描边色（透明）。 */
export const DEFAULT_GRAPHIC_STROKE = 'transparent';
/** 默认描边宽度（px）。 */
export const DEFAULT_GRAPHIC_STROKE_WIDTH = 0;
/** 默认圆角半径（px）。 */
export const DEFAULT_GRAPHIC_CORNER_RADIUS = 0;
/** 允许的合法形状集合。 */
export const GRAPHIC_SHAPES: readonly GraphicShape[] = ['rectangle', 'ellipse', 'triangle', 'line'];
/** 描边宽度上限，防异常值拖垮绘制。 */
const MAX_STROKE_WIDTH = 64;
/** 圆角半径上限。 */
const MAX_CORNER_RADIUS = 256;

/** 解析后的图形参数。 */
export interface GraphicParams {
  shape: GraphicShape
  fill: string
  stroke: string
  strokeWidth: number
  cornerRadius: number
}

/**
 * 解析 hex 颜色为 RGBA；非法/透明返回 null。
 * @param value 颜色字符串（#rgb / #rrggbb / #rrggbbaa / transparent）
 * @returns {[number, number, number, number] | null} RGBA（0-255）
 */
export function parseGraphicColor(value: string): [number, number, number, number] | null {
  const text = String(value).trim().toLowerCase();
  if (text === 'transparent' || text === 'none') return null;
  const hex = text.startsWith('#') ? text.slice(1) : text;
  if (!/^[0-9a-f]{3,8}$/.test(hex)) return null;
  const expanded = hex.length === 3 || hex.length === 4
    ? hex.split('').map((char) => char + char).join('')
    : hex;
  if (expanded.length !== 6 && expanded.length !== 8) return null;
  const toByte = (from: number): number => Number.parseInt(expanded.slice(from, from + 2), 16);
  return [toByte(0), toByte(2), toByte(4), expanded.length === 8 ? toByte(6) : 255];
}

/**
 * 从元素透传参数读取图形参数（非法回落默认）。
 * @param element 图形元素
 * @returns {GraphicParams} 合法图形参数
 */
export function readGraphicParams(element: CoreElement): GraphicParams {
  const params = normalizeElementParams(element.params);
  const rawShape = params['graphic.shape'];
  const shape = GRAPHIC_SHAPES.includes(rawShape as GraphicShape)
    ? rawShape as GraphicShape
    : DEFAULT_GRAPHIC_SHAPE;
  const fill = typeof params['graphic.fill'] === 'string' && parseGraphicColor(params['graphic.fill'] as string)
    ? params['graphic.fill'] as string
    : DEFAULT_GRAPHIC_FILL;
  const stroke = typeof params['graphic.stroke'] === 'string' && parseGraphicColor(params['graphic.stroke'] as string)
    ? params['graphic.stroke'] as string
    : DEFAULT_GRAPHIC_STROKE;
  const toSize = (value: unknown, fallback: number, max: number): number => {
    const num = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(num) && num >= 0 ? Math.min(max, num) : fallback;
  };
  return {
    shape,
    fill,
    stroke,
    strokeWidth: toSize(params['graphic.strokeWidth'], DEFAULT_GRAPHIC_STROKE_WIDTH, MAX_STROKE_WIDTH),
    cornerRadius: toSize(params['graphic.cornerRadius'], DEFAULT_GRAPHIC_CORNER_RADIUS, MAX_CORNER_RADIUS),
  };
}

/**
 * 纯函数：判断归一化坐标（0-1）是否落在指定形状内部。
 * 用于单测覆盖形状判定；Canvas 栅格化复用同一几何逻辑。
 * @param shape 形状
 * @param nx 归一化 X（0-1）
 * @param ny 归一化 Y（0-1）
 * @param cornerRadius 归一化圆角半径（仅矩形）
 * @returns {boolean} 是否命中
 */
export function isInsideShape(shape: GraphicShape, nx: number, ny: number, cornerRadius = 0): boolean {
  if (nx < 0 || nx > 1 || ny < 0 || ny > 1) return false;
  switch (shape) {
    case 'ellipse': {
      const dx = nx - 0.5;
      const dy = ny - 0.5;
      return (dx * dx) / 0.25 + (dy * dy) / 0.25 <= 1;
    }
    case 'triangle':
      // 顶点 (0.5,0)，底边 y=1；左右边界线性收窄。
      return ny <= 1 && ny >= 0 && Math.abs(nx - 0.5) <= (0.5 - ny * 0.5);
    case 'line':
      // 对角线 (0,0)-(1,1)，容差一份子像素（0.02 归一单位）。
      return Math.abs(nx - ny) <= 0.02;
    case 'rectangle':
    default: {
      if (cornerRadius <= 0) return true;
      const cx = Math.min(Math.max(nx, cornerRadius), 1 - cornerRadius);
      const cy = Math.min(Math.max(ny, cornerRadius), 1 - cornerRadius);
      const dx = nx - cx;
      const dy = ny - cy;
      return dx * dx + dy * dy <= cornerRadius * cornerRadius;
    }
  }
}

/**
 * 纯函数：alpha 混合单层到目标像素（原地修改）。
 * @param target 目标 RGBA8
 * @param layer 源图层 RGBA8
 */
export function alphaBlendInto(target: Uint8Array, layer: Uint8Array): void {
  const length = Math.min(target.length, layer.length);
  for (let offset = 0; offset + 3 < length; offset += 4) {
    const alpha = layer[offset + 3] / 255;
    if (alpha <= 0) continue;
    target[offset] = Math.round(layer[offset] * alpha + target[offset] * (1 - alpha));
    target[offset + 1] = Math.round(layer[offset + 1] * alpha + target[offset + 1] * (1 - alpha));
    target[offset + 2] = Math.round(layer[offset + 2] * alpha + target[offset + 2] * (1 - alpha));
  }
}

/**
 * Canvas 栅格化图形为 RGBA8 图层（浏览器环境）；无 Canvas 时返回 null。
 * @param params 图形参数
 * @param width 帧宽
 * @param height 帧高
 * @param opacity 元素整体透明度（0-1）
 * @returns {Uint8Array | null} 图层像素
 */
export function rasterizeGraphic(
  params: GraphicParams,
  width: number,
  height: number,
  opacity: number,
): Uint8Array | null {
  if (typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const alpha = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : 1;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = params.fill;
    ctx.strokeStyle = params.stroke;
    ctx.lineWidth = params.strokeWidth;
    ctx.beginPath();
    if (params.shape === 'ellipse') {
      ctx.ellipse(width / 2, height / 2, width / 2, height / 2, 0, 0, Math.PI * 2);
    } else if (params.shape === 'triangle') {
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
    } else if (params.shape === 'line') {
      ctx.moveTo(0, 0);
      ctx.lineTo(width, height);
    } else {
      // 矩形（圆角用 roundRect 能力探测，缺失时回退直角）。
      const radius = Math.min(params.cornerRadius, width / 2, height / 2);
      if (radius > 0 && typeof ctx.roundRect === 'function') {
        ctx.roundRect(0, 0, width, height, radius);
      } else {
        ctx.rect(0, 0, width, height);
      }
    }
    if (params.shape !== 'line') ctx.fill();
    if (params.strokeWidth > 0 && params.stroke !== DEFAULT_GRAPHIC_STROKE) ctx.stroke();
    return new Uint8Array(ctx.getImageData(0, 0, width, height).data);
  } catch (error) {
    console.error('[graphic] 栅格化异常', error);
    return null;
  }
}
