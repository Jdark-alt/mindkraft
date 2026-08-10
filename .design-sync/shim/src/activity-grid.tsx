import * as React from 'react';
import { cx, dimensionStyle, DimensionColor } from './tokens';
import { UndoIcon } from './icons';
import { ActivityRing } from './ring';

export interface ActivityGridProps {
  /** `ActivityGridCard` elements. The grid is dense auto-flow, so cards backfill gaps. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The three-column dense grid that holds `ActivityGridCard`s. **A card must be
 * inside this** — the card's size comes entirely from the grid's 80px row
 * rhythm and the per-type span rules, so a card rendered on its own collapses.
 *
 * @category Activities
 */
export function ActivityGrid({ children, className }: ActivityGridProps): React.ReactElement {
  return <div className={cx('activity-grid', className)}>{children}</div>;
}

/**
 * Card footprints, in grid cells:
 * 1 = 1×1, 2 = 3×2 (showcase), 3 = 2×1, 4 = 1×3, 5 = 1×2, 6 = 2×2, 7 = 3×1.
 *
 * Size is earned, not chosen: the app derives it from the activity's data.
 */
export type GridCardType = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Completion states a grid card can be in. */
export type GridCardState = 'default' | 'done' | 'done-multi' | 'disabled';

export interface ActivityGridCardProps {
  /** The activity's name. */
  name: string;
  /** XP for one completion. Negative values render red. */
  xp: number;
  /** Card footprint. Drives which information the card has room to show. */
  type?: GridCardType;
  /** Consecutive days — shows the streak text and fills the ring arc. */
  streak?: number;
  /** The activity's dimension colour. Tints the card's edge and ring, never its fill. */
  dimension?: DimensionColor;
  /** Completion state. @default "default" */
  state?: GridCardState;
  /** Dimension name for the breadcrumb — only types 4 and 6 have room for it. */
  dimensionName?: string;
  /** Path name for the breadcrumb. */
  pathName?: string;
  /** `GridBadge` pills. Rendered on types 2, 4 and 6; ignored on the compact types. */
  badges?: React.ReactNode;
  /** Shows the corner undo control (a pill on types 2, 4 and 6; icon-only elsewhere). */
  showUndo?: boolean;
  className?: string;
}

/**
 * One activity in the grid view. Seven footprints share one material and one
 * information ladder: name and XP always; streak once there's a second line;
 * the Dimension › Path breadcrumb only on the roomy types.
 *
 * ```tsx
 * <ActivityGrid>
 *   <ActivityGridCard name="Deep Work" xp={30} type={6} streak={5} dimension="indigo"
 *     dimensionName="Career" pathName="Focus" />
 * </ActivityGrid>
 * ```
 *
 * @category Activities
 */
export function ActivityGridCard({
  name,
  xp,
  type = 3,
  streak = 0,
  dimension,
  state = 'default',
  dimensionName,
  pathName,
  badges,
  showUndo = false,
  className,
}: ActivityGridCardProps): React.ReactElement {
  const negative = xp < 0;
  const xpText = `${negative ? '−' : '+'}${Math.abs(xp)}`;
  const completed = state === 'done' || state === 'done-multi';
  const rich = type === 4 || type === 6;
  const undoPill = type === 2 || type === 6 || type === 4;
  const hasBreadcrumb = rich && (dimensionName || pathName);

  const xpRow = (
    <div className="gc-xp-row">
      <span className={cx('gc-xp', negative && 'gc-xp-neg')}>{xpText} XP</span>
      {streak > 0 ? <span className="gc-streak">🔥 {streak}</span> : null}
    </div>
  );

  let body: React.ReactNode;
  if (type === 2) {
    body = (
      <>
        <div className="gc-name">{name}</div>
        <div className="gc-badges" style={{ marginTop: '5px' }}>
          {badges}
        </div>
      </>
    );
  } else if (rich) {
    body = (
      <>
        <div className="gc-name">{name}</div>
        {hasBreadcrumb ? (
          <div className="gc-path">
            {dimensionName} › {pathName}
          </div>
        ) : null}
        {xpRow}
        {badges ? <div className="gc-badges">{badges}</div> : null}
      </>
    );
  } else {
    body = (
      <>
        <div className="gc-name">{name}</div>
        {xpRow}
      </>
    );
  }

  return (
    <div
      className={cx('grid-card', state !== 'default' && `gc-${state}`, className)}
      data-type={type}
      data-can-complete={state === 'default' ? '1' : '0'}
      style={dimensionStyle(dimension)}
    >
      <div className="gc-gradient" />
      {showUndo ? (
        <button
          type="button"
          className={cx('gc-corner-undo', undoPill && 'gc-corner-undo-pill')}
          title="Undo last completion"
          aria-label="Undo"
        >
          <UndoIcon size={11} />
          {undoPill ? <span>Undo</span> : null}
        </button>
      ) : null}
      <div className="gc-body">{body}</div>
      {type === 1 ? null : <ActivityRing streak={streak} completed={completed} size="grid" />}
    </div>
  );
}
