// Internal icon set. Every path here is copied verbatim from the Mindkraft app
// (index.html / app.js) so the shim renders the same glyphs the product does.
// Not exported from the package entry — icons are an implementation detail of
// the components that use them, exactly as they are in the app.
import * as React from 'react';

export const FlameIcon = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
  </svg>
);

export const WarnTriangleIcon = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M10.3 3.86 1.82 18a2 2 0 0 0 1.7 3h16.96a2 2 0 0 0 1.7-3L13.7 3.86a2 2 0 0 0-3.4 0Z" />
    <line x1="12" y1="9" x2="12" y2="13" />
    <circle cx="12" cy="17" r="1" fill="currentColor" />
  </svg>
);

// `size` omitted → no width/height attributes, so CSS sizes the glyph (that is
// how the challenge Complete button and the cat-act check render in the app).
export const CheckIcon = ({ size, strokeWidth = 3 }: { size?: number; strokeWidth?: number }): React.ReactElement => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export const UndoIcon = ({ size }: { size?: number }): React.ReactElement => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 7v6h6" />
    <path d="M21 17a9 9 0 0 0-15-6.7L3 13" />
  </svg>
);

export const ChevronRightIcon = ({ className }: { className?: string }): React.ReactElement => (
  <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);

export const PlusIcon = (): React.ReactElement => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
);

export const EditIcon = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
  </svg>
);

export const TrashIcon = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
);

export const RefreshIcon = (): React.ReactElement => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points="23 4 23 10 17 10" />
    <polyline points="1 20 1 14 7 14" />
    <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
    <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
  </svg>
);

// ── Toolbar icons (act-toolbar) ────────────────────────────────────────────
const toolbarSvg = (children: React.ReactNode, strokeWidth = 2): React.ReactElement => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const GridIcon = (): React.ReactElement =>
  toolbarSvg(
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  );

export const FilterIcon = (): React.ReactElement =>
  toolbarSvg(<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />);

export const CalendarIcon = (): React.ReactElement =>
  toolbarSvg(
    <>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </>
  );

export const SearchIcon = (): React.ReactElement =>
  toolbarSvg(
    <>
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </>,
    2.2
  );

// ── Bottom-nav icons — verbatim from index.html's .nav-tabs ────────────────
const navSvg = (children: React.ReactNode): React.ReactElement => (
  <svg className="nav-icon" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    {children}
  </svg>
);

export const NAV_ICONS: Record<string, React.ReactElement> = {
  friends: navSvg(
    <>
      <circle cx="9" cy="7" r="4" fill="currentColor" opacity="0.13" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2 21v-2a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v2" fill="currentColor" opacity="0.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="17.5" cy="9" r="3" fill="currentColor" opacity="0.13" stroke="currentColor" strokeWidth="1.4" />
      <path d="M20.5 21v-1.5a3.5 3.5 0 0 0-3-3.46" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </>
  ),
  challenges: navSvg(
    <>
      <path d="M2 20 L8.5 8 L12 13.5 L15 9.5 L22 20 Z" fill="currentColor" opacity="0.13" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <path d="M15 9.5 L17.2 13 L12.8 13 Z" fill="currentColor" opacity="0.4" />
      <line x1="15" y1="9.5" x2="15" y2="4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M15 4 L19 5.8 L15 7.5 Z" fill="currentColor" opacity="0.85" />
    </>
  ),
  projects: navSvg(
    <>
      <line x1="6" y1="17" x2="12" y2="12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
      <line x1="12" y1="12" x2="18" y2="7" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
      <line x1="12" y1="12" x2="18" y2="16" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.28" />
      <circle cx="6" cy="17" r="2.4" fill="currentColor" opacity="0.5" />
      <circle cx="12" cy="12" r="2.9" fill="currentColor" opacity="0.16" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="7" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.75" />
      <circle cx="18" cy="16" r="1.8" fill="none" stroke="currentColor" strokeWidth="1.4" opacity="0.5" />
    </>
  ),
  activities: navSvg(
    <>
      <rect x="3" y="4" width="14" height="16" rx="3" fill="currentColor" opacity="0.12" stroke="currentColor" strokeWidth="1.6" />
      <rect x="5.5" y="8" width="9" height="2" rx="1" fill="currentColor" opacity="0.35" />
      <circle cx="15.5" cy="15.5" r="4.5" fill="currentColor" opacity="0.18" stroke="currentColor" strokeWidth="1.5" />
      <polyline points="13.4,15.5 14.9,17 17.6,13.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="5.5" y1="12" x2="11.5" y2="12" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.45" />
      <line x1="5.5" y1="15" x2="9.5" y2="15" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" opacity="0.3" />
    </>
  ),
  analytics: navSvg(
    <>
      <path d="M3 18 L7 13 L11 15.5 L16 8 L21 5 L21 18 Z" fill="currentColor" opacity="0.13" />
      <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      <polyline points="3,18 7,13 11,15.5 16,8 21,5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points="18,3.5 21,5 19.5,8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </>
  ),
  settings: navSvg(
    <>
      <path
        d="M12 2 L13.5 4.3 L16.2 3.8 L17 6.4 L19.5 7.5 L19 10.2 L21 12 L19 13.8 L19.5 16.5 L17 17.6 L16.2 20.2 L13.5 19.7 L12 22 L10.5 19.7 L7.8 20.2 L7 17.6 L4.5 16.5 L5 13.8 L3 12 L5 10.2 L4.5 7.5 L7 6.4 L7.8 3.8 L10.5 4.3 Z"
        fill="currentColor"
        opacity="0.13"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3.5" fill="currentColor" opacity="0.13" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" opacity="0.55" />
    </>
  ),
};

// ── Toast icons — verbatim from app.js TOAST_CONFIG ────────────────────────
export const TOAST_ICONS: Record<string, React.ReactElement> = {
  blue: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  ),
  green: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  olive: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  ),
  red: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="10" />
      <line x1="15" y1="9" x2="9" y2="15" />
      <line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  ),
};

export const TOAST_STRIPE: Record<string, string> = {
  blue: 'var(--color-progress)',
  green: 'var(--chip-xp-fg)',
  olive: 'var(--chip-streak-fg)',
  red: 'var(--color-accent-red)',
};
