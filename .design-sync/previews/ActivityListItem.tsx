import * as React from 'react';
import { ActivityListItem, ActivityBadge } from 'mindkraft-ds';
import { Page } from './_page';

/** The canonical row: name, XP, streak, ring. */
export const Default = () => (
  <Page>
    <ActivityListItem name="Morning Walk" xp={15} streak={4} dimension="green" />
  </Page>
);

/** A day's worth of rows, in the states they actually appear in. */
export const States = () => (
  <Page>
    <>
      <ActivityListItem name="Morning Walk" xp={15} streak={4} dimension="green" />
      <ActivityListItem name="Meditate" xp={10} streak={12} dimension="teal" state="completed" showUndo />
      <ActivityListItem name="Pushups" xp={8} streak={3} multiCount={2} dimension="olive" state="completed-multi" showUndo />
      <ActivityListItem name="Weekly Review" xp={40} dimension="indigo" state="disabled" />
    </>
  </Page>
);

/** Expanded, showing the detail badges the chevron reveals. */
export const Expanded = () => (
  <Page>
    <ActivityListItem
      name="Read 20 pages"
      xp={20}
      streak={5}
      dimension="indigo"
      expanded
      badges={
        <>
          <ActivityBadge variant="frequency">Mind › Reading</ActivityBadge>
          <ActivityBadge variant="xp">+20 XP (1.5×)</ActivityBadge>
          <ActivityBadge variant="shield">2 🛡 left</ActivityBadge>
          <ActivityBadge variant="counter">3/5 cycle</ActivityBadge>
        </>
      }
    />
  </Page>
);

/** A streak about to break: amber risk chip and the alert dot on the chevron. */
export const AtRisk = () => (
  <Page>
    <ActivityListItem
      name="Evening Journal"
      xp={12}
      streak={18}
      dimension="rose"
      atRisk
      expanded
      badges={
        <>
          <ActivityBadge variant="frequency">Mind › Reflection</ActivityBadge>
          <ActivityBadge variant="at-risk">⚠ at risk</ActivityBadge>
          <ActivityBadge variant="shield-warn">🛡 0 left!</ActivityBadge>
        </>
      }
    />
  </Page>
);

/** A negative activity — the XP reads red and the name carries no reward. */
export const Negative = () => (
  <Page>
    <ActivityListItem
      name="Doomscrolling"
      xp={-20}
      dimension="red"
      expanded
      badges={
        <>
          <ActivityBadge variant="frequency">Mind › Attention</ActivityBadge>
          <ActivityBadge variant="negative">−20 XP</ActivityBadge>
        </>
      }
    />
  </Page>
);
