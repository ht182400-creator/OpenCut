#!/usr/bin/env python3
"""W-10 第三批：与官方 OpenTimelineIO 的实文件往返验证。

依赖（可选）：``pip install opentimelineio``，或把 wheel 解压到某目录后用
``PYTHONPATH`` 指向它。未安装时 ``probe`` 返回 available=false，Node 测试会
如实标记跳过，不会让 CI 误判为通过。

用法::

    python third_party_roundtrip.py probe
    python third_party_roundtrip.py make <out.otio>
    python third_party_roundtrip.py validate <in.otio>

``make`` 用官方 API 生成含两个 Clip（Clip.2 + media_references 字典）与一个
Gap 的时间轴；``validate`` 用官方 adapter 读回并输出剪辑决策摘要。
"""

import json
import sys

SOURCE_CLIPS = [
    ("intro", 0, 30, "file:///intro.mp4"),
    ("body", 30, 60, "file:///body.mp4"),
]


def import_otio():
    """按需导入官方实现；缺失时返回 None。"""
    try:
        import opentimelineio as otio

        return otio
    except ImportError:
        return None


def make(otio, path):
    """生成官方 OTIO 文件。"""
    rational = otio.opentime.RationalTime
    time_range = otio.opentime.TimeRange
    timeline = otio.schema.Timeline(name="third-party-roundtrip")
    track = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
    timeline.tracks.append(track)
    for name, start, duration, url in SOURCE_CLIPS:
        clip = otio.schema.Clip(
            name=name,
            source_range=time_range(rational(start, 30), rational(duration, 30)),
        )
        reference = otio.schema.ExternalReference(target_url=url)
        clip.set_media_references({"DEFAULT_MEDIA": reference}, "DEFAULT_MEDIA")
        track.append(clip)
    track.append(
        otio.schema.Gap(source_range=time_range(rational(0, 30), rational(10, 30)))
    )
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(otio.adapters.write_to_string(timeline, "otio_json"))


def make_transitions(otio, path):
    """生成含 Transition 与 Timeline 级 Marker 的官方文件（W-10 第四批）。"""
    rational = otio.opentime.RationalTime
    time_range = otio.opentime.TimeRange
    timeline = otio.schema.Timeline(name="third-party-transitions")
    track = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
    timeline.tracks.append(track)
    for name, start, duration, url in SOURCE_CLIPS:
        clip = otio.schema.Clip(
            name=name,
            source_range=time_range(rational(start, 30), rational(duration, 30)),
        )
        reference = otio.schema.ExternalReference(target_url=url)
        clip.set_media_references({"DEFAULT_MEDIA": reference}, "DEFAULT_MEDIA")
        track.append(clip)
        if name == "intro":
            track.append(
                otio.schema.Transition(
                    name="dissolve",
                    transition_type="CrossDissolve",
                    in_offset=rational(12, 30),
                    out_offset=rational(18, 30),
                )
            )
    timeline.tracks.markers.append(
        otio.schema.Marker(
            name="chapter-1",
            color="GREEN",
            marked_range=time_range(rational(0, 30), rational(60, 30)),
        )
    )
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(otio.adapters.write_to_string(timeline, "otio_json"))


def make_effects(otio, path):
    """生成含 Clip effects 与嵌套 Stack 的官方文件（W-10 第五批）。"""
    rational = otio.opentime.RationalTime
    time_range = otio.opentime.TimeRange
    timeline = otio.schema.Timeline(name="third-party-effects")
    track = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
    timeline.tracks.append(track)
    for name, start, duration, url in SOURCE_CLIPS:
        clip = otio.schema.Clip(
            name=name,
            source_range=time_range(rational(start, 30), rational(duration, 30)),
        )
        reference = otio.schema.ExternalReference(target_url=url)
        clip.set_media_references({"DEFAULT_MEDIA": reference}, "DEFAULT_MEDIA")
        track.append(clip)
    # 第一个片段挂一个官方变速效果
    track[0].effects.append(otio.schema.LinearTimeWarp(name="speed", time_scalar=2.0))
    # Stack children 里放一个嵌套 Stack（内部一条轨道）
    nested = otio.schema.Stack(name="nested")
    inner = otio.schema.Track(name="inner-V", kind=otio.schema.TrackKind.Video)
    inner.append(
        otio.schema.Clip(
            name="inner-clip",
            source_range=time_range(rational(0, 30), rational(15, 30)),
        )
    )
    nested.append(inner)
    timeline.tracks.append(nested)
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(otio.adapters.write_to_string(timeline, "otio_json"))


def make_nested_markers(otio, path):
    """生成含 Track / Clip 级 Marker 的官方文件（W-10 第六批）。"""
    rational = otio.opentime.RationalTime
    time_range = otio.opentime.TimeRange
    timeline = otio.schema.Timeline(name="third-party-nested-markers")
    track = otio.schema.Track(name="V1", kind=otio.schema.TrackKind.Video)
    timeline.tracks.append(track)
    for name, start, duration, url in SOURCE_CLIPS:
        clip = otio.schema.Clip(
            name=name,
            source_range=time_range(rational(start, 30), rational(duration, 30)),
        )
        reference = otio.schema.ExternalReference(target_url=url)
        clip.set_media_references({"DEFAULT_MEDIA": reference}, "DEFAULT_MEDIA")
        track.append(clip)
    track.markers.append(
        otio.schema.Marker(
            name="track-mark",
            color="RED",
            marked_range=time_range(rational(10, 30), rational(5, 30)),
        )
    )
    track[0].markers.append(
        otio.schema.Marker(
            name="clip-mark",
            color="BLUE",
            marked_range=time_range(rational(0, 30), rational(5, 30)),
        )
    )
    with open(path, "w", encoding="utf-8") as handle:
        handle.write(otio.adapters.write_to_string(timeline, "otio_json"))


def summary(otio, path):
    """用官方 adapter 读回并输出剪辑决策摘要。"""
    timeline = otio.adapters.read_from_file(path, "otio_json")
    clips = []
    nested = []
    track_markers = []
    for track in timeline.tracks:
        # W-10 第五批：嵌套 Stack 只记录结构，不展开其内部片段
        if isinstance(track, otio.schema.Stack):
            nested.append(
                {
                    "name": track.name,
                    "children": [child.name for child in track],
                }
            )
            continue
        track_markers.extend(
            [
                {"name": marker.name, "duration": marker.marked_range.duration.value}
                for marker in track.markers
            ]
        )
        for item in track:
            if isinstance(item, otio.schema.Transition):
                clips.append(
                    {
                        "name": item.name,
                        "transition": True,
                        "in_offset": item.in_offset.value,
                        "out_offset": item.out_offset.value,
                    }
                )
                continue
            source_range = item.source_range
            entry = {
                "name": item.name,
                "duration": source_range.duration.value,
                "rate": source_range.duration.rate,
                "source_start": source_range.start_time.value,
            }
            media = getattr(item, "media_reference", None)
            if media is not None:
                entry["url"] = getattr(media, "target_url", None)
            entry["effects"] = [
                {"name": effect.name, "schema": effect.schema_name()}
                for effect in item.effects
            ]
            entry["markers"] = [
                {"name": marker.name, "duration": marker.marked_range.duration.value}
                for marker in item.markers
            ]
            clips.append(entry)
    markers = [
        {"name": marker.name, "duration": marker.marked_range.duration.value}
        for marker in timeline.tracks.markers
    ]
    return {
        "name": timeline.name,
        "track_count": len(timeline.tracks),
        "clips": clips,
        "markers": markers,
        "track_markers": track_markers,
        "nested": nested,
    }


def main():
    """命令分派。"""
    command = sys.argv[1]
    otio = import_otio()
    if command == "probe":
        print(
            json.dumps(
                {
                    "available": otio is not None,
                    "version": getattr(otio, "__version__", None) if otio else None,
                }
            )
        )
        return 0
    if otio is None:
        print(json.dumps({"error": "opentimelineio unavailable"}))
        return 2
    if command == "make":
        make(otio, sys.argv[2])
        print(json.dumps({"written": sys.argv[2], **summary(otio, sys.argv[2])}))
    elif command == "make2":
        make_transitions(otio, sys.argv[2])
        print(json.dumps({"written": sys.argv[2], **summary(otio, sys.argv[2])}))
    elif command == "make3":
        make_effects(otio, sys.argv[2])
        print(json.dumps({"written": sys.argv[2], **summary(otio, sys.argv[2])}))
    elif command == "make4":
        make_nested_markers(otio, sys.argv[2])
        print(json.dumps({"written": sys.argv[2], **summary(otio, sys.argv[2])}))
    elif command == "validate":
        print(json.dumps(summary(otio, sys.argv[2])))
    else:
        print(json.dumps({"error": f"unknown command: {command}"}))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
