import * as React from 'react';
import { AppHeader } from 'mindkraft-ds';
import { Page } from './_page';

/** Mid-level, mid-progress — the state the header spends most of its life in. */
export const Default = () => (
  <Page pad={0}>
    <AppHeader level={12} xp={340} percent={68} xpToNext={160} avatarInitial="J" />
  </Page>
);

/** The alternate readout: the left slot swaps to percent every 30 seconds. */
export const PercentReadout = () => (
  <Page pad={0}>
    <AppHeader level={12} xp={340} percent={68} xpToNext={160} readout="percent" avatarInitial="J" />
  </Page>
);

/** A brand-new account: level 1, nothing banked. */
export const FirstLevel = () => (
  <Page pad={0}>
    <AppHeader level={1} xp={0} percent={0} xpToNext={50} avatarInitial="A" />
  </Page>
);

/** Deep into the game — a three-digit level, with the golden trace armed. */
export const HighLevelWithTrace = () => (
  <Page pad={0}>
    <AppHeader level={147} xp={2480} percent={92} xpToNext={220} avatarInitial="M" goldTrace />
  </Page>
);
