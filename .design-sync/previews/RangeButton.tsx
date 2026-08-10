import * as React from 'react';
import { RangeSelector, RangeButton } from 'mindkraft-ds';
import { Page } from './_page';

/** Chosen next to unchosen. */
export const ActiveAndIdle = () => (
  <Page>
    <RangeSelector>
      <RangeButton active>All</RangeButton>
      <RangeButton>1Y</RangeButton>
    </RangeSelector>
  </Page>
);
