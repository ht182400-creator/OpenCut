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


def summary(otio, path):
    """用官方 adapter 读回并输出剪辑决策摘要。"""
    timeline = otio.adapters.read_from_file(path, "otio_json")
    clips = []
    for track in timeline.tracks:
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
    elif command == "validate":
        print(json.dumps(summary(otio, sys.argv[2])))
    else:
        print(json.dumps({"error": f"unknown command: {command}"}))
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
