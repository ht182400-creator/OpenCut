"use strict";

/**
 * 动态看板的数据层：里程碑、热点、开放问题与全部配置常量。
 * 数据来自 roadmap/README.md §6 与 roadmap/HOTSPOTS.md，ID 一一对应。
 * 本文件必须在 dashboard.js 之前加载（两者均为 defer，按文档顺序执行）。
 */

const STORAGE_KEY = "opencut-roadmap-dashboard-v1";
// v2：里程碑状态改为只读派生，不再持久化人工标记；旧版 localStorage 自动失效
const STATE_VERSION = 2;
const SVG_NS = "http://www.w3.org/2000/svg";
const MESSAGE_TIMEOUT_MS = 4000;
const STATUS_LIST = ["未开始", "进行中", "阻塞", "已完成"];
const STATUS_VAR = {
  "未开始": "--st-todo",
  "进行中": "--st-doing",
  "阻塞": "--st-blocked",
  "已完成": "--st-done",
};
const LAYOUT = {
  NODE_W: 152,
  NODE_H: 64,
  GAP_X: 54,
  ROW_GAP: 92,
  PAD_X: 28,
  PAD_Y: 30,
  SVG_WIDTH: 760,
  BADGE_R: 12,
};
// SVG 总高度由三行节点与两处行间距推导，避免写死数值
LAYOUT.SVG_HEIGHT = LAYOUT.PAD_Y * 2 + 3 * LAYOUT.NODE_H + 2 * LAYOUT.ROW_GAP;

/** 里程碑：row/col 为流程图坐标，deps 为关键路径依赖。 */
const MILESTONES = [
  { id: "M0", title: "基线与 CI", period: "T+0~3w", row: 0, col: 0, deps: [], dod: "三平台 moon ci 全绿且含真实用例；三个 dev 命令可访问" },
  { id: "M1", title: "迁入 Rust core", period: "T+3~7w", row: 0, col: 1, deps: ["M0"], dod: "11 个单测 + 原生离屏渲染用例通过；GPU spike 产出书面决策" },
  { id: "M2", title: "领域模型下沉", period: "T+7~15w", row: 1, col: 0, deps: ["M1"], dod: "Rust/TS golden 用例 100% 对齐；可读经典版项目 JSON" },
  { id: "M3", title: "Editor API 与绑定", period: "T+15~21w", row: 1, col: 1, deps: ["M2"], dod: "Web/桌面/headless 输出像素一致帧；headless 可导出 PNG" },
  { id: "M4", title: "媒体与导出闭环", period: "T+21~33w", row: 2, col: 0, deps: ["M3"], dod: "mp4 导入→剪辑→导出，帧数/时长/音画同步校验通过" },
  { id: "M5", title: "插件与 MCP", period: "T+33~41w", row: 2, col: 1, deps: ["M4"], dod: "插件越权被拒；MCP 客户端可完成打开→剪辑→导出；长任务可查进度" },
  { id: "M6", title: "生态与移动端", period: "T+41~60w", row: 2, col: 2, deps: ["M5"], dod: "跨 NLE 往返不丢剪辑决策；移动端可打开同一项目" },
];

/** 热点：与 HOTSPOTS.md §1 的 H 编号一致；milestone 为「全程」时不计入单里程碑完成度。 */
const HOTSPOTS = [
  { id: "H01", title: "GPUI(blade) 与 wgpu 纹理不互通", priority: "P0", milestone: "M1", status: "阻塞", action: "M1 做离屏 readback spike，记录 1080p 单帧耗时并定 ADR-04" },
  { id: "H02", title: "领域逻辑翻译缺回归网", priority: "P0", milestone: "M2", status: "进行中", action: "W-05 四批：ripple + placement + animation + keyframe-query/项目兼容，共 97 个跨语言用例（64/64、100/100、88/88、107/107）；剩余命令层" },
  { id: "H03", title: "本机工具链缺失且版本不符", priority: "P0", milestone: "M0", status: "已完成", action: "proto 0.63.2 已纳管 bun/moon/rust；moon 官方包校验通过；无需 FORCE_GLOBALS 旁路" },
  { id: "H04", title: "上游架构未定，长期分叉风险", priority: "P1", milestone: "全程", status: "进行中", action: "落地新增优先 + 差异台账 + git rerere，每 2~4 周小步同步" },
  { id: "H05", title: "原生 Rust 渲染路径从未验证", priority: "P0", milestone: "M1", status: "未开始", action: "补 render_frame_to_texture → Vec<u8> 用例与原生 CI" },
  { id: "H06", title: "workspace 未启用 crates/*", priority: "P0", milestone: "M0", status: "进行中", action: "隔离目录与两个 crate 已迁入并编译通过；剩余 build.rs 与 moon ci 验证" },
  { id: "H07", title: "插件运行时未选型", priority: "P1", milestone: "M3", status: "未开始", action: "M2 期间并行做 Extism spike，验证 wasm32 与原生双目标" },
  { id: "H08", title: "MCP 规范版本与长任务模型", priority: "P2", milestone: "M5", status: "未开始", action: "按 2026-07-28 规范实现，Tasks extension 承载长导出" },
  { id: "H09", title: "许可证合规（MIT/LGPL/OFL）", priority: "P1", milestone: "全程", status: "未开始", action: "MIT 声明已由 NOTICE.md 保留；剩余 LGPL 随附与字体归属" },
  { id: "H10", title: "docs/ 被 .gitignore 忽略", priority: "P2", milestone: "M0", status: "已完成", action: "已改用 roadmap/，文档可随 fork 正常提交" },
  { id: "H11", title: "经典版 31 版项目迁移兼容", priority: "P1", milestone: "M4", status: "进行中", action: "只读兼容层已落地（additive-only、25 用例 / 107/107、/editor 加载真实项目）；剩余写回与迁移测试" },
  { id: "H12", title: "4K 预览性能（代理/缓存/快照）", priority: "P2", milestone: "M6", status: "进行中", action: "W-09 两批：内存 LRU + IndexedDB 三级缓存、代理 MP4，跨刷新 11733ms→107ms，单帧 <16ms 阈值；剩余真实 4K 素材基准与版本快照" },
  { id: "H13", title: "上游落地六项能力导致双实现收敛（L3）", priority: "P1", milestone: "全程", status: "进行中", action: "按 README.md §7.9 做命名空间隔离、upstream-mirror、能力台账与 merge-tree 预演" },
  { id: "H14", title: "C→B 兼容层基石尚未落到代码", priority: "P0", milestone: "M0", status: "进行中", action: "W-10 第一批：ocx-io 实现 OTIO 双向交换与版本化 schema，WASM 契约 57/57；七个 crate 全绿，剩余 Web 端 OTIO 导入导出 UI" },
];

/** 数据版本：页面显示该值，用于确认浏览器加载的是最新数据层。 */
const DATA_VERSION = "2026-11-08-r21";
const DATA_UPDATED_AT = "2026-11-09 21:30";
const DECISION_STATUS = { OPEN: "待决", DECIDED: "已决" };

/**
 * 决策台账：与 HOTSPOTS.md §4 的 Q 编号一一对应。
 * status 为「待决 / 已决」；已决项必须填写 decision 与 source，
 * 与 compat-contract.json 的 decisions 保持一致（由 compat.test.cjs 交叉校验）。
 */
const QUESTIONS = [
  { id: "Q01", text: "桌面 GPU 后端走哪条路？（readback / 独立窗口 / 换后端）", status: DECISION_STATUS.OPEN, due: "M1 结束", decision: "", source: "HOTSPOTS.md" },
  { id: "Q02", text: "移动端 UI 用 Flutter 还是原生？", status: DECISION_STATUS.OPEN, due: "M6 开始前", decision: "", source: "HOTSPOTS.md" },
  { id: "Q03", text: "现在引入 Loro CRDT 吗？", status: DECISION_STATUS.OPEN, due: "M2 结束", decision: "", source: "HOTSPOTS.md" },
  { id: "Q04", text: "插件运行时用 Extism 还是自研 Component Model？", status: DECISION_STATUS.OPEN, due: "M2 并行 spike", decision: "", source: "HOTSPOTS.md" },
  { id: "Q05", text: "OTIO 作为原生格式还是仅交换格式？", status: DECISION_STATUS.OPEN, due: "M2 开始前", decision: "", source: "HOTSPOTS.md" },
  { id: "Q06", text: "上游若落地官方 Editor API，本地是否切换？", status: DECISION_STATUS.OPEN, due: "上游发布时", decision: "已有决策框架（README §7.9 / COMPAT §6），最终路线待发布时按判据打分", source: "COMPAT.md" },
  { id: "Q07", text: "Web 导出继续用 WebCodecs 还是统一走 FFmpeg-WASM？", status: DECISION_STATUS.DECIDED, due: "2026-11-08 已决", decision: "WebCodecs（Web）+ 原生 FFmpeg（桌面/headless）；Rust core 出 RenderFrame + ExportProfile", source: "PRIORITY.md" },
  { id: "Q08", text: "是否把 .codebuddy/ 加入 .gitignore？", status: DECISION_STATUS.DECIDED, due: "2026-11-08 已决", decision: "不加入 .gitignore；开发记录已显式纳入版本控制并推送到 GitHub 与 Forgejo", source: "PRIORITY.md" },
];
