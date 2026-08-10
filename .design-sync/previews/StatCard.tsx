import * as React from 'react';
import { StatCard, StatRow } from 'mindkraft-ds';
import { Page } from './_page';
import { xpIcon, checkIcon, rateIcon, fireIcon } from './_stat-icons';

/** One figure, with the glowing accent edge. */
export const Default = () => (
  <Page>
    <StatRow>
      <StatCard value="14,820" label="Total XP Earned" accent="green" icon={xpIcon} />
    </StatRow>
  </Page>
);

/** All four accents, each doing its own colour job. */
export const Accents = () => (
  <Page>
    <StatRow>
      <StatCard value="14,820" label="Total XP Earned" accent="green" icon={xpIcon} />
      <StatCard value="612" label="Total Completions" accent="blue" icon={checkIcon} />
    </StatRow>
    <div style={{ height: 10 }} />
    <StatRow>
      <StatCard value="38.4" label="XP / Hour" accent="amber" icon={rateIcon} />
      <StatCard value="47" label="Highest Streak" accent="coral" icon={fireIcon} />
    </StatRow>
  </Page>
);

/** Without an icon — the value and label carry it alone. */
export const NoIcon = () => (
  <Page>
    <StatRow>
      <StatCard value="92%" label="Consistency" accent="blue" />
    </StatRow>
  </Page>
);
