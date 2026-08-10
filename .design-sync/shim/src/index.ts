/**
 * Mindkraft design system — React binding.
 *
 * Every component here emits the exact class names and DOM structure the
 * Mindkraft PWA already ships (index.html + the render functions in app.js).
 * There is no styling in this package: all of it comes from the repo's own
 * `style.css`, which the design system serves as `_ds_bundle.css`.
 */

export { MindkraftRoot, TabContent } from './root';
export type { MindkraftRootProps, TabContentProps } from './root';

export { SubTabs, SubTab, SubTabContent, NavTabs, NavTab, EmptyPlaceholder } from './nav';
export type {
  SubTabsProps,
  SubTabProps,
  SubTabContentProps,
  NavTabsProps,
  NavTabProps,
  NavTabId,
  EmptyPlaceholderProps,
} from './nav';

export { AppHeader, LevelBadge, XPProgressBar } from './header';
export type { AppHeaderProps, LevelBadgeProps, XPProgressBarProps } from './header';

export { ActionToolbar, ToolCluster, ToolDivider, ToolbarButton, ToolbarCount, ToolbarAddButton } from './toolbar';
export type {
  ActionToolbarProps,
  ToolClusterProps,
  ToolbarButtonProps,
  ToolbarIcon,
  ToolbarCountProps,
  ToolbarAddButtonProps,
} from './toolbar';

export { XPChip, StreakChip, AtRiskChip, MultiCountChip, ActivityBadge, GridBadge } from './chips';
export type {
  XPChipProps,
  StreakChipProps,
  AtRiskChipProps,
  MultiCountChipProps,
  ActivityBadgeProps,
  ActivityBadgeVariant,
  GridBadgeProps,
  GridBadgeVariant,
} from './chips';

export { ActivityRing } from './ring';
export type { ActivityRingProps } from './ring';

export { ActivityListItem } from './activity-list';
export type { ActivityListItemProps, ActivityState } from './activity-list';

export { ActivityGrid, ActivityGridCard } from './activity-grid';
export type { ActivityGridProps, ActivityGridCardProps, GridCardType, GridCardState } from './activity-grid';

export { ChallengeCard, ChallengeProgress, ChallengeMeta } from './challenge';
export type { ChallengeCardProps, ChallengeProgressProps, ChallengeMetaProps, ChallengeState } from './challenge';

export {
  StatCard,
  StatRow,
  StatGrid,
  AnalyticsCard,
  FilterPills,
  FilterPill,
  RangeSelector,
  RangeButton,
  ModeTabs,
  ModeTab,
} from './analytics';
export type {
  StatCardProps,
  StatAccent,
  StatRowProps,
  StatGridProps,
  AnalyticsCardProps,
  FilterPillsProps,
  FilterPillProps,
  RangeSelectorProps,
  RangeButtonProps,
  ModeTabsProps,
  ModeTabProps,
} from './analytics';

export { Toast, ToastStack } from './toast';
export type { ToastProps, ToastColor, ToastStackProps } from './toast';

export { Modal } from './modal';
export type { ModalProps } from './modal';

export { Button, FormGroup, TextInput, TextArea, Select } from './forms';
export type { ButtonProps, FormGroupProps, TextInputProps, TextAreaProps, SelectProps } from './forms';

export { DIMENSION_HEX, DIMENSION_ORDER, dimensionRgb, dimensionStyle } from './tokens';
export type { DimensionColor } from './tokens';
