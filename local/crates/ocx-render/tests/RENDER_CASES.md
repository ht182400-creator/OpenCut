# ocx-render 帧契约测试案例库（golden master）

> 数据源：`tests/fixtures/render_cases.json`（26 个用例，时间单位为 ticks）。
> 执行器：`tests/golden_master.rs`（Rust core）+ `tests/unit.rs`（并发、极值与不变量单测）。
> **一一对应**：本文件表格 ID、JSON 的 `cases[].id`、执行器遍历的用例；执行器会校验每个 ID 出现在本文，缺失即失败。
>
> `RenderFrame` / `ExportProfile` 是**本地新契约**（不是经典版 TS 翻译），因此没有 JS 参考实现；跨语言一致性由 `apps/web/src/local/editor-wasm.contract.mjs` 在 Node 中加载真实 WASM 产物验证。浮点（时长秒数）按 1e-9 容差递归比较。

## 用例表

| ID | 分类 | kind | 输入摘要 | 预期输出 | 实测输出 |
| --- | --- | --- | --- | --- | --- |
| R01 | 正常 | validateProfile | mp4/avc、8×4、30fps、含音频 48kHz 立体声 | `ok=true` | 与预期一致 |
| R02 | 异常 | validateProfile | mp4 + vp9 | `ok=false, INCOMPATIBLE_CODEC` | 与预期一致 |
| R03 | 异常 | validateProfile | 宽 7（奇数） | `ok=false, INVALID_DIMENSION` | 与预期一致 |
| R04 | 异常 | validateProfile | 帧率分子 0 | `ok=false, INVALID_FRAME_RATE` | 与预期一致 |
| R05 | 异常 | validateProfile | 码率 0 | `ok=false, INVALID_BITRATE` | 与预期一致 |
| R06 | 异常 | validateProfile | 含音频但采样率 22050 | `ok=false, INVALID_AUDIO` | 与预期一致 |
| R07 | 正常 | validateProfile | webm/av1、1920×1080、30000/1001、96kHz 8 声道 | `ok=true` | 与预期一致 |
| R08 | 边界 | validateProfile | 宽 0 | `ok=false, INVALID_DIMENSION` | 与预期一致 |
| R09 | 异常 | validateProfile | 含音频但声道数 0 | `ok=false, INVALID_AUDIO` | 与预期一致 |
| R10 | 正常 | framePlan | 1 秒、30fps、含音频 48kHz | 30 帧、tpf 4000、累计采样 48000、每帧 1600、首帧 0 / 末帧 116000 | 与预期一致 |
| R11 | 正常 | framePlan | 0.1 秒、25fps、无音频 | 3 帧（向上取整）、tpf 4800、帧时刻 `[0,4800,9600]` | 与预期一致 |
| R12 | 边界 | framePlan | 时长 0 | 0 帧、空帧时刻与采样数组 | 与预期一致 |
| R13 | 边界 | framePlan | 1 秒、29.97fps(30000/1001)、含音频 | 30 帧、tpf 4004、累计 48048、每帧采样 `[1601,1602,1601,…]`（累积取整，无漂移） | 与预期一致 |
| R14 | 异常 | framePlan | 负时长 | `INVALID_DURATION` | 与预期一致 |
| R15 | 异常 | framePlan | 1000 秒 @30fps → 30000 帧 | `TOO_MANY_FRAMES`（上限 10000） | 与预期一致 |
| R16 | 异常 | framePlan | 非法 profile（mp4+vp9） | `INVALID_PROFILE` | 与预期一致 |
| R17 | 正常 | frameAt | 12000 ticks / tpf 4000 | 第 3 帧 | 与预期一致 |
| R18 | 边界 | frameAt | 时间 0 | 第 0 帧 | 与预期一致 |
| R19 | 异常 | frameAt | 负时间 | `null` | 与预期一致 |
| R20 | 异常 | frameAt | tpf=0 | `null` | 与预期一致 |
| R21 | 正常 | renderFrame | 8×4、opacity 1、中心 0.5/0.5、第 0 帧 | 128 字节；角落为背景、矩形内为前景 | 与预期一致 |
| R22 | 正常 | renderFrame | 同上、第 5 帧 | 前景 R 通道 +5（帧索引驱动，保证时间推进可观测） | 与预期一致 |
| R23 | 边界 | renderFrame | opacity 0.5 | alpha=128（四舍五入） | 与预期一致 |
| R24 | 异常 | renderFrame | opacity 1.5 | `INVALID_OPACITY` | 与预期一致 |
| R25 | 边界 | renderFrame | 位置 0/0 | 左上角落在前景矩形内 | 与预期一致 |
| R26 | 异常 | renderFrame | 非法 profile（mp4+vp9） | `INVALID_PROFILE` | 与预期一致 |

## 测试结果

- **Rust**：`cargo test -p ocx-render` → `render_golden_master_cases`（26 用例逐字段容差比对）+ `unit.rs` 5 个单测（8 线程并发一致性、i64 极值不 panic、checksum 不变量、像素越界、音画同步累积采样）。
- **跨语言**：`node apps/web/src/local/editor-wasm.contract.mjs` 加载真实 WASM，验证 `validate_export_profile` / `build_frame_plan` / `render_frame` 三条入口与像素字节。
- **失败判定**：任一字段不符即输出用例 ID、分类、kind、字段名与实际/期望值；进程以非零码退出。
- **扩展约定**：新增契约字段或算法改变时，先补 JSON 用例与本表，再改实现；golden master 与 Node 契约测试都通过才算对齐。
