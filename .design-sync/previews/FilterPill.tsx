import * as React from 'react';
import { FilterPills, FilterPill } from 'mindkraft-ds';
import { Page } from './_page';

/** Chosen next to unchosen. */
export const ActiveAndIdle = () => (
  <Page>
    <FilterPills>
      <FilterPill active>All</FilterPill>
      <FilterPill>Dimension</FilterPill>
    </FilterPills>
  </Page>
);

/** A long row wraps rather than scrolling. */
export const Wrapping = () => (
  <Page>
    <FilterPills>
      <FilterPill active>All</FilterPill>
      <FilterPill>Health</FilterPill>
      <FilterPill>Career</FilterPill>
      <FilterPill>Mind</FilterPill>
      <FilterPill>Relationships</FilterPill>
      <FilterPill>Finance</FilterPill>
    </FilterPills>
  </Page>
);
