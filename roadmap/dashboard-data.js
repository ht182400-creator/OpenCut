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
  { id: "H01", title: "GPUI(blade) 与 wgpu 纹理不互通", priority: "P0", milestone: "M1", status: "阻塞", action: "【2026-11-14 校准】仍阻塞 W-14 桌面 GPUI：Q01/ADR-04 未产出，离屏 readback spike 未做；CPU 帧路径与跨栈像素一致已由 Headless CLI 验证（与 GPU 纹理无关）" },
  { id: "H02", title: "领域逻辑翻译缺回归网", priority: "P0", milestone: "M2", status: "已完成", action: "【2026-11-14 校准】四套对齐 107/88/100/64 全绿，经典版项目读写闭环（W-05 五批）、官方 OTIO 实文件往返 42/42（W-10 六批），命令层版本化 schema 已由 W-11 冻结" },
  { id: "H03", title: "本机工具链缺失且版本不符", priority: "P0", milestone: "M0", status: "已完成", action: "proto 0.63.2 已纳管 bun/moon/rust；moon 官方包校验通过；无需 FORCE_GLOBALS 旁路" },
  { id: "H04", title: "上游架构未定，长期分叉风险", priority: "P1", milestone: "全程", status: "进行中", action: "落地新增优先 + 差异台账 + git rerere，每 2~4 周小步同步" },
  { id: "H05", title: "原生 Rust 渲染路径从未验证", priority: "P0", milestone: "M1", status: "未开始", action: "【2026-11-14 校准】CPU 帧路径已验证：Headless CLI 与 WASM core 同帧同指纹（MCP 18/18）；仍未做 GPU 纹理 render_frame_to_texture → Vec<u8> 用例与原生 CI" },
  { id: "H06", title: "workspace 未启用 crates/*", priority: "P0", milestone: "M0", status: "进行中", action: "七个 ocx-* crate 已在隔离目录编译通过，rust 1.97 与 moon ci 已实跑；剩余上游 crates/* 启用（按隔离策略待上游同步复核）" },
  { id: "H07", title: "插件运行时未选型", priority: "P1", milestone: "M3", status: "已完成", action: "【2026-11-14 校准】W-12 两批已选型并落地：契约层（manifest/权限/越权拒绝 13 项）+ 原生 WebAssembly 运行时（示例插件 116,313 B、真实调用 effect/command）；Extism/WIT 与 Rust 侧运行时后置" },
  { id: "H08", title: "MCP 规范版本与长任务模型", priority: "P2", milestone: "M5", status: "已完成", action: "【2026-11-14 校准】W-13 两批落地：本地 MCP server（stdio JSON-RPC、ocx.* 8 工具、18/18）、长任务 ocx.render.batch/status 可查进度、Headless CLI 跨栈像素一致" },
  { id: "H09", title: "许可证合规（MIT/LGPL/OFL）", priority: "P1", milestone: "全程", status: "未开始", action: "MIT 声明已由 NOTICE.md 保留；剩余 LGPL 随附与字体归属" },
  { id: "H10", title: "docs/ 被 .gitignore 忽略", priority: "P2", milestone: "M0", status: "已完成", action: "已改用 roadmap/，文档可随 fork 正常提交" },
  { id: "H11", title: "经典版 31 版项目迁移兼容", priority: "P1", milestone: "M4", status: "已完成", action: "【2026-11-14 校准】W-05 第五批写回闭环：read_classic_project + write_classic_project 按 id 合并、保留未知字段，project_write.rs 7 项 + Node WASM 契约验证读→改→写→再读" },
  { id: "H12", title: "4K 预览性能（代理/缓存/快照）", priority: "P2", milestone: "M4", status: "已完成", action: "【2026-11-14 校准】归属由 M6 修正为 M4（W-09 属媒体与导出闭环阶段）：三级缓存/代理 MP4/版本快照可跨刷新恢复；真实 3840×2160 素材 30 帧 scrub 峰值 0.9ms < 16ms 阈值达标" },
  { id: "H13", title: "上游落地六项能力导致双实现收敛（L3）", priority: "P1", milestone: "全程", status: "进行中", action: "按 README.md §7.9 做命名空间隔离、upstream-mirror、能力台账与 merge-tree 预演" },
  { id: "H14", title: "C→B 兼容层基石尚未落到代码", priority: "P0", milestone: "M0", status: "已完成", action: "【2026-11-14 校准】基石已落地（10 crate + editor-adapter 适配层 + MCP/插件/Headless CLI），标题所述风险解除；core 阶段收尾（剩余项暂停非完成）：W-05 五批 + W-07 四批 + W-08 六批 + W-09 四批 + W-10 六批 + W-11 一批 + W-12 两批 + W-13 两批落地经典版项目读写闭环、三容器导出、剪辑闭环、4K scrub、官方 OTIO 往返、契约冻结、插件 host 与原生 WASM 运行时、MCP server 与 Headless CLI（跨栈像素一致）；暂停项见 PRIORITY「core 阶段结论」，转经典版 UI 同步（三批信息架构同步完成）；随后按用户指示启动像素级 1:1 复刻，进度台账 UI_REPLICA_PLAN.md，批 0 基线固化已完成" },
  { id: "H15", title: "移动端可打开同一项目 JSON 未验证", priority: "P1", milestone: "M6", status: "未开始", action: "【2026-11-14 新增】W-15 移动端评估（UniFFI / flutter_rust_bridge 原型）完全未开始；core 阶段结论标为暂停，不得由 H12 的已完成状态误推导 M6 完成" },
  { id: "H16", title: "headless PNG 与桌面输出一致性未验证", priority: "P1", milestone: "M3", status: "未开始", action: "【2026-11-14 新增】Headless CLI 目前只输出 PPM（P6，零编码库），PNG/音频导出与桌面 GPUI 像素一致帧未做；M3 因此保持部分完成" },
  { id: "H17", title: "Rust core 迁入与跨栈像素一致", priority: "P0", milestone: "M1", status: "已完成", action: "【2026-11-14 新增】10 个隔离 crate 编译/测试全绿，WASM 绑定与浏览器共用 core，Headless CLI（Rust 原生）与 WASM 同帧同 FNV 指纹（MCP 18/18）；M1 剩余阻塞仅 H01 的 GPU 决策" },
];

/** 数据版本：页面显示该值，用于确认浏览器加载的是最新数据层。 */
const DATA_VERSION = "2026-11-08-r44";
const DATA_UPDATED_AT = "2026-11-14 18:10";
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
