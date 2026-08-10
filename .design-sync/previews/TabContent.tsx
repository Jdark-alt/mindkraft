import * as React from 'react';
import { TabContent, ActivityListItem, EmptyPlaceholder } from 'mindkraft-ds';
import { Page } from './_page';

/** The visible pane. A tab is invisible until it carries `active`. */
export const Active = () => (
  <Page>
    <TabContent>
      <ActivityListItem name="Morning Walk" xp={15} streak={4} dimension="green" />
      <ActivityListItem name="Read 20 pages" xp={20} streak={5} dimension="indigo" />
    </TabContent>
  </Page>
);

/** An all-done pane — the celebratory kind of empty, not the onboarding kind. */
export const AllDone = () => (
  <Page>
    <TabContent>
      <EmptyPlaceholder>
        <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: '-0.015em' }}>Everything's done</div>
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 6 }}>
          Four activities, four completions. Come back tomorrow.
        </div>
      </EmptyPlaceholder>
    </TabContent>
  </Page>
);
