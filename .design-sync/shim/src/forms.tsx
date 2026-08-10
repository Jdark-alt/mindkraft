import * as React from 'react';
import { cx } from './tokens';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /**
   * `primary` is the solid blue CTA — one per surface. `secondary` is the
   * quiet translucent partner, used for Cancel.
   * @default "primary"
   */
  variant?: 'primary' | 'secondary';
  children?: React.ReactNode;
}

/**
 * Mindkraft's button. Blue is the interactive colour and nothing else, so a
 * primary button always means "the action this surface exists for".
 *
 * ```tsx
 * <Button variant="secondary">Cancel</Button>
 * <Button>Save Reward</Button>
 * ```
 *
 * @category Forms
 */
export function Button({ variant = 'primary', className, children, ...rest }: ButtonProps): React.ReactElement {
  return (
    <button type="button" className={cx(`btn-${variant}`, className)} {...rest}>
      {children}
    </button>
  );
}

export interface FormGroupProps {
  /** Uppercase field label. Rendered at 11px/600 with wide tracking. */
  label?: React.ReactNode;
  /** `htmlFor` on the label. */
  htmlFor?: string;
  /** The control — `TextInput`, `TextArea`, `Select`, or a raw element. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * A labelled field. **Every Mindkraft input must be inside one**: the input,
 * textarea and select styles are all descendant rules of `.form-group`, so a
 * control outside it renders with browser defaults.
 *
 * @category Forms
 */
export function FormGroup({ label, htmlFor, children, className }: FormGroupProps): React.ReactElement {
  return (
    <div className={cx('form-group', className)}>
      {label ? <label htmlFor={htmlFor}>{label}</label> : null}
      {children}
    </div>
  );
}

export interface TextInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** @default "text" */
  type?: 'text' | 'number' | 'url' | 'email' | 'password' | 'date';
}

/**
 * A text field. Must be rendered inside `FormGroup` to pick up its styling.
 *
 * @category Forms
 */
export function TextInput({ type = 'text', ...rest }: TextInputProps): React.ReactElement {
  return <input type={type} {...rest} />;
}

export type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

/**
 * A multi-line field. Must be rendered inside `FormGroup`.
 *
 * @category Forms
 */
export function TextArea(props: TextAreaProps): React.ReactElement {
  return <textarea {...props} />;
}

export type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement>;

/**
 * A dropdown. Must be rendered inside `FormGroup` — the chevron is drawn by
 * the `--color-select-arrow-img` token on the group's descendant rule.
 *
 * @category Forms
 */
export function Select(props: SelectProps): React.ReactElement {
  return <select {...props} />;
}
