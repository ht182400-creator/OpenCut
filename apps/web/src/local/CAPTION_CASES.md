# 字幕解析 golden master 测试案例库

> 数据源：`fixtures/caption-parse-cases.json`（14 个用例，时间单位为毫秒）。
> 被测模块：`caption-import.ts`（TypeScript / Vitest）。
> 执行器：`caption-golden-master.test.ts`。
> **三者一一对应**：本文件表格 ID、JSON 的 `cases[].id`、执行器 `it.each` 遍历的用例。执行器强制校验 ID 唯一、三类分类齐全、每个 ID 出现在本文，缺失即失败。
> 分类覆盖：正常 / 边界 / 异常（ISO/IEC 29119-4 规格说明测试技术：等价类划分 + 边界值分析 + 非法输入）。

## 单位约定

SRT 时间格式 `HH:MM:SS,mmm`（毫秒 1~3 位，右侧补零）；ASS 时间格式 `H:MM:SS.cc`（小数位是**百分秒**，`.5` = 5/100s = 50ms，`.50` = 500ms）。解析器统一返回毫秒整数，非法输入返回 `null`。

## 用例表

| ID | 分类 | 被测函数 | 输入 | 预期输出 | 实测输出 |
| --- | --- | --- | --- | --- | --- |
| CP01 | 正常 | parseSrtTime | `00:00:01,500` | 1500 | 与预期一致 |
| CP02 | 正常 | parseSrtTime | `01:02:03,004` | 3723004 | 与预期一致 |
| CP03 | 边界 | parseSrtTime | `00:00:01.5`（1 位毫秒补零） | 1500 | 与预期一致 |
| CP04 | 边界 | parseSrtTime | `00:00:01.05`（2 位毫秒补零） | 1050 | 与预期一致 |
| CP05 | 边界 | parseSrtTime | `01:30,250`（MM:SS 短时间） | 90250 | 与预期一致 |
| CP06 | 异常 | parseSrtTime | `00:60:00,000`（分钟越界） | null（拒绝） | 与预期一致 |
| CP07 | 异常 | parseSrtTime | `00:00:00,0000`（毫秒 4 位） | null（拒绝） | 与预期一致 |
| CP08 | 正常 | parseAssTime | `0:00:01.00` | 1000 | 与预期一致 |
| CP09 | 边界 | parseAssTime | `0:01:30.25`（两位百分秒） | 90250 | 与预期一致 |
| CP10 | 边界 | parseAssTime | `1:02:03.5`（一位百分秒按字面） | 3723050 | 与预期一致 |
| CP11 | 异常 | parseAssTime | `00:00:01.000`（三位毫秒） | null（拒绝） | 与预期一致 |
| CP12 | 正常 | normalizeCaptionText | `你好\N世界` | `你好 世界` | 与预期一致 |
| CP13 | 边界 | normalizeCaptionText | `{\i1} 多行  空白\n合并` | `多行 空白 合并` | 与预期一致 |
| CP14 | 异常 | normalizeCaptionText | `   {\an8}  `（仅样式与空白） | 空串 | 与预期一致 |

## 测试结果（2026-11-25）

- **执行器**：`bunx vitest run src/local/caption-golden-master.test.ts` → 15 项通过（1 结构校验 + 14 数据驱动），0 失败。
- **覆盖技术**：ISO/IEC 29119-4 规格说明测试（等价类划分、边界值分析、非法输入）；三类分类由执行器强制检查。
- **失败判定**：任一字段不符输出 ID / 分类 / 输入 / 期望 / 实际；FAIL 标红，vitest 进程非零退出。
- **同步要求**：新增/修改 JSON 案例必须同步本表 ID 与预期值，否则执行器的「文档一一对应」断言失败。
