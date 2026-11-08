# ocx-domain placement 测试案例库（golden master）

> 数据源：`tests/fixtures/placement_cases.json`（29 个用例，时间单位为 ticks）。
> 执行器：`tests/placement_golden_master.rs`（Rust core）与 `tests/placement-alignment.test.mjs`（经典版 TS 的 JS 参考实现）。
> **三者一一对应**：本文件表格 ID、JSON 的 `cases[].id`、两个执行器遍历的用例。双方都会校验每个 ID 出现在本文，缺失即失败。
> 输入轨道字段用 `trackType`（经典版 TS 里叫 `type`），输出结果仍用 `trackType`；`apply.ts` 因依赖随机 UUID 与轨道工厂，本批不翻译。

## 用例表

| ID | 分类 | kind | 输入摘要 | 预期输出 | 实测输出 |
| --- | --- | --- | --- | --- | --- |
| P01 | 正常 | mapAll | 7 种元素类型 | `audio→audio, text→text, sticker/graphic→graphic, effect→effect, video/image→video` | 与预期一致 |
| P02 | 正常 | compatibility | video 元素 / video 轨 | `{isValid:true}` | 与预期一致 |
| P03 | 异常 | compatibility | audio 元素 / text 轨 | `{isValid:false, errorMessage:"audio elements cannot be placed on text tracks"}` | 与预期一致 |
| P04 | 正常 | overlap | 已有 0~120000，放 240000~ | `canPlace=true` | 与预期一致 |
| P05 | 正常 | overlap | 已有 0~120000，放 60000~120000 | `canPlace=false` | 与预期一致 |
| P06 | 边界 | overlap | 与已有元素完全重叠但 `excludeElementId` 排除自身 | `canPlace=true` | 与预期一致 |
| P07 | 边界 | overlap | 空时间段列表 | `canPlace=true` | 与预期一致 |
| P08 | 正常 | earliest | 主轨 3 个元素、两个同起点 | 最早为 `b`（相同起点保留先出现者） | 与预期一致 |
| P09 | 边界 | earliest | 排除 `b` 后取最早 | 最早为 `a` | 与预期一致 |
| P10 | 边界 | mainTrack | 目标轨 `o1` 不是主轨 | 原样返回 240000 | 与预期一致 |
| P11 | 边界 | mainTrack | 主轨为空 | 归零 | 与预期一致 |
| P12 | 边界 | mainTrack | 请求起点 0 ≤ 最早元素 0 | 归零 | 与预期一致 |
| P13 | 正常 | mainTrack | 请求起点 240000 > 最早元素 0 | 240000 | 与预期一致 |
| P14 | 正常 | insertIndexAll | overlay 2 / audio 1 | default `video=2,audio=4,effect=0`；highest `video=0,audio=3,effect=0` | 与预期一致 |
| P15 | 边界 | preferred | video、首选索引 99 越界、below | 夹到 `insertIndex=2, above` | 与预期一致 |
| P16 | 正常 | preferred | audio、首选索引 0 ≤ 主轨索引 2 | `insertIndex=3, below` | 与预期一致 |
| P17 | 异常 | preferred | 负首选索引 -5 | 夹到 0，`insertIndex=0, above` | 与预期一致 |
| P18 | 正常 | resolve·explicit | 指定 `main`、类型匹配 | existingTrack（index 2, video） | 与预期一致 |
| P19 | 异常 | resolve·explicit | 指定不存在的 `ghost` | `null` | 与预期一致 |
| P20 | 异常 | resolve·explicit | audio 元素指定 video 主轨 | `null`（类型不符） | 与预期一致 |
| P21 | 正常 | resolve·firstAvailable | graphic 找第一条可放轨道 | existingTrack（o1, index 0） | 与预期一致 |
| P22 | 边界 | resolve·firstAvailable | video 唯一轨道有冲突 | newTrack（highest, insertIndex 0, insertPosition null） | 与预期一致 |
| P23 | 正常 | resolve·preferIndex | 首选轨道兼容且无冲突 | existingTrack（o1） | 与预期一致 |
| P24 | 边界 | resolve·preferIndex | `createNewTrackOnly=true` | newTrack（insertIndex 1, below） | 与预期一致 |
| P25 | 正常 | resolve·aboveSource | 上方轨道 o1 可用 | existingTrack（o1, index 0） | 与预期一致 |
| P26 | 边界 | resolve·aboveSource | 上方主轨冲突且无其它可用轨 | newTrack（highest, insertIndex 0） | 与预期一致 |
| P27 | 正常 | resolve·alwaysNew | video / default | newTrack（insertIndex 2） | 与预期一致 |
| P28 | 正常 | resolve·alwaysNew | audio / highest | newTrack（insertIndex 3） | 与预期一致 |
| P29 | 异常 | resolve·preferIndex | 垂直拖拽 `up` 覆盖悬停 `below`，且首选轨道不兼容 | newTrack（insertIndex 2, above） | 与预期一致 |

## 测试结果

- **Rust**：`cargo test -p ocx-domain` → `placement_golden_master_cases`（29 用例逐字段比对）+ `placement_unit.rs` 4 个单测（8 线程并发、i64 极值、空场景、兼容性文案）。
- **JS 对齐**：`node placement-alignment.test.mjs` → 同一份 JSON 期望值逐字段比对；额外校验 ID 唯一、三类分类齐全、Rust 源实现存在、未知 kind 与损坏 JSON 被明确拒绝。
- **失败判定**：任一字段不符即输出用例 ID、分类、kind、字段名与差异；FAIL 标红，进程以非零码退出。
- **日志**：分层 `INFO / PASS / FAIL`，按日期时间写入系统临时目录 `opencut-placement-alignment-YYYYMMDDHHMMSS.log`。
- **扩展约定**：新增放置行为必须先补 JSON 用例、更新本表，再改 Rust 与 JS 参考实现；三者都通过才算对齐。
