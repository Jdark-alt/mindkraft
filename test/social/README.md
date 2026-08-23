# Friends, gifting & leaderboard payouts — invariant tests

Drives the real `app.js` in headless Chromium against a stubbed Firestore and
asserts the gifting spec's §10 invariants directly, rather than through the UI.

    node test/social/social.test.mjs

## Harness

`harness.mjs` builds a throwaway copy of the app in a temp directory: the
Firebase CDN URLs are remapped by an import map to the local stubs
(`stub-firestore.js`, `stub-auth.js`), and a `window.__t` hook block is
appended to the **copy** of `app.js`. The hooks live inside the same module
scope as the app, so the tests can reach the module-private state the
invariants are actually about — the silent gift queue, the ledger buffer, the
retry-stable id map — without any of it being exported into the shipped app.
Nothing in the repo's own `index.html` or `app.js` is modified.

The Firestore stub is an in-memory path→document map with equality filters,
`orderBy`/`limit`, dotted-path updates, and atomic batches. `window.__fail`
holds path prefixes whose writes are refused: that is how the failure branches
(a refused gift write, an unreachable mirror) are driven without a network.

## What it covers

The half-price rule and the separate gift cap (§3.2); spend → persist → write
ordering and the refund with its `correction` entry (§3.3, invariants 1–2); the
client-generated giftId staying stable across a retry (invariant 3); names
denormalized at write time (invariant 4); a gifted shield resolving into the
pool exactly once (§4, invariant 11); the silent queue — oldest first, one gift
per completion, never past 2×, self-purchased boosts consumed first (§5.1,
invariants 5–7); the reveal modal and a thanks that carries no free text (§5.2,
§5.3, invariant 9); the mirror settling in one write on dismissal, and the login
catch-up when it could not be reached (§6); the payout table including both
worked examples from §8.3, the tie split, and the two anti-farming rules
(invariant 12); opt-in taking effect the following Monday (invariant 15); and
the tab split itself (§1).

Two things this cannot cover, because they are server-side: the Firestore rules
(see `test/rules`) and the two push triggers in `functions/index.js`.
