/**
 * 经典版设置面板扩展（D 档）：FPS / 宽高比 / 背景色。
 * 与 ExportSettingsPanel 并列置于素材面板 settings tab，由调用方提供枚举与回调。
 */

/** 宽高比选项（来自 asset-catalog.json settings.aspectRatios）。 */
export interface AspectRatioOption {
  label: string
  width: number
  height: number
}

/** 背景色选项。 */
export interface BackgroundOption {
  id: string
  label: string
  value: string
}

/** 面板属性。 */
export interface ProjectSettingsPanelProps {
  fpsOptions: readonly number[]
  currentFps: number
  onFpsChange: (fps: number) => void
  aspectRatios: readonly AspectRatioOption[]
  currentAspect: string
  onAspectChange: (ratio: AspectRatioOption) => void
  backgrounds: readonly BackgroundOption[]
  currentBackground: string
  onBackgroundChange: (background: BackgroundOption) => void
}

/**
 * 项目设置：FPS / 宽高比 / 背景色三组选择器。
 * @param props 枚举与当前值、变更回调
 * @returns 设置面板 React 节点
 */
export function ProjectSettingsPanel(props: ProjectSettingsPanelProps): React.ReactElement {
  const selectStyle: React.CSSProperties = {
    background: 'var(--input)', color: 'var(--foreground)',
    border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
    padding: '4px 6px', fontSize: 'var(--text-sm)', width: '100%',
  }
  const rowStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 'var(--text-sm)', color: 'var(--muted-foreground)',
  }
  return (
    <div data-testid="project-settings-panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ fontWeight: 600, fontSize: 'var(--text-sm)' }}>项目设置</div>
      <div style={rowStyle}>
        <label htmlFor="project-fps" style={{ width: 72 }}>FPS</label>
        <select id="project-fps" data-testid="project-fps" value={props.currentFps} onChange={(e) => {
          // 与宽高比/背景一致：只接受枚举内的合法值，非法/空枚举输入不触发回调。
          const fps = Number(e.target.value);
          if (props.fpsOptions.includes(fps)) props.onFpsChange(fps);
        }} style={selectStyle}>
          {props.fpsOptions.map((fps) => <option key={fps} value={fps}>{fps}</option>)}
        </select>
      </div>
      <div style={rowStyle}>
        <label htmlFor="project-aspect" style={{ width: 72 }}>宽高比</label>
        <select id="project-aspect" data-testid="project-aspect" value={props.currentAspect} onChange={(e) => {
          const option = props.aspectRatios.find((r) => r.label === e.target.value)
          if (option) props.onAspectChange(option)
        }} style={selectStyle}>
          {props.aspectRatios.map((ratio) => <option key={ratio.label} value={ratio.label}>{ratio.label}</option>)}
        </select>
      </div>
      <div style={rowStyle}>
        <label htmlFor="project-background" style={{ width: 72 }}>背景</label>
        <select id="project-background" data-testid="project-background" value={props.currentBackground} onChange={(e) => {
          const option = props.backgrounds.find((b) => b.id === e.target.value)
          if (option) props.onBackgroundChange(option)
        }} style={selectStyle}>
          {props.backgrounds.map((bg) => <option key={bg.id} value={bg.id}>{bg.label}</option>)}
        </select>
      </div>
    </div>
  )
}
