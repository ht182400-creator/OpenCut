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

**追加（W-09 第一批）**：`apps/web/src/local/frame-cache.ts` 与缓存接入逻辑为本地新写实现，未引入第三方缓存库，也未拷贝 Olive / Kdenlive / OpenShot 的代理剪辑实现（仅参考 `HOTSPOTS.md` 记录的调研结论）。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-09 第二批）**：`apps/web/src/local/frame-store.ts` 与三级缓存接入逻辑为本地新写实现，使用浏览器原生 IndexedDB，未引入第三方持久化/缓存库；代理 MP4 复用本仓库已有的 `mp4-muxer` 与 `export.ts` 编码链路，未拷贝 Olive / Kdenlive / OpenShot 的代理剪辑实现。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-10 第一批）**：`local/crates/ocx-io/` 为本地新写实现，按 OpenTimelineIO 公开 JSON schema 的核心子集构造数据模型，未引入 `otio-rs` / `oximedia-edl` / `quercus-otio` 等第三方库代码，也未链接 OTIO C++ 运行时；`metadata.opencut` 是本仓库自有命名空间，不改动 OTIO 标准字段。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-10 第二批）**：`apps/web/src/local/timeline.ts` 的 OTIO 桥接（clips ↔ EditTimeline 视图）为本地新写实现，仅调用本仓库 `ocx-io` 的 WASM 入口，未引入第三方 OTIO 库；`/editor` 的导入/导出按钮只做文件读取与下载封装。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-08 第四批）**：`trimClipInAt` / `trimClipOutAt` / `moveClipBy` 与 `TimelineSection` 为本地新写实现，未拷贝 Olive / Kdenlive / OpenShot 的裁剪/拖拽交互代码；head-trim 语义为行业标准概念。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-08 第五批）**：`Timeline` 的鼠标拖拽（原生 mouse 事件与本地预览）、`moveClipClamped` 的重叠夹取均为本地新写实现，未拷贝第三方 NLE 的拖拽交互代码；未引入新的前端依赖。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-08 第六批）**：`Timeline` 的左右边缘把手与 `resizeClipEdge` 的时长/素材入点换算为本地新写实现，未拷贝 Olive / Kdenlive / OpenShot 的边缘裁剪交互代码；未引入新的前端依赖。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-09 第三批）**：`apps/web/src/local/clip-history.ts` 的版本快照纯函数与撤销/重做 hook、`ToolbarSection` 为本地新写实现，未拷贝 Olive 的版本快照或第三方撤销栈实现；未引入新的前端依赖。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-09 第四批）**：`apps/web/src/local/scrub-benchmark.ts` 的基准测量、`createBenchmarkVideoFile` 的 4K 灰底白块素材与历史 localStorage 持久化均为本地新写实现；`avc1.640033` 为 H.264 High Profile Level 5.1 的标准 codec 字符串，不含第三方库代码；演示素材为程序生成，不含第三方音视频内容。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-10 第三批）**：`ocx-io` 对官方 `Clip.2` 的兼容逻辑、`third_party_roundtrip.py` / `.test.mjs` 跨工具脚本为本地新写实现；`opentimelineio 0.18.1` 仅作为**可选验证依赖**在临时目录安装（未提交、未加入项目依赖），用于生成与校验实文件，其代码未被拷贝进本仓库；静态 fixture 由该工具生成，仅含程序指定的示例剪辑数据。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-11 第一批）**：`ocx-editor-api` 的版本化字段、能力协商模块与跨语言契约 v2 均为本地新写实现，未引入第三方协商库，也未拷贝 MCP / 插件框架的协商代码（`discover` 仅对齐其公开设计思路）。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-07 第三批）**：MP4/WebM 双容器的编码编排为本地新写实现；为满足 W-07 DoD 的 WebM 容器封装，新增 `webm-muxer@5.1.4`（与既有 `mp4-muxer` 同作者，浏览器端 muxer 库，非 NLE 编辑器代码），未引入 FFmpeg / WebAssembly 编码运行时，也未拷贝经典版导出实现。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-05 第五批）**：`write_classic_project` 的按 id 合并与未知字段保留逻辑为本地新写实现，仅依据 `HOTSPOTS.md` 记录的经典版 v31 项目 JSON 结构（additive-only 约定），未拷贝经典版的存储 / migrations 代码，也未引入新依赖；写回产物仍是经典版自有格式。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-10 第四批）**：`ocx-io` 的 Transition / Marker 导入导出与 `third_party_roundtrip.py make2` 为本地新写实现，仅按 OpenTimelineIO 公开 JSON schema 构造数据；`opentimelineio 0.18.1` 仅作为可选验证依赖临时安装（未提交、未加入项目依赖），其代码未拷贝进本仓库；静态 fixture 由该工具生成，只含程序指定的示例剪辑数据。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-10 第五批）**：`EditClip.effects` / `EditTimeline.nestedStacks` 的原始节点保真与 `merge_nested_children` 位置还原、`third_party_roundtrip.py make3` 均为本地新写实现，仅按 OpenTimelineIO 公开 JSON schema 保留数据，未拷贝其 effects/Composition 实现代码；`opentimelineio 0.18.1` 仍只是临时可选验证依赖（未提交、未加入项目依赖），静态 fixture 由该工具生成且只含程序指定的示例剪辑数据。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-10 第六批 / W-07 第四批）**：`read_markers` / `marker_nodes` 四层标记 helper、`make4` 脚本、AV1 WebM 容器分支与 `exportProjectToAv1WebM` 均为本地新写实现；`V_AV1` / `av01.0.04M.08` 是 Matroska / AV1 的标准 codec 标识，不含第三方实现代码；`webm-muxer@5.1.4` 与既有 `mp4-muxer` 为已记录的浏览器端 muxer 依赖，本批未新增依赖。官方 `opentimelineio 0.18.1` 仍只是临时可选验证依赖（未提交、未加入项目依赖）。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-12 第一批）**：`local/crates/ocx-plugin-host` 的 manifest 模型、稳定错误码、权限校验与处理器分派均为本地新写实现，未引入 Extism / WASI / WIT 运行时或第三方插件框架代码，也未拷贝 MCP / 经典版插件系统实现；仅复用本仓库 W-11 的能力协商纯函数。示例插件 manifest 与处理器为程序指定数据，不含第三方内容。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-12 第二批）**：`ocx-plugin-sample` 示例插件、`(ptr,len) → i64` 内存 ABI 与 `plugin-runtime.ts` 运行时均为本地新写实现；运行时只使用 Web 标准 `WebAssembly` API（浏览器与 Node 原生提供），未引入 Extism / WASI / WIT 或任何第三方插件框架；提交的 `sample-plugin.wasm` 为本仓库源码编译产物，只含程序指定的纯计算逻辑。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-13 第一批）**：`apps/local-mcp` 的 MCP 协议实现（initialize / tools/list / tools/call，JSON-RPC 2.0 over stdio）为本地新写实现，未使用 MCP 官方 SDK 或第三方框架；工具实现仅调用本仓库 core 的 WASM 产物，`ocx.render.*` 的 SHA-256 指纹使用 Node 内置 `crypto`。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（W-13 第二批）**：`apps/local-cli` 的参数解析、PPM（P6）编码与 FNV 指纹输出均为本地新写实现（PPM 为 Netpbm 公开格式），未引入图像编码库或 CLI 框架；帧渲染复用本仓库 `ocx-render` 的同一实现，与 WASM core 像素一致。经典版 MIT © 2025-2026 声明仍由上文保留。

**追加（经典版 UI 像素级 1:1 改造 · 批 0）**：用户于 2026-11-14 明确指示进行像素级 1:1 改造，因此本阶段起允许复制经典版 `E:\AI_Studio\opencut-classic` 的样式值、图标与字体资源，此前「零 UI 依赖 / 不拷贝经典版前端代码」的隔离策略在 UI 视觉层相应调整（组件逻辑仍为本地重写，不拷贝 Next.js 服务端与状态库实现）。批 0 从 `apps/web/src/app/globals.css` 复制了 `:root` / `.dark` / `.panel` / `.dark .panel` 的 CSS 变量值、`@theme inline` 的圆角/字号/断点 token，以及 `scrollbar-*` utility 的等价实现，存放于 `apps/web/src/local/classic-ui/theme.css`；`tokens.ts` 记录 `PANEL_CONFIG` 与 `EditorLayout` 的尺寸值。经典版为 MIT 许可（见该目录 `LICENSE`），其 MIT © 2025-2026 声明由本文件继续保留；后续每批复制的资源在本节逐项登记。字体使用本工程已安装的 `@fontsource-variable/inter`（OFL），未复制经典版 `public/fonts/` 图集（留待文字元素批次处理）。

**追加（经典版 UI 像素级 1:1 改造 · 批 1）**：从经典版 `app/editor/[project_id]/page.tsx`（EditorLayout）、`components/editor/editor-header.tsx`、`components/editor/panels/assets/*`、`app/globals.css` 复制了主框架的**尺寸与视觉值**：五面板默认比例与 min/max、垂直/水平 gap 与水平内边距、顶栏高度/内边距、面板 `.panel` 作用域与圆角/边框、竖排 9 个 tab 的顺序与图标位置、按钮/输入/菜单的配色与圆角规则；图标为按经典版同位置形状本地绘制的 SVG（未复制图标包资源）。React 组件逻辑、可调整面板实现（使用本工程已装的 `react-resizable-panels@4`）、主题切换与状态管理均为本地重写，未拷贝经典版组件源码。经典版 MIT © 2025-2026 声明继续保留。

**追加（经典版 UI 像素级 1:1 改造 · 批 2）**：从经典版 `apps/web/src/timeline/` 的 `components/{layout,track-layout,theme,layers,interaction}.ts`、`scale.ts`、`pixel-utils.ts`、`zoom-utils.ts`、`ruler-utils.ts`、`components/{index,timeline-ruler,timeline-playhead,snap-indicator,timeline-element}.tsx` 复制了时间轴的**尺寸与视觉值**：轨道高度（video 65/text 25/audio 50）、轨道间距 6、轨道头列宽 112、ruler 22、书签行 16、播放头/吸附线宽 2、层级（trackContent 10/dragLine 20/playhead 30/snapIndicator 40）、元素主题色（text `#5DBAA0`、audio `#8F5DBA`、graphic `#BA5D7A`、effect `#5d93ba`）、缩放基准 50px/s 与上下限（0.1~100）、按钮倍率 1.7、滚轮步长 40、标尺间隔候选与最小间距（120/18px）、尾部留白比例（0.75/0.15/0.2）、选中描边 1.5px、书签色 `#009dff`。这些值固化在 `apps/web/src/local/classic-ui/timeline-tokens.ts`，由 `timeline-tokens.test.ts` 在经典版源码可用时逐项比对。图标（视频/文字/音频/静音/隐藏/吸附/缩放/分割/删除等）为按经典版同位置形状本地绘制的 SVG（未复制 `@hugeicons/*` 图标包资源）。React 组件逻辑（三轨适配、拖拽/裁剪/seek/缩放、吸附计算）为本地重写，复用本仓库既有 `snapTicks` 纯函数，未拷贝经典版 zustand store、Next.js 组件源码或交互 hook。经典版 MIT © 2025-2026 声明继续保留。

**追加（经典版 UI 像素级 1:1 改造 · 批 3）**：从经典版 `apps/web/src/components/editor/panels/assets/` 的 `assets-panel-store.tsx`、`tabbar.tsx`、`views/base-panel.tsx`、`views/assets.tsx`、`views/draggable-item.tsx` 及 `views/{text,stickers,sounds,effects,subtitles,settings}/`、`../../timeline/drag-source.ts` 复制了素材面板的**尺寸与视觉值**：tab 32×32 / gap 2 / padding 4、PanelView 头 44px（pl-3 pr-2）、滚动区 pt-2 8px、内容 px-2 8px、Media 网格列宽 7rem=112px / gap-4=16px / 列表 gap-1.5=6px、卡片内层 gap-1=4px、名称字号 0.7rem=11.2px 与截断规则、时长徽标 `right-1 bottom-1` + `bg-black/70`、hover 加号 size-5=20px、拖拽浮层 w-[80px] / z-9999 / 偏移 40px、效果网格 minmax(96px,1fr)、贴纸网格 minmax(80px,140px)、九 tab 顺序与英文文案、拖入时间轴 MIME `application/x-timeline-drag`、coming soon 英文文案。这些值固化在 `apps/web/src/local/classic-ui/assets-tokens.ts`，由 `assets-tokens.test.ts` 在经典版源码可用时逐项比对。图标（媒体/声音/文字/贴纸/效果/转场/字幕/调整/设置与缩略图占位）为按经典版同位置形状本地绘制的 SVG（未复制 `@hugeicons/*` 图标包资源）。React 组件逻辑（素材列表接线、卡片渲染、dataTransfer 载荷、搜索/空态骨架）为本地重写，未拷贝经典版 zustand store、Next.js 组件源码或上传/转写服务代码；真实贴纸/声音/效果数据源与新增元素到时间轴的能力属批 7 core 扩展，UI 明确标注占位。经典版 MIT © 2025-2026 声明继续保留。

**追加（经典版 UI 像素级 1:1 改造 · 批 4）**：从经典版 `apps/web/src/components/editor/panels/properties/` 的 `index.tsx`、`empty-view.tsx`、`registry.tsx`、`components/{element-params-tab,keyframe-toggle,section,property-param-field}.tsx`、`components/ui/number-field.tsx` 及 `apps/web/src/params/registry.ts` 复制了属性面板的**尺寸、文案与参数注册表值**：tab 32×32 / gap 2 / padding 4、空状态 gap-3(12px)/文本 gap-2(8px)/p-4(16px) 与文案 `It's empty here` + `Click an element on the timeline to edit its properties`、多选文案 `{n} elements selected.0`（含经典版字面量 `.0`）、SectionContent 16px / 字段组 gap-3.5(14px) / 字段内 gap-2(8px) / label 行 h-4(16px) / gap-1.5(6px)、NumberField h-7(28px) / 14px 图标 / SUFFIX_GAP_PX=6、关键帧菱形 svg size-3.5(14px) 与 title 模板 `Toggle {label} keyframe`、transform/blending/audio/text 全部参数键（position/scale/rotate/opacity/blendMode/volume/muted/content/font*/background.*）、默认值与 min/max/step/options（blendMode 17 项）、按类型 tab 列表（text/video/image/sticker/graphic/audio/effect）与默认 tab、参数集组合、数值约束（MIN_TRANSFORM_SCALE=0.01、VOLUME_DB -60~20、CORNER_RADIUS 0~100）。这些值固化在 `apps/web/src/local/classic-ui/properties-tokens.ts`，由 `properties-tokens.test.ts` 在经典版源码可用时逐项比对。图标（tab 的 transform/blending/audio/speed/text/effects/masks/graphic 与空状态齿轮、关键帧菱形）为按经典版同位置形状本地绘制的 SVG（未复制 `@hugeicons/*` 图标包资源）。React 组件逻辑（三状态分支、按类型 tab、参数字段渲染、关键帧本地开关）为本地重写，未拷贝经典版 zustand store、Next.js 组件源码或 `use-property-draft` 表达式求值；transform/text/volume 等参数因 core 无存储能力为只读占位（属批 7），工程真实可编辑的时间字段置于专属 Timing tab（经典版无此 tab，差异登记）。经典版 MIT © 2025-2026 声明继续保留。

**追加（经典版 UI 像素级 1:1 改造 · 批 5）**：从经典版 `apps/web/src/preview/` 的 `zoom.ts`、`preview-snap.ts`、`components/{handle-primitives,snap-guides,element-bounds,index,toolbar,editable-timecode,transform-handles,preview-viewport}.tsx` 复制了预览交互的**尺寸与视觉值**：缩放预设 25/50/75/100/150/200%、范围 0.25~16、步进 ×1.25、fit/actual-size epsilon、手柄尺寸 10px / 命中区 18px / 旋转钮半径 10px / 边手柄 6×14 / 旋转手柄偏移 24px、吸附阈值 8px / 旋转吸附 90°/5°、选框描边 white 0.75 1px、参考线 1px 白 70%、视口 padding 8px（底 0）、控制条 pt-5 pb-3 px-5 / gap 10px / icon 按钮 28px、时间码 HH:MM:SS:FF、resize 光标角度映射。这些值固化在 `apps/web/src/local/classic-ui/preview-tokens.ts`，由 `preview-tokens.test.ts` 在经典版源码可用时逐项比对。图标（播放/全屏/旋转）为按经典版同位置形状本地绘制的 SVG（未复制 `@hugeicons/*` 图标包资源）。React 组件逻辑（视口/选框/手柄拖拽/吸附/缩放/控制条）为本地重写，未拷贝经典版 zustand store、Next.js 组件源码或画布渲染引擎；选框/手柄/参考线因 core 无元素 transform 存储为视觉叠加 + 本地交互（属批 7），不伪装已变换画面。经典版 MIT © 2025-2026 声明继续保留。

**追加（经典版 UI 像素级 1:1 改造 · 批 6）**：从经典版 `apps/web/src/actions/definitions.ts`、`actions/components/shortcuts-dialog.tsx`、`components/ui/{dialog,button,context-menu}.tsx`、`components/editor/export-button.tsx`、`preview/components/context-menu.tsx`、`actions/keybindings-store.ts` 复制了命令/对话框的**尺寸、文案与命令注册表**：Dialog 遮罩 z-250/black10/blur、容器 max-w-lg(512px)、Header/Body p-6(24px)、Footer py-5(20px)/gap-3(12px)；ShortcutsDialog max-w-2xl(672px)/max-h-80vh、8 分类（playback/navigation/editing/selection/history/timeline/controls/assets）、24+ 动作与默认快捷键（space/k/s/ctrl+z 等）、组间距 24px/组内 4px、badge h-7(28px)/px-2.5(10px)/rounded-sm、文案 `Keyboard shortcuts` / `Reset to default` / `Press any key combination...` / `Click to edit shortcut`；导出 Popover w-80(320px)/Format·Quality·Audio 组与选项文案；右键菜单 min-w-48(192px)/预览 w-56(224px)/项 px-3 py-1.5；localStorage key `opencut-keybindings`；Mac 快捷键显示映射（ctrl→Cmd、alt→Option、方向键→箭头）。这些值固化在 `apps/web/src/local/classic-ui/commands-tokens.ts`，由 `commands-tokens.test.ts` 在经典版源码可用时逐项比对。重要事实：经典版**没有**命令面板（Command Palette / Ctrl+K），本批不虚构该组件，仅实现最接近的 ShortcutsDialog。React 组件逻辑（Dialog 外壳、分类分组、badge 录制/持久化/Reset）为本地重写，未拷贝经典版 zustand store、Next.js 组件源码或 Radix 依赖；本工程仅 9 个快捷键实际接入，其余 badge disabled 占位；自定义键位持久化但不绑定到动作分发（属批 7）。经典版 MIT © 2025-2026 声明继续保留。

**追加（core 扩展 · 批 7.1 元素类型字段保真）**：本批只改 Rust core 数据模型（`ocx-domain`），未复制经典版任何样式值、字体或图标资源。`ElementView` 新增的 name/mediaId/content/params 字段名与语义来自经典版项目 JSON schema（fixture `classic-project-v31.json` 中已有这些字段），`ElementType::Caption` 与 text 轨映射沿用经典版元素类型语义。经典版 MIT © 2025-2026 声明继续保留。

**追加（core 扩展 · 批 7.2 可变分辨率）**：本批为 TS 侧分辨率可配置的本地新写实现（`resolution.ts` 预设与纯函数、`editor-ui.tsx`/`editor.tsx`/`preview-section.tsx` 的宽高贯穿、`blankFrame` 与 canvas 参数化、Settings tab 分辨率下拉），未复制经典版任何样式值、字体或图标资源，也未引入第三方依赖。三档预设（320×180/640×360/1280×720）为本工程按 16:9 与 WebCodecs 正偶数约束自行选定；core 的宽高参数化（`composite_frame`/`render_frame`）沿用本仓库既有实现，未改动 Rust 代码与 WASM 产物。经典版 MIT © 2025-2026 声明继续保留。

**追加（core 扩展 · 批 7.3 波形抽样）**：`ocx-render/src/waveform.rs` 的 PCM→峰值纯函数、WASM `waveform_peaks_from_pcm`、TS `mixdownToMono` 与时间轴 `.classic-timeline-waveform` 竖条渲染均为本地新写实现，未复制经典版任何样式值、字体或图标资源，也未引入第三方依赖；波形条样式为本工程自行设计（白色半透明竖条、按峰值映射高度），非经典版波形组件拷贝。PCM 经浏览器 Web Audio 解码为本仓库自有 `PcmAudio` 数据，降混与峰值算法为确定性自实现。经典版 MIT © 2025-2026 声明继续保留。

**追加（core 扩展 · 批 7.4 帧缩略图）**：`ocx-render/src/thumbnail.rs` 的 RGBA box filter 下采样纯函数、WASM `thumbnail_rgba`、TS `thumbnail.ts`（LRU 缓存与 canvas data URL 转换）、素材卡与时间轴 `.classic-timeline-thumbnail` 渲染均为本地新写实现，未复制经典版任何样式值、字体或图标资源，也未引入第三方依赖；缩略图尺寸（112×63）与样式为本工程自行选定/设计，非经典版缩略图组件拷贝。缩略图数据来自本仓库已解码的代理帧经 core 确定性下采样生成，非经典版素材。经典版 MIT © 2025-2026 声明继续保留。

**追加（core 扩展 · 批 7.5 项目格式写回接线，批 7 收官）**：TS `project-write.ts` 的 view 合并纯函数与写回下载封装、属性面板 Name/Content 输入、`project_write.rs` 新增往返用例、WASM 契约新增检查均为本地新写实现，未复制经典版任何样式值、字体或图标资源，也未引入第三方依赖；写回逻辑沿用本仓库 7.1 已有的 additive-only core 实现（`write_classic_project`），未改动经典版文件格式 schema 或字段语义。经典版 MIT © 2025-2026 声明继续保留。

**追加（批 8 全量对齐与移动端 gate，UI 改造收官）**：`classic-ui/mobile-gate.tsx` 为本地新写实现，仅按经典版公开可见的文案、断点（1024px）与交互逻辑做对照复刻，未拷贝经典版 React/zustand 源码、样式表、字体或图标文件，也未引入第三方依赖；门禁的箭头符号、圆角/间距 token 均为本工程自有绘制。批 8 的并排截图与 computed style 比对仅用于验证布局尺寸一致性，未将经典版任何资源文件复制进本仓库。经典版 MIT © 2025-2026 声明继续保留。

**追加（批 8 补丁 · 演示色块分层）**：`apps/web/src/local/frame-source.ts` 的验证模式判定与帧源决策纯函数为本地新写实现，仅用于把本仓库 `ocx-render` 的确定性演示帧（W-07 程序化色块）与正式 UI 画面分层，未复制经典版任何样式值、字体、图标或渲染代码，也未引入第三方依赖；`?verifyDemoFrame=1` 验证开关为工程自有约定，经典版无此机制。core 帧渲染契约与 golden master 未改动。经典版 MIT © 2025-2026 声明继续保留。
