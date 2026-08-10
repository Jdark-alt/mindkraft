import * as React from 'react';
import { ActionToolbar, ToolCluster, ToolbarButton, ToolDivider } from 'mindkraft-ds';
import { Page } from './_page';

/** Every glyph the app's toolbars use. */
export const EveryIcon = () => (
  <Page>
    <ActionToolbar>
      <ToolCluster>
        <ToolbarButton icon="grid" title="Switch to grid view" />
        <ToolDivider />
        <ToolbarButton icon="filter" title="Sort & Filter" />
        <ToolDivider />
        <ToolbarButton icon="planner" title="Daily Planner" />
        <ToolDivider />
        <ToolbarButton icon="search" title="Search activities" />
      </ToolCluster>
    </ActionToolbar>
  </Page>
);

/** With the applied-filter dot. */
export const WithDot = () => (
  <Page>
    <ActionToolbar>
      <ToolCluster>
        <ToolbarButton icon="filter" showDot />
      </ToolCluster>
    </ActionToolbar>
  </Page>
);
