import * as React from 'react';
import { ActionToolbar, ToolCluster, ToolbarButton, ToolDivider } from 'mindkraft-ds';
import { Page } from './_page';

/**
 * The hairline in situ — it only has height inside a `ToolCluster`, which is
 * the only place the app uses it.
 */
export const BetweenIcons = () => (
  <Page>
    <ActionToolbar>
      <ToolCluster>
        <ToolbarButton icon="grid" />
        <ToolDivider />
        <ToolbarButton icon="filter" />
        <ToolDivider />
        <ToolbarButton icon="search" />
      </ToolCluster>
    </ActionToolbar>
  </Page>
);
