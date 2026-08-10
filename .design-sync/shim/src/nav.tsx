import * as React from 'react';
import { cx } from './tokens';
import { NAV_ICONS } from './icons';

// ── Sub-tabs: the indicator primitive ──────────────────────────────────────

export interface SubTabsProps {
  /** `SubTab` elements. The app ships 2–3 per surface. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The largest text on a Mindkraft page — the surface's own section switcher,
 * with a hairline divider down the middle and the glowing-underline indicator
 * under the active label.
 *
 * Never replace this with a segmented control or pill row; the design brief
 * rejects those explicitly. Compose it with `SubTab` children.
 *
 * ```tsx
 * <SubTabs>
 *   <SubTab active>My Activities</SubTab>
 *   <SubTab>Categories</SubTab>
 * </SubTabs>
 * ```
 *
 * @category Navigation
 */
export function SubTabs({ children, className }: SubTabsProps): React.ReactElement {
  return <div className={cx('sub-tabs', className)}>{children}</div>;
}

export interface SubTabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lights the glowing underline and promotes the label to 700 weight. */
  active?: boolean;
  children?: React.ReactNode;
}

/**
 * One label inside `SubTabs`. `active` lights the indicator primitive.
 *
 * @category Navigation
 */
export function SubTab({ active, className, children, ...rest }: SubTabProps): React.ReactElement {
  return (
    <button type="button" className={cx('sub-tab', active && 'active', className)} {...rest}>
      {children}
    </button>
  );
}

export interface SubTabContentProps {
  /** Panes are shown by default; the app hides inactive ones inline. */
  active?: boolean;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The pane a `SubTab` reveals (`.sub-tab-content`).
 *
 * @category Navigation
 */
export function SubTabContent({ active = true, className, children }: SubTabContentProps): React.ReactElement {
  return (
    <div className={cx('sub-tab-content', className)} style={active ? undefined : { display: 'none' }}>
      {children}
    </div>
  );
}

// ── Primary navigation ─────────────────────────────────────────────────────

/** The six destinations Mindkraft ships. */
export type NavTabId = 'friends' | 'challenges' | 'projects' | 'activities' | 'analytics' | 'settings';

export interface NavTabsProps {
  /** `NavTab` elements — the app renders all six, in this file's icon order. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The app's primary navigation row.
 *
 * It has two treatments and the breakpoint is 768px. On mobile — which is how
 * Mindkraft is actually used — it becomes a floating island in the card
 * material and the active tab is just its icon glowing in the accent, no
 * container. Above 768px the active tab takes a solid blue fill instead.
 *
 * @category Navigation
 */
export function NavTabs({ children, className }: NavTabsProps): React.ReactElement {
  return <div className={cx('nav-tabs', className)}>{children}</div>;
}

export interface NavTabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Which of the app's six icons to draw. */
  icon: NavTabId;
  /** Visible label under the icon. */
  label: string;
  /**
   * Marks this destination as current. Below 768px that means the icon glows
   * in the accent colour — the icon form of the indicator primitive; above it,
   * a solid blue fill.
   */
  active?: boolean;
}

/**
 * One destination in `NavTabs`: icon above, label below.
 *
 * @category Navigation
 */
export function NavTab({ icon, label, active, className, ...rest }: NavTabProps): React.ReactElement {
  return (
    <button type="button" className={cx('nav-tab', active && 'active', className)} {...rest}>
      {NAV_ICONS[icon]}
      <span>{label}</span>
    </button>
  );
}

// ── Empty state ────────────────────────────────────────────────────────────

export interface EmptyPlaceholderProps {
  className?: string;
  children?: React.ReactNode;
}

/**
 * The dashed-outline empty slot (`.empty-placeholder`). The design brief asks
 * you to pick copy by *which kind* of empty this is: onboarding (CTA + why),
 * all-done (celebratory), or eligibility (quiet, no CTA).
 *
 * @category Feedback
 */
export function EmptyPlaceholder({ className, children }: EmptyPlaceholderProps): React.ReactElement {
  return <div className={cx('empty-placeholder', className)}>{children}</div>;
}
