/**
 * 经典版 TS 动画插值的 JS 参考实现（测试基线，非产品代码）。
 *
 * 来源（逐函数对应）：
 * - animation/bezier.ts        → getBezierPoint / getDefaultRightHandle / getDefaultLeftHandle / solveBezierProgressForTime
 * - animation/interpolation.ts → normalizeScalarChannel / normalizeDiscreteChannel /
 *                                getScalarSegmentInterpolation / getScalarChannelValueAtTime /
 *                                getDiscreteChannelValueAtTime / getChannelValueAtTime
 *
 * 唯一差异：时间单位由浮点秒改为整数 ticks（120000 ticks/秒），线性换算不改语义。
 * keyframe-query.ts 依赖 channel-data.ts 与 params 的颜色格式化，不在本参考实现内。
 */

const BEZIER_SOLVE_ITERATIONS = 20;

/** 三次贝塞尔求值。 */
function getBezierPoint(progress, p0, p1, p2, p3) {
  const mt = 1 - progress;
  return (
    mt * mt * mt * p0 +
    3 * mt * mt * progress * p1 +
    3 * mt * progress * progress * p2 +
    progress * progress * progress * p3
  );
}

/** 默认右手柄。 */
function getDefaultRightHandle(leftKey, rightKey) {
  const span = rightKey.time - leftKey.time;
  const valueDelta = rightKey.value - leftKey.value;
  return { dt: span / 3, dv: valueDelta / 3 };
}

/** 默认左手柄。 */
function getDefaultLeftHandle(leftKey, rightKey) {
  const span = rightKey.time - leftKey.time;
  const valueDelta = rightKey.value - leftKey.value;
  return { dt: -span / 3, dv: -valueDelta / 3 };
}

/** 20 次二分求曲线参数。 */
function solveBezierProgressForTime(time, leftKey, rightKey) {
  let lower = 0;
  let upper = 1;
  const rightHandle = leftKey.rightHandle ?? getDefaultRightHandle(leftKey, rightKey);
  const leftHandle = rightKey.leftHandle ?? getDefaultLeftHandle(leftKey, rightKey);
  for (let iteration = 0; iteration < BEZIER_SOLVE_ITERATIONS; iteration++) {
    const mid = (lower + upper) / 2;
    const estimate = getBezierPoint(
      mid,
      leftKey.time,
      leftKey.time + rightHandle.dt,
      rightKey.time + leftHandle.dt,
      rightKey.time,
    );
    if (estimate < time) lower = mid;
    else upper = mid;
  }
  return (lower + upper) / 2;
}

/** 右手柄归一化。 */
function normalizeRightHandle(handle, leftKey, rightKey) {
  if (!handle) return undefined;
  const span = Math.max(1, rightKey.time - leftKey.time);
  return { dt: Math.min(span, Math.max(0, handle.dt)), dv: handle.dv };
}

/** 左手柄归一化。 */
function normalizeLeftHandle(handle, leftKey, rightKey) {
  if (!handle) return undefined;
  const span = Math.max(1, rightKey.time - leftKey.time);
  return { dt: Math.max(-span, Math.min(0, handle.dt)), dv: handle.dv };
}

/** 补齐缺省字段。 */
function normalizeScalarKey(key) {
  return {
    ...key,
    tangentMode: key.tangentMode ?? "flat",
    segmentToNext: key.segmentToNext ?? "linear",
  };
}

/** 归一化标量通道（不产生 undefined 字段，便于跨语言比较）。 */
function normalizeScalarChannel(channel) {
  const sorted = [...channel.keys].map(normalizeScalarKey).sort((a, b) => a.time - b.time);
  const keys = sorted.map((key, index) => {
    const previousKey = sorted[index - 1];
    const nextKey = sorted[index + 1];
    const leftHandle =
      previousKey != null ? normalizeLeftHandle(key.leftHandle, previousKey, key) : undefined;
    const rightHandle =
      nextKey != null ? normalizeRightHandle(key.rightHandle, key, nextKey) : undefined;
    const result = { ...key };
    if (leftHandle) result.leftHandle = leftHandle;
    else delete result.leftHandle;
    if (rightHandle) result.rightHandle = rightHandle;
    else delete result.rightHandle;
    return result;
  });
  return { ...channel, keys };
}

/** 归一化离散通道。 */
function normalizeDiscreteChannel(channel) {
  return { ...channel, keys: [...channel.keys].sort((a, b) => a.time - b.time) };
}

/** 段类型 → 插值类型。 */
function getScalarSegmentInterpolation(segment) {
  if (segment === "step") return "hold";
  return segment === "bezier" ? "bezier" : "linear";
}

/** 线性插值。 */
function lerpNumber(leftValue, rightValue, progress) {
  return leftValue + (rightValue - leftValue) * progress;
}

/** 边界外推。 */
function extrapolateScalarEdge(mode, edgeKey, neighborKey, time) {
  if (mode === "hold" || !neighborKey) return edgeKey.value;
  const span = neighborKey.time - edgeKey.time;
  if (span === 0) return edgeKey.value;
  return edgeKey.value + ((time - edgeKey.time) / span) * (neighborKey.value - edgeKey.value);
}

/** 标量通道求值。 */
function getScalarChannelValueAtTime(channel, time, fallbackValue) {
  if (!channel || channel.keys.length === 0) return fallbackValue;
  const normalized = normalizeScalarChannel(channel);
  const keys = normalized.keys;
  const firstKey = keys[0];
  const lastKey = keys[keys.length - 1];
  if (!firstKey || !lastKey) return fallbackValue;

  if (time <= firstKey.time) {
    if (time < firstKey.time) {
      return extrapolateScalarEdge(
        normalized.extrapolation?.before ?? "hold",
        firstKey,
        keys[1],
        time,
      );
    }
    return firstKey.value;
  }
  if (time >= lastKey.time) {
    if (time > lastKey.time) {
      return extrapolateScalarEdge(
        normalized.extrapolation?.after ?? "hold",
        lastKey,
        keys[keys.length - 2],
        time,
      );
    }
    return lastKey.value;
  }

  for (let keyIndex = 0; keyIndex < keys.length - 1; keyIndex++) {
    const leftKey = keys[keyIndex];
    const rightKey = keys[keyIndex + 1];
    if (time === rightKey.time) return rightKey.value;
    if (time < leftKey.time || time > rightKey.time) continue;
    if (leftKey.segmentToNext === "step") return leftKey.value;
    const span = rightKey.time - leftKey.time;
    if (span === 0) return rightKey.value;
    const progress = Math.min(Math.max((time - leftKey.time) / span, 0), 1);
    if (leftKey.segmentToNext === "linear") {
      return lerpNumber(leftKey.value, rightKey.value, progress);
    }
    const curveProgress = solveBezierProgressForTime(time, leftKey, rightKey);
    const rightHandle = leftKey.rightHandle ?? getDefaultRightHandle(leftKey, rightKey);
    const leftHandle = rightKey.leftHandle ?? getDefaultLeftHandle(leftKey, rightKey);
    return getBezierPoint(
      curveProgress,
      leftKey.value,
      leftKey.value + rightHandle.dv,
      rightKey.value + leftHandle.dv,
      rightKey.value,
    );
  }
  return lastKey.value;
}

/** 离散通道求值。 */
function getDiscreteChannelValueAtTime(channel, time, fallbackValue) {
  if (!channel || channel.keys.length === 0) return fallbackValue;
  const normalized = normalizeDiscreteChannel(channel);
  let currentValue = fallbackValue;
  for (const key of normalized.keys) {
    if (time < key.time) break;
    currentValue = key.value;
  }
  return currentValue;
}

/** 是否为标量通道（经典版靠 extrapolation / segmentToNext 判别，这里按值类型）。 */
function isScalarChannel(channel) {
  return channel.keys.length === 0 || typeof channel.keys[0].value === "number";
}

/** 统一入口。 */
function getChannelValueAtTime(channel, time, fallbackValue) {
  if (!channel || channel.keys.length === 0) return fallbackValue;
  if (typeof fallbackValue === "number") {
    return isScalarChannel(channel)
      ? getScalarChannelValueAtTime(channel, time, fallbackValue)
      : fallbackValue;
  }
  if (typeof fallbackValue !== "string" && typeof fallbackValue !== "boolean") {
    return fallbackValue;
  }
  return getDiscreteChannelValueAtTime(isScalarChannel(channel) ? undefined : channel, time, fallbackValue);
}

/**
 * 按用例类型计算实际结果（与 Rust golden master 的 kind 分派一一对应）。
 * @param {string} kind 用例类型
 * @param {object} input 用例输入
 * @returns {object} 实际结果
 */
export function runAnimationCase(kind, input) {
  switch (kind) {
    case "bezierPoint":
      return {
        value: getBezierPoint(input.progress, input.p0, input.p1, input.p2, input.p3),
      };
    case "defaultHandles":
      return {
        right: getDefaultRightHandle(input.leftKey, input.rightKey),
        left: getDefaultLeftHandle(input.leftKey, input.rightKey),
      };
    case "solveProgress":
      return {
        progress: solveBezierProgressForTime(input.time, input.leftKey, input.rightKey),
      };
    case "segmentInterpolationAll":
      return {
        step: getScalarSegmentInterpolation("step"),
        linear: getScalarSegmentInterpolation("linear"),
        bezier: getScalarSegmentInterpolation("bezier"),
      };
    case "normalizeScalar":
      return { channel: normalizeScalarChannel(input.channel) };
    case "normalizeDiscrete":
      return { channel: normalizeDiscreteChannel(input.channel) };
    case "scalarValue":
      return {
        value: getScalarChannelValueAtTime(input.channel, input.time, input.fallbackValue),
      };
    case "discreteValue":
      return {
        value: getDiscreteChannelValueAtTime(input.channel, input.time, input.fallbackValue),
      };
    case "channelValue":
      return {
        value: getChannelValueAtTime(input.channel, input.time, input.fallbackValue),
      };
    default:
      throw new Error(`未知用例类型：${kind}`);
  }
}
