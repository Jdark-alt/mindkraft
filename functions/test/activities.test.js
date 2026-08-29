'use strict';

// Tests for reading activities out of the nested user document.
// Activities are nested arrays inside users/{uid}, not their own documents,
// so this traversal is the only thing standing between a reminder and a
// wrong activity name.

const test = require('node:test');
const assert = require('node:assert');

const { findActivity, resolveActivityName } = require('../lib/activities');
const { buildPayload } = require('../lib/push');

/** A user doc shaped exactly like the real thing (see app.js dimensions tree). */
function userDoc() {
    return {
        dimensions: [
            {
                id: '1700000000001',
                name: 'Body',
                paths: [
                    {
                        id: '1700000000010',
                        name: 'Fitness',
                        activities: [
                            { id: '1700000000100', name: 'Morning run', baseXP: 20 },
                            { id: '1700000000101', name: 'Stretching', baseXP: 10 },
                        ],
                    },
                    { id: '1700000000011', name: 'Empty path', activities: [] },
                ],
            },
            {
                id: '1700000000002',
                name: 'Mind',
                paths: [
                    {
                        id: '1700000000020',
                        name: 'Learning',
                        activities: [{ id: '1700000000200', name: 'Read 20 pages', baseXP: 15 }],
                    },
                ],
            },
        ],
    };
}

test('finds an activity nested three levels deep', () => {
    const found = findActivity(userDoc(), '1700000000200');
    assert.ok(found);
    assert.strictEqual(found.activity.name, 'Read 20 pages');
    assert.strictEqual(found.dimension.name, 'Mind');
    assert.strictEqual(found.path.name, 'Learning');
});

test('matches ids across the string/number boundary', () => {
    // Ids are generated as Date.now().toString() but a client could round-trip
    // one as a number; both must resolve to the same activity.
    assert.ok(findActivity(userDoc(), 1700000000100));
    assert.ok(findActivity(userDoc(), '1700000000100'));
});

test('returns null for an activity that has been deleted', () => {
    assert.strictEqual(findActivity(userDoc(), '9999999999999'), null);
});

test('survives missing or empty branches of the tree', () => {
    assert.strictEqual(findActivity(null, '1'), null);
    assert.strictEqual(findActivity({}, '1'), null);
    assert.strictEqual(findActivity({ dimensions: [] }, '1'), null);
    assert.strictEqual(findActivity({ dimensions: [{ id: 'd' }] }, '1'), null);
    assert.strictEqual(findActivity({ dimensions: [{ id: 'd', paths: [{ id: 'p' }] }] }, '1'), null);
    assert.strictEqual(findActivity(userDoc(), null), null);
});

test('resolveActivityName returns the current name, so renames are picked up', () => {
    const data = userDoc();
    assert.strictEqual(resolveActivityName(data, '1700000000100'), 'Morning run');

    data.dimensions[0].paths[0].activities[0].name = 'Evening run';
    assert.strictEqual(resolveActivityName(data, '1700000000100'), 'Evening run');
});

test('resolveActivityName returns null for a deleted activity', () => {
    // This is what retires the reminder instead of firing under a stale name.
    assert.strictEqual(resolveActivityName(userDoc(), '9999999999999'), null);
});

test('resolveActivityName treats a blank name as missing', () => {
    const data = userDoc();
    data.dimensions[0].paths[0].activities[0].name = '   ';
    assert.strictEqual(resolveActivityName(data, '1700000000100'), null);
});

// ── Notification payloads ────────────────────────────────────────────────

test('general reminder keeps the existing copy verbatim', () => {
    const payload = buildPayload({ type: 'general' }, null);
    assert.strictEqual(payload.title, 'Mindkraft');
    assert.strictEqual(payload.body, "Don't forget to check off today's tasks!");
    assert.strictEqual(payload.tag, 'mindkraft-daily-reminder');
    assert.strictEqual(payload.data.type, 'general');
    assert.strictEqual(payload.data.activityId, null);
});

test('activity reminder names the activity and carries a deep-link id', () => {
    const payload = buildPayload({ type: 'activity', activityId: '1700000000100', activityName: 'Old name' }, 'Morning run');
    assert.strictEqual(payload.body, 'Morning run — time to log it');
    assert.strictEqual(payload.data.type, 'activity');
    assert.strictEqual(payload.data.activityId, '1700000000100');
});

test('activity reminders get per-activity tags so two do not replace each other', () => {
    const a = buildPayload({ type: 'activity', activityId: '100' }, 'Run');
    const b = buildPayload({ type: 'activity', activityId: '200' }, 'Read');
    assert.notStrictEqual(a.tag, b.tag);
});

test('activity payload falls back to the denormalized name, then a generic label', () => {
    const stale = buildPayload({ type: 'activity', activityId: '1', activityName: 'Denormalized' }, null);
    assert.strictEqual(stale.body, 'Denormalized — time to log it');

    const nothing = buildPayload({ type: 'activity', activityId: '1' }, null);
    assert.strictEqual(nothing.body, 'Your activity — time to log it');
});
