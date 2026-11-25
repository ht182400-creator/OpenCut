/**
 * 预览选框 ↔ core 变换参数的双向映射（第二档：transform box 写回）。
 *
 * core 的 transform 语义（`composeTransform`）：源图以画布中心为锚点，按 scaleX/Y
 * 缩放、positionX/Y 像素平移、rotate 旋转。选框用画布百分比坐标（0~100）表示元素
 * 可见矩形；两者在「元素满幅」基准下可逆：scale=1/position=0 → 选框铺满画布。
 *
 * 本模块为无 DOM 纯函数，便于用边界值/异常/往返一致性充分覆盖；写回时机由组件层
 * 决定（拖拽中更新本地视觉，mouseup 一次性提交，避免撤销栈被高频快照灌满）。
 */
import {
  OPACITY_MAX,
  OPACITY_MIN,
  ROTATE_MAX_DEG,
  ROTATE_MIN_DEG,
  SCALE_MAX,
  SCALE_MIN,
  normalizeElementParams,
  type ElementParams,
} from '../element-model';
import type { ElementTransform } from '../element-composite';
import { ROTATION_SNAP_STEP_DEGREES, ROTATION_SNAP_THRESHOLD_DEGREES } from './preview-tokens';

/** 选框最小边长（百分比），与 preview-section 拖拽下限一致。 */
export const MIN_BOX_SIZE_PERCENT = 5;
/** 满幅基准（百分比）。 */
const FULL_BOX_PERCENT = 100;
/** 画布中心（百分比）。 */
const CANVAS_CENTER_PERCENT = 50;
/** 画布吸附锚点（百分比）：垂直左边/中心/右边，水平顶边/中心/底边共用。 */
const CANVAS_SNAP_ANCHORS = [0, CANVAS_CENTER_PERCENT, FULL_BOX_PERCENT] as const;
/** 半圈（角度），用于最短角差归一化。 */
const HALF_TURN_DEG = 180;
/** 整圈（角度）。 */
const FULL_TURN_DEG = 360;

/** 选框矩形：百分比坐标（左上原点）+ 旋转角度。 */
export interface SelectionBox {
  left: number;
  top: number;
  width: number;
  height: number;
  rotation: number;
}

/**
 * 画布尺寸兜底：非正数回落，避免除零污染映射。
 * @param value 输入尺寸
 * @param fallback 兜底值
 * @returns {number} 合法正尺寸
 */
function positiveSize(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * 把 core 变换参数派生为选框（百分比坐标）。
 * @param transform 元素变换参数
 * @param frameWidth 画布像素宽（<=0 时按 320 兜底）
 * @param frameHeight 画布像素高（<=0 时按 180 兜底）
 * @returns {SelectionBox} 选框矩形
 */
export function boxFromTransform(
  transform: ElementTransform,
  frameWidth: number,
  frameHeight: number,
): SelectionBox {
  const width = positiveSize(frameWidth, 320);
  const height = positiveSize(frameHeight, 180);
  const normalized = normalizeElementParams(transform as Partial<ElementParams>);
  const widthPercent = normalized.scaleX * FULL_BOX_PERCENT;
  const heightPercent = normalized.scaleY * FULL_BOX_PERCENT;
  return {
    left: CANVAS_CENTER_PERCENT + (normalized.positionX / width) * FULL_BOX_PERCENT - widthPercent / 2,
    top: CANVAS_CENTER_PERCENT + (normalized.positionY / height) * FULL_BOX_PERCENT - heightPercent / 2,
    width: widthPercent,
    height: heightPercent,
    rotation: normalized.rotate,
  };
}

/**
 * 把选框派生为 core 变换参数（经 normalize 夹逼到合法域）。
 * @param box 选框矩形
 * @param frameWidth 画布像素宽
 * @param frameHeight 画布像素高
 * @returns {ElementTransform} 可写回元素的变换参数
 */
export function transformFromBox(
  box: SelectionBox,
  frameWidth: number,
  frameHeight: number,
): ElementTransform {
  const width = positiveSize(frameWidth, 320);
  const height = positiveSize(frameHeight, 180);
  const safeWidth = Math.max(MIN_BOX_SIZE_PERCENT, box.width);
  const safeHeight = Math.max(MIN_BOX_SIZE_PERCENT, box.height);
  const centerXPercent = box.left + safeWidth / 2;
  const centerYPercent = box.top + safeHeight / 2;
  const normalized = normalizeElementParams({
    opacity: OPACITY_MAX,
    positionX: ((centerXPercent - CANVAS_CENTER_PERCENT) / FULL_BOX_PERCENT) * width,
    positionY: ((centerYPercent - CANVAS_CENTER_PERCENT) / FULL_BOX_PERCENT) * height,
    scaleX: safeWidth / FULL_BOX_PERCENT,
    scaleY: safeHeight / FULL_BOX_PERCENT,
    rotate: box.rotation,
  });
  return {
    opacity: Math.min(OPACITY_MAX, Math.max(OPACITY_MIN, normalized.opacity)),
    positionX: normalized.positionX,
    positionY: normalized.positionY,
    scaleX: Math.min(SCALE_MAX, Math.max(SCALE_MIN, normalized.scaleX)),
    scaleY: Math.min(SCALE_MAX, Math.max(SCALE_MIN, normalized.scaleY)),
    rotate: Math.min(ROTATE_MAX_DEG, Math.max(ROTATE_MIN_DEG, normalized.rotate)),
  };
}

/**
 * 指针相对选框中心的角度（度，atan2：右为 0°，顺时针为正）。
 * @param centerX 中心屏幕 X
 * @param centerY 中心屏幕 Y
 * @param pointerX 指针屏幕 X
 * @param pointerY 指针屏幕 Y
 * @returns {number} 角度值
 */
export function pointerAngleDeg(centerX: number, centerY: number, pointerX: number, pointerY: number): number {
  return (Math.atan2(pointerY - centerY, pointerX - centerX) * FULL_TURN_DEG) / (Math.PI * 2);
}

/**
 * 按角度差计算旋转后的新角度（处理 ±180° 跳变，并按 90° 吸附）。
 * @param startAngle 拖拽起始指针角度
 * @param currentAngle 当前指针角度
 * @param startRotation 拖拽起始元素角度
 * @returns {number} 夹逼到 [-360,360] 的新角度
 */
export function rotateByPointer(startAngle: number, currentAngle: number, startRotation: number): number {
  let delta = currentAngle - startAngle;
  if (delta > HALF_TURN_DEG) delta -= FULL_TURN_DEG;
  if (delta < -HALF_TURN_DEG) delta += FULL_TURN_DEG;
  const raw = startRotation + delta;
  const remainder = ((raw % ROTATION_SNAP_STEP_DEGREES) + ROTATION_SNAP_STEP_DEGREES) % ROTATION_SNAP_STEP_DEGREES;
  const nearLow = remainder <= ROTATION_SNAP_THRESHOLD_DEGREES;
  const nearHigh = ROTATION_SNAP_STEP_DEGREES - remainder <= ROTATION_SNAP_THRESHOLD_DEGREES;
  const snapped = nearLow
    ? raw - remainder
    : nearHigh
      ? raw + (ROTATION_SNAP_STEP_DEGREES - remainder)
      : raw;
  return Math.min(ROTATE_MAX_DEG, Math.max(ROTATE_MIN_DEG, snapped));
}

/** 参考线状态：verticalAt/horizontalAt 为画布百分比位置（0/50/100）。 */
export interface SnapGuides {
  vertical: boolean;
  horizontal: boolean;
  verticalAt: number;
  horizontalAt: number;
}

/** 无参考线的初始状态（只读使用，不修改）。 */
export const NO_SNAP_GUIDES: SnapGuides = {
  vertical: false, horizontal: false,
  verticalAt: CANVAS_CENTER_PERCENT, horizontalAt: CANVAS_CENTER_PERCENT,
};

/**
 * 在最近的画布锚点上吸附选框位置（不改宽高与旋转）。
 * 垂直轴依次尝试 left/center/right，水平轴依次尝试 top/center/bottom，
 * 取距离最小且在阈值内的锚点。
 * @param box 当前选框
 * @param thresholdPercentX 水平吸附阈值（百分比）
 * @param thresholdPercentY 垂直吸附阈值（百分比，缺省同水平）
 * @returns 吸附后的选框与参考线状态
 */
export function snapBoxToCanvas(
  box: SelectionBox,
  thresholdPercentX: number,
  thresholdPercentY: number = thresholdPercentX,
): { box: SelectionBox; guides: SnapGuides } {
  const thresholdX = Number.isFinite(thresholdPercentX) && thresholdPercentX >= 0 ? thresholdPercentX : 0;
  const thresholdY = Number.isFinite(thresholdPercentY) && thresholdPercentY >= 0 ? thresholdPercentY : 0;
  const vertical = nearestCanvasAnchor(
    [box.left, box.left + box.width / 2, box.left + box.width], thresholdX,
  );
  const horizontal = nearestCanvasAnchor(
    [box.top, box.top + box.height / 2, box.top + box.height], thresholdY,
  );
  const next = { ...box };
  let verticalAt = CANVAS_CENTER_PERCENT;
  let horizontalAt = CANVAS_CENTER_PERCENT;
  if (vertical) {
    // index 0/1/2 分别把 left/center/right 对齐到锚点。
    next.left = vertical.index === 0 ? vertical.at
      : vertical.index === 1 ? vertical.at - box.width / 2
        : vertical.at - box.width;
    verticalAt = vertical.at;
  }
  if (horizontal) {
    next.top = horizontal.index === 0 ? horizontal.at
      : horizontal.index === 1 ? horizontal.at - box.height / 2
        : horizontal.at - box.height;
    horizontalAt = horizontal.at;
  }
  return {
    box: next,
    guides: { vertical: vertical !== null, horizontal: horizontal !== null, verticalAt, horizontalAt },
  };
}

/**
 * 找距离最近的画布锚点；索引 0/1/2 对应 left-center-right 或 top-center-bottom。
 * @param edges 选框三条边/中线的位置
 * @param threshold 吸附阈值（百分比）
 * @returns 最近锚点或 null
 */
function nearestCanvasAnchor(
  edges: readonly number[],
  threshold: number,
): { index: number; at: number } | null {
  let best: { index: number; at: number; distance: number } | null = null;
  for (let index = 0; index < CANVAS_SNAP_ANCHORS.length; index += 1) {
    const at = CANVAS_SNAP_ANCHORS[index];
    const distance = Math.abs(edges[index] - at);
    if (distance <= threshold && (best === null || distance < best.distance)) {
      best = { index, at, distance };
    }
  }
  return best === null ? null : { index: best.index, at: best.at };
}
