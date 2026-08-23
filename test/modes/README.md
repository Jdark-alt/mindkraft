# Modes — invariant tests

Drives the real `app.js` in headless Chromium against a stubbed Firestore and
asserts the modes spec's behaviour directly, rather than through the UI.

    node test/modes/modes.test.mjs

## Harness

Reuses `test/social/harness.mjs`, which builds a throwaway copy of the app in a
temp directory with the Firebase CDN URLs remapped to local stubs. `build()`
takes an optional second block of hooks; this suite passes `hooks.js`, which is
appended to the **copy** of `app.js` and therefore sits inside the same module
scope. That is what lets the tests reach the module-private things the
invariants are actually about — the two streak passes, the offset store they
own, and the rate card — without any of it being exported into the shipped app.

Nothing in the repo's own `index.html` or `app.js` is modified.

`window.__mm.rearm()` re-arms the once-a-day guards (`lastProcessedDate` and
`modes.offsetDay`) so a test can drive several consecutive "days" inside one
page load. Nothing in the app calls it.

## What it covers

The centre of gravity is the **streak interaction**, because none of it is
visible from the UI and all of it is load-bearing.

`processStreakSystem()` is the single authoritative writer for streak and
shield state, and it **re-derives both from `completionHistory` on every
login**. Recovery and Insurance therefore cannot live inside it — they run as
additive passes on either side of the walk (`modesBeforeStreakWalk` /
`modesAfterStreakWalk`, both called from `processStreakPauses`, never from
`processStreakSystem`). The credit they grant lives in `modes.streakOffsets`,
never on the activity.

Covered there: a control case proving the walk really does break an unshielded
streak; an insured activity surviving that same history; the shields the walk
would have spent being handed back; logging still raising an insured streak;
the credit outliving the mode that granted it; and the credit being dropped
once a gap **after** the cover ended outlasts the activity's shields — the one
case where a streak has genuinely broken.

For Recovery: the ceiling read from `bestStreak` at activation rather than
stored on the activity, one bonus step per completion, no bonus at the ceiling,
never past the old peak plus one, and an undo taking the bonus back with it.

Also covered: the Berserk target's dampener (a personal best must make tomorrow
*a little* harder, not proportionally harder) and its floor on a new account;
the ±30% swing landing on the user's own XP ledger rather than a shadow one;
the Focus Window multiplier, its exclusion of perform-negative activities, and
windows that cross midnight; Stake's all-or-nothing payout and its forfeit;
both wagered modes actually ending when ended early; Habit's
completions-vs-days-elapsed pair, its pause/resume rule and the seven-day
expiry; the one-mode-at-a-time guard; and the rate card itself.

Three things this cannot cover, because they are server-side: the Firestore
rules (see `test/rules`), the mode-reminder copy decision (see
`functions/test/modes.test.js`) and the pact push trigger in
`functions/index.js`.
