//! OTIO 交换格式的版本化 schema 与稳定错误码（W-10 第一批）。
//!
//! 遵循 additive-only：未知字段忽略但**不写回**；缺失的非关键字段补默认值并记 warning；
//! 声明的 `metadata.opencut.schemaVersion` 高于当前版本时**明确拒绝**，避免误读未来格式。

use std::fmt;

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// 本实现产出的 opencut schema 版本。
pub const IO_SCHEMA_VERSION: u32 = 1;
/// 导出时写入 metadata 的生成器标识。
pub const OTIO_GENERATOR: &str = "ocx-io";
/// 当前可识别的 OTIO 类型名（OTIO 0.19 JSON schema 的核心子集）。
pub const SUPPORTED_OTIO_SCHEMAS: &[&str] = &[
    "Timeline.1",
    "Stack.1",
    "Track.1",
    "Clip.1",
    // 官方 OpenTimelineIO 0.18 起 Clip 升级到 .2（media_references 改为字典）
    "Clip.2",
    "Gap.1",
    "TimeRange.1",
    "RationalTime.1",
    "ExternalReference.1",
];
pub const TIMELINE_SCHEMA: &str = "Timeline.1";
pub const STACK_SCHEMA: &str = "Stack.1";
pub const TRACK_SCHEMA: &str = "Track.1";
pub const CLIP_SCHEMA: &str = "Clip.1";
pub const GAP_SCHEMA: &str = "Gap.1";
pub const TIME_RANGE_SCHEMA: &str = "TimeRange.1";
pub const RATIONAL_TIME_SCHEMA: &str = "RationalTime.1";
pub const EXTERNAL_REFERENCE_SCHEMA: &str = "ExternalReference.1";

/// 稳定错误码（跨语言契约的一部分）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum IoError {
    InvalidJson,
    MissingTimeline,
    UnsupportedOtioSchema,
    UnsupportedIoVersion,
    MissingTracks,
    InvalidTimeRange,
    InvalidExport,
}

impl IoError {
    /// 稳定错误码字符串。
    pub fn code(self) -> &'static str {
        match self {
            IoError::InvalidJson => "INVALID_JSON",
            IoError::MissingTimeline => "MISSING_TIMELINE",
            IoError::UnsupportedOtioSchema => "UNSUPPORTED_OTIO_SCHEMA",
            IoError::UnsupportedIoVersion => "UNSUPPORTED_IO_VERSION",
            IoError::MissingTracks => "MISSING_TRACKS",
            IoError::InvalidTimeRange => "INVALID_TIME_RANGE",
            IoError::InvalidExport => "INVALID_EXPORT",
        }
    }
}

impl fmt::Display for IoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        let detail = match self {
            IoError::InvalidJson => "OTIO 文件不是合法 JSON，请检查文件是否完整",
            IoError::MissingTimeline => "OTIO 顶层缺少 Timeline 节点",
            IoError::UnsupportedOtioSchema => "遇到当前子集不支持的 OTIO 类型",
            IoError::UnsupportedIoVersion => {
                "opencut schemaVersion 高于当前支持版本，请升级后再打开"
            }
            IoError::MissingTracks => "Timeline 缺少 tracks（Stack）或 children 数组",
            IoError::InvalidTimeRange => "source_range 的 RationalTime 缺少合法 value/rate",
            IoError::InvalidExport => "导出的时间轴不合法（无轨道或帧率无效）",
        };
        write!(formatter, "{}：{detail}", self.code())
    }
}

/// 判断 OTIO 类型名是否在本实现支持的子集内。
pub fn is_supported_otio_schema(schema: &str) -> bool {
    SUPPORTED_OTIO_SCHEMAS.contains(&schema)
}

/**
 * 读取 `metadata.opencut.schemaVersion`。
 * 缺省视为 v1（兼容第三方未声明的 OTIO 文件），高于当前版本明确拒绝。
 * @param root OTIO 根 Value
 * @returns {Result<(u32, bool), IoError>} (版本, 是否显式声明)
 */
pub fn read_schema_version(root: &Value) -> Result<(u32, bool), IoError> {
    let declared = root["metadata"]["opencut"]["schemaVersion"].as_u64();
    match declared {
        None => Ok((IO_SCHEMA_VERSION, false)),
        Some(version) if version <= u64::from(IO_SCHEMA_VERSION) => Ok((version as u32, true)),
        Some(_) => Err(IoError::UnsupportedIoVersion),
    }
}
