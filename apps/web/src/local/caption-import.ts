/**
 * SRT / ASS 字幕文件解析（UI 长尾 C 档提级：Captions 导入）。
 *
 * 纯函数层：不碰 DOM、不碰 core，输入文本 → 字幕片段列表；异常行按「跳过 + warning」
 * 处理而不是整文件失败，符合字幕文件常见的不规范现状（缺序号、BOM、CRLF、样式标签）。
 * 解析结果与时间轴无关；ticks 换算交给 element-model（TICKS_PER_SECOND）。
 */

/** 单条字幕片段：毫秒时间 + 已归一化的单行文本。 */
export interface CaptionCue {
  /** 起始毫秒（非负、有限） */
  startMs: number
  /** 结束毫秒（严格大于起始） */
  endMs: number
  /** 字幕正文（多行压平为单行，ASS 样式标签已剥离） */
  text: string
}

/** 解析结果：成功片段 + 被跳过行的说明（供 UI 显示友好提示）。 */
export interface CaptionParseResult {
  cues: CaptionCue[]
  /** 每条对应一处被跳过的非法/空行；文件完全合法时为空数组 */
  warnings: string[]
}

/** 字幕格式（按扩展名或内容嗅探）。 */
export type CaptionFormat = 'srt' | 'ass' | 'unknown'

/** 最多导入的字幕条数（防止超长文件卡死 UI）；超出部分截断并记 warning。 */
export const CAPTION_MAX_CUES = 2000
/** 单文件最大字节数（UI 层按字符串长度粗判，超限直接友好拒绝）。 */
export const CAPTION_MAX_FILE_CHARS = 5 * 1024 * 1024
/** 字幕最小有效时长（毫秒）；end-start 小于该值视为非法。 */
export const CAPTION_MIN_DURATION_MS = 20
/** 缺省字幕时长（毫秒）；仅用于文档说明，当前不对非法时间在解析层补写。 */
export const CAPTION_DEFAULT_DURATION_MS = 2000

/** SRT 时间：`HH:MM:SS,mmm` / `HH:MM:SS.mmm`，小时允许 1~3 位。 */
const SRT_TIME_PATTERN = /^(\d{1,3}):([0-5]\d):([0-5]\d)[,.](\d{1,3})$/
/** SRT 短时间：`MM:SS,mmm`（部分工具生成，兼容）。 */
const SRT_SHORT_TIME_PATTERN = /^(\d{1,3}):([0-5]\d)[,.](\d{1,3})$/
/** ASS 时间：`H:MM:SS.cc`（百分秒，1~2 位）。 */
const ASS_TIME_PATTERN = /^(\d{1,3}):([0-5]\d):([0-5]\d)\.(\d{1,2})$/
/** ASS 样式覆盖块：`{\an8\fad(...)}`，字幕正文里应剥离。 */
const ASS_OVERRIDE_PATTERN = /\{[^}]*\}/g
/** ASS 段名（大小写不敏感）。 */
const ASS_EVENTS_SECTION = '[events]'
/** ASS 默认字段顺序（无 Format 行时的兜底，见 ASS 规范）。 */
const ASS_DEFAULT_FIELDS = [
  'Layer', 'Start', 'End', 'Style', 'Name', 'MarginL', 'MarginR', 'MarginV', 'Effect', 'Text',
] as const
/** 单个 warning 的最大字符数（避免超长原始行撑爆 UI 提示）。 */
const CAPTION_WARNING_MAX_CHARS = 160

/**
 * 把毫秒钳到非负有限值；非法输入返回 null（供调用方记 warning 后跳过）。
 * @param raw 外部传入的毫秒数
 * @returns {number | null} 合法毫秒或 null
 */
function safeMs(raw: number): number | null {
  return Number.isFinite(raw) && raw >= 0 ? raw : null
}

/**
 * 截断超长片段提示，避免把整行非法文本原样塞进 UI。
 * @param prefix 提示前缀（中文）
 * @param raw 原始行
 * @returns {string} 单行受限提示
 */
function warningText(prefix: string, raw: string): string {
  const flat = raw.replace(/\s+/g, ' ').trim()
  return `${prefix}${flat.length > CAPTION_WARNING_MAX_CHARS ? `${flat.slice(0, CAPTION_WARNING_MAX_CHARS)}…` : flat}`
}

/**
 * 解析 SRT 时间戳为毫秒。
 * @param value 时间字符串（可带前后空白或紧跟的帧坐标，如 `X1:...`）
 * @returns {number | null} 毫秒；格式非法返回 null
 */
export function parseSrtTime(value: string): number | null {
  if (typeof value !== 'string') return null
  const clean = value.trim().split(/\s+/)[0] ?? ''
  const full = SRT_TIME_PATTERN.exec(clean)
  if (full) {
    const [, hours, minutes, seconds, millis] = full
    // 毫秒位不足 3 位时按右侧补零（1 位→×100，2 位→×10）。
    const ms = Number(millis ?? 0) * Math.pow(10, 3 - (millis?.length ?? 3))
    return safeMs(
      Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1000 + ms,
    )
  }
  const short = SRT_SHORT_TIME_PATTERN.exec(clean)
  if (short) {
    const [, minutes, seconds, millis] = short
    const ms = Number(millis ?? 0) * (millis?.length === 2 ? 10 : 1)
    return safeMs(Number(minutes) * 60_000 + Number(seconds) * 1000 + ms)
  }
  return null
}

/**
 * 解析 ASS 时间戳（`H:MM:SS.cc`）为毫秒。
 * @param value 时间字符串
 * @returns {number | null} 毫秒；格式非法返回 null
 */
export function parseAssTime(value: string): number | null {
  if (typeof value !== 'string') return null
  const match = ASS_TIME_PATTERN.exec(value.trim())
  if (!match) return null
  const [, hours, minutes, seconds, centis] = match
  // ASS 小数位是百分秒：`.5` = 5/100s = 50ms，`.50` = 50/100s = 500ms，统一 ×10。
  const ms = Number(centis ?? 0) * 10
  return safeMs(
    Number(hours) * 3_600_000 + Number(minutes) * 60_000 + Number(seconds) * 1000 + ms,
  )
}

/**
 * 把字幕正文压平为单行：ASS 换行标记、样式块、多余空白统一处理。
 * @param raw 原始文本行（可能多行）
 * @returns {string} 单行正文；空串表示无有效内容
 */
export function normalizeCaptionText(raw: string): string {
  if (typeof raw !== 'string') return ''
  return raw
    .replace(ASS_OVERRIDE_PATTERN, '')
    .replace(/\\N/gi, ' ')
    .replace(/\\n/gi, ' ')
    .replace(/\\h/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 校验并收一条字幕，非法时间/空正文统一记 warning 后跳过。
 * @param startMs 起始毫秒
 * @param endMs 结束毫秒
 * @param rawText 原始正文
 * @param warnings warning 收集数组（原地追加）
 * @param label 片段标签（用于提示，如 `第 3 段`）
 */
function pushCue(
  startMs: number | null,
  endMs: number | null,
  rawText: string,
  warnings: string[],
  label: string,
): CaptionCue | null {
  const text = normalizeCaptionText(rawText)
  if (startMs === null || endMs === null) {
    warnings.push(warningText(`${label}时间格式非法，已跳过：`, `${startMs ?? '?'} --> ${endMs ?? '?'}`))
    return null
  }
  if (endMs - startMs < CAPTION_MIN_DURATION_MS) {
    warnings.push(warningText(`${label}时长非法或为负，已跳过：`, `${startMs} --> ${endMs}`))
    return null
  }
  if (!text) {
    warnings.push(warningText(`${label}正文为空，已跳过：`, rawText))
    return null
  }
  return { startMs, endMs, text }
}

/**
 * 解析 SRT 文本：按空行分段，兼容缺序号、CRLF、BOM、毫秒点号与短时间格式。
 * @param text 文件全文
 * @returns {CaptionParseResult} 片段列表与 warning
 */
export function parseSrt(text: string): CaptionParseResult {
  const warnings: string[] = []
  const cues: CaptionCue[] = []
  if (typeof text !== 'string' || !text.trim()) {
    return { cues, warnings: ['SRT 文件内容为空'] }
  }
  try {
    const normalized = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
    const blocks = normalized.split(/\n\s*\n/)
    for (const [index, block] of blocks.entries()) {
      if (cues.length >= CAPTION_MAX_CUES) {
        warnings.push(`字幕条数超过上限 ${CAPTION_MAX_CUES}，后续片段已忽略`)
        break
      }
      const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
      if (lines.length === 0) continue
      const timeIndex = lines.findIndex((line) => line.includes('-->'))
      if (timeIndex < 0) {
        warnings.push(warningText(`第 ${index + 1} 段缺少时间行，已跳过：`, lines[0] ?? ''))
        continue
      }
      const [startRaw, endRaw] = lines[timeIndex]!.split('-->')
      const startMs = parseSrtTime(startRaw ?? '')
      const endMs = parseSrtTime(endRaw ?? '')
      const cue = pushCue(startMs, endMs, lines.slice(timeIndex + 1).join(' '), warnings, `第 ${index + 1} 段`)
      if (cue) cues.push(cue)
    }
    return { cues, warnings }
  } catch (error) {
    // 理论上纯字符串解析不应抛异常；仍按规则记录并返回已解析部分，不让 UI 崩溃。
    warnings.push(`SRT 解析异常：${error instanceof Error ? error.message : String(error)}`)
    return { cues, warnings }
  }
}

/**
 * 从 ASS 全文定位 `[Events]` 段与 Format 字段顺序。
 * @param lines 按行切分后的文本
 * @returns {string[] | null} 字段名小写数组；无 Format 行时用规范默认顺序
 */
function assFields(lines: readonly string[]): string[] | null {
  let inEvents = false
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('[')) {
      if (inEvents) break
      inEvents = trimmed.toLowerCase() === ASS_EVENTS_SECTION
      continue
    }
    if (!inEvents || !/^format\s*:/i.test(trimmed)) continue
    return trimmed.replace(/^format\s*:/i, '').split(',').map((field) => field.trim().toLowerCase())
  }
  return inEvents ? [...ASS_DEFAULT_FIELDS].map((field) => field.toLowerCase()) : null
}

/**
 * 解析 ASS 文本：只读 `[Events]` 段的 `Dialogue:` 行，按 Format 字段定位起止与正文。
 * @param text 文件全文
 * @returns {CaptionParseResult} 片段列表与 warning
 */
export function parseAss(text: string): CaptionParseResult {
  const warnings: string[] = []
  const cues: CaptionCue[] = []
  if (typeof text !== 'string' || !text.trim()) {
    return { cues, warnings: ['ASS 文件内容为空'] }
  }
  try {
    const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n')
    const fields = assFields(lines)
    if (!fields) return { cues, warnings: ['ASS 文件缺少 [Events] 段，无可导入字幕'] }
    const startIndex = fields.indexOf('start')
    const endIndex = fields.indexOf('end')
    const textIndex = fields.indexOf('text')
    if (startIndex < 0 || endIndex < 0 || textIndex < 0) {
      return { cues, warnings: ['ASS Format 行缺少 Start/End/Text 字段，已跳过全部字幕'] }
    }
    const maxFieldIndex = Math.max(startIndex, endIndex, textIndex)
    let dialogueCount = 0
    for (const line of lines) {
      if (cues.length >= CAPTION_MAX_CUES) {
        warnings.push(`字幕条数超过上限 ${CAPTION_MAX_CUES}，后续片段已忽略`)
        break
      }
      const trimmed = line.trim()
      if (!/^dialogue\s*:/i.test(trimmed)) continue
      dialogueCount += 1
      const parts = trimmed.replace(/^dialogue\s*:/i, '').split(',')
      if (parts.length <= maxFieldIndex) {
        warnings.push(warningText(`第 ${dialogueCount} 条 Dialogue 字段不足，已跳过：`, trimmed))
        continue
      }
      const cue = pushCue(
        parseAssTime(parts[startIndex] ?? ''),
        parseAssTime(parts[endIndex] ?? ''),
        parts.slice(textIndex).join(','),
        warnings,
        `第 ${dialogueCount} 条`,
      )
      if (cue) cues.push(cue)
    }
    if (cues.length === 0 && dialogueCount === 0) {
      warnings.push('ASS [Events] 段内没有 Dialogue 行')
    }
    return { cues, warnings }
  } catch (error) {
    warnings.push(`ASS 解析异常：${error instanceof Error ? error.message : String(error)}`)
    return { cues, warnings }
  }
}

/**
 * 嗅探字幕格式：扩展名优先，无扩展名时按内容特征判断。
 * @param fileName 文件名（含扩展名，可为空）
 * @param text 文件全文
 * @returns {CaptionFormat} 识别到的格式
 */
export function detectCaptionFormat(fileName: string, text: string): CaptionFormat {
  const name = (typeof fileName === 'string' ? fileName : '').toLowerCase()
  if (name.endsWith('.srt')) return 'srt'
  if (name.endsWith('.ass')) return 'ass'
  const content = typeof text === 'string' ? text : ''
  if (/^dialogue\s*:/im.test(content) || /\[events\]/i.test(content)) return 'ass'
  if (content.includes('-->')) return 'srt'
  return 'unknown'
}

/**
 * 按扩展名/内容分发解析字幕文件；未知格式返回空结果 + 明确提示。
 * @param text 文件全文
 * @param fileName 文件名（用于扩展名判断）
 * @returns {CaptionParseResult} 片段列表与 warning
 */
export function parseCaptionFile(text: string, fileName: string): CaptionParseResult {
  if (typeof text !== 'string' || text.length === 0) {
    return { cues: [], warnings: ['字幕文件内容为空'] }
  }
  if (text.length > CAPTION_MAX_FILE_CHARS) {
    return { cues: [], warnings: [`字幕文件超过 ${CAPTION_MAX_FILE_CHARS} 字符上限，请拆分后重试`] }
  }
  try {
    switch (detectCaptionFormat(fileName, text)) {
      case 'srt': return parseSrt(text)
      case 'ass': return parseAss(text)
      default: return { cues: [], warnings: ['无法识别字幕格式，请选择 .srt 或 .ass 文件'] }
    }
  } catch (error) {
    return { cues: [], warnings: [`字幕解析失败：${error instanceof Error ? error.message : String(error)}`] }
  }
}

/**
 * 把毫秒按每秒 ticks 换算为时间轴 ticks（非法输入按 0，起点可为 0）。
 * @param milliseconds 毫秒
 * @param ticksPerSecond 每秒 ticks
 * @returns {number} 非负整数 ticks
 */
export function captionMsToTicks(milliseconds: number, ticksPerSecond: number): number {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 0
  const safeTps = Number.isFinite(ticksPerSecond) && ticksPerSecond > 0 ? ticksPerSecond : 120000
  return Math.round((milliseconds / 1000) * safeTps)
}

/**
 * 字幕时长换算：至少 1 tick，避免零时长片段在时间轴上不可见。
 * @param startMs 起始毫秒
 * @param endMs 结束毫秒
 * @param ticksPerSecond 每秒 ticks
 * @returns {number} 正整数 ticks
 */
export function captionDurationTicks(startMs: number, endMs: number, ticksPerSecond: number): number {
  return Math.max(1, captionMsToTicks(endMs, ticksPerSecond) - captionMsToTicks(startMs, ticksPerSecond))
}
