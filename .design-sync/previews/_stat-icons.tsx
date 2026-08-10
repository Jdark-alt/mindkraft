import * as React from 'react';

// Preview scaffolding — the analytics summary icons, copied verbatim from the
// `ic` map in app.js so the stat previews show the app's real glyphs. The DS
// takes `icon` as a node rather than owning an icon set, so these live here.
const stat = (children: React.ReactNode) => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

export const xpIcon = stat(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />);
export const checkIcon = stat(<polyline points="20 6 9 17 4 12" />);
export const clockIcon = stat(
  <>
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </>
);
export const rateIcon = stat(<polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />);
export const fireIcon = stat(
  <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5z" />
);
