import * as React from 'react';
import { SubTabs, SubTab, SubTabContent, ActivityListItem } from 'mindkraft-ds';
import { Page } from './_page';

/** The pane the lit sub-tab reveals. */
export const WithSubTabs = () => (
  <Page>
    <SubTabs>
      <SubTab active>My Activities</SubTab>
      <SubTab>Categories</SubTab>
    </SubTabs>
    <SubTabContent>
      <ActivityListItem name="Morning Walk" xp={15} streak={4} dimension="green" />
      <ActivityListItem name="Pushups" xp={8} streak={3} multiCount={2} dimension="olive" state="completed-multi" />
    </SubTabContent>
    <SubTabContent active={false}>
      <ActivityListItem name="Hidden pane" xp={0} />
    </SubTabContent>
  </Page>
);
