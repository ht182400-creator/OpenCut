# 热点进程文档 · OpenCut Rust 重写版

> **用途**：跟踪当前最该被关注的技术热点、阻塞点、关键路径与进度变化。与 [`dashboard.html`](dashboard.html) 的看板 **ID 一一对应**，改动请两边同步。
> **当前快照**：2026-11-08（初始化，尚未开始编码）。
> **配套**：总纲见 [`README.md`](README.md)；决策留痕见 `../.codebuddy/memory/2026-11-08.md`。

---

## 0. 维护约定

| 规则 | 说明 |
| --- | --- |
| 更新时机 | 每完成一个动作、每次上游同步、每个里程碑结束、每次架构决策变更后 **当天** 更新 |
| ID 稳定 | `H01…` 热点、`M0…M6` 里程碑、`Q01…` 开放问题一旦分配不得复用或重排 |
| 状态取值 | `未开始` / `进行中` / `阻塞` / `已完成` / `已关闭`（与看板下拉一致） |
| 证据要求 | 每条热点必须写「证据」：文件路径、行号、命令输出或官方链接，**不写无依据的猜测** |
| 验收要求 | 「验收」必须是可观测条件（CI 全绿、像素一致、测试通过、文档更新），不写「基本可用」 |
| 双写 | 看板勾选状态后，用「导出 JSON」把结果回填本文件 §3 进度台账；反之改了本文件要在看板手动同步 |

---

## 1. 当前热点（按阻塞度排序）

| ID | 热点 | 等级 | 状态 | 影响面 | 证据 | 下一步动作 | 验收条件 | 更新日期 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **H01** | GPUI(blade) 与 wgpu 纹理不互通 | P0 | 阻塞 | 桌面端整体架构 | 本仓库 `Cargo.lock` 中 `gpui 0.2.2` 依赖 `blade-graphics/blade-macros/blade-util`，无 `wgpu`；经典版 `Cargo.lock` 为 `wgpu 29.0.1` | M1 做 spike：`render_frame_to_texture` → CPU readback → GPUI 显示，记录 1080p 单帧耗时 | 产出实测数据与「readback / 独立 wgpu 窗口 / 换后端」的书面决策，写入 ADR-04 | 2026-11-08 |
| **H02** | 4.6 万行领域逻辑翻译缺回归网 | P0 | 未开始 | M2 全部 | 经典版仅 30 个 `bun:test`，集中在纯函数与 31 版存储迁移；`EditorCore`/命令/undo/ripple 无系统级测试 | 先做 golden master：把经典版 fixtures 转成 JSON 数据驱动用例，TS/Rust 同输入同输出 | `cargo test --workspace` 中 golden 用例 100% 对齐，覆盖空值/极值/异常分支 | 2026-11-08 |
| **H03** | 本机工具链缺失且版本不符 | P0 | 阻塞 | 所有本地验证 | 实测：`bun`/`moon`/`proto` 均 NOT FOUND；`node_modules` 不存在；`rustc 1.96.0` 低于 `.prototools` 的 `1.97.0` | 安装 proto → `proto use` → `bun install`，逐个跑 `moon run web:dev / api:dev / desktop:dev` | 三个 dev 命令可访问；`moon ci` 在本机通过 | 2026-11-08 |
| **H04** | 上游架构仍在设计中，长期分叉风险 | P1 | 进行中 | fork 可维护性 | 官方 README（2026-11-08 抓取）仍为 "What's coming"，明说架构设计中、不收外部贡献 | 落地 §7 的「新增优先 + 隔离目录 + 差异台账」；启用 `git rerere`；每 2~4 周小步同步 | `README.md` §7.7 台账与 `git remote -v` 一致；每次同步后 `moon ci` 全绿 | 2026-11-08 |
| **H05** | 原生 Rust 渲染路径从未验证 | P0 | 未开始 | 桌面端可用性 | 经典版 `apps/desktop/src/main.rs` 仅 42 行且不引用任何 crate；`rust/README.md:29` 只是设计意图；CI 测试步骤是 `echo "No tests implemented yet"`；`GpuContext::try_gl_fallback` 原生直接返回错误 | M1 补 `render_frame_to_texture → Vec<u8>` 用例与原生 CI 任务 | `cargo test --workspace` 包含原生离屏渲染用例，三平台 CI 通过 | 2026-11-08 |
| **H06** | workspace 尚未启用 `crates/*` | P0 | 进行中 | 所有 crate 迁移 | **已完成**：根 `Cargo.toml` 追加 `'local/crates/*'`、`.moon/workspace.yml` 追加 glob、迁入 `ocx-time`/`ocx-bridge` 并编译通过、两个 `moon.yml` 已定义 | 剩余：`crates/media/build.rs` 待写；`moon ci` 待安装 moon 后验证；rust 待升级到 1.97 | `cargo test -p ocx-time -p ocx-bridge` 全绿（已达成）；`moon ci` 含 Rust 任务并全绿（待验证） | 2026-11-08 |
| **H07** | 插件运行时未选型 | P1 | 未开始 | M5 与「一等插件」路线图 | 调研：Extism 官方默认沙箱/能力限额；WIT Component Model 类型化接口；Figma Realms 的 API 可替换原则 | M2 期间并行做 Extism spike（不占关键路径），验证 wasm32 与原生双目标 | 产出对比数据与 ADR-03 结论；示例插件越权被拒 | 2026-11-08 |
| **H08** | MCP 规范版本与长任务模型 | P2 | 未开始 | AI Agent / headless | 官方规范 `2026-07-28`：无状态、`server/discover`、Tools/Resources/Prompts、**Sampling/Logging 已弃用**、Tasks extension 承载长请求 | M5 按官方映射实现，避免照抄旧版教程 | MCP 客户端可完成「打开→剪辑→导出」，长导出可查进度 | 2026-11-08 |
| **H09** | 许可证合规三项 | P1 | 未开始 | 分发合法性 | 经典版 MIT © 2025-2026 vs 重写版 © 2026（已由 `local/crates/NOTICE.md` 保留声明）；FFmpeg 8.1.3 LGPL-2.1-or-later；字体 sprite 无 OFL 声明 | M4 校验 LGPL 随附；补齐字体归属文件 | 产物含 `BUILD.md`/`COPYING.LGPLv2.1`；字体归属文件齐备 | 2026-11-08 |
| **H10** | `docs/` 被 `.gitignore` 忽略 | P2 | 已完成 | 文档可同步性 | 本仓库 `.gitignore:7` 为 `docs/` | 已改用 `roadmap/` 目录 | 本文与看板位于 `roadmap/` 且 `git status` 可见 | 2026-11-08 |
| **H11** | 经典版 31 版项目迁移兼容 | P1 | 未开始 | 老用户数据 | 经典版 `migrations/index.ts` 为 `CURRENT_PROJECT_VERSION = 31`，`migrations/AGENTS.md` 规定 additive-only | M4 写只读兼容层，字段只增不删 | 经典版导出的项目 JSON 能被新 core 打开且剪辑决策不丢失 | 2026-11-08 |
| **H12** | 4K 预览性能（代理/缓存/快照） | P2 | 未开始 | 使用体验 | 调研：Olive 代理剪辑与 90 秒版本快照、Kdenlive 代理任务、OpenShot 3.5.1 Optimize Preview | M4 引入代理文件 + 预览帧缓存；M6 加时间线版本快照 | 4K 素材 scrub 无卡顿（设定量化阈值后再测），快照可回溯 | 2026-11-08 |
| **H13** | 上游落地六项能力导致双实现收敛（L3） | P1 | 进行中 | 全部 M3~M5 能力 | 官方 README 的 Editor API / 插件优先 / Rust core 多端 / MCP / Headless / scripting 与本地计划完全重叠；Git 能自动合并但会产生静默语义冲突 | 按 `README.md` §7.9 先做命名空间隔离（`local/crates/*`、`ocx.*` 工具前缀）、建 `upstream-mirror`、填能力级台账；落地当天用 `git merge-tree --write-tree` 预演 | 六行能力台账填齐（含上游真实路径/SHA）；预演退出码已记录；决策门选定路线；`moon ci` + 三端冒烟全绿 | 2026-11-08 |
| **H14** | **C→B 兼容层基石尚未落到代码**（用户指定为基石） | P0 | 进行中 | 所有本地能力 | **已完成**：`local/crates/ocx-*` 与 `apps/web/src/local/` 隔离目录、`COMPAT.md` 契约、`compat-contract.json` + 45 项契约测试全绿；`ocx-time`/`ocx-bridge` 已迁入并编译通过 | 剩余：W-03 的 `EditorApi`/`Command` trait、WIT 插件契约、TS 适配层；`moon ci` 待工具链 | `node compat.test.cjs` 全绿；`cargo test -p ocx-time` 全绿；本地新增资产全部在隔离路径；无绕过适配层的 import | 2026-11-08 |

**热点分布**：P0 = 6 项（H01/H02/H03/H05/H06/H14）、P1 = 6 项、P2 = 3 项（含已完成的 H10，共 14 项）。**当前关键阻塞是 H03（缺 bun/moon/proto、rust 1.96）→ H01/H05（桌面 GPU 路径）**；H06/H14 已由「未开始」推进到「进行中」（W-02/W-04 真实代码落地）；H13 属未来触发型风险。

---

## 2. 关键路径

```mermaid
flowchart LR
    H03[环境就绪] --> H06[启用 crates] --> H05[原生渲染验证] --> H01[GPU 栈决策] --> H02[golden 回归网] --> M2[M2 领域模型] --> M3[M3 Editor API] --> M4[M4 导出闭环]
    H07[插件 spike] -.->|并行不占关键路径| M3
    H08[MCP 原型] -.->|并行| M3
    H09[合规] -.->|全程| M4
    H04[fork 隔离] -.->|全程| M4
```

- **关键链**：`H03 → H06 → H05 → H01 → H02 → M2 → M3 → M4`，对应 M0~M4（T+0~33 周）。
- **可并行**：H07（插件 spike）、H08（MCP 原型）、H10（已完成）、H12（性能设计）、OTIO 适配器原型。
- **全程约束**：H04（fork 隔离）与 H09（合规）不设独立里程碑，但每个里程碑的 DoD 都要复核。

---

## 3. 里程碑进度台账

| 里程碑 | 周期 | 状态 | 完成度 | 已完成内容 | 下一步 | 更新日期 |
| --- | --- | --- | --- | --- | --- | --- |
| **M0** | T+0~3w | 进行中 | 15% | 完成现状评审、先进方案调研、对比矩阵、路线图、fork 策略、文档体系与动态看板（全部为文档资产） | 安装工具链、启用 `crates/*`、接通 CI | 2026-11-08 |
| **M1** | T+3~7w | 未开始 | 0% | — | 迁入 `time`/`bridge`；GPU spike | 2026-11-08 |
| **M2** | T+7~15w | 未开始 | 0% | — | 建 golden master，再动领域翻译 | 2026-11-08 |
| **M3** | T+15~21w | 未开始 | 0% | — | editor-api + 绑定层 | 2026-11-08 |
| **M4** | T+21~33w | 未开始 | 0% | — | 媒体解码与导出闭环 | 2026-11-08 |
| **M5** | T+33~41w | 未开始 | 0% | — | 插件体系 + MCP | 2026-11-08 |
| **M6** | T+41~60w | 未开始 | 0% | — | OTIO / 移动端 / 协同评估 | 2026-11-08 |

> 完成度由看板按「里程碑下热点/任务状态」自动计算；此处为 2026-11-08 的人工基线。

---

## 4. 开放问题（待决策）

| ID | 问题 | 候选 | 决策期限 | 状态 |
| --- | --- | --- | --- | --- |
| **Q01** | 桌面 GPU 后端走哪条路？ | 离屏 readback / 独立 wgpu 窗口 / 等 GPUI 换 wgpu | M1 结束 | 待 spike |
| **Q02** | 移动端 UI 用 Flutter 还是原生？ | Flutter + `flutter_rust_bridge` / 原生 + UniFFI | M6 开始前 | 开放 |
| **Q03** | 现在引入 Loro CRDT 吗？ | 引入 / 仅保持命令层可映射 | M2 结束 | 倾向「仅保持可映射」 |
| **Q04** | 插件运行时用 Extism 还是自研 Component Model？ | Extism / wasmtime + wit-bindgen / 混合 | M2 并行 spike | 待验证 |
| **Q05** | OTIO 作为原生格式还是仅交换格式？ | 双轨（推荐）/ 全用 OTIO | M2 开始前 | 倾向双轨 |
| **Q06** | 上游若落地官方 Editor API，本地是否切换？ | 切换并做适配层 / 继续自有 core / 双轨共存 | 上游发布时 | 已有决策框架（`README.md` §7.9 / `COMPAT.md` §6）；最终路线待发布时按判据打分 |
| **Q07** | Web 端导出继续用 WebCodecs 还是统一走 FFmpeg-WASM？ | WebCodecs / FFmpeg-WASM | **2026-11-08 已决** | **WebCodecs（Web）+ 原生 FFmpeg（桌面/headless）**；Rust core 出 `RenderFrame`+`ExportProfile`，见 `PRIORITY.md` §4 |
| **Q08** | 是否把 `.codebuddy/` 加入 `.gitignore`？ | 加入 / 不加入 | **2026-11-08 已决** | **不加入**（用户决定）；且开发记录 `.codebuddy/memory/2026-11-08.md` 已显式纳入版本控制并推送到 GitHub 与 Forgejo，见 `PRIORITY.md` §5 |

---

## 5. 更新日志

| 日期 | 变更 | 关联 |
| --- | --- | --- |
| 2026-11-08 | 通读重写版与经典版仓库，完成可行性评审与 M0~M5 路线图（对话中给出） | `.codebuddy/memory/2026-11-08.md` |
| 2026-11-08 | 检索 15+ 官方/社区资料（OTIO、Extism、MCP 2026-07-28、Loro、MLT、Remotion、Vello、Rust 媒体生态、fork 维护），抓取 4 个官方页面核实 | `README.md` §3 / §10 |
| 2026-11-08 | 建立 `roadmap/` 文档体系：总纲、热点进程、动态看板、CSS/JS；修正「`docs/` 被忽略」问题 | H10 已完成 |
| 2026-11-08 | 加载 `fork-repo-sync` skill，确定双 remote 同步流程与差异台账 | H04 / `README.md` §7 |
| 2026-11-08 | 核实上游官方 README 与本地一致，暂无待同步架构变更；实测两仓库 `Cargo.lock` 均被跟踪 | `README.md` §2 |
| 2026-11-08 | 看板按职责拆为数据层 / IO 层 / 主逻辑 / 样式，所有代码文件降至 500 行以内 | `README.md` §0 |
| 2026-11-08 | 新增 `dashboard.test.cjs` 回归测试：35 个断言全部通过（含边界与异常分支），日志带日期时间落盘到系统临时目录 | `README.md` §11 |
| 2026-11-08 | `readmCN.md` 补充路线图与看板导航链接 | H10 |
| 2026-11-08 | 核实 `git merge-tree --write-tree` 与 `.gitattributes` 官方用法，新增 §7.9 L3 收敛预案（六能力冲突矩阵、命名空间隔离、能力级台账）、风险 R11、ADR-09、热点 H13；Q06 已有决策框架，最终路线仍待上游发布时选定 | `README.md` §7.9 / H13 |
| 2026-11-08 | 落实四项用户决策：新增 `PRIORITY.md`（Web-first 15 项优先级表、W0~W5、导出后端决策）、`COMPAT.md`（兼容基石）、`compat-contract.json` + `compat.test.cjs`（41 断言全绿）；ADR-10~13、Q07/Q08 已决、新增 H14 | `README.md` §0/§9/§11 |
| 2026-11-08 | 看板数据同步 H13/H14 与 Q07/Q08 已决状态，回归测试期望同步更新 | `dashboard-data.js` / `dashboard.test.cjs` |
| 2026-11-08 | 修复「开放问题区显示旧文案」：根因为浏览器缓存旧 `dashboard-data.js` 且该区缺少状态/结论字段。已重构为**决策台账**（待决/已决徽章 + 结论 + 来源 + 筛选 + 统计），加脚本 `?v=20261108-r2` 缓存版本号、页首数据版本与「重新加载数据」按钮；新增契约↔看板交叉校验 | `dashboard.html` / `dashboard-data.js` / `dashboard.js` / `dashboard.css` |
| 2026-11-08 | 用户决定把开发记录 `.codebuddy/memory/2026-11-08.md` 也推到 GitHub 与 Forgejo；同步更新 D03 台账、`PRIORITY.md` §5、Q08、`dashboard-data.js`、`compat-contract.json`、`COMPAT.md` 中关于「排除推送」的旧表述 | `README.md` §7.5/§7.7 |
| 2026-11-08 | 用户提供 SSH 指纹线索用于排查（**指纹值不记录**）：核实为本机 SSH 公钥标识；GitHub 22 端口不通但 `ssh.github.com:443` 认证成功，新增备用远程 `github-ssh`，`ls-remote` 与 `push --dry-run` 均通过 | `README.md` §7.5 |
| 2026-11-08 | **安全纠正**：用户指出公钥指纹不得写入文档。已从 `README.md` / `HOTSPOTS.md` / 开发记录中清除全部指纹、公钥路径、本机用户名与主机名、绝对路径及账号名，并加入「禁止写入任何公钥/密钥指纹与本机标识」的清单 | `README.md` §7.5 禁止清单 |
| 2026-11-08 | 用户要求「默认就走 SSH」：`origin` URL 切换为 SSH over 443，`git push` 无参数即走 SSH；不设 `GIT_SSH_COMMAND` 时 `ls-remote` 与 `push --dry-run` 均返回 0；`upstream` 保持 HTTPS，`github-ssh` 保留为冗余备用 | `README.md` §7.5 |
| 2026-11-08 | **历史重写完成**（用户明确授权「彻底清除」）：以干净基底 `cb02a1cd`、当前树创建新提交 `93b8d4bd`，丢弃含敏感内容的三个提交；两端用 `--force-with-lease` 改写 `main`；本地 `reflog expire` + `gc --prune=now` 后三个旧对象均已删除，`git log --all` 0 命中 | `.codebuddy/memory/2026-11-08.md` |
| 2026-11-08 | **Web 版本改造开工（W-02/W-04）**：建立 `local/crates/ocx-time`、`ocx-bridge` 与 `apps/web/src/local/` 隔离目录；追加式启用 `Cargo.toml` members 与 `.moon/workspace.yml` glob；从经典版迁入 `time`/`bridge`（默认关闭 wasm、零浏览器依赖）；新增 40 个 JSON 数据驱动用例 + `CASES.md`；`cargo test` 12 测试函数、`fmt --check`、`clippy` 全绿。H06/H14 由「未开始」→「进行中」 | `PRIORITY.md` §2 进度快照 |

---

## 6. 下次更新必做

1. 装完工具链后把 **H03** 改为 `已完成`，并在更新日志留命令输出摘要。
2. M1 spike 结束后更新 **H01/H05**，同时把 ADR-04 从「待决」改为具体结论。
3. 每次 `merge upstream/main` 后，在更新日志追加一行「上游 SHA + 冲突文件 + CI 结果」，并复核 `README.md` §7.7 台账。
4. 用看板「导出 JSON」回填 §3 完成度，避免人工与看板状态漂移。
