import * as React from 'react';
import { ActivityGrid, ActivityGridCard } from 'mindkraft-ds';
import { Page } from './_page';

/** A day's worth of activities, packed dense across three columns. */
export const Packed = () => (
  <Page>
    <ActivityGrid>
      <ActivityGridCard name="Water" xp={5} type={1} dimension="teal" />
      <ActivityGridCard name="Stretch" xp={8} type={1} streak={2} dimension="sage" />
      <ActivityGridCard name="Vitamins" xp={5} type={1} dimension="amber" />
      <ActivityGridCard name="Read 20 pages" xp={20} type={3} streak={5} dimension="indigo" />
      <ActivityGridCard name="Journal" xp={12} type={1} streak={3} dimension="rose" />
      <ActivityGridCard
        name="Deep Work"
        xp={30}
        type={6}
        streak={5}
        dimension="purple"
        dimensionName="Career"
        pathName="Focus"
      />
      <ActivityGridCard name="Walk" xp={15} type={5} streak={4} dimension="green" />
    </ActivityGrid>
  </Page>
);

/** A sparse grid should feel intentional, not unfinished. */
export const Sparse = () => (
  <Page>
    <ActivityGrid>
      <ActivityGridCard name="Morning Walk" xp={15} type={3} streak={4} dimension="green" />
      <ActivityGridCard name="Water" xp={5} type={1} dimension="teal" />
    </ActivityGrid>
  </Page>
);
