import * as React from 'react';
import { StreakChip } from 'mindkraft-ds';
import { Page } from './_page';

/** A four-day streak. */
export const Default = () => (
  <Page>
    <StreakChip days={4} />
  </Page>
);

/** The chip never changes colour or shape as the number grows — coral is coral. */
export const Growth = () => (
  <Page>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <StreakChip days={1} />
      <StreakChip days={7} />
      <StreakChip days={30} />
      <StreakChip days={365} />
    </div>
  </Page>
);
