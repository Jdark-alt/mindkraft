# Mindkraft — Product Spec Brief: From Habit Tracker Back to Life-Gamification Engine

## Mission

Mindkraft's original premise: gamify life the way an open-world game gamifies play. Not a fixed win-condition (like most habit trackers or project managers), but a Minecraft-style open canvas — the player defines their own objective, and the game's job is to make pursuing it feel like *playing*, with instant reward (XP), visible progression (levels), and a sense of authorship over an unfolding story.

Over time the app has drifted toward being "a well-designed habit tracker + task manager." That's not wrong, but it's not the mission. This brief re-centers the app on: **giving the user an interface to plan, track, and feel their way through a life of their own design** — habits *and* projects *and* milestones *and* a long-arc vision, all visibly connected, with progression that feels like it means something rather than just decorating a checklist app.

Explicit non-goal: do not rebuild a generic habit tracker or generic project manager. Every feature should answer "does this make the user feel like the author of their life," not just "does this help them get things done."

## Current State (for context — already built, do not rebuild)

- **Practices** (called "Activities" today): repeatable actions with `frequency` (daily/weekly/biweekly/monthly/custom/occasional), streaks with a shield/grace-day system, and XP that scales with streak length via a consistency multiplier. Global level + per-"dimension" (life area) level, each with their own XP curve and progress bar.
- **Challenges**: personal aggregate-progress trackers over a set of activities with a target and optional deadline, manually confirmed complete for bonus XP. A parallel **Group Challenge** system already exists (invite codes, member nomination, shared momentum view, friends list, XP leaderboard) — this stays as-is, untouched by this brief.
- **Tech Tree**: an AI-generated (Anthropic/Gemini/Groq/NVIDIA fallback chain) DAG of nodes representing a roadmap toward a user-stated life goal, rendered as a custom SVG tree with tiers/lanes/pan-zoom. Nodes are masterable via repeated completions and link to real Activities. Currently AI-generation is constrained to only produce *recurring-practice* nodes (a "repeatability test" blocks one-off deliverable nodes), though users can already accept/reject/edit/add custom nodes and prerequisites.
- **Navigation**: a 5-tab bottom bar (Friends, Challenges, Activities, Analytics, Settings), three tabs level-gated (Analytics@3, Challenges@5, Friends@7). The Activities tab already has a working "pin your default view" pattern (a sort/filter switcher with 4 modes, one settable as default) — this is the pattern to extend, not replace.

## Design Constraints (binding on all new UI)

The repo already has a design system doc, `Mindkraft — Design Brief` (repo root). Every screen below must comply with it, not invent parallel conventions. Relevant rules this brief leans on:
- **Mode A vs Mode B**: Mode A views ("what to do now") are algorithmic and dense; Mode B views ("what does my life look like") are user-controlled and inventory-like. Today/Practices lean Mode A; Quests/Occasional browsing lean Mode B.
- **One indicator primitive** for all active/selected states (glowing underline) — the Home mode-switcher uses the same primitive as the existing sort-switcher, not a new tab-like control.
- **Modals are reserved for non-routine, interruption-worthy events** (the existing level-up modal is the precedent) — routine actions stay tap-to-done with toasts. This directly justifies the "You've been Challenged!" popup below: it's a rare social event, not routine, so a modal is correct per the brief rather than an anti-pattern.
- **Chip system has exactly four jobs** (XP/streak/warn/counter) — a friend-race badge on a Challenge card reuses the existing counter/interactive chip (blue), not a new color.
- **Density discipline**: cut redundancy → demote → cap quantity, in that order; Today-style views cap around 10 cards. This is the existing lever for the clutter problem below — no new engineering required.

## Continuity for Existing Users (no forced relearning)

- The Activities tab keeps its icon, position, and identity in the bottom nav — it is not renamed or moved, it gains a mode-switcher.
- Whatever a user has today resolves 1:1 into the new modes with zero migration step: a pinned `smart` sort → **Today** mode; a pinned `grouped`/`by-routine`/`streak-high` sort → **Practices** mode, same list, same card design. Users who never touched the sort setting keep landing on whatever `_smartDefaultSort` already picks for them today (smart if <10 activities, else grouped) — day-one visual experience is unchanged.
- **Quests** and **Occasional** appear as two additional peer entries in the same mode-switcher UI the filter panel already renders — no new gesture, menu, or screen pattern to learn.
- Nothing existing is removed or renamed in data: Challenges, Group Challenges, Friends, Analytics, Settings, and the Tech Tree behave exactly as they do today. The only additive, visible changes are: the Home mode-switcher gaining two entries, a friend-race badge on Challenge cards, and the new-login popup for challenge invites.

## Smart Surfacing / Decluttering (Today mode only — kept intentionally simple)

Problem: active users accumulate enough activities that "Today" gets cluttered with occasional/weekly items that aren't relevant right now. Rather than building a new scheduling engine, extend the existing Today's Focus bucket logic with two cheap rules:
1. **Quest time-windows surface at the top.** When a subtask is added to a Quest, the user is optionally asked for a time window (e.g. "shoot b-roll" → this weekend). If set, that subtask/linked-practice surfaces at the top of Today only during that window — reusing the existing scheduled-day/window fields activities already have (`scheduledDays`, `customDays`), not a new data concept.
2. **Occasional-frequency activities are excluded from Today by default**, living in the Occasional mode instead, unless the specific instance has been explicitly scheduled for today (matches an existing scheduled day) — so they don't compete for space in the daily-driver view.
Combined with the design brief's existing "cap at ~10 cards" rule, this keeps Today clutter-free without new infrastructure. If either rule proves hard to implement cleanly against the current data shape, drop it rather than build a bespoke scheduler — this is explicitly not meant to become its own subsystem.

## Screens (every feature gets a named screen)

1. **Home / Today mode** (existing Activities tab, default). Mode A, dense, algorithmic. Smart-bucketed list (To Do / Done / Not Now) plus quest-window surfacing, capped ~10 cards.
2. **Home / Practices mode**. Mode B, inventory-like. Today's existing grouped-by-frequency / by-routine / streak views, unchanged, just relabeled as a peer mode.
3. **Home / Quests mode** (new). List of active Quest cards: name, deadline (if any), subtask-progress bar, recurrence badge if templated. Tapping opens the Quest detail screen.
4. **Quest detail screen** (new). Checklist of subtasks (one-off or Practice-linked), each addable with an optional time-window prompt (feeds rule 1 above); a "Declare Done" CTA styled with the gold accent (genuine-milestone color per the brief); template/recurrence controls if the user wants this Quest to spawn future instances.
5. **New/Edit Quest modal** (new). Matches the existing `openChallengeModal` pattern — name, deadline, initial subtasks. Justified as non-routine per the brief's modal rule.
6. **Home / Occasional mode**. Existing occasional-activity list, demoted to an opt-in secondary mode rather than the default.
7. **Challenges / My Challenges** (existing screen, extended). Challenge cards gain an inline "vs [friend]" badge (existing blue counter-chip style) when the challenge is a friend race; no new sub-tab, no change to Group Challenges.
8. **"You've been Challenged!" modal** (new). Fires once on next login when a pending friend-challenge invite exists. Shows inviting friend, challenge name/description, and the activities it would add. Accept → runs the port-in flow (activities added as uncategorized, with the existing tech-tree-style "I already do this" mapping offered per activity) and the challenge appears in My Challenges with the friend-race badge. Decline → invite is dismissed, no state created.
9. **Settings addition**: a "Default Home View" control, reusing the existing default-sort-setting UI, now listing Today/Practices/Quests/Occasional instead of the four old sort names.

## What This Brief Adds

### 1. Quests (new entity — the missing "project" primitive)

A Quest is a finite container for a goal that isn't a repeating ritual but a thing-to-be-finished: shooting a YouTube video, planning a trip, renovating a room. Distinct from a Practice (never "done," lives on a streak) and from a Challenge (an aggregate counter over existing activities, not a deliverable).

- **Structure**: a name, an optional deadline, and a checklist of subtasks. Each subtask can be a genuine one-off task *or* a reference to an existing Practice (so "go to the gym" can be both a daily practice and a checklist item inside "Get Stage-Ready by June").
- **Completion**: user-declared "done," not a number hit. A Quest has real closure — this is the thing Challenges structurally can't offer.
- **Templating / recurrence**: a Quest can be saved as a template that spawns a fresh instance on a cadence (e.g. "Weekly Video" auto-creates a new quest-instance every week, each with its own checklist and finish line). The user's meta-metric becomes their track record of *finished instances* (e.g., "14 videos shipped"), not a static counter.
- **Where it lives in the UI**: not a new bottom-nav tab (the bar is already tight at 5, tighter as more tabs unlock by level). Instead, it's a peer mode inside the existing Home surface (see #3).

### 2. Friend-vs-Friend Challenge Races (extends Challenges, doesn't touch Group Challenges)

Any personal Challenge gets a "Challenge a Friend" action, which sends an invite.
- **On the friend's next login**, if a pending invite exists, they see a "You've been Challenged!" modal (justified per the design brief's modal rule — this is a rare social event, not a routine action) showing who challenged them, the challenge name/description, and which activities it would add.
- **Accept**: the challenge's constituent activities are added to the friend's activity list as **uncategorized**. For each one, they get the existing tech-tree-style **"I already do this"** mapping option to swap in an equivalent activity they already have instead of creating a duplicate. The challenge then appears in their Challenges list with a "vs [friend]" badge.
- **Decline**: the invite is dismissed, no activities are ported, no state is created.
- From acceptance onward, both users race to complete the same challenge first — a competitive layer distinct from the existing cooperative Group Challenge system, which is untouched.
- **UI placement**: not a new sub-tab. It's an inline badge on the existing "My Challenges" cards (reusing the existing blue counter-chip style), keeping today's Group Challenges sub-tab exactly as it is.

### 3. Home Surface Generalization (navigation fix, no new nav real estate)

The Activities tab's existing sort-switcher (today: By Routine / Today's Focus / Grouped by Frequency / Longest Streak, with a working "set as my default" mechanism) generalizes from *sort orders of one flat activity list* into **peer modes of the whole home surface**:

- **Today** — smart mixed view (existing "Today's Focus" logic).
- **Practices** — habit-first view, the primary daily-driver surface.
- **Quests** — project/deliverable tracking (the new entity from #1) gets real visibility here, since this is expected to be a heavily used surface.
- **Occasional** — deliberately demoted to a secondary, opt-in view rather than competing for the top slot; still fully trackable, just not the default anyone lands on.

Users can pin any of these four as their personal default landing view, reusing the existing default-view-setting mechanism rather than inventing a new one. This solves the "too many screens competing for attention, nav is out of space" problem without adding tabs: the five-tab bar (Friends / Challenges / Home / Analytics / Settings) stays the same shape, but "Home" becomes a fully user-configurable surface instead of one hardcoded list.

### 4. Progression That Feels Like It Means Something (design direction, not urgent build)

The philosophical core: the reward is the life being built, not the app's mechanics. But level 10 shouldn't feel the same as level 50. Direction (not yet scoped for build):
- Replace/augment purely mechanical level-up rewards with **narrative milestones** — an AI-written chapter title or short reflection generated *from the user's actual completed Quests and matured Practice streaks*, not a generic rank label.
- A **timeline/biography view**: scrolling back through levels shows what was actually built in that window (quests shipped, streaks sustained) — turning "Level 50" into a visible chronicle rather than a number.
- The Tech Tree's existing AI-written "vision" narrative is the natural place to extend this into periodic recap/reflection generation.

### 5. Tech Tree — Deferred, Noted for Later

Do not build now. Once the base app (Quests, friend races, Home surface) is solid, the Tech Tree should evolve to spawn *every* entity type as nodes — Practices, Occasional activities, Quests, and even Challenges — not just recurring-practice nodes as it does today. This requires loosening the current AI-generation "repeatability test" constraint. Explicitly out of scope for this build phase; captured here so it isn't lost.

## Build Scope Summary (in priority order)

1. Quest entity: data model, CRUD, checklist of one-off/Practice-linked subtasks, templating/recurrence, "declare done" completion.
2. Home surface generalization: extend the existing sort-switcher into Today/Practices/Quests/Occasional modes with a pinnable default, replacing the current hardcoded Activities-tab default.
3. Friend-Challenge-Race flow: share/accept, activity duplication into friend's uncategorized list, "I already do this" mapping (reuse tech-tree mapping pattern), competitive completion race, inline badge UI within My Challenges.
4. (Design-stage only, not build-ready) Narrative/biography leveling layer.
5. (Explicitly deferred) Tech Tree expansion to spawn Quests/Challenges/all node types.
