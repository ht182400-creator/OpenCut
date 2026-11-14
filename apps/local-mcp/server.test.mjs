/**
 * W-13 第一批回归：MCP 协议分发、`ocx.*` 工具、DoD 链路与 stdio 端到端。
 * 运行：`node apps/local-mcp/server.test.mjs`（零第三方依赖）。
 */

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { TOOLS, handleMessage, createState } from './server.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLASSIC_FIXTURE = path.resolve(HERE, '../web/public/fixtures/classic-project-v31.json');
const PROFILE = {
  container: 'mp4',
  codec: 'avc',
  width: 8,
  height: 4,
  frameRate: { numerator: 30, denominator: 1 },
  videoBitrateBps: 1000000,
  includeAudio: true,
  audioSampleRateHz: 48000,
  audioChannels: 2,
};
const PARAMS = {
  backgroundRgba: [10, 20, 30, 255],
  accentRgba: [100, 150, 200, 255],
  opacity: 1,
  positionX: 0.5,
  positionY: 0.5,
};
const TIMELINE = {
  name: 'mcp',
  schemaVersion: 1,
  rate: 30,
  tracks: [
    {
      id: 'V1',
      name: 'V1',
      kind: 'Video',
      clips: [
        {
          id: 'c1',
          name: 'c1',
          isGap: false,
          startTicks: 0,
          durationTicks: 120000,
          sourceStartTicks: 0,
          mediaUrl: 'x.mp4',
        },
      ],
      markers: [],
    },
  ],
  warnings: [],
};

/** 最小 MCP 客户端：把结果文本解析回对象。 */
async function call(state, method, params) {
  const response = await handleMessage(state, {
    jsonrpc: '2.0',
    id: 1,
    method,
    ...(params === undefined ? {} : { params }),
  });
  return response;
}

function payload(response) {
  return JSON.parse(response.result.content[0].text);
}

let passed = 0;
const check = (label, run) => {
  run();
  passed += 1;
  console.log(`PASS  ${label}`);
};

const state = createState();

// --- 协议 ---
{
  const response = await call(state, 'initialize', { protocolVersion: '2024-11-05' });
  check('initialize 返回协议版本与 serverInfo', () => {
    assert.equal(response.result.protocolVersion, '2024-11-05');
    assert.equal(response.result.serverInfo.name, 'opencut-local-mcp');
    assert.deepEqual(response.result.capabilities, { tools: {} });
  });
}
{
  const response = await handleMessage(state, { jsonrpc: '2.0', method: 'notifications/initialized' });
  check('notification 返回 null（不写回）', () => assert.equal(response, null));
}
{
  const response = await call(state, 'tools/list');
  check('tools/list 暴露 8 个 ocx.* 工具', () => {
    assert.equal(response.result.tools.length, 8);
    assert.ok(response.result.tools.some((tool) => tool.name === 'ocx.otio.export'));
    assert.ok(response.result.tools.some((tool) => tool.name === 'ocx.render.status'));
  });
}
{
  const response = await call(state, 'no/such/method');
  check('未知方法返回 -32601', () => assert.equal(response.error.code, -32601));
}
{
  const response = await handleMessage(state, { jsonrpc: '2.0', id: 2, method: 42 });
  check('非法请求返回 -32600', () => assert.equal(response.error.code, -32600));
}

// --- 工具：发现与项目 ---
{
  const response = await call(state, 'tools/call', { name: 'ocx.capabilities' });
  const data = payload(response);
  check('ocx.capabilities 返回版本与发现结果', () => {
    assert.equal(response.result.isError, false);
    assert.equal(data.apiVersion, '0.1.0');
    assert.equal(data.discover.backendId, 'ocx-in-memory');
  });
}
{
  const projectJson = readFileSync(CLASSIC_FIXTURE, 'utf8');
  const response = await call(state, 'tools/call', {
    name: 'ocx.project.read',
    arguments: { projectJson },
  });
  const view = payload(response);
  check('ocx.project.read 读经典版项目', () => {
    assert.equal(view.version, 31);
    assert.equal(typeof view.name, 'string');
  });
  const written = await call(state, 'tools/call', {
    name: 'ocx.project.write',
    arguments: { original: projectJson, view },
  });
  check('ocx.project.write 完成无损写回', () => assert.equal(payload(written).ok, true));
}

// --- 工具：DoD「tools/list 可完成一次导出」 ---
{
  const imported = payload(
    await call(state, 'tools/call', { name: 'ocx.otio.import', arguments: { otioJson: JSON.stringify({
      OTIO_SCHEMA: 'Timeline.1', name: 'mcp', metadata: { opencut: { schemaVersion: 1 } },
      tracks: { OTIO_SCHEMA: 'Stack.1', children: [
        { OTIO_SCHEMA: 'Track.1', name: 'V1', kind: 'Video', children: [
          { OTIO_SCHEMA: 'Clip.1', name: 'c1',
            source_range: { OTIO_SCHEMA: 'TimeRange.1',
              start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 30 },
              duration: { OTIO_SCHEMA: 'RationalTime.1', value: 30, rate: 30 } } },
        ] },
      ] },
    }) } }),
  );
  check('ocx.otio.import 导入成功', () => assert.equal(imported.ok, true));
  const exported = payload(
    await call(state, 'tools/call', {
      name: 'ocx.otio.export',
      arguments: { timelineJson: JSON.stringify(imported.timeline) },
    }),
  );
  check('ocx.otio.export 完成一次导出且可再导入', () => {
    assert.equal(exported.ok, true);
    assert.equal(JSON.parse(exported.otio).OTIO_SCHEMA, 'Timeline.1');
  });
}

// --- 工具：渲染与长任务进度 ---
{
  const args = { frameIndex: 0, timeTicks: 0, durationTicks: 4000, profile: PROFILE, params: PARAMS };
  const first = payload(await call(state, 'tools/call', { name: 'ocx.render.frame', arguments: args }));
  const second = payload(await call(state, 'tools/call', { name: 'ocx.render.frame', arguments: args }));
  check('ocx.render.frame 同请求指纹一致', () => {
    assert.equal(first.size, 8 * 4 * 4);
    assert.equal(first.sha256, second.sha256);
    assert.ok(first.rgbaBase64.length > 0);
  });
  const batch = payload(await call(state, 'tools/call', {
    name: 'ocx.render.batch',
    arguments: { frameCount: 3, durationTicks: 4000, profile: PROFILE, params: PARAMS },
  }));
  check('ocx.render.batch 立即返回 jobId', () => {
    assert.equal(batch.status, 'running');
    assert.equal(batch.total, 3);
  });
  let job = { status: 'running' };
  for (let attempt = 0; attempt < 50 && job.status !== 'done'; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    job = payload(await call(state, 'tools/call', {
      name: 'ocx.render.status',
      arguments: { jobId: batch.jobId },
    }));
  }
  check('ocx.render.status 长任务可查进度直至完成', () => {
    assert.equal(job.status, 'done');
    assert.equal(job.done, 3);
    assert.equal(job.checksums.length, 3);
  });
  const single = payload(await call(state, 'tools/call', {
    name: 'ocx.render.frame',
    arguments: { frameIndex: 2, timeTicks: 8000, durationTicks: 4000, profile: PROFILE, params: PARAMS },
  }));
  check('批量渲染帧指纹与单帧一致', () => assert.equal(job.checksums[2], single.sha256));

  // W-13 第二批：Headless CLI（Rust 原生）与 WASM core 的跨栈像素一致性
  const cliDir = mkdtempSync(path.join(os.tmpdir(), 'ocx-mcp-cli-'));
  const cliProfile = path.join(cliDir, 'profile.json');
  const cliParams = path.join(cliDir, 'params.json');
  writeFileSync(cliProfile, JSON.stringify(PROFILE));
  writeFileSync(cliParams, JSON.stringify(PARAMS));
  const cliRun = spawnSync('cargo', [
    'run', '-q', '-p', 'ocx-cli', '--', 'frame',
    '--profile', cliProfile,
    '--params', cliParams,
    '--frame-index', '0', '--time-ticks', '0', '--duration-ticks', '4000',
    '--out', cliDir, '--name', 'clip',
  ], { encoding: 'utf8', cwd: path.resolve(HERE, '../..'), timeout: 120000 });
  check('Headless CLI 与 WASM core 像素指纹一致', () => {
    assert.equal(cliRun.status, 0, cliRun.stderr);
    const summary = JSON.parse(cliRun.stdout);
    assert.equal(summary.checksum, first.fnvChecksum);
  });
}
{
  const response = await call(state, 'tools/call', { name: 'ocx.render.status', arguments: { jobId: 'job-404' } });
  check('未知任务返回 isError 结果', () => {
    assert.equal(response.result.isError, true);
    assert.match(response.result.content[0].text, /未知的任务 id/);
  });
  const unknown = await call(state, 'tools/call', { name: 'ocx.nothing' });
  check('未知工具返回 -32602', () => assert.equal(unknown.error.code, -32602));
}

// --- stdio 端到端 ---
{
  const requests = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    '',
  ].join('\n');
  const run = spawnSync(process.execPath, [path.join(HERE, 'server.mjs')], {
    input: requests,
    encoding: 'utf8',
    timeout: 60000,
  });
  const lines = run.stdout.trim().split('\n').filter((line) => line.trim());
  check('stdio 端到端：initialize 与 tools/list 走真实进程', () => {
    assert.equal(run.status, 0, run.stderr);
    assert.equal(lines.length, 2);
    const initialized = JSON.parse(lines[0]);
    const listed = JSON.parse(lines[1]);
    assert.equal(initialized.result.serverInfo.name, 'opencut-local-mcp');
    assert.equal(listed.result.tools.length, TOOLS.length);
  });
}

console.log(`=== 汇总：通过 ${passed}，失败 0 ===`);
