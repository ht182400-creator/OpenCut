/**
 * WASM 端到端契约测试：在 Node 里直接加载真实 wasm-bindgen 产物并调用 core。
 * 运行：node apps/web/src/local/editor-wasm.contract.mjs
 * 零第三方依赖；覆盖正常、边界与异常分支；日志带日期时间写入系统临时目录。
 */

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import init, {
  api_version,
  channel_kind,
  discover,
  domain_eval,
  param_kind,
  schema_version,
} from "./wasm/ocx_bindings_wasm.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RED = "\u001b[31m";
const GREEN = "\u001b[32m";
const RESET = "\u001b[0m";
const TICKS_PER_SECOND = 120000;

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

/** 调用统一求值入口。 */
function evaluate(request) {
  return JSON.parse(domain_eval(JSON.stringify(request)));
}

const DEMO_BEFORE = {
  overlay: [],
  main: {
    id: "main",
    elements: [
      { id: "intro", startTime: 0, duration: 240000 },
      { id: "clip", startTime: 240000, duration: 120000 },
    ],
  },
  audio: [],
};
const DEMO_AFTER = {
  overlay: [],
  main: {
    id: "main",
    elements: [{ id: "clip", startTime: 240000, duration: 120000 }],
  },
  audio: [],
};

try {
  const wasmPath = path.join(HERE, "wasm", "ocx_bindings_wasm_bg.wasm");
  const bytes = readFileSync(wasmPath);
  await init({ module_or_path: bytes });
  log("INFO", `=== 已加载 WASM（${bytes.length} bytes）===`);

  check("api_version", () => assert.equal(api_version(), "0.1.0"));
  check("schema_version", () => assert.equal(schema_version(), "1"));

  const info = JSON.parse(discover());
  check("discover backendId", () => assert.equal(info.backendId, "ocx-in-memory"));
  check("discover 能力清单", () => assert.equal(info.capabilities.length, 4));
  check("discover 含 undo-redo", () =>
    assert.equal(info.capabilities.includes("undo-redo"), true),
  );

  const ripple = evaluate({ kind: "rippleAdjustments", before: DEMO_BEFORE, after: DEMO_AFTER });
  check("ripple 计算 1 个调整", () => assert.equal(ripple.adjustments.length, 1));
  check("ripple 调整值", () =>
    assert.deepEqual(ripple.adjustments[0], {
      trackId: "main",
      afterTime: 240000,
      shiftAmount: 240000,
    }),
  );

  const applied = evaluate({
    kind: "rippleApply",
    tracks: DEMO_BEFORE,
    adjustments: ripple.adjustments,
  });
  check("ripple 应用后补空档", () =>
    assert.equal(applied.tracks.main.elements[1].startTime, 0),
  );

  const animation = evaluate({
    kind: "animationScalar",
    channel: {
      keys: [
        { id: "a", time: 0, value: 0, segmentToNext: "linear" },
        { id: "b", time: TICKS_PER_SECOND, value: 10 },
      ],
    },
    time: TICKS_PER_SECOND / 2,
    fallbackValue: -1,
  });
  check("animation 线性插值", () => assert.equal(animation.value, 5));

  const placement = evaluate({
    kind: "placementResolve",
    tracks: {
      overlay: [],
      main: { id: "main", trackType: "video", elements: [] },
      audio: [],
    },
    subject: { elementType: "video" },
    timeSpans: [],
    strategy: { type: "explicit", trackId: "main" },
  });
  check("placement explicit 命中", () =>
    assert.equal(placement.result.kind, "existingTrack"),
  );

  const executed = evaluate({
    kind: "editorExecute",
    command: {
      apiVersion: "0.1.0",
      schemaVersion: "1",
      commandId: "cmd-wasm-1",
      kind: "addClip",
      payload: { label: "wasm", durationTicks: 120000 },
    },
  });
  check("editorExecute 产生事件", () => assert.equal(executed.events.length, 1));

  check("channel_kind 标量", () =>
    assert.equal(channel_kind(JSON.stringify({ keys: [{ id: "a", time: 0, value: 1 }] })), "scalar"),
  );
  check("param_kind 数值", () => assert.equal(param_kind("3.5"), "number"));

  check("未知 kind 被明确拒绝", () => {
    assert.throws(() => domain_eval(JSON.stringify({ kind: "nope" })), /不支持的 kind/);
  });
  check("非法 JSON 被拒绝", () => {
    assert.throws(() => domain_eval("{ 非法"), /解析请求 JSON/);
  });
  check("版本不匹配的命令被拒绝", () => {
    assert.throws(
      () =>
        evaluate({
          kind: "editorExecute",
          command: {
            apiVersion: "9.9.9",
            schemaVersion: "1",
            commandId: "bad",
            kind: "clear",
            payload: {},
          },
        }),
      /VERSION_MISMATCH|版本不匹配/,
    );
  });
} catch (error) {
  log("FAIL", `初始化失败 → ${error.message}`);
}

log("INFO", `=== 汇总：通过 ${passCount}，失败 ${failCount} ===`);
const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
const logPath = path.join(os.tmpdir(), `opencut-wasm-contract-${stamp}.log`);
writeFileSync(logPath, `${logLines.join("\n")}\n`, "utf8");
console.log(`[INFO]  测试日志已写入：${logPath}`);
process.exit(failCount === 0 ? 0 : 1);
