/**
 * element-composite.ts 单元测试（P0）。
 * 覆盖：identity 直通、位移/缩放/透明度/旋转的真实像素变化、越界采样、
 * 文字布局纯计算（默认值/参数覆盖/背景依赖）、非法宽高与短缓冲兜底。
 */

import { describe, expect, it } from 'vitest'
import {
  applyVisualEffects,
  composeTransform,
  hasVisualEffects,
  isIdentityTransform,
  readColorAdjust,
  readRectMask,
  resizeMask,
  resolveTextLayout,
  transformFromElement,
  type ColorAdjust,
  type ElementTransform,
  type RectMask,
} from './element-composite'
import { DEFAULT_TEXT_COLOR, DEFAULT_TEXT_FONT_SIZE_PX, buildTextElement, normalizeElementParams } from './element-model'

const identity: ElementTransform = {
  opacity: 1, positionX: 0, positionY: 0, scaleX: 1, scaleY: 1, rotate: 0,
}

/** 构造纯色帧（宽×高，全部 alpha=255）。 */
function solidFrame(width: number, height: number, r: number, g: number, b: number): Uint8Array {
  const pixels = new Uint8Array(width * height * 4)
  for (let index = 0; index < pixels.length; index += 4) {
    pixels[index] = r; pixels[index + 1] = g; pixels[index + 2] = b; pixels[index + 3] = 255
  }
  return pixels
}

describe('isIdentityTransform / transformFromElement', () => {
  it('identity 判定', () => {
    expect(isIdentityTransform(identity)).toBe(true)
    expect(isIdentityTransform({ ...identity, opacity: 0.5 })).toBe(false)
  })

  it('从元素读取变换，缺省 identity', () => {
    expect(transformFromElement(null)).toEqual(identity)
    const element = buildTextElement({ id: 't', content: 'x', startTime: 0 })
    expect(transformFromElement(element)).toEqual(identity)
  })

  it('从元素读取显式变换', () => {
    const element = buildTextElement({ id: 't', content: 'x', startTime: 0 })
    element.params = normalizeElementParams({ ...element.params, opacity: 0.25, scaleX: 2 })
    const transform = transformFromElement(element)
    expect(transform.opacity).toBe(0.25)
    expect(transform.scaleX).toBe(2)
  })
})

describe('composeTransform（真实像素变换）', () => {
  const source = solidFrame(4, 4, 200, 100, 50)

  it('identity 原样返回同一引用', () => {
    expect(composeTransform(source, identity, 4, 4)).toBe(source)
  })

  it('opacity 乘到 alpha 通道', () => {
    const result = composeTransform(source, { ...identity, opacity: 0.5 }, 4, 4)
    expect(result[3]).toBe(128)
    expect(result[0]).toBe(200)
  })

  it('位移改变像素位置（右移 1px 后左侧列变透明）', () => {
    const result = composeTransform(source, { ...identity, positionX: 1 }, 4, 4)
    // 右移后最左列在源中对应 x=-1，采样越界保持透明（alpha=0）。
    expect(result[3]).toBe(0)
    // 中间列仍有不透明像素。
    expect(result[(2 * 4 + 2) * 4 + 3]).toBe(255)
  })

  it('缩放 2 倍后像素仍落在帧内且 alpha 保持', () => {
    const result = composeTransform(source, { ...identity, scaleX: 2, scaleY: 2 }, 4, 4)
    const centerAlpha = result[(2 * 4 + 2) * 4 + 3]
    expect(centerAlpha).toBe(255)
  })

  it('旋转 90 度后帧内仍有像素', () => {
    const result = composeTransform(source, { ...identity, rotate: 90 }, 4, 4)
    expect(Array.from(result).some((value, index) => index % 4 === 3 && value > 0)).toBe(true)
  })

  it('短缓冲原样返回（防御性）', () => {
    const short = new Uint8Array(4)
    expect(composeTransform(short, { ...identity, opacity: 0.5 }, 4, 4)).toBe(short)
  })

  it('非法宽高不产生 NaN 像素', () => {
    const result = composeTransform(source, { ...identity, scaleX: 0.01 }, 0, 0)
    expect(result).toBe(source)
  })
})

describe('resolveTextLayout（文字布局纯计算）', () => {
  it('默认居中布局', () => {
    const element = buildTextElement({ id: 't', content: 'Hello', startTime: 0 })
    const layout = resolveTextLayout(element, 320, 180)
    expect(layout.text).toBe('Hello')
    expect(layout.x).toBe(160)
    expect(layout.y).toBe(90)
    expect(layout.fontSizePx).toBe(DEFAULT_TEXT_FONT_SIZE_PX)
    expect(layout.color).toBe(DEFAULT_TEXT_COLOR)
    expect(layout.align).toBe('center')
    expect(layout.baseline).toBe('middle')
    expect(layout.backgroundEnabled).toBe(false)
  })

  it('参数覆盖生效', () => {
    const element = buildTextElement({ id: 't', content: 'Hi', startTime: 0 })
    element.params = normalizeElementParams({
      ...element.params,
      positionX: 10, positionY: -20, fontSize: 48, color: '#ff0000',
      textAlign: 'left', 'background.enabled': true, 'background.color': '#123456',
    } as never)
    const layout = resolveTextLayout(element, 320, 180)
    expect(layout.x).toBe(170)
    expect(layout.y).toBe(70)
    expect(layout.fontSizePx).toBe(48)
    expect(layout.color).toBe('#ff0000')
    expect(layout.align).toBe('left')
    expect(layout.backgroundEnabled).toBe(true)
    expect(layout.backgroundColor).toBe('#123456')
  })

  it('空内容回落 params.content', () => {
    const element = buildTextElement({ id: 't', content: '', startTime: 0 })
    element.params = normalizeElementParams({ ...element.params, content: 'fallback' })
    expect(resolveTextLayout(element, 320, 180).text).toBe('fallback')
  })
})

/* ==================== P2 遮罩/效果测试 ==================== */

const noMask: RectMask = { enabled: false, left: 0, top: 0, right: 1, bottom: 1 }
const noAdjust: ColorAdjust = { brightness: 1, contrast: 1, saturate: 1 }

describe('readRectMask / readColorAdjust（参数读取与边界）', () => {
  it('无元素返回默认', () => {
    expect(readRectMask(null)).toEqual(noMask)
    expect(readColorAdjust(null)).toEqual(noAdjust)
  })

  it('从元素参数读取并夹逼越界', () => {
    const element = buildTextElement({ id: 't', content: 'x', startTime: 0 })
    element.params = normalizeElementParams({
      ...element.params,
      'mask.enabled': true, 'mask.left': -1, 'mask.right': 5,
      'effects.brightness': 10, 'effects.contrast': -3, 'effects.saturate': 0.5,
    } as never)
    const mask = readRectMask(element)
    expect(mask.enabled).toBe(true)
    expect(mask.left).toBe(0)
    expect(mask.right).toBe(1)
    const adjust = readColorAdjust(element)
    expect(adjust.brightness).toBe(4)
    expect(adjust.contrast).toBe(0)
    expect(adjust.saturate).toBe(0.5)
  })

  it('非法值回落默认', () => {
    const element = buildTextElement({ id: 't', content: 'x', startTime: 0 })
    element.params = normalizeElementParams({ ...element.params, 'effects.brightness': Number.NaN } as never)
    expect(readColorAdjust(element).brightness).toBe(1)
  })
})

describe('resizeMask（遮罩手柄拖拽）', () => {
  const base: RectMask = { enabled: true, left: 0.2, top: 0.2, right: 0.8, bottom: 0.8 }

  it('拖动左边改变 left，其它边不变', () => {
    const next = resizeMask(base, 'left', 0.1, 0)
    expect(next.left).toBeCloseTo(0.3, 5)
    expect(next.right).toBe(0.8)
    expect(next.top).toBe(0.2)
    expect(base.left).toBe(0.2) // 不改入参
  })

  it('四边均可拖动', () => {
    expect(resizeMask(base, 'right', -0.1, 0).right).toBeCloseTo(0.7, 5)
    expect(resizeMask(base, 'top', 0, 0.1).top).toBeCloseTo(0.3, 5)
    expect(resizeMask(base, 'bottom', 0, -0.1).bottom).toBeCloseTo(0.7, 5)
  })

  it('夹逼到 0..1 且保持最小间距', () => {
    expect(resizeMask(base, 'left', -10, 0).left).toBe(0)
    expect(resizeMask(base, 'right', 10, 0).right).toBe(1)
    const flipped = resizeMask(base, 'left', 10, 0) // 企图拖过 right
    expect(flipped.left).toBeLessThan(flipped.right)
    expect(flipped.right - flipped.left).toBeGreaterThanOrEqual(0.01)
  })

  it('非法位移回落为 0', () => {
    expect(resizeMask(base, 'left', Number.NaN, 0)).toEqual(base)
    expect(resizeMask(base, 'right', Number.POSITIVE_INFINITY, 0)).toEqual(base)
  })
})

describe('hasVisualEffects', () => {
  it('identity 返回 false', () => {
    expect(hasVisualEffects(noMask, noAdjust)).toBe(false)
  })
  it('任一非默认返回 true', () => {
    expect(hasVisualEffects({ ...noMask, enabled: true }, noAdjust)).toBe(true)
    expect(hasVisualEffects(noMask, { ...noAdjust, brightness: 2 })).toBe(true)
  })
})

describe('applyVisualEffects（真实像素运算）', () => {
  it('identity 原样返回同一引用', () => {
    const pixels = solidFrame(4, 4, 100, 100, 100)
    expect(applyVisualEffects(pixels, noMask, noAdjust, 4, 4)).toBe(pixels)
  })

  it('brightness=2 提亮像素', () => {
    const pixels = solidFrame(2, 2, 50, 60, 70)
    applyVisualEffects(pixels, noMask, { brightness: 2, contrast: 1, saturate: 1 }, 2, 2)
    expect(pixels[0]).toBe(100)
    expect(pixels[1]).toBe(120)
    expect(pixels[2]).toBe(140)
  })

  it('saturate=0 变灰度', () => {
    const pixels = solidFrame(2, 2, 200, 100, 50)
    applyVisualEffects(pixels, noMask, { brightness: 1, contrast: 1, saturate: 0 }, 2, 2)
    expect(pixels[0]).toBe(pixels[1])
    expect(pixels[1]).toBe(pixels[2])
  })

  it('矩形遮罩把区域外 alpha 置 0', () => {
    const pixels = solidFrame(4, 4, 255, 255, 255)
    const mask: RectMask = { enabled: true, left: 0.5, top: 0.5, right: 1, bottom: 1 }
    applyVisualEffects(pixels, mask, noAdjust, 4, 4)
    // 左上角 (0,0) 在遮罩外 → alpha=0；右下角 (3,3) 在遮罩内 → alpha=255。
    expect(pixels[3]).toBe(0)
    expect(pixels[(3 * 4 + 3) * 4 + 3]).toBe(255)
  })

  it('非法宽高/短缓冲不抛异常', () => {
    const short = new Uint8Array(4)
    expect(applyVisualEffects(short, noMask, { brightness: 2, contrast: 1, saturate: 1 }, 4, 4)).toBe(short)
    expect(applyVisualEffects(short, { ...noMask, enabled: true }, noAdjust, 0, 0)).toBe(short)
  })
})
