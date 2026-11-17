import { describe, expect, it } from 'vitest';

import {
  MOBILE_ACKNOWLEDGED_KEY,
  MOBILE_GATE_BREAKPOINT_PX,
  MOBILE_GATE_COPY,
} from './mobile-gate';

/** 批 8 移动端门禁：阈值与文案常量锁定（对齐经典版 1024px 与原文）。 */
describe('MobileGate 门禁常量', () => {
  it('断点为 1024px', () => {
    expect(MOBILE_GATE_BREAKPOINT_PX).toBe(1024);
  });

  it('localStorage key 与经典版一致', () => {
    expect(MOBILE_ACKNOWLEDGED_KEY).toBe('mobile-acknowledged');
  });

  it('文案对齐经典版原文', () => {
    expect(MOBILE_GATE_COPY.title).toBe('Desktop only (for now)');
    expect(MOBILE_GATE_COPY.back).toBe('Go back');
    expect(MOBILE_GATE_COPY.continue).toBe('Take a look anyway');
    expect(MOBILE_GATE_COPY.roadmap).toBe('Roadmap');
    expect(MOBILE_GATE_COPY.body).toContain("isn't optimized for mobile or iPad yet");
  });
});
