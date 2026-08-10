import * as React from 'react';
import { cx } from './tokens';

export interface ModalProps {
  /** Heading rendered in `.modal-title`. */
  title?: React.ReactNode;
  /** Small uppercase eyebrow above the title (the app uses it on the planner modal). */
  eyebrow?: React.ReactNode;
  /** The modal's content. Wrap fields in `FormGroup`. */
  children?: React.ReactNode;
  /** Footer actions, right-aligned. Cancel (`secondary`) then the confirm (`primary`). */
  footer?: React.ReactNode;
  /**
   * The overlay is `display: none` until it carries `active`.
   * @default true
   */
  open?: boolean;
  /** Renders the ✕ close control in the header. @default true */
  closable?: boolean;
  className?: string;
}

/**
 * A modal over a full-screen scrim. Reserve it for decisions — the design
 * brief rejects pop-up confirmations for routine actions, which get a `Toast`
 * instead.
 *
 * The overlay is `position: fixed` and covers the viewport, so it escapes any
 * container it is rendered inside.
 *
 * ```tsx
 * <Modal title="Add to schedule" eyebrow="Daily Planner"
 *   footer={<><Button variant="secondary">Cancel</Button><Button>Add</Button></>}>
 *   <FormGroup label="Activity"><TextInput placeholder="Search activities…" /></FormGroup>
 * </Modal>
 * ```
 *
 * @category Overlays
 */
export function Modal({
  title,
  eyebrow,
  children,
  footer,
  open = true,
  closable = true,
  className,
}: ModalProps): React.ReactElement {
  return (
    <div className={cx('modal-overlay', open && 'active')}>
      <div className={cx('modal', 'pl-modal', className)}>
        <div className="modal-header pl-modal-header">
          <div>
            {eyebrow ? <div className="pl-modal-eyebrow">{eyebrow}</div> : null}
            {title ? <h3 className="modal-title">{title}</h3> : null}
          </div>
          {closable ? (
            <button type="button" className="pl-modal-close" aria-label="Close">
              ✕
            </button>
          ) : null}
        </div>
        <div className="modal-body pl-modal-body">{children}</div>
        {footer ? <div className="modal-footer pl-modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}
