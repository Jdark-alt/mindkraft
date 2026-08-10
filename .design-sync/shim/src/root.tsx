import * as React from 'react';
import { cx } from './tokens';

export interface MindkraftRootProps {
  /**
   * Which theme the surface renders in. Written to `data-theme-mode` on the
   * document element, exactly as the app's `applyThemeMode` does — the light
   * overrides in style.css are all keyed off `[data-theme-mode="light"]`.
   * @default "dark"
   */
  theme?: 'dark' | 'light';
  /**
   * Render the inner `.main-content` wrapper that holds every tab's content
   * (adds the app's page padding and the bottom-nav safe area).
   * @default true
   */
  mainContent?: boolean;
  /** Extra classes on the `.app-container` element. */
  className?: string;
  children?: React.ReactNode;
}

/**
 * The Mindkraft app shell — **wrap every Mindkraft screen in this**.
 *
 * It does two things nothing else does: it renders the `.app-container.active`
 * root (the container is `display: none` until it carries `active`, so content
 * outside it is invisible), and it sets `data-theme-mode` on the document
 * element, which is the only switch between the dark and light palettes.
 *
 * ```tsx
 * <MindkraftRoot>
 *   <SubTabs tabs={['My Activities', 'Categories', 'Map']} active={0} />
 *   <ActivityGrid>…</ActivityGrid>
 * </MindkraftRoot>
 * ```
 *
 * @category Foundations
 */
export function MindkraftRoot({
  theme = 'dark',
  mainContent = true,
  className,
  children,
}: MindkraftRootProps): React.ReactElement {
  React.useLayoutEffect(() => {
    const el = typeof document !== 'undefined' ? document.documentElement : null;
    if (!el) return;
    const prev = el.getAttribute('data-theme-mode');
    el.setAttribute('data-theme-mode', theme);
    return () => {
      if (prev === null) el.removeAttribute('data-theme-mode');
      else el.setAttribute('data-theme-mode', prev);
    };
  }, [theme]);

  return (
    <div className={cx('app-container', 'active', className)}>
      {mainContent ? <div className="main-content">{children}</div> : children}
    </div>
  );
}

export interface TabContentProps {
  /** A tab pane is hidden until it carries `active`. @default true */
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * One tab pane (`.tab-content`). Hidden unless `active` — that class is the
 * app's only tab-switching mechanism.
 *
 * @category Foundations
 */
export function TabContent({ active = true, className, children }: TabContentProps): React.ReactElement {
  return <div className={cx('tab-content', active && 'active', className)}>{children}</div>;
}
