/**
 * 时间轴片段 → 素材帧的映射（W-08 第二批）。
 *
 * 之前帧源按项目帧索引顺序取素材，删除片段只缩短时长、画面内容不变。
 * 本模块按「片段的 startTime / duration / trimStart」把项目时间映射回素材时间，
 * 使剪辑（删除、分割后再删除）真正改变预览与导出画面。
 * core 负责 ripple 位移，本模块负责只读的映射计算，二者职责分离。
 */

import type { EditorAdapter } from './editor-adapter';

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

/** 计算片段集合覆盖的总时长（ticks）。 */
export function timelineDuration(clips: TimelineClip[]): number {
  return clips.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0);
}

/** 按片段覆盖时长换算需要的帧数（至少 1 帧）。 */
export function framesForDuration(clips: TimelineClip[], ticksPerFrame: number): number {
  return Math.max(1, Math.ceil(timelineDuration(clips) / ticksPerFrame));
}

/**
 * OTIO 交换格式在编辑器侧的桥接（W-10 第二批）。
 * 视图形状与 `ocx-io::EditTimeline` 的 serde camelCase 输出一一对应；
 * 仅取视频轨的剪辑决策（起点/时长/素材入点），Gap 与音频轨不进入本地时间轴。
 */
export interface EditTimelineView {
  name: string;
  schemaVersion: number;
  rate: number;
  /** W-10 第四批：时间轴级标记（官方挂在 Stack 上，归一化后放在这里）。 */
  markers?: Array<{
    name: string;
    color: string | null;
    startTicks: number;
    durationTicks: number;
  }>;
  tracks: Array<{
    id: string;
    name: string;
    kind: string;
    clips: Array<{
      id: string;
      name: string;
      isGap: boolean;
      isTransition?: boolean;
      inOffsetTicks?: number;
      outOffsetTicks?: number;
      startTicks: number;
      durationTicks: number;
      sourceStartTicks: number;
      mediaUrl: string | null;
    }>;
  }>;
  warnings: string[];
}

/**
 * 把本地片段转成内部时间轴视图，供 `otioExport` 导出。
 * @param name 时间轴名称（用当前素材/项目名）
 * @param fps 帧率
 * @param clips 当前片段
 * @param mediaUrl 素材引用（当前已导入媒体名；无素材时为 null）
 * @returns {EditTimelineView} 内部时间轴视图
 */
export function clipsToEditTimeline(
  name: string,
  fps: number,
  clips: TimelineClip[],
  mediaUrl: string | null,
): EditTimelineView {
  return {
    name,
    schemaVersion: 1,
    rate: fps,
    tracks: [
      {
        id: 'main',
        name: 'main',
        kind: 'Video',
        clips: clips.map((clip) => ({
          id: clip.id,
          name: clip.id,
          isGap: false,
          startTicks: clip.startTime,
          durationTicks: clip.duration,
          sourceStartTicks: clip.trimStart,
          mediaUrl,
        })),
      },
    ],
    warnings: [],
  };
}

/**
 * 从内部时间轴视图提取本地片段：只取视频轨、跳过 Gap。
 * @param timeline 导入得到的视图
 * @returns {TimelineClip[]} 本地片段
 */
export function editTimelineToClips(timeline: EditTimelineView): TimelineClip[] {
  const video = timeline.tracks.find((track) => track.kind === 'Video') ?? timeline.tracks[0];
  if (!video) return [];
  return video.clips
    .filter((clip) => !clip.isGap && !clip.isTransition)
    .map((clip) => ({
      id: clip.id,
      startTime: clip.startTicks,
      duration: clip.durationTicks,
      trimStart: clip.sourceStartTicks,
    }));
}

/**
 * 导入 OTIO 文本并转成本地片段；失败时抛出带稳定错误码的消息。
 * @param text OTIO JSON 文本
 * @param adapter core 适配层（I-01 唯一入口）
 * @returns {TimelineClip[]} 本地片段
 */
export function otioImportToClips(
  text: string,
  adapter: Pick<EditorAdapter, 'otioImport'>,
): TimelineClip[] {
  const result = adapter.otioImport(text);
  if (!result.ok || !result.timeline) {
    throw new Error(`OTIO 导入被拒绝（${result.error ?? '未知错误'}）；请检查文件格式`);
  }
  return editTimelineToClips(result.timeline as EditTimelineView);
}

/**
 * 把当前片段导出为 OTIO JSON 文本。
 * @param clips 当前片段
 * @param name 时间轴名称
 * @param fps 帧率
 * @param mediaUrl 素材引用
 * @param adapter core 适配层
 * @returns {string} OTIO JSON 文本
 */
export function clipsToOtioText(
  clips: TimelineClip[],
  name: string,
  fps: number,
  mediaUrl: string | null,
  adapter: Pick<EditorAdapter, 'otioExport'>,
): string {
  const timeline = clipsToEditTimeline(name, fps, clips, mediaUrl);
  const result = adapter.otioExport(JSON.stringify(timeline));
  if (!result.ok || typeof result.otio !== 'string') {
    throw new Error(`OTIO 导出失败（${result.error ?? '未知错误'}）`);
  }
  return result.otio;
}

/**
 * 把片段入点设到播放头（W-08 第四批，head-trim）：片段在时间轴上的位置不动，
 * 素材入点后移、时长缩短，因此保留区间的**画面内容随裁剪真实改变**。
 * 播放头不在片段内部时原样返回输入引用。
 * @param clips 当前片段
 * @param clipId 目标片段 id
 * @param playheadTicks 播放头（项目 ticks）
 * @returns {TimelineClip[]} 裁剪后的片段
 */
export function trimClipInAt(
  clips: TimelineClip[],
  clipId: string,
  playheadTicks: number,
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId);
  if (!target) return clips;
  const elapsed = playheadTicks - target.startTime;
  if (elapsed <= 0 || elapsed >= target.duration) return clips;
  return clips.map((clip) =>
    clip.id === clipId
      ? {
          ...clip,
          duration: clip.duration - elapsed,
          trimStart: clip.trimStart + elapsed,
        }
      : clip,
  );
}

/**
 * 把片段出点缩到播放头（W-08 第四批）：只缩短时长，素材入点不变。
 * 播放头不在片段内部时原样返回输入引用。
 * @param clips 当前片段
 * @param clipId 目标片段 id
 * @param playheadTicks 播放头（项目 ticks）
 * @returns {TimelineClip[]} 裁剪后的片段
 */
export function trimClipOutAt(
  clips: TimelineClip[],
  clipId: string,
  playheadTicks: number,
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId);
  if (!target) return clips;
  const elapsed = playheadTicks - target.startTime;
  if (elapsed <= 0 || elapsed >= target.duration) return clips;
  return clips.map((clip) =>
    clip.id === clipId ? { ...clip, duration: elapsed } : clip,
  );
}

/**
 * 沿时间轴平移片段（W-08 第四批）：只改 startTime，素材入点不变——
 * 画面内容不变、位置改变。起点会被夹到 0。
 * 诚实边界：当前单轨线性模型不做重叠校验，重叠时画面取数组顺序先命中的片段。
 * @param clips 当前片段
 * @param clipId 目标片段 id
 * @param deltaTicks 位移量（正数右移）
 * @returns {TimelineClip[]} 平移后的片段
 */
export function moveClipBy(
  clips: TimelineClip[],
  clipId: string,
  deltaTicks: number,
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId);
  if (!target) return clips;
  const nextStart = Math.max(0, target.startTime + deltaTicks);
  if (nextStart === target.startTime) return clips;
  return clips.map((clip) =>
    clip.id === clipId ? { ...clip, startTime: nextStart } : clip,
  );
}

/**
 * 拖拽平移片段并做重叠约束（W-08 第五批）：按原 startTime 顺序取前后邻居，
 * 把目标起点夹在「前邻居结束」与「后邻居开始 − 目标时长」之间；
 * 因此片段不会跨过邻居、结果始终无重叠。无变化或目标缺失时返回输入引用。
 * @param clips 当前片段
 * @param clipId 拖拽的片段 id
 * @param proposedStart 像素换算出的目标起点（ticks）
 * @returns {TimelineClip[]} 约束后的片段
 */
export function moveClipClamped(
  clips: TimelineClip[],
  clipId: string,
  proposedStart: number,
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId);
  if (!target) return clips;
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
  const index = sorted.findIndex((clip) => clip.id === clipId);
  const previous = index > 0 ? sorted[index - 1] : null;
  const next = index < sorted.length - 1 ? sorted[index + 1] : null;
  const lower = previous ? previous.startTime + previous.duration : 0;
  const upper = next ? next.startTime - target.duration : Number.POSITIVE_INFINITY;
  const ceiling = Math.max(lower, upper);
  const clamped = Math.max(lower, Math.min(Math.max(0, proposedStart), ceiling));
  if (clamped === target.startTime) return clips;
  return clips.map((clip) =>
    clip.id === clipId ? { ...clip, startTime: clamped } : clip,
  );
}

/**
 * 拖片段边缘改时长（W-08 第六批）。
 * - 右边缘：只改 duration，夹在 [minDuration, 后邻居起点 − 自身起点]。
 * - 左边缘：head-trim 语义，位置不动、trimStart 与 duration 反向变化；
 *   时长被夹时反算 trimStart，保证素材时间连续。
 * 无变化或目标缺失时返回输入引用。
 * @param clips 当前片段
 * @param clipId 目标片段 id
 * @param edge 左/右边缘
 * @param deltaTicks 像素换算出的位移（正数表示边缘右移）
 * @param minDuration 最小时长（通常一帧的 ticks）
 * @returns {TimelineClip[]} 调整后的片段
 */
export function resizeClipEdge(
  clips: TimelineClip[],
  clipId: string,
  edge: 'left' | 'right',
  deltaTicks: number,
  minDuration: number,
): TimelineClip[] {
  const target = clips.find((clip) => clip.id === clipId);
  if (!target) return clips;
  const sorted = [...clips].sort((a, b) => a.startTime - b.startTime);
  const index = sorted.findIndex((clip) => clip.id === clipId);
  const next = index < sorted.length - 1 ? sorted[index + 1] : null;
  const maxDuration = next ? next.startTime - target.startTime : Number.POSITIVE_INFINITY;
  const ceiling = Math.max(minDuration, maxDuration);
  let duration: number;
  let trimStart = target.trimStart;
  if (edge === 'right') {
    duration = Math.max(minDuration, Math.min(target.duration + deltaTicks, ceiling));
  } else {
    const proposedTrim = Math.max(0, target.trimStart + deltaTicks);
    const proposedDuration = target.duration - (proposedTrim - target.trimStart);
    duration = Math.max(minDuration, Math.min(proposedDuration, ceiling));
    trimStart = Math.max(0, target.trimStart + (target.duration - duration));
  }
  if (duration === target.duration && trimStart === target.trimStart) return clips;
  return clips.map((clip) =>
    clip.id === clipId ? { ...clip, duration, trimStart } : clip,
  );
}

/**
 * 按片段覆盖时长向 core 询问帧计划，返回规范化的帧数（至少 1）。
 * @param clips 片段集合
 * @param adapter core 适配层
 * @param profile 导出配置基线
 * @returns {number} 帧数
 */
export function plannedFrameCount(
  clips: TimelineClip[],
  adapter: Pick<EditorAdapter, 'evaluate'>,
  profile: Record<string, unknown>,
): number {
  const plan = adapter.evaluate<{ frameCount: number; ticksPerFrame: number }>({
    kind: 'buildFramePlan',
    durationTicks: timelineDuration(clips),
    profile,
  });
  return Math.max(plan.frameCount, 1);
}
