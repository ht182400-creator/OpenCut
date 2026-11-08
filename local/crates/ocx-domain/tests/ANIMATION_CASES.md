# ocx-domain animation 测试案例库（golden master）

> 数据源：`tests/fixtures/animation_cases.json`（25 个用例，时间为 ticks，数值为 f64）。
> 执行器：`tests/animation_golden_master.rs`（Rust core）与 `tests/animation-alignment.test.mjs`（经典版 TS 的 JS 参考实现）。
> **三者一一对应**：本文件表格 ID、JSON 的 `cases[].id`、两个执行器遍历的用例；双方各自校验每个 ID 出现在本文。
>
> **浮点容差 `1e-5`**：经典版 `solveBezierProgressForTime` 只做 20 次二分（固有误差约 `4.8e-7`），经数值缩放后约 `5e-6`，故取 `1e-5`；仍远小于任何逻辑错误产生的偏差。两个执行器都用递归容差比较（数值按绝对误差，对象/数组逐项，其余严格相等），避免跨语言最短小数表示差异造成误判。
>
> `keyframe-query.ts` 依赖 `channel-data.ts` 与 `params` 颜色格式化，本批不翻译。

## 用例表

| ID | 分类 | kind | 输入摘要 | 预期输出 | 实测输出 |
| --- | --- | --- | --- | --- | --- |
| A01 | 正常 | bezierPoint | progress 0.5、p=(0,0,1,1) | 0.5 | 与预期一致 |
| A02 | 边界 | bezierPoint | progress 0、p0=2 | 2（起点） | 与预期一致 |
| A03 | 边界 | bezierPoint | progress 1、p3=8 | 8（终点） | 与预期一致 |
| A04 | 正常 | bezierPoint | progress 0.5、p=(0,1,1,1) | 0.875 | 与预期一致 |
| A05 | 正常 | defaultHandles | 0→120000 ticks、0→12 | right `{dt:40000,dv:4}`；left `{dt:-40000,dv:-4}` | 与预期一致 |
| A06 | 正常 | solveProgress | 默认手柄、time 60000 | progress 0.5 | 与预期一致 |
| A07 | 正常 | solveProgress | 默认手柄、time 30000 | progress 0.25 | 与预期一致 |
| A08 | 边界 | solveProgress | 两端手柄 dt=0（x 曲线为 smoothstep） | time 60000 → progress 0.5 | 与预期一致 |
| A09 | 正常 | segmentInterpolationAll | 三种段类型 | step→hold、linear→linear、bezier→bezier | 与预期一致 |
| A10 | 正常 | normalizeScalar | 乱序两帧 + 越界手柄 | 排序；手柄 dt 夹到 ±120000；补 tangentMode/segmentToNext；首尾无外侧手柄 | 与预期一致 |
| A11 | 正常 | normalizeDiscrete | 乱序布尔/字符串帧 | 按时间稳定排序 | 与预期一致 |
| A12 | 正常 | scalarValue | 线性段、0→10、time 60000 | 5 | 与预期一致 |
| A13 | 正常 | scalarValue | step 段、time 60000 | 0（取左帧值） | 与预期一致 |
| A14 | 正常 | scalarValue | bezier 段、默认手柄 | 5（默认手柄下数值曲线退化为线性） | 与预期一致 |
| A15 | 边界 | scalarValue | time 早于首帧、before=hold | 0 | 与预期一致 |
| A16 | 边界 | scalarValue | time 晚于末帧、after=linear | 15（按相邻帧斜率外推） | 与预期一致 |
| A17 | 边界 | scalarValue | 空通道 | fallback 3 | 与预期一致 |
| A18 | 边界 | scalarValue | 单帧、time 超出 | 7（hold） | 与预期一致 |
| A19 | 边界 | scalarValue | time 恰好等于末帧 | 10 | 与预期一致 |
| A20 | 正常 | discreteValue | 两帧 false/on、time 180000 | "on" | 与预期一致 |
| A21 | 边界 | discreteValue | time 早于首帧 | fallback "fallback" | 与预期一致 |
| A22 | 正常 | channelValue | 标量通道 + 数值 fallback | 5 | 与预期一致 |
| A23 | 异常 | channelValue | 标量通道 + 字符串 fallback（类型不符） | 原样返回 "mismatch" | 与预期一致 |
| A24 | 正常 | channelValue | 离散通道 + 布尔 fallback | true | 与预期一致 |
| A25 | 边界 | channelValue | 空通道 + 数值 fallback | 42 | 与预期一致 |

## 测试结果

- **Rust**：`cargo test -p ocx-domain` → `animation_golden_master_cases`（25 用例逐字段容差比对）+ `animation_unit.rs` 4 个单测（8 线程并发、i64 极值、空通道 fallback、归一化排序稳定性）。
- **JS 对齐**：`node animation-alignment.test.mjs` → 同一份 JSON 期望值递归容差比对；额外校验 ID 唯一、三类分类齐全、Rust 源实现存在、容差为正、未知 kind 与损坏 JSON 被明确拒绝。
- **失败判定**：任一字段不符即输出用例 ID、分类、kind、字段名与差异；FAIL 标红，进程以非零码退出。
- **日志**：分层 `INFO / PASS / FAIL`，按日期时间写入系统临时目录 `opencut-animation-alignment-YYYYMMDDHHMMSS.log`。
- **扩展约定**：新增动画行为必须先补 JSON 用例、更新本表，再改 Rust 与 JS 参考实现；三者都通过才算对齐。
