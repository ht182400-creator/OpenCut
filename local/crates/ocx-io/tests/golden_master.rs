//! W-10 golden master：15 个 JSON 用例覆盖正常导入、往返不变量与异常分支。
//! 用例与说明一一对应，见 `tests/OTIO_CASES.md`。

use ocx_io::{TICKS_PER_SECOND, decision_key, export_otio, import_otio};
use serde_json::Value;

/** 载入数据驱动的用例集。 */
fn suite() -> Value {
    serde_json::from_str(include_str!("fixtures/otio_cases.json"))
        .expect("golden 用例文件应为合法 JSON")
}

/** 校验一个片段摘要与期望一致。 */
fn assert_clip(id: &str, label: &str, actual: &ocx_io::EditClip, expected: &Value) {
    assert_eq!(
        actual.name,
        expected["name"].as_str().unwrap(),
        "{id} {label} name"
    );
    assert_eq!(
        actual.start_ticks,
        expected["startTicks"].as_i64().unwrap(),
        "{id} {label} startTicks"
    );
    assert_eq!(
        actual.duration_ticks,
        expected["durationTicks"].as_i64().unwrap(),
        "{id} {label} durationTicks"
    );
    assert_eq!(
        actual.source_start_ticks,
        expected["sourceStartTicks"].as_i64().unwrap(),
        "{id} {label} sourceStartTicks"
    );
    assert_eq!(
        actual.is_gap,
        expected["isGap"].as_bool().unwrap(),
        "{id} {label} isGap"
    );
    assert_eq!(
        actual.media_url.as_deref().unwrap_or(""),
        expected["mediaUrl"].as_str().unwrap(),
        "{id} {label} mediaUrl"
    );
    // W-10 第四批：转场字段按需断言（普通片段用例不含这些键）
    if let Some(is_transition) = expected["isTransition"].as_bool() {
        assert_eq!(
            actual.is_transition, is_transition,
            "{id} {label} isTransition"
        );
    }
    if let Some(in_offset) = expected["inOffsetTicks"].as_i64() {
        assert_eq!(
            actual.in_offset_ticks, in_offset,
            "{id} {label} inOffsetTicks"
        );
    }
    if let Some(out_offset) = expected["outOffsetTicks"].as_i64() {
        assert_eq!(
            actual.out_offset_ticks, out_offset,
            "{id} {label} outOffsetTicks"
        );
    }
    if let Some(transition_type) = expected["transitionType"].as_str() {
        assert_eq!(
            actual.transition_type.as_deref().unwrap_or(""),
            transition_type,
            "{id} {label} transitionType"
        );
    }
}

/// 全部用例：导入结果逐字段比对，并对每个成功用例验证导出→再导入的剪辑决策不变量。
#[test]
fn golden_cases_match() {
    let suite = suite();
    assert_eq!(suite["ticksPerSecond"].as_i64(), Some(TICKS_PER_SECOND));
    let cases = suite["cases"].as_array().expect("cases 应为数组");
    let mut checked = 0;

    for case in cases {
        let id = case["id"].as_str().expect("用例需要 id");
        let input = case["rawInput"]
            .as_str()
            .map(str::to_string)
            .unwrap_or_else(|| serde_json::to_string(&case["input"]).unwrap());
        let expected = &case["expected"];
        let result = import_otio(&input);

        if expected["ok"].as_bool() == Some(false) {
            let code = expected["error"].as_str().unwrap();
            let error = result.expect_err(&format!("{id} 应当失败"));
            assert_eq!(error.code(), code, "{id} 错误码");
        } else {
            let timeline = result.unwrap_or_else(|error| panic!("{id} 导入失败：{error}"));
            assert_eq!(
                timeline.name,
                expected["name"].as_str().unwrap(),
                "{id} name"
            );
            assert_eq!(
                timeline.schema_version,
                expected["schemaVersion"].as_u64().unwrap() as u32,
                "{id} schemaVersion"
            );
            let rate = expected["rate"].as_f64().unwrap();
            assert!((timeline.rate - rate).abs() < 1e-9, "{id} rate");
            assert_eq!(
                timeline.tracks.len(),
                expected["trackCount"].as_u64().unwrap() as usize,
                "{id} trackCount"
            );
            assert_eq!(
                timeline.tracks[0].clips.len(),
                expected["clipCount"].as_u64().unwrap() as usize,
                "{id} clipCount"
            );
            assert_eq!(
                timeline.warnings.len(),
                expected["warnings"].as_u64().unwrap() as usize,
                "{id} warnings 数"
            );
            for (label, index) in [("firstClip", 0), ("secondClip", 1)] {
                if let Some(clip_expected) = expected.get(label) {
                    assert_clip(id, label, &timeline.tracks[0].clips[index], clip_expected);
                }
            }

            // W-10 第五批：effects 与嵌套 Stack 逐项比对
            if let Some(count) = expected["effectsCount"].as_u64() {
                assert_eq!(
                    timeline.tracks[0].clips[0].effects.len(),
                    count as usize,
                    "{id} effectsCount"
                );
            }
            if let Some(count) = expected["nestedStackCount"].as_u64() {
                assert_eq!(
                    timeline.nested_stacks.len(),
                    count as usize,
                    "{id} nestedStackCount"
                );
            }
            if let Some(index) = expected["nestedIndex"].as_u64() {
                assert_eq!(
                    timeline.nested_stacks[0].index, index as usize,
                    "{id} nestedIndex"
                );
            }

            // W-10 第四批：Timeline 级标记逐项比对
            if let Some(marker_expected) = expected.get("markers") {
                let list = marker_expected.as_array().expect("markers 应为数组");
                assert_eq!(timeline.markers.len(), list.len(), "{id} markerCount");
                for (index, item) in list.iter().enumerate() {
                    let marker = &timeline.markers[index];
                    assert_eq!(
                        marker.name,
                        item["name"].as_str().unwrap(),
                        "{id} marker {index} name"
                    );
                    assert_eq!(
                        marker.start_ticks,
                        item["startTicks"].as_i64().unwrap(),
                        "{id} marker {index} startTicks"
                    );
                    assert_eq!(
                        marker.duration_ticks,
                        item["durationTicks"].as_i64().unwrap(),
                        "{id} marker {index} durationTicks"
                    );
                    assert_eq!(
                        marker.color.as_deref().unwrap_or(""),
                        item["color"].as_str().unwrap_or(""),
                        "{id} marker {index} color"
                    );
                }
            }

            // 往返不变量：导出后再导入，剪辑决策指纹完全一致
            let exported = export_otio(&timeline).unwrap_or_else(|e| panic!("{id} 导出失败：{e}"));
            let reimported =
                import_otio(&exported).unwrap_or_else(|e| panic!("{id} 回读失败：{e}"));
            assert_eq!(
                decision_key(&timeline),
                decision_key(&reimported),
                "{id} 往返剪辑决策"
            );
            let root: Value = serde_json::from_str(&exported).expect("导出应为合法 JSON");
            assert_eq!(
                root["OTIO_SCHEMA"].as_str(),
                Some("Timeline.1"),
                "{id} 导出类型"
            );
            assert_eq!(
                root["metadata"]["opencut"]["schemaVersion"].as_u64(),
                Some(u64::from(timeline.schema_version)),
                "{id} 导出版本"
            );
        }
        checked += 1;
    }
    assert_eq!(checked, cases.len(), "所有用例都应被检查");
}
