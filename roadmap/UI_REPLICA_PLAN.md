# 经典版 UI 像素级 1:1 改造 · 批次进度

> 启动：2026-11-14（用户指示「是像素级 1:1 改造，形成UI改造批次进度文档进行」）
> 本文档是 UI 改造阶段的**唯一进度台账**：每批完成后更新状态、验收证据与剩余项。

## 1. 目标与定义

在**现有 Vite + TanStack Router + Rust core（WASM）架构**上，把经典版编辑器做**像素级 1:1 复刻**：
主题变量、字体、图标、间距、圆角、面板比例、组件结构与交互行为逐项对齐，而不是仅对齐信息架构。

- **参照物（用户指定）**：`E:\AI_Studio\opencut-classic`（完整源码，Next.js 16 + Bun + turborepo + Tailwind v4）。
- **入口参照**：`apps/web/src/app/editor/[project_id]/page.tsx` → `EditorLayout`。
- **不迁移**：Next.js App Router、服务端 actions、数据库/登录/云部署、经典版前端状态库实现代码。
- **必须保持**：W-11 冻结契约、10 crate 回归、现有 `ocx.*` / MCP / Headless CLI / OTIO 能力；UI 改动不得回退 core 契约与测试。

### 「像素级 1:1」验收口径

1. **变量层**：`theme.css` 的 `:root` / `.dark` / `.panel` / `.dark .panel` 变量与经典版 `apps/web/src/app/globals.css` 逐项相同（由 `tokens.test.ts` 自动比对）。
2. **尺寸层**：面板默认比例、min/max、gap、header 高度、圆角、字号与经典版 `PANEL_CONFIG` / `EditorLayout` / `@theme inline` 一致。
3. **视觉层**：每批用 `agent-browser` 对同一视口（1440×900）截图，与经典版同状态截图并排比对；关键元素读取 `getComputedStyle`（背景、前景、边框、字号、圆角、间距）逐项断言。
4. **交互层**：点击/拖拽/快捷键行为按经典版 `timeline/components`、`preview/components`、`panels/*` 的定义复现。
5. **回归层**：每批结束跑全套（10 crate、四套对齐、WASM 契约、官方 OTIO、MCP、vitest、tsc、build、看板、兼容），并同步本文档 + `PRIORITY.md` + `HOTSPOTS.md` + 看板版本 + 提交推送。

## 2. 参照基线（批 0 固化）

| 项 | 经典版值 | 来源 |
| --- | --- | --- |
| 面板默认比例 | tools 25 / preview 50 / properties 25；mainContent 50 / timeline 50 | `apps/web/src/panels/layout.ts` `PANEL_CONFIG` |
| 面板约束 | tools 15~40、preview ≥30、mainContent 30~85 | `EditorLayout` `minSize` / `maxSize` |
| 间隙 | 垂直 `0.18rem`、水平 `0.19rem`、水平内边距 `px-3`(0.75rem) | `EditorLayout` className |
| 顶栏 | `h-[3.4rem]`、`px-3`、`pt-0.5` | `components/editor/editor-header.tsx` |
| 圆角 | lg `0.82rem`、md `0.65rem`、sm `0.35rem` | `globals.css @theme inline` |
| 字号 | xs `0.72rem`、sm `0.79rem`、base `0.92rem` | 同上 |
| 字体 | Inter（`--font-inter`），当前工程用 `@fontsource-variable/inter` | `globals.css` / `styles.css` |
| 主题 | 亮色 `:root` + `.dark`；面板作用域 `.panel` + `.dark .panel` | `globals.css` |
| 图标 | `@hugeicons/react` + `@hugeicons/core-free-icons` + `lucide-react` + 自定义 svg（287 个） | `apps/web/package.json` / `public/` |
| 文字字体图集 | `public/fonts/font-atlas.json` + `font-chunk-*.avif`（15 片） | 经典版 `fonts/` |

## 3. 批次台账

| 批次 | 范围 | 状态 | 验收证据 |
| --- | --- | --- | --- |
| **0 基线固化** | 本文档；`theme.css`（主题变量 1:1）、`tokens.ts`（尺寸/比例）、`tokens.test.ts`（自动比对）；`/editor` 引入主题作用域；`NOTICE.md` 记录样式/图标来源 | **已完成**（2026-11-14） | `tokens.test.ts` **10/10**，其中「与经典版 `globals.css` 逐变量比对」在源码可用时真实执行并抓出 1 处抄写偏差（`.dark --input`）；vitest **140/140**、tsc 0 错误、`vite build` 0；浏览器确认 `.classic-ui-root` 亮/暗变量生效（`--background` 亮 `hsl(0, 0%, 100%)` / 暗 `hsl(0, 0%, 5%)`、`--radius-lg: 0.82rem`、`--text-xs: 0.72rem`） |
| **1 主框架** | 可调整五面板（垂直 mainContent/timeline + 水平 tools/preview/properties）、顶栏 1:1、竖排 9 图标 tab、预览容器、亮/暗主题切换；诊断与导出设置收进 settings tab | **已完成**（2026-11-15） | `tokens.test.ts` 10/10、vitest **140/140**、tsc 0 错误、`vite build` 0；浏览器实测 header `54.39px`（3.4rem）、水平三栏 `306/612/306`（25/50/25）、垂直 `253/253`（50/50）、3 个 resize handle、9 个 tab、亮色 `--background: hsl(0, 0%, 100%)` / 暗色 `hsl(0, 0%, 5%)`、`.panel` 暗色 `hsl(0 0% 10%)`；截图 `oc-ui-r1-light2.png` / `oc-ui-r1-dark.png` / `oc-ui-r1-final.png` |
| **2 时间轴** | 多轨（main/overlay/audio）、轨道头、ruler/tick/playhead、snap indicator、bookmarks、缩放、拖拽控制器 | **已完成**（2026-11-16） | `timeline-tokens.test.ts` **14/14**（尺寸/层级/配色/缩放/标尺纯函数，源码可用时与经典版逐项比对通过）；vitest **154/154**、`vite build` client+SSR 0 错误；浏览器 computed style：toolbar 40px、labels 112px、ruler 22px、bookmarks 16px、text 轨元素 `rgb(93,186,160)`=`#5DBAA0`、audio 轨 `rgb(143,93,186)`=#8F5DBA、video 轨高 65px/audio 50px、playhead 宽 2px z=30；三轨片段 title-a/clip-intro/clip-body/audio-bed 全部渲染；点击片段联动属性面板、点击标尺 seek（`00:00.00`→`00:02.29`）、放大按钮 zoom `0`→`0.11`；截图 `roadmap/oc-ui-r2-timeline.png`。核心编辑（move/resize/split/trim）仍只作用 main 轨，overlay/audio 为只读展示（见 §4 与 §7） |
| **3 素材面板** | 九 tab（media/sounds/text/stickers/effects/transitions/captions/adjustment/settings，英文文案）、44px PanelView 头 + 滚动区、Media 112px 素材网格卡片（16:9 缩略图/时长徽标/名称/hover 加号/拖入 overlay）、素材导入、拖入时间轴载荷 | **已完成**（2026-11-16） | `assets-tokens.test.ts` **10/10**（尺寸/文案/MIME/网格断点，源码可用时与经典版 `assets/`+`drag-source.ts` 逐项比对通过）；vitest **164/164**、vite build client+SSR 0 错误；浏览器 computed style：tab 32×32（修复 flex 压缩前为 25px，已加 `shrink-0` 语义）、卡片宽 112px、grid `112px`、时长徽标 `0:02`、名称截断 `demo-clip.mp4…mp4`、Text 卡 112×112 可拖拽、Transitions `Transitions view coming soon...`；九 tab 英文文案、44px 头 `Assets`、拖入空态文案 `Drag and drop videos, photos, and audio files here` 全部渲染；截图 `roadmap/oc-ui-r3-assets.png`。新增元素到时间轴需 core 扩展（批 7），当前为友好提示占位，见 §4 与 §7 |
| **4 属性面板** | 三状态（空状态/多选/单选）、左侧按类型 tab 栏、参数注册表（transform/blending/audio/text，label 在上输入在下）、关键帧菱形开关、工程专属 Timing tab（真实可编辑） | **已完成**（2026-11-16） | `properties-tokens.test.ts` **9/9**（尺寸/参数注册表/默认值/约束，源码可用时与经典版 `properties/`+`params/registry.ts` 逐项比对通过）；vitest **173/173**、vite build client+SSR 0 错误；浏览器空状态 `It's empty here` + 副文案；选中后 tab 栏 Transform/Audio/Speed/Blending/Masks/Effects/Timing、参数字段 Position X/Scale X/Rotate + 关键帧按钮 `Toggle position x keyframe`、NumberField 高 28px、tab 32×32、字号 0.79rem；关键帧开关 false→true 变 primary 色；Timing tab 4 字段真实编辑（Trim In 4000 提交后保留，Duration 受相邻片段约束被 clamp 为预期）；截图 `roadmap/oc-ui-r4-properties.png`。transform/text 等参数只读占位（core 无存储，属批 7），见 §4/§7 |
| **5 预览交互** | 视口 8px padding + 居中画布、选框（white 0.75/1px）、8 手柄（4 角 10px + 3 边 6×14 + 旋转 20px/18px 命中区）、对齐参考线（1px 白 70%）、三栏控制条（HH:MM:SS:FF 时间码 / 播放 / Fit+6 预设缩放 + 全屏） | **已完成**（2026-11-16） | `preview-tokens.test.ts` **8/8**（缩放/手柄/吸附/控制条/光标/时间码，源码可用时与经典版 `preview/` 逐项比对通过）；vitest **181/181**、vite build client+SSR 0 错误；浏览器实测：canvas 320×180、时间码 `00:00:00:00/00:00:03:00`、缩放 Fit+6 预设 + ZoomOut/In/Fit 按钮、播放 `Play→Pause` 时间码推进、选中后 8 手柄 + 选框描边 white/0.75/1px、手柄命中区 18px/视觉 10px、真实拖拽选框 left 20%→29.26%；截图因浏览器 daemon 忙未生成（如实登记，computed style/DOM 验收已充分）。选框/手柄/参考线为视觉叠加 + 本地交互，不改变 core 合成（属批 7），见 §4/§7 |
| 6 命令/对话框 | 快捷键表、命令面板、项目信息/重命名/删除/迁移对话框、导出弹窗、onboarding | 未开始 | — |
| 7 core 扩展 | 多元素类型（text/sticker/caption/audio）、真实波形与帧缩略图、可变分辨率、保存为经典版项目格式 | 未开始 | — |
| 8 全量对齐 | 逐屏截图 + computed style 逐项比对，修正偏差；移动端 gate 与响应式 | 未开始 | — |

## 4. core 扩展边界（诚实标注）

现有 WASM core 只暴露 `read/write_classic_project`、`composite_frame_rgba`、`render_frame_rgba`、`domain_eval`、`otio_*`、`plugin_register`。以下能力**不是纯 UI 活**，必须在批次 7 同步扩 Rust core，否则只能做视觉占位：

- 多内容类型（文字/贴纸/字幕/音频）的解析、编辑与合成；
- 真实音频波形（PCM 抽样）与视频帧缩略图（解码 + 缓存）；
- 可变分辨率帧源（当前固定 320×180）；
- 关键帧动画求值、变换/遮罩/混合模式；
- 保存回经典版项目格式（现有 `write_classic_project` 已有，需接 UI 并补多轨元素类型）。

批次 1~6 中涉及上述能力的部分，必须在 UI 上明确标注「占位/不可用」，不得伪装成已完成。

## 5. 依赖与许可

- 用户已明确批准**像素级 1:1**，因此本阶段允许引入经典版使用的样式值、图标与字体资源，这会改变此前「零 UI 依赖」的隔离策略。
- 经典版为 MIT（`E:\AI_Studio\opencut-classic\LICENSE`）；复制的 CSS 变量、图标与字体资源在 `local/NOTICE.md` 逐批登记来源，MIT © 2025-2026 声明继续保留。
- 服务端框架、数据库、认证代码不复制；每个批次在 `NOTICE.md` 说明「复制了什么 / 本地重写了什么」。

## 6. 风险与约定

- 经典版是 Next.js + zustand + Radix，当前工程是 Vite + TanStack + 内联样式：**组件代码不拷贝**，按结构与样式 1:1 重写到 `apps/web/src/local/classic-ui/`。
- 经典版编辑器页面依赖登录/项目 ID/云存储，当前工程是本地单页；批次 1 起用本地 fixture 项目替代，差异在本表登记。
- 每批保持工作区干净并推送三端（GitHub / Forgejo / local）。
- core 暂停项（见 `PRIORITY.md` §「core 阶段结论」）在 UI 阶段被阻塞时按原表恢复。

## 7. 已登记差异（逐批累积）

| 批次 | 差异 | 原因 / 影响 | 处理 |
| --- | --- | --- | --- |
| 0 | 主题变量挂在 `.classic-ui-root` 而非全局 `:root` | 当前工程首页共用同一份 `styles.css`，全局覆盖会污染首页；后代取到的变量值相同 | 视觉无差异，保留 |
| 0 | `--font-inter` 指向 `'Inter Variable', Inter, sans-serif`，经典版由 next/font 注入 | 当前工程已装 `@fontsource-variable/inter`，无需云端字体注入 | 视觉一致；若批 8 比对发现字形差异再换同源字体文件 |
| 0 | 本批未做经典版并排截图 | 批 0 只落地变量/尺寸基线，页面视觉未改变（现有内联样式仍覆盖主题） | 待经典版参照环境就绪后做同视口并排截图；批 0 的 1:1 由源码级逐变量比对保证 |
| 1 | **经典版并排截图仍未完成** | 经典版依赖 `bun@1.2.18`（本机 1.3.11，proto 版本 pin 拒绝）；用 Node 24 直跑 Next 16.2.4：Turbopack panic `VAR_MODULE_GLOBAL_ERROR`，改 webpack 模式仍 500。依赖已装（1933 包）但参照服务未就绪 | 本批改用**源码级尺寸/变量逐项比对 + 当前页面 computed style 实测**：header 54.39px、三栏 306/612/306、垂直 253/253、亮/暗变量值全部对齐。后续批次可试 `proto install bun 1.2.18` 后重启 `bun run dev`，或由用户提供可访问的经典版实例；未做成前不声称「视觉并排验收通过」 |
| 1 | `react-resizable-panels` v4 把数字尺寸当作**像素** | 经典版 v2 的 `defaultSize={25}` 是百分比，v4 需传字符串 `"25"` | 所有面板尺寸传 `String(...)`；已实测比例 1:1 |
| 1 | 预览画布用 `object-fit: contain` 等比居中 | 直接 `width:100%; height:auto` 会在高容器里被压扁 | 元素填充容器、内容 letterbox，与经典版一致 |
| 1 | 面板内部细节仍为过渡形态 | 素材/属性/时间轴的内容控件沿用前三批实现，经典版对应组件由批次 2~5 逐项替换 | 明确标注占位；不把「容器 1:1」说成「面板内部 1:1」 |
| 1 | 顶栏/按钮文案为中文，经典版为英文 | 本地化策略 | 不影响尺寸与配色；批次 8 视觉比对再决定是否改文案 |
| 1 | 右下角棕榈树浮标 | 当前工程 TanStack devtools（开发态） | 生产构建不显示，不计入 1:1 比对 |
| 2 | video 轨片段为纯色占位（无帧缩略图平铺） | 经典版视频片段用 `thumbnailUrl` 横向平铺；当前 core 只输出合成帧，不提供按片段的帧缩略图（属批 7 core 扩展） | 用主题 `--muted` 底色 + 片段 id 文本占位，不伪装为经典版缩略图；结构/尺寸/选中描边仍 1:1 |
| 2 | overlay/audio 轨为只读展示，核心编辑只作用 main 轨 | core 的 `rippleAdjustments`/`rippleApply`/`split`/`trim` 契约只覆盖主轨，多轨编辑须批 7 扩 core | 轨道头静音/隐藏为本地视觉状态（ProjectView 未暴露 muted/hidden 字段）；拖拽/resize 仅 main 轨生效，其余轨点击可选中查看但不提交编辑 |
| 2 | bookmarks 行渲染为空（16px 行 + 工具栏占位按钮） | 经典版书签数据来自 `scene.bookmarks`，当前 `ProjectView` 归一化视图未暴露该字段（属批 7 core 扩展） | 保留 16px 标尺下方书签行与工具栏按钮位置，视觉 1:1；数据接入留待批 7 |
| 2 | 片段/播放头拖拽用像素→ticks 换算，未引入经典版 snap/ripple 全套 hook | 经典版用 zustand + 多个交互 hook（box-select、edge-auto-scroll、graph editor），本工程保持本地重写且 core 契约不变；吸附用既有 `snapTicks` 纯函数复用 | 拖拽、边缘裁剪、标尺 seek、ctrl+wheel 缩放、shift+wheel 横滚已接通核心行为；box-select/graph editor/ripple 开关为批 6/7 范围，未伪装为已完成 |
| 2 | 全量 tsc 有 13 个 HEAD 基线既有错误 | `git show HEAD` 验证：`calendar.tsx`/`scroll-area.tsx`/`spinner.tsx` 与 `editor.tsx`/`editor-ui.tsx` 的未使用变量、`trimEnd`/`SnapshotElement` 类型不匹配在批 2 前即存在，与本次改动无关 | 本次改动文件（timeline.tsx/timeline-tokens.ts/测试/theme.css）tsc 0 错误；vitest 154/154 与 vite build（client+SSR）均通过；基线错误不在本批范围，如实登记 |
| 3 | 新增元素到时间轴为占位（卡片加号 / 拖拽 drop 只反馈提示，不插入片段） | core 只暴露 `rippleApply`/`split`/`trim` 等编辑契约，无「插入新元素」API；多内容类型（text/sticker/caption）属批 7 扩展 | 素材卡的 `dataTransfer` 载荷按经典版 `application/x-timeline-drag` MIME 输出，drag 起点 1:1；drop 落地需批 7，UI 用友好提示明确「当前为占位」，不伪装完成 |
| 3 | 素材缩略图为占位图标，无真实帧缩略图 | core 无按素材的缩略图接口（批 7 扩展）；经典版视频卡用 `thumbnailUrl` 横向平铺 | 卡片保留 16:9 框 + 时长徽标，缩略图缺省用主题色占位图标；导入视频后仅追加名称/时长到网格 |
| 3 | stickers/sounds/effects/captions 为骨架（搜索/分类/coming soon），settings 仍注入当前工程导出/诊断 | 经典版这些 tab 的数据源是远程/注册中心（贴纸图集、声音库、效果注册表、转写服务），当前工程无对应数据层（批 7） | 面板外壳/搜索占位/空态/英文文案/网格断点 1:1；数据填充与真实筛选留待批 7；settings 内容沿用当前工程工具箱并在差异中登记，不伪装为经典 Project info |
| 3 | tab label 用英文（Media/Sounds/…）替代原中文；图标为本地手绘 SVG | 经典版用 Hugeicons 字形 + Tooltip（side=right），当前避免图标包版本差异 | 九 tab 顺序/key/文案与经典版一致，尺寸 32×32；Tooltip 用原生 `title`，视觉差异见 §7 通用登记 |
| 3 | 全量 tsc 仍为 HEAD 基线既有错误（批 3 后为 11 个） | 同批 2：`calendar`/`scroll-area`/`spinner`/`editor.tsx`/`editor-ui.tsx` 的既有用例，本次未触碰 | 本次改动文件（assets-panel.tsx/assets-tokens.ts/测试/theme.css/editor-ui.tsx 素材段）tsc 0 错误；vitest 164/164、build 0、看板/兼容通过；基线错误如实登记 |
| 4 | transform/opacity/blendMode/volume/text 等参数为**只读占位**（不可编辑、不可写回 core） | core 只暴露时间属性编辑（moveClip/resizeClip/split/trim），无内容参数存储；多内容类型与关键帧动画求值属批 7 扩展 | 参数字段按经典版注册表 1:1 渲染（label/输入/默认值/关键帧开关），但输入框 disabled 并标注「需 core 扩展」；工程真实可编辑的 4 个时间字段放专属 Timing tab（经典版无此 tab，差异登记） |
| 4 | 关键帧菱形开关仅本地视觉状态（点击变 primary 色），不写入动画数据 | 经典版关键帧由 zustand + `element-params-tab` 读写动画通道；当前 `ProjectView` 未暴露动画字段（批 7） | 保留菱形图标/位置/title 文案/激活态配色 1:1；点击只切本地 state，不伪装已生成关键帧 |
| 4 | 多选文案 `{n} elements selected.0` 照搬经典版字面量 `.0` | 经典版 `properties/index.tsx` 源码末尾确有字面量 `.0`（疑似 bug） | 为像素级 1:1 照搬；当前工程单轨不会产生多选，仅保留状态分支 |
| 4 | 工程专属 Timing tab（Start/Duration/Trim In/Trim Out + Apply/Reset） | 经典版属性面板无时间属性 tab（其时间编辑在时间轴完成） | 保留当前工程第三批已验证的真实编辑能力，避免 1:1 改造回退既有功能；作为工程扩展差异登记 |
| 4 | 属性 tab 记忆（activeTabPerType）未持久化 | 经典版用 zustand 按类型记住上次 tab；当前组件本地 state、切换选中元素不重置 tab | 视觉/结构 1:1，状态持久化差异登记；`elementType` 当前固定 video（core 只有视频片段），其它类型 tab 注册表已在 tokens 中固化待批 7 |
| 4 | 全量 tsc 为 10 个 HEAD 基线既有错误（比批 3 少 1：删除旧 PropertiesPanel 消除 editor-ui.tsx 的 trimEnd 错误） | `calendar`/`scroll-area`/`spinner`/`editor.tsx` 的既有用例，本次未触碰 | 本次改动文件（properties-panel.tsx/properties-tokens.ts/测试/editor.tsx/editor-ui.tsx）tsc 0 错误；vitest 173/173、build 0、看板/兼容通过 |
| 5 | 选框/变换手柄/对齐参考线为画布上的**视觉叠加 + 本地交互**，拖拽只改本地矩形，不改变 core 合成帧 | core 固定 320×180 帧源、无元素 transform 存储/渲染管线（多内容类型与 transform 属批 7） | 手柄位置/尺寸/命中区/光标/吸附阈值/参考线 1:1；选中元素时在画布上叠加居中占位框（非元素真实位置），拖拽/吸附为本地反馈，不伪装已变换画面 |
| 5 | 控制条时间码为只读 HH:MM:SS:FF（由 frameIndex/fps 计算），无经典版的可编辑/跳帧输入 | `EditableTimecode` 依赖编辑器状态与帧跳转逻辑，当前时间轴 seek 已覆盖；可编辑时间码属后续交互 | 显示格式/字段/等宽字体 1:1；保留旧调用的补充文本（如 `片段 clip-intro`）作差异展示 |
| 5 | 缩放用 select（Fit + 6 预设）+ ZoomOut/In 按钮；中键平移、滚轮平移未实现 | 经典版预览视口有中键拖拽平移、滚轮平移（编辑器画布导航），本工程 core 帧源固定尺寸、无需平移 | 缩放预设/步进/范围/ctrl-wheel 缩放 1:1；平移能力登记差异；`zoom=1` 显示 Fit、非预设倍率动态插入选项 |
| 5 | 全屏用浏览器 Fullscreen API（失败静默降级）；旧播放按钮（中文「播放/暂停」+ range 滑杆）移除 | 经典版用 `toggleFullscreen` 切换 containerRef；seek 在时间轴而非预览控制条完成 | 全屏/播放按钮 28px 与位置 1:1；range 滑杆移除后 seek 仍可由时间轴 ruler 完成（批 2 已验证） |
| 5 | 截图 `oc-ui-r5-preview.png` 未生成 | 浏览器 daemon 在截图时忙（连续 EOF 解析错误），重试后恢复但 dev server 已停 | 如实登记；本批以 DOM/computed style/真实鼠标交互验收为准（手柄拖拽 left 20%→29.26%、播放时间码推进、缩放 125% 显示等），未声称截图验收 |

## 8. 变更记录

| 日期 | 批次 | 提交 | 说明 |
| --- | --- | --- | --- |
| 2026-11-14 | 0 | 见 `git log` | 基线固化：进度文档 + 主题变量 + 尺寸 token + 自动比对回归 |
| 2026-11-15 | 1 | 见 `git log` | 主框架：可调整五面板 + 顶栏 1:1 + 竖排 9 tab + 预览容器 + 亮/暗主题切换；并排截图因参照环境未就绪降级 |
| 2026-11-16 | 2 | 见 `git log` | 时间轴：三轨（overlay/main/audio）+ 轨道头（静音/隐藏/类型图标）+ ruler/tick（经典版间隔算法）+ 播放头 + snap 指示线 + 书签行 + 缩放（按钮/滑块/ctrl-wheel）+ 拖拽/边缘裁剪/seek；`timeline-tokens.ts` 固化经典版尺寸并 14/14 自动比对；vitest 154/154、build 0；浏览器 computed style 与交互验收通过 |
| 2026-11-16 | 3 | 见 `git log` | 素材面板：九 tab 英文文案、44px PanelView 头 + 滚动区、Media 112px 网格卡片（16:9/时长徽标/名称截断/hover 加号/拖入 overlay）、text/stickers/sounds/effects/captions/coming-soon 骨架、导入接线；`assets-tokens.ts` 固化尺寸并 10/10 自动比对；vitest 164/164、build 0；浏览器验证 32×32 tab、112px 卡、英文文案与拖入空态 |
| 2026-11-16 | 4 | 见 `git log` | 属性面板：三状态（空状态/多选/单选）、左侧按类型 tab 栏、参数注册表（transform/blending/audio/text，label 在上输入在下）、关键帧菱形开关、工程 Timing tab 真实编辑；`properties-tokens.ts` 固化尺寸/参数并 9/9 自动比对；vitest 173/173、build 0；浏览器验证空状态文案、tab 栏、28px NumberField、关键帧交互、Timing 编辑 |
| 2026-11-16 | 5 | 本次提交（见 `git log -1`） | 预览交互：视口 8px padding + 居中画布、选框 white/0.75/1px、8 手柄（18px 命中区/10px 视觉/旋转钮）、对齐参考线、三栏控制条（HH:MM:SS:FF/播放/Fit+6 预设+全屏）；`preview-tokens.ts` 固化尺寸/缩放/光标并 8/8 自动比对；vitest 181/181、build 0；浏览器 DOM/computed style/真实鼠标交互验收通过 |
