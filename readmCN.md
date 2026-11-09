<table width="100%">
  <tr>
    <td align="left" width="120">
      <img src="https://assets.opencut.app/branding/symbol.svg" alt="OpenCut Logo" width="100" />
    </td>
    <td align="right">
      <h1>OpenCut 中文说明</h1>
      <h3 style="margin-top: -10px;">面向 Web、桌面与移动端的免费开源视频编辑器</h3>
    </td>
  </tr>
</table>

[![Discord](https://img.shields.io/discord/1386309140057690133?label=Discord&logo=discord&logoColor=fff&color=5865F2&style=flat)](https://discord.gg/zmR9N35cjK)
[![X](https://img.shields.io/badge/follow-%40opencutapp-000?logo=x&logoColor=fff&style=flat)](https://x.com/opencutapp)
[![License: MIT](https://img.shields.io/badge/license-MIT-green?style=flat)](LICENSE)

> **关于本文档**：`readmCN.md` 是对本仓库的**中文导读与开发参考**，由阅读源码与配置整理而成，不是官方发布的文档。依据的代码快照为 2026-11-08，HEAD 提交 `e6680107`（2026-09-24）。项目变动很快，遇到不一致时请以英文原版 [README.md](README.md) 和源码为准。

---

## 一、项目是什么

OpenCut 是一个**免费、开源**的视频编辑器，目标是同时覆盖 Web、桌面和移动端。它由 `opencut-app` 组织维护，采用 MIT 许可证（见 [LICENSE](LICENSE)）。

需要特别区分两个概念：

| 名称 | 地址 | 说明 |
| --- | --- | --- |
| **经典版（classic）** | [opencut-app/opencut-classic](https://github.com/opencut-app/opencut-classic) | 目前可日常使用的版本，[opencut.app](https://opencut.app) 运行的也是它 |
| **重写版（本仓库）** | [opencut-app/OpenCut](https://github.com/opencut-app/OpenCut) | 正在从零重写，预览地址为 [new.opencut.app](https://new.opencut.app)，尚未接管正式站点 |

本仓库 `changelog/` 下的 0.1.0 ~ 0.3.0 更新日志（编辑器基础、关键帧与特效、蒙版与曲线编辑器等）描述的是**经典版**的能力，**并不代表当前仓库中已实现的功能**。

---

## 二、当前状态：正在从零重写（请先读这一节）

英文 README 的第一句就是："**OpenCut is being rewritten from the ground up**"。阅读本仓库代码后可以确认：目前是**架构搭建 / 脚手架阶段**，尚没有一个可用的视频编辑器。

### 2.1 即将到来的能力（路线图，来自 README）

- **Editor API**：对外暴露编辑器能力
- **一等公民的第三方插件**：由插件优先（plugin-first）的架构实现
- **一套 Rust 核心，多端复用**：桌面、移动、浏览器共用代码
- **MCP server**：供 AI Agent 调用
- **Headless 模式**：自动化、批量渲染
- **编辑器内置脚本标签页**

### 2.2 本仓库实际包含什么（代码实况）

| 模块 | 当前实现程度 |
| --- | --- |
| `apps/web` | TanStack Start 站点骨架，仅 `/`（`hello world!`）与 `/editor`（`Coming soon.`）两个占位路由；另有 60 个 shadcn 生成的 UI 组件尚未被业务页面使用 |
| `apps/api` | Elysia 运行在 Cloudflare Workers 上，只有 `/`、`/health`、`/echo` 三个示例端点 |
| `apps/desktop` | 一个用 GPUI 打开的最大化窗口，上部三栏 + 底部时间轴均为文字占位；已实现明暗主题与 6 个基础 UI 组件 |
| `crates/media` | 只有 FFmpeg 依赖下载/编译脚本，尚未形成 Rust crate（`Cargo.toml` 里 `'crates/*'` 被注释） |
| `brand`、`changelog` | 品牌 SVG 与经典版更新日志 |
| `.github` | CI 工作流、Issue/PR 模板、社区规范和 AI 编码规范 |

> 一句话总结：**这是一个「未来编辑器的地基」，不是「可安装的编辑器」。** 想直接使用产品，请去 [opencut.app](https://opencut.app) 或经典版仓库。

---

## 三、技术栈

| 层次 | 选型 |
| --- | --- |
| 工具链管理 | [proto](https://moonrepo.dev/proto) + [moon](https://moonrepo.dev/moon) 2.3.3（`.prototools` 固定版本） |
| 包管理 / 运行时 | Bun 1.3.11；`bunfig.toml` 设置 `minimumReleaseAge = 604800`（只安装发布满 7 天的依赖，降低供应链投毒风险） |
| Rust | 1.97.0，edition 2024，workspace `resolver = "3"` |
| Web 前端 | React 19.2、TypeScript 6、Vite 8、TanStack Start / Router（文件路由）、Tailwind CSS 4、shadcn（`base-mira` 风格）、Base UI、Radix、HugeIcons、Zod 4、React Hook Form、Recharts |
| Web 测试 / 部署 | Vitest 4 + jsdom；Cloudflare Workers（`@cloudflare/vite-plugin` + Wrangler），绑定自定义域名 `new.opencut.app` |
| API | Elysia + Cloudflare Workers 适配器，启用 AoT 编译（`.compile()`） |
| 桌面端 | Rust + [GPUI](https://www.gpui.rs) 0.2.2，语义色使用 OKLCH 转 HSLA，支持随系统切换明暗主题 |
| 媒体依赖 | FFmpeg 8.1.3（LGPL-2.1-or-later），预编译包 + 源码构建脚本，SHA-256 校验 |
| CI | GitHub Actions，Ubuntu / Windows / macOS 三平台矩阵执行 `moon ci` |

---

## 四、目录结构

```text
OpenCut/
├── .github/
│   ├── workflows/
│   │   ├── bun-ci.yml            # 主分支 push / PR 触发的三平台 CI
│   │   └── media-deps.yml        # 手动触发：为 6 个平台构建 FFmpeg 并发布预发布版
│   ├── copilot-instructions.md   # Ultracite / Biome 编码规范（a11y、类型安全、React 实践）
│   ├── ISSUE_TEMPLATE/           # bug_report.yml、feature_request.yml
│   ├── CODE_OF_CONDUCT.md / SECURITY.md / SUPPORT.md / pull_request_template.md
├── .moon/
│   ├── workspace.yml             # 项目来源：apps/*、crates/*，仓库根目录也算一个项目
│   └── toolchains.yml            # bun 1.3.11，JS 包管理器为 bun，启用 rust 工具链
├── apps/
│   ├── web/                      # @opencut/web：TanStack Start 前端
│   │   ├── src/routes/           # __root.tsx、index.tsx、editor.tsx（文件路由）
│   │   ├── src/components/ui/    # 60 个 shadcn 基础组件
│   │   ├── src/hooks/、src/lib/  # useIsMobile、cn() 等工具
│   │   ├── src/styles.css        # Tailwind 4 + 明暗主题 CSS 变量
│   │   ├── vite.config.ts、wrangler.jsonc、tsconfig.json、components.json
│   │   └── public/               # favicon、manifest.json、robots.txt
│   ├── api/                      # @opencut/api：Elysia on Workers
│   │   └── src/index.ts、wrangler.jsonc
│   └── desktop/                  # opencut-desktop：Rust + GPUI
│       ├── src/main.rs           # 创建窗口、WSLg 兼容处理
│       ├── src/shell.rs          # 三栏 + 时间轴布局
│       ├── src/theme.rs          # 明暗语义色、OKLCH → HSLA、单元测试
│       ├── src/components/       # badge、button、context_menu、label、resizable、separator
│       └── src/panels/           # browser、preview、inspector、timeline（均为占位）
├── brand/marks/                  # icon / logo-dark / logo-light / symbol-dark / symbol-light（SVG）
├── changelog/                    # 0.1.0.md、0.2.0.md、0.3.0.md（经典版日志）
├── crates/media/setup/
│   ├── ffmpeg.json               # 版本、许可证、源码 URL + SHA-256、各平台预编译包
│   └── setup.ts                  # 下载/校验/解压/源码构建/原子落盘的 Bun 脚本
├── .prototools                   # moon 2.3.3 / bun 1.3.11 / rust 1.97.0
├── .env.example                  # R2_BUCKET=opencut-assets
├── bunfig.toml / moon.yml        # 依赖发布年龄限制 / 根项目 upload-logos 任务
├── Cargo.toml / Cargo.lock       # Rust workspace（当前仅 apps/desktop）
├── .vscode/settings.json         # TS/TSX 用 Biome，其余用 Prettier，保存时格式化
└── README.md / LICENSE           # 英文原版说明 / MIT 许可证
```

---

## 五、环境准备

### 5.1 安装 proto

proto 会根据 `.prototools` 自动安装并锁定 moon、Bun、Rust 的版本，保证所有开发者和 CI 使用完全相同的工具链。

**Linux、macOS、WSL：**

```sh
bash <(curl -fsSL https://moonrepo.dev/install/proto.sh)
```

**Windows（PowerShell）：**

```powershell
irm https://moonrepo.dev/install/proto.ps1 | iex
```

若 shim 无法执行，为当前用户放开本地脚本执行权限：

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

### 5.2 安装固定版本工具链

在**仓库根目录**执行：

```sh
proto use
```

> 若后续 `moon run` 提示找不到依赖，先执行 `bun install` 安装各 `package.json` 声明的依赖；CI 中由 `moonrepo/setup-toolchain@v0` 的 `auto-install` / `auto-setup` 自动完成。

### 5.3 桌面端平台要求（摘自 [apps/desktop/README.md](apps/desktop/README.md)）

| 平台 | 要求 |
| --- | --- |
| macOS | Xcode Command Line Tools（Metal 渲染） |
| Windows | 无额外依赖（Win32 + DirectWrite） |
| Linux | Vulkan（Blade）渲染，Wayland 或 X11；Debian/Ubuntu 需 `libvulkan1` + 可用 Vulkan 驱动、`libwayland-dev`、`libx11-xcb-dev`、`libxkbcommon-x11-dev`、`libfontconfig-dev`，以及 C 工具链和 `cmake` |
| WSL2 / WSLg | 自动使用 XWayland；GPUI 0.2.2 要求 `xdg_wm_base` v2~v5，而 WSLg 只通告 v1 |

首次构建需要从源码编译 GPUI，耗时较长；根目录的 `Cargo.lock` 已提交。

---

## 六、启动与常用命令

```sh
moon run web:dev       # Web 开发服务器，localhost:5173
moon run api:dev       # API（wrangler dev），localhost:8787
moon run desktop:dev   # 桌面端窗口，详见 apps/desktop/README.md
```

全部 moon 任务一览（来自各 `moon.yml`）：

| 任务 | 实际命令 | 说明 |
| --- | --- | --- |
| `web:dev` | `bun run dev` | `vite dev --port 5173`，CI 中跳过且不缓存 |
| `web:build` | `bun run build` | `vite build`，产物 `dist` |
| `web:test` | `bun run test` | `vitest run` |
| `web:deploy` | `bun run deploy` | 先 `build` 再 `wrangler deploy`，依赖 `~:build` |
| `api:dev` | `bun run dev` | `wrangler dev` |
| `api:build` | `bun run build` | `wrangler deploy --dry-run` |
| `api:deploy` | `bun run deploy` | `wrangler deploy`，依赖 `~:build` |
| `desktop:dev` | `cargo run` | CI 中跳过 |
| `desktop:check` | `cargo check` | 检查 Rust 代码 |
| `desktop:build` | `cargo build --release` | 产物 `/target/release/opencut-desktop` |
| `upload-logos` | 根 `moon.yml` 内联脚本 | 上传品牌 SVG 到 R2，见第九节 |
| `moon ci` | — | CI 中按依赖图执行全部可缓存任务 |

也可以不用 moon，直接进入各应用目录执行 `package.json` 里的脚本（如 `cd apps/web && bun run dev`）。

---

## 七、各模块详解

### 7.1 `apps/web` — Web 前端

- **框架**：TanStack Start（基于文件的路由），`routeTree.gen.ts` 由插件自动生成，**不要手工修改**。
- **路由**：
  - `/` → `index.tsx`，当前输出 `hello world!`
  - `/editor` → `editor.tsx`，当前输出 `Editor / Coming soon.`
  - `__root.tsx` 提供 HTML 外壳、`TooltipProvider`、TanStack Devtools，加载 Playfair Display（标题）与 Inter Variable（正文）。
- **构建插件**（`vite.config.ts`）：`devtools()`、`cloudflare({ viteEnvironment: { name: 'ssr' } })`、`tailwindcss()`、`tanstackStart()`、`viteReact()`。
- **部署**（`wrangler.jsonc`）：Worker 名 `opencut-web`，`compatibility_date = 2025-09-02`，启用 `nodejs_compat`，入口为 `@tanstack/react-start/server-entry`，自定义域名 `new.opencut.app`。
- **样式**：`styles.css` 使用 Tailwind 4 的 `@theme inline` 定义全套语义色变量（`:root` 明色、`.dark` 暗色），与桌面端 `theme.rs` 的语义色命名一一对应。
- **UI 组件库**：`components.json` 配置 shadcn 的 `base-mira` 风格、HugeIcons 图标与 `#/*` 路径别名；`src/components/ui/` 下已生成 60 个组件（按钮、对话框、时间轴常用控件等），等待业务页面接入。
- **类型检查**：`tsconfig.json` 开启 `strict`、`noUnusedLocals`、`noUnusedParameters`、`verbatimModuleSyntax`、`noEmit`。

### 7.2 `apps/api` — HTTP API

`src/index.ts` 是一个 Elysia 应用，使用 `CloudflareAdapter`，**必须调用 `.compile()`** 以在启动时触发 AoT 编译（源码注释明确说明）。

| 方法 | 路径 | 响应 |
| --- | --- | --- |
| `GET` | `/` | `{ "status": "ok" }` |
| `GET` | `/health` | `{ "healthy": true, "timestamp": "<ISO 时间>" }` |
| `POST` | `/echo` | 原样返回请求体；请求体由 `t.Object({ message: t.String() })` 校验 |

`wrangler.jsonc` 中 Worker 名为 `opencut-api`，`compatibility_date = 2025-06-01`（AoT 支持所需的最低日期）。

### 7.3 `apps/desktop` — 桌面端

> 官方 README 的警告：**非常早期，目前只是一个能打开的窗口。**

- `main.rs`：创建一个居中、最大化、标题为 `OpenCut` 的窗口（基准尺寸 960×600），并监听系统外观变化触发重绘。Linux 下会在 `main` 的第一条语句检测 WSLg：若同时存在 X11 与 Wayland 环境，则移除 `WAYLAND_DISPLAY` 以规避 GPUI 0.2.2 与 WSLg v1 协议不兼容导致的 panic；源码注释要求这段逻辑必须保持在 `main` 最前面（此时尚未创建任何线程）。
- `shell.rs`：`Shell` 在 `new` 中一次性创建 4 个 `Entity`，保证面板状态跨帧保留；布局为上部占 2/3 的横排（Browser 1/4、Preview 1/2、Inspector 1/4），下部占 1/3 的 Timeline。
- `panels/`：四个面板目前只渲染各自名称（"Browser"、"Preview"、"Inspector"、"Timeline"）。
- `theme.rs`：`SemanticColors` 定义 30 余个语义色令牌，明暗两套主题用 `OnceLock` 懒加载并随 `WindowAppearance` 切换；内置 `oklch_with_alpha()` 把 OKLCH 转成 GPUI 的 `Hsla`；文件末尾有 3 个单元测试（中性色端点、半透明令牌、主题选择）。
- `components/`：按钮（6 种变体 × 8 种尺寸）、可拖拽分隔面板（双击分隔条复位）、右键菜单、徽章、标签、分隔线；`resizable.rs` 自带 `clamp_fraction` 单元测试。

运行方式：

```sh
moon run desktop:dev     # cargo run
moon run desktop:check   # cargo check
moon run desktop:build   # cargo build --release
```

### 7.4 `crates/media/setup` — FFmpeg 依赖准备

这是目前仓库中逻辑最完整的一段「基建」代码，目标是把固定版本的 FFmpeg 放进 `.cache/media/`，供未来的 `build.rs` 使用。

- **版本固定**：`ffmpeg.json` 固定 FFmpeg `8.1.3`、`LGPL-2.1-or-later`，包含源码包 URL 与 SHA-256，以及 Windows / Linux 各 x86_64、aarch64 四个平台的预编译包 URL 与 SHA-256。**macOS 没有预编译包**，会自动走源码构建。
- **脚本行为**（`setup.ts`）：
  1. 根据 `--target <platform>` 或宿主机确定目标平台；目标与宿主不同、没有预编译包、或显式 `--from-source` 时从源码构建；
  2. 下载后**校验 SHA-256**，不一致直接报错；
  3. 源码构建使用统一的 `configure` 参数（只产出 LGPL 共享库、禁用命令行程序 / avdevice / avfilter / network / autodetect），Windows 需从 Linux 用 `llvm-mingw` 交叉编译，x86_64 缺 `nasm` 时降级为无汇编并告警；产物附 `BUILD.md`、`COPYING.LGPLv2.1`、`LICENSE.md` 以满足 LGPL 要求；
  4. 先写入 `.partial` 暂存目录，完成后整体重命名，避免中断留下「看起来完整」的半成品；
  5. 用 `.complete` 标记记录来源与配置的哈希，**重复执行是幂等的**，标记未变则直接跳过。
- **调用方式**（脚本头部注释）：

```sh
moon run media:setup                              # 注释中的用法，见下方注意事项
bun run crates/media/setup/setup.ts --from-source # 从源码构建
bun run crates/media/setup/setup.ts --target linux-aarch64
```

- **CI**：`.github/workflows/media-deps.yml` 通过 `workflow_dispatch` 手动触发，输入 `build` 编号即可对同一版本重建；覆盖 6 个平台（Linux x86_64/aarch64、Windows x86_64/aarch64 交叉编译、macOS x86_64/aarch64），打包上传并以 `ffmpeg-<version>-<build>` 为 tag 创建 **prerelease**（刻意不占用应用的最新发布版），同时生成 `checksums.sha256`。

---

## 八、环境变量与品牌资源

`.env.example` 只有一个变量：

```dotenv
R2_BUCKET=opencut-assets
```

- 需要时复制为 `.env.local`（`.gitignore` 忽略 `.env.*`，但保留 `.env.example`），再按需修改桶名。
- 根 `moon.yml` 的 `upload-logos` 任务会加载 `.env.local`，校验 `R2_BUCKET`，然后遍历 `brand/marks/*.svg`，用 `wrangler r2 object put ... --remote` 上传到 Cloudflare R2（内容类型 `image/svg+xml`）。该任务 `cache: false`、`runInCI: false`，需手动执行；任务是根项目任务，若 `moon run` 提示项目别名未知，可先用 `moon query projects` 查询。
- 上传的品牌文件：`icon.svg`、`logo-dark.svg`、`logo-light.svg`、`symbol-dark.svg`、`symbol-light.svg`。

---

## 九、CI 与自动化

| 工作流 | 触发条件 | 内容 |
| --- | --- | --- |
| `bun-ci.yml` | push 到 `main`、针对 `main` 的 PR（忽略 `*.md` 变更） | `concurrency` 自动取消同分支旧任务；Ubuntu / Windows / macOS 三平台矩阵；`moonrepo/setup-toolchain@v0` 自动安装工具链与依赖；执行 `moon ci` |
| `media-deps.yml` | 仅 `workflow_dispatch` 手动触发 | 为 6 个平台构建固定版本 FFmpeg 并发布 prerelease，见 7.4 |

---

## 十、代码规范、贡献与安全

### 10.1 编码规范

- `.github/copilot-instructions.md` 给出了面向 TS/TSX 的 Ultracite（基于 Biome）规范清单：可访问性（a11y）、类型安全（禁用 `any` / `enum` / 非空断言）、React/JSX 实践、正确性与统一风格等。
- `.vscode/settings.json`：TypeScript / TSX 保存时用 Biome 格式化并自动修复、整理 import，其余文件用 Prettier。
- `.tokeignore` 用于排除代码统计中的 JSON / SVG / XML / lock / 构建产物 / `node_modules`。

### 10.2 贡献

**架构仍在设计阶段，项目目前不接受外部贡献。** `pull_request_template.md` 明确说明：除关键 bug 修复外不接受 PR；bug 修复需先开 issue 并获得维护者批准；功能类 PR 会被直接关闭。想跟进进展、提问或交流，可加入 [Discord](https://discord.gg/zmR9N35cjK) 或 [提 issue](https://github.com/opencut-app/opencut/issues)。

### 10.3 安全

- 发现漏洞请发邮件至 **security@opencut.app**，**不要**通过公开 GitHub Issue 报告（[.github/SECURITY.md](.github/SECURITY.md)）。
- 报告请包含：漏洞描述、复现步骤、潜在影响、建议的修复方式。
- 响应承诺：48 小时内确认收到，5 个工作日内给出详细回复，并持续同步进展。
- 常规求助见 [.github/SUPPORT.md](.github/SUPPORT.md)，Issue 模板见 [bug_report.yml](.github/ISSUE_TEMPLATE/bug_report.yml) 与 [feature_request.yml](.github/ISSUE_TEMPLATE/feature_request.yml)，并遵守行为准则 [CODE_OF_CONDUCT.md](.github/CODE_OF_CONDUCT.md)。

---

## 十一、注意事项与已知的脚手架痕迹

阅读代码时容易踩的几点，集中列出：

1. **别把 `changelog/` 当成重写版进度**：0.1.0（2026-02-23 编辑器基础）、0.2.0（2026-03-01 动效与特效）、0.3.0（2026-04-15 蒙版、曲线编辑器等）都属于经典版。不过 0.3.0 的 `technical` 条目透露了重写动机：时间改用 Rust 的 `MediaTime`（120,000 ticks/秒）、WebGL 渲染器换成 Rust/wgpu + WASM 合成器、新增 GPUI 桌面端、Web 端改用 Cloudflare Workers 部署。
2. **Web 站点仍有模板残留**：`public/manifest.json` 里还是 `TanStack App` / `Create TanStack App Sample`；`__root.tsx` 的标题是 `OpenCut rewrite | beta.opencut.app`，而 `wrangler.jsonc` 绑定的域名是 `new.opencut.app`。
3. **`moon run media:setup` 目前可能不可用**：`setup.ts` 注释和 workflow 注释都提到它，但 `crates/media/` 下并没有 `moon.yml`，`Cargo.toml` 的 `members` 里 `'crates/*'` 也被注释掉了；需要时请直接运行 `bun run crates/media/setup/setup.ts`。同理，workflow 注释提到的 `crates/media/setup/pin.ts` 也尚未出现在仓库中。
4. **`.cache/media`（FFmpeg 构建缓存目录）未写入 `.gitignore`**：本地执行 setup 脚本后注意不要把缓存产物提交进仓库。
5. **测试覆盖仍很薄**：Web 端配置了 `vitest`，但仓库里还没有 `*.test.*` / `*.spec.*` 文件；目前只有 Rust 侧 `theme.rs` 与 `resizable.rs` 中的少量单元测试。
6. **Windows 环境**：proto shim 若被策略拦截，按 5.1 设置 `RemoteSigned`；`setup.ts` 在 Windows 上特意使用系统自带的 `System32\tar.exe`，以避免 Git Bash 的 GNU tar 把 `C:` 误认成远程主机。

---

## 十二、相关链接

| 资源 | 地址 |
| --- | --- |
| 中文路线图与交互式看板（本地文档） | [roadmap/README.md](roadmap/README.md)、[roadmap/HOTSPOTS.md](roadmap/HOTSPOTS.md)、[roadmap/dashboard.html](roadmap/dashboard.html) |
| 正式站点（经典版） | <https://opencut.app> |
| 重写版预览 | <https://new.opencut.app> |
| 经典版仓库 | <https://github.com/opencut-app/opencut-classic> |
| 本仓库（上游） | <https://github.com/opencut-app/OpenCut> |
| Discord 社区 | <https://discord.gg/zmR9N35cjK> |
| X / Twitter | <https://x.com/opencutapp> |
| GPUI（桌面端 UI 框架） | <https://www.gpui.rs> |
| proto / moon | <https://moonrepo.dev/proto> · <https://moonrepo.dev/moon> |
| 赞助联系 | <sponsor@opencut.app> |

**赞助商**：OpenCut 由相信开源创作工具的公司支持，目前包括 [**fal.ai**](https://fal.ai?utm_source=github-opencut&utm_campaign=oss)（生成式图像、视频、音频模型平台）。希望出现在这里可邮件联系 sponsor@opencut.app。

---

## 十三、许可证

- 本仓库代码：[MIT](LICENSE)，Copyright 2026 OpenCut。
- 注意区分：`crates/media/setup/ffmpeg.json` 固定的 FFmpeg 依赖是 **LGPL-2.1-or-later**，其构建产物会随附 `COPYING.LGPLv2.1`、`LICENSE.md` 与 `BUILD.md`；分发含该依赖的产物时需遵守对应条款。
