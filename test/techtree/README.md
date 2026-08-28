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
(§9), all three regeneration gates — mastery, Grit and the once-a-month
clock (§6) — a failed weave costing nothing, and mastery paying exactly once
with node resolution paying nothing on top (§7/§10.8).

It also drives the Map's own screens, since those are where the workflow
revision landed: the intro screen carrying no standing activity-count
requirement, a typed goal registering from the first keystroke rather than
only from the DOM, the node sheet having no per-node "revise the AI" path
left, and Branch opening as a single-goal chain — no tier headings, a spine,
each locked node stating in full what opens it.

The generation callable itself is not exercised here: the harness stubs
`httpsCallable`, so a weave from these tests is always the FAILED path, which
is exactly what the "costs nothing" assertions want. The weaver's own gates
and materializer are unit-tested server-side in
`functions/test/web-weaver.test.js`.

Two of these caught real bugs on the first run: `masteriesSinceRegen` was
being incremented at one call site while mastery could also be declared by
`ttFinishLink`'s retroactive resolve (the gate is now derived from the
activities' own timestamps, so it cannot drift), and an archived node in a
prerequisite chain locked everything behind it forever.
