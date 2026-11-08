/**
 * 经典版 TS ripple 的 JS 参考实现（测试基线，非产品代码）。
 *
 * 来源（逐函数对应）：
 * - apps/web/src/ripple/diff.ts  → computeRippleAdjustments
 * - apps/web/src/ripple/shift.ts → rippleShiftElements
 * - apps/web/src/ripple/apply.ts → applyRippleAdjustments
 *
 * 唯一差异：经典版用浮点秒，这里与 Rust core 一致改用整数 ticks（120000 ticks/秒）。
 * 线性换算不改变任何比较/加减的语义；该差异由 golden master 用例固定。
 */

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

/**
 * 饱和加减：与 Rust add_ticks/sub_ticks 保持一致，避免极值溢出。
 * @param {number} left 左操作数
 * @param {number} right 右操作数
 * @returns {number} 夹在 i64 范围内的结果
 */
function addTicks(left, right) {
  const sum = BigInt(left) + BigInt(right);
  const clamped = sum < I64_MIN ? I64_MIN : sum > I64_MAX ? I64_MAX : sum;
  return Number(clamped);
}

/**
 * 仅供区间差值使用（保持与经典版同形的减法命名）。
 * @param {number} left 左操作数
 * @param {number} right 右操作数
 * @returns {number} 结果
 */
function subTicks(left, right) {
  const diff = BigInt(left) - BigInt(right);
  const clamped = diff < I64_MIN ? I64_MIN : diff > I64_MAX ? I64_MAX : diff;
  return Number(clamped);
}

/**
 * 仅在 end > start 时追加区间。
 * @param {Array<{startTime:number,endTime:number}>} intervals 目标数组
 * @param {number} startTime 起点
 * @param {number} endTime 终点
 * @returns {void}
 */
function pushInterval(intervals, startTime, endTime) {
  if (endTime <= startTime) return;
  intervals.push({ startTime, endTime });
}

/**
 * 过滤非法区间、稳定排序、合并重叠或相邻区间。
 * @param {Array<{startTime:number,endTime:number}>} intervals 输入区间
 * @returns {Array<{startTime:number,endTime:number}>} 归一化区间
 */
function normalizeIntervals(intervals) {
  const valid = [];
  for (const interval of intervals) {
    pushInterval(valid, interval.startTime, interval.endTime);
  }
  const sorted = valid.sort((a, b) => a.startTime - b.startTime);
  if (sorted.length === 0) return [];
  const merged = [{ ...sorted[0] }];
  for (const interval of sorted.slice(1)) {
    const previous = merged[merged.length - 1];
    if (interval.startTime <= previous.endTime) {
      previous.endTime = Math.max(previous.endTime, interval.endTime);
      continue;
    }
    merged.push({ ...interval });
  }
  return merged;
}

/**
 * 用重叠区间切掉单个源区间。
 * @param {{startTime:number,endTime:number}} sourceInterval 源区间
 * @param {Array<{startTime:number,endTime:number}>} overlappingIntervals 重叠区间
 * @returns {Array<{startTime:number,endTime:number}>} 剩余片段
 */
function subtractSingleInterval(sourceInterval, overlappingIntervals) {
  let remaining = [{ ...sourceInterval }];
  for (const overlap of overlappingIntervals) {
    const next = [];
    for (const part of remaining) {
      if (overlap.endTime <= part.startTime || overlap.startTime >= part.endTime) {
        next.push(part);
        continue;
      }
      pushInterval(next, part.startTime, overlap.startTime);
      pushInterval(next, overlap.endTime, part.endTime);
    }
    remaining = next;
    if (remaining.length === 0) return [];
  }
  return remaining;
}

/**
 * 集合差：源区间扣除重叠区间。
 * @param {Array} sourceIntervals 源区间
 * @param {Array} overlappingIntervals 重叠区间
 * @returns {Array} 剩余区间
 */
function subtractIntervalSets(sourceIntervals, overlappingIntervals) {
  const source = normalizeIntervals(sourceIntervals);
  const overlapping = normalizeIntervals(overlappingIntervals);
  return source.flatMap((interval) => subtractSingleInterval(interval, overlapping));
}

/**
 * 构建元素区间 Map（保序，重复 id 覆盖值但保持首次位置）。
 * @param {Array<{id:string,startTime:number,duration:number}>} elements 元素列表
 * @returns {Map<string,{id:string,startTime:number,endTime:number}>} 区间映射
 */
function buildElementSpanMap(elements) {
  return new Map(
    elements.map((element) => [
      element.id,
      {
        id: element.id,
        startTime: element.startTime,
        endTime: addTicks(element.startTime, element.duration),
      },
    ]),
  );
}

/**
 * 收集腾空区间与新占区间。
 * @param {Map} beforeElementsById 变更前元素
 * @param {Map} afterElementsById 变更后元素
 * @param {Set<string>} allAfterElementIds 变更后全局元素 id
 * @returns {{vacatedIntervals:Array,joinedIntervals:Array}} 两类区间
 */
function collectTrackIntervals(beforeElementsById, afterElementsById, allAfterElementIds) {
  const vacatedIntervals = [];
  const joinedIntervals = [];
  for (const beforeElement of beforeElementsById.values()) {
    const afterElement = afterElementsById.get(beforeElement.id);
    if (!afterElement) {
      if (!allAfterElementIds.has(beforeElement.id)) {
        pushInterval(vacatedIntervals, beforeElement.startTime, beforeElement.endTime);
      }
      continue;
    }
    if (beforeElement.endTime > afterElement.endTime) {
      pushInterval(vacatedIntervals, afterElement.endTime, beforeElement.endTime);
    }
  }
  for (const afterElement of afterElementsById.values()) {
    if (beforeElementsById.has(afterElement.id)) continue;
    pushInterval(joinedIntervals, afterElement.startTime, afterElement.endTime);
  }
  return {
    vacatedIntervals: normalizeIntervals(vacatedIntervals),
    joinedIntervals: normalizeIntervals(joinedIntervals),
  };
}

/**
 * 把腾空区间转成调整。
 * @param {string} trackId 轨道 id
 * @param {Array} intervals 腾空区间
 * @returns {Array<{trackId:string,afterTime:number,shiftAmount:number}>} 调整列表
 */
function buildAdjustments(trackId, intervals) {
  return intervals.flatMap((interval) => {
    const shiftAmount = subTicks(interval.endTime, interval.startTime);
    if (shiftAmount <= 0) return [];
    return [{ trackId, afterTime: interval.endTime, shiftAmount }];
  });
}

/**
 * 单轨道的 ripple 计算。
 * @param {string} trackId 轨道 id
 * @param {Array} beforeElements 变更前元素
 * @param {Array} afterElements 变更后元素
 * @param {Set<string>} allAfterElementIds 全局元素 id
 * @returns {Array} 调整列表
 */
function computeTrackRippleAdjustments(trackId, beforeElements, afterElements, allAfterElementIds) {
  const beforeMap = buildElementSpanMap(beforeElements);
  const afterMap = buildElementSpanMap(afterElements);
  const { vacatedIntervals, joinedIntervals } = collectTrackIntervals(
    beforeMap,
    afterMap,
    allAfterElementIds,
  );
  const freed = subtractIntervalSets(vacatedIntervals, joinedIntervals);
  return buildAdjustments(trackId, freed);
}

/**
 * 计算从 before 到 after 需要的 ripple 调整（轨道顺序 overlay → main → audio）。
 * @param {{beforeTracks:object,afterTracks:object}} options 输入
 * @returns {Array} 调整列表
 */
export function computeRippleAdjustments({ beforeTracks, afterTracks }) {
  const beforeTrackList = [
    ...beforeTracks.overlay,
    beforeTracks.main,
    ...beforeTracks.audio,
  ];
  const afterTrackList = [...afterTracks.overlay, afterTracks.main, ...afterTracks.audio];
  const afterTracksById = new Map(afterTrackList.map((track) => [track.id, track]));
  const allAfterElementIds = new Set(
    afterTrackList.flatMap((track) => track.elements.map((element) => element.id)),
  );
  return beforeTrackList.flatMap((beforeTrack) =>
    computeTrackRippleAdjustments(
      beforeTrack.id,
      beforeTrack.elements,
      afterTracksById.get(beforeTrack.id)?.elements ?? [],
      allAfterElementIds,
    ),
  );
}

/**
 * 把 afterTime 及之后开始的元素前移 shiftAmount。
 * @param {{elements:Array,afterTime:number,shiftAmount:number}} options 输入
 * @returns {Array} 新元素列表
 */
export function rippleShiftElements({ elements, afterTime, shiftAmount }) {
  return elements.map((element) =>
    element.startTime >= afterTime
      ? { ...element, startTime: subTicks(element.startTime, shiftAmount) }
      : element,
  );
}

/**
 * 对单轨道按 afterTime 降序应用调整。
 * @param {object} track 轨道
 * @param {Array} adjustments 调整列表
 * @returns {object} 新轨道
 */
function applyTrackRippleAdjustments(track, adjustments) {
  if (adjustments.length === 0) return track;
  const sorted = [...adjustments].sort((a, b) => b.afterTime - a.afterTime);
  let elements = track.elements;
  for (const adjustment of sorted) {
    elements = rippleShiftElements({
      elements,
      afterTime: adjustment.afterTime,
      shiftAmount: adjustment.shiftAmount,
    });
  }
  return { ...track, elements };
}

/**
 * 应用调整到整个场景。
 * @param {{tracks:object,adjustments:Array}} options 输入
 * @returns {object} 新场景
 */
export function applyRippleAdjustments({ tracks, adjustments }) {
  if (adjustments.length === 0) return tracks;
  const adjustmentsByTrack = new Map();
  for (const adjustment of adjustments) {
    const list = adjustmentsByTrack.get(adjustment.trackId) ?? [];
    list.push(adjustment);
    adjustmentsByTrack.set(adjustment.trackId, list);
  }
  return {
    overlay: tracks.overlay.map((track) =>
      applyTrackRippleAdjustments(track, adjustmentsByTrack.get(track.id) ?? []),
    ),
    main: applyTrackRippleAdjustments(tracks.main, adjustmentsByTrack.get(tracks.main.id) ?? []),
    audio: tracks.audio.map((track) =>
      applyTrackRippleAdjustments(track, adjustmentsByTrack.get(track.id) ?? []),
    ),
  };
}
