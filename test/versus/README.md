# Versus challenges — flow tests

Drives the real `app.js` in headless Chromium against a stubbed Firestore and
walks the whole wager, both sides of it.

    node test/versus/versus.test.mjs

## Harness

Reuses `test/social/harness.mjs` — the same throwaway copy of the app with the
Firebase CDN modules remapped to the local stubs. The extra hook block exposes
`vsFetch` and `vsPaint`, which are module-private, so the board can be
repainted against a document the test mutated directly.

Because the harness never runs the real sign-in, two things need setting by
hand that the app would otherwise set for you: `window._dataOwnerUid` (without
it `canPersistUserData` refuses every write, and the create silently no-ops),
and `#appContainer`'s display, without which nothing has a layout box and
width assertions all read zero.

## What it covers

**The sender.** The opponent picker's friend-row shape; the searchable
activity picker that replaced the native `<select>`, including that filtering
narrows the list; that no per-requirement name field survives; the three-cell
stakes panel and its gold/green tones. Then the document that actually lands:
requirement names backfilled from the activity (§4), the advanced-settings
seed carrying the sender's skip-negative mode across (§6), the escrowed stake
and the debited balance.

**The board.** The hero count capped per requirement, its percentage, the
opponent bar coming out subordinate in real laid-out width, the lead readout,
and the breakdown expanding into per-activity sub-bars for both players with
the opponent's own total bar above theirs (§8).

**The receiver.** The one-sentence ask naming sender, activity, target and
duration; exactly two buttons and which is primary; the activity modal opening
seeded from the requirement's `seed`, with negative-XP mode set and the
advanced section already open; backing out of that modal returning to the
walkthrough rather than stranding you; the swap path listing their own
activities; and the review screen's stakes panel, mapping list, and the accept
that flips the challenge to active with both stakes in the pot (§7).

**The removals.** That the Challenges tab has no sub-tab row, and that the
solo-challenge and group-challenge host elements and modals are gone — a
leftover host element is how a half-finished deletion hides.
