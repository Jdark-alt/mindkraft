import * as React from 'react';
import { cx } from './tokens';
import { FlameIcon, WarnTriangleIcon } from './icons';

/**
 * Mindkraft's chip system is one shape (a 999px pill) and four semantic
 * colours, one job each — green rewards, coral streaks, amber urgency, blue
 * interaction. The components below are those jobs. Never invent a fifth
 * chip shape or a decorative colour; map any new state onto an existing job.
 */

export interface XPChipProps {
  /** XP for one completion. Sign is derived: negatives render in red. */
  xp: number;
  /**
   * Force the sign shown. `auto` prints `+` for positive and `−` for negative,
   * which is what activity cards do.
   * @default "auto"
   */
  sign?: 'auto' | 'plus' | 'minus';
  className?: string;
}

/**
 * The XP readout on an activity — text only, no pill. Green for earned XP,
 * red for negative activities. Digits are tabular so a changing value doesn't
 * shift the row.
 *
 * @category Chips
 */
export function XPChip({ xp, sign = 'auto', className }: XPChipProps): React.ReactElement {
  const negative = sign === 'minus' || (sign === 'auto' && xp < 0);
  const magnitude = Math.abs(xp);
  return (
    <span className={cx(negative ? 'card-xp-negative' : 'card-xp', className)}>
      {negative ? '−' : '+'}
      {magnitude} XP
    </span>
  );
}

export interface StreakChipProps {
  /** Consecutive days. The chip is not rendered by the app at 0. */
  days: number;
  className?: string;
}

/**
 * The coral streak pill with the flame glyph — celebration, never urgency.
 *
 * @category Chips
 */
export function StreakChip({ days, className }: StreakChipProps): React.ReactElement {
  return (
    <span className={cx('card-streak', className)} aria-label={`${days}-day streak`}>
      <FlameIcon />
      {days}
    </span>
  );
}

export interface AtRiskChipProps {
  /** Chip copy. @default "Risk" */
  label?: string;
  className?: string;
}

/**
 * The amber at-risk pill — time pressure only. It pulses, which is the one
 * ambient animation permitted outside the golden trace, because it carries
 * information: this streak breaks tonight.
 *
 * @category Chips
 */
export function AtRiskChip({ label = 'Risk', className }: AtRiskChipProps): React.ReactElement {
  return (
    <span className={cx('card-atrisk', className)} aria-label="Streak at risk">
      <WarnTriangleIcon />
      {label}
    </span>
  );
}

export interface MultiCountChipProps {
  /** How many times the activity was completed today. */
  count: number;
  className?: string;
}

/**
 * The `×N` counter shown on multi-complete activities.
 *
 * @category Chips
 */
export function MultiCountChip({ count, className }: MultiCountChipProps): React.ReactElement {
  return <span className={cx('card-multi-count', className)}>×{count}</span>;
}

/** The pill variants an expanded activity row can show. */
export type ActivityBadgeVariant =
  | 'frequency'
  | 'xp'
  | 'negative'
  | 'shield'
  | 'shield-warn'
  | 'counter'
  | 'at-risk'
  | 'penalty'
  | 'streak';

export interface ActivityBadgeProps {
  /** Which semantic job this badge does — picks the colour. */
  variant: ActivityBadgeVariant;
  className?: string;
  children?: React.ReactNode;
  title?: string;
}

/**
 * A detail pill from the expanded body of an activity row (`.activity-badge`).
 * `frequency` carries the Dimension › Path breadcrumb, `xp` the XP maths,
 * `at-risk` and `penalty` the warnings.
 *
 * @category Chips
 */
export function ActivityBadge({ variant, className, children, title }: ActivityBadgeProps): React.ReactElement {
  return (
    <span className={cx('activity-badge', `badge-${variant}`, className)} title={title}>
      {children}
    </span>
  );
}

/** The badge colours a grid card can show. */
export type GridBadgeVariant = 'shield' | 'counter' | 'challenge' | 'alert' | 'skip' | 'multi';

export interface GridBadgeProps {
  /** Which semantic job this badge does — picks the colour. */
  variant: GridBadgeVariant;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The tiny 9px badge used inside grid cards (`.gc-badge`) — a denser sibling
 * of `ActivityBadge` for the space a card actually has.
 *
 * @category Chips
 */
export function GridBadge({ variant, className, children }: GridBadgeProps): React.ReactElement {
  return <span className={cx('gc-badge', `gc-badge-${variant}`, className)}>{children}</span>;
}
