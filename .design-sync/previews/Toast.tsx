import * as React from 'react';
import { Toast } from 'mindkraft-ds';
import { Page } from './_page';

/** The everyday confirmation. */
export const Default = () => (
  <Page>
    <Toast message="Morning Walk completed · +15 XP" color="green" />
  </Page>
);

/** All four jobs, with the copy each colour is for. */
export const EveryColour = () => (
  <Page>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Toast message="Morning Walk completed · +15 XP" color="green" />
      <Toast message="Sorting saved as your default view" color="blue" />
      <Toast message="Group deleted" color="olive" />
      <Toast message="Couldn't save — you're offline" color="red" />
    </div>
  </Page>
);

/** A longer message wraps; the stripe and icon stay pinned to the top. */
export const LongMessage = () => (
  <Page>
    <Toast
      message="Challenge complete — 30 Days of Movement. Bonus XP has been added to your total and the challenge moved to Completed."
      color="green"
    />
  </Page>
);
