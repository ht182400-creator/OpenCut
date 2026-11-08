/**
 * animation 跨语言对齐测试：经典版 TS 的 JS 参考实现与 Rust golden master 共用同一份 JSON 期望值。
 * 运行：node local/crates/ocx-domain/tests/animation-alignment.test.mjs
 * 零第三方依赖；日志分层、FAIL 标红、日志按日期时间写入系统临时目录。
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runAnimationCase } from "./animation-reference.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(HERE, "fixtures", "animation_cases.json");
const CASES_DOC_PATH = path.join(HERE, "ANIMATION_CASES.md");
const RUST_SOURCE_PATH = path.join(HERE, "..", "src", "animation.rs");
const REQUIRED_CATEGORIES = ["正常", "边界", "异常"];
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const RESET = "\u001b[0m";

let passCount = 0;
let failCount = 0;
const logLines = [];

/**
 * 分层日志：同时输出到控制台与日志文件。
 * @param {"INFO"|"PASS"|"FAIL"} level 级别
 * @param {string} message 消息
 * @returns {void}
 */
function log(level, message) {
  const line = `[${new Date().toISOString()}] ${level}  ${message}`;
  logLines.push(line);
  if (level === "FAIL") {
    console.log(`${RED}${line}${RESET}`);
    failCount += 1;
  } else if (level === "PASS") {
    passCount += 1;
    console.log(`${GREEN}${line}${RESET}`);
  } else {
    console.log(line);
  }
}

/**
 * 单条断言：记录通过或失败，不让异常中断整轮回归。
 * @param {string} name 断言名
 * @param {() => void} fn 断言体
 * @returns {void}
 */
function check(name, fn) {
  try {
    fn();
    log("PASS", name);
  } catch (error) {
    log("FAIL", `${name} → ${error.message}`);
  }
}

/**
 * 递归容差比较：数值用绝对误差，对象与数组逐项比较，其余严格相等。
 * @param {*} actual 实际值
 * @param {*} expected 期望值
 * @param {number} epsilon 容差
 * @param {string} trace 路径（用于失败信息）
 * @returns {void}
 */
function assertDeepClose(actual, expected, epsilon, trace) {
  if (typeof actual === "number" && typeof expected === "number") {
    assert.ok(
      Math.abs(actual - expected) <= epsilon,
      `${trace}: 数值 ${actual} 与 ${expected} 超出容差 ${epsilon}`,
    );
    return;
  }
  if (Array.isArray(actual) && Array.isArray(expected)) {
    assert.equal(actual.length, expected.length, `${trace}: 数组长度不一致`);
    for (let index = 0; index < expected.length; index++) {
      assertDeepClose(actual[index], expected[index], epsilon, `${trace}[${index}]`);
    }
    return;
  }
  if (actual && expected && typeof actual === "object" && typeof expected === "object") {
    assert.deepStrictEqual(
      Object.keys(actual).sort(),
      Object.keys(expected).sort(),
      `${trace}: 对象字段不一致`,
    );
    for (const key of Object.keys(expected)) {
      assertDeepClose(actual[key], expected[key], epsilon, `${trace}.${key}`);
    }
    return;
  }
  assert.deepStrictEqual(actual, expected, `${trace}: 值不一致`);
}

try {
  const suite = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  const doc = readFileSync(CASES_DOC_PATH, "utf8");
  const epsilon = suite.valueEpsilon;

  log("INFO", `=== 载入 ${suite.cases.length} 个用例，ticksPerSecond=${suite.ticksPerSecond}，epsilon=${epsilon} ===`);
  check("用例文件版本", () => assert.equal(suite.version, 1));
  check("时间单位一致", () => assert.equal(suite.ticksPerSecond, 120000));
  check("容差为正数", () => assert.equal(epsilon > 0, true));
  check("Rust 源实现存在", () => assert.equal(existsSync(RUST_SOURCE_PATH), true));
  check("案例文档含测试结果章节", () => assert.equal(doc.includes("测试结果"), true));

  const ids = new Set();
  const categories = new Set();
  for (const testCase of suite.cases) {
    check(`${testCase.id} ID 唯一`, () => assert.equal(ids.has(testCase.id), false));
    ids.add(testCase.id);
    categories.add(testCase.category);
    check(`${testCase.id} 文档收录`, () => assert.equal(doc.includes(testCase.id), true));

    const actual = runAnimationCase(testCase.kind, testCase.input);
    for (const [key, expected] of Object.entries(testCase.expected)) {
      check(`${testCase.id}（${testCase.category}/${testCase.kind}）字段 ${key}`, () => {
        assertDeepClose(actual[key], expected, epsilon, key);
      });
    }
  }

  for (const category of REQUIRED_CATEGORIES) {
    check(`分类覆盖 ${category}`, () => assert.equal(categories.has(category), true));
  }
  check("未知类型被明确拒绝", () => {
    assert.throws(() => runAnimationCase("unknown", {}), /未知用例类型/);
  });
  check("损坏的 JSON 被拒绝", () => {
    assert.throws(() => JSON.parse("{ 非法"), SyntaxError);
  });
} catch (error) {
  log("FAIL", `初始化失败 → ${error.message}`);
}

log("INFO", `=== 汇总：通过 ${passCount}，失败 ${failCount} ===`);
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const logPath = path.join(os.tmpdir(), `opencut-animation-alignment-${stamp}.log`);
writeFileSync(logPath, `${logLines.join("\n")}\n`, "utf8");
console.log(`[INFO]  测试日志已写入：${logPath}`);
process.exit(failCount === 0 ? 0 : 1);
