import * as React from 'react';
import { StatGrid, StatRow, StatCard } from 'mindkraft-ds';
import { Page } from './_page';
import { xpIcon, checkIcon, clockIcon, rateIcon, fireIcon } from './_stat-icons';

/** The whole Analytics summary block, as the app builds it. */
export const AnalyticsSummary = () => (
  <Page>
    <StatGrid>
      <StatRow>
        <StatCard value="14,820" label="Total XP Earned" accent="green" icon={xpIcon} />
        <StatCard value="612" label="Total Completions" accent="blue" icon={checkIcon} />
      </StatRow>
      <StatRow>
        <StatCard value="386h" label="Time Invested" accent="blue" icon={clockIcon} />
        <StatCard value="92%" label="Consistency" accent="green" icon={checkIcon} />
      </StatRow>
      <StatRow>
        <StatCard value="38.4" label="XP / Hour" accent="amber" icon={rateIcon} />
        <StatCard value="47" label="Highest Streak" accent="coral" icon={fireIcon} />
      </StatRow>
    </StatGrid>
  </Page>
);
