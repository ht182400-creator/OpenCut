/**
 * P3 长尾批 2 · 快捷键重绑定的单一事实来源。
 *
 * 打通此前三套互不相通的动作标识：
 * - 经典版定义表 `commands-tokens.ts` 的 kebab id（如 `frame-step-forward`）；
 * - 分发层 `ShortcutAction`（camel，如 `nextFrame`）；
 * - 录制对话框的「已实现」集合（此前硬编码 9 项，与真实实现错位）。
 *
 * 本模块把「动作主键」统一为 kebab id，默认绑定、用户覆盖、事件匹配全部基于它。
 * 全部为纯函数 + 可注入存储，便于单测覆盖（正常/边界/异常）。
 */

/** 键盘事件最小结构（真实 KeyboardEvent 与测试桩都满足）。 */
export interface ShortcutEvent {
  key: string
  ctrlKey?: boolean
  metaKey?: boolean
  altKey?: boolean
  shiftKey?: boolean
  target?: { tagName?: string; isContentEditable?: boolean } | null
}

/** 分发层动作名（保持既有 API 不变，13 项）。 */
export type ShortcutAction =
  | 'togglePlay'
  | 'prevFrame'
  | 'nextFrame'
  | 'firstFrame'
  | 'lastFrame'
  | 'deleteSelected'
  | 'splitAtPlayhead'
  | 'trimIn'
  | 'trimOut'
  | 'copySelected'
  | 'pasteAtPlayhead'
  | 'duplicateSelected'
  | 'selectAll'

/** 可注入的最小存储接口（localStorage 与内存桩都满足）。 */
export interface BindingStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

/** localStorage 持久化 key（与经典版一致）。 */
export const KEYBINDINGS_STORAGE_KEY = 'opencut-keybindings'

/**
 * 分发动作 → 经典版定义表 kebab id 的唯一映射。
 * 经典版定义表没有 trim-in/trim-out，本工程 i/o 是已实现动作，故在定义表补齐这两项后映射。
 */
export const SHORTCUT_ACTION_TO_ID: Readonly<Record<ShortcutAction, string>> = Object.freeze({
  togglePlay: 'toggle-play',
  prevFrame: 'frame-step-backward',
  nextFrame: 'frame-step-forward',
  firstFrame: 'goto-start',
  lastFrame: 'goto-end',
  deleteSelected: 'delete-selected',
  splitAtPlayhead: 'split',
  trimIn: 'trim-in',
  trimOut: 'trim-out',
  copySelected: 'copy-selected',
  pasteAtPlayhead: 'paste-copied',
  duplicateSelected: 'duplicate-selected',
  selectAll: 'select-all',
})

/** kebab id → 分发动作（上表的反向视图）。 */
export const ID_TO_SHORTCUT_ACTION: Readonly<Record<string, ShortcutAction>> = Object.freeze(
  Object.fromEntries(
    Object.entries(SHORTCUT_ACTION_TO_ID).map(([action, id]) => [id, action as ShortcutAction]),
  ),
)

/**
 * 本工程实际生效的默认绑定（经典版 combo 字符串规范）。
 * 与既有 matchShortcut 行为一致；不含 undo/redo（归 clip-history，Ctrl+Z 不接管）。
 * 未实现的经典版默认键（如 toggle-play 的 k）不放进来，避免显示生效但按了不动。
 */
export const EFFECTIVE_DEFAULT_BINDINGS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'toggle-play': ['space'],
  'frame-step-backward': ['left'],
  'frame-step-forward': ['right'],
  'goto-start': ['home'],
  'goto-end': ['end'],
  'delete-selected': ['delete', 'backspace'],
  split: ['s'],
  'trim-in': ['i'],
  'trim-out': ['o'],
  'copy-selected': ['ctrl+c'],
  'paste-copied': ['ctrl+v'],
  'duplicate-selected': ['ctrl+d'],
  'select-all': ['ctrl+a'],
})

/** 用户绑定表：kebab id → combo 字符串数组。 */
export type Keybindings = Record<string, string[]>

/** 把 KeyboardEvent.key 归一化为经典版 combo 片段（space/left/right/…）。 */
export function normalizeKeyToken(key: string): string {
  const aliases: Record<string, string> = {
    ' ': 'space',
    Spacebar: 'space',
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    Delete: 'delete',
    Backspace: 'backspace',
    Home: 'home',
    End: 'end',
    Enter: 'enter',
    Escape: 'escape',
    Esc: 'escape',
  }
  return aliases[key] ?? key.toLowerCase()
}

/** 输入框获得焦点时不劫持键盘（否则数字输入、快捷键互相打架）。 */
export function isTypingTarget(event: ShortcutEvent): boolean {
  const target = event.target
  if (!target) return false
  if (target.isContentEditable) return true
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes((target.tagName ?? '').toUpperCase())
}

/**
 * 把键盘事件转为经典版 combo 字符串（修饰键顺序 ctrl→alt→shift；meta 视为 ctrl）。
 * @param event 键盘事件或测试桩
 * @returns combo 字符串（如 ctrl+shift+right、space）
 */
export function comboFromEvent(event: ShortcutEvent): string {
  const parts: string[] = []
  if (event.ctrlKey || event.metaKey) parts.push('ctrl')
  if (event.altKey) parts.push('alt')
  if (event.shiftKey) parts.push('shift')
  parts.push(normalizeKeyToken(event.key))
  return parts.join('+')
}

/** 安全取得存储对象：不可用时返回 null（异常降级，不影响主流程）。 */
function safeStorage(storage?: BindingStorage): BindingStorage | null {
  if (storage) return storage
  try {
    if (typeof localStorage !== 'undefined') return localStorage
  } catch {
    // 某些隐私模式下访问 localStorage 抛错，降级为无存储。
  }
  return null
}

/**
 * 从存储读取用户绑定；JSON 损坏或结构非法时返回空对象（静默降级）。
 * @param storage 可注入存储，省略时用 localStorage
 */
export function loadBindings(storage?: BindingStorage): Keybindings {
  const store = safeStorage(storage)
  if (!store) return {}
  try {
    const raw = store.getItem(KEYBINDINGS_STORAGE_KEY)
    if (!raw) return {}
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const result: Keybindings = {}
    for (const [id, combos] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(combos)) continue
      const valid = combos.filter((combo): combo is string => typeof combo === 'string' && combo.length > 0)
      if (valid.length > 0) result[id] = valid
    }
    return result
  } catch {
    return {}
  }
}

/**
 * 合并默认绑定与用户覆盖：用户为某动作录制过组合键则以用户值为准（旧默认失效）。
 * 只保留本工程已接入的动作 id，忽略存储中的未知 id。
 */
export function resolveBindings(storage?: BindingStorage): Keybindings {
  const user = loadBindings(storage)
  const result: Keybindings = {}
  for (const id of Object.keys(EFFECTIVE_DEFAULT_BINDINGS)) {
    result[id] = user[id] ? [...user[id]] : [...EFFECTIVE_DEFAULT_BINDINGS[id]]
  }
  return result
}

/**
 * 写入单个动作的绑定（覆盖该动作全部 combos）。
 * @param id 经典版 kebab 动作 id
 * @param combos combo 字符串数组
 * @param storage 可注入存储
 */
export function saveBinding(id: string, combos: string[], storage?: BindingStorage): Keybindings {
  const next = loadBindings(storage)
  next[id] = [...combos]
  const store = safeStorage(storage)
  try { store?.setItem(KEYBINDINGS_STORAGE_KEY, JSON.stringify(next)) } catch { /* 存储失败不影响主流程 */ }
  return next
}

/** 清除所有用户绑定（恢复默认）。 */
export function clearBindings(storage?: BindingStorage): void {
  const store = safeStorage(storage)
  try { store?.removeItem(KEYBINDINGS_STORAGE_KEY) } catch { /* 忽略存储失败 */ }
}

/**
 * 用给定绑定表把键盘事件匹配为分发动作；不匹配返回 null。
 * @param event 键盘事件或测试桩
 * @param bindings 绑定表（由 resolveBindings 生成）
 */
export function matchEventToAction(
  event: ShortcutEvent,
  bindings: Keybindings,
): ShortcutAction | null {
  if (!event.key || isTypingTarget(event)) return null
  const combo = comboFromEvent(event)
  for (const [id, action] of Object.entries(ID_TO_SHORTCUT_ACTION)) {
    if (bindings[id]?.includes(combo)) return action
  }
  return null
}

/**
 * 检测一个 combo 是否已被别的动作占用（用于录制时给出冲突提示）。
 * @param combo 待检查 combo
 * @param bindings 当前绑定表
 * @param exceptId 允许占用该 id 自身（编辑自己的绑定不算冲突）
 * @returns {string | null} 冲突的动作 id，无冲突返回 null
 */
export function findComboConflict(combo: string, bindings: Keybindings, exceptId?: string): string | null {
  for (const [id, combos] of Object.entries(bindings)) {
    if (id === exceptId) continue
    if (combos.includes(combo)) return id
  }
  return null
}
