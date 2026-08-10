import * as React from 'react';
import { StatRow, StatCard } from 'mindkraft-ds';
import { Page } from './_page';
import { xpIcon, checkIcon } from './_stat-icons';

/** The pair the app puts in every row. */
export const Pair = () => (
  <Page>
    <StatRow>
      <StatCard value="14,820" label="Total XP Earned" accent="green" icon={xpIcon} />
      <StatCard value="612" label="Total Completions" accent="blue" icon={checkIcon} />
    </StatRow>
  </Page>
);

/** A single card still fills the row. */
export const Single = () => (
  <Page>
    <StatRow>
      <StatCard value="47" label="Highest Streak" accent="coral" />
    </StatRow>
  </Page>
);
