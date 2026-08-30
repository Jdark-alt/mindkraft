# Navigation — invariant tests

Drives the real `index.html` + `app.js` in headless Chromium at phone size and
asserts the two things about the bottom nav that a screenshot cannot show.

    node test/nav/nav.test.mjs

## Harness

Reuses `test/social/harness.mjs`. The nav itself is not in `app.js` — it is a
self-contained inline script in `index.html` that drives the app through
`window.switchTab` / `window.switchSubTab` — so unlike the other suites this
one needs no hook block. It does need two things the real sign-in would have
done: `#loading` hidden and `#appContainer` shown, without which nothing has a
layout box and every measurement reads zero.

## What it covers

### The dead zone

`.mk-nav-shield` has two jobs. It darkens the strip of screen the nav sits in,
and it swallows taps there so a miss between nav controls cannot complete an
activity on the card underneath.

Those jobs want different heights. The gradient has to start well above the nav
or it reads as a hard edge — it is transparent at its own top and only reaches
42% opacity a third of the way down. For a while both jobs shared one height,
and the result was an **82px band of visible, ordinary-looking content that
silently refused taps**, worst on the Map where the controls sit low.

Nothing about that is visible. It is only findable by walking up from the nav's
top edge and asking, pixel by pixel, which element would actually receive a
tap — which is what these tests do, for all five phone styles plus the Ledger's
collapsed state, since each carries its own height.

The gradient's height and the tap-swallower's are asserted to stay
*deliberately different*, so a later "tidy-up" that re-merges them fails here
rather than in someone's hand.

### The theme

The five styles were built when the app was dark only, and each wrote its
surface as a literal `rgba()`. The app has a light theme, so on white the nav
stayed a black slab across the bottom of every screen. Each style's painted
surface is now read in both themes and required to actually differ, and the
active item is required to still be the accent blue on light — a selected item
that falls back to near-black reads as no selection at all.

### Touch targets, and the three that are exempt

Every live nav control is measured against a 24px floor. Controls parked at
zero height with `pointer-events: none` are skipped: those are absent, not
small, and counting them buries the real finding.

Three are deliberately below the floor and are **raised with Jerry rather than
resized here**, because each is pinned by geometry that cannot absorb the
change — `.mk-ledger-name` (its band is exactly its height), `.mk-ledger-sub`
(fixed-height row that animates open) and `.mk-spine-sub` (`fitSpine()` already
shrinks these at runtime until three names fit). They are listed by class in the
test. Anything else under the floor is a regression.

### Reduced motion

The nav is the busiest moving thing in the app — a sliding indicator in three
styles, a 1060px dial that rotates a page of labels in the Arc, the Ledger's
bands opening and closing, and a forward/back animation on every navigation.
The stylesheet honours `prefers-reduced-motion` in twenty places and the nav
was written later and honoured it in none.

### The retired flat bar

The old six-tab `.nav-tabs` bar is kept in the DOM at zero size so `app.js` can
still find its `.nav-tab` nodes to mark active. It is asserted to stay inert: if
it ever regains a box, it is a second bottom bar sitting on top of the real one.
