/**
 * element-composite.ts 单元测试（P0）。
 * 覆盖：identity 直通、位移/缩放/透明度/旋转的真实像素变化、越界采样、
 * 文字布局纯计算（默认值/参数覆盖/背景依赖）、非法宽高与短缓冲兜底。
 */

import { describe, expect, it } from 'vitest'
import {
  composeTransform,
  isIdentityTransform,
  resolveTextLayout,
  transformFromElement,
  type ElementTransform,
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
