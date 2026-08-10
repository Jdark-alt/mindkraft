import * as React from 'react';
import { AnalyticsCard, ModeTabs, ModeTab, RangeSelector, RangeButton, StatRow, StatCard } from 'mindkraft-ds';
import { Page } from './_page';
import { xpIcon, checkIcon } from './_stat-icons';

/** The chart panel header the app ships: kicker, mode tabs, range strip. */
export const ChartPanel = () => (
  <Page>
    <AnalyticsCard kicker="XP Over Time">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
        <ModeTabs>
          <ModeTab active>Cumulative</ModeTab>
          <ModeTab>Daily</ModeTab>
        </ModeTabs>
        <RangeSelector>
          <RangeButton>1M</RangeButton>
          <RangeButton>3M</RangeButton>
          <RangeButton>6M</RangeButton>
          <RangeButton>1Y</RangeButton>
          <RangeButton active>All</RangeButton>
        </RangeSelector>
      </div>
    </AnalyticsCard>
  </Page>
);

/** With a title, holding a pair of figures. */
export const WithTitle = () => (
  <Page>
    <AnalyticsCard title="This month">
      <div style={{ height: 10 }} />
      <StatRow>
        <StatCard value="1,240" label="XP Earned" accent="green" icon={xpIcon} />
        <StatCard value="58" label="Completions" accent="blue" icon={checkIcon} />
      </StatRow>
    </AnalyticsCard>
  </Page>
);
