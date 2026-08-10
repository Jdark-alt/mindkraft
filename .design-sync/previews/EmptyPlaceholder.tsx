import * as React from 'react';
import { EmptyPlaceholder, ToolbarAddButton } from 'mindkraft-ds';
import { Page } from './_page';

const title: React.CSSProperties = { fontSize: 15, fontWeight: 600, letterSpacing: '-0.015em' };
const sub: React.CSSProperties = { fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 6, lineHeight: 1.5 };

/** Onboarding empty — the user has no data yet, so it carries the first action. */
export const Onboarding = () => (
  <Page>
    <EmptyPlaceholder>
      <div style={title}>No activities yet</div>
      <div style={sub}>Add the first thing you want to do every day. You can change it later.</div>
      <div style={{ marginTop: 14, display: 'flex', justifyContent: 'center' }}>
        <ToolbarAddButton label="Add activity" />
      </div>
    </EmptyPlaceholder>
  </Page>
);

/** All-done empty — a reward state, so it reads as celebration, not absence. */
export const AllDone = () => (
  <Page>
    <EmptyPlaceholder>
      <div style={title}>Everything's done</div>
      <div style={sub}>Six activities, six completions. Come back tomorrow.</div>
    </EmptyPlaceholder>
  </Page>
);

/** Eligibility empty — data exists, none applies right now. Quiet, no CTA. */
export const NothingScheduled = () => (
  <Page>
    <EmptyPlaceholder>
      <div style={title}>Nothing scheduled today</div>
      <div style={sub}>Your weekly activities are back on Monday.</div>
    </EmptyPlaceholder>
  </Page>
);
