import * as React from 'react';
import { ActionToolbar, ToolCluster, ToolbarButton, ToolDivider, ToolbarCount, ToolbarAddButton } from 'mindkraft-ds';
import { Page } from './_page';

/** The My Activities toolbar, exactly as the app composes it. */
export const Default = () => (
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
      <ToolbarCount>12 of 20</ToolbarCount>
      <ToolbarAddButton />
    </ActionToolbar>
  </Page>
);

/** A filter is applied — the accent dot is the only marker. */
export const FilterApplied = () => (
  <Page>
    <ActionToolbar>
      <ToolCluster>
        <ToolbarButton icon="grid" />
        <ToolDivider />
        <ToolbarButton icon="filter" showDot />
        <ToolDivider />
        <ToolbarButton icon="search" />
      </ToolCluster>
      <ToolbarCount>4 of 20</ToolbarCount>
      <ToolbarAddButton />
    </ActionToolbar>
  </Page>
);

/** The Challenges toolbar — one icon, one CTA, no count. */
export const Minimal = () => (
  <Page>
    <ActionToolbar>
      <ToolCluster>
        <ToolbarButton icon="search" />
      </ToolCluster>
      <ToolbarAddButton label="Create" />
    </ActionToolbar>
  </Page>
);
