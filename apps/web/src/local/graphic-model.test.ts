import { describe, expect, it } from 'vitest';

import type { CoreElement } from './editor-ui';
import { normalizeElementParams } from './element-model';
import {
  DEFAULT_GRAPHIC_FILL,
  DEFAULT_GRAPHIC_SHAPE,
  alphaBlendInto,
  isInsideShape,
  parseGraphicColor,
  rasterizeGraphic,
  readGraphicParams,
} from './graphic-model';

/** 造图形元素。 */
function graphicElement(params?: Record<string, unknown>): CoreElement {
  return {
    id: 'g1', startTime: 0, duration: 1000, trimStart: 0,
    elementType: 'graphic', params: normalizeElementParams(params),
  };
}

/** 第二档项 2：graphic 元素模型与栅格化回归。 */
describe('graphic-model', () => {
  it('parseGraphicColor：#rgb/#rrggbb/#rrggbbaa/transparent/非法值', () => {
    expect(parseGraphicColor('#fff')).toEqual([255, 255, 255, 255]);
    expect(parseGraphicColor('#ff0000')).toEqual([255, 0, 0, 255]);
    expect(parseGraphicColor('#ff000080')).toEqual([255, 0, 0, 128]);
    expect(parseGraphicColor('transparent')).toBeNull();
    expect(parseGraphicColor('none')).toBeNull();
    expect(parseGraphicColor('not-a-color')).toBeNull();
    expect(parseGraphicColor('#12')).toBeNull();
  });

  it('readGraphicParams：缺失参数回落默认', () => {
    expect(readGraphicParams(graphicElement())).toEqual({
      shape: DEFAULT_GRAPHIC_SHAPE,
      fill: DEFAULT_GRAPHIC_FILL,
      stroke: 'transparent',
      strokeWidth: 0,
      cornerRadius: 0,
    });
  });

  it('readGraphicParams：合法参数读取，非法形状/颜色回落，尺寸夹逼', () => {
    const params = readGraphicParams(graphicElement({
      'graphic.shape': 'ellipse',
      'graphic.fill': '#00ff00',
      'graphic.stroke': '#000000',
      'graphic.strokeWidth': 999,
      'graphic.cornerRadius': -5,
    }));
    expect(params.shape).toBe('ellipse');
    expect(params.fill).toBe('#00ff00');
    expect(params.strokeWidth).toBe(64);
    expect(params.cornerRadius).toBe(0);
    expect(readGraphicParams(graphicElement({ 'graphic.shape': 'star', 'graphic.fill': 'bad' })).shape).toBe(DEFAULT_GRAPHIC_SHAPE);
  });

  it('isInsideShape：矩形全覆盖', () => {
    expect(isInsideShape('rectangle', 0, 0)).toBe(true);
    expect(isInsideShape('rectangle', 0.5, 0.5)).toBe(true);
    expect(isInsideShape('rectangle', -0.1, 0.5)).toBe(false);
    expect(isInsideShape('rectangle', 0.5, 1.1)).toBe(false);
  });

  it('isInsideShape：椭圆内外', () => {
    expect(isInsideShape('ellipse', 0.5, 0.5)).toBe(true);
    expect(isInsideShape('ellipse', 0, 0)).toBe(false);
    expect(isInsideShape('ellipse', 0.75, 0.5)).toBe(true);
  });

  it('isInsideShape：三角形与线', () => {
    expect(isInsideShape('triangle', 0.5, 0.1)).toBe(true);
    expect(isInsideShape('triangle', 0.1, 0.9)).toBe(false);
    expect(isInsideShape('line', 0.5, 0.5)).toBe(true);
    expect(isInsideShape('line', 0.2, 0.8)).toBe(false);
  });

  it('isInsideShape：圆角矩形命中角区', () => {
    expect(isInsideShape('rectangle', 0.02, 0.02, 0.1)).toBe(false);
    expect(isInsideShape('rectangle', 0.1, 0.1, 0.1)).toBe(true);
  });

  it('alphaBlendInto：透明跳过、半透混合、长度不一致安全', () => {
    const target = new Uint8Array([0, 0, 0, 255, 10, 20, 30, 255]);
    const layer = new Uint8Array([255, 0, 0, 0, 255, 0, 0, 128, 1, 2]);
    alphaBlendInto(target, layer);
    expect(Array.from(target.slice(0, 4))).toEqual([0, 0, 0, 255]);
    expect(Array.from(target.slice(4, 8))).toEqual([133, 10, 15, 255]);
  });

  it('栅格化在无 DOM 环境返回 null（vitest node 环境）', () => {
    const params = readGraphicParams(graphicElement());
    expect(rasterizeGraphic(params, 10, 10, 1)).toBeNull();
  });
})
