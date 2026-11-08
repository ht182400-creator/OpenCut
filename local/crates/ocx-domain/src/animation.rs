//! 关键帧插值：经典版 `apps/web/src/animation/{bezier,interpolation}.ts` 的 Rust 翻译。
//!
//! 对应关系：
//! - `bezier.ts` → [`get_bezier_point`] / [`get_default_right_handle`] / [`get_default_left_handle`] / [`solve_bezier_progress_for_time`]
//! - `interpolation.ts` → [`normalize_scalar_channel`] / [`normalize_discrete_channel`] /
//!   [`get_scalar_segment_interpolation`] / [`get_scalar_channel_value_at_time`] /
//!   [`get_discrete_channel_value_at_time`] / [`get_channel_value_at_time`]
//!
//! `keyframe-query.ts` 依赖 `channel-data.ts` 与 `params` 的颜色格式化，本批不翻译。
//! 时间单位为 `MediaTime` 的 ticks；数值仍为 f64（与经典版 number 一致）。
//! 跨语言对齐时浮点按 1e-9 容差比较，见 `tests/ANIMATION_CASES.md`。

use serde::{Deserialize, Serialize};

/// 贝塞尔求解的二分迭代次数（经典版常量）。
pub const BEZIER_SOLVE_ITERATIONS: usize = 20;
/// 跨语言浮点比较容差。经典版贝塞尔仅 20 次二分（误差约 5e-7），
/// 经数值缩放后约 5e-6，故取 1e-5；仍远小于任何逻辑错误产生的偏差。
pub const VALUE_EPSILON: f64 = 1e-5;

/// 标量段插值类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScalarSegmentType {
    Step,
    Linear,
    Bezier,
}

/// 切线模式（归一化时默认 flat）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TangentMode {
    Auto,
    Aligned,
    Broken,
    Flat,
}

/// 边界外推模式（默认 hold）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExtrapolationMode {
    Hold,
    Linear,
}

/// 对外暴露的插值类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnimationInterpolation {
    Hold,
    Linear,
    Bezier,
}

/// 曲线手柄：`dt` 为 ticks，`dv` 为数值增量。
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurveHandle {
    pub dt: i64,
    pub dv: f64,
}

/// 标量关键帧。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScalarKey {
    pub id: String,
    pub time: i64,
    pub value: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left_handle: Option<CurveHandle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right_handle: Option<CurveHandle>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub segment_to_next: Option<ScalarSegmentType>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tangent_mode: Option<TangentMode>,
}

impl ScalarKey {
    /// 该帧到下一帧的段类型，缺省按经典版为 linear。
    pub fn segment_to_next(&self) -> ScalarSegmentType {
        self.segment_to_next.unwrap_or(ScalarSegmentType::Linear)
    }
}

/// 边界外推配置。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChannelExtrapolation {
    pub before: ExtrapolationMode,
    pub after: ExtrapolationMode,
}

/// 标量通道。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScalarChannel {
    pub keys: Vec<ScalarKey>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub extrapolation: Option<ChannelExtrapolation>,
}

/// 离散值（布尔或字符串，对应经典版 `DiscreteValue`）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum DiscreteValue {
    Bool(bool),
    Text(String),
}

/// 离散关键帧。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscreteKey {
    pub id: String,
    pub time: i64,
    pub value: DiscreteValue,
}

/// 离散通道。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscreteChannel {
    pub keys: Vec<DiscreteKey>,
}

/// 通道联合类型。经典版靠 `extrapolation` / `segmentToNext` 判别，
/// 这里用 serde untagged 按 value 的数值类型判别（语义等价）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum AnimationChannel {
    Scalar(ScalarChannel),
    Discrete(DiscreteChannel),
}

impl AnimationChannel {
    /// 是否为标量通道。
    pub fn is_scalar(&self) -> bool {
        matches!(self, AnimationChannel::Scalar(_))
    }

    /// 通道是否为空。
    pub fn is_empty(&self) -> bool {
        match self {
            AnimationChannel::Scalar(channel) => channel.keys.is_empty(),
            AnimationChannel::Discrete(channel) => channel.keys.is_empty(),
        }
    }
}

/// 参数值（数字 / 布尔 / 字符串）。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ParamValue {
    Number(f64),
    Bool(bool),
    Text(String),
}

impl ParamValue {
    /// 从离散值构造参数值。
    fn from_discrete(value: DiscreteValue) -> Self {
        match value {
            DiscreteValue::Bool(flag) => ParamValue::Bool(flag),
            DiscreteValue::Text(text) => ParamValue::Text(text),
        }
    }
}

/// 三次贝塞尔求值（`progress` 为 0~1 的曲线参数）。
pub fn get_bezier_point(progress: f64, p0: f64, p1: f64, p2: f64, p3: f64) -> f64 {
    let mt = 1.0 - progress;
    mt * mt * mt * p0
        + 3.0 * mt * mt * progress * p1
        + 3.0 * mt * progress * progress * p2
        + progress * progress * progress * p3
}

/// 默认右手柄（时间跨度的 1/3、数值增量的 1/3）。
pub fn get_default_right_handle(left_key: &ScalarKey, right_key: &ScalarKey) -> CurveHandle {
    CurveHandle {
        dt: (right_key.time - left_key.time) / 3,
        dv: (right_key.value - left_key.value) / 3.0,
    }
}

/// 默认左手柄（负值）。
pub fn get_default_left_handle(left_key: &ScalarKey, right_key: &ScalarKey) -> CurveHandle {
    CurveHandle {
        dt: -(right_key.time - left_key.time) / 3,
        dv: -(right_key.value - left_key.value) / 3.0,
    }
}

/// 用 20 次二分求解给定时间对应的曲线参数。
pub fn solve_bezier_progress_for_time(
    time: i64,
    left_key: &ScalarKey,
    right_key: &ScalarKey,
) -> f64 {
    let mut lower = 0.0f64;
    let mut upper = 1.0f64;
    let right_handle = left_key
        .right_handle
        .unwrap_or_else(|| get_default_right_handle(left_key, right_key));
    let left_handle = right_key
        .left_handle
        .unwrap_or_else(|| get_default_left_handle(left_key, right_key));

    for _ in 0..BEZIER_SOLVE_ITERATIONS {
        let mid = (lower + upper) / 2.0;
        let estimate = get_bezier_point(
            mid,
            left_key.time as f64,
            left_key.time as f64 + right_handle.dt as f64,
            right_key.time as f64 + left_handle.dt as f64,
            right_key.time as f64,
        );
        if estimate < time as f64 {
            lower = mid;
        } else {
            upper = mid;
        }
    }
    (lower + upper) / 2.0
}

/// 右手柄归一化：无手柄返回 None，否则把 dt 夹到 `[0, span]`。
fn normalize_right_handle(
    handle: Option<&CurveHandle>,
    left_key: &ScalarKey,
    right_key: &ScalarKey,
) -> Option<CurveHandle> {
    let handle = handle?;
    let span = (right_key.time - left_key.time).max(1);
    Some(CurveHandle {
        dt: handle.dt.clamp(0, span),
        dv: handle.dv,
    })
}

/// 左手柄归一化：把 dt 夹到 `[-span, 0]`。
fn normalize_left_handle(
    handle: Option<&CurveHandle>,
    left_key: &ScalarKey,
    right_key: &ScalarKey,
) -> Option<CurveHandle> {
    let handle = handle?;
    let span = (right_key.time - left_key.time).max(1);
    Some(CurveHandle {
        dt: handle.dt.clamp(-span, 0),
        dv: handle.dv,
    })
}

/// 补齐关键帧缺省字段（tangentMode=flat、segmentToNext=linear）。
fn normalize_scalar_key(key: &ScalarKey) -> ScalarKey {
    ScalarKey {
        tangent_mode: Some(key.tangent_mode.unwrap_or(TangentMode::Flat)),
        segment_to_next: Some(key.segment_to_next()),
        ..key.clone()
    }
}

/// 归一化标量通道：排序 → 补缺省字段 → 按相邻帧归一化手柄。
pub fn normalize_scalar_channel(channel: &ScalarChannel) -> ScalarChannel {
    let mut sorted: Vec<ScalarKey> = channel.keys.iter().map(normalize_scalar_key).collect();
    sorted.sort_by_key(|key| key.time);

    let mut keys = Vec::with_capacity(sorted.len());
    for index in 0..sorted.len() {
        let key = sorted[index].clone();
        let previous = index.checked_sub(1).map(|prev| &sorted[prev]);
        let next = sorted.get(index + 1);
        let left_handle =
            previous.and_then(|prev| normalize_left_handle(key.left_handle.as_ref(), prev, &key));
        let right_handle = next
            .and_then(|next_key| normalize_right_handle(key.right_handle.as_ref(), &key, next_key));
        keys.push(ScalarKey {
            left_handle,
            right_handle,
            ..key
        });
    }
    ScalarChannel {
        keys,
        extrapolation: channel.extrapolation,
    }
}

/// 归一化离散通道：按时间稳定排序。
pub fn normalize_discrete_channel(channel: &DiscreteChannel) -> DiscreteChannel {
    let mut keys = channel.keys.clone();
    keys.sort_by_key(|key| key.time);
    DiscreteChannel { keys }
}

/// 段类型 → 对外插值类型。
pub fn get_scalar_segment_interpolation(segment: ScalarSegmentType) -> AnimationInterpolation {
    match segment {
        ScalarSegmentType::Step => AnimationInterpolation::Hold,
        ScalarSegmentType::Bezier => AnimationInterpolation::Bezier,
        ScalarSegmentType::Linear => AnimationInterpolation::Linear,
    }
}

/// 线性插值。
fn lerp_number(left_value: f64, right_value: f64, progress: f64) -> f64 {
    left_value + (right_value - left_value) * progress
}

/// 边界外推（hold 直接取边界值，linear 按相邻帧斜率外推）。
fn extrapolate_scalar_edge(
    mode: Option<ExtrapolationMode>,
    edge_key: &ScalarKey,
    neighbor_key: Option<&ScalarKey>,
    time: i64,
) -> f64 {
    let Some(neighbor) = neighbor_key else {
        return edge_key.value;
    };
    if mode != Some(ExtrapolationMode::Linear) {
        return edge_key.value;
    }
    let span = neighbor.time - edge_key.time;
    if span == 0 {
        return edge_key.value;
    }
    edge_key.value
        + ((time - edge_key.time) as f64 / span as f64) * (neighbor.value - edge_key.value)
}

/// 标量通道在给定时间的取值：含边界外推、step / linear / bezier 三种段。
pub fn get_scalar_channel_value_at_time(
    channel: &ScalarChannel,
    time: i64,
    fallback_value: f64,
) -> f64 {
    if channel.keys.is_empty() {
        return fallback_value;
    }
    let normalized = normalize_scalar_channel(channel);
    let keys = &normalized.keys;
    let first = &keys[0];
    let last = &keys[keys.len() - 1];

    let extrapolation = normalized.extrapolation;
    if time <= first.time {
        if time < first.time {
            return extrapolate_scalar_edge(
                extrapolation.map(|item| item.before),
                first,
                keys.get(1),
                time,
            );
        }
        return first.value;
    }
    if time >= last.time {
        if time > last.time {
            return extrapolate_scalar_edge(
                extrapolation.map(|item| item.after),
                last,
                keys.len().checked_sub(2).and_then(|index| keys.get(index)),
                time,
            );
        }
        return last.value;
    }

    for index in 0..keys.len() - 1 {
        let left = &keys[index];
        let right = &keys[index + 1];
        if time == right.time {
            return right.value;
        }
        if time < left.time || time > right.time {
            continue;
        }
        if left.segment_to_next() == ScalarSegmentType::Step {
            return left.value;
        }
        let span = right.time - left.time;
        if span == 0 {
            return right.value;
        }
        let progress = ((time - left.time) as f64 / span as f64).clamp(0.0, 1.0);
        if left.segment_to_next() == ScalarSegmentType::Linear {
            return lerp_number(left.value, right.value, progress);
        }

        let curve_progress = solve_bezier_progress_for_time(time, left, right);
        let right_handle = left
            .right_handle
            .unwrap_or_else(|| get_default_right_handle(left, right));
        let left_handle = right
            .left_handle
            .unwrap_or_else(|| get_default_left_handle(left, right));
        return get_bezier_point(
            curve_progress,
            left.value,
            left.value + right_handle.dv,
            right.value + left_handle.dv,
            right.value,
        );
    }
    last.value
}

/// 离散通道在给定时间的取值（取时间不晚于 time 的最后一帧）。
pub fn get_discrete_channel_value_at_time(
    channel: &DiscreteChannel,
    time: i64,
    fallback_value: &DiscreteValue,
) -> DiscreteValue {
    if channel.keys.is_empty() {
        return fallback_value.clone();
    }
    let normalized = normalize_discrete_channel(channel);
    let mut current = fallback_value.clone();
    for key in &normalized.keys {
        if time < key.time {
            break;
        }
        current = key.value.clone();
    }
    current
}

/// 统一入口：按 fallback 类型与通道类型分派（对应经典版重载）。
pub fn get_channel_value_at_time(
    channel: Option<&AnimationChannel>,
    time: i64,
    fallback_value: &ParamValue,
) -> ParamValue {
    let Some(channel) = channel else {
        return fallback_value.clone();
    };
    if channel.is_empty() {
        return fallback_value.clone();
    }
    match fallback_value {
        ParamValue::Number(fallback) => match channel {
            AnimationChannel::Scalar(scalar) => {
                ParamValue::Number(get_scalar_channel_value_at_time(scalar, time, *fallback))
            }
            AnimationChannel::Discrete(_) => fallback_value.clone(),
        },
        ParamValue::Bool(flag) => match channel {
            AnimationChannel::Scalar(_) => fallback_value.clone(),
            AnimationChannel::Discrete(discrete) => ParamValue::from_discrete(
                get_discrete_channel_value_at_time(discrete, time, &DiscreteValue::Bool(*flag)),
            ),
        },
        ParamValue::Text(text) => match channel {
            AnimationChannel::Scalar(_) => fallback_value.clone(),
            AnimationChannel::Discrete(discrete) => {
                ParamValue::from_discrete(get_discrete_channel_value_at_time(
                    discrete,
                    time,
                    &DiscreteValue::Text(text.clone()),
                ))
            }
        },
    }
}
