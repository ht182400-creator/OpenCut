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
| 1 主框架 | 可调整三栏（垂直 mainContent/timeline + 水平 tools/preview/properties）、顶栏 1:1、面板 tab 栏、预览容器；主题切换 | 未开始 | — |
| 2 时间轴 | 多轨（main/overlay/audio）、轨道头、ruler/tick/playhead、snap indicator、bookmarks、缩放、拖拽控制器 | 未开始 | — |
| 3 素材面板 | media / text / stickers / sounds / captions / settings 六个 tab、素材网格、拖入时间轴 | 未开始 | — |
| 4 属性面板 | 按元素类型的参数注册表、关键帧开关、空状态 | 未开始 | — |
| 5 预览交互 | 选框、变换手柄、对齐参考线、画布缩放、overlay 控制 | 未开始 | — |
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
| 0 | 本批未做经典版并排截图 | 批 0 只落地变量/尺寸基线，页面视觉未改变（现有内联样式仍覆盖主题） | **批 1 起**启动经典版 dev server 做同视口并排截图与 computed style 逐项比对；批 0 的 1:1 由源码级逐变量比对保证 |

## 8. 变更记录

| 日期 | 批次 | 提交 | 说明 |
| --- | --- | --- | --- |
| 2026-11-14 | 0 | 本次提交（见 `git log -1`） | 基线固化：进度文档 + 主题变量 + 尺寸 token + 自动比对回归 |
