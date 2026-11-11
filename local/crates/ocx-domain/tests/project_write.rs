//! W-05 第五批：经典版项目 JSON 无损写回回归。
//!
//! 用真实 v31 fixture 验证「读 → 改 → 写 → 再读」闭环、未知字段保留、
//! 幂等性、版本/实体异常分支。

use ocx_domain::{CompatError, read_classic_project, write_classic_project};
use serde_json::Value;

const FIXTURE: &str = include_str!("../../../../apps/web/public/fixtures/classic-project-v31.json");

#[test]
fn read_modify_write_read_preserves_decisions() {
    let mut view = read_classic_project(FIXTURE).unwrap();
    assert_eq!(view.scenes.len(), 1);
    view.name = "已编辑项目".to_owned();
    view.duration_ticks = 300000;
    view.canvas.width = 1280;
    view.canvas.height = 720;
    view.current_scene_id = "scene-1".to_owned();
    let main = view.scenes[0]
        .tracks
        .iter_mut()
        .find(|track| track.id == "main")
        .unwrap();
    let body = main
        .elements
        .iter_mut()
        .find(|element| element.id == "clip-body")
        .unwrap();
    body.start_time = 100000;
    body.duration = 200000;
    body.trim_start = 140000;

    let written = write_classic_project(FIXTURE, &view).unwrap();
    let reread = read_classic_project(&written).unwrap();
    assert_eq!(reread.name, "已编辑项目");
    assert_eq!(reread.duration_ticks, 300000);
    assert_eq!((reread.canvas.width, reread.canvas.height), (1280, 720));
    assert_eq!(reread.version, 31);
    assert_eq!(reread.scene_count, 1);
    let main2 = reread.scenes[0]
        .tracks
        .iter()
        .find(|track| track.id == "main")
        .unwrap();
    let body2 = main2
        .elements
        .iter()
        .find(|element| element.id == "clip-body")
        .unwrap();
    assert_eq!(
        (body2.start_time, body2.duration, body2.trim_start),
        (100000, 200000, 140000)
    );
}

#[test]
fn unknown_fields_survive_writeback() {
    let view = read_classic_project(FIXTURE).unwrap();
    let written = write_classic_project(FIXTURE, &view).unwrap();
    let raw: Value = serde_json::from_str(&written).unwrap();
    assert_eq!(raw["metadata"]["createdAt"], "2026-01-01T00:00:00.000Z");
    assert_eq!(raw["metadata"]["updatedAt"], "2026-01-02T00:00:00.000Z");
    assert!(!raw["timelineViewState"].is_null());
    let main = &raw["scenes"][0]["tracks"]["main"];
    assert_eq!(main["name"], "Main Track");
    assert_eq!(main["muted"], false);
    assert_eq!(main["elements"][0]["mediaId"], "media-intro");
    assert!(main["elements"][0]["params"].is_object());
    assert_eq!(raw["scenes"][0]["tracks"]["overlay"][0]["name"], "Titles");
    assert!(
        raw.get("warnings").is_none(),
        "warnings 是派生字段，不得写回"
    );
    assert!(raw.get("sceneCount").is_none(), "sceneCount 是派生字段");
    assert_eq!(raw["version"], 31, "version 保持原始值");
}

#[test]
fn writeback_is_idempotent() {
    let view = read_classic_project(FIXTURE).unwrap();
    let once = write_classic_project(FIXTURE, &view).unwrap();
    let view2 = read_classic_project(&once).unwrap();
    let twice = write_classic_project(&once, &view2).unwrap();
    assert_eq!(once, twice);
}

#[test]
fn trim_fields_are_written_even_when_originally_missing() {
    let minimal = r#"{
      "version": 31,
      "metadata": {"id": "p", "name": "n", "duration": 120000},
      "scenes": [{"id": "s", "name": "S", "isMain": true,
        "tracks": {"main": {"id": "main", "type": "video",
          "elements": [{"id": "e", "type": "video", "startTime": 0, "duration": 120000}]}}}],
      "currentSceneId": "s",
      "settings": {"fps": {"numerator": 30, "denominator": 1},
                   "canvasSize": {"width": 1920, "height": 1080}}
    }"#;
    let mut view = read_classic_project(minimal).unwrap();
    view.scenes[0].tracks[0].elements[0].trim_start = 5000;
    view.scenes[0].tracks[0].elements[0].trim_end = 115000;
    let written = write_classic_project(minimal, &view).unwrap();
    let raw: Value = serde_json::from_str(&written).unwrap();
    let element = &raw["scenes"][0]["tracks"]["main"]["elements"][0];
    assert_eq!(element["trimStart"], 5000);
    assert_eq!(element["trimEnd"], 115000);
    assert_eq!(
        read_classic_project(&written).unwrap().scenes[0].tracks[0].elements[0].trim_start,
        5000
    );
}

#[test]
fn version_mismatch_is_rejected() {
    let mut view = read_classic_project(FIXTURE).unwrap();
    view.version = 32;
    assert_eq!(
        write_classic_project(FIXTURE, &view).unwrap_err(),
        CompatError::VersionMismatch
    );
    assert_eq!(CompatError::VersionMismatch.code(), "VERSION_MISMATCH");
}

#[test]
fn unknown_entities_are_rejected_instead_of_created() {
    let mut view = read_classic_project(FIXTURE).unwrap();
    view.scenes[0].id = "unknown-scene".to_owned();
    assert_eq!(
        write_classic_project(FIXTURE, &view).unwrap_err(),
        CompatError::EntityNotFound
    );

    let mut view = read_classic_project(FIXTURE).unwrap();
    view.scenes[0].tracks[0].id = "unknown-track".to_owned();
    assert_eq!(
        write_classic_project(FIXTURE, &view).unwrap_err(),
        CompatError::EntityNotFound
    );

    let mut view = read_classic_project(FIXTURE).unwrap();
    let main = view.scenes[0]
        .tracks
        .iter_mut()
        .find(|track| track.id == "main")
        .unwrap();
    main.elements[0].id = "unknown-element".to_owned();
    assert_eq!(
        write_classic_project(FIXTURE, &view).unwrap_err(),
        CompatError::EntityNotFound
    );
    assert_eq!(CompatError::EntityNotFound.code(), "ENTITY_NOT_FOUND");
}

#[test]
fn malformed_original_is_rejected_before_merge() {
    let view = read_classic_project(FIXTURE).unwrap();
    assert_eq!(
        write_classic_project("{ 非法", &view).unwrap_err(),
        CompatError::InvalidJson
    );
    assert_eq!(
        write_classic_project(r#"{"metadata":{},"scenes":[]}"#, &view).unwrap_err(),
        CompatError::MissingVersion
    );
    assert_eq!(
        write_classic_project(r#"{"version":99,"metadata":{},"scenes":[]}"#, &view).unwrap_err(),
        CompatError::UnsupportedVersion
    );
    assert_eq!(
        write_classic_project(r#"{"version":31,"scenes":[]}"#, &view).unwrap_err(),
        CompatError::MissingMetadata
    );
    assert_eq!(
        write_classic_project(r#"{"version":31,"metadata":{}}"#, &view).unwrap_err(),
        CompatError::MissingScenes
    );
}
