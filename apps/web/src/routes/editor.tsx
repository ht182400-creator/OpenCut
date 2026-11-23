import { createFileRoute } from '@tanstack/react-router'
import { Editor } from '../local/editor-page'

// 路由文件只导出 Route：页面组件放在非路由文件 local/editor-page.tsx，
// 避免 TanStack Router 因命名导出而无法对本路由做代码分割。
export const Route = createFileRoute('/editor')({ component: Editor })
