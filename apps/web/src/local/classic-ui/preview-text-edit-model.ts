/**
 * 预览文字就地编辑：草稿提交/取消的纯函数层（UI 长尾 U-08）。
 *
 * 把「双击后进入编辑 → Enter/blur 提交 → Escape 取消」的判定从预览组件抽离，
 * 便于单测覆盖空文本、Shift+Enter 换行、无变化不提交等分支。
 */

/** Enter 键名（提取常量，避免业务代码裸字符串）。 */
const KEY_ENTER = 'Enter'
/** Escape 键名。 */
const KEY_ESCAPE = 'Escape'

/** 按键语义：提交 / 取消 / 无动作（继续输入或换行）。 */
export type TextEditKeyAction = 'commit' | 'cancel' | 'none'

/**
 * 进入编辑态时的初始草稿文本。
 * 缺失内容按空串处理，保证 contentEditable 始终有确定的初始值。
 * @param content 元素当前文字（可能缺失）
 * @returns 可编辑的草稿文本
 */
export function initialTextDraft(content: string | undefined): string {
  return typeof content === 'string' ? content : ''
}

/**
 * 判断草稿是否值得提交。
 * 与原文一致时不写回，避免产生无意义的历史快照与 autosave 抖动。
 * @param draft 当前草稿
 * @param original 进入编辑时的原文
 * @returns 文本真的变化才返回 true
 */
export function shouldCommitText(draft: string, original: string): boolean {
  return draft !== original
}

/**
 * 把按键翻译为编辑动作。
 * Enter 提交、Shift+Enter 允许换行（none）、Escape 取消、其余键继续输入。
 * @param key KeyboardEvent.key
 * @param shiftKey 是否按住 Shift
 * @returns 编辑器应执行的动作
 */
export function textEditKeyAction(key: string, shiftKey: boolean): TextEditKeyAction {
  if (key === KEY_ENTER) return shiftKey ? 'none' : 'commit'
  if (key === KEY_ESCAPE) return 'cancel'
  return 'none'
}
