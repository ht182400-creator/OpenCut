/**
 * 经典版 UI 1:1 改造 · 批 8 移动端门禁（本地重写，不拷贝经典版 React 源码）。
 *
 * 对照经典版 `components/editor/mobile-gate.tsx`：视口 < 1024px 时显示「Desktop only」提示，
 * 用户可选择继续（localStorage 记住）或返回。文案/阈值/布局按经典版 1:1 对齐。
 * 本实现用原生 button 与本地样式 token，不引入经典版组件库。
 */

import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

/** 移动端门禁阈值（px）：低于该宽度视为移动端/平板。 */
export const MOBILE_GATE_BREAKPOINT_PX = 1024;

/** localStorage key：用户选择「继续查看」后记住决定。 */
export const MOBILE_ACKNOWLEDGED_KEY = 'mobile-acknowledged';

/** 门禁文案（对齐经典版原文）。 */
export const MOBILE_GATE_COPY = {
  back: 'Go back',
  title: 'Desktop only (for now)',
  body: "OpenCut isn't optimized for mobile or iPad yet. Things will break and the layout will be a mess. Come back on a desktop for the real experience.",
  continue: 'Take a look anyway',
  roadmap: 'Roadmap',
} as const;

/** 门禁布局 token（对照经典版 Tailwind 类：top-6/left-6=1.5rem、px-7=1.75rem 等）。 */
const GATE_STYLE: Record<string, CSSProperties> = {
  root: { background: 'var(--background)', position: 'relative', display: 'flex', flexDirection: 'column', height: '100vh', width: '100vw', overflow: 'hidden' },
  back: { position: 'absolute' as const, top: 24, left: 24, display: 'flex', alignItems: 'center', gap: 4, color: 'var(--muted-foreground)', fontSize: 14, background: 'none', border: 'none', cursor: 'pointer' as const },
  content: { flex: 1, display: 'flex', flexDirection: 'column' as const, justifyContent: 'center' as const, gap: 20, paddingLeft: 28, paddingRight: 28 },
  title: { color: 'var(--foreground)', fontSize: '1.875rem', fontWeight: 700, letterSpacing: '-0.025em', margin: 0 },
  body: { color: 'var(--muted-foreground)', fontSize: 14, lineHeight: 1.6, margin: 0 },
  actions: { display: 'flex', alignItems: 'center', gap: 12 },
  button: { borderRadius: 'var(--radius-md)', padding: '8px 14px', fontSize: 14, cursor: 'pointer' as const, border: '1px solid var(--border)' },
  primary: { background: 'var(--primary)', color: 'var(--primary-foreground)', borderColor: 'var(--primary)' },
  ghost: { background: 'transparent', color: 'var(--foreground)', borderColor: 'transparent' },
};

/**
 * 视口 < 1024px 且用户未确认过时，显示桌面-only 门禁；否则透传 children。
 * @param props.children 被门禁包裹的编辑器内容
 */
export function MobileGate(props: { children: ReactNode }) {
  const [show, setShow] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const isMobile = window.innerWidth < MOBILE_GATE_BREAKPOINT_PX;
      const acknowledged = localStorage.getItem(MOBILE_ACKNOWLEDGED_KEY) === 'true';
      setShow(isMobile && !acknowledged);
    } catch {
      // localStorage 不可用时按桌面处理，避免门禁误挡编辑器。
      setShow(false);
    }
  }, []);

  if (show === null) return null;
  if (!show) return <>{props.children}</>;

  /** 用户选择继续：记住决定并放行。 */
  const handleContinue = () => {
    try { localStorage.setItem(MOBILE_ACKNOWLEDGED_KEY, 'true'); } catch { /* 存储不可用时仅本次放行 */ }
    setShow(false);
  };

  /** 用户选择返回：回退浏览器历史。 */
  const handleGoBack = () => {
    window.history.back();
  };

  return (
    <div style={GATE_STYLE.root}>
      <button type="button" style={GATE_STYLE.back} onClick={handleGoBack}>
        <span aria-hidden="true">←</span>
        <span>{MOBILE_GATE_COPY.back}</span>
      </button>
      <div style={GATE_STYLE.content}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <h1 style={GATE_STYLE.title}>{MOBILE_GATE_COPY.title}</h1>
          <p style={GATE_STYLE.body}>{MOBILE_GATE_COPY.body}</p>
        </div>
        <div style={GATE_STYLE.actions}>
          <button type="button" style={{ ...GATE_STYLE.button, ...GATE_STYLE.primary }} onClick={handleContinue}>
            {MOBILE_GATE_COPY.continue}
          </button>
          {/* 经典版此处为 Roadmap 外链；本工程无对应 web 路由（/roadmap 返回 404），
              为避免死链不再渲染该链接。文案常量保留以维持经典版原文锁定。 */}
        </div>
      </div>
    </div>
  );
}
