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
  read_classic_project,
  render_frame_rgba,
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

  const EXPORT_PROFILE = {
    container: "mp4",
    codec: "avc",
    width: 8,
    height: 4,
    frameRate: { numerator: 30, denominator: 1 },
    videoBitrateBps: 1000000,
    includeAudio: true,
    audioSampleRateHz: 48000,
    audioChannels: 2,
  };
  const FRAME_PARAMS = {
    backgroundRgba: [10, 20, 30, 255],
    accentRgba: [100, 150, 200, 255],
    opacity: 1,
    positionX: 0.5,
    positionY: 0.5,
  };

  check("导出配置校验通过", () =>
    assert.equal(evaluate({ kind: "validateExportProfile", profile: EXPORT_PROFILE }).ok, true),
  );
  check("编码容器组合被拒绝", () =>
    assert.deepEqual(
      evaluate({ kind: "validateExportProfile", profile: { ...EXPORT_PROFILE, codec: "vp9" } }),
      { ok: false, code: "INCOMPATIBLE_CODEC" },
    ),
  );

  const framePlan = evaluate({
    kind: "buildFramePlan",
    durationTicks: 120000,
    profile: EXPORT_PROFILE,
  });
  check("帧计划 30 帧", () => assert.equal(framePlan.frameCount, 30));
  check("帧计划每帧 4000 ticks", () => assert.equal(framePlan.ticksPerFrame, 4000));
  check("帧计划音画同步累计采样", () =>
    assert.equal(framePlan.totalAudioSamples, 48000),
  );
  check("帧计划非法时长被拒绝", () =>
    assert.equal(
      evaluate({ kind: "buildFramePlan", durationTicks: -1, profile: EXPORT_PROFILE }).error,
      "INVALID_DURATION",
    ),
  );

  const frameRequest = {
    frameIndex: 0,
    timeTicks: 0,
    durationTicks: 4000,
    profile: EXPORT_PROFILE,
    params: FRAME_PARAMS,
  };
  const pixels = render_frame_rgba(JSON.stringify(frameRequest));
  check("预览帧返回 Uint8Array", () =>
    assert.equal(pixels instanceof Uint8Array, true),
  );
  check("预览帧字节数", () => assert.equal(pixels.length, 8 * 4 * 4));
  check("预览帧背景像素", () =>
    assert.deepEqual(Array.from(pixels.slice(0, 4)), [10, 20, 30, 255]),
  );
  // 坐标 (3,2) 的行优先偏移：((2 * 8) + 3) * 4 = 76
  check("预览帧前景像素", () =>
    assert.deepEqual(Array.from(pixels.slice(76, 80)), [100, 150, 200, 255]),
  );
  const nextPixels = render_frame_rgba(
    JSON.stringify({ ...frameRequest, frameIndex: 5, timeTicks: 20000 }),
  );
  check("预览帧随时间变化", () => assert.equal(nextPixels[76], 105));
  check("非法帧请求被拒绝", () =>
    assert.throws(
      () =>
        render_frame_rgba(
          JSON.stringify({
            ...frameRequest,
            profile: { ...EXPORT_PROFILE, codec: "vp9" },
          }),
        ),
      /INVALID_PROFILE|生成预览帧/,
    ),
  );

  const projectJson = JSON.stringify({
    version: 31,
    metadata: {
      id: "prj-wasm",
      name: "WASM project",
      duration: 240000,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-02T00:00:00Z",
    },
    scenes: [{
      id: "s1",
      name: "Main",
      isMain: true,
      tracks: {
        overlay: [],
        main: {
          id: "main",
          type: "video",
          elements: [
            { id: "e1", type: "video", startTime: 0, duration: 120000 },
            { id: "e2", type: "video", startTime: 120000, duration: 120000 },
          ],
        },
        audio: [],
      },
    }],
    currentSceneId: "s1",
    settings: {
      fps: { numerator: 30, denominator: 1 },
      canvasSize: { width: 1920, height: 1080 },
    },
  });
  const projectView = JSON.parse(read_classic_project(projectJson));
  check("项目只读视图版本", () => assert.equal(projectView.version, 31));
  check("项目只读视图名称", () => assert.equal(projectView.name, "WASM project"));
  check("项目只读视图 fps", () =>
    assert.deepEqual(projectView.fps, { numerator: 30, denominator: 1 }),
  );
  check("项目只读视图轨道数", () =>
    assert.equal(projectView.scenes[0].tracks.length, 1),
  );
  check("项目只读视图元素数", () =>
    assert.equal(projectView.scenes[0].tracks[0].elements.length, 2),
  );
  check("未来项目版本被拒绝", () =>
    assert.equal(
      JSON.parse(read_classic_project(
        JSON.stringify({ ...JSON.parse(projectJson), version: 32 }),
      )).error,
      "UNSUPPORTED_VERSION",
    ),
  );
  check("非法项目 JSON 被拒绝", () =>
    assert.equal(JSON.parse(read_classic_project("{ 非法")).error, "INVALID_JSON"),
  );

  const kfAnimations = {
    opacity: {
      keys: [
        { id: "k1", time: 0, value: 0, segmentToNext: "linear" },
        { id: "k2", time: 120000, value: 1 },
      ],
    },
  };
  const kfResult = JSON.parse(domain_eval(JSON.stringify({
    kind: "keyframeQuery",
    op: "getElementKeyframes",
    animations: kfAnimations,
  })));
  check("关键帧查询返回 2 帧", () => assert.equal(kfResult.result.length, 2));
  check("关键帧查询首帧插值", () =>
    assert.equal(kfResult.result[0].interpolation, "linear"),
  );
  check("关键帧路径判定", () =>
    assert.equal(JSON.parse(domain_eval(JSON.stringify({
      kind: "keyframeQuery", op: "isAnimationPath", path: "params.size",
    }))).result, true),
  );
  check("线性颜色格式化", () =>
    assert.equal(JSON.parse(domain_eval(JSON.stringify({
      kind: "keyframeQuery", op: "formatLinearRgba", color: [0, 0, 0, 0.5],
    }))).result, "#00000080"),
  );
  check("未知 op 被明确拒绝", () =>
    assert.throws(
      () => domain_eval(JSON.stringify({ kind: "keyframeQuery", op: "nope" })),
      /不支持的 op/,
    ),
  );

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
