/**
 * API 路由层测试（ISTQB 组件/集成测试级别；Node 内置 node:test，零新增依赖）。
 * 直接调用 Elysia app.handle(new Request(...))，不起 HTTP 服务、不依赖网络端口。
 * 覆盖：GET / 与 /health 正常响应、POST /echo 合法 schema、三类异常分支
 * （非法 JSON / 缺字段 / 字段类型错误 / 未知路由 / 错误 HTTP 方法）。
 */

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import app from './index.ts'

/** 构造请求并解析 JSON 响应体，返回 status/headers/body。 */
async function request(method, path, options) {
  const url = `http://localhost${path}`
  const response = await app.handle(new Request(url, { method, ...options }))
  const text = await response.text()
  let body = null
  try { body = JSON.parse(text) } catch { body = text }
  return { status: response.status, body }
}

describe('API 路由正常分支', () => {
  it('GET / 返回 status ok', async () => {
    const { status, body } = await request('GET', '/')
    assert.equal(status, 200)
    assert.deepEqual(body, { status: 'ok' })
  })

  it('GET /health 返回 healthy 与合法 ISO 时间戳', async () => {
    const { status, body } = await request('GET', '/health')
    assert.equal(status, 200)
    assert.equal(body.healthy, true)
    assert.equal(new Date(body.timestamp).toISOString(), body.timestamp)
  })

  it('POST /echo 合法 body 原样回显', async () => {
    const { status, body } = await request('POST', '/echo', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '你好 OpenCut' }),
    })
    assert.equal(status, 200)
    assert.deepEqual(body, { message: '你好 OpenCut' })
  })

  it('边界：空字符串 message 是合法输入', async () => {
    const { status, body } = await request('POST', '/echo', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: '' }),
    })
    assert.equal(status, 200)
    assert.deepEqual(body, { message: '' })
  })

  it('边界：超长 message 原样回显（无截断）', async () => {
    const long = 'x'.repeat(10000)
    const { status, body } = await request('POST', '/echo', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: long }),
    })
    assert.equal(status, 200)
    assert.equal(body.message.length, 10000)
  })
})

describe('API 路由异常分支', () => {
  it('POST /echo 缺少 message 字段返回 4xx', async () => {
    const { status } = await request('POST', '/echo', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ other: 'x' }),
    })
    assert.ok(status >= 400 && status < 500, `期望 4xx，实际 ${status}`)
  })

  it('POST /echo message 类型错误返回 4xx', async () => {
    const { status } = await request('POST', '/echo', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 123 }),
    })
    assert.ok(status >= 400 && status < 500, `期望 4xx，实际 ${status}`)
  })

  it('POST /echo 非法 JSON 返回 4xx', async () => {
    const { status } = await request('POST', '/echo', {
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    })
    assert.ok(status >= 400 && status < 500, `期望 4xx，实际 ${status}`)
  })

  it('未知路由返回 404', async () => {
    const { status } = await request('GET', '/not-exist')
    assert.equal(status, 404)
  })

  it('错误 HTTP 方法返回 404 或 405', async () => {
    const { status } = await request('DELETE', '/health')
    assert.ok(status === 404 || status === 405, `期望 404/405，实际 ${status}`)
  })
})
