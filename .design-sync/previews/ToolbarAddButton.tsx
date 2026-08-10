import * as React from 'react';
import { ActionToolbar, ToolCluster, ToolbarButton, ToolbarAddButton } from 'mindkraft-ds';
import { Page } from './_page';

/** The one blue pill on the surface. */
export const Default = () => (
  <Page>
    <ActionToolbar>
      <ToolCluster>
        <ToolbarButton icon="search" />
      </ToolCluster>
      <ToolbarAddButton />
    </ActionToolbar>
  </Page>
);

/** The label follows the surface's noun. */
export const Labels = () => (
  <Page>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      <ToolbarAddButton label="Add" />
      <ToolbarAddButton label="Create" />
      <ToolbarAddButton label="New quest" />
    </div>
  </Page>
);
