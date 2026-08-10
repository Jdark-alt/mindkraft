import * as React from 'react';
import { RangeSelector, RangeButton } from 'mindkraft-ds';
import { Page } from './_page';

/** The strip above the XP chart. */
export const Default = () => (
  <Page>
    <RangeSelector>
      <RangeButton>1M</RangeButton>
      <RangeButton>3M</RangeButton>
      <RangeButton>6M</RangeButton>
      <RangeButton>1Y</RangeButton>
      <RangeButton active>All</RangeButton>
    </RangeSelector>
  </Page>
);

/** A shorter range chosen. */
export const ShortRange = () => (
  <Page>
    <RangeSelector>
      <RangeButton active>1M</RangeButton>
      <RangeButton>3M</RangeButton>
      <RangeButton>6M</RangeButton>
      <RangeButton>1Y</RangeButton>
      <RangeButton>All</RangeButton>
    </RangeSelector>
  </Page>
);
