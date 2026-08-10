import * as React from 'react';
import { ActivityGrid, ActivityGridCard, GridBadge } from 'mindkraft-ds';
import { Page } from './_page';

/** The everyday case: a 2×1 card with XP and a streak. */
export const Default = () => (
  <Page>
    <ActivityGrid>
      <ActivityGridCard name="Morning Walk" xp={15} type={3} streak={4} dimension="green" />
    </ActivityGrid>
  </Page>
);

/** All seven footprints, laid out the way the grid actually packs them. */
export const Footprints = () => (
  <Page>
    <ActivityGrid>
      <ActivityGridCard name="Water" xp={5} type={1} dimension="teal" />
      <ActivityGridCard name="Stretch" xp={8} type={5} streak={2} dimension="sage" />
      <ActivityGridCard name="Read 20 pages" xp={20} type={3} streak={5} dimension="indigo" />
      <ActivityGridCard
        name="Deep Work"
        xp={30}
        type={6}
        streak={5}
        dimension="purple"
        dimensionName="Career"
        pathName="Focus"
      />
      <ActivityGridCard name="Journal" xp={12} type={7} streak={3} dimension="rose" />
    </ActivityGrid>
  </Page>
);

/** Type 2, the 3×2 showcase — the only footprint with room for full badges. */
export const Showcase = () => (
  <Page>
    <ActivityGrid>
      <ActivityGridCard
        name="Strength Training"
        xp={25}
        type={2}
        streak={6}
        dimension="olive"
        showUndo
        badges={
          <>
            <GridBadge variant="counter">Health › Movement</GridBadge>
            <GridBadge variant="multi">+25 XP</GridBadge>
            <GridBadge variant="challenge">🔥 6 streak</GridBadge>
            <GridBadge variant="shield">2 🛡 left</GridBadge>
          </>
        }
      />
    </ActivityGrid>
  </Page>
);

/** Completion states: available, done, done with multi-completes, not scheduled. */
export const States = () => (
  <Page>
    <ActivityGrid>
      <ActivityGridCard name="Available" xp={15} type={3} streak={2} dimension="blue" />
      <ActivityGridCard name="Done today" xp={15} type={3} streak={5} dimension="green" state="done" />
      <ActivityGridCard
        name="Pushups"
        xp={10}
        type={3}
        streak={3}
        dimension="olive"
        state="done-multi"
        showUndo
      />
      <ActivityGridCard name="Not scheduled" xp={20} type={3} dimension="amber" state="disabled" />
    </ActivityGrid>
  </Page>
);

/** A negative activity — red XP, the one place destruction colour appears here. */
export const Negative = () => (
  <Page>
    <ActivityGrid>
      <ActivityGridCard name="Doomscrolling" xp={-20} type={3} dimension="red" />
      <ActivityGridCard
        name="Skipped Gym"
        xp={-15}
        type={6}
        dimension="red"
        dimensionName="Health"
        pathName="Movement"
        badges={<GridBadge variant="skip">⚡ −2d penalty</GridBadge>}
      />
    </ActivityGrid>
  </Page>
);
