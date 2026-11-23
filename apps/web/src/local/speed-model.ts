/**
 * 播放速度（speed）参数模型（第二档项 2）。
 *
 * 经典版 speed 语义：片段在时间轴上的可见时长不变，但素材取帧按 speed 倍率推进
 * （speed=2 → 1 秒时间轴走过 2 秒素材；speed=0.5 → 慢放）。参数存于 ElementParams
 * 透传字段，不改 core 结构；读写与帧映射均为纯函数，便于边界/异常覆盖。
 */
import { mapProjectFrame } from './timeline';
import type { TimelineClip } from './timeline';

/** 默认速度（正常播放）。 */
export const DEFAULT_SPEED = 1;
/** 速度下限（0.25× 慢放）。 */
export const SPEED_MIN = 0.25;
/** 速度上限（4× 快放）。 */
export const SPEED_MAX = 4;
/** 每秒 ticks，与 timeline.ts 同源字面量（避免循环依赖）。 */
const TICKS_PER_SECOND = 120000;

/** 带透传参数的时间轴片段（CoreElement 结构兼容，不必引入 UI 类型）。 */
type SpeedClip = TimelineClip & { params?: Record<string, unknown> };

/**
 * 读取并夹逼元素 speed 参数：非数/NaN/超范围回落 DEFAULT_SPEED。
 * @param clip 片段元素（可空）
 * @returns {number} 合法速度倍率
 */
export function readSpeed(clip: SpeedClip | null | undefined): number {
  const raw = clip?.params?.speed;
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_SPEED;
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, value));
}

/**
 * 按 speed 倍率把项目时间映射到素材帧。
 *
 * 复用 `mapProjectFrame` 的空档判定与素材帧循环，仅在命中片段时把「片段经过时间」
 * 乘 speed 再叠加 trimStart，得到实际素材时间；speed=1 时结果与原函数完全一致。
 *
 * @param clips 当前片段集合
 * @param frameTimeTicks 项目帧时间（ticks）
 * @param fps 帧率
 * @param mediaFrameCount 素材帧数
 * @returns {{ clipId: string | null; sourceFrameIndex: number | null }} 映射结果
 */
export function mapProjectFrameWithSpeed(
  clips: TimelineClip[],
  frameTimeTicks: number,
  fps: number,
  mediaFrameCount: number,
): { clipId: string | null; sourceFrameIndex: number | null } {
  const base = mapProjectFrame(clips, frameTimeTicks, fps, mediaFrameCount);
  if (!base.clipId || base.sourceFrameIndex === null) return base;
  const clip = clips.find((item) => item.id === base.clipId) as SpeedClip | undefined;
  const speed = readSpeed(clip);
  if (speed === DEFAULT_SPEED) return base;
  const trimStart = clip?.trimStart ?? 0;
  const elapsedTicks = (frameTimeTicks - (clip?.startTime ?? 0)) * speed;
  const sourceTicks = trimStart + elapsedTicks;
  const sourceSeconds = sourceTicks / TICKS_PER_SECOND;
  const sourceFrameIndex = ((Math.floor(sourceSeconds * fps) % mediaFrameCount) + mediaFrameCount) % mediaFrameCount;
  return { clipId: base.clipId, sourceFrameIndex };
}
