# W-05 第四批：项目兼容 + keyframe-query 测试案例库

> 数据源：`tests/fixtures/legacy_cases.json`（25 个用例，经典版项目版本 31）。
> 执行器：`tests/legacy_golden_master.rs`（Rust core）与 `tests/legacy-alignment.test.mjs`（经典版 TS 的 JS 参考实现 `legacy-reference.mjs`）。
> **三者一一对应**：本表 ID、JSON 的 `cases[].id`、两个执行器遍历的用例；双方都会校验每个 ID 出现在本文。
>
> 两类内容：① 经典版 31 版项目 JSON **只读**兼容层（本地新视图）；② `keyframe-query.ts` 逐函数翻译（含 `channel-data.ts` / `path.ts` 规则与 `formatLinearRgba`）。
> 路径遍历固定为**字典序**（经典版 `Object.entries` 是插入顺序），结果本身按时间排序，不受影响；两侧都用该约定保证确定性。

## 用例表

| ID | 分类 | kind | 输入摘要 | 预期输出 | 实测输出 |
| --- | --- | --- | --- | --- | --- |
| L01 | 正常 | readClassicProject | 完整 v31 项目（1 场景、主轨 2 元素、30fps、1920×1080） | 全字段一致；2 元素、1 轨道、0 warning | 与预期一致 |
| L02 | 边界 | readClassicProject | v30 项目、空场景、25fps | 仍可读；sceneCount 0 | 与预期一致 |
| L03 | 异常 | readClassicProject | version 32（未来格式） | `UNSUPPORTED_VERSION` | 与预期一致 |
| L04 | 异常 | readClassicProject | 缺 version | `MISSING_VERSION` | 与预期一致 |
| L05 | 异常 | readClassicProject | 非法 JSON 文本 | `INVALID_JSON` | 与预期一致 |
| L06 | 异常 | readClassicProject | 缺 metadata | `MISSING_METADATA` | 与预期一致 |
| L07 | 异常 | readClassicProject | 缺 scenes | `MISSING_SCENES` | 与预期一致 |
| L08 | 边界 | readClassicProject | 缺 settings | 默认 30/1 与 1920×1080，2 条 warning | 与预期一致 |
| L09 | 正常 | readClassicProject | overlay/main/audio 三轨、29.97fps | 轨道顺序 `text → video → audio`，2 元素 | 与预期一致 |
| L10 | 边界 | readClassicProject | version 0 | `UNSUPPORTED_VERSION` | 与预期一致 |
| L11 | 正常 | keyframeQuery | `isAnimationPath("opacity")` | true | 与预期一致 |
| L12 | 正常 | keyframeQuery | `isAnimationPath("params.size")` | true | 与预期一致 |
| L13 | 正常 | keyframeQuery | `isAnimationPath("effects.e1.params.blur")` | true | 与预期一致 |
| L14 | 异常 | keyframeQuery | `isAnimationPath("unknown.path")` | false | 与预期一致 |
| L15 | 异常 | keyframeQuery | `isAnimationStorageKey("bindings")` | false（遗留键） | 与预期一致 |
| L16 | 边界 | keyframeQuery | `formatLinearRgba(0,0,0,1)` | `#000000` | 与预期一致 |
| L17 | 边界 | keyframeQuery | `formatLinearRgba(1,1,1,1)` | `#ffffff` | 与预期一致 |
| L18 | 边界 | keyframeQuery | `formatLinearRgba(0,0,0,0.5)` | `#00000080` | 与预期一致 |
| L19 | 正常 | keyframeQuery | 单叶标量通道 `opacity` 两帧 | 2 个关键帧；值 0/1；插值 linear/hold | 与预期一致 |
| L20 | 正常 | keyframeQuery | 复合 RGBA 四分量同一时刻 | 只保留 1 帧；值 `#0000ff`；插值 linear | 与预期一致 |
| L21 | 正常 | keyframeQuery | `hasKeyframesForPath` 有帧 | true | 与预期一致 |
| L22 | 边界 | keyframeQuery | `hasKeyframesForPath` 空通道 | false | 与预期一致 |
| L23 | 正常 | keyframeQuery | `getKeyframeAtTime(opacity, 120000)` | 命中 k2、值 1、hold | 与预期一致 |
| L24 | 正常 | keyframeQuery | 离散通道 `params.visible` 按 id 查询 | 命中 v2、值 true、hold | 与预期一致 |
| L25 | 异常 | keyframeQuery | 仅遗留键 `bindings`/`channels` | 空数组 | 与预期一致 |

## 测试结果

- **Rust**：`cargo test -p ocx-domain` → `legacy_golden_master_cases`（25 用例逐字段容差比对）；既有 ripple / placement / animation 三套 golden master 回归不退化。
- **JS 对齐**：`node legacy-alignment.test.mjs` → 同一份 JSON 期望值递归容差比对；额外校验 ID 唯一、三类分类齐全、Rust 源实现存在、未知 kind/op 与损坏 JSON 被明确拒绝。
- **WASM 跨语言**：`editor-wasm.contract.mjs` 新增 `readClassicProject` 与 `keyframeQuery` 真实 WASM 调用（不经过 JSON 参考实现）。
- **失败判定**：任一字段不符即输出用例 ID、分类、kind、字段名与差异；FAIL 标红，进程以非零码退出。
- **日志**：分层 `INFO / PASS / FAIL`，按日期时间写入系统临时目录 `opencut-legacy-alignment-YYYYMMDDHHMMSS.log`。
- **扩展约定**：新增兼容字段或关键帧行为时，先补 JSON 用例与本表，再改 Rust 与 JS 参考实现；三者都通过才算对齐。

## additive-only 约束

经典版 `services/storage/migrations/AGENTS.md` 规定迁移不得删除/改名/替换持久化数据。本兼容层严格**只读**：用宽容 `Value` 遍历、未知字段忽略但不写回、缺失字段补默认值并记 `warnings`、高于 v31 明确拒绝。输出 `ProjectView` 是消费视图，不是新的持久化格式。
