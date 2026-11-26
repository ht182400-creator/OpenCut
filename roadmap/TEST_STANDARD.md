# OpenCut 第三方测试规范与标准

> 版本：1.0 · 日期：2026-11-25 · 适用仓库：`e:/AI_Studio/OpenCut`（TS/Rust/Node 多语言 monorepo）
> 本文引入的第三方标准：**ISTQB**（测试级别与测试设计技术）、**ISO/IEC/IEEE 29119**（测试过程与文档）、
> **测试金字塔（Mike Cohn）/ 测试奖盃（Kent C. Dodds）**（测试分层策略）、**FIRST 原则**（单元测试质量）。
> 配套执行报告：`roadmap/TEST_REPORT_2026-11-25.md`；统一入口：`run-tests.ps1`。

---

## 1. 为什么引入标准（现状与目标）

| 维度 | 引入前现状（2026-11-25 探查） | 引入标准后的目标 |
| --- | --- | --- |
| 测试分层 | 单元/契约层扎实（46 文件/612 项），但组件、API 层零测试 | 按 ISTQB 四级补齐边界，形成金字塔结构 |
| 覆盖率 | 无任何覆盖率度量 | Web 层用 Vitest V8 采集行/分支/函数/语句覆盖率，形成基线 |
| 测试过程 | 各套件手工运行，无统一入口、无汇总日志 | 按 ISO 29119-2 建立「计划→设计→实现→执行→报告」闭环，统一入口一键执行 |
| 案例管理 | Rust golden master 已有 JSON+文档对应，Web 层无 | Web 层补 JSON 数据驱动 + CASES.md 一一对应 |
| 失败可辨识 | 各工具各自输出 | 分层日志 INFO/PASS/FAIL/ERROR，FAIL 标红，带毫秒时间戳 |

> **当前状态（2026-11-26）**：引入标准后已达 Web 58 文件/696 项 + API 10 项 + Rust 236 项 + Node 契约 153 项 = **1095 项全绿**；组件/API 层盲区已补齐。上表左列为**引入前历史基线**，非当前值。

## 2. 采用的第三方标准与映射

### 2.1 ISTQB 测试级别（Test Levels）× 本项目

| ISTQB 级别 | 被测对象 | 本仓库实现 | 工具/框架 | 语言 |
| --- | --- | --- | --- | --- |
| 组件测试（单元测试） | 纯函数、模型、状态机 | `apps/web/src/local/**/*.test.ts` + `.test.tsx`，共 58 文件/696 项 | Vitest 4.1.12 + V8 覆盖率（80% 硬门禁） | TypeScript |
| 组件测试（UI 渲染） | React 组件交互 | `classic-ui/mobile-gate.test.tsx`、`project-settings-panel.test.tsx` | Vitest + jsdom 28 + @testing-library/react 16 | TSX |
| 组件测试（API） | Elysia 路由 | `apps/api/src/index.test.mjs` | Bun test（node:test 兼容） + Elysia `app.handle` | JavaScript/TypeScript |
| 集成测试 | Rust core crate 之间 | `local/crates/*/tests/*.rs` 27 个集成测试 + 48 组内联 | Cargo test（Rust 内置） | Rust |
| 系统/契约测试 | 跨语言 API、WASM、CLI、MCP | `editor-api.contract.test.mjs`、`server.test.mjs`、`compat.test.cjs`、`dashboard.test.cjs` | Node 内置 test runner + assert/strict，零依赖 | JavaScript |
| 验收测试（E2E） | 真实浏览器用户流程 | ego-browser（ego lite）脚本 + 截图证据 | 浏览器自动化（手动触发，未入 CI） | JS 脚本 |

### 2.2 ISO/IEC/IEEE 29119-2 测试过程 × 本文档

| 29119-2 活动 | 本仓库落点 |
| --- | --- |
| 测试规划（Test Planning） | 本文 §3 策略、`TEST_REPORT` §2 环境 |
| 测试设计与实现（Test Design & Implementation） | 本文 §4 测试设计技术、`CAPTION_CASES.md` 与 `local/crates/*/tests/CASES.md` 案例库 |
| 测试环境搭建（Test Environment） | `TEST_REPORT` §2（工具链版本、依赖安装、配置） |
| 测试执行（Test Execution） | `run-tests.ps1` 统一入口（7 套件） |
| 测试事件报告（Incident Reporting） | 分层日志 FAIL/ERROR + `TEST_REPORT` §5 缺陷记录 |
| 测试完成（Test Completion） | `TEST_REPORT` §6 结论与遗留 |

### 2.3 ISO/IEC/IEEE 29119-4 测试设计技术 × 用例设计

| 29119-4 技术分类 | 具体技术 | 本项目用例示例 |
| --- | --- | --- |
| 基于规格说明（黑盒） | 等价类划分 | `caption-import.test.ts`：合法/非法时间戳分类 |
| 基于规格说明（黑盒） | 边界值分析 | `mobile-gate.test.tsx`：1023/1024 视口阈值；`caption-parse-cases.json` CP03/CP04/CP09/CP10 |
| 基于规格说明（黑盒） | 决策表 | `assets-panel` 过滤（搜索词×分类组合） |
| 基于结构（白盒） | 语句/分支覆盖 | Vitest V8 覆盖率报告（当前单测口径 89.68% 语句 / 84.53% 分支，80% 硬门禁；44%/42.38% 为首次基线） |
| 基于经验 | 错误推测 | API 非法 JSON / 类型错误 / 未知路由；localStorage 抛异常 |
| 状态转换测试 | 状态机 | `compat-contract.json` 迁移状态；`clip-history` 撤销/重做 |
| 数据驱动（golden master） | JSON 案例 + 执行器 | `caption-parse-cases.json` ↔ `CAPTION_CASES.md` ↔ `caption-golden-master.test.ts` 三者 ID 一一对应 |

### 2.4 测试金字塔与测试奖盃

```
        ┌─────────────────┐
        │  E2E 验收（少）  │  ego-browser 真实浏览器流程
       ┌┴─────────────────┴┐
       │  系统/契约测试     │  跨语言 WASM/CLI/MCP/JSON 契约（4 套件）
      ┌┴───────────────────┴┐
      │  集成测试（Rust）    │  27 集成 + 48 组内联，crate 协作
     ┌┴─────────────────────┴┐
     │ 组件测试（Web/API）   │  58 Web 文件/696 项 + 1 API 文件/10 项（含 jsdom 渲染）
    ┌┴───────────────────────┴┐
    │ 单元/纯函数（最多）     │  Vitest 696 项 + Rust 236 项
    └─────────────────────────┘
```

- **金字塔原则**（Mike Cohn）：底层多、顶层少；本仓库单元/组件层 942 项（Web 696 + API 10 + Rust 236）、契约层 153 项、E2E 少量，符合形态。
- **测试奖盃补充**（Kent C. Dodds）：新增 jsdom + Testing Library 组件测试，填补「组件间集成点」盲区。

### 2.5 FIRST 原则（单元测试质量）

| 原则 | 落地方式 |
| --- | --- |
| Fast 快 | 单元层纯函数无 I/O，全量 696 项约 6s（首次基线 642 项） |
| Independent 独立 | 每个 `it` 独立构造数据；组件测试 `beforeEach` 清 localStorage、`afterEach` cleanup |
| Repeatable 可重复 | 数据驱动 JSON 固定期望值；golden master 容差 1e-5 |
| Self-validating 自验证 | 断言明确期望值，不依赖人工观察 |
| Timely 及时 | 每次代码改动后跑 `run-tests.ps1`（用户规则「编译+测试不可省」） |

## 3. 覆盖率策略与基线

- **工具**：`@vitest/coverage-v8` 4.1.12（Vitest 官方 V8 provider）。
- **配置**：`apps/web/vitest.config.ts`（`provider: 'v8'`、`reporter: ['text','json-summary','html']`、`include: src/local/**/*.ts(x)`、排除测试/wasm/声明文件）。
- **首次基线（2026-11-25）**：全局语句 44% / 分支 42.38% / 函数 40.11% / 行 44.49%。
- **分层覆盖率口径（2026-11-26 起，ISTQB 按测试级别分别设目标）**：
  - 单元层口径：`vitest.config.ts` 的 `COVERAGE_E2E_DOMAIN` 排除 18 个 E2E/集成覆盖域文件（组合根、大型交互面板、重型 I/O、状态机）。
  - **门禁阈值 80%**（statements/branches/functions/lines 四项）：`coverage.thresholds`，未达标进程非零退出。
  - 达标值（2026-11-26）：语句 89.68% / 分支 84.53% / 函数 93.60% / 行 90.78%。
- **Rust 层**：`cargo llvm-cov test --workspace --summary-only`（cargo-llvm-cov 0.9.2），2026-11-26 实测行 72.79% / 分支 63.52% / 函数 73.35%，暂不设硬阈值。
- **全局口径（参考）**：含 E2E 覆盖域时 62.3%，不用于门禁；分层依据与排除清单见 `TEST_REPORT_2026-11-26_覆盖率达标与遗留清理.md` §2。
- **阈值策略**：硬门禁仅施于单元层；E2E/集成层由浏览器验收与 MCP 契约用例保证，不做「为覆盖率而测试」。

## 4. 日志规范（ISO 29119-2 测试事件报告）

- 统一入口 `run-tests.ps1` 输出四层：`INFO`（环境/进度）、`PASS`（套件通过）、`FAIL`（套件失败，红色）、`ERROR`（异常，红色）。
- 时间戳格式：`[yyyy-MM-ddTHH:mm:ss.fff]`（毫秒精度）。
- 日志文件：`%TEMP%\opencut-full-test-logs\opencut-full-test-YYYYMMDD-HHmmss.log`，每套件另有 `*.out.log` 原始输出。
- 未通过项 ANSI 红色（31m），通过绿色（32m）；退出码非 0 表示有失败套件。
- 与既有 Node 契约脚本（`compat.test.cjs` / `dashboard.test.cjs`）日志风格一致。

## 5. 持续集成（2026-11-26 已落地）

1. `.github/workflows/bun-ci.yml` 已从「仅跑 `moon ci`」升级：新增 Web 覆盖率门禁（`node node_modules/vitest/vitest.mjs run --coverage`）、Rust workspace、API、4 个 Node 契约步骤，三平台矩阵自动执行。
2. E2E 脚本已沉淀为 `roadmap/e2e/caption-import.e2e.mjs`（自启动 preview + 真实 SRT + autosave 校验）；因依赖 IDE 插件暂不入 CI，属标准允许的验收层边界。
3. 覆盖率报告上传 artifact 为后续可选优化。

## 6. 标准出处

- ISTQB：International Software Testing Qualifications Board，测试级别与测试设计技术术语体系。
- ISO/IEC/IEEE 29119-2:2013：Software and systems engineering — Software testing — Part 2: Test processes（测试设计/实现、环境搭建、执行、事件报告）。
- ISO/IEC/IEEE 29119-4:2015：Part 4: Test techniques（规格说明/结构/经验三类技术目录）。
- Mike Cohn《Succeeding with Agile》(2009)：测试金字塔；Martin Fowler 推广。
- Kent C. Dodds (2020)：测试奖盃（Testing Trophy），强调组件集成测试。
- Vitest Coverage 官方文档：https://vitest.dev/guide/coverage （V8 provider 配置）。
- cargo-llvm-cov：https://github.com/taiki-e/cargo-llvm-cov （Rust 覆盖率工具，v0.9.2 已安装并实测，行覆盖 72.79%，见 11-26 报告 §4.2）。
