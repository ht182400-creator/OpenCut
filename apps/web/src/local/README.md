# Web 端本地扩展隔离目录

本目录是 `roadmap/COMPAT.md` 约定的**隔离命名空间**，用于放置本地新增的页面、组件与 `editor-api` 的 TypeScript 适配层，避免与上游未来落地的 `apps/web/src/components`、`apps/web/src/routes` 冲突。

规则：

- 本地代码只能通过 `editor-api` 适配层访问 core（不变量 I-01），禁止直接引用 `local/crates/ocx-*` 内部类型；
- 不修改上游既有路由与组件；新增能力使用独立路由与带前缀的组件名；
- 命名空间与能力清单见 `roadmap/compat-contract.json`；
- 同一时刻只允许一个 core 后端被注册（I-05）。

**状态更新（2026-11-26）**：已完全填充，不再是占位。现有 60+ 个文件，包括：
- `editor-page.tsx` / `editor-adapter.ts`：编辑器编排层与 core 适配层（I-01 单一入口）；
- `caption-import.ts` / `export.ts` / `media.ts` / `audio.ts`：字幕导入、导出编码、素材解码；
- `autosave-idb.ts` / `project-write.ts` / `clip-history.ts`：持久化、写回、撤销重做；
- `classic-ui/`：经典版 9-tab 全套面板（含 `script-console.tsx` 脚本控制台，挂载于 `/core-lab`）；
- 58 个 `.test.ts(x)` 单测文件（696 项），V8 覆盖率单测口径四项过 80% 硬门禁。

上述隔离规则（I-01/I-05、不改上游路由、独立命名空间）仍全部生效。
