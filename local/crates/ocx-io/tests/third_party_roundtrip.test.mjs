/**
 * W-10 第三批：与官方 OpenTimelineIO 的实文件往返回归。
 *
 * 运行：node local/crates/ocx-io/tests/third_party_roundtrip.test.mjs
 * 静态部分使用官方 0.18 生成的 fixture，不需要 Python；
 * 动态部分需要 `opentimelineio`（用 PYTHONPATH 指向安装目录），
 * 未安装时如实标记 SKIP，不冒充通过。
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import init, {
  otio_export,
  otio_import,
} from "../../../../apps/web/src/local/wasm/ocx_bindings_wasm.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, "fixtures/third_party_otio_018.json");
const PYTHON_SCRIPT = path.join(HERE, "third_party_roundtrip.py");
const WASM = path.resolve(
  HERE,
  "../../../../apps/web/src/local/wasm/ocx_bindings_wasm_bg.wasm",
);

let passed = 0;
let failed = 0;
let skipped = false;

/** 单项断言并累计结果。 */
function check(name, assertion) {
  try {
    assertion();
    passed += 1;
    console.log(`PASS  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL  ${name}: ${error.message}`);
  }
}

/** 调用官方 Python 工具并解析其 JSON 输出。 */
function runPython(...args) {
  const result = spawnSync("python", [PYTHON_SCRIPT, ...args], {
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`python ${args[0]} 失败：${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim().split("\n").pop());
}

async function main() {
  await init({ module_or_path: readFileSync(WASM) });

  // 1. 官方 0.18 生成的静态 fixture：Clip.2 + media_references 字典 + Gap
  const official = readFileSync(FIXTURE, "utf8");
  const imported = JSON.parse(otio_import(official));
  check("官方 Clip.2 文件导入成功", () => assert.equal(imported.ok, true));
  check("时间轴名称保留", () =>
    assert.equal(imported.timeline.name, "third-party-roundtrip"),
  );
  const clips = imported.timeline.tracks[0].clips;
  check("片段数含 Gap", () => assert.equal(clips.length, 3));
  check("Clip.2 字典媒体引用被解析", () =>
    assert.equal(clips[0].mediaUrl, "file:///intro.mp4"),
  );
  check("第二片段素材入点换算", () =>
    assert.equal(clips[1].sourceStartTicks, 120000),
  );
  check("Gap 被识别", () => assert.equal(clips[2].isGap, true));
  const exported = JSON.parse(otio_export(JSON.stringify(imported.timeline)));
  check("内部时间轴可导出", () => assert.equal(exported.ok, true));
  const reimported = JSON.parse(otio_import(exported.otio));
  check("往返剪辑决策一致", () =>
    assert.deepEqual(reimported.timeline.tracks, imported.timeline.tracks),
  );

  // 1b. 官方工具生成的 Transition + Marker 文件（静态，不需要 Python）
  const transitionsFixture = readFileSync(
    path.join(HERE, "fixtures/third_party_otio_transitions.json"),
    "utf8",
  );
  const transitions = JSON.parse(otio_import(transitionsFixture));
  check("官方转场文件导入成功", () => assert.equal(transitions.ok, true));
  check("官方转场条目被识别", () =>
    assert.equal(transitions.timeline.tracks[0].clips[1].isTransition, true));
  check("官方标记被导入", () => assert.equal(transitions.timeline.markers.length, 1));
  const transitionsExported = JSON.parse(otio_export(JSON.stringify(transitions.timeline)));
  check("官方转场文件可回写", () => assert.equal(transitionsExported.ok, true));
  const transitionsReimported = JSON.parse(otio_import(transitionsExported.otio));
  check("转场与标记往返一致", () =>
    assert.deepEqual(transitionsReimported.timeline.markers, transitions.timeline.markers));

  // 1c. 官方工具生成的 Effect + 嵌套 Stack 文件（静态，不需要 Python）
  const effectsFixture = readFileSync(
    path.join(HERE, "fixtures/third_party_otio_effects.json"),
    "utf8",
  );
  const effects = JSON.parse(otio_import(effectsFixture));
  check("官方 Effect 文件导入成功", () => assert.equal(effects.ok, true));
  check("官方 effect 节点保留", () =>
    assert.equal(effects.timeline.tracks[0].clips[0].effects.length, 1));
  check("官方嵌套 Stack 保留", () =>
    assert.equal(effects.timeline.nestedStacks.length, 1));
  const effectsExported = JSON.parse(otio_export(JSON.stringify(effects.timeline)));
  check("官方 Effect 文件可回写", () => assert.equal(effectsExported.ok, true));
  const effectsReimported = JSON.parse(otio_import(effectsExported.otio));
  check("Effect 与嵌套 Stack 往返一致", () =>
    assert.deepEqual(effectsReimported.timeline.nestedStacks, effects.timeline.nestedStacks));

  // 1d. 官方工具生成的 Track / Clip 级 Marker 文件（静态，不需要 Python）
  const nestedMarkersFixture = readFileSync(
    path.join(HERE, "fixtures/third_party_otio_nested_markers.json"),
    "utf8",
  );
  const nestedMarkers = JSON.parse(otio_import(nestedMarkersFixture));
  check("官方四层标记文件导入成功", () => assert.equal(nestedMarkers.ok, true));
  check("官方 Track 级 Marker 保留", () =>
    assert.equal(nestedMarkers.timeline.tracks[0].markers.length, 1));
  check("官方 Clip 级 Marker 保留", () =>
    assert.equal(nestedMarkers.timeline.tracks[0].clips[0].markers.length, 1));
  const nestedMarkersExported = JSON.parse(otio_export(JSON.stringify(nestedMarkers.timeline)));
  check("官方四层标记文件可回写", () => assert.equal(nestedMarkersExported.ok, true));
  const nestedMarkersReimported = JSON.parse(otio_import(nestedMarkersExported.otio));
  check("四层标记往返一致", () =>
    assert.deepEqual(
      nestedMarkersReimported.timeline.tracks[0].markers,
      nestedMarkers.timeline.tracks[0].markers,
    ));

  // 2. 动态：官方工具生成 → 我们读写 → 官方工具再校验
  const probe = spawnSync("python", [PYTHON_SCRIPT, "probe"], {
    encoding: "utf8",
  });
  let available = false;
  try {
    available = JSON.parse(probe.stdout.trim().split("\n").pop()).available;
  } catch {
    available = false;
  }
  if (!available) {
    skipped = true;
    console.log("SKIP  官方工具动态往返：opentimelineio 未安装");
  } else {
    const directory = mkdtempSync(path.join(os.tmpdir(), "oc-otio-"));
    try {
      const source = path.join(directory, "source.otio");
      const roundtrip = path.join(directory, "roundtrip.otio");
      const made = runPython("make", source);
      check("官方生成文件自校验通过", () => assert.equal(made.clips.length, 3));

      const fromOfficial = JSON.parse(otio_import(readFileSync(source, "utf8")));
      check("读取官方生成文件成功", () => assert.equal(fromOfficial.ok, true));
      const reexport = JSON.parse(
        otio_export(JSON.stringify(fromOfficial.timeline)),
      );
      check("回写 OTIO 成功", () => assert.equal(reexport.ok, true));
      writeFileSync(roundtrip, reexport.otio);

      const before = runPython("validate", source);
      const after = runPython("validate", roundtrip);
      check("官方工具能读回我们导出的文件", () =>
        assert.equal(after.name, before.name),
      );
      check("轨道数一致", () =>
        assert.equal(after.track_count, before.track_count),
      );
      check("片段数一致", () =>
        assert.equal(after.clips.length, before.clips.length),
      );
      check("剪辑决策逐项一致", () =>
        assert.deepEqual(after.clips, before.clips),
      );

      // W-10 第四批：官方生成含 Transition + Marker 的文件，再走同一往返链路
      const source2 = path.join(directory, "source2.otio");
      const roundtrip2 = path.join(directory, "roundtrip2.otio");
      runPython("make2", source2);
      const fromOfficial2 = JSON.parse(otio_import(readFileSync(source2, "utf8")));
      check("官方 make2 生成文件可导入", () => assert.equal(fromOfficial2.ok, true));
      const reexport2 = JSON.parse(otio_export(JSON.stringify(fromOfficial2.timeline)));
      writeFileSync(roundtrip2, reexport2.otio);
      const before2 = runPython("validate", source2);
      const after2 = runPython("validate", roundtrip2);
      check("官方工具能读回转场/标记导出文件", () =>
        assert.equal(after2.name, before2.name));
      check("转场与剪辑决策逐项一致", () =>
        assert.deepEqual(after2.clips, before2.clips));
      check("标记逐项一致", () => assert.deepEqual(after2.markers, before2.markers));

      // W-10 第五批：官方生成含 Effect + 嵌套 Stack 的文件，再走同一往返链路
      const source3 = path.join(directory, "source3.otio");
      const roundtrip3 = path.join(directory, "roundtrip3.otio");
      runPython("make3", source3);
      const fromOfficial3 = JSON.parse(otio_import(readFileSync(source3, "utf8")));
      check("官方 make3 生成文件可导入", () => assert.equal(fromOfficial3.ok, true));
      const reexport3 = JSON.parse(otio_export(JSON.stringify(fromOfficial3.timeline)));
      writeFileSync(roundtrip3, reexport3.otio);
      const before3 = runPython("validate", source3);
      const after3 = runPython("validate", roundtrip3);
      check("官方工具能读回 Effect/嵌套 Stack 导出文件", () =>
        assert.equal(after3.name, before3.name));
      check("effect 与剪辑决策逐项一致", () =>
        assert.deepEqual(after3.clips, before3.clips));
      check("嵌套 Stack 逐项一致", () =>
        assert.deepEqual(after3.nested, before3.nested));

      // W-10 第六批：官方生成含 Track / Clip 级 Marker 的文件
      const source4 = path.join(directory, "source4.otio");
      const roundtrip4 = path.join(directory, "roundtrip4.otio");
      runPython("make4", source4);
      const fromOfficial4 = JSON.parse(otio_import(readFileSync(source4, "utf8")));
      check("官方 make4 生成文件可导入", () => assert.equal(fromOfficial4.ok, true));
      const reexport4 = JSON.parse(otio_export(JSON.stringify(fromOfficial4.timeline)));
      writeFileSync(roundtrip4, reexport4.otio);
      const before4 = runPython("validate", source4);
      const after4 = runPython("validate", roundtrip4);
      check("官方工具能读回 Track/Clip 标记导出文件", () =>
        assert.equal(after4.name, before4.name));
      check("Clip 级标记逐项一致", () =>
        assert.deepEqual(after4.clips, before4.clips));
      check("Track 级标记逐项一致", () =>
        assert.deepEqual(after4.track_markers, before4.track_markers));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }

  console.log(
    `=== 汇总：通过 ${passed}，失败 ${failed}${skipped ? "，动态往返 SKIP" : ""} ===`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(`FATAL ${error.stack || error}`);
  process.exitCode = 1;
});
