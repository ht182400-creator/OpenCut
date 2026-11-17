import { cn } from "#/lib/utils.ts"
import { HugeiconsIcon } from "@hugeicons/react"
import { Loading03Icon } from "@hugeicons/core-free-icons"

function Spinner({ className, strokeWidth = 2, ...props }: React.ComponentProps<"svg">) {
  // HugeiconsIcon 的 strokeWidth 仅接受 number；SVG 原生类型是 string | number，这里归一化。
  const normalizedStrokeWidth = typeof strokeWidth === "number" ? strokeWidth : Number(strokeWidth) || 2
  return (
    <HugeiconsIcon icon={Loading03Icon} strokeWidth={normalizedStrokeWidth} role="status" aria-label="Loading" className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
