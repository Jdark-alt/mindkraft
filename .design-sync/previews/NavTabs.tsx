import * as React from 'react';
import { NavTabs, NavTab } from 'mindkraft-ds';
import { Page } from './_page';

/** The full row Mindkraft ships, with Activities lit. */
export const Default = () => (
  <Page>
    <NavTabs>
      <NavTab icon="friends" label="Friends" />
      <NavTab icon="challenges" label="Challenges" />
      <NavTab icon="projects" label="Quests" />
      <NavTab icon="activities" label="Activities" active />
      <NavTab icon="analytics" label="Analytics" />
      <NavTab icon="settings" label="Settings" />
    </NavTabs>
  </Page>
);

/** The lit destination moves; nothing else about the row changes. */
export const AnalyticsActive = () => (
  <Page>
    <NavTabs>
      <NavTab icon="friends" label="Friends" />
      <NavTab icon="challenges" label="Challenges" />
      <NavTab icon="projects" label="Quests" />
      <NavTab icon="activities" label="Activities" />
      <NavTab icon="analytics" label="Analytics" active />
      <NavTab icon="settings" label="Settings" />
    </NavTabs>
  </Page>
);
