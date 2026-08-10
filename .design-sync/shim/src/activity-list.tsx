import * as React from 'react';
import { cx, dimensionStyle, DimensionColor } from './tokens';
import { ChevronRightIcon, UndoIcon } from './icons';
import { ActivityRing } from './ring';
import { XPChip, StreakChip, AtRiskChip, MultiCountChip } from './chips';

/** The completion states an activity row can be in. */
export type ActivityState = 'default' | 'completed' | 'completed-multi' | 'disabled' | 'skip-mode-pending';

export interface ActivityListItemProps {
  /** The activity's name — the row's hero. */
  name: string;
  /** XP for one completion. Negative values render in red. */
  xp: number;
  /** Consecutive days. Drives the ring arc and shows the coral streak chip. */
  streak?: number;
  /** Completions logged today, for multi-complete activities. */
  multiCount?: number;
  /** Shows the amber risk chip and the alert dot on the chevron. */
  atRisk?: boolean;
  /**
   * Completion state. `completed` greys the row and fills the ring green;
   * `disabled` is "not scheduled today".
   * @default "default"
   */
  state?: ActivityState;
  /** The activity's dimension colour — tints the left edge and the ring arc. */
  dimension?: DimensionColor;
  /** Expands the detail-badge body under the row. @default false */
  expanded?: boolean;
  /** Shows the Undo pill left of the ring. The app shows it after any completion today. */
  showUndo?: boolean;
  /** Plays the confirm pulse the app runs right after a tap. @default false */
  justToggled?: boolean;
  /** `ActivityBadge` pills for the expanded body — breadcrumb, XP maths, warnings. */
  badges?: React.ReactNode;
  className?: string;
}

/**
 * The default activity row in My Activities — the densest, most-used component
 * in Mindkraft. Tap completes; the chevron expands the detail badges; the ring
 * on the right shows the streak and turns green on completion.
 *
 * ```tsx
 * <ActivityListItem
 *   name="Morning Walk" xp={15} streak={4} dimension="green"
 *   badges={<ActivityBadge variant="frequency">Health › Movement</ActivityBadge>}
 * />
 * ```
 *
 * @category Activities
 */
export function ActivityListItem({
  name,
  xp,
  streak = 0,
  multiCount = 0,
  atRisk = false,
  state = 'default',
  dimension,
  expanded = false,
  showUndo = false,
  justToggled = false,
  badges,
  className,
}: ActivityListItemProps): React.ReactElement {
  const completed = state === 'completed' || state === 'completed-multi';
  return (
    <div
      className={cx('activity-item', state !== 'default' && state, justToggled && 'just-toggled', className)}
      style={dimensionStyle(dimension)}
    >
      <div className="activity-info-container">
        <div className="activity-row-main">
          <button type="button" className="act-expand-btn" title="Show details" aria-label="Expand">
            <ChevronRightIcon className={cx('act-expand-chevron', expanded && 'expanded')} />
            {atRisk ? <span className="chevron-alert-dot" /> : null}
          </button>
          <div className="card-content-col">
            <div className="activity-name">{name}</div>
            <div className="card-meta">
              <XPChip xp={xp} />
              {streak > 0 ? <StreakChip days={streak} /> : null}
              {multiCount > 0 ? <MultiCountChip count={multiCount} /> : null}
              {atRisk ? <AtRiskChip /> : null}
            </div>
          </div>
          <div className="activity-row-right">
            {showUndo ? (
              <button type="button" className="btn-undo-activity" title="Undo last completion" aria-label="Undo completion">
                <UndoIcon />
                Undo
              </button>
            ) : null}
            <ActivityRing streak={streak} completed={completed} size="list" />
          </div>
        </div>
        <div className={cx('activity-expand-body', expanded && 'expanded')}>
          <div className="activity-details">{badges}</div>
        </div>
      </div>
    </div>
  );
}
