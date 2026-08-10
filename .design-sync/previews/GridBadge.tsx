import * as React from 'react';
import { GridBadge, ActivityGrid, ActivityGridCard } from 'mindkraft-ds';
import { Page } from './_page';

/** The six grid-card badge colours. */
export const EveryVariant = () => (
  <Page>
    <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
      <GridBadge variant="shield">2 🛡</GridBadge>
      <GridBadge variant="counter">3/5</GridBadge>
      <GridBadge variant="challenge">🏅</GridBadge>
      <GridBadge variant="alert">⚠</GridBadge>
      <GridBadge variant="skip">⚡2d</GridBadge>
      <GridBadge variant="multi">×3</GridBadge>
    </div>
  </Page>
);

/** Where they live: the roomy grid-card footprints. */
export const OnACard = () => (
  <Page>
    <ActivityGrid>
      <ActivityGridCard
        name="Strength Training"
        xp={25}
        type={6}
        streak={6}
        dimension="olive"
        dimensionName="Health"
        pathName="Movement"
        badges={
          <>
            <GridBadge variant="counter">3/5</GridBadge>
            <GridBadge variant="challenge">🏅</GridBadge>
          </>
        }
      />
    </ActivityGrid>
  </Page>
);
