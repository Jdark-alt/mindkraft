import * as React from 'react';
import { AtRiskChip, ActivityListItem } from 'mindkraft-ds';
import { Page } from './_page';

/** The amber warning chip on its own. */
export const Default = () => (
  <Page>
    <AtRiskChip />
  </Page>
);

/** In situ: it only ever appears on a streak that breaks tonight. */
export const OnARow = () => (
  <Page>
    <ActivityListItem name="Evening Journal" xp={12} streak={18} dimension="rose" atRisk />
  </Page>
);
