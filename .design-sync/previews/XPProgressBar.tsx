import * as React from 'react';
import { XPProgressBar } from 'mindkraft-ds';
import { Page } from './_page';

/** Two thirds of the way to the next level. */
export const Default = () => (
  <Page>
    <XPProgressBar xp={340} percent={68} xpToNext={160} />
  </Page>
);

/** The percent readout the header alternates to. */
export const PercentReadout = () => (
  <Page>
    <XPProgressBar xp={340} percent={68} xpToNext={160} readout="percent" />
  </Page>
);

/** The range: nothing banked, halfway, and one completion from levelling. */
export const Range = () => (
  <Page>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <XPProgressBar xp={0} percent={0} xpToNext={50} />
      <XPProgressBar xp={125} percent={50} xpToNext={125} />
      <XPProgressBar xp={2480} percent={96} xpToNext={20} />
    </div>
  </Page>
);
