# 功能对照清单：经典版 vs 本版本（UI 操作闭环）

> 建立：2026-11-17。用户质疑「只是占位，用 Rust 实现和迁移有什么意义」后要求产出完整清单；随后确认口径为「聚焦 UI 闭环能力」。
> 本文只描述**事实状态**，不为任何实现辩护。所有条目均可按证据复核。

## 0. 范围与口径（2026-11-17 调整后）

- **对照范围**：只列「用户在编辑器 UI 能触发并看到结果」的功能。判定标准是**能否完成一个操作闭环**：从用户动作 → 状态变化 → 可见结果（画面/时间轴/文件）全程真实。
- **工程侧能力不参与对照**：Rust core 契约、golden 用例、MCP、Headless CLI、插件运行时、OTIO/PNG/WAV 等，单列到 §8「工程侧能力」，**不计入视觉 1:1 对照，也不计入统计**。理由：这些能力没有 UI 入口，用户在本版本页面上感知不到，不能拿来抵消 UI 缺口。
- **状态定义**（收紧后）：
  - `✅ 已实现`：UI 操作有真实闭环，且有测试或浏览器验收证据。细节简化但闭环完整仍记 ✅（备注写明简化点）。
  - `🟡 部分闭环`：主闭环真实，但关键子步骤缺失（如能导出但无取消、能撤销但只覆盖部分操作）。
  - `🔴 占位`：UI 可见/可点，但不产生真实结果，或只改本地视觉状态/提示文案。
  - `⚪ 未覆盖`：本版本没有该 UI 入口；或经典版本身即 coming soon/disabled，双方都不提供闭环。
- **视觉 1:1 已达成**（8 批改造 + 批 8 并排截图），本清单不重复论证视觉，只评能力闭环。见 `UI_REPLICA_PLAN.md` §3。
- **重要纠偏**：此前把「不能新增元素」归因于「core 不支持」是**错的**。经典版实证（附录 A）表明新增文字是纯前端编辑器逻辑（命令模式 + placement + undo），不依赖 Rust core。缺的是编辑器应用层。

## 1. 顶层导航 / 项目

| 功能 | 经典版 | 本版本 | 状态 | 本版本证据 / 判定依据 |
| --- | --- | --- | --- | --- |
| 正式入口 `/` | `/editor/{id}` + 项目列表 | `/` 渲染编辑器，`/editor` 兼容 | ✅ | `routes/index.tsx` 复用 Editor |
| 主题切换（亮/暗） | 真实 | 真实 | ✅ | `classic-ui/theme.css` + 顶栏按钮 |
| 顶栏导出按钮 | 真实 Popover | 真实（settings + 顶栏一键导出） | ✅ | `handleExport` 真导出 MP4 下载 |
| 快捷键帮助对话框 | 真实（8 分类/31 动作） | 对话框可开、可录制、可 Reset、冲突提示 | ✅ | P3 批 2：录制经 `shortcut-bindings.ts` 打通分发，冲突键拒绝覆盖，未实现动作诚实标注 disabled（如 seek j/l）；`oc-p3-keybinding.png` |
| 项目名就地重命名 | 真实 | 无 | ⚪ | — |
| 项目列表（新建/打开/搜索/排序/批量删除） | 真实 | 无 | ⚪ | — |
| 反馈 / Onboarding / Changelog / Discord 外链 | 真实 | 无 | ⚪ | — |
| 移动端拦截 | 真实 | 真实 | ✅ | `mobile-gate.tsx`，800px 浏览器验收 |
| GPU 降级横幅 | 真实 | 无 | ⚪ | — |
| 显式保存按钮 | 经典版无（自动保存） | 无（改手动「写回经典版 JSON」下载，归 §8） | ⚪ | — |

## 2. 素材面板九 tab

| Tab / 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| Media：导入视频/音频 | 真实 | 真实（JSON 项目 + 真实音视频解码） | ✅ | `editor.tsx` 导入 + `media.ts` |
| Media：网格卡片/时长/名称/排序 | 真实 | 真实（网格/缩略图/名称，无排序） | 🟡 | `assets-panel.tsx`；排序无 |
| Media：真实帧缩略图 | 真实 | 真实（批 7.4） | ✅ | `thumbnail.ts` + core `thumbnail_rgba` |
| Media：卡片 + / 拖拽加入时间轴 | 真实 | 真实（点击 + 拖放均插入，自动找空位 + undo） | ✅ | P0：`element-model.ts` + `handleAddAsset` + 时间轴 `onDropAsset`，浏览器验收 |
| 视频卡片预览播放 | 真实 | 无 | ⚪ | — |
| Sounds：音效库/搜索/试听/收藏 | 真实 | 搜索框 + coming soon 文案 | 🔴 | UI 骨架无数据层 |
| Text：Default text 加入时间轴 | 真实 | 真实（插入 text 元素 + 属性面板编辑 + 预览渲染） | ✅ | P0：用户实测起点已闭环，`oc-p0-text-preview.png` 截图验收 |
| Stickers：分类/搜索/添加 | 真实 | 搜索框 + 骨架 | 🔴 | 无贴纸数据源 |
| Effects：效果网格/预览/添加 | 真实 | 骨架 | 🔴 | 无效果注册表 |
| Transitions | 经典版 coming soon | coming soon | ⚪ | 双方均无闭环 |
| Captions：AI 字幕生成 | 真实（本地转写模型） | 无 | ⚪ | 需转写服务/模型 |
| Captions：SRT/ASS 导入 | 真实 | 无 | ⚪ | — |
| Adjustment | 经典版 coming soon | coming soon | ⚪ | 双方均无闭环 |
| Settings：FPS / 宽高比 / 背景 | 真实 | 仅分辨率 3 档可切（非经典版同款），无背景设置 | 🔴 | `resolution.ts`；经典版闭环未达成 |

## 3. 时间轴

| 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| 三轨结构（overlay/main/audio） | 真实（可动态建 text/graphic/effect 子轨） | 三轨展示，无动态子轨 | 🟡 | 视觉与选中真实，结构固定 |
| 轨道头静音/隐藏 | 真实 | 本地视觉状态，不写回项目 | 🔴 | `UI_REPLICA_PLAN.md` §7 批 2 |
| 片段选中/点击联动属性 | 真实 | 真实 | ✅ | 批 4 浏览器验收 |
| 片段移动/resize/trim（main 轨） | 真实 | 真实（core 契约） | ✅ | `moveClipClamped`/`resizeClipEdge` |
| overlay/audio 轨编辑 | 真实（全轨） | 只读展示（点击可选中，不能编辑） | 🔴 | core 编辑契约只覆盖 main |
| Split / Split left / right | 真实 | 真实（main 轨，工具栏） | ✅ | — |
| Duplicate / Delete | 真实 | Delete 真实；Duplicate 真实（Ctrl+D / 工具栏） | ✅ | P1：`element-operations.ts` `duplicateElements`，浏览器验收 4→6 片段 |
| 多选 / 框选 / Shift 加选 | 真实 | Cmd/Ctrl 加选 + Shift 区间 + Ctrl+A 全选 + 空白拖框选（Shift 加框） | ✅ | P1：`use-selection.ts` 多选 + P2 长尾批：`timeline.tsx` 框选橡皮筋（`selectFromBox`/`normalizeTimelineRect`/`rectsIntersect`），浏览器验收框选 clip-intro+clip-body 高亮，`oc-p3-marquee.png` |
| 拖拽素材落入时间轴 | 真实 | 真实（落点 ticks 换算 + 插入） | ✅ | P0：`timeline.tsx` onDrop → `handleTimelineDrop`，浏览器验收 |
| 复制 / 粘贴片段 | 真实 | 真实（Ctrl+C/V 内存剪贴板） | ✅ | P1：`element-operations.ts` `copyElements`/`pasteElements`，浏览器验收 6→8 片段 |
| Ripple editing 开关 | 真实 | 无（core 有契约但 UI 未接） | ⚪ | — |
| 关键帧显示/拖动/曲线编辑器 | 真实 | 真实动画轨道 + 可视化 SVG 曲线（拖动改值/双击加点/右键删点/缓动切换） | ✅ | P2 关键帧模型 + P3 批 3 `curve-editor.tsx`/`curve-editor-model.ts`，浏览器验收拖动改 time/value，`oc-p3-curve-editor.png` |
| 书签（增删改/拖动/备注） | 真实 | 16px 行占位，无数据 | 🔴 | `ProjectView` 无 bookmarks |
| 缩放（按钮/滑杆/ctrl-wheel） | 真实 | 真实 | ✅ | 批 2 验收 |
| seek（标尺点击/播放头拖动） | 真实 | 真实 | ✅ | 批 2 验收 |
| 场景切换/删除 | 真实 | 无（单场景 fixture） | ⚪ | — |
| 音频波形 | 真实 | 真实（批 7.3 + 超长素材降采样修复） | ✅ | `downsampleForWaveform` |

## 4. 预览

| 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| 播放 / 暂停 | 真实 | 真实 | ✅ | 时间码推进已验收 |
| 时间码 HH:MM:SS:FF | 可编辑并驱动 seek | 只读显示 | 🔴 | 编辑闭环缺失 |
| 缩放预设 + Fit + 全屏 | 真实 | 真实 | ✅ | 批 5 验收 |
| 选框/手柄/对齐参考线 | 真实（改 transform） | 视觉叠加 + 本地拖拽，不改 core 画面 | 🔴 | §7 批 5 |
| 遮罩手柄 | 真实 | P2：矩形遮罩参数（mask.*）经属性面板可编辑 + 像素裁剪生效；无可视化拖拽手柄 | 🟡 | P2：`element-composite.ts` `applyVisualEffects`，曲线/手柄归 P2 长尾 |
| 双击文字就地编辑 | 真实 | 无 | ⚪ | 依赖文字元素可编辑 |
| 画面合成 | 真实（canvas renderer） | 真实（core `composite_frame` + 真实素材帧） | ✅ | 批 7 + 正式模式去演示色块 |
| 右键菜单（Fit/Full screen/Snapshot） | 真实 | token 固化但未接 OnContextMenu | 🔴 | §7 批 6 |

## 5. 属性面板

| 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| 空状态/选中状态文案 | 真实 | 真实（含经典版字面 `.0`） | ✅ | 批 4 |
| Transform / Blending / Audio / Text 参数 | 真实可编辑并驱动画面 | 受控可编辑并驱动预览（opacity/position/scale/rotate/文字/颜色等；P2 修复点分 key 映射，transform 编辑真正驱动画面） | ✅ | P0+P2：`properties-panel.tsx` + `element-composite.ts`，浏览器验收 opacity/transform |
| Speed / Masks / Effects / Graphic tab | 真实可编辑 | Masks/Effects 基础参数可编辑并驱动像素；Speed/Graphic 仍骨架 | 🟡 | P2：`MASK_ELEMENT_PARAMS`/`EFFECT_ELEMENT_PARAMS` + `applyVisualEffects`；GPU 效果需 core 扩展 |
| 关键帧开关 + 曲线编辑器 | 真实 | 真实动画轨道 + 可视化曲线编辑器（P3 批 3） | ✅ | P2 模型 + P3 批 3：`curve-editor.tsx` 图形化编辑，属性面板「Animation Curves」入口；见 §3 同名行 |
| Timing（Start/Duration/Trim In/Out） | 经典版在时间轴完成 | 真实编辑 + 写回 JSON | ✅ | 批 7.5 验收 |

## 6. 编辑器引擎（用户可感知）

| 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| 撤销 / 重做 | 真实（命令管理器，覆盖全操作） | 仅 clip 编辑历史 | 🟡 | `useClipHistory` |
| 自动保存 | 真实（800ms debounce + IndexedDB/OPFS） | 真实（800ms debounce + localStorage，刷新恢复；介质为 localStorage 非 OPFS） | 🟡 | P0：`project-autosave.ts`，浏览器验收刷新恢复「Hello P0」；介质差异 + 无多端同步故记 🟡 |
| 快捷键分发 | 真实（可重绑定驱动动作） | 13 项动作 + Ctrl/Cmd+C/V/D/A，用户重绑定真实驱动 | ✅ | P1 分发 + P3 批 2：`matchShortcut(event, bindings)` 读用户绑定，`ShortcutsDialog` 录制/Reset 经回调刷新；浏览器验收 k→播放、space 旧键失效、Reset 恢复 |
| 多选/框选/全选 | 真实 | Cmd/Ctrl 加选 + Shift 区间 + Ctrl+A + 空白拖框选 | ✅ | P1 + P2 长尾批：见 §3 同名行 |
| 拖拽排序 | 真实（片段跨轨 + 效果列表） | 仅 main 轨片段拖动 | 🟡 | — |
| 剪贴板直接贴媒体 | 真实 | 无（P1 仅内部元素剪贴板，非系统剪贴板贴文件） | ⚪ | — |
| 面板尺寸可拖拽 | 真实 | 真实 | ✅ | 批 1 |
| GPU/编解码能力提示 | 真实 | P2：WebGL2/WebGPU/硬件编码能力探测 + 诊断面板真实提示 | ✅ | P2：`gpu-capability.ts`，浏览器验收显示「WebGL2 / WebGPU / 硬件视频编码」 |

## 7. 导出 / 交换

| 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| 导出 MP4 (H.264) + AAC | 真实 | 真实 | ✅ | `handleExport` + WebCodecs |
| 导出 WebM (VP9) | 真实 | 真实（VP9 + Opus / AV1 变体，UI 容器可选） | ✅ | 文档更正：`export.ts` 早已实现，P2 核实并改文档；`export.test.ts` 覆盖 |
| 质量档位 / 包含音频开关 | 真实 | 真实（settings 面板） | ✅ | `ExportSettingsPanel` |
| 进度 / 取消 / 错误重试 | 真实 | 进度 + 友好错误，无 Cancel/Retry | 🟡 | — |
| 素材右键 Export clips | 经典版仅展示无 onClick | 无 | ⚪ | 双方均无闭环 |

## 8. 工程侧能力（**不参与对照与统计**）

> 这些是 Rust core / CLI / MCP / 插件层能力，本版本页面上没有 UI 入口。列出仅为说明「Rust 实现做了什么」，不用于抵消 §1~§7 的 UI 缺口。

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 经典版 JSON 只读兼容层 + 97 golden 用例 | ✅ | `ocx-domain`，Rust 与经典版 TS 共用期望值 |
| 项目 JSON 字段保真写回 | ✅ | `write_classic_project` + `project_write.ts`，批 7.5 |
| 渲染/合成 `composite_frame_rgba` / `render_frame_rgba` | ✅ | `ocx-render`，跨栈 checksum 一致 |
| 波形抽样 / 帧缩略图 | ✅ | `waveform.rs` / `thumbnail.rs` + WASM 契约 |
| 编解码与导出后端 | ✅ | WebCodecs + core render |
| OTIO 导入/导出 | ✅ | W-10，经典版无对应 UI |
| MCP server（`ocx.*` 8 工具） | ✅ | `apps/local-mcp` |
| Headless CLI（frame/batch/PNG/WAV） | ✅ | `apps/local-cli` |
| 插件运行时（wasmi + WIT + 声明式权限） | ✅（Rust core，Web 未暴露入口） | `ocx-plugin-host` |
| 4K scrub 基准 / 代理导出 / 清空缓存 | ✅（诊断面板按钮） | `editor.tsx` |

## 9. 统计（仅 §1~§7 的 UI 闭环项）

| 状态 | 数量 | 分布（§） | 主要条目 |
| --- | --- | --- | --- |
| ✅ 已实现 | 34 | §1:5 §2:4 §3:11 §4:3 §5:4 §6:4 §7:3 | 入口、主题、导出按钮、移动端拦截、媒体导入、真实帧缩略图、Text/Media 加入时间轴、片段选中、main 轨编辑、Split、落轨拖放、Duplicate/Delete、复制/粘贴、多选+框选、关键帧曲线编辑器、缩放、seek、波形、播放、缩放全屏、画面合成、空状态、Transform/Text 参数、Timing、面板尺寸、多选全选、关键帧开关、快捷键帮助+重绑定、分发、GPU 能力提示、MP4/WebM 导出、质量档位 |
| 🟡 部分闭环 | 8 | §1:0 §2:1 §3:1 §4:1 §5:1 §6:3 §7:1 | 网格卡片/无排序、三轨结构固定、遮罩手柄（参数化无拖拽）、Masks/Effects 基础参数（无 GPU 效果）、撤销重做、自动保存（localStorage）、拖拽排序、导出进度无取消 |
| 🔴 占位 | 10 | §2:4 §3:3 §4:3 | Sounds/Stickers/Effects/Settings 数据源、静音隐藏、overlay/audio 编辑、书签、时间码编辑、选框/手柄/对齐参考线、右键菜单 |
| ⚪ 未覆盖 | 15 | §1:5 §2:5 §3:2 §4:1 §6:1 §7:1 | 项目列表/重命名、反馈/Onboarding 提示、视频卡预览、AI 字幕、Transitions/Adjustment、Ripple、场景、双击文字就地编辑、素材右键 Export clips、剪贴板直接贴媒体 |

> 合计 67 项（34+8+10+15），逐项以 §1~§7 表格为准。§8 工程侧 10 项不计入。统计数字按表格状态符号核算，与表格严格一致。
> **2026-11-17 P0 完成后变化**：✅ 20→23（Text/Media 加轨、落轨拖放），🟡 7→9（参数编辑、自动保存由 🔴 升级），🔴 19→14。详见 `UI_REPLICA_PLAN.md` §8「P0 闭环实现」。
> **2026-11-17 P1 完成后变化**：✅ 23→25（Duplicate、复制/粘贴），🟡 9→11（多选、快捷键分发升级），🔴 14→13（Duplicate 出占位），⚪ 20→17（多选/复制粘贴出未覆盖）。数据源接入（Sounds/Stickers/Effects）依赖服务端素材库，本仓库无此后端且超出 UI 闭环范围，记 🔴 并写入 `UI_REPLICA_PLAN.md` §7 差异台账；不伪造数据。
> **2026-11-17 P2 完成后变化**：新增 GPU 项（总 66→67）；✅ 25→28（Transform/Text 参数修复 key 映射升 ✅、GPU 提示、WebM 文档更正），🟡 11→13（遮罩/效果基础参数、关键帧真实数据模型），🔴 13→11（参数/关键帧出占位），⚪ 17→15（WebM/GPU 出未覆盖）。AI 字幕、项目管理页无后端，保持 ⚪ 并写入台账；曲线编辑器、GPU 效果、框选橡皮筋归长尾。

## 10. 闭环优先级（P0 → P2，供实施）

- **P0（让编辑器能用）— ✅ 2026-11-17 完成**：① 新增元素插入（Text / 导入的 media → 时间轴，TS 侧轻量 editor store：buildElement + 插入/删除 + undo + placement）；② 本地自动保存（刷新不丢）；③ 属性参数可编辑并驱动预览（至少 opacity/position/scale/text content）。tsc 0 / vitest 299 / build 通过 + 浏览器截图验收。
- **P1（接近经典版交互）— ✅ 2026-11-17 完成（数据源接入除外）**：多选（Cmd/Ctrl 加选 + Shift 区间 + Ctrl+A）、复制粘贴（Ctrl+C/V/D 内存剪贴板）、快捷键分发（Ctrl/Cmd 组合键）。tsc 0 / vitest 326 / build 通过 + 浏览器截图验收（`oc-p1-multiselect.png`）。**未做**：Sounds/Stickers/Effects 数据源接入 —— 依赖服务端素材库（本仓库无后端），框选橡皮筋、快捷键重绑定归 P2；均写入 `UI_REPLICA_PLAN.md` 台账，不伪造数据。
- **P2（长尾）— ✅ 2026-11-17 完成（可闭环项）**：关键帧曲线（真实动画轨道 + 播放头插值驱动画面，无曲线编辑器 UI）、遮罩/效果编辑（矩形裁剪 + brightness/contrast/saturate 纯像素运算，无 GPU 效果）、GPU 提示（WebGL2/WebGPU/硬件编码能力探测）、WebM 导出（核实早已实现，更正文档）。tsc 0 / vitest 357 / build 通过 + 浏览器截图验收（`oc-p2-keyframes.png`）。**Blocked（无后端，写入台账不伪造）**：项目管理页（无多项目持久化）、AI 字幕（无转写服务）。**归长尾**：可视化曲线编辑器、GPU 效果、框选橡皮筋、快捷键重绑定。
- **P3（UI 长尾三件套，2026-11-20 起逐批推送）— 进行中**：用户选「框选橡皮筋 + 快捷键重绑定 + 可视化关键帧曲线编辑器」逐批提交。① 框选橡皮筋 ✅：`timeline.tsx` 空白拖框 + `selectFromBox` 归约，§3/§6 多选行由 🟡 升 ✅（统计 ✅28→30、🟡13→11），vitest 365、浏览器验收 `oc-p3-marquee.png`。② 快捷键重绑定 ✅：新增 `shortcut-bindings.ts` 作单一事实来源，统一 kebab 动作 id/camel 分发/对话框已实现集（消除原 9 项硬编码错位），`matchShortcut(event, bindings)` 读用户绑定、`ShortcutsDialog` 录制经回调刷新分发，冲突检测拒绝覆盖，未实现动作诚实 disabled；补经典版定义表缺失的 trim-in/trim-out；§1/§6 两行 🟡→✅（统计 ✅30→32、🟡11→9），vitest 373、浏览器验收 k→播放 / space 旧键失效 / Reset 恢复 / 冲突提示，`oc-p3-keybinding.png`。③ 可视化关键帧曲线编辑器 ✅：新增 `curve-editor-model.ts`（坐标换算/命中/值域/折线采样/单帧删除纯函数，20 项单测）+ `curve-editor.tsx`（SVG 网格+曲线+播放头线+菱形关键点，拖动改 time/value、双击加点、右键删点、缓动切换），属性面板加「Animation Curves」入口（有轨道即可用）；修正 §3 L67 过时 🔴 行为 ✅（菱形早已真实写轨）；统计 ✅32→34 / 🟡9→8 / 🔴11→10，vitest 393（31 文件）、浏览器验收拖动关键点改 time/value 生效，`oc-p3-curve-editor.png`。**P3 三件套全部完成**。

## 附录 A：经典版「新增文字」实证（为什么不是 core 的事）

基于 `<CLASSIC_ROOT>` 源码实证（隐私保护：路径用占位符，实际值由 `UI_REPLICA_PLAN.md` §1 给出）：

- 卡片：`text/components/assets-view.tsx` 的 `TextView` → `buildTextElement()` + `editor.timeline.insertElement({placement:{mode:'auto'}})`
- 插入核心：`commands/timeline/element/insert-element.ts` 的 `InsertElementCommand.execute()`：`crypto.randomUUID()` 生成 id → `resolveTrackPlacement` 找/建 text 轨 → 写回内存 tracks → 压入 undo 历史 → `useSyncExternalStore` 触发 React 重渲染
- 拖拽落地：`timeline/controllers/drag-drop-controller.ts` 的 `executeTextDrop` → 同一个 `InsertElementCommand`（placement 改 explicit）
- 无后端调用；`@/wasm` 只提供时间刻度/帧对齐数值工具（`TICKS_PER_SECOND` / `roundToFrame`），不参与插入决策
- 持久化：800ms debounce 存 IndexedDB/OPFS（`core/managers/save-manager.ts`），与插入本身解耦

结论：该能力是前端编辑器应用层逻辑。本版本缺口在应用层，不在 Rust core。

## 附录 B：证据来源

- 经典版功能全景：本轮 code-explorer 逐文件探查（75 tool uses），原始报告见会话工具结果。
- 本版本状态：`UI_REPLICA_PLAN.md` §3/§7/§8/§9 + `editor.tsx` / `audio.ts` / `project-write.ts` / `editor-shortcuts.ts` 源码核对 + 浏览器验收截图。
- 经典版本身 coming soon / disabled / 无证据项已在探查中单列，本清单按「双方均无闭环」记 ⚪。
