# 4 项数据源差异与解除条件清单（历史规格）

> [!NOTE]
> **本文是 2026-11-25 的「需求规格」历史文档**：下文各节「现在缺什么 / 需要提供的数据源 / 解除条件（DoD）」均是**当初的需求描述**，四项已于当日全部实现并升 ✅（见下方更新）。
> 阅读时请勿把正文的将来时（「缺什么」「需要提供」）当作当前状态；实际落地方案与素材见下方 2026-11-25 更新及 `FEATURE_PARITY.md` §2。
>
> 状态截至 2026-11-25（U-08 收尾后）。对应 `FEATURE_PARITY.md` 中剩余 4 项 🔴（§2 的 Sounds / Stickers / Effects / Settings 数据源）。
>
> **2026-11-25 更新：四项已全部接入并升 ✅**（统计 49/0/4/14 → 53/0/0/14）。实际采用：Kenney CC0 音效 12 个 + Twemoji CC BY 4.0 贴纸 12 个（落 `text` 元素 content=emoji，比清单里 `shape.imageSrc` 方案更简）+ 8 个颜色参数效果预设 + FPS/宽高比/背景设置面板。素材与许可见 `apps/web/public/assets/ATTRIBUTION.md`。原下载的大包已按约定删除，工作区只保留精选文件（音效 83KB + 贴纸 18KB）。**未做**：复杂滤镜（模糊/锐化/暗角）需扩 core；音效写回端到端未单独验下载（复用 U-06/U-07 同一链路）。
>
> **先回答核心疑问**：这 4 项需要的不是「远程后端服务」，而是**本地素材数据文件 + 前端接入**。仓库里 UI 骨架、拖放协议、插入时间轴链路、core 参数通道都已就绪；缺的只是「一份可枚举、可搜索、可点击/拖入的资产清单」以及对应的预览渲染。你提供的数据可以是**静态 JSON + 本地文件**，不需要账号、不需要 API 服务器。若你已有现成资产库，按本清单给格式即可直接接入；若没有，我可以用本地生成的示例资产（无版权风险）填充，同样能解除 🔴。

## 0. 现状共性（已就绪的部分）

| 能力 | 位置 | 状态 |
| --- | --- | --- |
| 九个素材 Tab 骨架（含 sounds/stickers/effects/settings） | `apps/web/src/local/classic-ui/assets-panel.tsx:487-515` | ✅ 已有 tab 切换与空态 |
| 拖入时间轴协议（`application/x-timeline-drag`） | `apps/web/src/local/classic-ui/assets-tokens.ts:50-56`、`timeline.tsx` | ✅ 已就绪 |
| `AssetDragPayload` 插入链路（`handleAddAsset`） | `apps/web/src/local/editor-page.tsx:905` | ✅ 已就绪（现支持 text/media） |
| 效果参数通道 `effects.brightness/contrast/saturate` | `apps/web/src/local/classic-ui/properties-tokens.ts:78-95`、`element-composite.ts:348` | ✅ 已就绪（可调值） |
| 元素类型枚举 | `apps/web/src/local/editor-ui.tsx:5`（`TEXT_ELEMENT_TYPES`） | ✅ 现含 text/media/shape |
| 设置项（分辨率 3 档） | `editor-page.tsx:865` `handleResolutionChange` | ✅ 已有帧率/分辨率设置骨架 |
| 素材视图尺寸 token（与经典版 1:1） | `apps/web/src/local/classic-ui/assets-tokens.ts:53-56`、`assets-panel-tokens` 测试 | ✅ 已就绪 |

结论：**接入点都在，缺的是数据与「把它画出来/插进去」的薄薄一层。**

---

## 1. Sounds（音效库 / 搜索 / 试听 / 收藏）

### 现在缺什么
`assets-panel.tsx` 的 sounds 视图是空态文案；没有音效资产列表，没有试听/收藏状态。

### 需要提供的数据源（最小可行）
一个本地 JSON 清单 + 对应音频文件（放 `apps/web/public/assets/sounds/`）：

```json
{
  "version": 1,
  "sounds": [
    {
      "id": "whoosh-01",
      "name": "Whoosh",
      "src": "/assets/sounds/whoosh-01.wav",
      "durationMs": 820,
      "tags": ["transition", "swoosh"],
      "category": "transition"
    }
  ]
}
```

### 字段说明
- `id` 稳定唯一（收藏状态与拖入元素都引用它）
- `src` 同站静态路径（避免跨域；音频走浏览器 `<audio>` 即可）
- `durationMs` 卡片时长徽标（经典版有显示）
- `category` / `tags` 用于分类筛选与搜索

### 解除条件（DoD）
1. sounds tab 显示卡片网格（复用 `ASSETS_*` token），搜索框按 name/tags 过滤
2. 点击卡片试听（`<audio>`），再次点击停止；可收藏并持久化到 autosave
3. 拖入时间轴后生成 `elementType: 'audio'` 元素，写回经典版 JSON 的 audio 轨
4. 单测：搜索过滤（命中/空结果）、收藏切换、拖入后元素字段正确
5. 浏览器验收截图 + 台账 Sounds 行 🔴→✅

### 边界
若音频文件由你提供，需确认可再分发（仓库是公开的）；若不确定，我用本地合成的 WAV（正弦/噪声包络）填充。

---

## 2. Stickers（分类 / 搜索 / 添加）

### 现在缺什么
stickers 视图空态；无分类、无图片清单、无添加入口。

### 需要提供的数据源
本地 JSON + 图片文件（PNG/WebP/SVG，放 `apps/web/public/assets/stickers/`）：

```json
{
  "version": 1,
  "stickers": [
    {
      "id": "sticker-star",
      "name": "Star",
      "src": "/assets/stickers/star.webp",
      "width": 128,
      "height": 128,
      "category": "emoji",
      "tags": ["star", "gold"]
    }
  ]
}
```

### 字段说明
- `width`/`height` 用于卡片纵横比（经典版网格有不同尺寸贴纸）
- `category` 驱动分类 tab（如 emoji / shape / label）
- 图片建议透明背景 WebP，控制在单张 < 200 KB

### 解除条件（DoD）
1. stickers tab 分类切换 + 搜索（name/tags）过滤
2. 点击/拖入时间轴生成 `elementType: 'graphic'`（或 `sticker`，见下）元素，预览层能渲染该图片
3. 写回经典版 JSON 保真（图片来源用路径引用，不内嵌 base64）
4. 单测：分类过滤、搜索过滤、拖入元素渲染参数正确
5. 浏览器验收截图 + 台账 Stickers 行 🔴→✅

### 边界
`CoreElement` 目前 `TEXT_ELEMENT_TYPES` 含 text/media/shape，没有 sticker 类型。**两项待定**：
- 方案 A（小改动）：贴纸落为 `elementType: 'shape'` + `params['shape.imageSrc'] = src`，扩展 shape 渲染支持图片
- 方案 B（大改动）：core 加 sticker 元素类型，走完整合成/写回链路
推荐方案 A，除非你需要贴纸在经典版里也是独立类型。

---

## 3. Effects（效果网格 / 预览 / 添加）

### 现在缺什么
effects 视图空态；但**效果参数通道已经存在**（`effects.brightness/contrast/saturate` 可调），只缺预设清单与一键应用。

### 需要提供的数据源
一个本地 JSON 预设表即可（无需媒体文件）：

```json
{
  "version": 1,
  "effects": [
    {
      "id": "vivid",
      "name": "鲜明",
      "category": "color",
      "params": {
        "effects.brightness": 1.05,
        "effects.contrast": 1.25,
        "effects.saturate": 1.30
      },
      "preview": {
        "kind": "gradient",
        "colors": ["#ff7a18", "#af002d"]
      }
    }
  ]
}
```

### 字段说明
- `params` 的 key 必须与 `properties-tokens.ts` 现有 `EFFECT_ELEMENT_PARAMS` 完全一致（`effects.brightness` / `effects.contrast` / `effects.saturate`）
- `preview.kind: 'gradient'` 表示用 CSS 渐变生成预览缩略图，不需要单独图片（若你有真实缩略图，改成 `src` 指向本地文件）
- 参数范围由 `EFFECT_MIN/MAX` 约束，JSON 里的值我会按现有 clamp 逻辑校验

### 解除条件（DoD）
1. effects tab 显示预设网格（复用 `ASSETS_EFFECTS_GRID_MIN_PX`），分类筛选
2. 点击预设 → 经统一命令层 `applyPropertyPatch` 把 params 写到当前选中元素（记历史，可撤销）
3. 属性面板的 Brightness/Contrast/Saturate 实时同步
4. 单测：预设参数校验、应用后 elements 状态正确、撤销恢复
5. 浏览器验收截图 + 台账 Effects 行 🔴→✅

### 边界
当前通道只支持**颜色三参数**。若你要的是经典版那种「模糊/锐化/暗角/颗粒」等复杂滤镜，那是另一条路线：需要 core 跨 WASM 扩展图像滤镜并真实参与 `renderFrameRgba`，工作量与 U-06/U-07 相当。**先确认你要的是哪一种**。

---

## 4. Settings（FPS / 宽高比 / 背景）

### 现在缺什么
仅分辨率 3 档可切（`handleResolutionChange`），无背景设置；FPS、宽高比虽在 profile 里但 UI 未暴露。

### 需要提供的数据源
**不需要外部数据文件**——这是纯 UI + core profile 接线：

```json
{
  "fpsOptions": [24, 25, 30, 60],
  "aspectRatios": ["16:9", "4:3", "1:1", "9:16"],
  "backgrounds": [
    { "id": "black", "label": "黑", "value": "#000000" },
    { "id": "white", "label": "白", "value": "#ffffff" },
    { "id": "transparent", "label": "透明", "value": "transparent" }
  ]
}
```

### 字段说明
- 这些枚举值可直接内置到前端常量（`settings-tokens.ts`），无需你提供
- 若你有特定业务值（如固定 25fps、特定品牌色背景），告诉我即可替换

### 解除条件（DoD）
1. Settings tab 暴露 FPS、宽高比、背景色选择器（复用现有 settings tab 骨架）
2. FPS 变更同步到 core profile、`frameCount` 与导出参数
3. 宽高比变更同步到 resolution/profile（`handleResolutionChange` 复用）
4. 背景色变更同步到合成器空帧与导出（core profile `background` 字段，若无则加 additive-only 字段）
5. 变更记入 autosave/项目写回，刷新恢复
6. 单测：枚举切换、帧数随 FPS 变化、背景色写回
7. 浏览器验收截图 + 台账 Settings 行 🔴→✅

### 边界
背景色若 core profile 不支持，需加一个可选字段（additive-only 兼容，不动现有结构）；若你要的是「上传自定义背景图」，那是新元素类型（走 sticker 同款方案 A）。

---

## 5. 总表：你需要提供什么

| 项 | 必须提供 | 可选提供 | 不提供时的兜底 |
| --- | --- | --- | --- |
| Sounds | 音频文件 + 清单 JSON（或授权我用合成音） | 分类/标签命名 | 我合成 WAV + 自填清单 |
| Stickers | 图片文件 + 清单 JSON（或授权我用自绘图形） | 分类体系 | 我用 SVG 星形/表情等自绘 |
| Effects | 只需确认「颜色三参数预设」还是「复杂滤镜」 | 预设命名/缩略图 | 颜色三参数预设 + CSS 渐变缩略图 |
| Settings | 只需确认业务枚举值或「用默认」 | 品牌背景色 | 内置 FPS 24/25/30/60 + 16:9 等 + 黑/白/透明 |

**最简单的推进方式**：你对每一项回复「用兜底」或给出具体值，我即可按 DoD 逐项实现并逐项消掉 🔴。若三项都回兜底，我下一批就能把 4 项全部合入并清零 🔴。
