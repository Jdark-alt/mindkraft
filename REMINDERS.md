# Reminders

Daily reminders and per-activity reminders, delivered by Cloud Functions.

Replaced the GitHub Actions cron, which had no execution-time guarantee —
jobs queued against shared runners and drifted 30-45+ minutes, worst during
exactly the morning and evening windows reminders land in.

## How it works

```
Cloud Scheduler (every 1 minute — real SLA, this is the fix)
        ↓
sendDueReminders     reminders where active == true AND nextSendAt <= now
        ↓ for each
   send Web Push  →  recompute nextSendAt  →  stamp lastSentDate
```

Each reminder stores its own IANA timezone, captured from the user's device
(`Intl.DateTimeFormat().resolvedOptions().timeZone`). The next fire time is
precomputed as a UTC timestamp whenever a reminder is created, edited, or
fires — so the per-minute job is a single indexed range query and does no
timezone maths at all. Cost scales with reminders due per minute, not with
how many users or timezones exist.

A user in Tokyo and a user in Mumbai both asking for 08:00 get different UTC
instants, both correct. Travel is handled on next app open: the client
notices the zone changed, rewrites its reminder docs, and the trigger
recomputes.

## Data

`users/{uid}/reminders/{reminderId}` — `general` is a singleton with a fixed
doc id; activity reminders get auto-ids, max 5 active per user.

```
type          "general" | "activity"
activityId    string | null
activityName  string | null      denormalized; re-resolved at send time
localTime     "HH:mm"            24-hour
timezone      IANA, e.g. "Asia/Kolkata"
active        boolean
nextSendAt    Timestamp          UTC — indexed, drives the due query
lastSentDate  "YYYY-MM-DD"       in the user's local zone; idempotency guard
```

## Files

| | |
|---|---|
| `functions/index.js` | the three functions |
| `functions/lib/schedule.js` | timezone / next-fire maths (Luxon) |
| `functions/lib/push.js` | Web Push delivery |
| `functions/lib/activities.js` | reading activities out of the user doc |
| `functions/test/` | 28 unit tests |
| `firestore.indexes.json` | composite index, deployed automatically |
| `firestore-reminders.rules` | rules snippet — **applied by hand**, see below |
| `.github/workflows/deploy-reminders.yml` | deploys on push to main |

Functions:

- **`sendDueReminders`** — scheduled every minute. Groups due reminders by
  user so the (large) user document is read once per batch.
- **`onReminderWrite`** — recomputes `nextSendAt` when the time, zone or
  active flag changes. Also backstops the 5-reminder cap.
- **`createActivityReminder`** — callable. Cap and `activityId` validation
  happen server-side, in a transaction.

## Deployment

Automatic. Pushing to `main` with changes under `functions/` runs
`.github/workflows/deploy-reminders.yml`, which runs the tests, then deploys
the functions and the Firestore index.

Requires three repo secrets — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`,
`VAPID_CONTACT_EMAIL` (written into the function's environment at deploy
time) — and `FIREBASE_SERVICE_ACCOUNT` with permission to deploy.

**Security rules are never deployed from CI.** They live in the Firebase
Console and this repo has no copy of them, so deploying would wipe the rules
protecting profiles, friends and groups. Apply `firestore-reminders.rules`
by hand, once, merging it into the existing ruleset.

## Notes

- Delivery is raw **Web Push + VAPID**, not FCM. The VAPID public key is
  hardcoded in `app.js` and must match the `VAPID_PUBLIC_KEY` secret —
  changing the pair invalidates every existing subscription.
- The **tech tree worker** (`scripts/generate-tech-tree.js`) sends its "your
  map is ready" push over the same `users/{uid}.pushSubscription` field and
  the same VAPID keys. That's why the subscription is never torn down when a
  reminder is switched off, and why the VAPID secrets are still needed.
- **Activities are not documents.** They're nested arrays inside the single
  `users/{uid}` document (`dimensions[].paths[].activities[]`), so
  `activityId` is validated by walking that tree. Reminders live in a
  subcollection specifically because `saveUserData()` does a full `setDoc()`
  overwrite of the user doc, which would clobber anything the server wrote
  at the top level.
- `nextSendAt` rolls forward on **every** path — sent, skipped, or failed.
  A reminder that only advanced on success would stay permanently due and be
  re-read every minute forever.
- One device per user: `pushSubscription` is a single map, so reminders
  arrive on whichever device subscribed most recently.
