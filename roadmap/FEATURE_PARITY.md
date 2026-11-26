# 功能对照清单：经典版 vs 本版本（UI 操作闭环）

> 建立：2026-11-17。用户质疑「只是占位，用 Rust 实现和迁移有什么意义」后要求产出完整清单；随后确认口径为「聚焦 UI 闭环能力」。
> 本文只描述**事实状态**，不为任何实现辩护。所有条目均可按证据复核。

## 0. 范围与口径（2026-11-17 调整后）

- **对照范围**：只列「用户在编辑器 UI 能触发并看到结果」的功能。判定标准是**能否完成一个操作闭环**：从用户动作 → 状态变化 → 可见结果（画面/时间轴/文件）全程真实。
- **工程侧能力不参与对照**：Rust core 契约、golden 用例、MCP、Headless CLI、插件运行时、OTIO/PNG/WAV 等，单列到 §8「工程侧能力」，**不计入视觉 1:1 对照，也不计入统计**。理由：这些能力没有 UI 入口，用户在本版本页面上感知不到，不能拿来抵消 UI 缺口。
- **状态定义**（收紧后）：
  - `✅ 已实现`：UI 操作有真实闭环，且有测试或浏览器验收证据。细节简化但闭环完整仍记 ✅（备注写明简化点）。
  - `🟡 部分闭环`：主闭环真实，但关键子步骤缺失（如能导出但无取消、能撤销但只覆盖部分操作）。
  - `🔴 占位`：UI 可见/可点，但不产生真实结果，或只改本地视觉状态/提示文案。
  - `⚪ 未覆盖`：本版本没有该 UI 入口；或经典版本身即 coming soon/disabled，双方都不提供闭环。
- **视觉 1:1 已达成**（8 批改造 + 批 8 并排截图），本清单不重复论证视觉，只评能力闭环。见 `UI_REPLICA_PLAN.md` §3。
- **重要纠偏**：此前把「不能新增元素」归因于「core 不支持」是**错的**。经典版实证（附录 A）表明新增文字是纯前端编辑器逻辑（命令模式 + placement + undo），不依赖 Rust core。缺的是编辑器应用层。

## 1. 顶层导航 / 项目

| 功能 | 经典版 | 本版本 | 状态 | 本版本证据 / 判定依据 |
| --- | --- | --- | --- | --- |
| 正式入口 `/` | `/editor/{id}` + 项目列表 | `/` 渲染编辑器，`/editor` 兼容 | ✅ | `routes/index.tsx` 复用 Editor |
| 主题切换（亮/暗） | 真实 | 真实 | ✅ | `classic-ui/theme.css` + 顶栏按钮 |
| 顶栏导出按钮 | 真实 Popover | 真实（settings + 顶栏一键导出） | ✅ | `handleExport` 真导出 MP4 下载 |
| 快捷键帮助对话框 | 真实（8 分类/31 动作） | 对话框可开、可录制、可 Reset、冲突提示 | ✅ | P3 批 2：录制经 `shortcut-bindings.ts` 打通分发，冲突键拒绝覆盖，未实现动作诚实标注 disabled（如 toggle-ripple-editing/source-audio 等需真实能力项）；第二档项3 补齐 9 项 + snapping 后 j/l/q/w/n 等已生效；`oc-p3-keybinding.png` |
| 项目名就地重命名 | 真实 | 无 | ⚪ | — |
| 项目列表（新建/打开/搜索/排序/批量删除） | 真实 | 无 | ⚪ | — |
| 反馈 / Onboarding / Changelog / Discord 外链 | 真实 | 无 | ⚪ | — |
| 移动端拦截 | 真实 | 真实 | ✅ | `mobile-gate.tsx`，800px 浏览器验收 |
| GPU 降级横幅 | 真实 | 无 | ⚪ | — |
| 显式保存按钮 | 经典版无（自动保存） | 无（改手动「写回经典版 JSON」下载，归 §8） | ⚪ | — |

## 2. 素材面板九 tab

| Tab / 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| Media：导入视频/音频 | 真实 | 真实（JSON 项目 + 真实音视频解码） | ✅ | `editor.tsx` 导入 + `media.ts` |
| Media：网格卡片/时长/名称/排序 | 真实 | 真实（网格/缩略图/名称 + 原序/名称/时长/类型四键排序） | ✅ | `asset-sort.ts` 纯函数 11 项单测 + `assets-panel.tsx` 排序控件；浏览器验收名称升/降序真实换序、Original 恢复导入序、排序后加入时间轴闭环（片段 2→3），`oc-asset-sort.png` |
| Media：真实帧缩略图 | 真实 | 真实（批 7.4） | ✅ | `thumbnail.ts` + core `thumbnail_rgba` |
| Media：卡片 + / 拖拽加入时间轴 | 真实 | 真实（点击 + 拖放均插入，自动找空位 + undo） | ✅ | P0：`element-model.ts` + `handleAddAsset` + 时间轴 `onDropAsset`，浏览器验收 |
| 视频卡片预览播放 | 真实 | 无 | ⚪ | — |
| Sounds：音效库/搜索/试听/收藏 | 真实 | 真实（12 个 Kenney CC0 音效，搜索/分类/试听/收藏/加入时间轴） | ✅ | D 档：`public/assets/sounds/*.ogg` + `asset-catalog.json`，`asset-catalog.ts` 过滤纯函数（11 项单测），`assets-panel.tsx` SoundsView 真实网格；浏览器验收搜索 musical→pluck/bong、收藏 ★、加入时间轴 elements+1；**互联网素材端到端验证**：HTTP 200 `audio/ogg`、真实音频解码 0.103s、写回 JSON 中 Click 音效在 audio 轨且 `mediaId=/assets/sounds/click_001.ogg`、未知字段保留，`oc-d-sounds-writeback.json`；**往返验证**：写回文件重新导入后 Click 音效 `mediaId` + `trackId=audio-1`、🚀 贴纸 `content` 均完整恢复，6 元素轨归属不变。过程中修复 3 个 bug：`buildMediaElement` 漏写 mediaId、写回三路径漏传 mediaId、音效默认落 main 轨（改正为自动选首条 audio 轨）。来源见 `public/assets/ATTRIBUTION.md` |
| Text：Default text 加入时间轴 | 真实 | 真实（插入 text 元素 + 属性面板编辑 + 预览渲染） | ✅ | P0：用户实测起点已闭环，`oc-p0-text-preview.png` 截图验收 |
| Stickers：分类/搜索/添加 | 真实 | 真实（12 个 Twemoji SVG 贴纸，分类/搜索/点击或拖入加入时间轴） | ✅ | D 档：`public/assets/stickers/*.svg` + 目录 `char` 字段；点击生成 `elementType:'text'` + `content=emoji`（预览 canvas 原生渲染，无需扩 core，优于清单里 `shape.imageSrc` 备选方案）；浏览器验收搜 rocket→Rocket、加入后 autosave elements 5 且 `content='🚀'` |
| Effects：效果网格/预览/添加 | 真实 | 真实（8 个颜色参数预设，CSS 渐变预览 + 点击应用到选中元素并可撤销） | ✅ | D 档：目录 `effects` 预设（brightness/contrast/saturate 与 `properties-tokens.ts` key 一致），`EffectsView` 网格 + `onApplyEffect` → `applyPropertyPatch`；浏览器验收点 vivid 后元素 params 写入 `effects.brightness=1.05/contrast=1.25/saturate=1.3`。**边界**：仅颜色三参数，复杂滤镜（模糊/锐化/暗角）需扩 core，未做 |
| Transitions | 经典版 coming soon | coming soon | ⚪ | 双方均无闭环 |
| Captions：AI 字幕生成 | 真实（本地转写模型） | 无 | ⚪ | 需转写服务/模型 |
| Captions：SRT/ASS 导入 | 真实 | 真实（24 项解析单测 + 15 项 golden master + 浏览器真实 SRT 验收） | ✅ | C 档：`caption-import.ts` 解析 SRT（序号/BOM/CRLF/毫秒点号/短时间/尾部坐标）与 ASS（Format 字段定位/样式块剥离/逗号正文），异常行跳过并记 warning；`buildCaptionElement` 落 `elementType:'caption'` + content/params 文本通道 + 文字轨 `overlay-text`，core 7.1 已支持 Caption read→write 保真；浏览器上传真实 `oc-captions-sample.srt` → 状态「已导入 3 条字幕」+ autosave 3 个 caption 元素（startTime 0/240000/480000），写回 JSON 经 project-write 测试验证类型/正文保真，`oc-captions-import.png` |
| Adjustment | 经典版 coming soon | coming soon | ⚪ | 双方均无闭环 |
| Settings：FPS / 宽高比 / 背景 | 真实 | 真实（FPS 4 档、宽高比 4 档、背景 3 色，切换同步 session/profile 并提示重导） | ✅ | D 档：`project-settings-panel.tsx` 三组选择器，FPS 改 `session.fps`+`ticksPerFrame`、宽高比映射偶数高度分辨率走 `handleResolutionChange`、背景写 `profile.backgroundRgba`；浏览器验收 FPS 受控值 30→60、背景 black→white。枚举来自目录 JSON |

## 3. 时间轴

| 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| 三轨结构（overlay/main/audio） | 真实（可动态建 text/graphic/effect 子轨） | 真实（可新增任意条 overlay/audio 轨，autosave 持久化，写回经典版 JSON 后保真） | ✅ | U-06：时间轴工具栏「新增轨道」下拉选类型（video/text/graphic/effect/audio），core `write_classic_project_with_options` 带 `allowNewTracks` 显式开关（默认 additive-only 不变），新轨按类型进 overlay/audio 数组、main 保持单条；4 项 Rust 往返用例 + 5 项 Web 用例；浏览器验收新增 text 轨后刷新仍在、写回 JSON overlay 含新轨且未知字段保留，`oc-new-track.png` / `oc-u06-writeback.json` |
| 轨道头静音/隐藏 | 真实 | 点击生效 + autosave 刷新恢复 + 写回经典版 JSON（additive-only） | ✅ | P4 批 6 autosave + `fad92d49` 第一档 A：`buildWriteView` 传 trackFlags → core `project_compat.rs` `muted`/`hidden` 按 id 写回原 JSON；`project_write.rs` 往返测试含「原 JSON 无字段不新增」保护 |
| 片段选中/点击联动属性 | 真实 | 真实 | ✅ | 批 4 浏览器验收 |
| 片段移动/resize/trim（main 轨） | 真实 | 真实（core 契约） | ✅ | `moveClipClamped`/`resizeClipEdge` |
| overlay/audio 轨编辑 | 真实（全轨） | 真实（非 main 轨可移动/裁剪/分割/删除，索引与邻居约束按轨隔离，写回 JSON 保真） | ✅ | U-07：`loadProject` 纳入全部轨元素并带 `trackId`；`timeline.ts` 约束函数按轨过滤邻居、split 继承轨归属；删除 ripple 逐轨计算互不干扰；`buildWriteView` 按 `trackId` 路由新元素；core `merge_track` 在 `allowNewTracks` 开关下允许已有轨新元素。浏览器验收 audio-bed 分割后 `audio-bed#2` 仍在 audio 轨、删除后 main 两片段不变、写回 JSON 未知字段保留，`oc-u07-writeback.json` |
| Split / Split left / right | 真实 | 真实（main 轨，工具栏） | ✅ | — |
| Duplicate / Delete | 真实 | Delete 真实；Duplicate 真实（Ctrl+D / 工具栏） | ✅ | P1：`element-operations.ts` `duplicateElements`，浏览器验收 4→6 片段 |
| 多选 / 框选 / Shift 加选 | 真实 | Cmd/Ctrl 加选 + Shift 区间 + Ctrl+A 全选 + 空白拖框选（Shift 加框） | ✅ | P1：`use-selection.ts` 多选 + P2 长尾批：`timeline.tsx` 框选橡皮筋（`selectFromBox`/`normalizeTimelineRect`/`rectsIntersect`），浏览器验收框选 clip-intro+clip-body 高亮，`oc-p3-marquee.png` |
| 拖拽素材落入时间轴 | 真实 | 真实（落点 ticks 换算 + 插入） | ✅ | P0：`timeline.tsx` onDrop → `handleTimelineDrop`，浏览器验收 |
| 复制 / 粘贴片段 | 真实 | 真实（Ctrl+C/V 内存剪贴板） | ✅ | P1：`element-operations.ts` `copyElements`/`pasteElements`，浏览器验收 6→8 片段 |
| Ripple editing 开关 | 真实 | 无（core 有契约但 UI 未接） | ⚪ | — |
| 关键帧显示/拖动/曲线编辑器 | 真实 | 真实动画轨道 + 可视化 SVG 曲线（拖动改值/双击加点/右键删点/缓动切换） | ✅ | P2 关键帧模型 + P3 批 3 `curve-editor.tsx`/`curve-editor-model.ts`，浏览器验收拖动改 time/value，`oc-p3-curve-editor.png` |
| 书签（增删改/拖动/备注） | 真实 | 添加/点击 seek/右键删除/拖动改位置/双击备注，autosave 刷新恢复 + 写回经典版 JSON（additive-only） | ✅ | P4 批 6 书签渲染 + `fad92d49` JSON 写回 + 2026-11-24 UI 长尾：`bookmark-model.ts` 拖动 ticks 换算（pointer capture + 4px 阈值）+ 双击 inline 备注（note 可选字段，additive-only），10 项纯函数单测 + autosave/project-write note 往返；浏览器验收拖动 left 0→98.58px、autosave `ticks=128000/note=开场提示`，`oc-bookmark-drag-note.png` |
| 缩放（按钮/滑杆/ctrl-wheel） | 真实 | 真实 | ✅ | 批 2 验收 |
| seek（标尺点击/播放头拖动） | 真实 | 真实 | ✅ | 批 2 验收 |
| 场景切换/删除 | 真实 | 无（单场景 fixture） | ⚪ | — |
| 音频波形 | 真实 | 真实（批 7.3 + 超长素材降采样修复） | ✅ | `downsampleForWaveform` |

## 4. 预览

| 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| 播放 / 暂停 | 真实 | 真实 | ✅ | 时间码推进已验收 |
| 时间码 HH:MM:SS:FF | 可编辑并驱动 seek | 可编辑（回车/失焦提交，越界 clamp 到末帧） | ✅ | 批 4：`preview-tokens.ts` `parseFrameTimecode`/`formatFrameTimecode`（9 项单测），浏览器输入 `00:00:01:15` 精确 seek |
| 缩放预设 + Fit + 全屏 | 真实 | 真实 | ✅ | 批 5 验收 |
| 选框/手柄/对齐参考线 | 真实（改 transform） | 真实（选框 + 四角/三边/旋转手柄 + 画布三锚点吸附参考线，拖拽松手统一写回 position/scale/rotate 并驱动画面） | ✅ | 第二档写回 + U-04：`preview-transform-model.ts` 新增 `snapBoxToCanvas`（左/中/右、上/中/下三锚点，10 项单测，模块共 21 项），`preview-section.tsx` 旋转手柄用 CSS `max()` 夹在画布内、参考线改画在 stage 画布坐标系；浏览器验收旋转手柄完整可见且拖拽写回 `rotate=117.6°`，边缘吸附出现 vertical/horizontal@0% 且 `positionX=-79.86/scaleX=0.50`，`oc-rotate-handle.png` / `oc-snap-guides.png` |
| 遮罩手柄 | 真实 | 真实（预览叠加遮罩矩形 + 4 边拖拽手柄，驱动 mask.* 参数并像素裁剪生效） | ✅ | P4 批 5：`resizeMask` 纯函数 + `preview-section.tsx` 手柄，浏览器拖动 left 写回 `mask.left=0.052`，`oc-p4-mask-handle.png` |
| 双击文字就地编辑 | 真实 | 真实（双击预览画布进入 contentEditable，Enter/blur 提交、Shift+Enter 换行、Escape 取消；经 `applyPropertyPatch` 写回 content + params.content，撤销与刷新恢复均闭环） | ✅ | U-08：`preview-text-edit-model.ts` 纯函数（初始草稿/提交判定/按键语义，10 项单测），`preview-section.tsx` 加文字编辑 overlay（仅文字元素启用），`editor-page.tsx` 传 `textContent`/`onTextChange` 复用属性写回链路；浏览器验收 title-a 编辑后 autosave content 与 params.content 同步、刷新恢复、Escape 不写回，`oc-u08-inline-edit.png` |
| 画面合成 | 真实（canvas renderer） | 真实（core `composite_frame` + 真实素材帧） | ✅ | 批 7 + 正式模式去演示色块 |
| 右键菜单（Fit/Full screen/Snapshot） | 真实 | 真实（Fit/Full screen/Save snapshot/Copy snapshot） | ✅ | 批 4：`preview-section.tsx` onContextMenu + 自定义菜单，canvas.toDataURL 下载 / ClipboardItem 复制，浏览器验收 4 项菜单显示与点击关闭，`oc-p4-timecode-menu.png` |

## 5. 属性面板

| 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| 空状态/选中状态文案 | 真实 | 真实（含经典版字面 `.0`） | ✅ | 批 4 |
| Transform / Blending / Audio / Text 参数 | 真实可编辑并驱动画面 | 受控可编辑并驱动预览（opacity/position/scale/rotate/文字/颜色等；P2 修复点分 key 映射，transform 编辑真正驱动画面） | ✅ | P0+P2：`properties-panel.tsx` + `element-composite.ts`，浏览器验收 opacity/transform |
| Speed / Masks / Effects / Graphic tab | 真实可编辑 | Masks/Effects/Speed/Graphic 全部可编辑并驱动画面 | ✅ | P2 遮罩/效果；第二档项2：`speed-model.ts` 倍速映射（8 项单测）+ `graphic-model.ts`（形状参数/内外判定/Canvas 栅格化，9 项单测），Assets Text tab 四形状卡 → `buildGraphicElement` → 时间轴 → 属性面板 Graphic tab（Shape/Fill/Stroke/StrokeWidth/CornerRadius）→ frameSource alpha 叠加；浏览器添加 Rectangle 片段、播放到该片段画布全白（白色矩形）、`oc-p3-graphic-element.png` |
| 关键帧开关 + 曲线编辑器 | 真实 | 真实动画轨道 + 可视化曲线编辑器（P3 批 3） | ✅ | P2 模型 + P3 批 3：`curve-editor.tsx` 图形化编辑，属性面板「Animation Curves」入口；见 §3 同名行 |
| Timing（Start/Duration/Trim In/Out） | 经典版在时间轴完成 | 真实编辑 + 写回 JSON | ✅ | 批 7.5 验收 |

## 6. 编辑器引擎（用户可感知）

| 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| 撤销 / 重做 | 真实（命令管理器，覆盖全操作） | 真实（片段 + 书签 + 轨道标志 + 选中态 + ripple 完整快照，撤销/重做/跨会话持久化） | ✅ | U-02：`clip-history.ts` 快照扩为 `EditorSnapshotState`，24 项单测（含旧格式归一化/深拷贝/容量裁剪）；浏览器验收删除→撤销恢复片段 1→2 且书签/静音保持、选中态回到 clip-intro，重做再删、连续撤销逐条回退，`oc-undo-full-coverage.png` |
| 自动保存 | 真实（800ms debounce + IndexedDB/OPFS） | 真实（800ms debounce + IndexedDB 主后端 + localStorage 降级，localStorage→IDB 一次性迁移，刷新恢复；OPFS 未做） | ✅ | P0 刷新恢复 + U-03 介质升级：`autosave-idb.ts` + `project-autosave.ts` 异步读写（12 项单测）；浏览器验收旧 localStorage 数据迁移到 IDB 且迁移标记写入、清除 localStorage 后编辑+刷新仍恢复两个书签，`oc-autosave-idb.png` |
| 快捷键分发 | 真实（可重绑定驱动动作） | 23 项动作（第二档项3 +9：stop/seek±1s/jump±5s/split-left/right/deselect-all/toggle-bookmark；+snapping：n）+ Ctrl/Cmd+C/V/D/A 与 undo/redo，用户重绑定真实驱动 | ✅ | P1 分发 + P3 批 2 + 第二档项3：`shortcut-bindings.ts` 扩 9 动作与默认键（j/l/Shift+方向/q/w），`shortcut-actions-model.ts` 纯函数处理 seek 边界/split 删侧/书签切换（8 项单测），无默认键动作录制后生效；snapping 状态提升到 editor 受控，磁铁按钮与 n 双向同步；浏览器验收 l→+1s、Shift+→→末帧、j→-1s、q→clip-body 2.00s→1.93s、n→aria-pressed true↔false，`oc-p3-shortcut-actions.png`、`oc-p3-snapping.png` |
| 多选/框选/全选 | 真实 | Cmd/Ctrl 加选 + Shift 区间 + Ctrl+A + 空白拖框选 | ✅ | P1 + P2 长尾批：见 §3 同名行 |
| 拖拽排序 | 真实（片段跨轨 + 效果列表） | 真实（片段可跨轨拖放：main/overlay/audio 按指针 Y 判定目标轨，素材卡也可直接落到非主轨；撤销回原轨） | ✅ | U-05：`CoreElement.trackId?` 可选字段（缺省 main）+ `moveElementToTrack` 纯函数（7 项单测），`timeline.tsx` 放开 readOnly、拖拽/落轨带目标轨，`editor-page.tsx` 按 trackId 分轨渲染并统一记史；浏览器验收 clip-intro 从 main 拖到 audio 轨后撤销回原位，`oc-cross-track.png`。**边界**：仅会话内跨轨，写回 JSON 搬轨仍属 additive-only 边界（见 U-06/U-07） |
| 剪贴板直接贴媒体 | 真实 | 无（P1 仅内部元素剪贴板，非系统剪贴板贴文件） | ⚪ | — |
| 面板尺寸可拖拽 | 真实 | 真实 | ✅ | 批 1 |
| GPU/编解码能力提示 | 真实 | P2：WebGL2/WebGPU/硬件编码能力探测 + 诊断面板真实提示 | ✅ | P2：`gpu-capability.ts`，浏览器验收显示「WebGL2 / WebGPU / 硬件视频编码」 |

## 7. 导出 / 交换

| 功能 | 经典版 | 本版本 | 状态 | 判定依据 |
| --- | --- | --- | --- | --- |
| 导出 MP4 (H.264) + AAC | 真实 | 真实 | ✅ | `handleExport` + WebCodecs |
| 导出 WebM (VP9) | 真实 | 真实（VP9 + Opus / AV1 变体，UI 容器可选） | ✅ | 文档更正：`export.ts` 早已实现，P2 核实并改文档；`export.test.ts` 覆盖 |
| 质量档位 / 包含音频开关 | 真实 | 真实（settings 面板） | ✅ | `ExportSettingsPanel` |
| 进度 / 取消 / 错误重试 | 真实 | 进度 + 友好错误 + Cancel（AbortController）+ Retry | ✅ | P4 批 5：`export.ts` signal 检查 + `isExportAborted`，顶栏 Cancel/Retry 按钮；取消回 idle 非 error；`isExportAborted` 单测覆盖（端到端受浏览器 WebCodecs 环境限制未实测） |
| 素材右键 Export clips | 经典版仅展示无 onClick | 无 | ⚪ | 双方均无闭环 |

## 8. 工程侧能力（**不参与对照与统计**）

> 这些是 Rust core / CLI / MCP / 插件层能力，本版本页面上没有 UI 入口。列出仅为说明「Rust 实现做了什么」，不用于抵消 §1~§7 的 UI 缺口。

| 能力 | 状态 | 证据 |
| --- | --- | --- |
| 经典版 JSON 只读兼容层 + 97 golden 用例 | ✅ | `ocx-domain`，Rust 与经典版 TS 共用期望值 |
| 项目 JSON 字段保真写回 | ✅ | `write_classic_project` + `project_write.ts`，批 7.5 |
| 渲染/合成 `composite_frame_rgba` / `render_frame_rgba` | ✅ | `ocx-render`，跨栈 checksum 一致 |
| 波形抽样 / 帧缩略图 | ✅ | `waveform.rs` / `thumbnail.rs` + WASM 契约 |
| 编解码与导出后端 | ✅ | WebCodecs + core render |
| OTIO 导入/导出 | ✅ | W-10，经典版无对应 UI |
| MCP server（`ocx.*` 8 工具） | ✅ | `apps/local-mcp` |
| Headless CLI（frame/batch/PNG/WAV） | ✅ | `apps/local-cli` |
| 插件运行时（wasmi + WIT + 声明式权限） | ✅（Rust core，Web 未暴露入口） | `ocx-plugin-host` |
| 4K scrub 基准 / 代理导出 / 清空缓存 | ✅（诊断面板按钮） | `editor.tsx` |

## 9. 统计（仅 §1~§7 的 UI 闭环项）

| 状态 | 数量 | 分布（§） | 主要条目 |
| --- | --- | --- | --- |
| ✅ 已实现 | 54 | §1:5 §2:10 §3:15 §4:8 §5:5 §6:7 §7:4 | 入口、主题、导出按钮、移动端拦截、媒体导入、真实帧缩略图、**素材排序**、Text/Media 加入时间轴、片段选中、main 轨编辑、Split、落轨拖放、Duplicate/Delete、复制/粘贴、多选+框选、关键帧曲线编辑器、缩放、seek、波形、播放、缩放全屏、画面合成、空状态、Transform/Text 参数、Timing、面板尺寸、多选全选、关键帧开关、快捷键帮助+重绑定、分发、GPU 能力提示、**选框/手柄/参考线吸附闭环**、**双击文字就地编辑**、MP4/WebM 导出、质量档位、**轨道静音/隐藏（JSON 写回闭环）**、**撤销/重做全覆盖**、**自动保存 IndexedDB + 迁移**、**动态新增轨道 + 写回保真**、**overlay/audio 轨编辑写回**、**Sounds/Stickers/Effects/Settings 数据源接入**、**SRT/ASS 字幕导入** |
| 🟡 部分闭环 | 0 | — | 无 |
| 🔴 占位 | 0 | — | 无（D 档 4 项数据源已全部接入） |
| ⚪ 未覆盖 | 13 | §1:5 §2:4 §3:2 §6:1 §7:1 | 项目列表/重命名、反馈/Onboarding 提示、视频卡预览、AI 字幕、Transitions/Adjustment、Ripple、场景、素材右键 Export clips、剪贴板直接贴媒体 |

> 合计 67 项（54+0+0+13），逐项以 §1~§7 表格为准。§8 工程侧 10 项不计入。统计数字按表格状态符号核算（2026-11-24 重新逐行核算并修正：此前 38/9/5/15 与表格符号不符，且 P4 后多处状态更新未回写统计；同日书签拖动/备注闭环后核算为 41/6/5/15，UI 长尾 U-01 素材排序闭环后核算为 42/5/5/15，U-02 撤销重做全覆盖后核算为 43/4/5/15，U-03 自动保存介质升级后核算为 44/3/5/15；2026-11-25 U-04 选框/手柄/参考线吸附闭环后核算为 45/2/5/15，U-05 跨轨拖拽后核算为 46/1/5/15，U-06 动态新增轨道后核算为 47/0/5/15，U-07 overlay/audio 轨编辑写回后核算为 48/0/4/15，U-08 双击文字就地编辑后核算为 49/0/4/14，D 档四项数据源接入后核算为 53/0/0/14，C 档 SRT/ASS 字幕导入后核算为 54/0/0/13）。
> **2026-11-17 P0 完成后变化**：✅ 20→23（Text/Media 加轨、落轨拖放），🟡 7→9（参数编辑、自动保存由 🔴 升级），🔴 19→14。详见 `UI_REPLICA_PLAN.md` §8「P0 闭环实现」。
> **2026-11-17 P1 完成后变化**：✅ 23→25（Duplicate、复制/粘贴），🟡 9→11（多选、快捷键分发升级），🔴 14→13（Duplicate 出占位），⚪ 20→17（多选/复制粘贴出未覆盖）。数据源接入（Sounds/Stickers/Effects）依赖服务端素材库，本仓库无此后端且超出 UI 闭环范围，记 🔴 并写入 `UI_REPLICA_PLAN.md` §7 差异台账；不伪造数据。
> **2026-11-17 P2 完成后变化**：新增 GPU 项（总 66→67）；✅ 25→28（Transform/Text 参数修复 key 映射升 ✅、GPU 提示、WebM 文档更正），🟡 11→13（遮罩/效果基础参数、关键帧真实数据模型），🔴 13→11（参数/关键帧出占位），⚪ 17→15（WebM/GPU 出未覆盖）。AI 字幕、项目管理页无后端，保持 ⚪ 并写入台账；曲线编辑器、GPU 效果、框选橡皮筋归长尾。
> **2026-11-25 更正（历史快照保留原值）**：上文 P1/P2/P4 段所称 Sounds/Stickers/Effects「依赖服务端素材库/需后端」是当时的保守判断；复核现有代码后确认四项均可用**本地 JSON + 静态资产文件**闭环（拖放协议、插入链路、core 参数通道均已就绪），Settings 更是纯前端枚举 + core profile 接线。精确数据源格式与逐项解除 DoD 见 `roadmap/REMAINING_DATA_SOURCES.md`。此更正不改变历史统计值，只更新「解除条件」的认知。
> **2026-11-25 C 档提级（SRT/ASS 字幕导入）**：从 C 档阻塞表中把该项提级（无后端依赖、core 7.1 已支持 Caption 类型），落地 `caption-import.ts`（SRT/ASS 解析纯函数，24 项单测）+ `buildCaptionElement` + Captions tab Import 按钮接线 + 预览文字识别 caption 类型 + 写回测试 2 项；vitest 当日 46 文件 612 项全绿（历史值，当前 58 文件 696 项）、tsc 0、build 成功；ego(lite) 真实 SRT 上传验收见 §2 行与 `oc-captions-import.png`。统计 53/0/0/14 → **54/0/0/13**。

## 10. 闭环优先级（P0 → P2，供实施）

- **P0（让编辑器能用）— ✅ 2026-11-17 完成**：① 新增元素插入（Text / 导入的 media → 时间轴，TS 侧轻量 editor store：buildElement + 插入/删除 + undo + placement）；② 本地自动保存（刷新不丢）；③ 属性参数可编辑并驱动预览（至少 opacity/position/scale/text content）。tsc 0 / vitest 299 / build 通过 + 浏览器截图验收。
- **P1（接近经典版交互）— ✅ 2026-11-17 完成（数据源接入除外）**：多选（Cmd/Ctrl 加选 + Shift 区间 + Ctrl+A）、复制粘贴（Ctrl+C/V/D 内存剪贴板）、快捷键分发（Ctrl/Cmd 组合键）。tsc 0 / vitest 326 / build 通过 + 浏览器截图验收（`oc-p1-multiselect.png`）。**未做**：Sounds/Stickers/Effects 数据源接入 —— 依赖服务端素材库（本仓库无后端），框选橡皮筋、快捷键重绑定归 P2；均写入 `UI_REPLICA_PLAN.md` 台账，不伪造数据。
- **P2（长尾）— ✅ 2026-11-17 完成（可闭环项）**：关键帧曲线（真实动画轨道 + 播放头插值驱动画面，无曲线编辑器 UI）、遮罩/效果编辑（矩形裁剪 + brightness/contrast/saturate 纯像素运算，无 GPU 效果）、GPU 提示（WebGL2/WebGPU/硬件编码能力探测）、WebM 导出（核实早已实现，更正文档）。tsc 0 / vitest 357 / build 通过 + 浏览器截图验收（`oc-p2-keyframes.png`）。**Blocked（无后端，写入台账不伪造）**：项目管理页（无多项目持久化）、AI 字幕（无转写服务）。**归长尾**：可视化曲线编辑器、GPU 效果、框选橡皮筋、快捷键重绑定。
- **P3（UI 长尾三件套，2026-11-20 起逐批推送）— 进行中**：用户选「框选橡皮筋 + 快捷键重绑定 + 可视化关键帧曲线编辑器」逐批提交。① 框选橡皮筋 ✅：`timeline.tsx` 空白拖框 + `selectFromBox` 归约，§3/§6 多选行由 🟡 升 ✅（统计 ✅28→30、🟡13→11），vitest 365、浏览器验收 `oc-p3-marquee.png`。② 快捷键重绑定 ✅：新增 `shortcut-bindings.ts` 作单一事实来源，统一 kebab 动作 id/camel 分发/对话框已实现集（消除原 9 项硬编码错位），`matchShortcut(event, bindings)` 读用户绑定、`ShortcutsDialog` 录制经回调刷新分发，冲突检测拒绝覆盖，未实现动作诚实 disabled；补经典版定义表缺失的 trim-in/trim-out；§1/§6 两行 🟡→✅（统计 ✅30→32、🟡11→9），vitest 373、浏览器验收 k→播放 / space 旧键失效 / Reset 恢复 / 冲突提示，`oc-p3-keybinding.png`。③ 可视化关键帧曲线编辑器 ✅：新增 `curve-editor-model.ts`（坐标换算/命中/值域/折线采样/单帧删除纯函数，20 项单测）+ `curve-editor.tsx`（SVG 网格+曲线+播放头线+菱形关键点，拖动改 time/value、双击加点、右键删点、缓动切换），属性面板加「Animation Curves」入口（有轨道即可用）；修正 §3 L67 过时 🔴 行为 ✅（菱形早已真实写轨）；统计 ✅32→34 / 🟡9→8 / 🔴11→10，vitest 393（31 文件）、浏览器验收拖动关键点改 time/value 生效，`oc-p3-curve-editor.png`。**P3 三件套全部完成**。
- **P4（UI 闭环收尾，2026-11-20 续）— 进行中**：用户「UI 闭环，然后 W-14」。批 4 ✅：预览时间码可编辑（`parseFrameTimecode`/`formatFrameTimecode` + 9 项单测，输入 `00:00:01:15` 精确 seek，越界 clamp 到末帧）+ 右键菜单（Fit/Full screen/Save snapshot/Copy snapshot，`oc-p4-timecode-menu.png`）；§4 两行 🔴→✅、统计 ✅34→36 / 🔴10→8，vitest 397、build 通过、浏览器验收。批 5 ✅：遮罩可视化手柄（`resizeMask` 纯函数 + 预览 4 边拖拽，浏览器拖 left 写回 `mask.left=0.052`，`oc-p4-mask-handle.png`）+ 导出取消/重试（AbortController signal → 循环检测 → `isExportAborted` → idle + Retry，端到端受浏览器 WebCodecs 环境限制未实测，判断函数单测覆盖）；§4 遮罩手柄、§7 导出两行 🟡→✅、统计 ✅36→38 / 🟡8→6，vitest 402。批 6 ✅：书签（添加/点击 seek/右键删除 + autosave）+ 轨道静音/隐藏（点击生效 + autosave），均刷新恢复（`oc-p4-bookmarks.png`），但**不写回经典版 JSON**（core 无轨道/书签字段），按「不伪造」原则记为 🟡 非 ✅；§3 两行 🔴→🟡、统计 🔴8→6 / 🟡6→8，vitest 405。**阶段 A UI 闭环收尾完成**：✅38 / 🟡8 / 🔴6 / ⚪15，剩余 🔴6 中 4 项需后端数据源（Sounds/Stickers/Effects/Settings）、1 项 overlay/audio 轨编辑需扩 core、1 项预览选框手柄改 core 画面需扩 core；均写入台账不伪造。**阶段 B W-14 待 H01 spike 决策后启动**。
- **2026-11-24 校准（第一档 A 写回闭环）**：`fad92d49 feat(web): 第一档A — 轨道静音/隐藏与书签写回经典版 JSON` 已补齐 P4 批 6 留下的 JSON 级缺口：`buildWriteView` 传 trackFlags/bookmarks → core `project_compat.rs` 按 id 写回 `muted`/`hidden`/`scene.bookmarks`（additive-only，原 JSON 无字段不新增），`project_write.rs` 往返测试覆盖。据此 §3「轨道头静音/隐藏」🟡→✅、「书签」描述更新为「JSON 写回已完成、拖动/备注仍缺」（保留 🟡）。重逐行核算 §1~§7 表格符号得 **✅40 / 🟡7 / 🔴5 / ⚪15**（此前统计 38/9/5/15 与表格不符，且 P4 后多处状态更新未回写统计）；统计表分布列同步按实测修正。历史快照（P0~P4）保留原值不篡改。
- **2026-11-24 UI 长尾：书签拖动 / 备注（用户指定）**：新 `bookmark-model.ts` 纯函数（`draggedBookmarkTicks` 拖动位移→ticks 按帧网格吸附、`moveBookmark`、`setBookmarkNote` 空备注删 note 字段），10 项单测覆盖正常/边界/异常；`timeline.tsx` 书签行改 pointer capture + 4px 阈值拖动（Chrome 官方指南）、双击 inline input 设备注（回车/blur 提交、Esc 取消），`touch-action:none`/`user-select:none`；`BookmarkState`/`WriteBookmark`/`timeline props`/`autosave` 全链路加可选 `note`（additive-only，旧数据兼容，非法 note 整条丢弃）。验收：tsc 0、vitest 41 文件 497/497（新增 13）、build 成功、浏览器拖动 left 0→98.58px 且 autosave `ticks=128000/note=开场提示`、`oc-bookmark-drag-note.png`；§3 书签行 🟡→✅，统计 41/6/5/15。**边界**：经典版 note 字段按 changelog 0.1.0 语义以 `{id,ticks,name,note?}` 透传，颜色标签/可选时长未做（不伪造）。
- **2026-11-24 UI 长尾 U-01：Media 素材排序（按 `UI_TAIL_SCHEDULE.md` A 档启动）**：新 `asset-sort.ts` 纯函数（`original`/`name`/`duration`/`type` 四键 × 升降序；原序保持导入顺序、无时长项恒末尾不随方向翻转、名称显式小写比较不依赖运行时 locale、同键值索引兜底稳定），11 项单测覆盖正常/边界/异常；`assets-panel.tsx` MediaView 加本地 `useState<AssetSort>` + `useMemo` 排序后渲染，排序控件带 `data-testid`。不扩 core、不改 `props.assets`（排序只影响展示）。验收：tsc 0、vitest 42 文件 508/508（新增 11）、build 成功；ego(lite) 三份不同文件名真实 MP4 上传后，名称升序 `[a-first,m-mid,z-last]`、降序 `[z-last,m-mid,a-first]`、Original 恢复导入序，排序后点加号加入时间轴片段 2→3，`oc-asset-sort.png`。§2 排序列 🟡→✅，统计 42/5/5/15。
- **2026-11-24 UI 长尾 U-02：撤销/重做全覆盖**：`TimelineSnapshot` 扩为 `EditorSnapshotState`（clips + 书签 + 轨道标志 + 选中态 + ripple adjustments），保留旧类型名、`moveHistory().clips` 兼容字段与可选 `parts` 参数；新增 `normalizeSnapshotState` 对旧持久化条目缺字段逐项给安全默认值（additive-only）。`record` 通过注入 `getParts` 读取当前编辑器现场，新增/删除/片段编辑/复制粘贴/书签/轨道标志统一 `pushSnapshot`；书签拖动以 `commit` 标志区分中间态，pointerup 只提交一条，避免高频写入。`recordHistory` 扩第三参数 `selectedId` 并同步 `use-selection.ts`/`editor-actions.ts` 全部调用方，保证快照记录动作后的选中态。验收：tsc 0、vitest 42 文件 518/518（+10）、build 成功；ego(lite) 实测添加书签→静音→删除片段→撤销：片段 1→2、书签/静音保持、选中态回到 clip-intro，重做再删、连续撤销逐条回退，`oc-undo-full-coverage.png`。§6 撤销行 🟡→✅，统计 43/4/5/15。
- **2026-11-24 UI 长尾 U-03：自动保存介质升级到 IndexedDB**：`project-autosave.ts` 保留同步纯函数（供迁移/单测），提取 `parseAutosaveEnvelope` 让同步/异步共用校验，新增 `AsyncAutosaveStorage` 与 `readAutosaveAsync`/`persistAutosaveAsync`/`clearAutosaveAsync`；新 `autosave-idb.ts` 提供 IndexedDB 后端（事务 complete 后 resolve）、复合后端（IDB 失败降级 localStorage）、`migrateLegacyAutosave` 一次性迁移（原始字符串搬运 + 标记防重复，损坏数据跳过、写入失败不写标记可重试）。编辑器加载项目时先迁移再异步读取，防抖写入改异步。验收：tsc 0、vitest 43 文件 530/530（+12）、build 成功；ego(lite) 实测旧 localStorage 信封（frameIndex=99 + 旧书签）经刷新迁移到 IDB、标记写入且旧数据保留，清除 localStorage 后新增书签→IDB 更新→刷新仍恢复两个书签，`oc-autosave-idb.png`。§6 自动保存行 🟡→✅，统计 44/3/5/15。
- **2026-11-25 UI 长尾 U-04：选框/手柄/对齐参考线闭环**：`preview-transform-model.ts` 新增 `snapBoxToCanvas`（左/中/右、上/中/下三锚点吸附 + 带画布百分比位置的 `SnapGuides`，10 项单测，模块共 21 项）；`preview-section.tsx` 旋转手柄从「顶边外移 24px」改为 CSS `max()` 夹在画布内（满幅元素贴顶时不再被 `overflow:hidden` 裁掉），参考线从选框内部移到 stage 画布坐标系并按锚点定位，旋转模式不再误触发位置吸附。验收：tsc 0、vitest 43 文件 540/540（+10）、build 成功；ego(lite) 实测旋转手柄 `top=63.2px` 完整处于 stage 内、拖拽写回 `rotate=117.6°`，缩小并左移后 vertical/horizontal 参考线均出现在 0% 且 `positionX=-79.86/scaleX=0.50` 写回，`oc-rotate-handle.png` / `oc-snap-guides.png`。§4 选框行 🟡→✅，统计 45/2/5/15。
- **2026-11-25 UI 长尾 U-05：跨轨拖拽与撤销**：探查发现 `CoreElement` 无轨道字段、`elements` 扁平且只覆盖 main 轨，落轨/拖动回调均无轨道维度（比排期预估更深）。实现：`CoreElement` 加可选 `trackId?`（缺省 main，additive-only），新增 `moveElementToTrack` 纯函数（7 项单测）；`timeline.tsx` 移除 `readOnly` 对移动/裁剪的阻断、按指针 Y 判定目标轨，`onDropAsset`/`onMoveClip` 增加目标轨参数；`editor-page.tsx` 按 trackId 分轨渲染、落轨写标记、跨轨走统一 `applyClipEdit` 并记入 U-02 快照，跨轨后保持选中。验收：tsc 0、vitest 43 文件 547/547（+7）、build 成功；ego(lite) 实测 clip-intro 从 main（轨 1）拖到 audio（轨 2）后 Ctrl+Z 回原轨且其余片段不变，`oc-cross-track.png`。§6 拖拽排序行 🟡→✅，统计 46/1/5/15。**边界**：仅会话内跨轨；写回 JSON 搬轨仍触 additive-only 边界，留 U-06/U-07 决策。

## 附录 A：经典版「新增文字」实证（为什么不是 core 的事）

基于 `<CLASSIC_ROOT>` 源码实证（隐私保护：路径用占位符，实际值由 `UI_REPLICA_PLAN.md` §1 给出）：

- 卡片：`text/components/assets-view.tsx` 的 `TextView` → `buildTextElement()` + `editor.timeline.insertElement({placement:{mode:'auto'}})`
- 插入核心：`commands/timeline/element/insert-element.ts` 的 `InsertElementCommand.execute()`：`crypto.randomUUID()` 生成 id → `resolveTrackPlacement` 找/建 text 轨 → 写回内存 tracks → 压入 undo 历史 → `useSyncExternalStore` 触发 React 重渲染
- 拖拽落地：`timeline/controllers/drag-drop-controller.ts` 的 `executeTextDrop` → 同一个 `InsertElementCommand`（placement 改 explicit）
- 无后端调用；`@/wasm` 只提供时间刻度/帧对齐数值工具（`TICKS_PER_SECOND` / `roundToFrame`），不参与插入决策
- 持久化：800ms debounce 存 IndexedDB/OPFS（`core/managers/save-manager.ts`），与插入本身解耦

结论：该能力是前端编辑器应用层逻辑。本版本缺口在应用层，不在 Rust core。

## 附录 B：证据来源

- 经典版功能全景：本轮 code-explorer 逐文件探查（75 tool uses），原始报告见会话工具结果。
- 本版本状态：`UI_REPLICA_PLAN.md` §3/§7/§8/§9 + `editor.tsx` / `audio.ts` / `project-write.ts` / `editor-shortcuts.ts` 源码核对 + 浏览器验收截图。
- 经典版本身 coming soon / disabled / 无证据项已在探查中单列，本清单按「双方均无闭环」记 ⚪。
