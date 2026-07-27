# Reminder system — deployment runbook

Rebuilds notification delivery on Cloud Scheduler + Cloud Functions, replacing
the GitHub Actions cron, and adds per-activity reminders (max 5 per user).

**Nothing here is deployed yet.** The code in this branch is written and unit
tested, but it has never run against the real Firebase project — there were no
credentials in the environment it was written in. Work through the steps below
in order; steps 1-5 are setup, step 6 is the first real test.

Until step 7, the existing GitHub Actions workflow keeps sending general
reminders exactly as it does today. Deploying steps 1-6 changes nothing for
existing users.

---

## What was built

```
Cloud Scheduler (every 1 min, real SLA — this is the fix)
        ↓
sendDueReminders          collectionGroup('reminders')
                            .where('active','==',true)
                            .where('nextSendAt','<=',now)
        ↓ per due reminder
   send Web Push → recompute nextSendAt → stamp lastSentDate
```

| Piece | Where |
|---|---|
| Scheduled sender, write trigger, create callable | `functions/index.js` |
| Timezone / next-fire maths (DST-safe, Luxon) | `functions/lib/schedule.js` |
| Web Push delivery | `functions/lib/push.js` |
| Reading activities out of the user doc | `functions/lib/activities.js` |
| Unit tests (28) | `functions/test/` |
| Security rules + index to apply by hand | `firebase-config-reference/` |
| One-time migration | `scripts/migrate-reminders.js` |
| Settings UI, timezone capture, callable client | `app.js`, `index.html`, `style.css` |
| Notification tap → deep link | `sw.js` |

Reminders live at `users/{uid}/reminders/{reminderId}` — `general` is a
singleton with a fixed doc id, activity reminders get auto-ids.

---

## Prerequisites

- Blaze plan (done).
- `npm install -g firebase-tools`, then `firebase login`.
- The three VAPID values currently in GitHub Actions secrets:
  `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CONTACT_EMAIL`.
  These must be the **same keypair** the client subscribed with — the public
  key is hardcoded at `app.js` (`VAPID_PUBLIC_KEY`, starts `BCsaPZ-4JC3l...`).
  Rotating it would invalidate every existing subscription.

```bash
firebase use life-gamification-app-b7674
```

---

## 1. Confirm the region ⚠️

Firestore triggers must run in the region hosting the database, and this repo
has never contained Firebase config, so the region in the code is a guess.

```bash
firebase firestore:databases:list
```

If the location is not `us-central1` / `nam5`, update **both**:

- `functions/index.js` → `const REGION = ...`
- `app.js` → `getFunctions(app, 'us-central1')`

They must match. A mismatch shows up as a CORS error on the callable, which is
a confusing way to find out.

---

## 2. Move the VAPID keys into Secret Manager

```bash
firebase functions:secrets:set VAPID_PUBLIC_KEY
firebase functions:secrets:set VAPID_PRIVATE_KEY
firebase functions:secrets:set VAPID_CONTACT_EMAIL
```

Paste each value when prompted. Verify:

```bash
firebase functions:secrets:access VAPID_PUBLIC_KEY
```

Leave the GitHub Actions secrets alone — the old workflow still needs them
until cutover.

---

## 3. Deploy the functions

```bash
cd functions && npm install && npm test && cd ..
firebase deploy --only functions
```

Deploys three functions:

- `sendDueReminders` — scheduled, every 1 minute
- `onReminderWrite` — Firestore trigger on the reminders subcollection
- `createActivityReminder` — HTTPS callable

First deploy will prompt to enable Cloud Scheduler, Cloud Build, Artifact
Registry and Eventarc if they aren't already on.

At this point the sender runs every minute and finds nothing, because no
reminder documents exist yet.

---

## 4. Create the composite index

The due-query needs a **collection-group** index on `(active, nextSendAt)`.

Easiest path: after step 3, watch the logs for a minute —

```bash
firebase functions:log --only sendDueReminders
```

A `FAILED_PRECONDITION` error will contain a direct "create index" link. Click
it, confirm, wait for it to build (a minute or two on an empty collection).

Otherwise create it manually in the Console → Firestore → Indexes →
Composite → Add, using the values in
`firebase-config-reference/firestore.indexes.json`. **Query scope must be
"Collection group"** — a collection-scoped index will not serve the query.

---

## 5. Apply the security rules

Console → Firestore → Rules. Paste the `match` block from
`firebase-config-reference/reminders.rules` **into your existing ruleset** and
publish.

Do not replace the whole ruleset with that file — it only covers reminders,
and everything protecting `publicProfiles`, `friendRequests`, the group
collections and so on lives only in the Console. That's also why the file
isn't wired into `firebase.json`: a `firebase deploy` must never overwrite
rules this repo doesn't have a copy of.

The rules allow a client to create only the `general` singleton. Activity
reminders are forced through `createActivityReminder`, which is where the
5-per-user cap is enforced.

---

## 6. Test

### 6a. Emulator (optional but recommended)

```bash
cd functions
firebase emulators:start --only functions,firestore
```

In the emulator UI, create `users/<uid>/reminders/test` with `type: "general"`,
`localTime` a minute or two ahead in your zone, `timezone: "Asia/Kolkata"`,
`active: true`, `nextSendAt: null`. Confirm `onReminderWrite` fills in
`nextSendAt`, and that `sendDueReminders` picks it up and rolls it to tomorrow.

Note the emulator has no push endpoint, so the send itself will fail — you're
checking the scheduling, not delivery.

### 6b. Timezone edge cases

Already covered by unit tests (`cd functions && npm test`) — US spring-forward
including a reminder inside the missing hour, fall-back ambiguity, and a
mid-day zone change. India has no DST, so these could not have been caught by
testing with your own account only.

### 6c. Idempotency

Fire the scheduler twice in quick succession:

```bash
gcloud scheduler jobs run firebase-schedule-sendDueReminders-us-central1 --location=us-central1
```

The second run should log a skip, not a second send. `lastSentDate` holds the
local date, so it also guards against a retry crossing UTC midnight.

### 6d. Real delivery, your account only

```bash
cd scripts && npm install
FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" \
  node migrate-reminders.js --only=<your-uid> --activate
```

Set the time a couple of minutes out and confirm it arrives within seconds of
the target, rather than the 30-45 minutes of drift the old cron had.

Activity reminders can be tested from the UI straight away — Settings › Daily
Reminder › Activity Reminders. They aren't gated behind the cutover flag,
because the old system knows nothing about them and there's no double-send to
avoid.

---

## 7. Cutover

Only once 6d has looked right for a few days.

**1. Migrate everyone (still inactive):**

```bash
cd scripts
FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" node migrate-reminders.js --dry-run
FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" node migrate-reminders.js
```

Reads `pushSubscription.reminderTime` off each user doc and creates their
`general` reminder. Idempotent — safe to re-run. It does **not** delete the old
field.

**2. Disable the old cron.** Comment out the `schedule:` trigger in
`.github/workflows/send-reminders.yml`. Keep the file for now.

**3. Activate the new one, in the same sitting:**

```bash
FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" node migrate-reminders.js --activate
```

**4. Flip the client flag** so newly-saved general reminders are created
active: `app.js` → `REMINDERS_V2_GENERAL_ACTIVE = true`. Commit, push, and bump
`CACHE_VERSION` in `sw.js` so clients pick it up.

Order matters — steps 2 and 3 are what prevent double-sends, so don't leave a
gap between them.

**Watch:** `firebase functions:log --only sendDueReminders`. The
`Timezone fallback used` warning counts users with no IANA zone yet; it should
fall steadily as clients backfill on next open. If it isn't falling, the
client-side capture isn't running.

---

## 8. Cleanup (one release cycle later)

- Delete `.github/workflows/send-reminders.yml` and `scripts/send-reminders.js`.
- Remove the `reminderTime` / `tzOffset` fields from `pushSubscription` (the
  writes in `subscribeToPush`), and drop `users/{uid}.reminderLastSent`.
- Remove the `REMINDERS_V2_GENERAL_ACTIVE` flag and its branches.
- Delete `scripts/migrate-reminders.js`.

---

## Rollback

Before cutover: nothing to undo — the old cron is still the live path. Set any
`general` docs back to `active: false` if the new sender misbehaves.

After cutover: re-enable the `schedule:` trigger in the workflow, and
deactivate the new reminders:

```bash
FIREBASE_SERVICE_ACCOUNT="$(cat serviceAccount.json)" node migrate-reminders.js --deactivate
```

...or just `firebase functions:delete sendDueReminders`. The old
`pushSubscription.reminderTime` field is left intact through step 8 precisely
so this stays possible.

---

## Where the implementation departs from the spec

Six things in the spec didn't match the codebase. Each is called out here
rather than silently worked around.

**1. Delivery is Web Push + VAPID, not FCM** (spec §0.2, §5.3). The spec's send
implementation assumed `admin.messaging()`. The client subscribes via
`PushManager.subscribe()` and the old script used the `web-push` library, so
the Cloud Function does too.

**2. Activities are not documents** (spec §0.6, §5.4). The entire app state is
one `users/{uid}` document; activities are nested
`dimensions[].paths[].activities[]` with client-generated `Date.now()` ids, and
there's no archived flag. So `createActivityReminder` validates `activityId` by
walking the user doc rather than reading an activity document, and the picker
lists everything in the tree. Activities have no emoji field, so the
emoji-as-icon convention in §6 doesn't apply.

**3. The reminder time was nested, not top-level** (spec §0.1). It's
`users/{uid}.pushSubscription.reminderTime`, with `reminderLastSent` on the
user doc as the idempotency guard. The migration reads that path.

**4. A timezone offset was already stored** (spec §0.5) — 
`pushSubscription.tzOffset`, from `getTimezoneOffset()`. An offset can't be
reversed into an IANA zone (several zones share any offset and differ on DST),
so migrated docs get `timezone: null` and rely on the documented fallback until
the client backfills the real zone.

**5. No `onUpdate` trigger on `users/{uid}` for timezone changes** (spec §4.3).
Deliberate. That document holds the whole app state and is rewritten on nearly
every interaction, so a trigger there would fire constantly and ship the entire
document to a function each time — for a field that changes maybe twice a year.
The client detects the change anyway and rules let it write its own reminders,
so it updates them directly; `onReminderWrite` then recomputes `nextSendAt`
exactly as it would have. Same outcome, no hot trigger.

**6. `nextSendAt` is rolled forward on every path, not just on send** (spec
§5.3). The spec's pseudocode `continue`s past the idempotency guard without
touching `nextSendAt`, which would leave that document permanently matching the
due-query and re-read it every minute forever. Skips and failures roll forward
too.

Two smaller notes:

- The cap is enforced in **three** places: the callable (a transaction, so two
  rapid taps can't both slip through), `onReminderWrite` as a backstop (rules
  let a client flip `active` directly, which could otherwise exceed 5), and the
  client for a clean error message.
- `clearReminder()` no longer unconditionally tears down the push
  subscription — activity reminders are delivered over the same subscription,
  so clearing the general reminder would have silently killed them.

## Known limitations

- **One device per user.** `pushSubscription` is a single map, so a user gets
  reminders on whichever device subscribed most recently. Pre-existing, and
  out of scope per spec §11.
- **Stale-subscription cleanup can be clobbered.** When the sender clears a
  dead subscription, a client with the old value in memory can write it back on
  its next save, since `saveUserData()` does a full `setDoc()` overwrite. The
  old script had the same race; it self-corrects on the next 404/410.
- **Cap toggle race.** Flipping `active` on past the cap is caught by the
  client first and the trigger second, so the switch may visibly snap back in
  the rare case the client check is bypassed.
