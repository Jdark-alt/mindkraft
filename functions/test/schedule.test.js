'use strict';

// Unit tests for the reminder scheduling maths.
// Run with:  cd functions && npm install && npm test
//
// These cover the cases that matter — DST transitions in a
// zone that actually has them, and a mid-day timezone change — plus the
// idempotency date key. Everything here is pure computation, no emulator needed.

const test = require('node:test');
const assert = require('node:assert');
const { DateTime } = require('luxon');

const {
    DEFAULT_TIMEZONE,
    isValidLocalTime,
    isValidTimezone,
    resolveTimezone,
    computeNextSendDate,
    getLocalDateString,
} = require('../lib/schedule');

/** Express a UTC instant as wall-clock time in `zone`, for readable assertions. */
function wallClock(date, zone) {
    return DateTime.fromJSDate(date, { zone }).toFormat('yyyy-MM-dd HH:mm');
}

/** Build a UTC instant from an ISO string. */
function at(iso) {
    return new Date(iso);
}

test('isValidLocalTime accepts 24-hour HH:mm and rejects everything else', () => {
    for (const good of ['00:00', '08:00', '09:05', '23:59', '13:30']) {
        assert.strictEqual(isValidLocalTime(good), true, good + ' should be valid');
    }
    for (const bad of ['24:00', '8:00', '08:60', '0800', '08:0', '', null, undefined, 800, '08:00:00']) {
        assert.strictEqual(isValidLocalTime(bad), false, JSON.stringify(bad) + ' should be invalid');
    }
});

test('isValidTimezone recognises IANA zones and rejects junk', () => {
    assert.strictEqual(isValidTimezone('Asia/Kolkata'), true);
    assert.strictEqual(isValidTimezone('America/New_York'), true);
    assert.strictEqual(isValidTimezone('Etc/UTC'), true);
    assert.strictEqual(isValidTimezone('UTC'), true);
    assert.strictEqual(isValidTimezone('America/Argentina/Buenos_Aires'), true);
    assert.strictEqual(isValidTimezone('Not/AZone'), false);
    assert.strictEqual(isValidTimezone(''), false);
    assert.strictEqual(isValidTimezone(null), false);
});

test('isValidTimezone rejects fixed offsets, which cannot follow DST', () => {
    // Luxon happily parses these as valid zones. Storing one would recreate
    // the old tzOffset bug, so they must not pass validation.
    for (const offset of ['+05:30', '-0500', 'UTC+2', '+00:00']) {
        assert.strictEqual(isValidTimezone(offset), false, offset + ' should be rejected');
    }
});

test('resolveTimezone falls back to Asia/Kolkata and reports that it did', () => {
    assert.deepStrictEqual(resolveTimezone('America/New_York'), { timezone: 'America/New_York', usedFallback: false });
    assert.deepStrictEqual(resolveTimezone(null), { timezone: DEFAULT_TIMEZONE, usedFallback: true });
    assert.deepStrictEqual(resolveTimezone('garbage'), { timezone: DEFAULT_TIMEZONE, usedFallback: true });
});

test('picks today when the time is still ahead, tomorrow once it has passed', () => {
    const zone = 'Asia/Kolkata';

    // 06:00 IST — an 08:00 reminder is still ahead of us today.
    const morning = at('2026-03-10T00:30:00Z');
    assert.strictEqual(wallClock(computeNextSendDate('08:00', zone, morning), zone), '2026-03-10 08:00');

    // 10:00 IST — 08:00 has gone, so it rolls to tomorrow.
    const later = at('2026-03-10T04:30:00Z');
    assert.strictEqual(wallClock(computeNextSendDate('08:00', zone, later), zone), '2026-03-11 08:00');
});

test('a time exactly equal to now rolls forward rather than firing twice', () => {
    const zone = 'Asia/Kolkata';
    // Exactly 08:00:00 IST.
    const exactly = at('2026-03-10T02:30:00Z');
    assert.strictEqual(wallClock(computeNextSendDate('08:00', zone, exactly), zone), '2026-03-11 08:00');
});

test('08:00 IST resolves to 02:30 UTC (the offset the old script hand-rolled)', () => {
    const next = computeNextSendDate('08:00', 'Asia/Kolkata', at('2026-03-10T00:00:00Z'));
    assert.strictEqual(next.toISOString(), '2026-03-10T02:30:00.000Z');
});

// ── DST: spring forward ───────────────────────────────────────────────────
// US DST begins 2026-03-08. Local 02:00-03:00 does not exist that day.

test('spring forward: a normal morning reminder holds its wall-clock time', () => {
    const zone = 'America/New_York';

    // Day before the change, late evening → next fire is on changeover day.
    const before = at('2026-03-07T20:00:00Z'); // 15:00 EST
    const next = computeNextSendDate('08:00', zone, before);
    assert.strictEqual(wallClock(next, zone), '2026-03-08 08:00');
    // 08:00 EDT is 12:00Z, not the 13:00Z it would be under EST — i.e. the
    // clock change is genuinely accounted for, not carried over as a fixed offset.
    assert.strictEqual(next.toISOString(), '2026-03-08T12:00:00.000Z');
});

test('spring forward: a reminder inside the missing hour resolves forward, and does not drift the next day', () => {
    const zone = 'America/New_York';

    // Changeover day, 10:00 EDT. 02:30 never happens today.
    const onTheDay = at('2026-03-08T14:00:00Z');
    const next = computeNextSendDate('02:30', zone, onTheDay);

    // Rolls to the next day, where 02:30 exists again — crucially at 02:30,
    // NOT 03:30. Adding a day to a gap-shifted result would have produced
    // 03:30 and the reminder would have permanently slipped an hour.
    assert.strictEqual(wallClock(next, zone), '2026-03-09 02:30');
});

// ── DST: fall back ────────────────────────────────────────────────────────
// US DST ends 2026-11-01. Local 01:00-02:00 happens twice that day.

test('fall back: wall-clock time is preserved across the change', () => {
    const zone = 'America/New_York';

    const before = at('2026-10-31T22:00:00Z'); // 18:00 EDT, Oct 31
    const next = computeNextSendDate('08:00', zone, before);
    assert.strictEqual(wallClock(next, zone), '2026-11-01 08:00');
    // 08:00 EST = 13:00Z (vs 12:00Z the day before under EDT).
    assert.strictEqual(next.toISOString(), '2026-11-01T13:00:00.000Z');
});

test('fall back: an ambiguous time picks one occurrence and stays consistent', () => {
    const zone = 'America/New_York';

    const before = at('2026-10-31T20:00:00Z');
    const next = computeNextSendDate('01:30', zone, before);

    // Whichever of the two 01:30s is chosen, it must land on the right local
    // day at the right wall-clock time — and only once.
    assert.strictEqual(wallClock(next, zone), '2026-11-01 01:30');

    // Recomputing from just after it fires must move to the following day,
    // not back into the repeated hour.
    const after = new Date(next.getTime() + 1000);
    const following = computeNextSendDate('01:30', zone, after);
    assert.strictEqual(wallClock(following, zone), '2026-11-02 01:30');
});

// ── Travel: the user's timezone changes mid-day ──────────────────────────

test('changing timezone recomputes to the new zone, not the old offset', () => {
    // 08:00 reminder, recomputed at the same instant under two zones.
    const instant = at('2026-06-15T09:00:00Z');

    const india = computeNextSendDate('08:00', 'Asia/Kolkata', instant);
    const newYork = computeNextSendDate('08:00', 'America/New_York', instant);

    // 09:00Z is 14:30 IST — 08:00 has passed, so tomorrow.
    assert.strictEqual(india.toISOString(), '2026-06-16T02:30:00.000Z');
    // 09:00Z is 05:00 EDT — 08:00 is still ahead today.
    assert.strictEqual(newYork.toISOString(), '2026-06-15T12:00:00.000Z');
});

test('unknown timezone falls back to Asia/Kolkata rather than UTC', () => {
    const instant = at('2026-06-15T00:00:00Z');
    const fallback = computeNextSendDate('08:00', null, instant);
    const explicit = computeNextSendDate('08:00', 'Asia/Kolkata', instant);
    assert.strictEqual(fallback.toISOString(), explicit.toISOString());
    // Would have been 08:00Z under a UTC fallback.
    assert.strictEqual(fallback.toISOString(), '2026-06-15T02:30:00.000Z');
});

test('rejects a malformed localTime instead of scheduling something arbitrary', () => {
    assert.throws(() => computeNextSendDate('8:00', 'Asia/Kolkata'), TypeError);
    assert.throws(() => computeNextSendDate('25:00', 'Asia/Kolkata'), TypeError);
    assert.throws(() => computeNextSendDate(null, 'Asia/Kolkata'), TypeError);
});

// ── Idempotency key ───────────────────────────────────────────────────────

test('getLocalDateString uses the local calendar day, not the UTC one', () => {
    // 20:00Z on Mar 9 is already Mar 10 in India (01:30 IST) — the exact class
    // of UTC/local mismatch that causes streak bugs.
    const instant = at('2026-03-09T20:00:00Z');
    assert.strictEqual(getLocalDateString('Asia/Kolkata', instant), '2026-03-10');
    assert.strictEqual(getLocalDateString('America/New_York', instant), '2026-03-09');
    assert.strictEqual(getLocalDateString('Etc/UTC', instant), '2026-03-09');
});

test('getLocalDateString falls back consistently for an unknown zone', () => {
    const instant = at('2026-03-09T20:00:00Z');
    assert.strictEqual(getLocalDateString(null, instant), '2026-03-10');
});

test('a send and its recomputed follow-up land on different local dates', () => {
    // This is what makes the lastSentDate guard work: after firing, the next
    // occurrence must belong to the following local day.
    const zone = 'America/New_York';
    // 13:00Z, not 12:00Z — DST ended at 02:00 that morning, so the zone is
    // already EST (UTC-5) by then and 08:00 local is 13:00Z.
    const fired = at('2026-11-01T13:00:00Z');
    const sentDate = getLocalDateString(zone, fired);
    const next = computeNextSendDate('08:00', zone, fired);
    const nextDate = getLocalDateString(zone, next);

    assert.strictEqual(sentDate, '2026-11-01');
    assert.strictEqual(nextDate, '2026-11-02');
    assert.notStrictEqual(sentDate, nextDate);
});
