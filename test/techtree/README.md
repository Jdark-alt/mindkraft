# Tech Tree v5 — reveal loop tests

Drives the real `app.js` in headless Chromium against a stubbed Firebase, and
asserts the §10 invariants directly rather than through the UI.

    node test/techtree/reveal.test.mjs

## Harness

Shares `test/social/harness.mjs`: it copies `index.html` (with an import map
injected into `<head>`), `app.js`, `style.css` and the stubs into a temp
directory, so the Firebase CDN modules resolve to an in-memory Firestore
supporting dotted-path updates, transactions and `array-contains` queries.
The `window.__tt*` hooks are appended to that **copy** of `app.js` — they sit
in the same module scope as the tech-tree internals the §-assertions are
about, and never exist in the repo's own `app.js`.

The suite builds and serves that harness itself. It previously assumed
something else had already done so and died on `ERR_CONNECTION_REFUSED`
before loading any app code.

## What it covers

Birth state (§3.1/§10.2), the lineage rule (§5.1), the purchase and its
persistence-before-grant ordering (§5.3/§10.4), reveal not buying access
(§1/§10.1), silhouettes leaking nothing in either view (§10.9), the
rejection fallback (§5.4/§10.5), the one-time migration and its idempotence
(§9), the regeneration gate in both directions (§6), what a regeneration
keeps (§6.1), and mastery paying exactly once with node resolution paying
nothing on top (§7/§10.8).

Two of these caught real bugs on the first run: `masteriesSinceRegen` was
being incremented at one call site while mastery could also be declared by
`ttFinishLink`'s retroactive resolve (the gate is now derived from the
activities' own timestamps, so it cannot drift), and an archived node in a
prerequisite chain locked everything behind it forever.
