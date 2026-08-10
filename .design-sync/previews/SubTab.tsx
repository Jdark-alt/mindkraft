import * as React from 'react';
import { SubTabs, SubTab } from 'mindkraft-ds';
import { Page } from './_page';

/** Lit and unlit, side by side — the indicator is the only difference. */
export const ActiveAndIdle = () => (
  <Page>
    <SubTabs>
      <SubTab active>My Activities</SubTab>
      <SubTab>Categories</SubTab>
    </SubTabs>
  </Page>
);

/** A long label truncates rather than wrapping — the row stays one line. */
export const LongLabel = () => (
  <Page>
    <SubTabs>
      <SubTab active>Group Challenge Leaderboard</SubTab>
      <SubTab>Map</SubTab>
    </SubTabs>
  </Page>
);
