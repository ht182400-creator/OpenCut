import { createFileRoute } from '@tanstack/react-router'
import { Editor } from './editor'

// 根路由与 /editor 共用同一个编辑器组件：正式入口用干净的 `/`，
// /editor 保留为兼容路径。8 批经典版 1:1 UI 成果不改动。
export const Route = createFileRoute('/')({ component: Editor })
