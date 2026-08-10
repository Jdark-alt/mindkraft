import * as React from 'react';
import { ActionToolbar, ToolCluster, ToolbarButton, ToolDivider } from 'mindkraft-ds';
import { Page } from './_page';

/** Four icons separated by hairlines — no pill, no border, no background. */
export const Default = () => (
  <Page>
    <ActionToolbar>
      <ToolCluster>
        <ToolbarButton icon="grid" />
        <ToolDivider />
        <ToolbarButton icon="filter" />
        <ToolDivider />
        <ToolbarButton icon="planner" />
        <ToolDivider />
        <ToolbarButton icon="search" />
      </ToolCluster>
    </ActionToolbar>
  </Page>
);

/** A two-icon cluster, the shape most secondary surfaces use. */
export const Pair = () => (
  <Page>
    <ActionToolbar>
      <ToolCluster>
        <ToolbarButton icon="filter" showDot />
        <ToolDivider />
        <ToolbarButton icon="search" />
      </ToolCluster>
    </ActionToolbar>
  </Page>
);
