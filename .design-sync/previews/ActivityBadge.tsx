import * as React from 'react';
import { ActivityBadge, ActivityListItem } from 'mindkraft-ds';
import { Page } from './_page';

/** Every variant, with the copy each one actually carries. */
export const EveryVariant = () => (
  <Page>
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <ActivityBadge variant="frequency">Health › Movement</ActivityBadge>
      <ActivityBadge variant="xp">+20 XP (1.5×)</ActivityBadge>
      <ActivityBadge variant="negative">−20 XP</ActivityBadge>
      <ActivityBadge variant="streak">🔥 12 streak</ActivityBadge>
      <ActivityBadge variant="shield">2 🛡 left</ActivityBadge>
      <ActivityBadge variant="shield-warn">🛡 0 left!</ActivityBadge>
      <ActivityBadge variant="counter">3/5 cycle</ActivityBadge>
      <ActivityBadge variant="at-risk">⚠ at risk</ActivityBadge>
      <ActivityBadge variant="penalty">⚡ −2d penalty</ActivityBadge>
    </div>
  </Page>
);

/** Where they live: the expanded body of an activity row. */
export const InExpandedRow = () => (
  <Page>
    <ActivityListItem
      name="Read 20 pages"
      xp={20}
      streak={5}
      dimension="indigo"
      expanded
      badges={
        <>
          <ActivityBadge variant="frequency">Mind › Reading</ActivityBadge>
          <ActivityBadge variant="xp">+20 XP</ActivityBadge>
          <ActivityBadge variant="counter">3/5 cycle</ActivityBadge>
        </>
      }
    />
  </Page>
);
