import * as React from 'react';
import { cx } from './tokens';

export interface LevelBadgeProps {
  /** The user's current level — the app's largest number, in tabular 800 weight. */
  level: number;
  /**
   * Arms the golden trace animation (`trace-ready`), which strokes the digit's
   * outline every 30s. The app arms it only after it has measured the SVG, so
   * leave it off for a still frame.
   * @default false
   */
  goldTrace?: boolean;
  className?: string;
}

/**
 * The header's level display: a small "Level" label above an SVG-rendered
 * number. The number is drawn twice at identical coordinates — a
 * gradient-filled copy and a stroked copy — so the golden trace overlay
 * follows the digit's real contour. Gold is reserved for genuine milestones,
 * and this is one of the two places it appears.
 *
 * @category Header
 */
export function LevelBadge({ level, goldTrace = false, className }: LevelBadgeProps): React.ReactElement {
  // The gradient id is fixed: style.css resolves the fill with the literal
  // `fill: url(#levelGradient)`, so a generated id would never be referenced.
  //
  // The app measures the rendered text and resizes the SVG so the header
  // reserves the right width. Without a measure pass we approximate from the
  // digit count: Inter 800 at 50px advances ~29px per digit after the -2px
  // tracking. Undersizing here is what makes a 3-digit level collide with the
  // progress bar.
  const width = Math.max(68, String(level).length * 29);
  return (
    <div className={cx('level-badge', className)}>
      <span className="level-label">Level</span>
      <div className="level-display">
        <svg className="level-svg" width={width} height="50" overflow="visible" xmlns="http://www.w3.org/2000/svg" aria-label="Level">
          <defs>
            <linearGradient id="levelGradient" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="30%" stopColor="var(--color-text-primary)" />
              <stop offset="100%" stopColor="var(--color-progress)" />
            </linearGradient>
          </defs>
          <text className="level-svg-text level-svg-fill" x="0" y="42">
            {level}
          </text>
          <text className={cx('level-svg-text', 'level-svg-trace', goldTrace && 'trace-ready')} x="0" y="42" aria-hidden="true">
            {level}
          </text>
        </svg>
      </div>
    </div>
  );
}

export interface XPProgressBarProps {
  /** XP banked at the current level. */
  xp: number;
  /** Percent of the way to the next level, 0–100. */
  percent: number;
  /** XP still needed for the next level. */
  xpToNext: number;
  /**
   * Which of the two alternating readouts is showing. The header swaps them
   * every 30s; a static design should pick one.
   * @default "xp"
   */
  readout?: 'xp' | 'percent';
  className?: string;
}

/**
 * The header's XP readout and progress bar. The left value alternates between
 * "N XP" and "N% done" in the running app; the right value is always the XP
 * remaining to the next level. Every digit here is tabular.
 *
 * @category Header
 */
export function XPProgressBar({
  xp,
  percent,
  xpToNext,
  readout = 'xp',
  className,
}: XPProgressBarProps): React.ReactElement {
  return (
    <div className={cx('progress-section', className)}>
      <div className="progress-meta">
        <div className="progress-alt" aria-live="polite">
          <div className="progress-alt-frame">
            <span className="progress-alt-spacer">100% done</span>
            <span className="progress-alt-item progress-alt-xp" data-state={readout === 'xp' ? 'active' : undefined}>
              <span className="progress-alt-num">{xp.toLocaleString()}</span>
              <span className="progress-alt-label"> XP</span>
            </span>
            <span className="progress-alt-item progress-alt-pct" data-state={readout === 'percent' ? 'active' : undefined}>
              <span className="progress-alt-num">{Math.floor(percent)}%</span>
              <span className="progress-alt-label"> done</span>
            </span>
          </div>
        </div>
        <div className="header-meta-right">
          <span className="header-meta-xp-left">
            <span>{xpToNext.toLocaleString()}</span> XP to next
          </span>
        </div>
      </div>
      <div className="progress-bar-container">
        <div className="progress-bar" style={{ width: `${Math.max(0, Math.min(100, percent))}%` }} />
      </div>
    </div>
  );
}

export interface AppHeaderProps {
  /** Current level, rendered by `LevelBadge`. */
  level: number;
  /** XP banked at the current level. */
  xp: number;
  /** Percent to the next level, 0–100. */
  percent: number;
  /** XP still needed for the next level. */
  xpToNext: number;
  /** Which alternating readout is showing. @default "xp" */
  readout?: 'xp' | 'percent';
  /** Single character shown in the avatar button when there's no photo. */
  avatarInitial?: string;
  /** Avatar image URL. Takes precedence over `avatarInitial`. */
  avatarSrc?: string;
  /** Arms the golden trace on the level number. @default false */
  goldTrace?: boolean;
  className?: string;
}

/**
 * The sticky app header: level on the left, XP progress in the middle, profile
 * avatar on the right. It shares the card material with activity cards and the
 * bottom nav, which is what makes the whole app read as one surface system.
 *
 * @category Header
 */
export function AppHeader({
  level,
  xp,
  percent,
  xpToNext,
  readout = 'xp',
  avatarInitial,
  avatarSrc,
  goldTrace = false,
  className,
}: AppHeaderProps): React.ReactElement {
  return (
    <div className={cx('sticky-header', className)}>
      <div className="header-content">
        <div className="header-top">
          <LevelBadge level={level} goldTrace={goldTrace} />
          <XPProgressBar xp={xp} percent={percent} xpToNext={xpToNext} readout={readout} />
          <div className="user-info">
            <button type="button" className="profile-avatar-btn" title="Your Profile">
              {avatarSrc ? (
                <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: '50%' }} />
              ) : (
                <span style={{ fontSize: '15px', fontWeight: 700, lineHeight: 1 }}>{avatarInitial}</span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
