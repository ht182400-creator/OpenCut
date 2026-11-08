"use strict";

/**
 * C→B 兼容层契约回归测试（零依赖，Node 直接运行）：node compat.test.cjs
 * 校验 compat-contract.json 的结构、命名空间、判据权重、状态机、导出决策与三项用户决策；
 * 并覆盖空契约、权重不等、未知状态、非法路径等边界与异常分支。
 */

const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const CONTRACT_FILE = path.join(__dirname, "compat-contract.json");
const CONTRACT_VERSION = 1;
const ANSI_RED = "\u001b[31m";
const ANSI_GREEN = "\u001b[32m";
const ANSI_RESET = "\u001b[0m";
const EXPECTED_INVARIANTS = 6;
const EXPECTED_GATES = 5;
const EXPECTED_EXTENSION_POINTS = 6;
const EXPECTED_CAPABILITIES = 6;
const EXPECTED_BROWSERS = 4;
const LOG_LINES = [];
let PASS_COUNT = 0;
let FAIL_COUNT = 0;

/**
 * 记录分层日志。
 * @param {string} level 级别
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
 * 断言相等。
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
 * 校验契约结构，返回错误列表（供正常与异常分支共用）。
 * @param {object} c 契约对象
 * @returns {{ok: boolean, errors: string[]}} 校验结果
 */
function validateContract(c) {
  const errors = [];
  if (!c || typeof c !== "object") return { ok: false, errors: ["契约不是对象"] };
  if (c.version !== CONTRACT_VERSION) errors.push("version 不匹配");
  if (!c.namespace || !c.namespace.rustCratePrefix) errors.push("缺少命名空间前缀");
  if (!Array.isArray(c.invariants) || c.invariants.length !== EXPECTED_INVARIANTS) errors.push("不变量数量不符");
  if (!Array.isArray(c.decisionGates) || c.decisionGates.length !== EXPECTED_GATES) errors.push("判据数量不符");
  if (Array.isArray(c.decisionGates)) {
    const sum = c.decisionGates.reduce((acc, g) => acc + (Number(g.weight) || 0), 0);
    if (Math.abs(sum - 1) > 1e-9) errors.push("判据权重和不为 1");
  }
  if (!Array.isArray(c.extensionPoints) || c.extensionPoints.length !== EXPECTED_EXTENSION_POINTS) errors.push("扩展点数量不符");
  if (!Array.isArray(c.capabilities) || c.capabilities.length !== EXPECTED_CAPABILITIES) errors.push("能力数量不符");
  if (!Array.isArray(c.migrationStates) || !Array.isArray(c.transitions)) errors.push("缺少状态机定义");
  if (!c.decisions) errors.push("缺少用户决策");

  const pointIds = new Set((c.extensionPoints || []).map((p) => p.id));
  const states = new Set(c.migrationStates || []);
  const allowed = new Set(c.decisionValues || []);
  const validPrefixes = [c.namespace?.rustCrates?.replace("*", ""), c.namespace?.apps?.replace("*", ""), c.namespace?.webComponents].filter(Boolean);

  for (const cap of c.capabilities || []) {
    if (!validPrefixes.some((p) => String(cap.localPath || "").startsWith(p))) errors.push(`能力 ${cap.id} 路径未落在隔离命名空间`);
    if (cap.primaryExtensionPoint !== null && !pointIds.has(cap.primaryExtensionPoint)) errors.push(`能力 ${cap.id} 扩展点无效`);
    if (!states.has(cap.migrationState)) errors.push(`能力 ${cap.id} 状态非法`);
    if (!allowed.has(cap.decision)) errors.push(`能力 ${cap.id} 决策值非法`);
    // 上游路径/SHA 必须等落地后才填，禁止预填猜测
    if (cap.upstreamPath !== null || cap.upstreamSha !== null) errors.push(`能力 ${cap.id} 预填了上游路径或 SHA`);
  }
  for (const t of c.transitions || []) {
    if (!states.has(t.from) || !states.has(t.to)) errors.push(`状态转换端点非法：${t.from}→${t.to}`);
  }
  return { ok: errors.length === 0, errors };
}

/**
 * 用真实契约的浅拷贝构造异常输入，验证校验器能拒绝脏数据。
 * @param {object} base 真实契约
 * @param {string} name 用例名
 * @param {Function} mutate 变异函数
 * @returns {void}
 */
function assertRejects(base, name, mutate) {
  const clone = JSON.parse(JSON.stringify(base));
  mutate(clone);
  const result = validateContract(clone);
  assertEqual(name, result.ok, false);
}

/**
 * 执行全部测试并输出汇总。
 * @returns {void}
 */
function main() {
  let contract = null;
  try {
    log("INFO", "=== C→B 兼容契约回归测试开始 ===");
    const raw = fs.readFileSync(CONTRACT_FILE, "utf8");
    contract = JSON.parse(raw);
    PASS_COUNT += 1;
    log("PASS", "契约文件可读取且 JSON 合法", ANSI_GREEN);
  } catch (error) {
    FAIL_COUNT += 1;
    log("ERROR", `读取/解析契约失败：${error && error.message}`, ANSI_RED);
  }

  try {
    if (!contract) throw new Error("契约未加载，跳过结构校验");
    const result = validateContract(contract);
    assertEqual("真实契约结构校验通过", result.ok, true);
    if (!result.ok) log("INFO", `校验错误：${result.errors.join("；")}`);

    assertEqual("契约版本", contract.version, CONTRACT_VERSION);
    assertEqual("策略为 C→B", contract.strategy, "C→B");
    assertEqual("不变量数量", contract.invariants.length, EXPECTED_INVARIANTS);
    assertEqual("不变量 ID 唯一", new Set(contract.invariants.map((i) => i.id)).size, EXPECTED_INVARIANTS);

    const ns = contract.namespace;
    assertEqual("Rust crate 目录", ns.rustCrates, "local/crates/*");
    assertEqual("crate 前缀", ns.rustCratePrefix, "ocx-");
    assertEqual("MCP 工具前缀", ns.mcpToolPrefix, "ocx.");
    assertEqual("CLI 名称", ns.cli, "ocx-render");

    const gates = contract.decisionGates;
    assertEqual("判据数量", gates.length, EXPECTED_GATES);
    assertEqual("判据权重和为 1", Math.abs(gates.reduce((a, g) => a + g.weight, 0) - 1) < 1e-9, true);
    assertEqual("强制判据存在", contract.switchThreshold.mandatoryGates.every((id) => gates.some((g) => g.id === id)), true);
    assertEqual("切换总分阈值", contract.switchThreshold.overall, 0.75);
    assertEqual("扩展点数量", contract.extensionPoints.length, EXPECTED_EXTENSION_POINTS);

    const caps = contract.capabilities;
    assertEqual("能力数量", caps.length, EXPECTED_CAPABILITIES);
    assertEqual("能力 ID 唯一", new Set(caps.map((c) => c.id)).size, EXPECTED_CAPABILITIES);
    assertEqual("全部能力处于初始状态", caps.every((c) => c.migrationState === "notStarted"), true);
    assertEqual("全部能力待决策", caps.every((c) => c.decision === "pending"), true);
    assertEqual("禁止预填上游路径", caps.every((c) => c.upstreamPath === null && c.upstreamSha === null), true);
    assertEqual("状态机端点合法", contract.transitions.every((t) => contract.migrationStates.includes(t.from) && contract.migrationStates.includes(t.to)), true);

    // 第 3 点决策：导出后端
    assertEqual("Web 导出后端", contract.exportDecision.web, "webcodecs");
    assertEqual("桌面导出后端", contract.exportDecision.desktop, "ffmpeg-native");
    assertEqual("headless 导出后端", contract.exportDecision.headless, "ffmpeg-native");
    assertEqual("core 输出契约", contract.exportDecision.coreOutputs.join(","), "RenderFrame,ExportProfile");
    assertEqual("浏览器能力表条目数", contract.exportCapabilities.length, EXPECTED_BROWSERS);
    assertEqual("Firefox 回归提示", contract.exportCapabilities.some((b) => String(b.browser).includes("Firefox") && String(b.note).includes("0.3.0")), true);
    assertEqual("能力表字段完整", contract.exportCapabilities.every((b) => ["avc", "vp9", "aac", "opus"].every((k) => typeof b[k] === "boolean")), true);

    // 第 1、2 点决策
    assertEqual("Web-first 决策", contract.decisions.webFirst.value, true);
    assertEqual(".codebuddy 不加入 gitignore", contract.decisions.codebuddyGitignore.value, false);
    assertEqual("Web 导出决策", contract.decisions.webExportBackend.value, "webcodecs");
    assertEqual("反模式覆盖 -X theirs", contract.antiPatterns.some((p) => p.includes("-X theirs")), true);
    assertEqual("反模式覆盖 git add -A", contract.antiPatterns.some((p) => p.includes("git add -A")), true);

    // 边界与异常分支
    assertRejects(contract, "空契约被拒绝", (c) => { c.capabilities = []; });
    assertRejects(contract, "权重不等被拒绝", (c) => { c.decisionGates[0].weight = 9; });
    assertRejects(contract, "未知迁移状态被拒绝", (c) => { c.capabilities[0].migrationState = "unknown"; });
    assertRejects(contract, "非法命名空间被拒绝", (c) => { c.capabilities[0].localPath = "crates/editor-api"; });
    assertRejects(contract, "预填上游 SHA 被拒绝", (c) => { c.capabilities[0].upstreamSha = "deadbeef"; });
    assertRejects(contract, "缺失 decisions 被拒绝", (c) => { delete c.decisions; });
    assertEqual("空对象被拒绝", validateContract({}).ok, false);
    assertEqual("null 被拒绝", validateContract(null).ok, false);

    // 交叉校验：看板数据层必须与契约中的三项决策保持一致，防止文档与页面漂移
    const boardSrc = fs.readFileSync(path.join(__dirname, "dashboard-data.js"), "utf8");
    assertEqual("看板 Q07 标为已决", /Q07[\s\S]{0,220}DECISION_STATUS\.DECIDED/.test(boardSrc), true);
    assertEqual("看板 Q08 结论为不加入", /Q08[\s\S]{0,220}不加入/.test(boardSrc), true);
    assertEqual("看板结论含 WebCodecs", boardSrc.includes("WebCodecs"), true);
    assertEqual("看板含数据版本号", boardSrc.includes("DATA_VERSION"), true);

    log("INFO", `=== 汇总：通过 ${PASS_COUNT}，失败 ${FAIL_COUNT} ===`);
  } catch (error) {
    FAIL_COUNT += 1;
    log("ERROR", `测试执行异常：${error && error.stack ? error.stack : error}`, ANSI_RED);
  }

  // 日志写入系统临时目录，文件名带日期时间，不污染仓库
  try {
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    const logPath = path.join(os.tmpdir(), `opencut-compat-test-${stamp}.log`);
    fs.writeFileSync(logPath, LOG_LINES.join("\n") + "\n", "utf8");
    log("INFO", `测试日志已写入：${logPath}`);
  } catch (error) {
    console.error("写入测试日志失败：", error);
  }
  process.exitCode = FAIL_COUNT === 0 ? 0 : 1;
}

main();
