import * as React from 'react';
import { LevelBadge } from 'mindkraft-ds';
import { Page } from './_page';

/** The number as it reads on most accounts. */
export const Default = () => (
  <Page>
    <LevelBadge level={12} />
  </Page>
);

/** One, two and three digits — the SVG grows with the number. */
export const Widths = () => (
  <Page>
    <div style={{ display: 'flex', gap: 28, alignItems: 'flex-end' }}>
      <LevelBadge level={1} />
      <LevelBadge level={42} />
      <LevelBadge level={147} />
    </div>
  </Page>
);

/**
 * With the golden trace armed. Gold is the rarest accent in Mindkraft — it
 * appears here and on achievements, nowhere else.
 */
export const GoldTrace = () => (
  <Page>
    <LevelBadge level={42} goldTrace />
  </Page>
);
