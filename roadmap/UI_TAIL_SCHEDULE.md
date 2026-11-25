# UI 长尾正式排期（2026-11-24）

> 背景：用户要求把 `FEATURE_PARITY.md` 剩余的 🟡6 / 🔴5 / ⚪15 正式排期。
> 本文给出**批次顺序 + 前置依赖 + 工作量口径**，不承诺绝对日期。沿用两条既有口径：
> ① `PRIORITY.md` 的 T+ 为「1 人全职累计周数、估算非承诺」；② P0~P4 批次「每批 tsc 0 + vitest 全绿 + build + 浏览器截图验收」。

## 0. 排期前的事实核对（决定哪些能排）

| 原判断 | 实际核对结果 | 排期影响 |
| --- | --- | --- |
| 「三轨结构固定」需扩 core | **错**：`SceneView.tracks: Vec<TrackView>` 已是动态数组，`project-write.ts` 遍历全部轨道写回；UI `trackTypes` 由 `props.tracks` 派生（`timeline.tsx:346`），非硬编码。当前三轨是 fixture 数据本身 | 从「需扩 core」降为「需 UI 新增轨道入口 + core 写回允许新增实体」 |
| overlay/audio 轨编辑需扩 core | **部分对**：`readOnly = track.id !== props.mainTrackId`（`timeline.tsx:815`）是 UI 编辑模型限制，core 已支持多轨数据 | 主要是 UI 放开只读 + 落轨逻辑，core 写回无需扩（已有全部字段） |
| 撤销重做「仅 clip 历史」 | `clip-history.ts` 的 `TimelineSnapshot` 只存 clips，不含书签/轨道标志/属性/导出设置 | 纯前端状态模型扩展，不需扩 core |
| 自动保存介质升级（localStorage→IndexedDB/OPFS） | `project-autosave.ts` 800ms 防抖写 localStorage，可注入 storage（已有接口） | 纯前端换存储后端 + 迁移逻辑，不需扩 core |
| 🔴 数据源 4 项 + ⚪ AI 字幕/项目列表 | 本仓库无后端服务/转写模型/多项目持久化 | **阻塞，不排期**（按「不伪造数据」原则挂账） |

## 1. A 档：可立即排（纯前端，不扩 core、不依赖外部）

| 批次 | 项 | 前置 | 主要工作 | 验收口径 |
| --- | --- | --- | --- | --- |
| **U-01** | Media 网格卡片排序（🟡） | 无 | 素材列表排序键（名称/时长）+ 本地 state，写入 `assets-panel.tsx`；不涉及 core | 排序后列表顺序变化 + 拖入时间轴仍闭环；vitest + 浏览器截图 |
| **U-02** | 撤销/重做全覆盖（🟡） | 无（可复用 `clip-history.ts` 纯函数层） | `TimelineSnapshot` 扩为「编辑器快照」（clips + 书签 + 轨道标志 + 选中态），各动作统一 pushSnapshot；保留 redo 分支裁剪/50 条上限 | 删除→撤销→重做含书签/轨道标志恢复；既有 14 项 clip-history 用例扩展 |
| **U-03** | 自动保存介质升级（🟡） | U-02（快照结构统一后迁移更稳） | `project-autosave.ts` 后端从 localStorage 换 IndexedDB（已有可注入 storage 接口），加 localStorage→IndexedDB 一次性迁移；配额失败降级 | 刷新恢复 + 迁移后旧 autosave 不丢；纯函数单测 + 浏览器验收 |
| **U-04** | 选框/手柄/对齐参考线（🟡） | 无 | 预览旋转手柄被顶栏遮挡的布局修正 + 对齐参考线交互（`preview-transform-model.ts` 扩展）；参考线从纯视觉升级为可吸附 | 浏览器拖动改 transform 并写回；截图验收 |
| **U-05** | 拖拽排序跨轨（🟡） | U-02（撤销纳入跨轨移动） | 放开 `readOnly` 限制，允许 main→overlay/audio 落轨；落轨走既有 `placement` 纯函数 | 跨轨拖动后片段换轨 + 撤销回原位；浏览器验收 |
| **U-08** | 双击文字就地编辑（⚪） | 无（属性面板已有 `TEXT_ELEMENT_PARAMS` textarea 写回入口，`properties-panel.tsx:503`） | 预览层双击进入 contentEditable，blur/Enter 把文本写回元素 `text` 参数（复用既有 `onParamChange` 链路），Esc 取消 | 双击预览文字→改字→属性面板 text 同步→刷新恢复；浏览器截图验收 |

## 2. B 档：需 core 写回小扩展（前置是确认 additive-only 边界）

| 批次 | 项 | 前置 | 主要工作 | 验收口径 |
| --- | --- | --- | --- | --- |
| **U-06** | 动态新增轨道（✅ 2026-11-25 完成） | ~~需确认~~ **已决策：允许**（用户选「功能齐全，不能只有 3 条轨道」） | core 写回加 `allowNewTracks` 显式开关（默认 false 保持 additive-only）；UI 加「新增轨道」按钮 + 轨道类型选择 | 新增轨→编辑→写回 JSON→再打开轨道仍在；`project_write.rs` 往返用例扩展。**已验收**：写回 JSON overlay 含新轨、刷新恢复、4 项 Rust + 5 项 Web 用例全绿 |
| **U-07** | overlay/audio 轨编辑（🔴） | U-05 + U-06 | 放开非 main 轨的编辑（当前只读），元素增删/裁剪走统一命令层 | overlay/audio 轨可插入/删除片段并写回；浏览器验收 |

## 3. C 档：阻塞，不排期（需用户决策或外部依赖）

| 项 | 类别 | 阻塞原因 | 解除条件 |
| --- | --- | --- | --- |
| Sounds 音效库 / Stickers / Effects / Settings 数据源（4 项 🔴） | 🔴 | 本仓库无服务端素材库；按「不伪造数据」挂账 | 提供素材数据源（API 或本地资源包） |
| AI 字幕生成（⚪） | ⚪ | 无转写服务/模型 | 提供 STT 服务或本地模型 |
| 项目列表/重命名/多项目持久化、反馈/Onboarding、视频卡预览、剪贴板贴媒体、素材右键 Export clips、Ripple、场景、GPU 降级横幅、显式保存、Transitions/Adjustment、SRT/ASS 导入（其余 ⚪） | ⚪ | 经典版本身 coming soon（Transitions/Adjustment），或需后端/系统能力，或双方均无闭环 | 逐项评估，非本仓库可单方闭环 |

## 4. 执行顺序与依赖图

```
A 档（纯前端，可并行评估，按序交付）
  U-01 排序 ─┐
  U-02 撤销全覆盖 ─┬→ U-03 自动保存介质
  U-04 手柄/参考线 ─┤
  U-05 跨轨拖拽 ←───┘（依赖 U-02 的快照）
  U-08 就地编辑文字（独立，无前置）
        │
B 档（需确认 core 写回边界）
  U-06 新增轨道 ← 确认 allowNewTracks
       │
  U-07 overlay/audio 编辑 ← U-05 + U-06
```

## 5. 批次交付约定（沿用既有规则）

- 每批：JSDoc + 中文注释、try-catch 不吞异常、常量提取、函数 ≤1000 行、改签名查调用方。
- 每批验收：`tsc --noEmit` 0 + `vitest` 全绿（预期用例随批增长）+ `vite build` + **ego(lite) 浏览器截图验收**（本轮已验证工具链可用）。
- 每批同步：`FEATURE_PARITY.md` 状态与统计、`UI_REPLICA_PLAN.md` §8 变更记录、`.codebuddy/memory/YYYY-MM-DD.md`。
- 完成后更新统计数字须按表格符号逐行核算（2026-11-24 曾因手工误差修正过一次）。

## 6. 边界声明

- U-01~U-05 不需改 core、不需外部服务，可立即启动。
- U-06/U-07 唯一决策点是「写回是否允许新增轨道实体」——2026-11-25 用户已确认选 B（允许），U-06 已按显式开关实现；U-07 可直接依赖 U-06 推进。
- C 档全部不排期；如用户指定某项，可从 C 档提级并重排，但需先核对其真实依赖（本轮即因此把「双击文字就地编辑」从 C 提级到 A：属性面板已有 text 参数写回链路，不需后端）。
