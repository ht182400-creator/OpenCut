//! 关键帧查询：经典版 `apps/web/src/animation/keyframe-query.ts` 的 Rust 翻译（W-05 第四批）。
//!
//! 依赖的 `channel-data.ts` / `path.ts` 规则一并内置；`formatLinearRgba` 按经典版
//! 「线性 → sRGB → hex/hex8」公式实现，未引入 `culori` 依赖，边界值由 golden master 固定。
//!
//! 与经典版唯一的顺序差异：`Object.entries` 是插入顺序，本 crate 用 `BTreeMap`（字典序）。
//! 为保证跨语言确定性，JS 参考实现同样对路径排序；结果本身按时间排序，不受该差异影响。

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::animation::{
    AnimationChannel, AnimationInterpolation, DiscreteValue, ParamValue, ScalarSegmentType,
    get_discrete_channel_value_at_time, get_scalar_channel_value_at_time,
    get_scalar_segment_interpolation,
};

/// 经典版遗留存储键（不是动画属性路径）。
pub const LEGACY_ANIMATION_STORAGE_KEYS: [&str; 2] = ["bindings", "channels"];
/// 经典的 14 个固定动画属性路径。
pub const ANIMATION_PROPERTY_PATHS: [&str; 14] = [
    "transform.positionX",
    "transform.positionY",
    "transform.scaleX",
    "transform.scaleY",
    "transform.rotate",
    "opacity",
    "volume",
    "color",
    "background.color",
    "background.paddingX",
    "background.paddingY",
    "background.offsetX",
    "background.offsetY",
    "background.cornerRadius",
];
pub const GRAPHIC_PARAM_PATH_PREFIX: &str = "params.";
pub const EFFECT_PARAM_PATH_PREFIX: &str = "effects.";
pub const EFFECT_PARAM_PATH_SUFFIX: &str = ".params.";

/// 通道数据：叶通道或复合（按分量键组织）通道。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ChannelData {
    Leaf(AnimationChannel),
    Composite(BTreeMap<String, Option<AnimationChannel>>),
}

/// 元素动画集合；路径按字典序遍历以保证跨语言确定性。
pub type ElementAnimations = BTreeMap<String, Option<ChannelData>>;

/// 对外暴露的元素关键帧。
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ElementKeyframe {
    pub property_path: String,
    pub id: String,
    pub time: i64,
    pub value: ParamValue,
    pub interpolation: AnimationInterpolation,
}

/// 是否为动画存储键（排除遗留键）。
pub fn is_animation_storage_key(key: &str) -> bool {
    !LEGACY_ANIMATION_STORAGE_KEYS.contains(&key)
}

/// 是否为合法动画属性路径（固定路径 / 图形参数 / 效果参数）。
pub fn is_animation_path(path: &str) -> bool {
    ANIMATION_PROPERTY_PATHS.contains(&path)
        || path.starts_with(GRAPHIC_PARAM_PATH_PREFIX)
        || (path.starts_with(EFFECT_PARAM_PATH_PREFIX) && path.contains(EFFECT_PARAM_PATH_SUFFIX))
}

/// 线性分量转 sRGB（经典版公式，先夹到 0~1）。
fn linear_to_srgb(value: f64) -> f64 {
    let clamped = value.clamp(0.0, 1.0);
    if clamped <= 0.0031308 {
        clamped * 12.92
    } else {
        1.055 * clamped.powf(1.0 / 2.4) - 0.055
    }
}

/// sRGB 分量转 8 位十六进制字节。
fn to_hex_byte(value: f64) -> u8 {
    (value.clamp(0.0, 1.0) * 255.0).round() as u8
}

/// 线性 RGBA → `#rrggbb` / `#rrggbbaa`（alpha < 1 时带 alpha 通道）。
pub fn format_linear_rgba(r: f64, g: f64, b: f64, a: f64) -> String {
    let red = to_hex_byte(linear_to_srgb(r));
    let green = to_hex_byte(linear_to_srgb(g));
    let blue = to_hex_byte(linear_to_srgb(b));
    let alpha = a.clamp(0.0, 1.0);
    if alpha < 1.0 {
        let alpha_byte = (alpha * 255.0).round() as u8;
        format!("#{red:02x}{green:02x}{blue:02x}{alpha_byte:02x}")
    } else {
        format!("#{red:02x}{green:02x}{blue:02x}")
    }
}

/// 取通道的分量条目；叶通道固定使用键 `value`（对应经典版 `getChannelEntriesFromData`）。
pub fn get_channel_entries_from_data(
    data: Option<&ChannelData>,
) -> Vec<(String, AnimationChannel)> {
    match data {
        None => Vec::new(),
        Some(ChannelData::Leaf(channel)) => vec![("value".to_owned(), channel.clone())],
        Some(ChannelData::Composite(map)) => map
            .iter()
            .filter_map(|(key, channel)| channel.as_ref().map(|value| (key.clone(), value.clone())))
            .collect(),
    }
}

/// 通道是否为标量通道。
fn is_scalar(channel: &AnimationChannel) -> bool {
    matches!(channel, AnimationChannel::Scalar(_))
}

/// 通道关键帧数量。
fn key_count(channel: &AnimationChannel) -> usize {
    match channel {
        AnimationChannel::Scalar(scalar) => scalar.keys.len(),
        AnimationChannel::Discrete(discrete) => discrete.keys.len(),
    }
}

/// 首帧的值（作为 fallback）。
fn first_value(channel: &AnimationChannel) -> ParamValue {
    match channel {
        AnimationChannel::Scalar(scalar) => scalar
            .keys
            .first()
            .map(|key| ParamValue::Number(key.value))
            .unwrap_or(ParamValue::Number(0.0)),
        AnimationChannel::Discrete(discrete) => discrete
            .keys
            .first()
            .map(|key| match &key.value {
                DiscreteValue::Bool(flag) => ParamValue::Bool(*flag),
                DiscreteValue::Text(text) => ParamValue::Text(text.clone()),
            })
            .unwrap_or(ParamValue::Bool(false)),
    }
}

/// 通道在给定时间的取值（对应经典版 `getChannelValue`）。
fn get_channel_value(channel: &AnimationChannel, time: i64) -> ParamValue {
    let fallback = if key_count(channel) == 0 {
        if is_scalar(channel) {
            ParamValue::Number(0.0)
        } else {
            ParamValue::Bool(false)
        }
    } else {
        first_value(channel)
    };
    match &fallback {
        ParamValue::Number(number) => match channel {
            AnimationChannel::Scalar(scalar) => {
                ParamValue::Number(get_scalar_channel_value_at_time(scalar, time, *number))
            }
            AnimationChannel::Discrete(_) => fallback.clone(),
        },
        other => match channel {
            AnimationChannel::Scalar(_) => fallback.clone(),
            AnimationChannel::Discrete(discrete) => {
                let discrete_fallback = match other {
                    ParamValue::Bool(flag) => DiscreteValue::Bool(*flag),
                    ParamValue::Text(text) => DiscreteValue::Text(text.clone()),
                    ParamValue::Number(number) => DiscreteValue::Text(number.to_string()),
                };
                match get_discrete_channel_value_at_time(discrete, time, &discrete_fallback) {
                    DiscreteValue::Bool(flag) => ParamValue::Bool(flag),
                    DiscreteValue::Text(text) => ParamValue::Text(text),
                }
            }
        },
    }
}

/// 复合通道数据在给定时间的取值；RGBA 四分量齐全时格式化为 hex 字符串。
fn get_composed_value_at_time(data: Option<&ChannelData>, time: i64) -> Option<ParamValue> {
    let entries = get_channel_entries_from_data(data);
    if entries.is_empty() {
        return None;
    }
    if entries.len() == 1 && entries[0].0 == "value" {
        return Some(get_channel_value(&entries[0].1, time));
    }
    let mut components: BTreeMap<&str, f64> = BTreeMap::new();
    for (key, channel) in &entries {
        if let ParamValue::Number(number) = get_channel_value(channel, time) {
            components.insert(key.as_str(), number);
        }
    }
    let (r, g, b, a) = (
        components.get("r").copied(),
        components.get("g").copied(),
        components.get("b").copied(),
        components.get("a").copied(),
    );
    match (r, g, b, a) {
        (Some(r), Some(g), Some(b), Some(a)) => {
            Some(ParamValue::Text(format_linear_rgba(r, g, b, a)))
        }
        _ => None,
    }
}

/// 内部关键帧引用（避免复制整条通道）。
#[derive(Debug, Clone)]
struct ChannelKeyframeMatch {
    _component_key: String,
    component_index: usize,
    channel_is_scalar: bool,
    keyframe_id: String,
    keyframe_time: i64,
    keyframe_segment: Option<ScalarSegmentType>,
}

/// 收集通道内所有关键帧引用。
fn get_channel_keyframe_matches(data: Option<&ChannelData>) -> Vec<ChannelKeyframeMatch> {
    let entries = get_channel_entries_from_data(data);
    let mut matches = Vec::new();
    for (component_index, (component_key, channel)) in entries.iter().enumerate() {
        let scalar = is_scalar(channel);
        match channel {
            AnimationChannel::Scalar(scalar_channel) => {
                for key in &scalar_channel.keys {
                    matches.push(ChannelKeyframeMatch {
                        _component_key: component_key.clone(),
                        component_index,
                        channel_is_scalar: scalar,
                        keyframe_id: key.id.clone(),
                        keyframe_time: key.time,
                        keyframe_segment: key.segment_to_next,
                    });
                }
            }
            AnimationChannel::Discrete(discrete_channel) => {
                for key in &discrete_channel.keys {
                    matches.push(ChannelKeyframeMatch {
                        _component_key: component_key.clone(),
                        component_index,
                        channel_is_scalar: scalar,
                        keyframe_id: key.id.clone(),
                        keyframe_time: key.time,
                        keyframe_segment: None,
                    });
                }
            }
        }
    }
    matches
}

/// 同一时刻只保留一条关键帧；若后来出现 `value` 分量（index 0）则优先。
fn get_unique_matches(matches: Vec<ChannelKeyframeMatch>) -> Vec<ChannelKeyframeMatch> {
    let mut sorted = matches;
    sorted.sort_by_key(|item| (item.keyframe_time, item.component_index));
    let mut unique: Vec<ChannelKeyframeMatch> = Vec::new();
    for item in sorted {
        let replace = unique
            .last()
            .map(|previous| {
                previous.keyframe_time == item.keyframe_time
                    && previous.component_index != 0
                    && item.component_index == 0
            })
            .unwrap_or(false);
        if replace {
            *unique.last_mut().expect("上一条存在") = item;
        } else if unique
            .last()
            .map(|previous| previous.keyframe_time != item.keyframe_time)
            .unwrap_or(true)
        {
            unique.push(item);
        }
    }
    unique
}

/// 优先取 `value` 分量的匹配，否则取第一条。
fn get_preferred_match(matches: &[ChannelKeyframeMatch]) -> Option<ChannelKeyframeMatch> {
    matches
        .iter()
        .find(|item| item.component_index == 0)
        .or_else(|| matches.first())
        .cloned()
}

/// 关键帧插值类型：仅标量段携带 segmentToNext，其余为 hold。
fn keyframe_interpolation(item: &ChannelKeyframeMatch) -> AnimationInterpolation {
    if item.channel_is_scalar {
        match item.keyframe_segment {
            Some(segment) => get_scalar_segment_interpolation(segment),
            None => AnimationInterpolation::Hold,
        }
    } else {
        AnimationInterpolation::Hold
    }
}

/// 把关键帧引用转成对外结果；复合数据无法求值则丢弃。
fn to_element_keyframe(
    data: Option<&ChannelData>,
    property_path: &str,
    item: &ChannelKeyframeMatch,
) -> Option<ElementKeyframe> {
    let value = get_composed_value_at_time(data, item.keyframe_time)?;
    Some(ElementKeyframe {
        property_path: property_path.to_owned(),
        id: item.keyframe_id.clone(),
        time: item.keyframe_time,
        value,
        interpolation: keyframe_interpolation(item),
    })
}

/// 列出元素全部关键帧（按路径字典序，路径内按时间排序）。
pub fn get_element_keyframes(animations: &ElementAnimations) -> Vec<ElementKeyframe> {
    let mut result = Vec::new();
    for (property_path, data) in animations {
        if !is_animation_storage_key(property_path) || data.is_none() {
            continue;
        }
        if !is_animation_path(property_path) {
            continue;
        }
        let matches = get_unique_matches(get_channel_keyframe_matches(data.as_ref()));
        for item in &matches {
            if let Some(keyframe) = to_element_keyframe(data.as_ref(), property_path, item) {
                result.push(keyframe);
            }
        }
    }
    result
}

/// 指定路径是否存在至少一个关键帧。
pub fn has_keyframes_for_path(animations: &ElementAnimations, property_path: &str) -> bool {
    let data = animations.get(property_path).and_then(|item| item.as_ref());
    get_channel_entries_from_data(data)
        .iter()
        .any(|(_, channel)| key_count(channel) > 0)
}

/// 取指定时刻的关键帧。
pub fn get_keyframe_at_time(
    animations: &ElementAnimations,
    property_path: &str,
    time: i64,
) -> Option<ElementKeyframe> {
    let data: &ChannelData = animations.get(property_path)?.as_ref()?;
    let matches: Vec<ChannelKeyframeMatch> = get_channel_keyframe_matches(Some(data))
        .into_iter()
        .filter(|item| item.keyframe_time == time)
        .collect();
    let preferred = get_preferred_match(&matches)?;
    to_element_keyframe(Some(data), property_path, &preferred)
}

/// 按 id 取关键帧。
pub fn get_keyframe_by_id(
    animations: &ElementAnimations,
    property_path: &str,
    keyframe_id: &str,
) -> Option<ElementKeyframe> {
    let data: &ChannelData = animations.get(property_path)?.as_ref()?;
    let matches: Vec<ChannelKeyframeMatch> = get_channel_keyframe_matches(Some(data))
        .into_iter()
        .filter(|item| item.keyframe_id == keyframe_id)
        .collect();
    let preferred = get_preferred_match(&matches)?;
    to_element_keyframe(Some(data), property_path, &preferred)
}
