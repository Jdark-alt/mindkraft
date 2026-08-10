# Building with Mindkraft

Mindkraft is a dark-first life-gamification PWA. This library is a React binding
over the app's real markup: every component emits the exact class names
`style.css` already styles. There is no styling in the components themselves —
if something renders unstyled, the stylesheet isn't reaching it.

## Always wrap in `MindkraftRoot`

```tsx
<MindkraftRoot>
  <SubTabs><SubTab active>My Activities</SubTab><SubTab>Categories</SubTab></SubTabs>
  <ActivityListItem name="Morning Walk" xp={15} streak={4} dimension="green" />
</MindkraftRoot>
```

It does two things nothing else does: it renders `.app-container.active` (the
container is `display: none` without `active`, so unwrapped content is
invisible), and it sets `data-theme-mode` on the document element, which is the
only switch between the dark and light palettes. Dark is the default; pass
`theme="light"` for the light palette.

Three more containment rules, each of which silently breaks its child:

- `ActivityGridCard` **must** be inside `ActivityGrid` — the card's size comes
  entirely from the grid's 80px rows and the per-type span rules.
- `TextInput`, `TextArea` and `Select` **must** be inside `FormGroup` — the
  control styles are descendant rules of `.form-group`.
- `Modal` and `ToastStack` are `position: fixed` and cover the viewport.

## Style your own layout with tokens, never with new classes

There are **no utility classes**. Components own their class names; for the glue
between them, use the app's CSS custom properties in `style` props. Everything
below is defined in `_ds_bundle.css`:

| Job | Token |
|---|---|
| Page canvas | `--color-bg-primary` |
| Card material / recessed panel | `--surface-card`, `--surface-recessed` |
| Card edge | `--card-hairline`, `--color-border` |
| Elevation | `--shadow-card`, `--shadow-md`, `--shadow-xl` |
| Text | `--color-text-primary`, `--color-text-secondary` |
| Inputs / modals | `--color-input-bg`, `--color-modal-bg` |
| Dimension tint (set per card) | `--dim-color` |

**One colour, one job.** Adding a colour means removing one:

- `--color-progress` — interactive. CTAs, the indicator primitive. Never decorative.
- `--chip-xp-fg` (green) — rewards and positive deltas. Never warnings.
- `--chip-streak-fg` (coral) — streaks and celebration. Never urgency.
- `--chip-warn-fg` (amber) — urgency and time pressure. Never identity.
- `--color-accent-red` — destruction and negative XP. Sparingly.
- `#f5c563` (gold) — level-ups and milestones only; it has no token because it
  appears in exactly two places.

## Reuse the primitives instead of inventing state

- **Active state** is one shape everywhere: the glowing underline. `SubTabs` is
  the large form, `ModeTabs` the small one, `NavTabs` the icon-glow form. Never
  add a segmented control, a selected background, or a checkmark instead.
- **Separation** is a 1px hairline (`ToolDivider`), never a border or a boxed
  container. Visible 1px outlines are a code smell here.
- **Chips** are one pill shape with four semantic colours: `XPChip`,
  `StreakChip`, `AtRiskChip`, `MultiCountChip`. Map new states onto an existing
  job rather than adding a fifth.
- **Confirmation** is a `Toast`. `Modal` is for decisions only — routine actions
  confirm with a toast and never interrupt.
- **Emptiness** has three kinds, and `EmptyPlaceholder` copy should say which:
  onboarding (CTA + why), all-done (celebratory), eligibility (quiet, no CTA).

## Hierarchy and size

One hero element per surface; everything else demotes through size and weight,
not colour. Smaller wins — section titles are 15px, sub-tab labels 19px, card
names 14.5px, kickers 9–11px uppercase. Any digit that updates is tabular.

## Where the truth lives

- `styles.css` and its `@import` closure — `_ds_bundle.css` is the app's whole
  stylesheet; grep it before assuming a class or token exists.
- `components/<group>/<Name>/<Name>.prompt.md` — per-component API and usage.
- `guidelines/design-brief.md` — the design constitution this all derives from.

## Two gaps worth knowing

`btn-primary` / `btn-secondary` have no `:disabled` rule, so a disabled `Button`
looks identical to an enabled one — don't rely on it to communicate. And
`ActivityGridCard` renders its streak as a 🔥 emoji, which the brief's
anti-patterns list otherwise rejects; it is kept because that is what the app
ships today.
