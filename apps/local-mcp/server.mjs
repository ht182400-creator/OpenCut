/**
 * OpenCut 本地 MCP server（W-13 第一批）。
 *
 * - 协议：MCP over stdio（JSON-RPC 2.0，newline-delimited），**手写实现，零第三方依赖**；
 * - core 能力：经真实 WASM 产物（`apps/web/src/local/wasm`）调用，与浏览器同一份 core；
 * - 工具集 `ocx.*`：能力发现、经典版项目读写、OTIO 导入导出、单帧渲染、批量渲染任务
 *   （异步推进，`ocx.render.status` 查进度——W-13 DoD「长任务可查进度」）。
 *
 * 启动：`node apps/local-mcp/server.mjs`
 * 测试：`node apps/local-mcp/server.test.mjs`（协议 + 工具 + stdio 端到端）。
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';

import init, {
  api_version,
  discover,
  otio_export,
  otio_import,
  read_classic_project,
  render_frame_rgba,
  schema_version,
  write_classic_project,
} from '../web/src/local/wasm/ocx_bindings_wasm.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WASM_PATH = path.resolve(HERE, '../web/public/wasm/ocx_bindings_wasm_bg.wasm');
const SERVER_INFO = { name: 'opencut-local-mcp', version: '0.1.0' };
const PROTOCOL_VERSION = '2024-11-05';

let coreReady = null;

/** 加载一次 core WASM 产物（与浏览器同一份 core）。 */
export function ensureCore() {
  if (!coreReady) {
    const bytes = new Uint8Array(readFileSync(WASM_PATH));
    coreReady = init({ module_or_path: bytes }).catch((error) => {
      coreReady = null;
      throw error;
    });
  }
  return coreReady;
}

/** 服务端状态：批量渲染任务的进度存储。 */
export function createState() {
  return { jobs: new Map(), nextJobId: 1 };
}

/** MCP 工具清单（`ocx.*`）。 */
export const TOOLS = [
  {
    name: 'ocx.capabilities',
    description: 'OpenCut core 能力发现：API/schema 版本、后端与能力清单。',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'ocx.project.read',
    description: '读取经典版项目 JSON（v31 及以下）为归一化视图。',
    inputSchema: {
      type: 'object',
      properties: { projectJson: { type: 'string', description: '经典版项目 JSON 文本' } },
      required: ['projectJson'],
    },
  },
  {
    name: 'ocx.project.write',
    description: '把编辑后的视图按 id 合并回经典版项目 JSON，保留未知字段。',
    inputSchema: {
      type: 'object',
      properties: {
        original: { type: 'string', description: '原始项目 JSON' },
        view: { type: 'object', description: '编辑后的归一化视图' },
      },
      required: ['original', 'view'],
    },
  },
  {
    name: 'ocx.otio.import',
    description: '把 OTIO JSON 导入为 OpenCut 内部时间轴（EditTimeline）。',
    inputSchema: {
      type: 'object',
      properties: { otioJson: { type: 'string' } },
      required: ['otioJson'],
    },
  },
  {
    name: 'ocx.otio.export',
    description: '把内部时间轴导出为 OTIO JSON（完成一次交换格式导出）。',
    inputSchema: {
      type: 'object',
      properties: { timelineJson: { type: 'string' } },
      required: ['timelineJson'],
    },
  },
  {
    name: 'ocx.render.frame',
    description: '用 core 合成一帧 RGBA，返回字节数、SHA-256 与 base64 像素。',
    inputSchema: {
      type: 'object',
      properties: {
        frameIndex: { type: 'integer' },
        timeTicks: { type: 'integer' },
        durationTicks: { type: 'integer' },
        profile: { type: 'object' },
        params: { type: 'object' },
      },
      required: ['frameIndex', 'timeTicks', 'durationTicks', 'profile', 'params'],
    },
  },
  {
    name: 'ocx.render.batch',
    description: '启动批量渲染长任务，立即返回 jobId；用 ocx.render.status 查进度。',
    inputSchema: {
      type: 'object',
      properties: {
        frameCount: { type: 'integer', minimum: 1 },
        durationTicks: { type: 'integer' },
        profile: { type: 'object' },
        params: { type: 'object' },
      },
      required: ['frameCount', 'durationTicks', 'profile', 'params'],
    },
  },
  {
    name: 'ocx.render.status',
    description: '查询批量渲染任务的进度（done/total/status/checksums）。',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
    },
  },
];

/** 帧像素的稳定指纹。 */
function checksum(pixels) {
  return createHash('sha256').update(pixels).digest('hex');
}

/** FNV-1a 指纹：与 `RenderFrame::checksum()`（ocx-render）同算法，用于跨栈像素对比。 */
function fnvChecksum(pixels) {
  let hash = 0xcbf29ce484222325n;
  for (const byte of pixels) {
    hash ^= BigInt(byte);
    hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return `0x${hash.toString(16).padStart(16, '0')}`;
}

/** 调用 core 合成一帧并转成摘要。 */
function renderFrame(args) {
  const pixels = render_frame_rgba(JSON.stringify(args));
  return {
    size: pixels.length,
    sha256: checksum(pixels),
    fnvChecksum: fnvChecksum(pixels),
    rgbaBase64: Buffer.from(pixels).toString('base64'),
  };
}

/** 启动批量渲染：立即返回，后台逐帧推进并更新进度。 */
function startBatch(state, args) {
  const total = Number(args.frameCount);
  if (!Number.isInteger(total) || total < 1) {
    throw new Error('frameCount 必须是正整数');
  }
  const durationTicks = Number(args.durationTicks);
  const jobId = `job-${state.nextJobId}`;
  state.nextJobId += 1;
  const job = { id: jobId, status: 'running', total, done: 0, checksums: [] };
  state.jobs.set(jobId, job);
  const tick = () => {
    if (job.done >= job.total) {
      job.status = 'done';
      return;
    }
    const index = job.done;
    const pixels = render_frame_rgba(
      JSON.stringify({
        frameIndex: index,
        timeTicks: index * durationTicks,
        durationTicks,
        profile: args.profile,
        params: args.params,
      }),
    );
    job.checksums.push(checksum(pixels));
    job.done += 1;
    setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  return { jobId, total, status: job.status };
}

/** 执行一个工具调用；错误转成中文消息由上层包进 isError。 */
export async function runTool(state, name, args) {
  switch (name) {
    case 'ocx.capabilities':
      return {
        apiVersion: api_version(),
        schemaVersion: schema_version(),
        discover: JSON.parse(discover()),
      };
    case 'ocx.project.read':
      return JSON.parse(read_classic_project(String(args.projectJson)));
    case 'ocx.project.write':
      return JSON.parse(
        write_classic_project(JSON.stringify({ original: args.original, view: args.view })),
      );
    case 'ocx.otio.import':
      return JSON.parse(otio_import(String(args.otioJson)));
    case 'ocx.otio.export':
      return JSON.parse(otio_export(String(args.timelineJson)));
    case 'ocx.render.frame':
      return renderFrame(args);
    case 'ocx.render.batch':
      return startBatch(state, args);
    case 'ocx.render.status': {
      const job = state.jobs.get(String(args.jobId));
      if (!job) throw new Error(`未知的任务 id：${String(args.jobId)}`);
      return job;
    }
    default:
      throw new Error(`未知工具：${name}`);
  }
}

/**
 * 处理一条 JSON-RPC 消息（MCP over stdio）；notification 返回 null。
 * @param state 服务端状态
 * @param message 已解析的请求对象
 * @returns {Promise<object|null>} 响应对象；notification 为 null
 */
export async function handleMessage(state, message) {
  await ensureCore();
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') {
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } };
  }
  const isNotification = message.id === undefined || message.id === null;
  const reply = (result) => (isNotification ? null : { jsonrpc: '2.0', id: message.id, result });
  const fail = (code, text) =>
    isNotification ? null : { jsonrpc: '2.0', id: message.id, error: { code, message: text } };

  try {
    if (message.method === 'initialize') {
      return reply({
        protocolVersion: message.params?.protocolVersion ?? PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    }
    if (message.method === 'ping') {
      return reply({});
    }
    if (message.method === 'tools/list') {
      return reply({ tools: TOOLS });
    }
    if (message.method === 'tools/call') {
      const name = message.params?.name;
      if (typeof name !== 'string' || !TOOLS.some((tool) => tool.name === name)) {
        return fail(-32602, `未知工具：${String(name)}`);
      }
      const data = await runTool(state, name, message.params?.arguments ?? {});
      return reply({ content: [{ type: 'text', text: JSON.stringify(data) }], isError: false });
    }
    // initialized 等 notification 直接确认，其余方法报未知
    if (message.method.startsWith('notifications/')) {
      return null;
    }
    return fail(-32601, `Method not found: ${message.method}`);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    if (isNotification) return null;
    return {
      jsonrpc: '2.0',
      id: message.id,
      result: { content: [{ type: 'text', text }], isError: true },
    };
  }
}

/** stdio 主循环：逐行读 JSON-RPC 请求，把响应写回 stdout。 */
export async function main() {
  const state = createState();
  const reader = createInterface({ input: process.stdin });
  const write = (payload) => {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  };
  reader.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
      return;
    }
    handleMessage(state, message).then((response) => {
      if (response) write(response);
    });
  });
}

const invokedDirectly =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  main().catch((error) => {
    process.stderr.write(`MCP server 启动失败：${error}\n`);
    process.exitCode = 1;
  });
}
