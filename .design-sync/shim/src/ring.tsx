import * as React from 'react';
import { cx } from './tokens';
import { CheckIcon } from './icons';

/** 2π×20 — the list ring's circumference, verbatim from app.js `RING_CIRC`. */
const LIST_CIRC = 125.66;
/** 2π×11 — the grid ring's circumference. */
const GRID_CIRC = +(2 * Math.PI * 11).toFixed(2);

export interface ActivityRingProps {
  /**
   * Current streak. The arc fills over five days — `min(streak, 5) / 5` — so a
   * five-day streak is a full ring.
   */
  streak?: number;
  /** Draws the check glyph in the middle. */
  completed?: boolean;
  /**
   * `list` is the 48px ring on `ActivityListItem`; `grid` is the 27px ring on
   * `ActivityGridCard`.
   * @default "list"
   */
  size?: 'list' | 'grid';
  className?: string;
}

/**
 * The streak ring that sits at the right edge of an activity row and the
 * bottom-right of a grid card. The arc is tinted by the activity's dimension
 * colour (`--dim-color`), falling back to the interactive blue.
 *
 * The completed *fill* (the solid green disc) is painted by the parent card's
 * `completed` state, not by the ring itself — render this inside
 * `ActivityListItem` or `ActivityGridCard` to see that state. The `grid` size
 * additionally needs a card around it at all: `.gc-ring-fill` strokes with a
 * bare `var(--dim-color)`, which only `.grid-card` defines, so a bare grid ring
 * draws its track and no arc.
 *
 * @category Activities
 */
export function ActivityRing({
  streak = 0,
  completed = false,
  size = 'list',
  className,
}: ActivityRingProps): React.ReactElement {
  const grid = size === 'grid';
  const circ = grid ? GRID_CIRC : LIST_CIRC;
  const progress = Math.min(Math.max(streak, 0), 5) / 5;
  const offset = (circ * (1 - progress)).toFixed(2);
  const prefix = grid ? 'gc' : 'act';
  const box = grid ? 27 : 48;
  const c = box / 2;
  const r = grid ? 11 : 20;
  const strokeWidth = grid ? 2.2 : 3;

  return (
    <div className={cx(`${prefix}-ring-wrap`, className)}>
      <svg
        className={`${prefix}-ring-svg`}
        viewBox={`0 0 ${box} ${box}`}
        {...(grid ? { width: box, height: box } : {})}
        xmlns="http://www.w3.org/2000/svg"
      >
        <circle className={`${prefix}-ring-bg`} cx={c} cy={c} r={r} fill="none" strokeWidth={strokeWidth} />
        <circle className={`${prefix}-ring-done-fill`} cx={c} cy={c} r={r} stroke="none" />
        <circle
          className={`${prefix}-ring-fill`}
          cx={c}
          cy={c}
          r={r}
          fill="none"
          strokeWidth={strokeWidth}
          strokeDasharray={circ}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      <div className={`${prefix}-ring-label`}>
        {completed ? <CheckIcon size={grid ? 10 : 16} strokeWidth={3} /> : null}
      </div>
    </div>
  );
}
