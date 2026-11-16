//! 批 7.1：元素类型特化字段保真回归。
//!
//! 验证 read_classic_project → write_classic_project 往返完整保留
//! name / mediaId / params / content，并覆盖新增的 Caption 类型。

use ocx_domain::{ElementType, read_classic_project, write_classic_project};
use serde_json::{Value, json};

const FIXTURE: &str = include_str!("../../../../apps/web/public/fixtures/classic-project-v31.json");

/// 从项目 JSON 取指定 id 元素的原始对象（overlay/audio 为轨道数组，main 为单轨道对象）。
fn raw_element<'a>(root: &'a Value, id: &str) -> Option<&'a Value> {
    for scene in root["scenes"].as_array()? {
        let tracks = &scene["tracks"];
        // 先把三类轨归一为轨道对象迭代器，再从每条轨的 elements 找元素。
        let overlay = tracks["overlay"].as_array()?.iter();
        for track in overlay {
            if let Some(item) = track["elements"].as_array()?.iter().find(|e| e["id"] == id) {
                return Some(item);
            }
        }
        if let Some(item) = tracks["main"]["elements"]
            .as_array()?
            .iter()
            .find(|e| e["id"] == id)
        {
            return Some(item);
        }
        let audio = tracks["audio"].as_array()?.iter();
        for track in audio {
            if let Some(item) = track["elements"].as_array()?.iter().find(|e| e["id"] == id) {
                return Some(item);
            }
        }
    }
    None
}

#[test]
fn roundtrip_preserves_type_specific_fields() {
    let view = read_classic_project(FIXTURE).unwrap();
    let written = write_classic_project(FIXTURE, &view).unwrap();
    let original: Value = serde_json::from_str(FIXTURE).unwrap();
    let result: Value = serde_json::from_str(&written).unwrap();

    // 三类元素的类型特化字段在写回后逐字段与原始文档一致。
    for id in ["title-a", "clip-intro", "audio-bed"] {
        let before = raw_element(&original, id).unwrap();
        let after = raw_element(&result, id).unwrap();
        assert_eq!(after, before, "元素 {id} 的类型特化字段在往返中丢失");
    }
}

#[test]
fn view_exposes_type_specific_fields() {
    let view = read_classic_project(FIXTURE).unwrap();
    let all: Vec<_> = view.scenes[0]
        .tracks
        .iter()
        .flat_map(|track| track.elements.iter())
        .collect();

    let title = all.iter().find(|e| e.id == "title-a").unwrap();
    assert_eq!(title.name.as_deref(), Some("Opening title"));
    assert!(title.params.is_some());
    assert_eq!(title.media_id, None);

    let intro = all.iter().find(|e| e.id == "clip-intro").unwrap();
    assert_eq!(intro.media_id.as_deref(), Some("media-intro"));
    assert!(intro.params.is_some());
}

#[test]
fn caption_and_content_roundtrip() {
    // 构造带 caption 元素与 content 字段的 v31 文档（fixture 本身无 caption）。
    let mut doc: Value = serde_json::from_str(FIXTURE).unwrap();
    let caption = json!({
        "id": "sub-1",
        "type": "caption",
        "name": "Opening subtitles",
        "content": "Hello world",
        "startTime": 0,
        "duration": 60000,
        "trimStart": 0,
        "trimEnd": 60000,
        "params": { "fontSize": 24 }
    });
    // overlay 是轨道数组，caption 元素追加到第一条文字轨的 elements。
    doc["scenes"][0]["tracks"]["overlay"][0]["elements"]
        .as_array_mut()
        .unwrap()
        .push(caption.clone());

    let source = doc.to_string();
    let view = read_classic_project(&source).unwrap();
    let all: Vec<_> = view.scenes[0]
        .tracks
        .iter()
        .flat_map(|track| track.elements.iter())
        .collect();
    let sub = all.iter().find(|e| e.id == "sub-1").unwrap();
    assert_eq!(sub.element_type, "caption");
    assert_eq!(sub.content.as_deref(), Some("Hello world"));
    assert_eq!(sub.name.as_deref(), Some("Opening subtitles"));

    // 用户编辑 content 后写回，原字段保留、修改生效。
    let mut view = view;
    view.scenes[0]
        .tracks
        .iter_mut()
        .flat_map(|track| track.elements.iter_mut())
        .find(|e| e.id == "sub-1")
        .unwrap()
        .content = Some("Edited subtitle".to_owned());
    let written = write_classic_project(&source, &view).unwrap();
    let result: Value = serde_json::from_str(&written).unwrap();
    let after = raw_element(&result, "sub-1").unwrap();
    assert_eq!(after["content"], "Edited subtitle");
    assert_eq!(after["name"], "Opening subtitles");
    assert_eq!(after["params"]["fontSize"], 24);
}

#[test]
fn caption_type_maps_to_text_track() {
    assert_eq!(ElementType::Caption.as_str(), "caption");
    // 字幕与文字同属文字轨（placement 映射）。
    assert_eq!(
        ocx_domain::get_track_type_for_element_type(ElementType::Caption),
        ocx_domain::get_track_type_for_element_type(ElementType::Text),
    );
}

#[test]
fn absent_optional_fields_do_not_become_null() {
    // 构造一个只有最小字段的元素：写回后不应凭空出现 name/mediaId/content/params。
    let mut doc: Value = serde_json::from_str(FIXTURE).unwrap();
    doc["scenes"][0]["tracks"]["overlay"][0]["elements"][0]
        .as_object_mut()
        .unwrap()
        .retain(|key, _| !["name", "params"].contains(&key.as_str()));
    let source = doc.to_string();
    let view = read_classic_project(&source).unwrap();
    let written = write_classic_project(&source, &view).unwrap();
    let result: Value = serde_json::from_str(&written).unwrap();
    let title = raw_element(&result, "title-a").unwrap();
    assert!(title.get("name").is_none());
    assert!(title.get("params").is_none());
}
