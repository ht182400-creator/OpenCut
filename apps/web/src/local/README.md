# Web 端本地扩展隔离目录

本目录是 `roadmap/COMPAT.md` 约定的**隔离命名空间**，用于放置本地新增的页面、组件与 `editor-api` 的 TypeScript 适配层，避免与上游未来落地的 `apps/web/src/components`、`apps/web/src/routes` 冲突。

规则：

- 本地代码只能通过 `editor-api` 适配层访问 core（不变量 I-01），禁止直接引用 `local/crates/ocx-*` 内部类型；
- 不修改上游既有路由与组件；新增能力使用独立路由与带前缀的组件名；
- 命名空间与能力清单见 `roadmap/compat-contract.json`；
- 同一时刻只允许一个 core 后端被注册（I-05）。

当前为占位（W-02 建立目录），计划自 **W-06**（Web 绑定薄层 + 最小时间轴）起填充。
