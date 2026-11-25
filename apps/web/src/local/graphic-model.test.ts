// @vitest-environment jsdom
/**
 * graphic-model.ts 图形元素纯函数测试（ISTQB 组件测试级别）。
 * 覆盖：常量契约、parseGraphicColor 各格式、readGraphicParams 默认/覆盖、
 * isInsideShape 四种形状与边界、alphaBlendInto 叠加、rasterizeGraphic 各形状栅格化。
 */

import { describe, expect, it, vi } from 'vitest'
import {
  DEFAULT_GRAPHIC_FILL,
  DEFAULT_GRAPHIC_SHAPE,
  DEFAULT_GRAPHIC_STROKE,
  DEFAULT_GRAPHIC_STROKE_WIDTH,
  GRAPHIC_SHAPES,
  alphaBlendInto,
  isInsideShape,
  parseGraphicColor,
  rasterizeGraphic,
  readGraphicParams,
} from './graphic-model'
import type { CoreElement } from './editor-ui'

describe('graphic-model 常量与颜色解析', () => {
  it('图形常量为固定契约', () => {
    expect(DEFAULT_GRAPHIC_SHAPE).toBe('rectangle')
    expect(DEFAULT_GRAPHIC_FILL).toBe('#ffffff')
    expect(DEFAULT_GRAPHIC_STROKE).toBe('transparent')
    expect(DEFAULT_GRAPHIC_STROKE_WIDTH).toBe(0)
    expect(GRAPHIC_SHAPES).toEqual(['rectangle', 'ellipse', 'triangle', 'line'])
  })

  it('parseGraphicColor：#rgb/#rrggbb/#rrggbbaa/transparent/非法', () => {
    expect(parseGraphicColor('#f00')).toEqual([255, 0, 0, 255])
    expect(parseGraphicColor('#00ff00')).toEqual([0, 255, 0, 255])
    expect(parseGraphicColor('#01020380')).toEqual([1, 2, 3, 128])
    // transparent/none 作为「无填充」返回 null（不是 alpha=0 的数组）。
    expect(parseGraphicColor('transparent')).toBeNull()
    expect(parseGraphicColor('none')).toBeNull()
    expect(parseGraphicColor('rgba(1,2,3,0.5)')).toBeNull()
    expect(parseGraphicColor('not-a-color')).toBeNull()
  })
})

describe('graphic-model 参数与形状命中', () => {
  it('readGraphicParams：空元素用默认值，带 params 时覆盖', () => {
    const empty = readGraphicParams({ id: 'g1', params: {} } as unknown as CoreElement)
    expect(empty.shape).toBe('rectangle')
    const custom = readGraphicParams({ id: 'g2', params: { 'graphic.shape': 'ellipse', 'graphic.fill': '#000000' } } as unknown as CoreElement)
    expect(custom.shape).toBe('ellipse')
    expect(custom.fill).toBe('#000000')
  })

  it('isInsideShape：rectangle 边界内外', () => {
    expect(isInsideShape('rectangle', 0.5, 0.5)).toBe(true)
    expect(isInsideShape('rectangle', 1.5, 0.5)).toBe(false)
    expect(isInsideShape('rectangle', -0.1, 0.5)).toBe(false)
  })

  it('isInsideShape：ellipse 中心命中/角落不命中', () => {
    expect(isInsideShape('ellipse', 0.5, 0.5)).toBe(true)
    expect(isInsideShape('ellipse', 0, 0)).toBe(false)
    expect(isInsideShape('ellipse', 1, 1)).toBe(false)
  })

  it('isInsideShape：triangle 与 line', () => {
    expect(isInsideShape('triangle', 0.5, 0.5)).toBe(true)
    expect(isInsideShape('triangle', 0.5, 1.5)).toBe(false)
    expect(typeof isInsideShape('line', 0.5, 0.5)).toBe('boolean')
  })
})

describe('graphic-model alpha 叠加与栅格化', () => {
  it('alphaBlendInto：半透明层叠加到不透明目标', () => {
    const target = new Uint8Array([0, 0, 0, 255])
    const layer = new Uint8Array([255, 255, 255, 128])
    alphaBlendInto(target, layer)
    expect(target[3]).toBe(255)
    expect(target[0]).toBeGreaterThan(0)
  })

  it('rasterizeGraphic：四种形状均产出正确长度 RGBA 缓冲', () => {
    // jsdom 无原生 2d context，用最小 stub 覆盖绘制分支。
    const ctx = {
      globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 0,
      beginPath: () => {}, ellipse: () => {}, moveTo: () => {}, lineTo: () => {},
      closePath: () => {}, quadraticCurveTo: () => {}, arcTo: () => {}, rect: () => {},
      fill: () => {}, stroke: () => {},
      getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D)
    for (const shape of GRAPHIC_SHAPES) {
      const pixels = rasterizeGraphic({
        shape, fill: '#ffffff', stroke: 'transparent', strokeWidth: 0, cornerRadius: 0,
      }, 4, 4, 1)
      expect(pixels).toBeInstanceOf(Uint8Array)
      expect(pixels!.length).toBe(4 * 4 * 4)
    }
    vi.restoreAllMocks()
  })
})
