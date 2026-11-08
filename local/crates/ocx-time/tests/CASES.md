# ocx-time 测试案例库（golden master）

> 数据源：`tests/fixtures/media_time_cases.json`；执行器：`tests/golden_master.rs` 的 `golden_master_cases`。
> 三处**一一对应**：本文件表格的 ID、JSON 的 `cases[].id`、Rust 测试遍历的用例。Rust 测试会校验每个 ID 都出现在本文件中，缺失即失败。
> 分类覆盖：正常 / 边界 / 异常（由测试断言强制检查）。

## 用例表

| ID | 分类 | kind | 输入 | 预期输出 | 实测输出 |
| --- | --- | --- | --- | --- | --- |
| T01 | 正常 | from_seconds | seconds=0 | ticks=0 | ticks=0 |
| T02 | 正常 | from_seconds | seconds=1 | ticks=120000 | ticks=120000 |
| T03 | 正常 | from_seconds | seconds=0.25 | ticks=30000 | ticks=30000 |
| T04 | 边界 | from_seconds | seconds=-1.25（负时间） | ticks=-150000 | ticks=-150000 |
| T05 | 边界 | from_seconds | seconds=1e12（接近 i64 上限） | ticks=120000000000000000 | ticks=120000000000000000 |
| T06 | 异常 | from_seconds | seconds=1e300（溢出 i64） | None | None |
| T07 | 异常 | from_seconds_non_finite | variant=nan | None | None |
| T08 | 异常 | from_seconds_non_finite | variant=inf | None | None |
| T09 | 异常 | from_seconds_non_finite | variant=neg_inf | None | None |
| F01 | 正常 | ticks_per_frame | 24000/1001 (23.976) | Some(5005) | Some(5005) |
| F02 | 正常 | ticks_per_frame | 30000/1001 (29.97) | Some(4004) | Some(4004) |
| F03 | 正常 | ticks_per_frame | 30/1 | Some(4000) | Some(4000) |
| F04 | 正常 | ticks_per_frame | 120/1 | Some(1000) | Some(1000) |
| F05 | 边界 | ticks_per_frame | 0/1（零帧率） | None | None |
| F06 | 异常 | ticks_per_frame | 1/0（分母为零） | None | None |
| F07 | 异常 | ticks_per_frame | 7/3（无法整除 TICKS_PER_SECOND） | None | None |
| F08 | 边界 | ticks_per_frame | 4294967295/1（u32 极值） | None | None |
| R01 | 正常 | round_to_frame | ticks=4000, 30/1 | ticks=4000 | ticks=4000 |
| R02 | 边界 | round_to_frame | ticks=5999, 30/1（向下取整） | ticks=4000 | ticks=4000 |
| R03 | 边界 | round_to_frame | ticks=6000, 30/1（半帧进位） | ticks=8000 | ticks=8000 |
| R04 | 正常 | round_to_frame | ticks=2503, 24000/1001 | ticks=5005 | ticks=5005 |
| R05 | 异常 | round_to_frame | ticks=0, 0/1（非法帧率） | None | None |
| R06 | 边界 | round_to_frame | ticks=-1, 30/1（负时间） | ticks=0 | ticks=0 |
| A01 | 正常 | is_frame_aligned | ticks=4000, 30/1 | Some(true) | Some(true) |
| A02 | 边界 | is_frame_aligned | ticks=4001, 30/1 | Some(false) | Some(false) |
| A03 | 异常 | is_frame_aligned | ticks=0, 7/3 | None | None |
| C01 | 正常 | clamp | ticks=5000, min=0, max=4000 | ticks=4000 | ticks=4000 |
| C02 | 边界 | clamp | ticks=-10, min=0, max=4000 | ticks=0 | ticks=0 |
| C03 | 正常 | clamp | ticks=2000, min=0, max=4000 | ticks=2000 | ticks=2000 |
| G01 | 正常 | guess_timecode_format | "01:23" | "MM:SS" | "MM:SS" |
| G02 | 正常 | guess_timecode_format | "01:02:03" | "HH:MM:SS" | "HH:MM:SS" |
| G03 | 正常 | guess_timecode_format | "01:02:03:04" | "HH:MM:SS:FF" | "HH:MM:SS:FF" |
| G04 | 边界 | guess_timecode_format | ""（空串） | None | None |
| G05 | 异常 | guess_timecode_format | "abc"（非法） | None | None |
| G06 | 边界 | guess_timecode_format | "01"（段数不足） | None | None |
| M01 | 正常 | format_timecode | ticks=0，默认格式 | "00:00:00:00" | "00:00:00:00" |
| M02 | 正常 | format_timecode | ticks=120000（1 秒） | "00:00:01:00" | "00:00:01:00" |
| M03 | 边界 | format_timecode | ticks=7830000（65.25 秒） | "00:01:05:25" | "00:01:05:25" |
| M04 | 边界 | format_timecode | ticks=-1（负时间被夹到 0） | "00:00:00:00" | "00:00:00:00" |
| M05 | 正常 | format_timecode | ticks=7830000, format="MM:SS" | "01:05" | "01:05" |

## 测试结果

- 执行命令：`cargo test -p ocx-time`（含 10 个内联单测 + 本文件对应的 40 个数据驱动用例）。
- 每个用例由 `run_case` 计算出实际值，与 JSON 的 `expected` 逐条比对；不一致时输出用例 ID、分类、实际值与期望值，测试进程以非零码退出（终端对失败用例标红）。
- 额外校验：用例 ID 唯一、三类分类齐全、本文件包含全部 ID。
- 日志：`cargo test` 输出按「编译 → 单元测试 → 集成测试 → 汇总」分层；运行日志保存为带日期时间的文件名（`opencut-cargo-test-YYYYMMDD-HHmmss.log`）于系统临时目录，不写入仓库。
- 内联单测（10 个）与数据驱动用例（40 个）共同构成本次回归基线；新增行为必须先补 JSON 用例、更新本表，再改实现。
