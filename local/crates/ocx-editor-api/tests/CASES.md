# ocx-editor-api 测试案例库（golden master）

> 数据源：`tests/fixtures/editor_api_cases.json`；执行器：`tests/golden_master.rs` 的 `golden_master_cases`。
> 三处**一一对应**：本文件表格 ID、JSON 的 `cases[].id`、Rust 遍历的用例；测试会校验每个 ID 都出现在本文，缺失即失败。
> 每个用例是独立后端上的一段**命令序列**（execute / undo / redo / discover / snapshot / register），首个错误即终止序列。
> 分类覆盖：正常 / 边界 / 异常（由测试断言强制检查）。

## 用例表

| ID | 分类 | 步骤摘要 | 预期输出 | 实测输出 |
| --- | --- | --- | --- | --- |
| E01 | 正常 | addClip(label=intro, durationTicks=120000) | error=null, clipCount=1, ticks=120000, label=intro | 与预期一致 |
| E02 | 正常 | addClip(a,60000) → addClip(b,120000) | error=null, clipCount=2, ticks=180000, label=b, snapshotId=2 | 与预期一致 |
| E03 | 正常 | setPlayhead(ticks=5000) | error=null, clipCount=0, ticks=5000 | 与预期一致 |
| E04 | 正常 | addClip(intro,120000) → undo | error=null, clipCount=0, ticks=0（事件流恢复旧值） | 与预期一致 |
| E05 | 正常 | addClip(intro,120000) → undo → redo | error=null, clipCount=1, ticks=120000 | 与预期一致 |
| E06 | 正常 | discover | error=null, backendId=ocx-in-memory | 与预期一致 |
| E07 | 正常 | addClip(x,10) → clear | error=null, clipCount=0, ticks=0, label="" | 与预期一致 |
| E08 | 边界 | addClip(label="", durationTicks=0) | error=null, clipCount=1, ticks=0, label="" | 与预期一致 |
| E09 | 边界 | addClip(neg, durationTicks=-120000)（负时间） | error=null, clipCount=1, ticks=-120000 | 与预期一致 |
| E10 | 边界 | addClip(labelLength=257)（超长字符串） | error=INVALID_PAYLOAD, clipCount=0 | 与预期一致 |
| E11 | 边界 | clear(commandId="")（空 ID） | error=INVALID_PAYLOAD, clipCount=0 | 与预期一致 |
| E12 | 边界 | 空历史执行 undo | error=HISTORY_EMPTY, clipCount=0 | 与预期一致 |
| E13 | 边界 | clear → undo（clear 暂不可撤销，且不吞历史） | error=INVALID_PAYLOAD, clipCount=0 | 与预期一致 |
| E14 | 边界 | snapshot(ticks=-1) → setPlayhead(777) | error=null, atTicks=-1, ticks=777 | 与预期一致 |
| E15 | 异常 | execute(kind=nope) | error=UNSUPPORTED_COMMAND, clipCount=0 | 与预期一致 |
| E16 | 异常 | clear(apiVersion=9.9.9) | error=VERSION_MISMATCH, clipCount=0 | 与预期一致 |
| E17 | 异常 | clear(schemaVersion=999) | error=VERSION_MISMATCH, clipCount=0 | 与预期一致 |
| E18 | 异常 | addClip 缺少 durationTicks | error=INVALID_PAYLOAD, clipCount=0 | 与预期一致 |
| E19 | 异常 | register(backend-a) → register(backend-b)（I-05） | error=BACKEND_ALREADY_REGISTERED, clipCount=0 | 与预期一致 |

## 测试结果

- 执行命令：`cargo test -p ocx-editor-api`（6 个内联单测 + 19 个 JSON 序列用例）。
- 内联单测额外覆盖：能力发现字段、重复注册被拒、undo/redo 往返、四类非法输入、空历史与不可撤销命令、**8 线程并发执行**计数不丢失。
- 每个用例由 `run_case` 生成结果对象，与 JSON 的 `expected` **逐字段**比对；不一致时输出用例 ID、分类、字段名、实际值与期望值，进程以非零码退出（终端对失败用例标红）。
- 额外校验：用例 ID 唯一、三类分类齐全、本文包含全部 ID、`API_VERSION`/`SCHEMA_VERSION`/错误码常量未漂移。
- 日志：`cargo test` 输出按「编译 → 单元测试 → 集成测试 → 汇总」分层；运行日志使用带日期时间的文件名（`opencut-cargo-test-YYYYMMDD-HHmmss.log`）存于系统临时目录，不写入仓库。
- 新增行为必须先补 JSON 用例、更新本表，再改实现。
