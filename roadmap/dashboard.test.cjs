"use strict";

/**
 * 动态看板回归测试（零依赖，Node 直接运行）：node dashboard.test.cjs
 * 覆盖：数据完整性、状态机、进度计算、持久化往返、渲染、导入导出、异常与边界。
 * 日志分层输出到控制台，未通过项标红，同时写入系统临时目录（文件名带日期时间）。
 */

const fs = require("node:fs");
const vm = require("node:vm");
const os = require("node:os");
const path = require("node:path");

const SCRIPT_FILES = ["dashboard-data.js", "dashboard-metrics.js", "dashboard-io.js", "dashboard.js"];
const ANSI_RED = "\u001b[31m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_RESET = "\u001b[0m";
const EXPECTED_MILESTONES = 7;
const EXPECTED_HOTSPOTS = 14;
const EXPECTED_QUESTIONS = 8;
const LOG_LINES = [];
let PASS_COUNT = 0;
let FAIL_COUNT = 0;

/**
 * 记录分层日志。
 * @param {string} level 日志级别
 * @param {string} message 内容
 * @param {string} color ANSI 颜色
 * @returns {void}
 */
function log(level, message, color) {
  const line = `[${new Date().toISOString()}] ${level.padEnd(5)} ${message}`;
  LOG_LINES.push(line);
  console.log(`${color || ""}${line}${ANSI_RESET}`);
}

/**
 * 断言相等并记录结果。
 * @param {string} name 用例名
 * @param {unknown} actual 实际值
 * @param {unknown} expected 期望值
 * @returns {void}
 */
function assertEqual(name, actual, expected) {
  if (Object.is(actual, expected)) {
    PASS_COUNT += 1;
    log("PASS", `${name} => ${String(actual)}`, ANSI_GREEN);
  } else {
    FAIL_COUNT += 1;
    log("FAIL", `${name} => 实际 ${String(actual)}，期望 ${String(expected)}`, ANSI_RED);
  }
}

/**
 * 断言浮点近似相等。
 * @param {string} name 用例名
 * @param {number} actual 实际值
 * @param {number} expected 期望值
 * @returns {void}
 */
function assertNear(name, actual, expected) {
  assertEqual(name, Math.abs(actual - expected) < 1e-9, true);
}

/**
 * 断言函数不抛异常。
 * @param {string} name 用例名
 * @param {Function} fn 待执行函数
 * @returns {void}
 */
function assertNoThrow(name, fn) {
  try {
    fn();
    PASS_COUNT += 1;
    log("PASS", name, ANSI_GREEN);
  } catch (error) {
    FAIL_COUNT += 1;
    log("FAIL", `${name} => 抛出异常：${error && error.message}`, ANSI_RED);
  }
}

/**
 * 创建最小 DOM 元素桩。
 * @returns {object} 元素桩
 */
function makeElement() {
  return {
    style: {}, dataset: {}, children: [], value: "ALL", textContent: "", innerHTML: "", className: "",
    setAttribute(key, value) { this[key] = value; },
    getAttribute(key) { return this[key] === undefined ? "10" : this[key]; },
    appendChild(child) { this.children.push(child); return child; },
    append(...items) { for (const item of items) this.appendChild(item); },
    replaceChildren() { this.children = []; },
    addEventListener() {}, click() {}, querySelector() { return makeElement(); },
    remove() {}, focus() {},
  };
}

/**
 * 构建可复用的测试环境（多个 context 共享同一 localStorage 数据以验证持久化）。
 * @param {object} options 选项：store 共享存储、confirmValue 确认框返回值
 * @returns {object} 测试环境
 */
function createHarness(options) {
  const store = options.store;
  const elements = {};
  const blobs = [];
  const documentStub = {
    getElementById(id) { return elements[id] || (elements[id] = makeElement()); },
    createElementNS() { return makeElement(); },
    createElement() { return makeElement(); },
    createTextNode(text) { const el = makeElement(); el.textContent = text; return el; },
    addEventListener(event, handler) { if (event === "DOMContentLoaded") documentStub.onInit = handler; },
  };
  const windowStub = {
    localStorage: {
      getItem(key) { return Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null; },
      setItem(key, value) { store[key] = value; },
      removeItem(key) { delete store[key]; },
    },
    setTimeout() {}, confirm() { return options.confirmValue; },
  };
  const context = {
    console, document: documentStub, window: windowStub,
    getComputedStyle() { return { getPropertyValue() { return "#ffffff"; } }; },
    URL: { createObjectURL() { return "blob:test"; }, revokeObjectURL() {} },
    Blob: function Blob(parts) { blobs.push(parts.join("")); },
    FileReader: function FileReader() {
      this.readAsText = (file) => { this.result = file.content; if (this.onload) this.onload(); };
    },
    HTMLSelectElement: function HTMLSelectElement() {},
    Date, Math, JSON, Number, String, Object, Array, Error, RegExp, Boolean,
  };
  context.globalThis = context;
  vm.createContext(context);
  const source = SCRIPT_FILES.map((file) => fs.readFileSync(path.join(__dirname, file), "utf8")).join("\n")
    + "\n;globalThis.__t={statusOf,milestoneProgress,derivedMilestoneStatus,milestoneSummary,renderAll,readState,saveState,exportJson,importJson,resetAll,MILESTONES,HOTSPOTS,QUESTIONS,STATE_VERSION,getState:()=>state};";
  vm.runInContext(source, context, { filename: "dashboard-bundle.cjs" });
  if (typeof documentStub.onInit === "function") documentStub.onInit();
  return { context, api: context.__t, blobs, elements, store };
}

/**
 * 执行全部测试并输出汇总。
 * @returns {void}
 */
function main() {
  try {
    log("INFO", "=== OpenCut 动态看板回归测试开始 ===");
    const store = {};
    const env = createHarness({ store, confirmValue: false });
    const api = env.api;

    // 1. 数据完整性与依赖图
    assertEqual("里程碑数量", api.MILESTONES.length, EXPECTED_MILESTONES);
    assertEqual("热点数量", api.HOTSPOTS.length, EXPECTED_HOTSPOTS);
    assertEqual("开放问题数量", api.QUESTIONS.length, EXPECTED_QUESTIONS);
    assertEqual("问题状态合法", api.QUESTIONS.every((q) => ["待决", "已决"].includes(q.status)), true);
    assertEqual("已决问题数量", api.QUESTIONS.filter((q) => q.status === "已决").length, 2);
    assertEqual("已决项含结论与来源", api.QUESTIONS.filter((q) => q.status === "已决").every((q) => q.decision && q.source), true);
    assertEqual("Q07 结论含 WebCodecs", api.QUESTIONS.find((q) => q.id === "Q07").decision.includes("WebCodecs"), true);
    assertEqual("Q08 结论含不加入", api.QUESTIONS.find((q) => q.id === "Q08").decision.includes("不加入"), true);
    assertEqual("Q06 保留待决状态", api.QUESTIONS.find((q) => q.id === "Q06").status, "待决");
    const ids = new Set(api.MILESTONES.map((m) => m.id));
    assertEqual("依赖 ID 全部存在", api.MILESTONES.every((m) => m.deps.every((d) => ids.has(d))), true);
    assertEqual("热点归属合法", api.HOTSPOTS.every((h) => h.milestone === "全程" || ids.has(h.milestone)), true);

    // 2. 单一数据源：热点是唯一可写状态，里程碑只读派生
    assertEqual("H01 默认阻塞", api.statusOf("hotspots", "H01"), "阻塞");
    assertEqual("M0 状态由热点推导", api.statusOf("milestones", "M0"), "进行中");
    assertEqual("未知热点 ID 回退", api.statusOf("hotspots", "H999"), "未开始");
    assertEqual("未知里程碑 ID 回退", api.statusOf("milestones", "M999"), "未开始");
    assertEqual(
      "运行时状态不含 milestones",
      Object.prototype.hasOwnProperty.call(api.getState(), "milestones"),
      false,
    );
    const jsSource = fs.readFileSync(path.join(__dirname, "dashboard.js"), "utf8");
    const ioSource = fs.readFileSync(path.join(__dirname, "dashboard-io.js"), "utf8");
    assertEqual("主脚本不再写入 state.milestones", jsSource.includes("state.milestones"), false);
    assertEqual("导入导出不再写入里程碑状态", ioSource.includes("state.milestones"), false);
    assertEqual("状态版本已升级到 2", api.STATE_VERSION, 2);

    // 3. 完成度计算（M0 有 4 个热点：H03/H06/H10/H14，其中 H03/H10 已完成）
    assertNear("M0 完成度", api.milestoneProgress("M0"), 1 / 2);
    assertNear("M1 完成度", api.milestoneProgress("M1"), 0);
    assertNear("无关联热点里程碑完成度", api.milestoneProgress("M999"), 0);

    // 3b. 自动推导：改热点状态 → 里程碑立即变化，不存在人工覆盖路径
    const m0 = api.milestoneSummary("M0");
    assertEqual("M0 关联热点数", m0.total, 4);
    assertEqual("M0 已完成热点数", m0.done, 2);
    assertEqual("M0 热点百分比", m0.percent, 50);
    assertEqual("M0 推导状态", m0.status, "进行中");
    assertEqual("M0 汇总不含 manual", Object.prototype.hasOwnProperty.call(m0, "manual"), false);
    assertEqual("M0 汇总不含 conflict", Object.prototype.hasOwnProperty.call(m0, "conflict"), false);
    assertEqual("M1 推导状态", api.derivedMilestoneStatus("M1"), "阻塞");
    // M6 仅关联 H12；W-09 四批闭合 H12 后，M6 由热点推导为「已完成」
    assertEqual("M6 推导状态", api.derivedMilestoneStatus("M6"), "已完成");
    const hotspotState = api.getState().hotspots;
    for (const id of ["H03", "H06", "H10", "H14"]) hotspotState[id] = "已完成";
    assertEqual("热点全完成后 M0 变已完成", api.statusOf("milestones", "M0"), "已完成");
    assertNear("热点全完成后 M0 完成度", api.milestoneProgress("M0"), 1);
    hotspotState.H06 = "阻塞";
    assertEqual("出现阻塞后 M0 变阻塞", api.statusOf("milestones", "M0"), "阻塞");
    for (const id of ["H03", "H06", "H10", "H14"]) delete hotspotState[id];
    assertEqual("还原热点后 M0 回到进行中", api.statusOf("milestones", "M0"), "进行中");

    // 4. 渲染与重复渲染不抛错
    assertNoThrow("首次全量渲染", () => api.renderAll());
    assertNoThrow("重复全量渲染", () => api.renderAll());
    // 直接验证决策台账 DOM 已更新，避免「数据改了但页面没渲染」的回归
    assertEqual("决策台账渲染卡片数", env.elements["question-list"].children.length, EXPECTED_QUESTIONS);
    assertEqual("统计显示已决 2 项", env.elements["question-stats"].textContent.includes("已决 2"), true);
    assertEqual("页首显示数据版本", env.elements["data-version"].textContent.includes("2026-11-08-r31"), true);
    const svgTexts = [];
    const collectText = (node, target) => {
      if (node && typeof node.textContent === "string" && node.textContent) target.push(node.textContent);
      for (const child of (node && node.children) || []) collectText(child, target);
    };
    collectText(env.elements["flow-svg"], svgTexts);
    assertEqual("流程图节点直接显示百分比", svgTexts.some((text) => text.includes("50%")), true);
    assertEqual("流程图 tooltip 说明自动推导", svgTexts.some((text) => text.includes("自动推导")), true);
    assertEqual("流程图 tooltip 说明不可覆盖", svgTexts.some((text) => text.includes("不可手动覆盖")), true);
    const cardTexts = [];
    collectText(env.elements["milestone-cards"], cardTexts);
    assertEqual("卡片显示自动推导状态", cardTexts.some((text) => text.includes("由热点自动推导")), true);
    assertEqual("卡片不再显示人工标记", cardTexts.some((text) => text.includes("人工标记")), false);
    const cssText = fs.readFileSync(path.join(__dirname, "dashboard.css"), "utf8");
    const htmlText = fs.readFileSync(path.join(__dirname, "dashboard.html"), "utf8");
    assertEqual("样式含关键帧动画", cssText.includes("@keyframes bar-grow") && cssText.includes("@keyframes node-pulse"), true);
    assertEqual("样式尊重减弱动画", cssText.includes("prefers-reduced-motion"), true);
    assertEqual("样式不再含冲突告警", cssText.includes("card-warn") || cssText.includes("detail-warn"), false);
    assertEqual("页面不再宣称动态流程图", htmlText.includes("流程图（动态）") || htmlText.includes("动态路线图"), false);
    assertEqual("页面说明可交互含义", htmlText.includes("不是视频或自动播放的动图"), true);
    assertEqual("页面说明不可手动覆盖", htmlText.includes("不可手动覆盖"), true);
    assertEqual("页面不再含人工标记措辞", htmlText.includes("人工标记"), false);

    // 5. 持久化往返：只存热点状态；里程碑不落盘，旧版缓存自动失效
    env.context.__t.getState().hotspots.H03 = "已完成";
    api.saveState();
    assertEqual("已写入 localStorage", Object.prototype.hasOwnProperty.call(store, "opencut-roadmap-dashboard-v1"), true);
    const saved = JSON.parse(store["opencut-roadmap-dashboard-v1"]);
    assertEqual("本地状态不含 milestones", Object.prototype.hasOwnProperty.call(saved, "milestones"), false);
    const env2 = createHarness({ store, confirmValue: false });
    assertEqual("新环境恢复 H03", env2.api.statusOf("hotspots", "H03"), "已完成");
    assertEqual("新环境 M0 仍为推导状态", env2.api.statusOf("milestones", "M0"), "进行中");
    const legacyStore = {
      "opencut-roadmap-dashboard-v1": JSON.stringify({
        version: 1, milestones: { M0: "已完成" }, hotspots: { H03: "已完成" },
      }),
    };
    const envLegacy = createHarness({ store: legacyStore, confirmValue: false });
    assertEqual("旧版人工标记缓存被忽略", envLegacy.api.statusOf("milestones", "M0"), "进行中");

    // 6. 导出：里程碑状态是派生值，不写入进度文件
    assertNoThrow("导出 JSON", () => api.exportJson());
    assertEqual("导出产生一个 Blob", env.blobs.length, 1);
    const exported = JSON.parse(env.blobs[0]);
    assertEqual("导出版本号", exported.version, api.STATE_VERSION);
    assertEqual("导出不含里程碑状态", Object.prototype.hasOwnProperty.call(exported, "milestones"), false);
    assertEqual("导出热点条目数", Object.keys(exported.hotspots).length, EXPECTED_HOTSPOTS);

    // 7. 导入：旧文件里的 milestones 被忽略，只合并热点状态
    const valid = { version: api.STATE_VERSION, milestones: { M0: "已完成" }, hotspots: { H01: "已完成" }, selectedId: "M1" };
    assertNoThrow("导入合法 JSON", () => api.importJson({ content: JSON.stringify(valid) }));
    assertEqual("导入忽略里程碑覆盖", api.statusOf("milestones", "M0"), "进行中");
    assertEqual("导入后 H01 状态", api.statusOf("hotspots", "H01"), "已完成");
    assertEqual("导入后选中节点", api.getState().selectedId, "M1");
    assertEqual("导入后运行时仍无 milestones", Object.prototype.hasOwnProperty.call(api.getState(), "milestones"), false);
    const dirty = { version: api.STATE_VERSION, milestones: { M0: "非法值" }, hotspots: { H01: "已完成" }, selectedId: "不存在" };
    assertNoThrow("导入脏数据不崩溃", () => api.importJson({ content: JSON.stringify(dirty) }));
    assertEqual("非法里程碑值被忽略", api.statusOf("milestones", "M0"), "进行中");
    assertNoThrow("版本不匹配被安全处理", () => api.importJson({ content: JSON.stringify({ version: -1 }) }));

    // 8. 重置：清空热点覆盖，里程碑自动回到基线推导值
    api.resetAll();
    assertEqual("取消重置保留推导状态", api.statusOf("milestones", "M0"), "进行中");
    const env3 = createHarness({ store, confirmValue: true });
    env3.context.__t.getState().hotspots.H03 = "阻塞";
    assertEqual("改热点后 M0 变阻塞", env3.api.statusOf("milestones", "M0"), "阻塞");
    env3.api.resetAll();
    assertEqual("确认重置回到基线推导", env3.api.statusOf("milestones", "M0"), "进行中");
    assertEqual("确认重置清空存储", Object.prototype.hasOwnProperty.call(store, "opencut-roadmap-dashboard-v1"), false);

    log("INFO", `=== 汇总：通过 ${PASS_COUNT}，失败 ${FAIL_COUNT} ===`);
  } catch (error) {
    FAIL_COUNT += 1;
    log("ERROR", `测试执行异常：${error && error.stack ? error.stack : error}`, ANSI_RED);
  }

  // 日志落盘到系统临时目录，文件名带日期时间，不污染仓库
  try {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const logPath = path.join(os.tmpdir(), `opencut-dashboard-test-${stamp}.log`);
    fs.writeFileSync(logPath, LOG_LINES.join("\n") + "\n", "utf8");
    log("INFO", `测试日志已写入：${logPath}`);
  } catch (error) {
    console.error("写入测试日志失败：", error);
  }
  process.exitCode = FAIL_COUNT === 0 ? 0 : 1;
}

main();
