import * as React from 'react';
import { NavTabs, NavTab } from 'mindkraft-ds';
import { Page } from './_page';

/** Lit next to unlit — the active tab glows, it does not gain a background. */
export const ActiveAndIdle = () => (
  <Page>
    <NavTabs>
      <NavTab icon="activities" label="Activities" active />
      <NavTab icon="analytics" label="Analytics" />
    </NavTabs>
  </Page>
);

/** All six icons the app ships, so you can see the set at a glance. */
export const EveryIcon = () => (
  <Page>
    <NavTabs>
      <NavTab icon="friends" label="Friends" />
      <NavTab icon="challenges" label="Challenges" />
      <NavTab icon="projects" label="Quests" />
      <NavTab icon="activities" label="Activities" />
      <NavTab icon="analytics" label="Analytics" />
      <NavTab icon="settings" label="Settings" />
    </NavTabs>
  </Page>
);
