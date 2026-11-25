/** U-08：预览文字就地编辑纯函数测试（正常/边界/分支全覆盖）。 */
import { describe, expect, it } from 'vitest'

import { initialTextDraft, shouldCommitText, textEditKeyAction } from './preview-text-edit-model'

describe('initialTextDraft 初始草稿', () => {
  it('正常值原样返回', () => {
    expect(initialTextDraft('默认文字')).toBe('默认文字')
  })

  it('边界：空串与 undefined 均归为空串', () => {
    expect(initialTextDraft('')).toBe('')
    expect(initialTextDraft(undefined)).toBe('')
  })
})

describe('shouldCommitText 提交判定', () => {
  it('与原文一致时不提交', () => {
    expect(shouldCommitText('abc', 'abc')).toBe(false)
  })

  it('文本变化才提交', () => {
    expect(shouldCommitText('新文字', '旧文字')).toBe(true)
  })

  it('边界：清空文本也算变化', () => {
    expect(shouldCommitText('', '旧文字')).toBe(true)
  })

  it('边界：从空串输入也算变化', () => {
    expect(shouldCommitText('新文字', '')).toBe(true)
  })
})

describe('textEditKeyAction 按键语义', () => {
  it('Enter 提交', () => {
    expect(textEditKeyAction('Enter', false)).toBe('commit')
  })

  it('Shift+Enter 不提交（允许换行）', () => {
    expect(textEditKeyAction('Enter', true)).toBe('none')
  })

  it('Escape 取消', () => {
    expect(textEditKeyAction('Escape', false)).toBe('cancel')
  })

  it('边界：其他键继续输入', () => {
    expect(textEditKeyAction('a', false)).toBe('none')
    expect(textEditKeyAction('Backspace', false)).toBe('none')
    expect(textEditKeyAction('Tab', false)).toBe('none')
  })
})
