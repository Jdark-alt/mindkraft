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
const { onDocumentWritten, onDocumentCreated } = require('firebase-functions/v2/firestore');
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
const { modeReminderCopy } = require('./lib/modes');
const questComposer = require('./lib/quest-composer');
const webWeaver = require('./lib/web-weaver');
const { callModel, parseModelJson } = require('./lib/model');
const versus = require('./lib/versus');
const pact = require('./lib/pact');

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

// Must match the region hosting the Firestore database — confirmed
// asia-south1 (Mumbai) in the Firebase Console. Firestore triggers will not
// deploy against a mismatched region, and the callable would fail CORS.
//
// If the database is ever moved, change this AND the region passed to
// getFunctions() in app.js. They have to agree.
const REGION = 'asia-south1';

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
 * matters: continuing past the idempotency guard
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
// sendDueReminders — the scheduled sender
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

        // Idempotency guard. Roll forward regardless — see rollForward.
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

        // Mode reminders decide at send time whether there is anything worth
        // saying, and what. A null means "not this time" — the document rolls
        // forward and tries again tomorrow rather than being retired, because
        // "already logged today" is a temporary condition, not a dead reminder.
        let modeCopy = null;
        if (reminder.type === 'mode') {
            if (!userData) {
                await rollForward(snap.ref, reminder, timezone, null, nowDate);
                stats.skipped += 1;
                continue;
            }
            modeCopy = modeReminderCopy(reminder, userData, timezone, todayLocal, getLocalDateString);
            if (!modeCopy) {
                const modes = userData.modes || {};
                const active = modes.active || null;
                const stale = !active || String(active.id) !== String(reminder.modeId);
                if (stale) {
                    // The mode it belongs to is gone. Retire it for good.
                    logger.info('Mode no longer active — deactivating its reminder', { uid, reminderId: snap.id });
                    await snap.ref.update({ active: false, updatedAt: FieldValue.serverTimestamp() });
                } else {
                    await rollForward(snap.ref, reminder, timezone, null, nowDate);
                }
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

        const result = await sendPush(subscription, buildPayload(reminder, activityName, modeCopy));

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
// GIFT NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════
//
// Two pushes, and deliberately only two:
//
//   onGiftReceived   a gifted SHIELD lands  → tell the receiver
//   onGiftConsumed   a gifted XP boost is spent → tell the sender
//
// A gifted XP boost produces NOTHING on arrival. No push, no badge, no
// indication of any kind — the surprise is the entire mechanic, and a
// notification here would destroy it. That is why onGiftReceived filters on
// type and does not simply fire for every gift.
//
// Every name in these payloads is denormalized on the gift document at write
// time, so neither function reads another user's profile.

/**
 * Push to one uid, if they have a usable subscription. Never throws.
 *
 * Shared by every cross-account notification in this file — gifts, pacts,
 * friend requests and versus challenges all send through here, so there is
 * exactly one place that knows how to read a subscription, retire a dead one,
 * and swallow a failure that must never take a trigger down with it.
 */
async function pushToUser(uid, payload) {
    try {
        const snap = await db.collection('users').doc(uid).get();
        const subscription = snap.exists ? snap.data().pushSubscription : null;
        if (!isUsableSubscription(subscription)) {
            logger.info('No usable push subscription — skipping push', { uid });
            return;
        }
        const result = await sendPush(subscription, payload);
        if (result.ok) return;
        logger.error('Push failed', { uid, statusCode: result.statusCode, message: result.message });
        if (result.dead) {
            await db.collection('users').doc(uid).update({ pushSubscription: FieldValue.delete() });
            logger.info('Cleared dead push subscription', { uid });
        }
    } catch (err) {
        logger.error('Push threw', { uid, error: String(err) });
    }
}

exports.onGiftReceived = onDocumentCreated(
    {
        document: 'users/{receiverUid}/gifts/{giftId}',
        region: REGION,
        memory: '256MiB',
    },
    async (event) => {
        const snap = event.data;
        if (!snap || !snap.exists) return;
        const gift = snap.data();

        // The silence rule. An xp_boost gift is never announced.
        if (gift.type !== 'shield') return;
        if (gift.status !== 'pending') return;

        const sender = gift.senderName || 'A friend';
        await pushToUser(event.params.receiverUid, {
            title: 'Mindkraft',
            body: sender + ' sent you a shield.',
            tag: 'mindkraft-gift-' + String(event.params.giftId),
            data: { type: 'gift', activityId: null },
        });
    }
);

exports.onGiftConsumed = onDocumentWritten(
    {
        document: 'users/{senderUid}/giftsSent/{giftId}',
        region: REGION,
        memory: '256MiB',
    },
    async (event) => {
        const beforeSnap = event.data && event.data.before;
        const afterSnap = event.data && event.data.after;
        if (!afterSnap || !afterSnap.exists) return;
        if (!beforeSnap || !beforeSnap.exists) return;   // the create is the sender's own write

        const before = beforeSnap.data();
        const after = afterSnap.data();

        // Exactly one transition is a notification. The receiver settles
        // `thanked` in the same write that flips the status, so this fires
        // once with the right copy rather than twice.
        if (before.status !== 'pending' || after.status !== 'consumed') return;
        if (after.type !== 'xp_boost') return;   // shields have no consumption beat

        const name = after.receiverName || 'A friend';
        const body = after.thanked
            ? name + ' used the double XP you sent, and said thanks.'
            : name + ' used the double XP you sent.';

        await pushToUser(event.params.senderUid, {
            title: 'Mindkraft',
            body,
            tag: 'mindkraft-gift-used-' + String(event.params.giftId),
            data: { type: 'gift', activityId: null },
        });
    }
);

// ══════════════════════════════════════════════════════════════════════════
// FRIEND REQUEST NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════
//
// A `friendRequests` document is not a request in the classic sense: adding
// by code is unilateral, so the sender is already following the recipient by
// the time this document exists. What the document actually carries is "you
// have been added, do you want to add back" — and the copy below says that
// rather than the handshake wording, because the handshake is not what
// happens.
//
// Two beats, mirroring onPactWrite's shape:
//
//   created                → tell the RECIPIENT someone added them
//   status → 'accepted'    → tell the ORIGINAL SENDER they added back
//
// A dismissal is silent, deliberately, and that is why acceptance is a
// marker write followed by the delete rather than the delete alone: a delete
// fires for both outcomes and cannot tell them apart. The client writes
// `status: 'accepted'` first, then deletes; the delete lands here with no
// `after` and returns immediately.
//
// Both names are denormalized onto the document by whoever wrote it, so
// neither branch reads another user's profile.

exports.onFriendRequestWrite = onDocumentWritten(
    {
        document: 'friendRequests/{requestId}',
        region: REGION,
        memory: '256MiB',
    },
    async (event) => {
        const afterSnap = event.data && event.data.after;
        if (!afterSnap || !afterSnap.exists) return;   // accepted or dismissed — cleaned up
        const after = afterSnap.data();
        const beforeSnap = event.data && event.data.before;
        const before = beforeSnap && beforeSnap.exists ? beforeSnap.data() : null;
        const tag = 'mindkraft-friend-' + String(event.params.requestId);

        // Created — the recipient learns they were added.
        if (!before) {
            if (!after.toUID) return;
            const from = after.fromName || 'Someone';
            await pushToUser(after.toUID, {
                title: 'Mindkraft',
                body: from + ' added you on Mindkraft. Add them back to see each other’s progress.',
                tag,
                data: { type: 'friend', activityId: null },
            });
            return;
        }

        // Accepted — the original sender learns it went both ways.
        if (before.status !== 'accepted' && after.status === 'accepted') {
            if (!after.fromUID) return;
            const who = after.toName || 'Someone';
            await pushToUser(after.fromUID, {
                title: 'Mindkraft',
                body: who + ' added you back. You’re friends on Mindkraft.',
                tag,
                data: { type: 'friend', activityId: null },
            });
        }
    }
);

// ══════════════════════════════════════════════════════════════════════════
// PACT NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════
//
// Pact Mode is the only mode two accounts share, so it is the only one whose
// beats have to reach someone who is not the person that caused them. Four
// transitions are worth a push and no others:
//
//   created            → tell the partner there is a request waiting
//   pending → active   → tell the initiator it was accepted
//   pending → declined → tell the initiator it was not
//   active  → resolved → tell BOTH how it ended
//
// Plus two beats that are not transitions at all — the halfway mark and the
// gap between partners — which ride the SAME trigger rather than a second
// listener on the same document. Progress writes do not move `status`, so they
// are handled before the status branches below and cannot fall through them.
// The rules for when they fire, and the arm/disarm that stops the gap nudge
// firing on every completion, live in lib/pact.js.
//
// Every name in these payloads is denormalized onto the pact document when it
// is written, so this function never reads another user's profile.
//
// The failure copy names who fell short. That is deliberate and specified:
// both partners already know who is who, and hiding it would undercut the
// honesty the mode is built on.

function pactOtherUid(pactDoc, uid) {
    const ps = pactDoc.participants || [];
    return ps[0] === uid ? ps[1] : ps[0];
}

function pactDisplayName(pactDoc, uid) {
    return (pactDoc.names && pactDoc.names[uid]) || 'Your partner';
}

/**
 * Fire whatever progress nudges this write earned, and stamp the document so
 * they cannot fire again for the same reason.
 *
 * The stamp lands FIRST, deliberately. That write re-enters this trigger, which
 * then reads the flags it just set and decides there is nothing to send — one
 * extra invocation, and it terminates. Pushing first and stamping after would
 * be the other way round: a crash in between, or a retry, would re-send a nudge
 * the user already has. A lost nudge is a shrug; a duplicate one is the thing
 * the whole arm/disarm mechanism exists to prevent.
 */
async function sendPactProgressNudges(ref, pactDoc, tag) {
    const { patch, pushes } = pact.progressNudges(pactDoc);
    if (!Object.keys(patch).length) return;

    try {
        await ref.update(patch);
    } catch (err) {
        // Could not record it, so do not send it — the alternative is a nudge
        // that re-fires on every subsequent write.
        logger.error('Pact nudge bookkeeping failed', { error: String(err) });
        return;
    }

    await Promise.all(pushes.map(({ uid, body, tagSuffix }) => pushToUser(uid, {
        title: 'Mindkraft',
        body,
        tag: tag + '-' + tagSuffix,
        data: { type: 'pact', activityId: null },
    })));
}

exports.onPactWrite = onDocumentWritten(
    {
        document: 'pacts/{pactId}',
        region: REGION,
        memory: '256MiB',
    },
    async (event) => {
        const afterSnap = event.data && event.data.after;
        if (!afterSnap || !afterSnap.exists) return;
        const after = afterSnap.data();
        const beforeSnap = event.data && event.data.before;
        const before = beforeSnap && beforeSnap.exists ? beforeSnap.data() : null;
        const pactId = event.params.pactId;
        const tag = 'mindkraft-pact-' + String(pactId);

        // Progress nudges. Before the status branches, because the writes that
        // earn them change no status at all and would never reach this far.
        if (after.status === 'active') {
            await sendPactProgressNudges(afterSnap.ref, after, tag);
        }

        // Created.
        if (!before) {
            if (after.status !== 'pending' || !after.partner) return;
            const from = pactDisplayName(after, after.createdBy);
            await pushToUser(after.partner, {
                title: 'Mindkraft',
                body: from + ' wants to start a Pact with you.',
                tag,
                data: { type: 'pact', activityId: null },
            });
            return;
        }

        if (before.status === after.status) return;

        if (before.status === 'pending' && after.status === 'active') {
            const partnerName = pactDisplayName(after, after.partner);
            await pushToUser(after.createdBy, {
                title: 'Mindkraft',
                body: partnerName + ' accepted your Pact. It starts tomorrow.',
                tag,
                data: { type: 'pact', activityId: null },
            });
            return;
        }

        if (before.status === 'pending' && after.status === 'declined') {
            const partnerName = pactDisplayName(after, after.partner);
            await pushToUser(after.createdBy, {
                title: 'Mindkraft',
                body: partnerName + ' declined the Pact. Your Grit is on its way back.',
                tag,
                data: { type: 'pact', activityId: null },
            });
            return;
        }

        if (after.status === 'resolved') {
            const participants = after.participants || [];
            const kept = after.outcome === 'kept';
            await Promise.all(participants.map((uid) => {
                const themName = pactDisplayName(after, pactOtherUid(after, uid));
                let body;
                if (kept) {
                    body = 'Pact kept. You and ' + themName + ' both hit your targets — your Grit is back with a bonus.';
                } else if (after.failedBy === 'both') {
                    body = 'Pact broken. Neither of you reached your target, so both stakes are gone.';
                } else if (after.failedBy === uid) {
                    body = 'Pact broken. You fell short, so ' + themName + ' lost their stake too.';
                } else {
                    body = 'Pact broken. ' + themName + ' fell short, so both stakes are gone.';
                }
                return pushToUser(uid, {
                    title: 'Mindkraft',
                    body,
                    tag,
                    data: { type: 'pact', activityId: null },
                });
            }));
        }
    }
);

// ══════════════════════════════════════════════════════════════════════════
// VERSUS CHALLENGE NOTIFICATIONS
// ══════════════════════════════════════════════════════════════════════════
//
// Versus Challenges had no server side at all before this: every state
// transition, including resolution and forfeit, was evaluated lazily on
// whichever client next opened the app. Two things follow from that, and both
// are fixed here.
//
//   1. onVersusWrite turns each transition into a push, the same way
//      onPactWrite does. Every name in these payloads is denormalized onto the
//      challenge document at write time, so this never reads another user's
//      profile.
//
//   2. resolveDueVersusChallenges is the piece that did not exist. Without a
//      scheduler, a challenge that ran out of time while both people were away
//      stayed `active` — so the push saying you won or lost fired whenever
//      someone happened to open the app, which could be days later or never.
//      It now resolves at the deadline, and because the resolving write lands
//      on this same document, the push falls out of onVersusWrite below rather
//      than being sent a second way.
//
// Which transitions are worth a push, and no others:
//
//   created            → tell the invited party
//   pending → active   → tell the challenger it was accepted
//   pending → declined → tell the challenger it was not
//   → resolved         → tell BOTH how it ended (including a forfeit)
//
// Expiry and withdrawal are silent. Both are refunds to the challenger, who
// caused one of them and let the other lapse; neither is news, and the refund
// is claimed on next open either way.

// Cap on challenges resolved in a single scheduler pass. Same reasoning as
// MAX_DUE_PER_RUN: a runaway backlog should degrade gracefully rather than
// blow the function's timeout, and the next run picks up the remainder.
const MAX_VERSUS_PER_RUN = 200;

exports.onVersusWrite = onDocumentWritten(
    {
        document: 'versusChallenges/{challengeId}',
        region: REGION,
        memory: '256MiB',
    },
    async (event) => {
        const afterSnap = event.data && event.data.after;
        if (!afterSnap || !afterSnap.exists) return;
        const after = afterSnap.data();
        const beforeSnap = event.data && event.data.before;
        const before = beforeSnap && beforeSnap.exists ? beforeSnap.data() : null;
        const challengeId = event.params.challengeId;
        const tag = 'mindkraft-versus-' + String(challengeId);
        const name = after.name || 'a challenge';

        // Created — the invite lands on the opponent.
        if (!before) {
            if (after.status !== 'pending' || !after.opponent) return;
            const from = versus.displayName(after, after.createdBy);
            await pushToUser(after.opponent, {
                title: 'Mindkraft',
                body: from + ' challenged you to “' + name + '”. Their stake is already down.',
                tag,
                data: { type: 'versus', activityId: null },
            });
            return;
        }

        if (before.status === after.status) return;

        if (before.status === 'pending' && after.status === 'active') {
            const oppName = versus.displayName(after, after.opponent);
            await pushToUser(after.createdBy, {
                title: 'Mindkraft',
                body: oppName + ' accepted “' + name + '”. It is live — the clock is running.',
                tag,
                data: { type: 'versus', activityId: null },
            });
            return;
        }

        if (before.status === 'pending' && after.status === 'declined') {
            const oppName = versus.displayName(after, after.opponent);
            await pushToUser(after.createdBy, {
                title: 'Mindkraft',
                body: oppName + ' declined “' + name + '”. Your stake is on its way back.',
                tag,
                data: { type: 'versus', activityId: null },
            });
            return;
        }

        // Resolved — both sides, each told from their own side. Covers the
        // forfeit case too: forfeiting writes exactly this transition.
        if (after.status === 'resolved') {
            const participants = after.participants || [];
            await Promise.all(participants.map((uid) => pushToUser(uid, {
                title: 'Mindkraft',
                body: versus.resolutionBody(after, uid),
                tag,
                data: { type: 'versus', activityId: null },
            })));
        }
    }
);

// ══════════════════════════════════════════════════════════════════════════
// resolveDueVersusChallenges — the scheduled resolver
// ══════════════════════════════════════════════════════════════════════════
//
// Five minutes, not one. A Versus deadline is `startedAt + durationDays` — day
// granularity — so a minute-by-minute sweep would buy nothing a client could
// notice while costing 1,440 queries a day against two indexes. sendDueReminders
// runs every minute because a reminder set for 07:00 has to arrive at 07:00.
//
// Deliberately does NOT move Grit. It writes the terminal status and the
// payout owed, exactly as a client's resolving transaction would; each side's
// own client credits its own balance on next open. Nothing in this codebase
// writes another user's balance, and this is not the place to start.
//
// Every patch is applied inside a transaction guarded on the status it
// expected, so a client that resolves the same challenge in the same moment
// wins the race and this run is a no-op — the two cannot double-pay.

exports.resolveDueVersusChallenges = onSchedule(
    {
        schedule: 'every 5 minutes',
        timeZone: 'Etc/UTC',
        region: REGION,
        memory: '256MiB',
        timeoutSeconds: 120,
        retryCount: 0,
    },
    async () => {
        const now = Date.now();

        const [overdue, lapsed] = await Promise.all([
            db.collection('versusChallenges')
                .where('status', '==', 'active')
                .where('endsAt', '<=', now)
                .limit(MAX_VERSUS_PER_RUN)
                .get(),
            db.collection('versusChallenges')
                .where('status', '==', 'pending')
                .where('expiresAt', '<=', now)
                .limit(MAX_VERSUS_PER_RUN)
                .get(),
        ]);

        if (overdue.empty && lapsed.empty) return;

        const jobs = []
            .concat(overdue.docs.map((snap) => ({ snap, kind: 'active' })))
            .concat(lapsed.docs.map((snap) => ({ snap, kind: 'pending' })));

        const outcomes = await Promise.allSettled(jobs.map(({ snap, kind }) =>
            db.runTransaction(async (tx) => {
                const live = await tx.get(snap.ref);
                if (!live.exists) return false;
                const challenge = live.data();
                const patch = kind === 'active'
                    ? versus.resolveDeadlinePatch(challenge, now)
                    : versus.expirePendingPatch(challenge, now);
                if (!patch) return false;      // a client got here first
                tx.update(snap.ref, patch);
                return true;
            })
        ));

        let resolved = 0;
        let raced = 0;
        for (const outcome of outcomes) {
            if (outcome.status === 'rejected') {
                logger.error('Versus resolution failed', { error: String(outcome.reason) });
            } else if (outcome.value) {
                resolved += 1;
            } else {
                raced += 1;
            }
        }

        logger.info('resolveDueVersusChallenges complete', {
            due: jobs.length,
            overdue: overdue.size,
            lapsed: lapsed.size,
            resolved,
            raced,
        });
    }
);

// ══════════════════════════════════════════════════════════════════════════
// onReminderWrite — keep nextSendAt in sync, and backstop the cap
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
        // back on could push the user past 5. Enforce it here too.
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
// createActivityReminder — HTTPS callable
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


// ══════════════════════════════════════════════════════════════════════════
// ══ QUEST COMPOSER ════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
//
// Composes a quest from a stated intention and the user's own live activities.
//
// It writes NOTHING to users/{uid}. The draft comes back in the HTTP response
// and goes straight into the builder, where it stays until the user taps
// Create quest. That is what keeps it clear of saveUserData()'s full-document
// overwrite — the nastiest hazard in this codebase, sidestepped rather than
// managed. The rate-limit counter is the one thing persisted, and it lives in
// a subcollection for exactly the same reason.
//
// ANTHROPIC_API_KEY arrives as a runtime environment variable, written into
// functions/.env at deploy time from the repo's ANTHROPIC_API_KEY secret. Not
// Secret Manager: binding a secret makes the deploy call setIamPolicy on it,
// which this CI service account is not permitted to do.

const RATE_LIMIT_FREE = 3;                          // compositions per window
const RATE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;     // rolling seven days

// Read the window without consuming anything: a composition that fails costs
// the user nothing, so the unit is spent only once a valid spec exists.
async function readQuota(uid) {
    const ref = db.collection('users').doc(uid).collection('aiUsage').doc('questComposer');
    const snap = await ref.get();
    const now = Date.now();
    const data = snap.exists ? snap.data() : null;
    const startedAt = data && data.windowStart ? new Date(data.windowStart).getTime() : 0;
    const fresh = !startedAt || now - startedAt >= RATE_WINDOW_MS;
    return {
        ref,
        count: fresh ? 0 : (data.count || 0),
        windowStart: fresh ? new Date(now).toISOString() : data.windowStart,
    };
}

async function consumeQuota(quota) {
    await quota.ref.set({
        count: quota.count + 1,
        windowStart: quota.windowStart,
        lastAt: new Date().toISOString(),
    }, { merge: true });
}

exports.composeQuest = onCall(
    {
        region: REGION,
        memory: '256MiB',
        timeoutSeconds: 60,
        maxInstances: 3,
    },
    async (request) => {
        // The uid comes from the verified token, never from the payload.
        if (!request.auth || !request.auth.uid) {
            throw new HttpsError('unauthenticated', 'You must be signed in to plan a quest.');
        }
        const uid = request.auth.uid;
        const data = request.data || {};

        const requestText = String(data.request == null ? '' : data.request)
            .slice(0, questComposer.REQUEST_MAX_CHARS).trim();
        const shape = data.shape === 'recurring' ? 'recurring' : 'oneoff';
        const size = ['days', 'weeks', 'months'].indexOf(data.size) !== -1 ? data.size : null;

        if (!requestText) {
            throw new HttpsError('invalid-argument', 'Describe what you are trying to get done.');
        }

        const userSnap = await db.collection('users').doc(uid).get();
        if (!userSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
        const userData = userSnap.data();

        // Activities are read here rather than accepted from the client: it
        // keeps the request tiny, stops a malicious client padding the payload
        // to burn tokens, and makes the snapshot authoritative.
        const activities = questComposer.activityMenu(userData);
        if (activities.length < questComposer.MIN_ACTIVITIES) {
            return { ok: false, reason: 'gate' };
        }

        const quota = await readQuota(uid);
        if (quota.count >= RATE_LIMIT_FREE) {
            return { ok: false, reason: 'ratelimit', remaining: 0 };
        }

        const dimensions = (userData.dimensions || [])
            .filter((d) => d && d.id)
            .map((d) => ({ id: d.id, name: String(d.name || '').slice(0, 40) }));

        const prompt = questComposer.buildComposePrompt({
            activities, dimensions, request: requestText, shape, size,
        });

        let raw;
        try {
            const res = await callModel({ system: prompt.system, user: prompt.user, maxTokens: 2000 });
            raw = parseModelJson(res.content);
        } catch (err) {
            logger.warn('composeQuest model call failed', { uid, error: err.message });
            return { ok: false, reason: 'model' };
        }

        const ctx = questComposer.buildCtx(userData, activities);
        const spec = questComposer.validateSpec(raw, ctx, shape);
        if (!spec) {
            logger.warn('composeQuest produced nothing valid', { uid });
            return { ok: false, reason: 'invalid' };
        }

        // Only a real composition costs a unit.
        await consumeQuota(quota);

        logger.info('composeQuest ok', {
            uid, shape, size, groups: spec.groups.length, activities: activities.length,
        });
        return { ok: true, spec, remaining: Math.max(0, RATE_LIMIT_FREE - (quota.count + 1)) };
    }
);


// ══════════════════════════════════════════════════════════════════════════
// ══ MAP — "WEAVE MY WEB" ══════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
//
// Replaces the GitHub Actions tech-tree worker. That design had the client
// write techTree.pendingRequest and then watch its own document for minutes,
// with a realtime listener AND a poll because a cron has no execution-time
// guarantee. Generation is now a single call that returns the web in its own
// HTTP response — the shape composeQuest above already proved out.
//
// Like composeQuest, it writes NOTHING to users/{uid}. The woven web comes
// back in the response and the CLIENT persists it, which keeps generation
// clear of saveUserData()'s full-document overwrite. The only thing persisted
// here is the cooldown record, in a subcollection for the same reason.
//
// The user's real Firestore document is the sole input. Nothing about the web
// is taken from the request beyond the mode and which goal it applies to.

const WEAVE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
// An abuse ceiling, not a product limit: legitimate use is one regeneration a
// month, at most five goals ever, and an expansion every few days.
const WEAVE_WINDOW_MAX = 20;

async function readWeaveUsage(uid) {
    const ref = db.collection('users').doc(uid).collection('aiUsage').doc('mapWeave');
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    const now = Date.now();
    const startedAt = data.windowStart ? new Date(data.windowStart).getTime() : 0;
    const fresh = !startedAt || now - startedAt >= WEAVE_WINDOW_MS;
    return {
        ref,
        lastTreeRegenAt: data.lastTreeRegenAt || null,
        goalRegenAt: data.goalRegenAt || {},
        count: fresh ? 0 : (data.count || 0),
        windowStart: fresh ? new Date(now).toISOString() : data.windowStart,
    };
}

// Only a weave that actually produced something spends anything. A failed
// model call costs the user neither their monthly regeneration nor a slot in
// the abuse window.
async function commitWeaveUsage(usage, mode, goalId, isTreeRegen) {
    const now = new Date().toISOString();
    const next = {
        count: usage.count + 1,
        windowStart: usage.windowStart,
        lastAt: now,
    };
    if (isTreeRegen) next.lastTreeRegenAt = now;
    if (mode === 'regenerate' && goalId) {
        next.goalRegenAt = Object.assign({}, usage.goalRegenAt, { [goalId]: now });
    }
    await usage.ref.set(next, { merge: true });
    return {
        lastTreeRegenAt: next.lastTreeRegenAt || usage.lastTreeRegenAt || null,
        goalRegenAt: next.goalRegenAt || usage.goalRegenAt || {},
    };
}

function anchorSummaries(techTree, actById) {
    return (techTree.nodes || [])
        .filter((n) => n.role === 'anchor' && n.payload && n.payload.activityId && actById[n.payload.activityId])
        .map((n) => ({ activityId: n.payload.activityId, name: n.title, dimensionId: n.dimensionId }));
}

// A full generation runs to several thousand output tokens, so it is streamed
// and judged on STALLING rather than duration — the same discipline the worker
// used, with the ceilings brought down to what someone will actually sit
// through. In practice a weave returns in 15-40s.
//
// The ceilings have to multiply out under the function's own 300s timeout AND
// under the client's guard, because callModel retries once: generate is at
// worst 2 x 100s, everything else 2 x 60s. Otherwise the client gives up on a
// call the server then completes, and the user loses a monthly regeneration
// they never saw.
function modelBudget(mode) {
    return {
        maxTokens: webWeaver.MAX_TOKENS[mode] || 4000,
        idleMs: 30000,
        totalMs: mode === 'generate' ? 100000 : 60000,
    };
}

async function weaveGeneration(uid, mode, userData, techTree, goalId) {
    const goals = (techTree.goals || []).filter((g) => !g.retiredAt);
    const actById = {};
    webWeaver.collectActivities(userData).forEach(({ act }) => { actById[act.id] = act; });

    const opts = { mode };
    let scopedGoal = null;

    if (mode === 'add_goal') {
        opts.goalIds = [goalId];
        opts.existingAnchors = anchorSummaries(techTree, actById);
    } else if (mode === 'regenerate') {
        scopedGoal = goals.find((g) => g.id === goalId);
        opts.goalIds = [goalId];
        opts.resolvedOnGoal = (techTree.nodes || [])
            .filter((n) => (n.goalIds || []).indexOf(goalId) !== -1 && n.resolvedAt)
            .map((n) => n.title);
    }

    const scopedGoals = goals.filter((g) => !opts.goalIds || opts.goalIds.indexOf(g.id) !== -1);
    const prompt = webWeaver.buildGeneratePrompt(userData, opts);

    let parsed;
    try {
        const res = await callModel(Object.assign({ system: prompt.system, user: prompt.user }, modelBudget(mode)));
        // Truncation is the likeliest cause of unparseable JSON on the big
        // generate, and it is invisible in the parse failure alone.
        if (res.truncated) logger.warn('weaveWeb hit the token ceiling', { uid, mode });
        parsed = parseModelJson(res.content);
    } catch (err) {
        logger.warn('weaveWeb model call failed', { uid, mode, error: err.message });
        return { ok: false, reason: 'model' };
    }
    if (!parsed) {
        logger.warn('weaveWeb returned unparseable output', { uid, mode });
        return { ok: false, reason: 'invalid' };
    }

    // GENERATE may split one typed goal into several distinct goals; the
    // scoped modes reuse the goals they were given, in order. Reserved colours
    // are the ones belonging to threads this call is not rebuilding, so a new
    // goal cannot draw a colour another thread already wears.
    const inBatch = new Set(scopedGoals.map((g) => g.id));
    const built = webWeaver.materializeWeb(parsed, userData, scopedGoals, {
        positional: mode !== 'generate',
        reservedColors: (techTree.goals || [])
            .filter((g) => !inBatch.has(g.id))
            .map((g) => g.color),
    });
    if (!built.goals.length || (mode === 'generate' && !built.nodes.length)) {
        logger.warn('weaveWeb produced nothing valid', { uid, mode });
        return { ok: false, reason: 'invalid' };
    }

    const folded = webWeaver.foldGeneration(mode, techTree, built, parsed.vision, goalId);
    if (scopedGoal) scopedGoal.regeneratedAt = new Date().toISOString();

    return {
        ok: true,
        newNodes: built.nodes.length,
        patch: Object.assign({
            status: 'ready',
            schemaVersion: 3,
            lastGeneratedAt: new Date().toISOString(),
        }, folded),
    };
}

// Expansion: fan new nodes under the single most recent mastery, and refill
// the wildcard slots the user has used up. One source per call, not three —
// this runs while someone is looking at the screen now, not on a cron.
async function weaveExpansion(uid, userData, techTree, nodeIds) {
    const nodes = techTree.nodes || [];
    const candidates = nodes
        .filter((n) => n.resolvedAt && n.lifecycle !== 'archived'
            && (!nodeIds.length || nodeIds.indexOf(n.id) !== -1))
        .sort((a, b) => new Date(a.resolvedAt) - new Date(b.resolvedAt));
    const resolved = candidates[candidates.length - 1] || null;

    const goalsById = {};
    (techTree.goals || []).forEach((g) => { goalsById[g.id] = g; });
    const actById = {};
    webWeaver.collectActivities(userData).forEach(({ act }) => { actById[act.id] = act; });

    const existingTitles = nodes.filter((n) => n.lifecycle !== 'archived').map((n) => n.title);
    let added = [];

    if (resolved) {
        const ctx = {
            resolvedNode: {
                title: resolved.title, role: resolved.role, dimensionId: resolved.dimensionId,
                activity: resolved.payload && resolved.payload.activityId && actById[resolved.payload.activityId]
                    ? {
                        activityId: resolved.payload.activityId,
                        completions: actById[resolved.payload.activityId].completionCount || 0,
                    }
                    : null,
            },
            goals: (resolved.goalIds || []).map((gid) => goalsById[gid]).filter(Boolean)
                .map((g) => ({ goalId: g.id, shortName: g.shortName, sharpened: g.sharpened })),
            activities: webWeaver.activitySnapshot(userData, true),
            existingTitles,
            rejections: webWeaver.rejectionStrings(techTree),
        };
        const prompt = webWeaver.buildExpandPrompt(userData, ctx);
        try {
            const res = await callModel(Object.assign({ system: prompt.system, user: prompt.user }, modelBudget('expand')));
            added = webWeaver.materializeExpansion(parseModelJson(res.content), userData, techTree, resolved, existingTitles);
            added.forEach((n) => existingTitles.push(n.title));
        } catch (err) {
            logger.warn('weaveWeb expansion failed', { uid, error: err.message });
        }
    }

    // Once the old wildcards are accepted or done, the web owes the user fresh
    // serendipity (max 2 on offer at any time).
    const openWilds = nodes.filter((n) => n.role === 'wildcard' && n.lifecycle === 'available').length;
    const wildSlots = Math.max(0, 2 - openWilds);
    const spentWild = nodes.some((n) => n.role === 'wildcard'
        && n.lifecycle !== 'available' && n.lifecycle !== 'archived');
    if (wildSlots > 0 && spentWild) {
        const prompt = webWeaver.buildWildcardPrompt(userData, techTree, wildSlots, existingTitles);
        try {
            const res = await callModel(Object.assign({ system: prompt.system, user: prompt.user }, modelBudget('expand')));
            added = added.concat(webWeaver.materializeWildcards(parseModelJson(res.content), userData, wildSlots, existingTitles));
        } catch (err) {
            logger.warn('weaveWeb wildcard replenish failed', { uid, error: err.message });
        }
    }

    if (!added.length) return { ok: false, reason: 'empty' };
    return {
        ok: true,
        newNodes: added.length,
        patch: {
            status: 'ready',
            schemaVersion: 3,
            lastExpandAt: new Date().toISOString(),
            nodes: nodes.concat(added),
        },
    };
}

exports.weaveWeb = onCall(
    {
        region: REGION,
        memory: '512MiB',
        timeoutSeconds: 300,
        maxInstances: 5,
    },
    async (request) => {
        // The uid comes from the verified token, never from the payload.
        if (!request.auth || !request.auth.uid) {
            throw new HttpsError('unauthenticated', 'You must be signed in to weave your web.');
        }
        const uid = request.auth.uid;
        const data = request.data || {};

        const mode = webWeaver.VALID_MODES.indexOf(data.mode) !== -1 ? data.mode : null;
        if (!mode) throw new HttpsError('invalid-argument', 'Unknown weave mode.');
        const goalId = typeof data.goalId === 'string' ? data.goalId.slice(0, 64) : null;
        const nodeIds = (Array.isArray(data.nodeIds) ? data.nodeIds : [])
            .filter((id) => typeof id === 'string').slice(0, 5);

        const userSnap = await db.collection('users').doc(uid).get();
        if (!userSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
        const userData = userSnap.data();
        const techTree = userData.techTree || {};

        const usage = await readWeaveUsage(uid);
        if (usage.count >= WEAVE_WINDOW_MAX) {
            return { ok: false, reason: 'ratelimit', message: 'That is a lot of weaving for one week — try again in a few days.' };
        }

        const blocked = webWeaver.gateFor(mode, techTree, userData, { goalId }, usage);
        if (blocked) {
            return Object.assign({ ok: false, usage: { lastTreeRegenAt: usage.lastTreeRegenAt, goalRegenAt: usage.goalRegenAt } }, blocked);
        }

        // A generate against a web that already has nodes IS the whole-tree
        // regeneration — the first weave is the free one.
        const isTreeRegen = mode === 'generate' && webWeaver.liveNodes(techTree).length > 0;

        const result = mode === 'expand'
            ? await weaveExpansion(uid, userData, techTree, nodeIds)
            : await weaveGeneration(uid, mode, userData, techTree, goalId);

        if (!result.ok) return result;

        const committed = await commitWeaveUsage(usage, mode, goalId, isTreeRegen);

        logger.info('weaveWeb ok', { uid, mode, newNodes: result.newNodes });
        return { ok: true, mode, techTree: result.patch, usage: committed };
    }
);
