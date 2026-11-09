# 本地 core 资产来源与许可

`local/crates/ocx-time` 与 `local/crates/ocx-bridge` 的源码迁自经典版仓库 `opencut-classic` 的 `rust/crates/time` 与 `rust/crates/bridge`（HEAD `cf5e79e9`，2026-05-17）。

| 项 | 内容 |
| --- | --- |
| 经典版许可证 | MIT，Copyright 2025-2026 OpenCut |
| 本仓库许可证 | MIT，Copyright 2026 OpenCut |
| 迁移范围 | 4 个 `time` 源文件、1 个 `bridge` 源文件及其 11 个内联单元测试 |
| 改动 | crate 改名（`time`→`ocx-time`、`bridge`→`ocx-bridge`）；`use bridge::export` → `use ocx_bridge::export`；`default = []` 显式关闭 `wasm` feature；路径依赖改为本地相对路径 |
| 未改动 | 算法实现、公开 API、单元测试断言（仅经 `cargo fmt` 统一格式） |
| 新增 | `tests/fixtures/media_time_cases.json`（40 个用例）、`tests/golden_master.rs`、`tests/CASES.md`、`moon.yml`、`NOTICE.md` |

按 MIT 许可证要求保留上述原版权声明。本目录是 `roadmap/COMPAT.md` 约定的**隔离命名空间**，用于避免与上游未来落地的 `crates/*` 冲突；所有本地代码只通过 `editor-api` 适配层被消费。

**追加（W-05）**：`ocx-domain/src/ripple.rs` 与 `ocx-domain/tests/ripple-reference.mjs` 是对经典版 `apps/web/src/ripple/{diff,shift,apply}.ts` 的逐函数翻译（MIT © 2025-2026 OpenCut），原版权声明同样保留。改动：时间单位由浮点秒改为 `MediaTime` 整数 ticks（120000 ticks/秒，线性换算不改变算法语义）、加减法改为饱和运算防止 i64 极值溢出、按 Rust 所有权模型改写集合遍历。算法分支、`Map` 覆盖语义、轨道顺序 `overlay → main → audio`、调整按 `afterTime` 降序应用等均保持原样，并由 `tests/CASES.md` 的 18 个 JSON 用例固定。

**追加（W-05 第二批）**：`ocx-domain/src/placement.rs` 与 `ocx-domain/tests/placement-reference.mjs` 是对经典版 `apps/web/src/timeline/placement/{compatibility,overlap,main-track,insert-index,resolve}.ts` 的逐函数翻译（MIT © 2025-2026 OpenCut），原版权声明同样保留。改动：轨道字段由 `type` 改为 additive-only 的 `trackType`（默认值在序列化时省略，使第一批 ripple 用例保持兼容）；时间单位同样改为 ticks；负/越界索引按经典版 `undefined` 语义处理。`apply.ts` 依赖随机 UUID 与轨道工厂，属于 IO 层，本批未翻译。29 个用例与分支行为由 `tests/PLACEMENT_CASES.md` 固定。

**追加（W-05 第三批）**：`ocx-domain/src/animation.rs` 与 `ocx-domain/tests/animation-reference.mjs` 是对经典版 `apps/web/src/animation/{bezier,interpolation}.ts` 的逐函数翻译（MIT © 2025-2026 OpenCut），原版权声明同样保留。改动：时间单位改为整数 ticks；贝塞尔求解保留 20 次二分的固有精度（跨语言按 1e-5 容差比较）；`AnimationChannel` 用 serde untagged 按数值类型判别标量/离散通道，等价于经典版 `isScalarChannel` 的结构判别。`keyframe-query.ts` 依赖 `channel-data.ts` 与 `params` 颜色格式化，本批未翻译。25 个用例由 `tests/ANIMATION_CASES.md` 固定。

**追加（W-06）**：`local/crates/ocx-bindings-wasm/`、`apps/web/src/local/editor-adapter.ts`、`editor-wasm.contract.mjs` 及 `apps/web/src/routes/editor.tsx` 的本地新增内容为新写实现（非经典版代码迁移），沿用本仓库 MIT 声明；`apps/web/src/local/wasm/` 下的 JS 与 `.d.ts` 由 `wasm-bindgen` 从本地 crate 生成，不是第三方拷贝。经典版 MIT © 2025-2026 声明仍由上文保留。`/editor` 原为上游 "Coming soon." 占位路由（TanStack Start 要求路由文件位于该目录），本次就地扩展；上游同步时需人工复核这一处改动。

**追加（W-07）**：`local/crates/ocx-render/` 与 `apps/web/src/local/webcodecs.ts` 为本地新写实现（非经典版代码迁移），沿用本仓库 MIT 声明。`RenderFrame` / `ExportProfile` 是按 `PRIORITY.md` §4 定义的新契约，未拷贝经典版 `services/renderer/*` 的渲染节点或导出实现。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-05 第四批）**：`ocx-domain/src/keyframe_query.rs` 与 `tests/legacy-reference.mjs` 是对经典版 `apps/web/src/animation/{keyframe-query,channel-data,path}.ts` 及 `params/index.ts` 中 `formatLinearRgba` 的逐函数翻译（MIT © 2025-2026 OpenCut），原版权声明同样保留。`project_compat.rs` 是按经典版 `project/types.ts`、`storage/types.ts` 与 `migrations/AGENTS.md` 的 additive-only 规则新写的**只读消费视图**，未拷贝经典版持久化实现。`apps/web/public/fixtures/classic-project-v31.json` 为按该 schema 构造的示例数据，不是用户真实项目。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-07 第二批）**：新增前端依赖 `mp4-muxer@5.2.2`（MIT，纯 TypeScript 的 MP4 封装库），仅用于把 `VideoEncoder` 输出的 H.264 chunk 封装为 MP4；`apps/web/src/local/export.ts` 与交互式编辑器逻辑为本地新写实现。经典版 `services/renderer/scene-exporter.ts` 使用 `mediabunny`，本实现未拷贝其代码。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-08 第一批）**：`apps/web/src/local/media.ts`、`ocx-render/src/frame.rs` 的 `composite_frame`、`ocx-bindings-wasm` 的 `composite_frame_rgba` 均为本地新写实现，未拷贝经典版 `services/renderer/*` 或 `mediabunny` 的解码/合成代码；真实视频解码使用浏览器原生 `<video>` + canvas，未新增第三方解码依赖。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-08 第二批）**：`apps/web/src/local/timeline.ts` 的片段→素材帧映射与分割逻辑为本地新写实现；`project_compat.rs` 仅按经典版 `project/types.ts` 已存在的可选字段 `trimStart`/`trimEnd` 做只读提取（additive-only，缺省补 0、不记 warning），未拷贝经典版渲染或时间轴实现。`apps/web/public/fixtures/classic-project-v31.json` 为示例数据，其中 `clip-body.trimStart` 设为 `120000` 仅用于演示两个片段引用同一素材的不同区间。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-08 第三批）**：`apps/web/src/local/audio.ts` 的音频解码/编码辅助与时间轴重排为本地新写实现；AAC codec 字符串 `mp4a.40.2` 与「导出前 `AudioEncoder.isConfigSupported` 探测」遵循 `PRIORITY.md` §4.5 的既有约定，未拷贝经典版导出器代码。演示音源为程序生成的 440Hz 正弦波，不含第三方音频素材。经典版 MIT © 2025-2026 声明仍由上文保留。
