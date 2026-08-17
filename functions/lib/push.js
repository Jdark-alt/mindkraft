'use strict';

// ── Web Push delivery ─────────────────────────────────────────────────────
// Delivery is raw Web Push with VAPID, NOT Firebase Cloud Messaging. The
// client subscribes via PushManager.subscribe() with the VAPID public key
// (app.js) and stores the resulting subscription at:
//
//   users/{uid}.pushSubscription = { endpoint, keys }
//
// One subscription per user — the field is a single map, not an array, so
// there is no multi-device support today (out of scope today).
// The tech tree worker (scripts/generate-tech-tree.js) sends its "your map
// is ready" push over this same field and the same VAPID keys.

const webpush = require('web-push');

// Push services return these when a subscription is permanently dead
// (unsubscribed, or the browser profile is gone). Anything else is transient.
const DEAD_SUBSCRIPTION_STATUS = [404, 410];

let configured = false;

/** Idempotently install VAPID credentials. Safe to call per invocation. */
function configureWebPush({ publicKey, privateKey, contactEmail }) {
    if (configured) return;
    if (!publicKey || !privateKey) {
        throw new Error('configureWebPush: VAPID public and private keys are required');
    }
    webpush.setVapidDetails(
        'mailto:' + (contactEmail || 'hello@mindkraft.app'),
        publicKey,
        privateKey
    );
    configured = true;
}

/** True if the stored subscription has everything web-push needs. */
function isUsableSubscription(sub) {
    return !!(sub && sub.endpoint && sub.keys && sub.keys.p256dh && sub.keys.auth);
}

/**
 * Notification content for a reminder.
 *
 * General copy is carried over verbatim from sw.js so the wording users
 * already know is unchanged.
 *
 * `tag` is what stops notifications stacking. The general reminder keeps its
 * existing tag; activity reminders get a per-activity tag so two different
 * activities due at the same minute don't silently replace each other.
 */
function buildPayload(reminder, activityName) {
    if (reminder.type === 'activity') {
        const name = activityName || reminder.activityName || 'Your activity';
        return {
            title: 'Mindkraft ⚔️',
            body: name + ' — time to log it',
            tag: 'mindkraft-activity-' + String(reminder.activityId),
            data: {
                type: 'activity',
                activityId: reminder.activityId != null ? String(reminder.activityId) : null,
            },
        };
    }

    return {
        title: 'Mindkraft ⚔️',
        body: "Don't forget to check off today's tasks!",
        tag: 'mindkraft-daily-reminder',
        data: { type: 'general', activityId: null },
    };
}

/**
 * Send one notification.
 * @returns {Promise<{ok: true} | {ok: false, dead: boolean, statusCode: number|null, message: string}>}
 * Never throws for delivery failures — the caller decides what to do, and one
 * dead endpoint must not abort the rest of the batch.
 */
async function sendPush(subscription, payload) {
    try {
        await webpush.sendNotification(
            { endpoint: subscription.endpoint, keys: subscription.keys },
            JSON.stringify(payload)
        );
        return { ok: true };
    } catch (err) {
        const statusCode = typeof err.statusCode === 'number' ? err.statusCode : null;
        return {
            ok: false,
            dead: DEAD_SUBSCRIPTION_STATUS.indexOf(statusCode) !== -1,
            statusCode,
            message: err && err.message ? err.message : String(err),
        };
    }
}

module.exports = {
    configureWebPush,
    isUsableSubscription,
    buildPayload,
    sendPush,
    DEAD_SUBSCRIPTION_STATUS,
};
