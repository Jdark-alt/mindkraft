import * as React from 'react';
import { SubTabs, SubTab } from 'mindkraft-ds';
import { Page } from './_page';

/** The two-label case the divider is drawn for. */
export const Default = () => (
  <Page>
    <SubTabs>
      <SubTab active>My Challenges</SubTab>
      <SubTab>Group Challenge</SubTab>
    </SubTabs>
  </Page>
);

/** The three-label case from the Activities tab. */
export const ThreeLabels = () => (
  <Page>
    <SubTabs>
      <SubTab active>My Activities</SubTab>
      <SubTab>Categories</SubTab>
      <SubTab>Map</SubTab>
    </SubTabs>
  </Page>
);

/** Which label is lit is the whole state — the indicator moves, nothing else. */
export const SecondActive = () => (
  <Page>
    <SubTabs>
      <SubTab>My Activities</SubTab>
      <SubTab active>Categories</SubTab>
      <SubTab>Map</SubTab>
    </SubTabs>
  </Page>
);
