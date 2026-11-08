# ocx-domain ripple 测试案例库（golden master）

> 数据源：`tests/fixtures/ripple_cases.json`（18 个用例，时间单位为 ticks，`120000 ticks = 1 秒`）。
> 执行器：`tests/golden_master.rs`（Rust core）与 `tests/ripple-alignment.test.mjs`（经典版 TS 的 JS 参考实现）。
> **三者一一对应**：本文件表格 ID、JSON 的 `cases[].id`、两个执行器遍历的用例。Rust 与 JS 测试都会校验每个 ID 出现在本文，缺失即失败。
> 分类覆盖：正常 / 边界 / 异常（由两个执行器强制检查）。

## 单位约定

经典版 `apps/web/src/ripple/*.ts` 用浮点秒；本地 Rust core 用 `MediaTime` 整数 ticks。换算 `ticks = 秒 × 120000` 是线性的，比较与加减语义不变，且消除了浮点边界漂移。JS 参考实现同样使用 ticks。

## 用例表

| ID | 分类 | kind | 输入摘要 | 预期输出 | 实测输出 |
| --- | --- | --- | --- | --- | --- |
| R01 | 正常 | compute | 主轨删除 `a`(0~240000)，保留 `b`(240000~) | 1 个调整：`afterTime=240000, shiftAmount=240000` | 与预期一致 |
| R02 | 正常 | compute | `a` 从 360000 缩到 240000 | 1 个调整：`afterTime=360000, shiftAmount=120000` | 与预期一致 |
| R03 | 正常 | compute | 元素 `a` 从主轨移到 overlay 轨 | 无调整（全局 id 集合命中，不算腾空） | 与预期一致 |
| R04 | 正常 | compute | 删除 `a` 同时新增 `x` 完全覆盖同一区间 | 无调整（joined 抵消 vacated） | 与预期一致 |
| R05 | 正常 | compute | 删除相邻两段 `a`+`b` | 归一化合并为 1 个调整：`shiftAmount=240000` | 与预期一致 |
| R06 | 正常 | compute | overlay / main / audio 三轨各删一个片段 | 3 个调整，顺序 `o1 → main → s1` | 与预期一致 |
| R07 | 边界 | shift | `afterTime` 精确等于元素 `startTime` | 该元素前移 60000 | 与预期一致 |
| R08 | 边界 | shift | `afterTime = startTime + 1 tick` | 元素保持不动 | 与预期一致 |
| R09 | 异常 | shift | `shiftAmount` 为负（-60000） | 元素后移到 180000 | 与预期一致 |
| R10 | 边界 | apply | `adjustments` 为空数组 | 场景原样返回 | 与预期一致 |
| R11 | 边界 | compute | 前后都是空场景 | 无调整 | 与预期一致 |
| R12 | 边界 | compute | 零时长元素 + 正常元素 | 无调整（零长度区间被过滤） | 与预期一致 |
| R13 | 异常 | compute | 负 duration（end < start） | 无调整（非法区间被过滤） | 与预期一致 |
| R14 | 异常 | apply | 调整指向不存在的轨道 `ghost` | 场景原样返回 | 与预期一致 |
| R15 | 边界 | apply | 同一轨道两个调整 | 按 `afterTime` 降序应用，结果 `a=120000, b=180000` | 与预期一致 |
| R16 | 异常 | compute | 同一轨道重复元素 id | 按 JS `Map` 语义「值覆盖、顺序保持首次」，仅产生 1 个调整 | 与预期一致 |
| R17 | 正常 | computeThenApply | 删除 `a` 后把调整应用回原场景 | 1 个调整；`b` 前移到 0 | 与预期一致 |
| R18 | 边界 | compute | 删除 `a`(0~360000)，新增 `x`(120000~240000) 部分覆盖 | 2 个调整：`afterTime=120000` 与 `360000` | 与预期一致 |

## 测试结果

- **Rust**：`cargo test -p ocx-domain` → `golden_master_cases`（18 用例逐字段比对）+ `unit.rs` 5 个单测（8 线程并发一致性、i64 极值不 panic、秒/ticks 换算、空调整与未知轨道、端到端补空档）。
- **JS 对齐**：`node ripple-alignment.test.mjs` → 同一份 JSON 期望值逐字段比对；额外校验 ID 唯一、三类分类齐全、Rust 源实现存在、未知 kind 与损坏 JSON 被明确拒绝。
- **失败判定**：任一字段不符即输出用例 ID、分类、kind、字段名与实际/期望值；FAIL 标红，进程以非零码退出。
- **日志**：分层 `INFO / PASS / FAIL`，按日期时间写入系统临时目录 `opencut-ripple-alignment-YYYYMMDDHHMMSS.log`，不污染仓库。
- **扩展约定**：新增领域行为必须先补 JSON 用例、更新本表，再改 Rust 与 JS 参考实现；三者都必须通过才算对齐。
