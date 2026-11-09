/**
 * 经典版项目 JSON 兼容与 keyframe-query 的 JS 参考实现（测试基线，非产品代码）。
 *
 * 来源：
 * - `apps/web/src/services/storage/migrations/index.ts`（v31）、`project/types.ts`、`storage/types.ts`
 * - `apps/web/src/animation/{keyframe-query,channel-data,path,interpolation,params/index}.ts`
 *
 * 与经典版唯一的顺序差异：路径遍历固定为字典序（`Object.keys(...).sort()`），
 * 与 Rust 的 BTreeMap 对齐；结果本身按时间排序，不受该差异影响。
 * 标量通道求值复用同批已对齐的 `animation-reference.mjs`，避免重复实现插值。
 */

import { runAnimationCase } from "./animation-reference.mjs";

const CLASSIC_PROJECT_VERSION = 31;
const LEGACY_KEYS = ["bindings", "channels"];
const ANIMATION_PATHS = [
  "transform.positionX", "transform.positionY", "transform.scaleX",
  "transform.scaleY", "transform.rotate", "opacity", "volume", "color",
  "background.color", "background.paddingX", "background.paddingY",
  "background.offsetX", "background.offsetY", "background.cornerRadius",
];
const GRAPHIC_PREFIX = "params.";
const EFFECT_PREFIX = "effects.";
const EFFECT_SUFFIX = ".params.";

/** 按 Unicode 码点字典序比较（与 Rust BTreeMap 一致）。 */
function compareStrings(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

/** 是否为合法动画属性路径。 */
export function isAnimationPath(path) {
  return (
    ANIMATION_PATHS.includes(path) ||
    path.startsWith(GRAPHIC_PREFIX) ||
    (path.startsWith(EFFECT_PREFIX) && path.includes(EFFECT_SUFFIX))
  );
}

/** 是否为动画存储键（排除遗留键）。 */
export function isAnimationStorageKey(key) {
  return !LEGACY_KEYS.includes(key);
}

/** 线性分量转 sRGB。 */
function linearToSrgb(value) {
  const clamped = Math.min(Math.max(value, 0), 1);
  return clamped <= 0.0031308
    ? clamped * 12.92
    : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

/** sRGB 分量转 8 位十六进制字节。 */
function toHexByte(value) {
  return Math.round(Math.min(Math.max(value, 0), 1) * 255);
}

/** 线性 RGBA → hex / hex8。 */
export function formatLinearRgba(r, g, b, a) {
  const hex = [r, g, b]
    .map((component) => toHexByte(linearToSrgb(component)).toString(16).padStart(2, "0"))
    .join("");
  const alpha = Math.min(Math.max(a, 0), 1);
  if (alpha < 1) {
    const alphaByte = Math.round(alpha * 255).toString(16).padStart(2, "0");
    return `#${hex}${alphaByte}`;
  }
  return `#${hex}`;
}

/** 叶通道判别。 */
function isLeaf(data) {
  return !!data && typeof data === "object" && Array.isArray(data.keys);
}

/** 取通道分量条目；叶通道固定使用键 value。 */
function getChannelEntries(data) {
  if (!data) return [];
  if (isLeaf(data)) return [["value", data]];
  if (typeof data !== "object") return [];
  return Object.entries(data)
    .filter(([, channel]) => isLeaf(channel))
    .sort(([left], [right]) => compareStrings(left, right));
}

/** 是否为标量通道。 */
function isScalarChannel(channel) {
  return channel.keys.length === 0 || typeof channel.keys[0].value === "number";
}

/** 通道在给定时间的取值。 */
function getChannelValueAtTime(channel, time) {
  const keys = channel.keys || [];
  const fallback = keys.length === 0
    ? (isScalarChannel(channel) ? 0 : false)
    : keys[0].value;
  if (typeof fallback === "number") {
    if (!isScalarChannel(channel)) return fallback;
    return runAnimationCase("scalarValue", {
      channel,
      time,
      fallbackValue: fallback,
    }).value;
  }
  if (isScalarChannel(channel)) return fallback;
  let current = fallback;
  const sorted = [...keys].sort((left, right) => left.time - right.time);
  for (const key of sorted) {
    if (time < key.time) break;
    current = key.value;
  }
  return current;
}

/** 复合通道数据在给定时间的取值。 */
function getComposedValueAtTime(data, time) {
  const entries = getChannelEntries(data);
  if (entries.length === 0) return null;
  if (entries.length === 1 && entries[0][0] === "value") {
    return getChannelValueAtTime(entries[0][1], time);
  }
  const components = {};
  for (const [key, channel] of entries) {
    components[key] = getChannelValueAtTime(channel, time);
  }
  const allNumbers = ["r", "g", "b", "a"].every(
    (key) => typeof components[key] === "number",
  );
  if (!allNumbers) return null;
  return formatLinearRgba(
    components.r, components.g, components.b, components.a,
  );
}

/** 收集通道内所有关键帧引用。 */
function getChannelKeyframeMatches(data) {
  return getChannelEntries(data).flatMap(([componentKey, channel], componentIndex) => {
    if (!channel.keys || channel.keys.length === 0) return [];
    return channel.keys.map((keyframe) => ({
      componentKey,
      componentIndex,
      channelIsScalar: isScalarChannel(channel),
      keyframe,
    }));
  });
}

/** 同一时刻只保留一条；后来出现的 value 分量优先。 */
function getUniqueMatches(matches) {
  const sorted = [...matches].sort(
    (left, right) =>
      left.keyframe.time - right.keyframe.time ||
      left.componentIndex - right.componentIndex,
  );
  const unique = [];
  for (const match of sorted) {
    const previous = unique[unique.length - 1];
    if (!previous || previous.keyframe.time !== match.keyframe.time) {
      unique.push(match);
      continue;
    }
    if (previous.componentIndex !== 0 && match.componentIndex === 0) {
      unique[unique.length - 1] = match;
    }
  }
  return unique;
}

/** 优先取 value 分量的匹配。 */
function getPreferredMatch(matches) {
  return matches.find((match) => match.componentIndex === 0) ?? matches[0] ?? null;
}

/** 段类型 → 插值类型。 */
function getSegmentInterpolation(segment) {
  if (segment === "step") return "hold";
  return segment === "bezier" ? "bezier" : "linear";
}

/** 关键帧引用 → 对外结果。 */
function toElementKeyframe(data, propertyPath, match) {
  const value = getComposedValueAtTime(data, match.keyframe.time);
  if (value === null) return null;
  const interpolation =
    match.channelIsScalar && "segmentToNext" in match.keyframe
      ? getSegmentInterpolation(match.keyframe.segmentToNext)
      : "hold";
  return {
    propertyPath,
    id: match.keyframe.id,
    time: match.keyframe.time,
    value,
    interpolation,
  };
}

/** 列出元素全部关键帧。 */
function getElementKeyframes(animations) {
  const result = [];
  for (const path of Object.keys(animations).sort(compareStrings)) {
    if (!isAnimationStorageKey(path) || !animations[path] || !isAnimationPath(path)) continue;
    const data = animations[path];
    for (const match of getUniqueMatches(getChannelKeyframeMatches(data))) {
      const keyframe = toElementKeyframe(data, path, match);
      if (keyframe) result.push(keyframe);
    }
  }
  return result;
}

/** 指定路径是否存在关键帧。 */
function hasKeyframesForPath(animations, propertyPath) {
  return getChannelEntries(animations[propertyPath]).some(
    ([, channel]) => channel.keys.length > 0,
  );
}

/** 取指定时刻的关键帧。 */
function getKeyframeAtTime(animations, propertyPath, time) {
  const data = animations[propertyPath];
  if (!data) return null;
  const matches = getChannelKeyframeMatches(data).filter(
    (match) => match.keyframe.time === time,
  );
  const preferred = getPreferredMatch(matches);
  return preferred ? toElementKeyframe(data, propertyPath, preferred) : null;
}

/** 按 id 取关键帧。 */
function getKeyframeById(animations, propertyPath, keyframeId) {
  const data = animations[propertyPath];
  if (!data) return null;
  const matches = getChannelKeyframeMatches(data).filter(
    (match) => match.keyframe.id === keyframeId,
  );
  const preferred = getPreferredMatch(matches);
  return preferred ? toElementKeyframe(data, propertyPath, preferred) : null;
}

/** 经典版项目 JSON 的只读归一化视图（与 Rust 实现字段一一对应）。 */
function readClassicProject(projectJson) {
  let raw;
  try {
    raw = JSON.parse(projectJson);
  } catch {
    return { error: "INVALID_JSON" };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "INVALID_JSON" };
  }
  if (typeof raw.version !== "number") return { error: "MISSING_VERSION" };
  if (raw.version === 0 || raw.version > CLASSIC_PROJECT_VERSION) {
    return { error: "UNSUPPORTED_VERSION" };
  }
  if (raw.metadata == null) return { error: "MISSING_METADATA" };
  if (!Array.isArray(raw.scenes)) return { error: "MISSING_SCENES" };

  const warnings = [];
  const pickString = (object, key, fallback) => {
    if (object && typeof object[key] === "string") return object[key];
    warnings.push(`字段 ${key} 缺失`);
    return fallback;
  };
  const pickTicks = (object, key) => {
    if (object && typeof object[key] === "number" && Number.isInteger(object[key])) {
      return object[key];
    }
    warnings.push(`字段 ${key} 缺失`);
    return 0;
  };
  const fpsValue = raw.settings?.fps;
  const numerator = typeof fpsValue?.numerator === "number"
    ? fpsValue.numerator
    : (warnings.push("fps 缺失"), 30);
  const denominator = typeof fpsValue?.denominator === "number"
    ? fpsValue.denominator
    : 1;
  const canvasValue = raw.settings?.canvasSize;
  const width = typeof canvasValue?.width === "number"
    ? canvasValue.width
    : (warnings.push("canvasSize 缺失"), 1920);
  const height = typeof canvasValue?.height === "number" ? canvasValue.height : 1080;
  const fps = denominator === 0
    ? (warnings.push("帧率分母为 0"), { numerator: 30, denominator: 1 })
    : { numerator, denominator };

  const parseTrack = (track, defaultType) => {
    const id = pickString(track, "id", "");
    let trackType = defaultType;
    if (typeof track.type === "string") {
      trackType = track.type;
    } else if (!defaultType) {
      warnings.push(`轨道 ${id} 缺少 type`);
      trackType = "video";
    }
    const elements = Array.isArray(track.elements)
      ? track.elements.map((element) => ({
          id: pickString(element, "id", ""),
          elementType: pickString(element, "type", "unknown"),
          startTime: pickTicks(element, "startTime"),
          duration: pickTicks(element, "duration"),
        }))
      : [];
    return { id, trackType, elementCount: elements.length, elements };
  };

  const scenes = raw.scenes.map((scene) => {
    const id = pickString(scene, "id", "");
    const name = pickString(scene, "name", "");
    const tracksValue = scene.tracks ?? {};
    const tracks = [];
    if (Array.isArray(tracksValue.overlay)) {
      for (const track of tracksValue.overlay) tracks.push(parseTrack(track, ""));
    }
    if (tracksValue.main && typeof tracksValue.main === "object") {
      tracks.push(parseTrack(tracksValue.main, "video"));
    } else {
      warnings.push(`场景 ${id} 缺少 main 主轨`);
    }
    if (Array.isArray(tracksValue.audio)) {
      for (const track of tracksValue.audio) tracks.push(parseTrack(track, "audio"));
    }
    return { id, name, isMain: scene.isMain === true, tracks };
  });
  const allTracks = scenes.flatMap((scene) => scene.tracks);

  return {
    version: raw.version,
    projectId: pickString(raw.metadata, "id", ""),
    name: pickString(raw.metadata, "name", ""),
    durationTicks: pickTicks(raw.metadata, "duration"),
    fps,
    canvas: { width, height },
    currentSceneId: pickString(raw, "currentSceneId", ""),
    sceneCount: scenes.length,
    scenes,
    warnings,
    trackCount: allTracks.length,
    totalElements: allTracks.reduce((sum, track) => sum + track.elements.length, 0),
    trackTypes: allTracks.map((track) => track.trackType),
    warningsCount: warnings.length,
  };
}

/**
 * 按用例类型计算实际结果（与 Rust golden master 的 kind 分派一一对应）。
 * @param {string} kind 用例类型
 * @param {object} input 用例输入
 * @returns {object} 实际结果
 */
export function runLegacyCase(kind, input) {
  switch (kind) {
    case "readClassicProject": {
      const projectJson = typeof input.projectJson === "string"
        ? input.projectJson
        : JSON.stringify(input.project);
      return readClassicProject(projectJson);
    }
    case "keyframeQuery": {
      switch (input.op) {
        case "isAnimationPath": return { result: isAnimationPath(input.path) };
        case "isAnimationStorageKey": return { result: isAnimationStorageKey(input.path) };
        case "formatLinearRgba": {
          const [r, g, b, a] = input.color;
          return { result: formatLinearRgba(r, g, b, a) };
        }
        case "getElementKeyframes":
          return { result: getElementKeyframes(input.animations) };
        case "hasKeyframesForPath":
          return { result: hasKeyframesForPath(input.animations, input.path) };
        case "getKeyframeAtTime":
          return { result: getKeyframeAtTime(input.animations, input.path, input.time) };
        case "getKeyframeById":
          return { result: getKeyframeById(input.animations, input.path, input.keyframeId) };
        default: throw new Error(`未知 op：${input.op}`);
      }
    }
    default: throw new Error(`未知用例类型：${kind}`);
  }
}
