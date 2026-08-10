import * as React from 'react';
import { cx } from './tokens';

/**
 * The four stat accents. Each maps to a colour job: green rewards, blue
 * interaction//neutral figures, amber urgency, coral streaks.
 */
export type StatAccent = 'green' | 'blue' | 'amber' | 'coral';

export interface StatCardProps {
  /** The figure. Tabular by design — format it before passing it in. */
  value: React.ReactNode;
  /** What the figure counts, e.g. "XP / Hour". */
  label: string;
  /** Accent for the glowing left edge bar. @default "blue" */
  accent?: StatAccent;
  /** Small icon above the value, tinted to the accent. */
  icon?: React.ReactNode;
  className?: string;
}

/**
 * One figure on the Analytics summary. The card carries a glowing 3px edge in
 * its accent colour — a dimension-style tint, never a filled background.
 *
 * @category Analytics
 */
export function StatCard({ value, label, accent = 'blue', icon, className }: StatCardProps): React.ReactElement {
  return (
    <div className={cx('an-stat-card', `an-stat-${accent}`, className)}>
      {icon ? <div className="an-stat-icon">{icon}</div> : null}
      <div className="an-stat-value">{value}</div>
      <div className="an-stat-label">{label}</div>
    </div>
  );
}

export interface StatRowProps {
  /** Two `StatCard`s — the app pairs them per row. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * One row of the analytics summary; the app puts two `StatCard`s in each.
 *
 * @category Analytics
 */
export function StatRow({ children, className }: StatRowProps): React.ReactElement {
  return <div className={cx('an-stat-row', className)}>{children}</div>;
}

export interface StatGridProps {
  /** `StatRow` elements. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The analytics summary block that stacks `StatRow`s.
 *
 * @category Analytics
 */
export function StatGrid({ children, className }: StatGridProps): React.ReactElement {
  return <div className={cx('an-stat-grid', className)}>{children}</div>;
}

export interface AnalyticsCardProps {
  /** Optional heading rendered in the card's title style. */
  title?: React.ReactNode;
  /** All-caps kicker above the title. */
  kicker?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}

/**
 * The panel every chart and breakdown sits in — the same card material as an
 * activity card, at the block radius.
 *
 * @category Analytics
 */
export function AnalyticsCard({ title, kicker, children, className }: AnalyticsCardProps): React.ReactElement {
  return (
    <div className={cx('analytics-card', className)}>
      {kicker ? <div className="an-section-kicker">{kicker}</div> : null}
      {title ? <div className="analytics-card-title">{title}</div> : null}
      {children}
    </div>
  );
}

export interface FilterPillsProps {
  children?: React.ReactNode;
  className?: string;
}

/**
 * The row that holds `FilterPill`s.
 *
 * @category Analytics
 */
export function FilterPills({ children, className }: FilterPillsProps): React.ReactElement {
  return <div className={cx('filter-pills', className)}>{children}</div>;
}

export interface FilterPillProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The selected pill. Exactly one per row. */
  active?: boolean;
}

/**
 * One choice in a filter row (`.filter-pill`).
 *
 * @category Analytics
 */
export function FilterPill({ active, className, children, ...rest }: FilterPillProps): React.ReactElement {
  return (
    <button type="button" className={cx('filter-pill', active && 'active', className)} {...rest}>
      {children}
    </button>
  );
}

export interface RangeSelectorProps {
  children?: React.ReactNode;
  className?: string;
}

/**
 * The 1M / 3M / 6M / 1Y / All strip above a chart.
 *
 * @category Analytics
 */
export function RangeSelector({ children, className }: RangeSelectorProps): React.ReactElement {
  return <div className={cx('an-range-selector', className)}>{children}</div>;
}

export interface RangeButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** The selected range. */
  active?: boolean;
}

/**
 * One range in `RangeSelector`.
 *
 * @category Analytics
 */
export function RangeButton({ active, className, children, ...rest }: RangeButtonProps): React.ReactElement {
  return (
    <button type="button" className={cx('an-range-btn', active && 'active', className)} {...rest}>
      {children}
    </button>
  );
}

export interface ModeTabsProps {
  children?: React.ReactNode;
  className?: string;
}

/**
 * The Cumulative / Daily switch above the XP chart — the same underline
 * indicator primitive as `SubTabs`, one size down.
 *
 * @category Analytics
 */
export function ModeTabs({ children, className }: ModeTabsProps): React.ReactElement {
  return <div className={cx('an-mode-tabs', className)}>{children}</div>;
}

export interface ModeTabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Lights the underline. */
  active?: boolean;
}

/**
 * One label in `ModeTabs`.
 *
 * @category Analytics
 */
export function ModeTab({ active, className, children, ...rest }: ModeTabProps): React.ReactElement {
  return (
    <button type="button" className={cx('an-mode-tab', active && 'active', className)} {...rest}>
      {children}
    </button>
  );
}
