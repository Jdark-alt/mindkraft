'use strict';

// ── Reminder scheduling maths ─────────────────────────────────────────────
// Every "when does this fire next" decision in the reminder system goes
// through this file. It is deliberately free of Firestore and web-push
// imports so it can be unit tested directly (see ../test/schedule.test.js).
//
// The whole point of precomputing nextSendAt is to avoid doing timezone
// arithmetic at query time. That only pays off if the arithmetic here is
// actually correct across DST boundaries — hence Luxon rather than
// hand-rolled offset maths.

const { DateTime } = require('luxon');

// Fallback when we have no IANA zone for the user yet. Matches the bulk of
// the current user base. Every use of the fallback is logged by
// the caller so the rate can be watched trending to zero as clients backfill.
const DEFAULT_TIMEZONE = 'Asia/Kolkata';

// Maximum active per-activity reminders per user.
const MAX_ACTIVITY_REMINDERS = 5;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** True if `value` is a well-formed 24-hour "HH:mm" string. */
function isValidLocalTime(value) {
    return typeof value === 'string' && TIME_RE.test(value);
}

// Canonical IANA zone names are "Area/Location" (sometimes three segments,
// e.g. America/Argentina/Buenos_Aires) and always begin with a letter.
const IANA_NAME_RE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)+$/;

/**
 * True if `zone` is a real IANA timezone this runtime understands.
 *
 * Deliberately stricter than `setZone(zone).isValid`: Luxon also accepts
 * fixed-offset specifiers like "+05:30", and those are precisely what this
 * system must not store. A fixed offset can't shift with DST, which would
 * reintroduce the bug the IANA rewrite exists to kill — the old script's
 * numeric tzOffset was exactly that mistake.
 *
 * Checking zone.type is not enough, incidentally: Luxon reports "+05:30" as
 * type "iana" because the runtime's Intl accepts it. Hence the name check.
 * "UTC" is allowed through as a special case — it is a legitimate answer from
 * Intl.DateTimeFormat().resolvedOptions().timeZone and has no DST to get wrong.
 */
function isValidTimezone(zone) {
    if (typeof zone !== 'string' || zone === '') return false;
    if (zone !== 'UTC' && !IANA_NAME_RE.test(zone)) return false;
    return DateTime.local().setZone(zone).isValid;
}

/**
 * Coerce whatever we have into a usable IANA zone.
 * Returns { timezone, usedFallback } so callers can log fallback usage.
 */
function resolveTimezone(zone) {
    if (isValidTimezone(zone)) return { timezone: zone, usedFallback: false };
    return { timezone: DEFAULT_TIMEZONE, usedFallback: true };
}

/** Convenience wrapper when the caller doesn't care about fallback tracking. */
function normalizeTimezone(zone) {
    return resolveTimezone(zone).timezone;
}

/**
 * Next moment at which `localTime` occurs in `timezone`, strictly after `fromDate`.
 *
 * DST correctness notes — this is the part that's easy to get wrong:
 *
 *  - Spring forward (the local time doesn't exist, e.g. 02:30 on the US
 *    changeover day): Luxon resolves the gap forward, so a 02:30 reminder
 *    fires at 03:30 that day. That's the closest real instant, and it does
 *    NOT drift, because tomorrow's fire time is recomputed from the wall
 *    clock again rather than by adding 24h to the shifted result.
 *  - Fall back (the local time happens twice): Luxon picks the first
 *    occurrence. The lastSentDate guard stops the second one re-firing.
 *  - The rollover deliberately does `fromDate + 1 day` and THEN applies the
 *    wall-clock time, rather than applying the time and then adding a day.
 *    The latter compounds a gap-shift into the next day's timestamp.
 *
 * @param {string} localTime  "HH:mm", 24-hour
 * @param {string|null} timezone  IANA zone; falls back per resolveTimezone
 * @param {Date} [fromDate]  reference instant, defaults to now
 * @returns {Date} the next fire instant, in UTC
 */
function computeNextSendDate(localTime, timezone, fromDate = new Date()) {
    if (!isValidLocalTime(localTime)) {
        throw new TypeError('computeNextSendDate: localTime must be "HH:mm", got ' + JSON.stringify(localTime));
    }

    const zone = normalizeTimezone(timezone);
    const parts = localTime.split(':');
    const hour = parseInt(parts[0], 10);
    const minute = parseInt(parts[1], 10);

    const now = DateTime.fromJSDate(fromDate, { zone });
    const atTime = (dt) => dt.set({ hour, minute, second: 0, millisecond: 0 });

    let candidate = atTime(now);

    // Advance a whole day at a time until we're strictly in the future.
    // One iteration is the norm; the cap is a guard against a pathological
    // zone change, never a working path.
    for (let i = 0; i < 3 && candidate <= now; i++) {
        candidate = atTime(now.plus({ days: i + 1 }));
    }

    return candidate.toJSDate();
}

/**
 * "YYYY-MM-DD" for `date` as seen in `timezone`.
 * This is the idempotency key — two sends on the same local calendar day
 * are the thing we're guarding against, so the date must be local, never UTC.
 */
function getLocalDateString(timezone, date = new Date()) {
    const zone = normalizeTimezone(timezone);
    return DateTime.fromJSDate(date, { zone }).toFormat('yyyy-MM-dd');
}

module.exports = {
    DEFAULT_TIMEZONE,
    MAX_ACTIVITY_REMINDERS,
    isValidLocalTime,
    isValidTimezone,
    resolveTimezone,
    normalizeTimezone,
    computeNextSendDate,
    getLocalDateString,
};
