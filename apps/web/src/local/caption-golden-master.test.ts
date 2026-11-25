/**
 * 字幕解析 golden master 执行器（ISO/IEC 29119-4 规格说明测试 + 数据驱动）。
 * 数据源：`fixtures/caption-parse-cases.json`；案例文档：`CAPTION_CASES.md`。
 * **三者一一对应**：JSON 的 cases[].id、本文文档表格 ID、执行器遍历的用例；
 * 强制校验 ID 唯一、分类齐全（正常/边界/异常）、每个 ID 在文档中出现。
 * 任与实际不符即断言失败并输出 ID + 分类 + 输入 + 期望/实际。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { normalizeCaptionText, parseAssTime, parseSrtTime } from './caption-import'

/** JSON 案例文件绝对路径。 */
const FIXTURE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'caption-parse-cases.json')
/** 案例文档绝对路径。 */
const CASES_DOC_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), 'CAPTION_CASES.md')

/** 单条案例结构。 */
interface CaptionCase {
  id: string
  category: string
  fn: 'parseSrtTime' | 'parseAssTime' | 'normalizeCaptionText'
  input: string
  expected: number | string | null
  summary: string
}

/** 案例套件结构。 */
interface CaptionSuite {
  version: number
  suite: string
  module: string
  language: string
  unit: string
  requiredCategories: string[]
  cases: CaptionCase[]
}

/**
 * 读取并解析案例 JSON。
 * @returns {CaptionSuite} 案例套件
 */
function loadSuite(): CaptionSuite {
  return JSON.parse(readFileSync(FIXTURE_PATH, 'utf8')) as CaptionSuite
}

/**
 * 按 fn 名称分发到被测函数。
 * @param fn 函数名
 * @param input 输入字符串
 * @returns {number | string | null} 实际输出
 */
function runCase(fn: CaptionCase['fn'], input: string): number | string | null {
  switch (fn) {
    case 'parseSrtTime': return parseSrtTime(input)
    case 'parseAssTime': return parseAssTime(input)
    case 'normalizeCaptionText': return normalizeCaptionText(input)
    default: throw new Error(`未知被测函数：${fn}`)
  }
}

describe('字幕解析 golden master（JSON 数据驱动）', () => {
  const suite = loadSuite()
  const doc = readFileSync(CASES_DOC_PATH, 'utf8')

  it('案例库结构合法：版本、ID 唯一、三类齐全、文档 ID 一一对应', () => {
    expect(suite.version).toBe(1)
    expect(suite.module).toBe('caption-import.ts')
    expect(suite.cases.length).toBeGreaterThan(0)
    const ids = suite.cases.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const category of suite.requiredCategories) {
      expect(suite.cases.some((c) => c.category === category)).toBe(true)
    }
    for (const c of suite.cases) {
      expect(doc, `案例文档缺少 ${c.id}`).toContain(`| ${c.id} |`)
    }
  })

  it.each(loadSuite().cases)('$id [$category] $fn: $summary', (testCase) => {
    expect(runCase(testCase.fn, testCase.input)).toEqual(testCase.expected)
  })
})
