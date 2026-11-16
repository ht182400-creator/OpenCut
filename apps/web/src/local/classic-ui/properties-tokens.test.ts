import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AUDIO_ELEMENT_PARAMS,
  AUDIO_PARAM_KEYS,
  BLENDING_PARAM_KEYS,
  CORNER_RADIUS_MAX,
  CORNER_RADIUS_MIN,
  MIN_TRANSFORM_SCALE,
  PROPERTIES_EMPTY_GAP_PX,
  PROPERTIES_EMPTY_PADDING_PX,
  PROPERTIES_EMPTY_PRIMARY,
  PROPERTIES_EMPTY_SECONDARY,
  PROPERTIES_EMPTY_TEXT_GAP_PX,
  PROPERTIES_FIELD_INNER_GAP_PX,
  PROPERTIES_KEYFRAME_ICON_SIZE_PX,
  PROPERTIES_KEYFRAME_TITLE_PREFIX,
  PROPERTIES_KEYFRAME_TITLE_SUFFIX,
  PROPERTIES_LABEL_GAP_PX,
  PROPERTIES_LABEL_ROW_HEIGHT_PX,
  PROPERTIES_MULTI_SELECT_SUFFIX,
  PROPERTIES_NUMBER_FIELD_HEIGHT_PX,
  PROPERTIES_NUMBER_ICON_SIZE_PX,
  PROPERTIES_PARAMS_BY_TYPE,
  PROPERTIES_SECTION_CONTENT_PADDING_PX,
  PROPERTIES_SECTION_FIELDS_GAP_PX,
  PROPERTIES_SUFFIX_GAP_PX,
  PROPERTIES_TABBAR_PADDING_PX,
  PROPERTIES_TAB_GAP_PX,
  PROPERTIES_TAB_LABELS,
  PROPERTIES_TAB_SIZE_PX,
  PROPERTIES_TABS_BY_TYPE,
  TEXT_ELEMENT_PARAMS,
  TEXT_PARAM_KEYS,
  TRANSFORM_PARAM_KEYS,
  VISUAL_ELEMENT_PARAMS,
  VOLUME_DB_MAX,
  VOLUME_DB_MIN,
} from './properties-tokens';

/** 参照物根目录由环境变量提供；未设置时不执行源码比对（CI / 非作者机器）。 */
const CLASSIC_ROOT = process.env.OPENCUT_CLASSIC_ROOT ?? '';

const PROPERTIES_SOURCES = {
  index: 'apps/web/src/components/editor/panels/properties/index.tsx',
  emptyView: 'apps/web/src/components/editor/panels/properties/empty-view.tsx',
  registry: 'apps/web/src/components/editor/panels/properties/registry.tsx',
  elementParamsTab: 'apps/web/src/components/editor/panels/properties/components/element-params-tab.tsx',
  keyframeToggle: 'apps/web/src/components/editor/panels/properties/components/keyframe-toggle.tsx',
  section: 'apps/web/src/components/editor/panels/properties/components/section.tsx',
  numberField: 'apps/web/src/components/ui/number-field.tsx',
  paramsRegistry: 'apps/web/src/params/registry.ts',
} as const;

type SourceKey = keyof typeof PROPERTIES_SOURCES;

/** 读取经典版源码；未配置参照根或文件不存在时返回 null。 */
function classicSource(key: SourceKey): string | null {
  if (!CLASSIC_ROOT) return null;
  const full = path.join(CLASSIC_ROOT, PROPERTIES_SOURCES[key]);
  return existsSync(full) ? readFileSync(full, 'utf8') : null;
}

describe('经典版属性面板 1:1 · 尺寸与结构 token（批 4）', () => {
  it('左侧 tab 栏尺寸与经典版一致', () => {
    expect(PROPERTIES_TAB_SIZE_PX).toBe(32);
    expect(PROPERTIES_TAB_GAP_PX).toBe(2);
    expect(PROPERTIES_TABBAR_PADDING_PX).toBe(4);
    const src = classicSource('index');
    if (src) {
      expect(src).toContain('h-8 w-8');
      expect(src).toContain('gap-0.5');
      expect(src).toContain('p-1');
    }
  });

  it('空状态文案与间距与经典版一致', () => {
    expect(PROPERTIES_EMPTY_PRIMARY).toBe("It's empty here");
    expect(PROPERTIES_EMPTY_SECONDARY).toBe('Click an element on the timeline to edit its properties');
    expect(PROPERTIES_MULTI_SELECT_SUFFIX).toBe(' elements selected.0');
    expect(PROPERTIES_EMPTY_GAP_PX).toBe(12);
    expect(PROPERTIES_EMPTY_TEXT_GAP_PX).toBe(8);
    expect(PROPERTIES_EMPTY_PADDING_PX).toBe(16);
    const src = classicSource('emptyView');
    if (src) {
      expect(src).toContain("It's empty here");
      expect(src).toContain('Click an element on the timeline to edit its properties');
      expect(src).toContain('gap-3');
    }
    const index = classicSource('index');
    if (index) expect(index).toContain('elements selected.0');
  });

  it('Section/字段间距与经典版一致', () => {
    expect(PROPERTIES_SECTION_CONTENT_PADDING_PX).toBe(16);
    expect(PROPERTIES_SECTION_FIELDS_GAP_PX).toBe(14);
    expect(PROPERTIES_FIELD_INNER_GAP_PX).toBe(8);
    expect(PROPERTIES_LABEL_ROW_HEIGHT_PX).toBe(16);
    expect(PROPERTIES_LABEL_GAP_PX).toBe(6);
    const src = classicSource('section');
    if (src) {
      expect(src).toContain('gap-3.5');
      expect(src).toContain('gap-2');
      expect(src).toContain('h-4');
    }
  });

  it('NumberField/关键帧尺寸与经典版一致', () => {
    expect(PROPERTIES_NUMBER_FIELD_HEIGHT_PX).toBe(28);
    expect(PROPERTIES_NUMBER_ICON_SIZE_PX).toBe(14);
    expect(PROPERTIES_SUFFIX_GAP_PX).toBe(6);
    expect(PROPERTIES_KEYFRAME_ICON_SIZE_PX).toBe(14);
    expect(PROPERTIES_KEYFRAME_TITLE_PREFIX).toBe('Toggle ');
    expect(PROPERTIES_KEYFRAME_TITLE_SUFFIX).toBe(' keyframe');
    const nf = classicSource('numberField');
    if (nf) {
      expect(nf).toContain('h-7');
      expect(nf).toContain('SUFFIX_GAP_PX = 6');
    }
    const kf = classicSource('keyframeToggle');
    if (kf) expect(kf).toContain('[&>svg]:size-3.5');
  });

  it('transform/blending/audio 参数键与经典版一致', () => {
    expect(TRANSFORM_PARAM_KEYS).toEqual([
      'transform.positionX', 'transform.positionY', 'transform.scaleX',
      'transform.scaleY', 'transform.rotate',
    ]);
    expect(BLENDING_PARAM_KEYS).toEqual(['opacity', 'blendMode']);
    expect(AUDIO_PARAM_KEYS).toEqual(['volume', 'muted']);
    const src = classicSource('registry');
    if (src) {
      expect(src).toContain('transform.positionX');
      expect(src).toContain('blendMode');
      expect(src).toContain('volume');
    }
  });

  it('text 17 项参数键与经典版一致', () => {
    expect(TEXT_PARAM_KEYS).toHaveLength(17);
    expect(TEXT_PARAM_KEYS[0]).toBe('content');
    expect(TEXT_PARAM_KEYS[16]).toBe('background.offsetY');
    expect(TEXT_ELEMENT_PARAMS.filter((p) => p.dependsOn === 'background.enabled')).toHaveLength(6);
    const src = classicSource('registry');
    if (src) {
      expect(src).toContain('background.enabled');
      expect(src).toContain('lineHeight');
    }
  });

  it('visual/audio 参数默认值与约束与经典版一致', () => {
    const visual = Object.fromEntries(VISUAL_ELEMENT_PARAMS.map((p) => [p.key, p]));
    expect(visual['transform.scaleX'].defaultValue).toBe(1);
    expect(visual['transform.scaleX'].min).toBe(MIN_TRANSFORM_SCALE);
    expect(visual['opacity'].defaultValue).toBe(1);
    expect(visual['blendMode'].keyframable).toBe(false);
    expect(visual['blendMode'].options).toHaveLength(17);
    const audio = Object.fromEntries(AUDIO_ELEMENT_PARAMS.map((p) => [p.key, p]));
    expect(audio.volume.min).toBe(VOLUME_DB_MIN);
    expect(audio.volume.max).toBe(VOLUME_DB_MAX);
    expect(audio.muted.keyframable).toBe(false);
    const bg = TEXT_ELEMENT_PARAMS.find((p) => p.key === 'background.cornerRadius');
    expect(bg?.min).toBe(CORNER_RADIUS_MIN);
    expect(bg?.max).toBe(CORNER_RADIUS_MAX);
  });

  it('按类型 tab 列表与默认 tab 与经典版一致', () => {
    expect(PROPERTIES_TABS_BY_TYPE.video).toEqual(['transform', 'audio', 'speed', 'blending', 'masks', 'effects']);
    expect(PROPERTIES_TABS_BY_TYPE.text).toEqual(['text', 'transform', 'blending']);
    expect(PROPERTIES_TABS_BY_TYPE.audio).toEqual(['audio', 'speed']);
    expect(PROPERTIES_TABS_BY_TYPE.effect).toEqual(['effects']);
    const src = classicSource('registry');
    if (src) {
      expect(src).toContain('speed');
      expect(src).toContain('masks');
      expect(src).toContain('graphic');
    }
  });

  it('参数集组合与 tab 英文文案与经典版一致', () => {
    expect(PROPERTIES_PARAMS_BY_TYPE.video).toEqual(['visual', 'audio']);
    expect(PROPERTIES_PARAMS_BY_TYPE.text).toEqual(['text', 'visual']);
    expect(PROPERTIES_PARAMS_BY_TYPE.effect).toEqual([]);
    expect(Object.values(PROPERTIES_TAB_LABELS)).toContain('Transform');
    expect(Object.values(PROPERTIES_TAB_LABELS)).toContain('Blending');
    expect(Object.values(PROPERTIES_TAB_LABELS)).toContain('Effects');
  });
});
