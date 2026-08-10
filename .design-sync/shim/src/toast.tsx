import * as React from 'react';
import { cx } from './tokens';
import { TOAST_ICONS, TOAST_STRIPE } from './icons';

/**
 * Toast colours, one job each: `blue` informational, `green` success,
 * `olive` neutral-notice (coral stripe), `red` destructive.
 */
export type ToastColor = 'blue' | 'green' | 'olive' | 'red';

export interface ToastProps {
  /** The message. One line of plain language — toasts confirm, they don't explain. */
  message: React.ReactNode;
  /** Which job this toast does. @default "blue" */
  color?: ToastColor;
  /**
   * Whether the toast is in its settled on-screen state. The app adds this on
   * the frame after insert; a still frame needs it on or the toast is
   * invisible (it starts at `opacity: 0`).
   * @default true
   */
  visible?: boolean;
  className?: string;
}

/**
 * The confirmation pill. Mindkraft confirms routine actions with a toast and
 * never with a modal — tap, done, toast. Anything that needs a decision is a
 * `Modal`; anything that just happened is this.
 *
 * @category Feedback
 */
export function Toast({ message, color = 'blue', visible = true, className }: ToastProps): React.ReactElement {
  return (
    <div
      className={cx('mk-toast', `mk-toast-${color}`, visible && 'mk-toast-in', className)}
      style={{ '--mk-toast-stripe': TOAST_STRIPE[color] } as React.CSSProperties}
    >
      <span className="mk-toast-icon">{TOAST_ICONS[color]}</span>
      <span className="mk-toast-msg">{message}</span>
    </div>
  );
}

export interface ToastStackProps {
  /** `Toast` elements, newest first — the app inserts at the top. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The fixed container toasts stack in (top-centre on mobile). It is
 * `position: fixed`, so it escapes any card it is rendered inside — compose a
 * bare `Toast` when you just want to show the pill.
 *
 * @category Feedback
 */
export function ToastStack({ children, className }: ToastStackProps): React.ReactElement {
  return <div className={cx('mk-toast-stack', className)}>{children}</div>;
}
