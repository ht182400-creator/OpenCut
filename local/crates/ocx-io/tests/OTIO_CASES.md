# W-10 OTIO 导入导出 golden 用例

数据文件：`tests/fixtures/otio_cases.json`（15 个用例）。
执行：`cargo test -p ocx-io --test golden_master`。
Rust golden master 逐字段比对导入结果，并对**每个成功用例**额外执行
`import → export → import`，断言 `decision_key()` 完全一致（剪辑决策不丢失）。

## 类型白名单

本批支持 OTIO 0.19 JSON schema 的 8 种核心类型：
`Timeline.1 / Stack.1 / Track.1 / Clip.1 / Gap.1 / TimeRange.1 / RationalTime.1 / ExternalReference.1`。
遇到白名单外的类型（如 `Transition.1`）明确返回 `UNSUPPORTED_OTIO_SCHEMA`，而不是静默丢弃。
`Transition / Marker / Effect / nested Stack` 留待后续批次。

## 用例清单

| ID | 场景 | 关键验证点 |
| --- | --- | --- |
| T01 | 单轨单片段、第三方未声明 opencut 版本 | 按 v1 兼容、记 1 条 warning；30 帧 @30fps → 120000 ticks |
| T02 | 双片段 | 时间轴位置由前序 duration 累加（第二段 `startTicks=120000`）；`sourceStartTicks=120000` |
| T03 | Gap + Clip 混合 | Gap 也占用时长（10 帧 = 40000 ticks），后续片段 `startTicks=40000`；Gap 无媒体引用 |
| T04 | 多轨 Video + Audio | 轨道数 2、`kind` 保留 |
| T05 | 29.97fps（30000/1001） | 30 帧 → 120120 ticks；导出时原样写回 RationalTime，往返无浮点漂移 |
| T06 | 新版 `media_references` 数组 + `active_media_reference_key` | 选中 `online.mp4`，而非数组首个 `proxy.mp4` |
| T07 | 显式 `schemaVersion=1` + 未知 metadata 字段 | 无 warning；未知字段忽略但不写回 |
| T08 | `schemaVersion=2` | `UNSUPPORTED_IO_VERSION`（additive-only：不猜读未来格式） |
| T09 | 顶层为 `Stack.1` | `MISSING_TIMELINE` |
| T10 | 片段为 `Transition.1` | `UNSUPPORTED_OTIO_SCHEMA` |
| T11 | 缺 `tracks` | `MISSING_TRACKS` |
| T12 | `rate=0` | `INVALID_TIME_RANGE` |
| T13 | 非法 JSON 文本 | `INVALID_JSON` |
| T14 | `tracks.children=[]` | `MISSING_TRACKS` |
| T15 | 轨道缺 `kind` | 补默认 `Video` 并记 1 条 warning |

## additive-only 约定

- 导入时未知字段原样忽略，**不会写回导出文档**；缺失非关键字段补默认值并记 `warnings`。
- 导出的 `metadata.opencut` 写入 `schemaVersion` 与 `generator`；版本只增不改。
- 未来若扩展字段，必须递增 `IO_SCHEMA_VERSION` 并新增用例，旧版本文件仍按 v1 可读。

## 时间精度

`RationalTime { value, rate }` → ticks：`round(value × 120000 / rate)`。
导入时把原始 `value / rate` 保存在 `EditClip` 上，导出时优先原样写回；
只有新建片段（无原始值）才用 `round(ticks × rate / 120000)` 反算。
因此 23.976 / 29.97 这类非整数帧率的往返不会累积漂移。

## 与官方 OpenTimelineIO 的实文件往返（W-10 第三批）

- 官方实现：`opentimelineio 0.18.1`（Python 3.13，cp313 wheel），生成与校验脚本见 `tests/third_party_roundtrip.py`。
- **兼容性差异**：官方 `Clip` 为 **`Clip.2`**（其余仍是 `.1`），`media_references` 是**字典**（由 `active_media_reference_key` 指定活动项），而非数组或 `media_reference` 单字段。`schema.rs` 白名单加入 `Clip.2`；`read_media_url` 同时支持三代写法：单字段 / 数组 / 字典。
- 静态 fixture：`tests/fixtures/third_party_otio_018.json`，由官方 `adapters.write_to_string` 生成（4,770 字节），含 2 个 Clip + 1 个 Gap；`editor-wasm.contract.mjs` 直接读它，无需 Python 即可回归官方格式。
- 动态往返：`node tests/third_party_roundtrip.test.mjs` 在检测到 `opentimelineio` 时执行「官方 make → 我们 import/export → 官方 validate」，逐项比较 `name` / `duration` / `rate` / `source_start` / `url`；未安装时如实 SKIP，不冒充通过。
- 实测 **15/15 通过**：官方 adapter 能读回我们导出的 `.1` 格式（自动把 `Clip.1` 升级到 `Clip.2`），剪辑决策逐项一致。
- 可选安装：`python -m pip install opentimelineio`，或 `pip install --target <dir> opentimelineio` 后用 `PYTHONPATH` 指向该目录。
