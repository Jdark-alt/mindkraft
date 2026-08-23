# Tech Tree v5 — reveal loop tests

Drives the real `app.js` in headless Chromium against a stubbed Firebase, and
asserts the §10 invariants directly rather than through the UI.

    node test/techtree/reveal.test.mjs      # needs the harness below

## Harness

The suite loads `index.html` from a directory where the Firebase CDN modules
are remapped, via an import map, to local stubs — one of which is an
in-memory Firestore supporting dotted-path updates, transactions and
`array-contains` queries. Build it by copying `index.html` (with the import
map injected into `<head>`), `app.js`, `style.css` and the stubs, then
appending the `window.__tt*` test hooks to the copied `app.js`. The hooks
exist only in that copy — never in the repo's `app.js`.

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
