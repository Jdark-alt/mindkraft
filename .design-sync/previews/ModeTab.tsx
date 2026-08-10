import * as React from 'react';
import { ModeTabs, ModeTab } from 'mindkraft-ds';
import { Page } from './_page';

/** Lit next to unlit — same primitive as `SubTab`, smaller. */
export const ActiveAndIdle = () => (
  <Page>
    <ModeTabs>
      <ModeTab active>Cumulative</ModeTab>
      <ModeTab>Daily</ModeTab>
    </ModeTabs>
  </Page>
);
