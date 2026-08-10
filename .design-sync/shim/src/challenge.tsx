import * as React from 'react';
import { cx } from './tokens';
import { CheckIcon, EditIcon, TrashIcon, RefreshIcon } from './icons';

/** Where a challenge sits in its lifecycle — drives the card's accent. */
export type ChallengeState = 'active' | 'targets' | 'completed' | 'failed';

export interface ChallengeProgressProps {
  /** Progress so far, in whatever unit the challenge counts. */
  current: number;
  /** The target. Omit for the legacy any-activity mode, which just counts up. */
  target?: number;
  /** Unit label after the count, e.g. "DAYS" or "completions". */
  unit?: string;
  /** Percent complete, 0–100. Drives the bar and the right-hand figure. */
  percent: number;
  className?: string;
}

/**
 * A challenge's progress band: the big tabular count on the left, the percent
 * on the right, and the bar underneath.
 *
 * @category Challenges
 */
export function ChallengeProgress({
  current,
  target,
  unit,
  percent,
  className,
}: ChallengeProgressProps): React.ReactElement {
  const pct = Math.max(0, Math.min(100, percent));
  return (
    <div className={cx('ch-progress', className)}>
      <div className="ch-progress-top">
        <div style={{ display: 'inline-flex', alignItems: 'baseline', gap: '4px', minWidth: 0 }}>
          <span className="ch-count">
            <span className="ch-count-current">{current}</span>
            {target !== undefined ? (
              <>
                <span className="ch-count-sep">/</span>
                <span className="ch-count-target">{target}</span>
              </>
            ) : null}
          </span>
          {unit ? <span className="ch-count-unit">{unit}</span> : null}
        </div>
        <span className="ch-pct">{Math.floor(pct)}%</span>
      </div>
      <div className="ch-bar">
        <div className="ch-bar-inner" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export interface ChallengeCardProps {
  /** The challenge's name. */
  name: string;
  /** Optional one-line description. Shown above a hairline divider. */
  description?: string;
  /** Meta line under the title — dates, activity counts. Use `ChallengeMeta` parts. */
  meta?: React.ReactNode;
  /** Progress so far. */
  current: number;
  /** Target count. Omit for the count-up mode. */
  target?: number;
  /** Unit label after the count. */
  unit?: string;
  /** Percent complete, 0–100. */
  percent: number;
  /** Lifecycle state. @default "active" */
  state?: ChallengeState;
  /** Shows the "all targets must be met" chip next to the description. */
  enforced?: boolean;
  className?: string;
}

/**
 * A challenge in My Challenges: title and meta up top, edit/delete icon
 * buttons on the right, the progress band in the middle, and the primary
 * action at the bottom. The button reads "Claim bonus" once every target is
 * met — that ready state is the card's only celebratory treatment.
 *
 * @category Challenges
 */
export function ChallengeCard({
  name,
  description,
  meta,
  current,
  target,
  unit,
  percent,
  state = 'active',
  enforced = false,
  className,
}: ChallengeCardProps): React.ReactElement {
  const isActive = state === 'active' || state === 'targets';
  const ready = state === 'targets';
  const enforcedChip = enforced ? (
    <span className="ch-enforced-chip" title="All targets must be met to claim the bonus">
      Enforced
    </span>
  ) : null;

  return (
    <div className={cx('ch-card', className)} data-state={state}>
      <div className="ch-card-head">
        <div className="ch-card-titlecol">
          <h3 className="ch-card-title">{name}</h3>
          {description ? (
            <>
              <div className="ch-subtitle-row">
                <p className="ch-card-desc">{description}</p>
                {enforcedChip}
              </div>
              <div className="ch-divider" aria-hidden="true" />
            </>
          ) : null}
          <div className="ch-meta">
            {meta}
            {!description && enforced ? (
              <>
                <span className="ch-meta-sep">·</span>
                {enforcedChip}
              </>
            ) : null}
          </div>
        </div>
        <div className="ch-card-actions">
          {isActive ? (
            <button type="button" className="ch-icon-btn" title="Edit challenge" aria-label="Edit challenge">
              <EditIcon />
            </button>
          ) : null}
          <button type="button" className="ch-icon-btn ch-icon-danger" title="Delete challenge" aria-label="Delete challenge">
            <TrashIcon />
          </button>
        </div>
      </div>

      <ChallengeProgress current={current} target={target} unit={unit} percent={percent} />

      <div className="ch-action-row">
        {isActive ? (
          <button type="button" className={cx('ch-complete', ready && 'ch-complete-ready')}>
            <CheckIcon strokeWidth={3} />
            <span>{ready ? 'Claim bonus' : 'Complete'}</span>
          </button>
        ) : (
          <button type="button" className="ch-take-again">
            <RefreshIcon />
            <span>Take again</span>
          </button>
        )}
      </div>
    </div>
  );
}

export interface ChallengeMetaProps {
  /** Meta fragments — rendered with the app's `·` separator between them. */
  items: React.ReactNode[];
}

/**
 * The dot-separated meta line under a challenge title.
 *
 * @category Challenges
 */
export function ChallengeMeta({ items }: ChallengeMetaProps): React.ReactElement {
  return (
    <>
      {items.map((item, i) => (
        <React.Fragment key={i}>
          {i > 0 ? <span className="ch-meta-sep">·</span> : null}
          <span>{item}</span>
        </React.Fragment>
      ))}
    </>
  );
}
