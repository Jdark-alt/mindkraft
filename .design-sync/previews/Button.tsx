import * as React from 'react';
import { Button } from 'mindkraft-ds';
import { Page } from './_page';

/** The pair, in footer order: quiet cancel, then the blue confirm. */
export const Pair = () => (
  <Page>
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
      <Button variant="secondary">Cancel</Button>
      <Button>Save Reward</Button>
    </div>
  </Page>
);

/** Primary on its own — one per surface, and it names the action. */
export const Primary = () => (
  <Page>
    <Button>Add to schedule</Button>
  </Page>
);

/**
 * Secondary on its own — the quiet partner, used for Cancel and for any
 * action that isn't the reason the surface exists.
 *
 * There is deliberately no disabled cell: style.css defines no `:disabled`
 * rule for either variant, so a disabled button is pixel-identical to an
 * enabled one. Don't rely on `disabled` to communicate anything visually.
 */
export const Secondary = () => (
  <Page>
    <Button variant="secondary">Cancel</Button>
  </Page>
);
