import * as React from 'react';
import { FilterPills, FilterPill } from 'mindkraft-ds';
import { Page } from './_page';

/** The Analytics view filter — exactly one pill lit. */
export const ViewFilter = () => (
  <Page>
    <FilterPills>
      <FilterPill active>All</FilterPill>
      <FilterPill>Dimension</FilterPill>
      <FilterPill>Path</FilterPill>
      <FilterPill>Activity</FilterPill>
    </FilterPills>
  </Page>
);

/** The period filter, with a middle option chosen. */
export const PeriodFilter = () => (
  <Page>
    <FilterPills>
      <FilterPill>7 Days</FilterPill>
      <FilterPill active>30 Days</FilterPill>
      <FilterPill>All Time</FilterPill>
    </FilterPills>
  </Page>
);
