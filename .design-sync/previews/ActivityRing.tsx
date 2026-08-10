import * as React from 'react';
import { ActivityRing, ActivityListItem, ActivityGrid, ActivityGridCard } from 'mindkraft-ds';
import { Page } from './_page';

/** The arc fills over five days: 0, 1, 3, 5. */
export const StreakProgress = () => (
  <Page>
    <div style={{ display: 'flex', gap: 18, alignItems: 'center' }}>
      <ActivityRing streak={0} />
      <ActivityRing streak={1} />
      <ActivityRing streak={3} />
      <ActivityRing streak={5} />
    </div>
  </Page>
);

/**
 * The two sizes: 48px on a list row, 27px on a grid card. The grid ring is
 * shown inside a card because `.gc-ring-fill` strokes with a bare
 * `var(--dim-color)` — outside a `grid-card` that variable is unset and the
 * arc doesn't paint at all.
 */
export const Sizes = () => (
  <Page>
    <div style={{ display: 'flex', gap: 18, alignItems: 'center', marginBottom: 10 }}>
      <ActivityRing streak={4} size="list" />
    </div>
    <ActivityGrid>
      <ActivityGridCard name="Grid ring" xp={15} type={3} streak={4} dimension="blue" />
    </ActivityGrid>
  </Page>
);

/**
 * The completed state is painted by the parent card, not the ring — so it only
 * reads correctly in situ.
 */
export const CompletedInSitu = () => (
  <Page>
    <ActivityListItem name="Meditate" xp={10} streak={12} dimension="teal" state="completed" />
    <ActivityGrid>
      <ActivityGridCard name="Done today" xp={15} type={3} streak={5} dimension="green" state="done" />
    </ActivityGrid>
  </Page>
);
