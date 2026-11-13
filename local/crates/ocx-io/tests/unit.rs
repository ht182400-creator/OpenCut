//! W-10 补充单测：时间换算、往返精度、决策指纹、异常分支与并发确定性。

use std::thread;

use ocx_io::{
    EditClip, EditTimeline, EditTrack, IO_SCHEMA_VERSION, IoError, decision_key, export_otio,
    import_otio, is_supported_otio_schema, rational_to_ticks, read_schema_version,
    ticks_to_rational_value,
};
use serde_json::{Value, json};

/** 构造一个新建片段（无原始 RationalTime）。 */
fn new_clip(name: &str, duration_ticks: i64, source_start_ticks: i64, is_gap: bool) -> EditClip {
    EditClip {
        id: name.to_string(),
        name: name.to_string(),
        is_gap,
        start_ticks: 0,
        duration_ticks,
        source_start_ticks,
        media_url: if is_gap {
            None
        } else {
            Some("x.mp4".to_string())
        },
        source_value: None,
        duration_value: None,
        source_rate: None,
        is_transition: false,
        in_offset_ticks: 0,
        out_offset_ticks: 0,
        transition_type: None,
        effects: vec![],
        markers: vec![],
    }
}

/** 构造一条最小时间轴。 */
fn timeline(clips: Vec<EditClip>, rate: f64) -> EditTimeline {
    EditTimeline {
        name: "unit".to_string(),
        schema_version: IO_SCHEMA_VERSION,
        rate,
        tracks: vec![EditTrack {
            id: "V1".to_string(),
            name: "V1".to_string(),
            kind: "Video".to_string(),
            clips,
            markers: vec![],
        }],
        markers: vec![],
        nested_stacks: vec![],
        warnings: vec![],
    }
}

#[test]
fn rational_time_conversion_is_exact_for_common_rates() {
    for rate in [24.0, 25.0, 30.0, 48.0, 60.0] {
        let per_frame = rational_to_ticks(1, rate).unwrap();
        assert_eq!(rational_to_ticks(rate as i64, rate).unwrap(), 120000);
        assert_eq!(ticks_to_rational_value(per_frame, rate).unwrap(), 1);
        assert_eq!(ticks_to_rational_value(120000, rate).unwrap(), rate as i64);
    }
    assert_eq!(rational_to_ticks(30, 29.97002997002997).unwrap(), 120120);
}

#[test]
fn invalid_rates_are_rejected() {
    assert_eq!(
        rational_to_ticks(1, 0.0).unwrap_err().code(),
        "INVALID_TIME_RANGE"
    );
    assert_eq!(
        rational_to_ticks(1, f64::NAN).unwrap_err().code(),
        "INVALID_TIME_RANGE"
    );
    assert_eq!(
        ticks_to_rational_value(120000, -30.0).unwrap_err().code(),
        "INVALID_TIME_RANGE"
    );
}

#[test]
fn new_clips_export_uses_ticks_conversion() {
    let exported = export_otio(&timeline(vec![new_clip("a", 120000, 0, false)], 30.0)).unwrap();
    let root: Value = serde_json::from_str(&exported).unwrap();
    let clip = &root["tracks"]["children"][0]["children"][0];
    assert_eq!(clip["OTIO_SCHEMA"].as_str(), Some("Clip.1"));
    assert_eq!(clip["source_range"]["duration"]["value"].as_i64(), Some(30));
    assert_eq!(
        clip["source_range"]["start_time"]["value"].as_i64(),
        Some(0)
    );
    assert_eq!(
        clip["media_reference"]["target_url"].as_str(),
        Some("x.mp4")
    );
}

#[test]
fn gap_export_has_no_media_reference() {
    let exported = export_otio(&timeline(vec![new_clip("gap", 40000, 0, true)], 30.0)).unwrap();
    let root: Value = serde_json::from_str(&exported).unwrap();
    let gap = &root["tracks"]["children"][0]["children"][0];
    assert_eq!(gap["OTIO_SCHEMA"].as_str(), Some("Gap.1"));
    assert!(gap.get("media_reference").is_none());
    assert_eq!(gap["source_range"]["duration"]["value"].as_i64(), Some(10));
}

#[test]
fn ntsc_round_trip_preserves_original_rational_time() {
    let original = json!({
        "OTIO_SCHEMA": "Timeline.1", "name": "ntsc",
        "metadata": { "opencut": { "schemaVersion": 1 } },
        "tracks": { "OTIO_SCHEMA": "Stack.1", "children": [
            { "OTIO_SCHEMA": "Track.1", "name": "V1", "kind": "Video", "children": [
                { "OTIO_SCHEMA": "Clip.1", "name": "c",
                  "source_range": { "OTIO_SCHEMA": "TimeRange.1",
                    "start_time": { "OTIO_SCHEMA": "RationalTime.1", "value": 0, "rate": 29.97002997002997 },
                    "duration": { "OTIO_SCHEMA": "RationalTime.1", "value": 30, "rate": 29.97002997002997 } } } ] } ] }
    });
    let text = serde_json::to_string(&original).unwrap();
    let imported = import_otio(&text).unwrap();
    let exported = export_otio(&imported).unwrap();
    let root: Value = serde_json::from_str(&exported).unwrap();
    let duration = &root["tracks"]["children"][0]["children"][0]["source_range"]["duration"];
    assert_eq!(duration["value"].as_i64(), Some(30));
    assert_eq!(duration["rate"].as_f64(), Some(29.97002997002997));
    assert_eq!(
        decision_key(&imported),
        decision_key(&import_otio(&exported).unwrap())
    );
}

#[test]
fn decision_key_is_sensitive_to_edits_but_not_warnings() {
    let base = timeline(vec![new_clip("a", 120000, 0, false)], 30.0);
    let mut longer = base.clone();
    longer.tracks[0].clips[0].duration_ticks = 240000;
    assert_ne!(decision_key(&base), decision_key(&longer));

    let mut warned = base.clone();
    warned.warnings.push("仅元数据".to_string());
    assert_eq!(decision_key(&base), decision_key(&warned));
}

#[test]
fn export_rejects_invalid_timelines() {
    let empty = EditTimeline {
        tracks: vec![],
        ..timeline(vec![], 30.0)
    };
    assert_eq!(export_otio(&empty).unwrap_err().code(), "INVALID_EXPORT");
    let bad_rate = timeline(vec![new_clip("a", 120000, 0, false)], 0.0);
    assert_eq!(export_otio(&bad_rate).unwrap_err().code(), "INVALID_EXPORT");
}

#[test]
fn schema_version_and_type_whitelist() {
    assert!(is_supported_otio_schema("Timeline.1"));
    // W-10 第四、五批：Transition / Marker / Effect 系列进入白名单；未知类型仍拒绝
    assert!(is_supported_otio_schema("Transition.1"));
    assert!(is_supported_otio_schema("Marker.2"));
    assert!(is_supported_otio_schema("Effect.1"));
    assert!(is_supported_otio_schema("LinearTimeWarp.1"));
    assert!(!is_supported_otio_schema("FakeType.1"));
    let root = json!({ "metadata": { "opencut": { "schemaVersion": 1 } } });
    assert_eq!(read_schema_version(&root).unwrap(), (1, true));
    assert_eq!(read_schema_version(&json!({})).unwrap(), (1, false));
    let future = json!({ "metadata": { "opencut": { "schemaVersion": 2 } } });
    assert_eq!(
        read_schema_version(&future).unwrap_err(),
        IoError::UnsupportedIoVersion
    );
}

#[test]
fn error_codes_are_stable() {
    let codes = [
        IoError::InvalidJson,
        IoError::MissingTimeline,
        IoError::UnsupportedOtioSchema,
        IoError::UnsupportedIoVersion,
        IoError::MissingTracks,
        IoError::InvalidTimeRange,
        IoError::InvalidExport,
    ]
    .map(|error| error.code());
    assert_eq!(codes.len(), 7);
    assert_eq!(codes.iter().filter(|c| **c == "INVALID_JSON").count(), 1);
    assert!(
        codes
            .iter()
            .all(|code| code.chars().all(|c| c.is_ascii_uppercase() || c == '_'))
    );
}

#[test]
fn concurrent_import_export_is_deterministic() {
    let text = serde_json::to_string(&json!({
        "OTIO_SCHEMA": "Timeline.1", "name": "concurrent",
        "metadata": { "opencut": { "schemaVersion": 1 } },
        "tracks": { "OTIO_SCHEMA": "Stack.1", "children": [
            { "OTIO_SCHEMA": "Track.1", "name": "V1", "kind": "Video", "children": [
                { "OTIO_SCHEMA": "Clip.1", "name": "c",
                  "source_range": { "OTIO_SCHEMA": "TimeRange.1",
                    "start_time": { "OTIO_SCHEMA": "RationalTime.1", "value": 0, "rate": 30 },
                    "duration": { "OTIO_SCHEMA": "RationalTime.1", "value": 30, "rate": 30 } } } ] } ] }
    }))
    .unwrap();
    let expected = decision_key(&import_otio(&text).unwrap());
    let mut handles = Vec::new();
    for _ in 0..8 {
        let copy = text.clone();
        let key = expected.clone();
        handles.push(thread::spawn(move || {
            let imported = import_otio(&copy).unwrap();
            assert_eq!(decision_key(&imported), key);
            let exported = export_otio(&imported).unwrap();
            assert_eq!(decision_key(&import_otio(&exported).unwrap()), key);
        }));
    }
    for handle in handles {
        handle.join().expect("线程不应 panic");
    }
}

/** 官方 OTIO 0.18 的 Clip.2 + media_references 字典，按 active key 选引用。 */
#[test]
fn official_clip2_media_reference_dict() {
    let text = serde_json::to_string(&json!({
        "OTIO_SCHEMA": "Timeline.1", "name": "official",
        "metadata": {"opencut": {"schemaVersion": 1}},
        "tracks": {"OTIO_SCHEMA": "Stack.1", "children": [
            {"OTIO_SCHEMA": "Track.1", "name": "V1", "kind": "Video", "children": [
                {"OTIO_SCHEMA": "Clip.2", "name": "intro",
                 "source_range": {"OTIO_SCHEMA": "TimeRange.1",
                   "start_time": {"OTIO_SCHEMA": "RationalTime.1", "value": 0, "rate": 30},
                   "duration": {"OTIO_SCHEMA": "RationalTime.1", "value": 30, "rate": 30}},
                 "media_references": {
                   "proxy": {"OTIO_SCHEMA": "ExternalReference.1", "target_url": "proxy.mp4"},
                   "DEFAULT_MEDIA": {"OTIO_SCHEMA": "ExternalReference.1", "target_url": "online.mp4"}
                 },
                 "active_media_reference_key": "DEFAULT_MEDIA"}
            ]}
        ]}
    }))
    .unwrap();
    let timeline = import_otio(&text).unwrap();
    assert_eq!(
        timeline.tracks[0].clips[0].media_url.as_deref(),
        Some("online.mp4")
    );
}

/** 字典缺少 active key 时回退到首个可用引用。 */
#[test]
fn official_clip2_dict_without_active_key_falls_back() {
    let text = serde_json::to_string(&json!({
        "OTIO_SCHEMA": "Timeline.1", "name": "official",
        "tracks": {"OTIO_SCHEMA": "Stack.1", "children": [
            {"OTIO_SCHEMA": "Track.1", "name": "V1", "kind": "Video", "children": [
                {"OTIO_SCHEMA": "Clip.2", "name": "c",
                 "source_range": {"OTIO_SCHEMA": "TimeRange.1",
                   "start_time": {"OTIO_SCHEMA": "RationalTime.1", "value": 0, "rate": 30},
                   "duration": {"OTIO_SCHEMA": "RationalTime.1", "value": 30, "rate": 30}},
                 "media_references": {
                   "alpha": {"OTIO_SCHEMA": "ExternalReference.1", "target_url": "alpha.mp4"},
                   "zeta": {"OTIO_SCHEMA": "ExternalReference.1", "target_url": "zeta.mp4"}
                 }}
            ]}
        ]}
    }))
    .unwrap();
    let timeline = import_otio(&text).unwrap();
    assert_eq!(
        timeline.tracks[0].clips[0].media_url.as_deref(),
        Some("alpha.mp4")
    );
}

/** 官方工具生成的完整文件：导入 → 导出 → 再导入，剪辑决策不丢失。 */
#[test]
fn official_otio_018_fixture_roundtrip_preserves_decisions() {
    let official = include_str!("fixtures/third_party_otio_018.json");
    let imported = import_otio(official).unwrap();
    assert_eq!(imported.name, "third-party-roundtrip");
    assert_eq!(imported.tracks[0].clips.len(), 3);
    assert_eq!(
        imported.tracks[0].clips[0].media_url.as_deref(),
        Some("file:///intro.mp4")
    );
    assert_eq!(imported.tracks[0].clips[1].source_start_ticks, 120000);
    assert!(imported.tracks[0].clips[2].is_gap);
    let exported = export_otio(&imported).unwrap();
    assert_eq!(
        decision_key(&imported),
        decision_key(&import_otio(&exported).unwrap())
    );
}

/** W-10 第五批：官方 effects + 嵌套 Stack 文件，导入→导出→再导入决策不丢。 */
#[test]
fn official_effects_and_nested_stack_roundtrip() {
    let official = include_str!("fixtures/third_party_otio_effects.json");
    let imported = import_otio(official).unwrap();
    assert_eq!(imported.name, "third-party-effects");
    assert_eq!(imported.tracks.len(), 1);
    assert_eq!(imported.tracks[0].clips[0].effects.len(), 1);
    assert_eq!(imported.nested_stacks.len(), 1);
    assert_eq!(imported.nested_stacks[0].index, 1);
    let exported = export_otio(&imported).unwrap();
    let root: serde_json::Value = serde_json::from_str(&exported).unwrap();
    assert_eq!(
        root["tracks"]["children"][1]["OTIO_SCHEMA"].as_str(),
        Some("Stack.1")
    );
    assert_eq!(
        root["tracks"]["children"][0]["children"][0]["effects"][0]["OTIO_SCHEMA"].as_str(),
        Some("LinearTimeWarp.1")
    );
    assert_eq!(
        decision_key(&imported),
        decision_key(&import_otio(&exported).unwrap())
    );
}

/** W-10 第五批：白名单外的 effect 明确拒绝，避免静默丢弃。 */
#[test]
fn unsupported_effect_schema_is_rejected() {
    let text = serde_json::to_string(&json!({
        "OTIO_SCHEMA": "Timeline.1", "name": "bad-effect",
        "tracks": {"OTIO_SCHEMA": "Stack.1", "children": [
            {"OTIO_SCHEMA": "Track.1", "name": "V1", "kind": "Video", "children": [
                {"OTIO_SCHEMA": "Clip.1", "name": "c",
                 "source_range": {"OTIO_SCHEMA": "TimeRange.1",
                   "start_time": {"OTIO_SCHEMA": "RationalTime.1", "value": 0, "rate": 30},
                   "duration": {"OTIO_SCHEMA": "RationalTime.1", "value": 30, "rate": 30}},
                 "effects": [{"OTIO_SCHEMA": "FakeEffect.1", "name": "fake"}]}
            ]}
        ]}
    }))
    .unwrap();
    assert_eq!(
        import_otio(&text).unwrap_err().code(),
        "UNSUPPORTED_OTIO_SCHEMA"
    );
}

/** W-10 第六批：官方 Track / Clip 级 Marker 文件，四层标记往返不丢。 */
#[test]
fn official_track_and_clip_markers_roundtrip() {
    let official = include_str!("fixtures/third_party_otio_nested_markers.json");
    let imported = import_otio(official).unwrap();
    assert_eq!(imported.name, "third-party-nested-markers");
    assert_eq!(imported.tracks[0].markers.len(), 1);
    assert_eq!(imported.tracks[0].markers[0].name, "track-mark");
    assert_eq!(imported.tracks[0].clips[0].markers.len(), 1);
    assert_eq!(imported.tracks[0].clips[0].markers[0].name, "clip-mark");
    let exported = export_otio(&imported).unwrap();
    let root: serde_json::Value = serde_json::from_str(&exported).unwrap();
    assert_eq!(
        root["tracks"]["children"][0]["markers"][0]["OTIO_SCHEMA"].as_str(),
        Some("Marker.2")
    );
    assert_eq!(
        root["tracks"]["children"][0]["children"][0]["markers"][0]["name"].as_str(),
        Some("clip-mark")
    );
    assert_eq!(
        decision_key(&imported),
        decision_key(&import_otio(&exported).unwrap())
    );
}
