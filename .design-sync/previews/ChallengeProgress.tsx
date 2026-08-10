import * as React from 'react';
import { ChallengeProgress } from 'mindkraft-ds';
import { Page } from './_page';

/** Count, percent, bar. */
export const Default = () => (
  <Page>
    <ChallengeProgress current={12} target={30} unit="DAYS" percent={40} />
  </Page>
);

/** Empty, part-way, and complete. */
export const Range = () => (
  <Page>
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <ChallengeProgress current={0} target={30} unit="DAYS" percent={0} />
      <ChallengeProgress current={18} target={30} unit="DAYS" percent={60} />
      <ChallengeProgress current={30} target={30} unit="DAYS" percent={100} />
    </div>
  </Page>
);

/** No target — the legacy count-up mode just shows what's been done. */
export const CountUp = () => (
  <Page>
    <ChallengeProgress current={47} unit="completions" percent={0} />
  </Page>
);
