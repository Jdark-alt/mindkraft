'use strict';

// ══════════════════════════════════════════════════════════════════════════
// Mindkraft reminder delivery — Cloud Functions (2nd gen)
// ══════════════════════════════════════════════════════════════════════════
//
// Replaced a GitHub Actions cron, which had no execution-time SLA and
// drifted 30-45+ minutes under load. Cloud Scheduler has a real guarantee.
//
// Design: nextSendAt is precomputed in UTC whenever a reminder is created,
// edited, or fires. The per-minute job is then a single indexed range query
// — cost scales with reminders due per minute, not total user count.
//
// Delivery is raw Web Push + VAPID (not FCM) — see lib/push.js.
// Activities live nested inside the users/{uid} doc — see lib/activities.js.

const { initializeApp } = require('firebase-admin/app');
const { getFirestore, Timestamp, FieldValue } = require('firebase-admin/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');

const {
    MAX_ACTIVITY_REMINDERS,
    isValidLocalTime,
    isValidTimezone,
    resolveTimezone,
    normalizeTimezone,
    computeNextSendDate,
    getLocalDateString,
} = require('./lib/schedule');

const { findActivity, resolveActivityName } = require('./lib/activities');

const {
    configureWebPush,
    isUsableSubscription,
    buildPayload,
    sendPush,
} = require('./lib/push');

initializeApp();
const db = getFirestore();

// VAPID credentials arrive as runtime environment variables. The deploy
// workflow writes functions/.env from the repo's GitHub secrets, and the
// Firebase CLI turns that into the deployed function's environment.
//
// Deliberately not Secret Manager: that would need extra IAM roles and an
// interactive CLI step, and this project deploys entirely from CI.

// ⚠️ CHECK THIS BEFORE THE FIRST DEPLOY.
// Firestore triggers must run in the region hosting the database, and this
// repo contains no Firebase config to read it from, so it is a best guess:
// us-central1 is what a project gets when the database is created without an
// explicit location choice (nam5/us-central). Confirm with
//   firebase firestore:databases:list
// and change this one constant if it says otherwise. See REMINDERS.md.
const REGION = 'us-central1';

// Ceiling on reminders handled in a single minute. Well above realistic
// volume; exists so a runaway backlog degrades gracefully instead of
// blowing the function's memory or timeout.
const MAX_DUE_PER_RUN = 500;

// ── Helpers ───────────────────────────────────────────────────────────────

function nextSendTimestamp(localTime, timezone, fromDate) {
    return Timestamp.fromDate(computeNextSendDate(localTime, timezone, fromDate));
}

/**
 * Roll a reminder forward to its next occurrence.
 *
 * Called on EVERY path out of the sender — sent, skipped, or failed. This
 * matters: the spec's pseudocode `continue`s past the idempotency guard
 * without touching nextSendAt, which would leave the document permanently
 * matching the due-query and re-read it every single minute forever.
 */
async function rollForward(ref, reminder, timezone, extra, fromDate) {
    const update = Object.assign(
        { nextSendAt: nextSendTimestamp(reminder.localTime, timezone, fromDate), updatedAt: FieldValue.serverTimestamp() },
        extra || {}
    );
    await ref.update(update);
}

// ══════════════════════════════════════════════════════════════════════════
// sendDueReminders — the scheduled sender (spec §5.3)
// ══════════════════════════════════════════════════════════════════════════

exports.sendDueReminders = onSchedule(
    {
        // "every 1 minutes" fires on a fixed interval, so the timeZone here is
        // only about when the cron string is interpreted — irrelevant at this
        // cadence. Per-user local times are handled entirely by nextSendAt.
        schedule: 'every 1 minutes',
        timeZone: 'Etc/UTC',
        region: REGION,
        memory: '256MiB',
        timeoutSeconds: 120,
        retryCount: 0,
    },
    async () => {
        configureWebPush({
            publicKey: process.env.VAPID_PUBLIC_KEY,
            privateKey: process.env.VAPID_PRIVATE_KEY,
            contactEmail: process.env.VAPID_CONTACT_EMAIL,
        });

        const now = Timestamp.now();
        const due = await db
            .collectionGroup('reminders')
            .where('active', '==', true)
            .where('nextSendAt', '<=', now)
            .limit(MAX_DUE_PER_RUN)
            .get();

        if (due.empty) return;

        // Group by owner. A user with several reminders due in the same minute
        // would otherwise cause repeated reads of the same users/{uid} doc —
        // and that document holds the user's entire app state, so it is large.
        const byUser = new Map();
        for (const snap of due.docs) {
            const uid = snap.ref.parent.parent.id;
            if (!byUser.has(uid)) byUser.set(uid, []);
            byUser.get(uid).push(snap);
        }

        const outcomes = await Promise.allSettled(
            Array.from(byUser.entries()).map(([uid, snaps]) => processUser(uid, snaps, now))
        );

        const totals = { sent: 0, skipped: 0, failed: 0, fallbackTimezone: 0 };
        for (const outcome of outcomes) {
            if (outcome.status === 'fulfilled') {
                totals.sent += outcome.value.sent;
                totals.skipped += outcome.value.skipped;
                totals.failed += outcome.value.failed;
                totals.fallbackTimezone += outcome.value.fallbackTimezone;
            } else {
                totals.failed += 1;
                logger.error('User batch failed', { error: String(outcome.reason) });
            }
        }

        logger.info('sendDueReminders complete', Object.assign({ due: due.size, users: byUser.size }, totals));

        // Spec §4.2 — this should trend to zero as clients backfill their zone.
        if (totals.fallbackTimezone > 0) {
            logger.warn('Timezone fallback used', { count: totals.fallbackTimezone });
        }
    }
);

/** Handle every due reminder belonging to one user, on a single user-doc read. */
async function processUser(uid, snaps, now) {
    const stats = { sent: 0, skipped: 0, failed: 0, fallbackTimezone: 0 };

    const userSnap = await db.collection('users').doc(uid).get();
    const userData = userSnap.exists ? userSnap.data() : null;
    const subscription = userData ? userData.pushSubscription : null;

    // Once a user's subscription is proven dead we stop hammering it for the
    // rest of this batch and clear it exactly once.
    let subscriptionDead = false;

    for (const snap of snaps) {
        const reminder = snap.data();

        if (!isValidLocalTime(reminder.localTime)) {
            logger.error('Reminder has invalid localTime — deactivating', { uid, reminderId: snap.id, localTime: reminder.localTime });
            await snap.ref.update({ active: false, updatedAt: FieldValue.serverTimestamp() });
            stats.failed += 1;
            continue;
        }

        const zoneSource = reminder.timezone || (userData && userData.timezone) || null;
        const { timezone, usedFallback } = resolveTimezone(zoneSource);
        if (usedFallback) {
            stats.fallbackTimezone += 1;
            logger.warn('No IANA timezone for reminder, using fallback', { uid, reminderId: snap.id });
        }

        const nowDate = now.toDate();
        const todayLocal = getLocalDateString(timezone, nowDate);

        // Idempotency guard (spec §5.3). Roll forward regardless — see rollForward.
        if (reminder.lastSentDate === todayLocal) {
            logger.debug('Already sent today, rolling forward', { uid, reminderId: snap.id });
            await rollForward(snap.ref, reminder, timezone, null, nowDate);
            stats.skipped += 1;
            continue;
        }

        // Re-resolve the activity name at send time so a rename is reflected,
        // and so a deleted activity retires its reminder instead of firing
        // forever under a stale denormalized name.
        let activityName = null;
        if (reminder.type === 'activity') {
            activityName = resolveActivityName(userData, reminder.activityId);
            if (!activityName) {
                logger.info('Activity no longer exists — deactivating its reminder', { uid, reminderId: snap.id, activityId: reminder.activityId });
                await snap.ref.update({ active: false, updatedAt: FieldValue.serverTimestamp() });
                stats.skipped += 1;
                continue;
            }
        }

        if (subscriptionDead || !isUsableSubscription(subscription)) {
            logger.info('No usable push subscription — skipping send', { uid, reminderId: snap.id });
            await rollForward(snap.ref, reminder, timezone, null, nowDate);
            stats.skipped += 1;
            continue;
        }

        const result = await sendPush(subscription, buildPayload(reminder, activityName));

        if (result.ok) {
            const extra = { lastSentDate: todayLocal };
            // Keep the denormalized copy honest for the settings list.
            if (activityName && activityName !== reminder.activityName) extra.activityName = activityName;
            await rollForward(snap.ref, reminder, timezone, extra, nowDate);
            stats.sent += 1;
            continue;
        }

        stats.failed += 1;
        logger.error('Push failed', { uid, reminderId: snap.id, statusCode: result.statusCode, message: result.message });

        if (result.dead) {
            subscriptionDead = true;
            try {
                await db.collection('users').doc(uid).update({ pushSubscription: FieldValue.delete() });
                logger.info('Cleared dead push subscription', { uid });
            } catch (err) {
                logger.warn('Could not clear dead subscription', { uid, error: String(err) });
            }
        }

        // Failed sends still roll forward — a transient push-service outage
        // must not turn into a same-minute retry loop for the next 24 hours.
        await rollForward(snap.ref, reminder, timezone, null, nowDate);
    }

    return stats;
}

// ══════════════════════════════════════════════════════════════════════════
// onReminderWrite — keep nextSendAt in sync, and backstop the cap (spec §5.2)
// ══════════════════════════════════════════════════════════════════════════

exports.onReminderWrite = onDocumentWritten(
    {
        document: 'users/{uid}/reminders/{reminderId}',
        region: REGION,
        memory: '256MiB',
    },
    async (event) => {
        const afterSnap = event.data && event.data.after;
        if (!afterSnap || !afterSnap.exists) return; // deleted — nothing to do

        const after = afterSnap.data();
        const beforeSnap = event.data.before;
        const before = beforeSnap && beforeSnap.exists ? beforeSnap.data() : null;
        const { uid, reminderId } = event.params;

        // Only the fields that actually determine the fire time matter here.
        // Without this check the function's own nextSendAt write — and every
        // write the sender makes — would retrigger it in a loop.
        const relevantChanged =
            !before ||
            before.localTime !== after.localTime ||
            before.timezone !== after.timezone ||
            before.active !== after.active;

        // An active reminder with no schedule can never fire — the due-query
        // is a range on nextSendAt, so a null drops out of it silently. Catch
        // that regardless of what changed: the client writes null on create
        // (it has no timezone library) and this is what fills it in.
        const missingSchedule = after.active && !after.nextSendAt;

        if (!relevantChanged && !missingSchedule) return;

        if (!isValidLocalTime(after.localTime)) {
            logger.error('Rejecting reminder with invalid localTime', { uid, reminderId, localTime: after.localTime });
            if (after.active) await afterSnap.ref.update({ active: false, updatedAt: FieldValue.serverTimestamp() });
            return;
        }

        // Cap backstop. Rules permit a client to flip `active` directly, so the
        // callable's check alone isn't airtight — an inactive reminder toggled
        // back on could push the user past 5. Enforce it here too (spec §5.2).
        const turningOn = after.active && (!before || !before.active);
        if (turningOn && after.type === 'activity') {
            const siblings = await afterSnap.ref.parent
                .where('type', '==', 'activity')
                .where('active', '==', true)
                .get();
            const others = siblings.docs.filter((d) => d.id !== afterSnap.id).length;
            if (others >= MAX_ACTIVITY_REMINDERS) {
                logger.warn('Activity reminder cap exceeded — forcing back to inactive', { uid, reminderId, others });
                await afterSnap.ref.update({ active: false, updatedAt: FieldValue.serverTimestamp() });
                return;
            }
        }

        // Inactive reminders keep whatever nextSendAt they had; the due-query
        // filters on active anyway, and it gets recomputed on reactivation.
        if (!after.active) return;

        const next = nextSendTimestamp(after.localTime, after.timezone);

        // Skip a no-op write (e.g. the callable already set the right value on
        // create, or a zone change that resolves to the same offset).
        if (after.nextSendAt && Math.abs(after.nextSendAt.toMillis() - next.toMillis()) < 60000) return;

        const update = { nextSendAt: next, updatedAt: FieldValue.serverTimestamp() };

        // A user who moves the time to later today expects it to fire today,
        // even if today's original slot already went out.
        if (before && before.localTime !== after.localTime) update.lastSentDate = null;

        await afterSnap.ref.update(update);
        logger.info('Recomputed nextSendAt', { uid, reminderId, nextSendAt: next.toDate().toISOString() });
    }
);

// ══════════════════════════════════════════════════════════════════════════
// createActivityReminder — HTTPS callable (spec §5.4)
// ══════════════════════════════════════════════════════════════════════════
//
// Creation of activity reminders goes through here rather than a direct
// client write so the 5-per-user cap and the activityId check happen
// server-side, and the client gets a synchronous error instead of a
// create-then-delete round trip.

exports.createActivityReminder = onCall(
    { region: REGION, memory: '256MiB' },
    async (request) => {
        if (!request.auth || !request.auth.uid) {
            throw new HttpsError('unauthenticated', 'You must be signed in to set a reminder.');
        }
        const uid = request.auth.uid;
        const data = request.data || {};
        const activityId = data.activityId != null ? String(data.activityId) : '';
        const localTime = data.localTime;

        if (!activityId) {
            throw new HttpsError('invalid-argument', 'An activity is required.');
        }
        if (!isValidLocalTime(localTime)) {
            throw new HttpsError('invalid-argument', 'Time must be in HH:mm 24-hour format.');
        }

        const userRef = db.collection('users').doc(uid);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
            throw new HttpsError('not-found', 'User profile not found.');
        }
        const userData = userSnap.data();

        // Activities are nested in the user doc, so "does this belong to the
        // caller" is implicit — we only ever look inside their own document.
        const found = findActivity(userData, activityId);
        if (!found) {
            throw new HttpsError('not-found', 'That activity no longer exists.');
        }
        const activityName = (found.activity.name || '').trim() || 'Activity';

        // Prefer the zone the client just observed; fall back to the stored one.
        const clientZone = typeof data.timezone === 'string' && isValidTimezone(data.timezone) ? data.timezone : null;
        const timezone = normalizeTimezone(clientZone || userData.timezone);

        const remindersRef = userRef.collection('reminders');
        const newRef = remindersRef.doc();

        // Transaction so two rapid taps can't both slip past the cap check.
        await db.runTransaction(async (tx) => {
            const existing = await tx.get(remindersRef.where('type', '==', 'activity'));

            let activeCount = 0;
            for (const doc of existing.docs) {
                const r = doc.data();
                if (r.active) activeCount += 1;
                if (String(r.activityId) === activityId) {
                    throw new HttpsError('already-exists', 'That activity already has a reminder.');
                }
            }
            if (activeCount >= MAX_ACTIVITY_REMINDERS) {
                throw new HttpsError('resource-exhausted', 'Reminder limit reached (' + MAX_ACTIVITY_REMINDERS + ' max)');
            }

            tx.set(newRef, {
                type: 'activity',
                activityId,
                activityName,
                localTime,
                timezone,
                active: true,
                nextSendAt: nextSendTimestamp(localTime, timezone),
                lastSentDate: null,
                createdAt: FieldValue.serverTimestamp(),
                updatedAt: FieldValue.serverTimestamp(),
            });
        });

        logger.info('Created activity reminder', { uid, reminderId: newRef.id, activityId });
        return { id: newRef.id, activityId, activityName, localTime, timezone, active: true };
    }
);
