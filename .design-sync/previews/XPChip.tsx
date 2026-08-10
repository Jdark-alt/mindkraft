import * as React from 'react';
import { XPChip } from 'mindkraft-ds';
import { Page } from './_page';

/** Earned XP — green, the reward colour. */
export const Positive = () => (
  <Page>
    <XPChip xp={15} />
  </Page>
);

/** A negative activity — red, the destruction colour, used sparingly. */
export const Negative = () => (
  <Page>
    <XPChip xp={-20} />
  </Page>
);

/** The range of values a card shows, all tabular so columns line up. */
export const Range = () => (
  <Page>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-start' }}>
      <XPChip xp={5} />
      <XPChip xp={30} />
      <XPChip xp={120} />
      <XPChip xp={-15} />
    </div>
  </Page>
);
