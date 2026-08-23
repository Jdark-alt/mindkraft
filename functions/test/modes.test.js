'use strict';

// Mode reminders are the one notification path whose CONTENT is decided at
// send time rather than at creation time — a habit already logged should stay
// silent, and the morning after a miss the copy is the user's own words. That
// decision is the whole of lib/modes.js, and it is exactly the kind of thing
// that cannot be eyeballed on a deployed function.
//
// The user's `why` text is a hard requirement of the spec: verbatim, never
// paraphrased, never generated. There is a test below that pins that.

const test = require('node:test');
const assert = require('node:assert');

const { previousLocalDate, modeReminderCopy } = require('../lib/modes');
const { completedOnLocalDate } = require('../lib/activities');
const { buildPayload } = require('../lib/push');

// A stand-in for lib/schedule's Luxon-backed version. The tests run in UTC
// terms throughout, which keeps them about the DECISION rather than about
// timezone maths — that is schedule.test.js's job.
function getLocalDateString(timezone, date) {
    return date.toISOString().slice(0, 10);
}

const MODE_ID = 'md-abc123';
const ACT_ID = '1700000000100';

function userDoc(completionDates, modeOverrides) {
    return {
        modes: Object.assign({
            active: { kind: 'habit', id: MODE_ID },
        }, modeOverrides || {}),
        dimensions: [{
            id: 'd1', name: 'Mind',
            paths: [{
                id: 'p1', name: 'Practice',
                activities: [{
                    id: ACT_ID,
                    name: 'Evening pages',
                    completionHistory: (completionDates || []).map((d) => ({
                        date: d + 'T21:30:00.000Z', xp: 40,
                    })),
                }],
            }],
        }],
    };
}

function habitReminder(phase, extra) {
    return Object.assign({
        type: 'mode', modeKind: 'habit', modeId: MODE_ID, phase,
        activityId: ACT_ID, activityName: 'Evening pages',
        windowStart: '22:00', windowEnd: '23:00',
        anchor: 'right after brushing my teeth',
        why: 'Because I want to be someone who finishes things.',
    }, extra || {});
}

// ── completedOnLocalDate ─────────────────────────────────────────────────

test('a real completion on the day is found', () => {
    const doc = userDoc(['2026-03-10']);
    assert.strictEqual(
        completedOnLocalDate(doc, ACT_ID, '2026-03-10', 'UTC', getLocalDateString), true);
});

test('a day with no completion is not found', () => {
    const doc = userDoc(['2026-03-10']);
    assert.strictEqual(
        completedOnLocalDate(doc, ACT_ID, '2026-03-11', 'UTC', getLocalDateString), false);
});

test('a penalty row is not a completion', () => {
    const doc = userDoc([]);
    doc.dimensions[0].paths[0].activities[0].completionHistory = [
        { date: '2026-03-10T21:30:00.000Z', xp: -20, isPenalty: true },
    ];
    assert.strictEqual(
        completedOnLocalDate(doc, ACT_ID, '2026-03-10', 'UTC', getLocalDateString), false);
});

test('a deleted activity reports no completions rather than throwing', () => {
    const doc = userDoc(['2026-03-10']);
    assert.strictEqual(
        completedOnLocalDate(doc, 'nope', '2026-03-10', 'UTC', getLocalDateString), false);
});

// ── previousLocalDate ────────────────────────────────────────────────────

test('previousLocalDate steps back one day, across a month boundary', () => {
    assert.strictEqual(previousLocalDate('2026-03-01'), '2026-02-28');
    assert.strictEqual(previousLocalDate('2026-01-01'), '2025-12-31');
});

test('previousLocalDate handles a leap day', () => {
    assert.strictEqual(previousLocalDate('2024-03-01'), '2024-02-29');
});

test('previousLocalDate rejects nonsense instead of guessing', () => {
    assert.strictEqual(previousLocalDate(''), null);
    assert.strictEqual(previousLocalDate('not-a-date'), null);
});

// ── The decision ─────────────────────────────────────────────────────────

test('an already-logged habit is not nudged, in either phase', () => {
    const doc = userDoc(['2026-03-10']);
    assert.strictEqual(
        modeReminderCopy(habitReminder('pre'), doc, 'UTC', '2026-03-10', getLocalDateString), null);
    assert.strictEqual(
        modeReminderCopy(habitReminder('post'), doc, 'UTC', '2026-03-10', getLocalDateString), null);
});

test('the pre-window nudge names the habit and its anchor', () => {
    const doc = userDoc(['2026-03-09']);          // yesterday was done
    const copy = modeReminderCopy(habitReminder('pre'), doc, 'UTC', '2026-03-10', getLocalDateString);
    assert.ok(copy, 'expected a nudge');
    assert.match(copy.body, /Evening pages/);
    assert.match(copy.body, /opens in an hour/);
    assert.match(copy.body, /right after brushing my teeth/);
});

test('the post-window nudge says there is still time', () => {
    const doc = userDoc([]);
    const copy = modeReminderCopy(habitReminder('post'), doc, 'UTC', '2026-03-10', getLocalDateString);
    assert.ok(copy);
    assert.match(copy.body, /still time today/);
});

test('the morning after a miss carries the user\'s own words, verbatim', () => {
    const doc = userDoc([]);                       // nothing logged at all
    const copy = modeReminderCopy(habitReminder('pre'), doc, 'UTC', '2026-03-10', getLocalDateString);
    assert.ok(copy);
    // The exact sentence the user typed, character for character. This is the
    // spec's hardest requirement on this path — no paraphrase, no summary.
    assert.ok(
        copy.body.includes('Because I want to be someone who finishes things.'),
        'the why text must appear verbatim, got: ' + copy.body);
    assert.match(copy.body, /Never too late/);
});

test('a miss with no why text still says something true', () => {
    const doc = userDoc([]);
    const copy = modeReminderCopy(habitReminder('pre', { why: '' }), doc, 'UTC', '2026-03-10', getLocalDateString);
    assert.ok(copy);
    assert.match(copy.body, /Yesterday slipped past/);
    assert.match(copy.body, /Evening pages/);
});

test('a renamed activity is announced under its current name', () => {
    const doc = userDoc(['2026-03-09']);
    doc.dimensions[0].paths[0].activities[0].name = 'Morning pages';
    const copy = modeReminderCopy(habitReminder('pre'), doc, 'UTC', '2026-03-10', getLocalDateString);
    assert.match(copy.body, /Morning pages/);
});

test('a reminder whose mode has ended says nothing', () => {
    const doc = userDoc([], { active: null });
    assert.strictEqual(
        modeReminderCopy(habitReminder('pre'), doc, 'UTC', '2026-03-10', getLocalDateString), null);
});

test('a reminder from a different mode run says nothing', () => {
    const doc = userDoc([], { active: { kind: 'habit', id: 'md-something-else' } });
    assert.strictEqual(
        modeReminderCopy(habitReminder('pre'), doc, 'UTC', '2026-03-10', getLocalDateString), null);
});

test('the focus window nudge names its opening time', () => {
    const doc = userDoc([], { active: { kind: 'focus', id: MODE_ID } });
    const reminder = {
        type: 'mode', modeKind: 'focus', modeId: MODE_ID, phase: 'pre',
        activityId: null, windowStart: '18:00', windowEnd: '20:00',
    };
    const copy = modeReminderCopy(reminder, doc, 'UTC', '2026-03-10', getLocalDateString);
    assert.ok(copy);
    assert.match(copy.body, /18:00/);
});

// ── The payload ──────────────────────────────────────────────────────────

test('a mode payload carries the decided body and a distinct tag per phase', () => {
    const pre = buildPayload(habitReminder('pre'), null, { body: 'first' });
    const post = buildPayload(habitReminder('post'), null, { body: 'second' });
    assert.strictEqual(pre.body, 'first');
    assert.strictEqual(post.body, 'second');
    assert.notStrictEqual(pre.tag, post.tag, 'the two nudges must not replace each other');
    assert.strictEqual(pre.data.type, 'mode');
    assert.strictEqual(pre.data.activityId, ACT_ID);
});

test('a mode payload never collides with an activity reminder for the same activity', () => {
    const mode = buildPayload(habitReminder('pre'), null, { body: 'x' });
    const activity = buildPayload({ type: 'activity', activityId: ACT_ID }, 'Evening pages');
    assert.notStrictEqual(mode.tag, activity.tag);
});
