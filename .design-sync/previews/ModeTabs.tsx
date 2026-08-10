import * as React from 'react';
import { ModeTabs, ModeTab } from 'mindkraft-ds';
import { Page } from './_page';

/** The chart's Cumulative / Daily switch — the indicator primitive, one size down. */
export const Default = () => (
  <Page>
    <ModeTabs>
      <ModeTab active>Cumulative</ModeTab>
      <ModeTab>Daily</ModeTab>
    </ModeTabs>
  </Page>
);

/** The other mode lit. */
export const DailyActive = () => (
  <Page>
    <ModeTabs>
      <ModeTab>Cumulative</ModeTab>
      <ModeTab active>Daily</ModeTab>
    </ModeTabs>
  </Page>
);
