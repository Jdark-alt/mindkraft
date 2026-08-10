import * as React from 'react';
import { MultiCountChip, ActivityListItem } from 'mindkraft-ds';
import { Page } from './_page';

/** The bare counter. */
export const Counts = () => (
  <Page>
    <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
      <MultiCountChip count={1} />
      <MultiCountChip count={3} />
      <MultiCountChip count={12} />
    </div>
  </Page>
);

/** In situ on a multi-complete activity. */
export const OnARow = () => (
  <Page>
    <ActivityListItem
      name="Pushups"
      xp={8}
      streak={3}
      multiCount={4}
      dimension="olive"
      state="completed-multi"
      showUndo
    />
  </Page>
);
