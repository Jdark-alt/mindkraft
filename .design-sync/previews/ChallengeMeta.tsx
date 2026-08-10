import * as React from 'react';
import { ChallengeCard, ChallengeMeta } from 'mindkraft-ds';
import { Page } from './_page';

/** The dot-separated meta line, on its own. */
export const Parts = () => (
  <Page>
    <div className="ch-meta">
      <ChallengeMeta items={['Ends 12 Sep', '3 activities', 'Enforced']} />
    </div>
  </Page>
);

/** Where it belongs: under a challenge title. */
export const OnACard = () => (
  <Page>
    <ChallengeCard
      name="30 Days of Movement"
      meta={<ChallengeMeta items={['Ends 12 Sep', '3 activities']} />}
      current={12}
      target={30}
      unit="DAYS"
      percent={40}
    />
  </Page>
);
