import * as React from 'react';
import { cx } from './tokens';
import { GridIcon, FilterIcon, CalendarIcon, SearchIcon, PlusIcon } from './icons';

export interface ActionToolbarProps {
  /** `ToolCluster`, `ToolbarCount` and `ToolbarAddButton`, in that order. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The bare action row that sits above a list (`.act-toolbar`). It has no pill
 * container and no background — icons separated by hairlines on the left, a
 * count in the middle, and the one blue CTA on the right.
 *
 * @category Toolbar
 */
export function ActionToolbar({ children, className }: ActionToolbarProps): React.ReactElement {
  return <div className={cx('act-toolbar', className)}>{children}</div>;
}

export interface ToolClusterProps {
  /** `ToolbarButton`s and `ToolDivider`s. */
  children?: React.ReactNode;
  className?: string;
}

/**
 * The left-hand icon group inside `ActionToolbar`.
 *
 * @category Toolbar
 */
export function ToolCluster({ children, className }: ToolClusterProps): React.ReactElement {
  return <div className={cx('tool-cluster', className)}>{children}</div>;
}

/**
 * The 1px hairline between toolbar icons. Never use a border here.
 *
 * @category Toolbar
 */
export function ToolDivider(): React.ReactElement {
  return <span className="tool-divider" aria-hidden="true" />;
}

/** The icons the app's own toolbars use. */
export type ToolbarIcon = 'grid' | 'filter' | 'planner' | 'search';

const TOOLBAR_ICONS: Record<ToolbarIcon, () => React.ReactElement> = {
  grid: GridIcon,
  filter: FilterIcon,
  planner: CalendarIcon,
  search: SearchIcon,
};

export interface ToolbarButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Which glyph to draw. */
  icon: ToolbarIcon;
  /** Shows the small accent dot that marks a filter as applied. */
  showDot?: boolean;
}

/**
 * One bare icon button in `ToolCluster` — no pill, no border.
 *
 * @category Toolbar
 */
export function ToolbarButton({ icon, showDot, className, ...rest }: ToolbarButtonProps): React.ReactElement {
  const Icon = TOOLBAR_ICONS[icon];
  return (
    <button type="button" className={cx('act-tb-btn', className)} {...rest}>
      <Icon />
      {showDot ? <span className="act-tb-dot" aria-hidden="true" /> : null}
    </button>
  );
}

export interface ToolbarCountProps {
  className?: string;
  children?: React.ReactNode;
}

/**
 * The bare count text in the middle of the toolbar (e.g. "12 of 20 slots").
 *
 * @category Toolbar
 */
export function ToolbarCount({ className, children }: ToolbarCountProps): React.ReactElement {
  return <span className={cx('act-count-pill', className)}>{children}</span>;
}

export interface ToolbarAddButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Button copy. @default "Add" */
  label?: string;
}

/**
 * The toolbar's blue CTA — the deliberate exception to the bare-icon rule,
 * because it is the surface's primary action. There is only ever one.
 *
 * @category Toolbar
 */
export function ToolbarAddButton({ label = 'Add', className, ...rest }: ToolbarAddButtonProps): React.ReactElement {
  return (
    <button type="button" className={cx('act-tb-add-main', className)} {...rest}>
      <PlusIcon />
      {label}
    </button>
  );
}
