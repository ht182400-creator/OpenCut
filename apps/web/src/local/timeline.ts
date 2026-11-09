/**
 * 时间轴片段 → 素材帧的映射（W-08 第二批）。
 *
 * 之前帧源按项目帧索引顺序取素材，删除片段只缩短时长、画面内容不变。
 * 本模块按「片段的 startTime / duration / trimStart」把项目时间映射回素材时间，
 * 使剪辑（删除、分割后再删除）真正改变预览与导出画面。
 * core 负责 ripple 位移，本模块负责只读的映射计算，二者职责分离。
 */

/** 与 Rust core 一致的时间单位。 */
export const TICKS_PER_SECOND = 120000;

/** 时间轴片段：trimStart 是该片段在素材内的起始时间（ticks）。 */
export interface TimelineClip {
  id: string;
  startTime: number;
  duration: number;
  trimStart: number;
}

/** 项目帧到素材帧的映射结果；无片段覆盖时为空档。 */
export interface FrameMapping {
  clipId: string | null;
  sourceFrameIndex: number | null;
}

/** 取覆盖指定项目时间的片段。 */
export function clipAtTime(clips: TimelineClip[], timeTicks: number): TimelineClip | null {
  return (
    clips.find(
      (clip) => timeTicks >= clip.startTime && timeTicks < clip.startTime + clip.duration,
    ) ?? null
  );
}

/**
 * 把项目帧时间映射到素材帧索引。
 * @param clips 当前时间轴片段（按 startTime 升序或任意顺序均可）
 * @param frameTimeTicks 项目帧的起始时间（ticks）
 * @param fps 帧率
 * @param mediaFrameCount 已解码素材帧数（短素材循环复用）
 * @returns {FrameMapping} 命中的片段与素材帧索引；空档返回 null
 */
export function mapProjectFrame(
  clips: TimelineClip[],
  frameTimeTicks: number,
  fps: number,
  mediaFrameCount: number,
): FrameMapping {
  if (mediaFrameCount <= 0) {
    throw new Error('素材没有可用帧，无法建立时间轴映射');
  }
  const clip = clipAtTime(clips, frameTimeTicks);
  if (!clip) {
    return { clipId: null, sourceFrameIndex: null };
  }
  const sourceTicks = clip.trimStart + (frameTimeTicks - clip.startTime);
  const sourceSeconds = sourceTicks / TICKS_PER_SECOND;
  const sourceFrameIndex = Math.floor(sourceSeconds * fps) % mediaFrameCount;
  return { clipId: clip.id, sourceFrameIndex };
}

/**
 * 在指定项目时间把选中片段切成两段（不改变总时长，也不移动后续片段）。
 * 第二段的 trimStart 按切点相对原片段的偏移累加，保证素材时间连续。
 * 若切点不在片段内部，原样返回输入引用。
 * @param clips 当前片段
 * @param clipId 待分割片段 id
 * @param splitTicks 切点（项目 ticks）
 * @returns {TimelineClip[]} 分割后的片段
 */
export function splitClipAt(
  clips: TimelineClip[],
  clipId: string,
  splitTicks: number,
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId);
  if (!target) return clips;
  const elapsed = splitTicks - target.startTime;
  if (elapsed <= 0 || elapsed >= target.duration) return clips;

  const usedIds = new Set(clips.map((clip) => clip.id));
  let suffix = 2;
  while (usedIds.has(`${clipId}#${suffix}`)) suffix += 1;
  const first: TimelineClip = { ...target, duration: elapsed };
  const second: TimelineClip = {
    id: `${clipId}#${suffix}`,
    startTime: splitTicks,
    duration: target.duration - elapsed,
    trimStart: target.trimStart + elapsed,
  };
  return clips.flatMap((clip) => (clip.id === clipId ? [first, second] : [clip]));
}
