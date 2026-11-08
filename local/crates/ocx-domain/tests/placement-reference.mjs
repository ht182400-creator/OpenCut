/**
 * 经典版 TS placement 的 JS 参考实现（测试基线，非产品代码）。
 *
 * 来源（逐函数对应）：
 * - timeline/placement/compatibility.ts → elementTrackMap / compatibility
 * - timeline/placement/overlap.ts       → overlap
 * - timeline/placement/main-track.ts    → earliest / mainTrack
 * - timeline/placement/insert-index.ts  → insertIndex / preferred
 * - timeline/placement/resolve.ts       → resolve
 *
 * 字段名差异：经典版轨道字段为 `type`，这里与 Rust core 统一用 `trackType`。
 * 时间单位由浮点秒改为整数 ticks（120000 ticks/秒），线性换算不改变语义。
 * apply.ts 依赖随机 UUID 与轨道工厂，属于 IO 层，不在本参考实现内。
 */

const ELEMENT_TRACK_MAP = {
  audio: "audio",
  text: "text",
  sticker: "graphic",
  graphic: "graphic",
  effect: "effect",
  video: "video",
  image: "video",
};

/** 有序轨道列表（overlay → main → audio）。 */
function orderedTracks(tracks) {
  return [...tracks.overlay, tracks.main, ...tracks.audio];
}

/** 元素类型映射到轨道类型。 */
function getTrackTypeForElementType(elementType) {
  return ELEMENT_TRACK_MAP[elementType];
}

/** 兼容性校验。 */
function validateElementTrackCompatibility(elementType, trackType) {
  const isValid = getTrackTypeForElementType(elementType) === trackType;
  if (!isValid) {
    return {
      isValid: false,
      errorMessage: `${elementType} elements cannot be placed on ${trackType} tracks`,
    };
  }
  return { isValid: true };
}

/** 单个时间段是否与元素重叠。 */
function wouldElementOverlap(elements, startTime, endTime, excludeElementId) {
  return elements.some((element) => {
    if (excludeElementId && element.id === excludeElementId) return false;
    const elementEnd = element.startTime + element.duration;
    return startTime < elementEnd && endTime > element.startTime;
  });
}

/** 所有时间段是否都能放到该轨道。 */
function canPlaceTimeSpansOnTrack(track, timeSpans) {
  return timeSpans.every(
    (span) =>
      !wouldElementOverlap(
        track.elements,
        span.startTime,
        span.startTime + span.duration,
        span.excludeElementId,
      ),
  );
}

/** 主轨起始最早的元素（相同起点保留先出现者）。 */
function getEarliestMainTrackElement(mainTrack, excludeElementId) {
  const elements = mainTrack.elements.filter(
    (element) => !excludeElementId || element.id !== excludeElementId,
  );
  if (elements.length === 0) return null;
  return elements.reduce((earliest, element) =>
    element.startTime < earliest.startTime ? element : earliest,
  );
}

/** 主轨起点强制规则。 */
function enforceMainTrackStart(tracks, targetTrackId, requested, excludeElementId) {
  if (tracks.main.id !== targetTrackId) return requested;
  const earliest = getEarliestMainTrackElement(tracks.main, excludeElementId);
  if (!earliest) return 0;
  if (requested <= earliest.startTime) return 0;
  return requested;
}

/** 默认插入位置。 */
function getDefaultInsertIndexForTrack(tracks, trackType) {
  if (trackType === "audio") return tracks.overlay.length + 1 + tracks.audio.length;
  if (trackType === "effect") return 0;
  return tracks.overlay.length;
}

/** 最高插入位置。 */
function getHighestInsertIndexForTrack(tracks, trackType) {
  if (trackType === "audio") return tracks.overlay.length + 1;
  return 0;
}

/** 按首选索引与方向解析新轨道插入位置。 */
function resolvePreferredNewTrackPlacement(tracks, trackType, preferredIndex, direction) {
  const trackCount = tracks.overlay.length + 1 + tracks.audio.length;
  if (trackCount === 0) {
    return { insertIndex: 0, insertPosition: trackType === "audio" ? "below" : null };
  }
  const safePreferredIndex = Math.min(Math.max(preferredIndex, 0), trackCount - 1);
  const mainTrackIndex = tracks.overlay.length;
  if (trackType === "audio") {
    if (safePreferredIndex <= mainTrackIndex) {
      return { insertIndex: mainTrackIndex + 1, insertPosition: "below" };
    }
    return {
      insertIndex: direction === "above" ? safePreferredIndex : safePreferredIndex + 1,
      insertPosition: direction,
    };
  }
  const insertIndex = direction === "above" ? safePreferredIndex : safePreferredIndex + 1;
  if (mainTrackIndex >= 0 && insertIndex > mainTrackIndex) {
    return { insertIndex: mainTrackIndex, insertPosition: "above" };
  }
  return { insertIndex, insertPosition: direction };
}

/** 构造「使用已有轨道」结果（主轨被调整时才带 adjustedStartTime）。 */
function buildExistingTrackResult(track, trackIndex, tracks, timeSpans) {
  const firstSpan = timeSpans[0];
  const requested = firstSpan?.startTime ?? 0;
  const adjusted = enforceMainTrackStart(
    tracks,
    track.id,
    requested,
    firstSpan?.excludeElementId,
  );
  return {
    kind: "existingTrack",
    trackId: track.id,
    trackIndex,
    trackType: track.trackType,
    ...(adjusted !== requested ? { adjustedStartTime: adjusted } : {}),
  };
}

/** 构造「新建轨道」结果。 */
function buildNewTrackResult(trackType, insertIndex, insertPosition) {
  return { kind: "newTrack", trackType, insertIndex, insertPosition };
}

/** 找第一条类型匹配且无冲突的轨道。 */
function findFirstAvailableTrackIndex(ordered, trackType, timeSpans) {
  return ordered.findIndex(
    (track) => track.trackType === trackType && canPlaceTimeSpansOnTrack(track, timeSpans),
  );
}

/** 强制新建轨道。 */
function resolveAlwaysNewTrack(tracks, trackType, position) {
  const insertIndex =
    position === "highest"
      ? getHighestInsertIndexForTrack(tracks, trackType)
      : getDefaultInsertIndexForTrack(tracks, trackType);
  return buildNewTrackResult(trackType, insertIndex, null);
}

/** 垂直拖拽方向优先于悬停方向。 */
function getInsertDirection(hoverDirection, verticalDragDirection) {
  if (verticalDragDirection === "up") return "above";
  if (verticalDragDirection === "down") return "below";
  return hoverDirection;
}

/** 负索引或越界按 undefined 处理。 */
function trackAt(ordered, index) {
  if (index < 0) return undefined;
  return ordered[index];
}

/** 五种放置策略的完整分支。 */
function resolveTrackPlacement(tracks, subject, timeSpans, strategy) {
  const ordered = orderedTracks(tracks);
  const trackType =
    "trackType" in subject
      ? subject.trackType
      : getTrackTypeForElementType(subject.elementType);

  if (strategy.type === "explicit") {
    const trackIndex = ordered.findIndex((track) => track.id === strategy.trackId);
    if (trackIndex < 0) return null;
    const track = ordered[trackIndex];
    if (track.trackType !== trackType) return null;
    return buildExistingTrackResult(track, trackIndex, tracks, timeSpans);
  }

  if (strategy.type === "firstAvailable") {
    const existing = findFirstAvailableTrackIndex(ordered, trackType, timeSpans);
    if (existing >= 0) return buildExistingTrackResult(ordered[existing], existing, tracks, timeSpans);
    return resolveAlwaysNewTrack(tracks, trackType, "highest");
  }

  if (strategy.type === "preferIndex") {
    const preferred = trackAt(ordered, strategy.trackIndex);
    const isCompatible = !!preferred && preferred.trackType === trackType;
    const canUseExisting =
      !strategy.createNewTrackOnly &&
      isCompatible &&
      canPlaceTimeSpansOnTrack(preferred, timeSpans);
    if (canUseExisting) {
      return buildExistingTrackResult(preferred, strategy.trackIndex, tracks, timeSpans);
    }
    const { insertIndex, insertPosition } = resolvePreferredNewTrackPlacement(
      tracks,
      trackType,
      strategy.trackIndex,
      getInsertDirection(
        strategy.hoverDirection,
        !isCompatible ? strategy.verticalDragDirection : null,
      ),
    );
    return buildNewTrackResult(trackType, insertIndex, insertPosition);
  }

  if (strategy.type === "aboveSource") {
    const aboveIndex = strategy.sourceTrackIndex - 1;
    const above = trackAt(ordered, aboveIndex);
    if (above && above.trackType === trackType && canPlaceTimeSpansOnTrack(above, timeSpans)) {
      return buildExistingTrackResult(above, aboveIndex, tracks, timeSpans);
    }
    const available = findFirstAvailableTrackIndex(ordered, trackType, timeSpans);
    if (available >= 0) {
      return buildExistingTrackResult(ordered[available], available, tracks, timeSpans);
    }
    return buildNewTrackResult(trackType, getHighestInsertIndexForTrack(tracks, trackType), null);
  }

  return resolveAlwaysNewTrack(tracks, trackType, strategy.position);
}

/**
 * 按用例类型计算实际结果（与 Rust golden master 的 kind 分派一一对应）。
 * @param {string} kind 用例类型
 * @param {object} input 用例输入
 * @returns {object} 实际结果
 */
export function runPlacementCase(kind, input) {
  switch (kind) {
    case "mapAll":
      return {
        trackTypes: input.elementTypes.map((name) => getTrackTypeForElementType(name)),
      };
    case "compatibility":
      return {
        result: validateElementTrackCompatibility(input.elementType, input.trackType),
      };
    case "overlap":
      return { canPlace: canPlaceTimeSpansOnTrack(input.track, input.timeSpans) };
    case "earliest": {
      const element = getEarliestMainTrackElement(input.mainTrack, input.excludeElementId);
      return { elementId: element?.id ?? null };
    }
    case "mainTrack":
      return {
        startTime: enforceMainTrackStart(
          input.tracks,
          input.targetTrackId,
          input.requestedStartTime,
          input.excludeElementId,
        ),
      };
    case "insertIndexAll": {
      const types = ["video", "audio", "effect"];
      const out = { default: {}, highest: {} };
      for (const trackType of types) {
        out.default[trackType] = getDefaultInsertIndexForTrack(input.tracks, trackType);
        out.highest[trackType] = getHighestInsertIndexForTrack(input.tracks, trackType);
      }
      return out;
    }
    case "preferred":
      return resolvePreferredNewTrackPlacement(
        input.tracks,
        input.trackType,
        input.preferredIndex,
        input.direction,
      );
    case "resolve":
      return {
        result: resolveTrackPlacement(
          input.tracks,
          input.subject,
          input.timeSpans,
          input.strategy,
        ),
      };
    default:
      throw new Error(`未知用例类型：${kind}`);
  }
}
