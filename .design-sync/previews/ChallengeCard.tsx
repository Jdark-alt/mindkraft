import * as React from 'react';
import { ChallengeCard, ChallengeMeta } from 'mindkraft-ds';
import { Page } from './_page';

/** An active challenge, part-way through. */
export const Active = () => (
  <Page>
    <ChallengeCard
      name="30 Days of Movement"
      description="Move every day, however briefly. Rest days count if you stretch."
      meta={<ChallengeMeta items={['Ends 12 Sep', '3 activities']} />}
      current={12}
      target={30}
      unit="DAYS"
      percent={40}
    />
  </Page>
);

/** Every target met — the button becomes "Claim bonus". */
export const ReadyToClaim = () => (
  <Page>
    <ChallengeCard
      name="Read 10 Books"
      description="A book a fortnight, all year."
      meta={<ChallengeMeta items={['Ends 31 Dec', '1 activity']} />}
      current={10}
      target={10}
      unit="BOOKS"
      percent={100}
      state="targets"
      enforced
    />
  </Page>
);

/** Finished and failed — both drop the edit control and offer "Take again". */
export const Closed = () => (
  <Page>
    <ChallengeCard
      name="Dry January"
      meta={<ChallengeMeta items={['Completed 31 Jan']} />}
      current={31}
      target={31}
      unit="DAYS"
      percent={100}
      state="completed"
    />
    <div style={{ height: 12 }} />
    <ChallengeCard
      name="5AM Club"
      meta={<ChallengeMeta items={['Ended 14 Mar']} />}
      current={8}
      target={30}
      unit="DAYS"
      percent={27}
      state="failed"
    />
  </Page>
);

/** The count-up mode, with no target to measure against. */
export const CountUp = () => (
  <Page>
    <ChallengeCard
      name="Any Activity Streak"
      meta={<ChallengeMeta items={['Started 1 Aug']} />}
      current={47}
      unit="completions"
      percent={0}
    />
  </Page>
);
