/**
 * caption-import.ts 单元测试（UI 长尾 C 档：SRT/ASS 导入）。
 * 覆盖：SRT 时间戳（标准/点号/短时间/补零/非法）、ASS 时间戳与 Format 字段、
 * 正文归一化（ASS 样式块/换行/多空白）、分段与超长上限、格式嗅探、ticks 换算边界。
 */

import { describe, expect, it } from 'vitest'
import {
  CAPTION_MAX_CUES,
  captionDurationTicks,
  captionMsToTicks,
  detectCaptionFormat,
  normalizeCaptionText,
  parseAss,
  parseAssTime,
  parseCaptionFile,
  parseSrt,
  parseSrtTime,
  type CaptionCue,
} from './caption-import'

/** 断言片段列表的关键字段（起点/终点/正文）。 */
function expectCues(actual: CaptionCue[], expected: Array<[number, number, string]>) {
  expect(actual).toEqual(expected.map(([startMs, endMs, text]) => ({ startMs, endMs, text })))
}

describe('时间戳解析', () => {
  it('SRT 标准 HH:MM:SS,mmm', () => {
    expect(parseSrtTime('00:00:01,500')).toBe(1500)
    expect(parseSrtTime('01:02:03,004')).toBe(3_723_004)
  })

  it('SRT 毫秒点号与 1/2 位补零', () => {
    expect(parseSrtTime('00:00:01.5')).toBe(1500)
    expect(parseSrtTime('00:00:01.05')).toBe(1050)
    expect(parseSrtTime('00:00:01.005')).toBe(1005)
  })

  it('SRT 短时间 MM:SS,mmm', () => {
    expect(parseSrtTime('01:30,250')).toBe(90_250)
  })

  it('SRT 非法输入返回 null', () => {
    for (const bad of ['', 'abc', '00:00', '00:60:00,000', '00:00:00,0000', null as unknown as string]) {
      expect(parseSrtTime(bad)).toBeNull()
    }
  })

  it('SRT 时间行带尾部坐标时只取第一段', () => {
    expect(parseSrtTime('00:00:01,000 X1:0 X2:1')).toBe(1000)
  })

  it('ASS H:MM:SS.cc（百分秒）', () => {
    expect(parseAssTime('0:00:01.00')).toBe(1000)
    expect(parseAssTime('0:01:30.25')).toBe(90_250)
    // 单数字按百分秒字面值：.5 = 5/100s = 50ms
    expect(parseAssTime('1:02:03.5')).toBe(3_723_050)
  })

  it('ASS 非法输入返回 null', () => {
    for (const bad of ['', '00:00:01,00', '00:00:01.000', '0:60:00.00', undefined as unknown as string]) {
      expect(parseAssTime(bad)).toBeNull()
    }
  })
})

describe('正文归一化', () => {
  it('ASS 样式块 / 换行标记 / 多空白压平为单行', () => {
    expect(normalizeCaptionText('{\\an8\\fad(100,100)}你好\\N世界\\n再次  相遇')).toBe('你好 世界 再次 相遇')
  })

  it('空正文与非法输入返回空串', () => {
    expect(normalizeCaptionText('   {\\i1}  \n ')).toBe('')
    expect(normalizeCaptionText(null as unknown as string)).toBe('')
  })
})

describe('SRT 解析', () => {
  it('标准多段：序号 + 空行 + CRLF + BOM', () => {
    const text = '\uFEFF1\r\n00:00:00,000 --> 00:00:01,000\r\n第一句\r\n\r\n2\r\n00:00:01,500 --> 00:00:02,000\r\n第二句\r\n'
    const result = parseSrt(text)
    expect(result.warnings).toEqual([])
    expectCues(result.cues, [[0, 1000, '第一句'], [1500, 2000, '第二句']])
  })

  it('缺序号 / 多行正文 / 毫秒点号均兼容', () => {
    const text = '00:00:01.000 --> 00:00:02.500\n第一行\n第二行\n\n00:00:03,000 --> 00:00:04,000\n单句'
    const result = parseSrt(text)
    expect(result.warnings).toEqual([])
    expectCues(result.cues, [[1000, 2500, '第一行 第二行'], [3000, 4000, '单句']])
  })

  it('非法时间行 / 空正文 / 负时长跳过并记 warning', () => {
    const text = [
      '1', 'xx --> yy', '坏时间', '',
      '2', '00:00:02,000 --> 00:00:01,000', '倒序', '',
      '3', '00:00:03,000 --> 00:00:04,000', '   ', '',
      '4', '00:00:05,000 --> 00:00:06,000', '有效',
    ].join('\n')
    const result = parseSrt(text)
    expect(result.warnings).toHaveLength(3)
    expectCues(result.cues, [[5000, 6000, '有效']])
  })

  it('空文件 / 超长文件与条数上限', () => {
    expect(parseSrt('').warnings).toEqual(['SRT 文件内容为空'])
    const many = Array.from({ length: CAPTION_MAX_CUES + 3 }, (_, i) =>
      `${i + 1}\n00:00:0${i % 10},000 --> 00:00:0${i % 10},500\n字幕${i}`).join('\n\n')
    const result = parseSrt(many)
    expect(result.cues).toHaveLength(CAPTION_MAX_CUES)
    expect(result.warnings.some((w) => w.includes('超过上限'))).toBe(true)
  })

  it('非字符串输入不抛异常', () => {
    const result = parseSrt(null as unknown as string)
    expect(result.cues).toEqual([])
    expect(result.warnings.length).toBeGreaterThan(0)
  })
})

describe('ASS 解析', () => {
  const assHeader = [
    '[Script Info]',
    'Title: demo',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize',
    'Style: Default,Arial,20',
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  ].join('\n')

  it('标准 Dialogue：样式块剥离、逗号正文保留', () => {
    const text = `${assHeader}\nDialogue: 0,0:00:01.00,0:00:02.50,Default,,0,0,0,,你好，世界`
    const result = parseAss(text)
    expect(result.warnings).toEqual([])
    expectCues(result.cues, [[1000, 2500, '你好，世界']])
  })

  it('自定义 Format 字段顺序（Text 按规范仍在末位）', () => {
    const text = [
      '[Events]',
      'Format: Start, End, Layer, Text',
      'Dialogue: 0:00:03.00,0:00:04.00,0,自定义',
    ].join('\n')
    const result = parseAss(text)
    expect(result.warnings).toEqual([])
    expectCues(result.cues, [[3000, 4000, '自定义']])
  })

  it('无 Format 行时用规范默认字段', () => {
    const text = '[Events]\nDialogue: 0,0:00:00.50,0:00:01.00,Default,,0,0,0,,默认字段'
    expectCues(parseAss(text).cues, [[500, 1000, '默认字段']])
  })

  it('缺少 [Events] / Format 字段 / Dialogue 行分别记 warning', () => {
    expect(parseAss('[Script Info]\nTitle: x').warnings[0]).toContain('缺少 [Events]')
    expect(parseAss('[Events]\nFormat: Layer, Start\nDialogue: 0,0:00:01.00').warnings[0]).toContain('缺少 Start/End/Text')
    expect(parseAss('[Events]\nFormat: Layer, Start, End, Text').warnings[0]).toContain('没有 Dialogue')
  })

  it('字段不足 / 非法时间 / 空正文 / 倒序跳过', () => {
    const text = [
      '[Events]',
      'Format: Layer, Start, End, Text',
      'Dialogue: 0,0:00:01.00',
      'Dialogue: 0,bad,0:00:02.00,坏时间',
      'Dialogue: 0,0:00:02.00,0:00:03.00,{\\i1}',
      'Dialogue: 0,0:00:04.00,0:00:03.00,倒序',
      'Dialogue: 0,0:00:05.00,0:00:06.00,有效',
    ].join('\n')
    const result = parseAss(text)
    expect(result.warnings).toHaveLength(4)
    expectCues(result.cues, [[5000, 6000, '有效']])
  })

  it('Comment 行与其它段名大小写兼容', () => {
    const text = '[events]\nformat: Layer, Start, End, Text\nComment: 0,0:00:01.00,0:00:02.00,注释\nDialogue: 0,0:00:03.00,0:00:04.00,正文'
    expectCues(parseAss(text).cues, [[3000, 4000, '正文']])
  })
})

describe('分发与 ticks 换算', () => {
  it('按扩展名分发', () => {
    expect(detectCaptionFormat('a.SRT', '')).toBe('srt')
    expect(detectCaptionFormat('a.ass', '')).toBe('ass')
    expect(detectCaptionFormat('a.txt', '1\n00:00:00,000 --> 00:00:01,000\nhi')).toBe('srt')
    expect(detectCaptionFormat('a.txt', '[Events]\nDialogue: 0,0:00:00.00,0:00:01.00,x')).toBe('ass')
    expect(detectCaptionFormat('a.txt', '随便文本')).toBe('unknown')
  })

  it('parseCaptionFile：空 / 超长 / 未知格式', () => {
    expect(parseCaptionFile('', 'a.srt').warnings[0]).toContain('为空')
    expect(parseCaptionFile('x'.repeat(5 * 1024 * 1024 + 1), 'a.srt').warnings[0]).toContain('超过')
    expect(parseCaptionFile('随便文本', 'a.txt').warnings[0]).toContain('无法识别')
  })

  it('parseCaptionFile 端到端：扩展名决定解析方式', () => {
    const srt = '1\n00:00:00,000 --> 00:00:01,000\nSRT内容'
    const ass = '[Events]\nFormat: Layer, Start, End, Text\nDialogue: 0,0:00:01.00,0:00:02.00,ASS内容'
    expectCues(parseCaptionFile(srt, 'a.srt').cues, [[0, 1000, 'SRT内容']])
    expectCues(parseCaptionFile(ass, 'a.ass').cues, [[1000, 2000, 'ASS内容']])
  })

  it('ticks 换算：0 起点 / 非法回落 / 时长至少 1 tick', () => {
    expect(captionMsToTicks(0, 120000)).toBe(0)
    expect(captionMsToTicks(500, 120000)).toBe(60000)
    expect(captionMsToTicks(-1, 120000)).toBe(0)
    expect(captionMsToTicks(Number.NaN, 0)).toBe(0)
    expect(captionDurationTicks(0, 0, 120000)).toBe(1)
    expect(captionDurationTicks(0, 500, 120000)).toBe(60000)
  })
})
