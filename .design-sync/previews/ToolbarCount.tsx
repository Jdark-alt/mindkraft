import * as React from 'react';
import { ActionToolbar, ToolCluster, ToolbarButton, ToolbarCount, ToolbarAddButton } from 'mindkraft-ds';
import { Page } from './_page';

/** Bare text between the icons and the CTA — deliberately not a pill. */
export const InToolbar = () => (
  <Page>
    <ActionToolbar>
      <ToolCluster>
        <ToolbarButton icon="filter" />
      </ToolCluster>
      <ToolbarCount>12 of 20</ToolbarCount>
      <ToolbarAddButton />
    </ActionToolbar>
  </Page>
);

/** At the cap — the count is informational, it does not turn into a warning. */
export const AtCapacity = () => (
  <Page>
    <ActionToolbar>
      <ToolCluster>
        <ToolbarButton icon="filter" />
      </ToolCluster>
      <ToolbarCount>20 of 20</ToolbarCount>
      <ToolbarAddButton />
    </ActionToolbar>
  </Page>
);
