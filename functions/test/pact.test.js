'use strict';

// The gap nudge is the one piece of notification logic in this codebase that
// can spam someone if it is even slightly wrong: the condition it watches
// flaps by design, so "fire while the gap is wide" would push on essentially
// every completion for the rest of a pact. The arm/disarm and the hard cap are
// what stop that, and they are only observable across a SEQUENCE of writes —
// which is what most of the tests below are.
//
// The read tolerance is the other half. Both document shapes have to produce
// the same percentages, or a pact created before multi-activity support would
// nudge at the wrong moments for the rest of its life.

const test = require('node:test');
const assert = require('node:assert');

const { items, count, stats, progressNudges, GAP_NUDGE_CAP } = require('../lib/pact');

const A = 'uid-alice';
const B = 'uid-bob';

/** A live pact in the CURRENT shape: a list of activities per side. */
function pact(overrides) {
    return Object.assign({
        status: 'active',
        participants: [A, B],
        createdBy: A,
        partner: B,
        names: { [A]: 'Alice', [B]: 'Bob' },
        terms: {
            [A]: { items: [
                { activityId: 'act-1', activityName: 'Run', target: 10 },
                { activityId: 'act-2', activityName: 'Read', target: 10 },
            ] },
            [B]: { items: [
                { activityId: 'act-9', activityName: 'Swim', target: 20 },
            ] },
        },
        progress: { [A]: {}, [B]: {} },
    }, overrides || {});
}

/** A pact in the ORIGINAL shape: one activity a side, a bare number of them. */
function legacyPact(overrides) {
    return Object.assign({
        status: 'active',
        participants: [A, B],
        names: { [A]: 'Alice', [B]: 'Bob' },
        terms: {
            [A]: { activityId: 'act-1', activityName: 'Run', target: 10 },
            [B]: { activityId: 'act-9', activityName: 'Swim', target: 10 },
        },
        progress: { [A]: 0, [B]: 0 },
    }, overrides || {});
}

/** Apply a returned patch the way Firestore's dotted update would. */
function applyPatch(doc, patch) {
    const next = JSON.parse(JSON.stringify(doc));
    for (const [key, value] of Object.entries(patch)) {
        const parts = key.split('.');
        let node = next;
        while (parts.length > 1) {
            const part = parts.shift();
            if (typeof node[part] !== 'object' || node[part] === null) node[part] = {};
            node = node[part];
        }
        node[parts[0]] = value;
    }
    return next;
}

// ── Read tolerance ────────────────────────────────────────────────────────

test('items and count read the multi-activity shape', () => {
    const p = pact({ progress: { [A]: { 'act-1': 4 }, [B]: {} } });
    assert.strictEqual(items(p, A).length, 2);
    assert.strictEqual(count(p, A, 'act-1'), 4);
    assert.strictEqual(count(p, A, 'act-2'), 0);
});

test('items and count read the original single-activity shape', () => {
    const p = legacyPact({ progress: { [A]: 6, [B]: 0 } });
    assert.strictEqual(items(p, A).length, 1);
    assert.strictEqual(items(p, A)[0].activityName, 'Run');
    // The bare number IS that one activity's counter, whatever id is asked for.
    assert.strictEqual(count(p, A, 'act-1'), 6);
});

test('a side with no term at all reads as empty, not as complete', () => {
    const p = pact({ terms: { [A]: pact().terms[A] } });   // B has not accepted
    assert.deepStrictEqual(items(p, B), []);
    assert.strictEqual(stats(p, B).hit, false);
    assert.strictEqual(stats(p, B).pct, 0);
});

// ── Percentages ───────────────────────────────────────────────────────────

test('percentage spans every activity, not just the one being logged', () => {
    const p = pact({ progress: { [A]: { 'act-1': 10 }, [B]: {} } });
    assert.strictEqual(stats(p, A).pct, 50);   // 10 of 20 across both
    assert.strictEqual(stats(p, A).hit, false);
});

test('an over-logged activity cannot carry an under-logged one', () => {
    const p = pact({ progress: { [A]: { 'act-1': 500 }, [B]: {} } });
    assert.strictEqual(stats(p, A).done, 10);
    assert.strictEqual(stats(p, A).pct, 50);
    assert.strictEqual(stats(p, A).hit, false);
});

test('hit needs every activity at its target', () => {
    const done = pact({ progress: { [A]: { 'act-1': 10, 'act-2': 10 }, [B]: {} } });
    assert.strictEqual(stats(done, A).hit, true);
    assert.strictEqual(stats(done, A).pct, 100);
});

test('the original shape produces the same percentages', () => {
    const p = legacyPact({ progress: { [A]: 5, [B]: 0 } });
    assert.strictEqual(stats(p, A).pct, 50);
    assert.strictEqual(stats(p, B).pct, 0);
});

// ── Halfway ───────────────────────────────────────────────────────────────

test('halfway pushes the OTHER party, once, and stamps the flag', () => {
    const p = pact({ progress: { [A]: { 'act-1': 10 }, [B]: {} } });
    const { patch, pushes } = progressNudges(p);
    assert.strictEqual(patch['reached50.' + A], true);
    const halves = pushes.filter((x) => x.tagSuffix === 'half');
    assert.strictEqual(halves.length, 1);
    assert.strictEqual(halves[0].uid, B);
    assert.match(halves[0].body, /Alice is halfway/);
});

test('halfway never fires twice for the same party', () => {
    let p = pact({ progress: { [A]: { 'act-1': 10 }, [B]: {} } });
    p = applyPatch(p, progressNudges(p).patch);
    // More progress, same party, well past the mark.
    p.progress[A]['act-2'] = 9;
    const again = progressNudges(p).pushes.filter((x) => x.tagSuffix === 'half');
    assert.strictEqual(again.length, 0);
});

test('halfway is per party — both can earn it, and never more', () => {
    let p = pact({ progress: { [A]: { 'act-1': 10 }, [B]: { 'act-9': 10 } } });
    const first = progressNudges(p);
    assert.strictEqual(first.pushes.filter((x) => x.tagSuffix === 'half').length, 2);
    p = applyPatch(p, first.patch);
    assert.strictEqual(progressNudges(p).pushes.filter((x) => x.tagSuffix === 'half').length, 0);
});

// ── The gap ───────────────────────────────────────────────────────────────

test('a 30-point gap pushes BOTH sides, and counts as one event', () => {
    const p = pact({ progress: { [A]: { 'act-1': 8 }, [B]: {} } });   // 40% vs 0%
    const { patch, pushes } = progressNudges(p);
    const gaps = pushes.filter((x) => x.tagSuffix === 'gap');
    assert.strictEqual(gaps.length, 2);
    assert.strictEqual(patch.gapNudgeCount, 1, 'two pushes, one event');
    assert.strictEqual(patch.gapNudgeArmed, false);

    const trailing = gaps.find((x) => x.uid === B);
    const leading = gaps.find((x) => x.uid === A);
    assert.match(trailing.body, /Alice is pulling ahead/);
    assert.match(leading.body, /well ahead of Bob/);
});

test('a gap under the threshold fires nothing', () => {
    const p = pact({ progress: { [A]: { 'act-1': 5 }, [B]: { 'act-9': 4 } } });  // 25% vs 20%
    assert.strictEqual(progressNudges(p).pushes.filter((x) => x.tagSuffix === 'gap').length, 0);
});

test('a wide gap that stays wide does NOT re-fire — this is the spam case', () => {
    let p = pact({ progress: { [A]: { 'act-1': 8 }, [B]: {} } });
    p = applyPatch(p, progressNudges(p).patch);

    // Twelve more completions by the leader. The gap only widens.
    for (let n = 9; n <= 20; n++) {
        p.progress[A] = { 'act-1': Math.min(10, n), 'act-2': Math.max(0, n - 10) };
        const out = progressNudges(p);
        assert.strictEqual(
            out.pushes.filter((x) => x.tagSuffix === 'gap').length, 0,
            'gap nudge re-fired while disarmed at n=' + n
        );
        p = applyPatch(p, out.patch);
    }
    assert.strictEqual(p.gapNudgeCount, 1);
});

test('the gap re-arms only after closing back under the threshold', () => {
    let p = pact({ progress: { [A]: { 'act-1': 8 }, [B]: {} } });
    p = applyPatch(p, progressNudges(p).patch);
    assert.strictEqual(p.gapNudgeArmed, false);

    // Bob catches up to within the threshold — re-armed, but silent.
    p.progress[B] = { 'act-9': 8 };                     // 40% vs 40%
    const closing = progressNudges(p);
    assert.strictEqual(closing.pushes.filter((x) => x.tagSuffix === 'gap').length, 0);
    assert.strictEqual(closing.patch.gapNudgeArmed, true);
    p = applyPatch(p, closing.patch);

    // It opens again — a new event.
    p.progress[A] = { 'act-1': 10, 'act-2': 6 };        // 80% vs 40%
    const reopened = progressNudges(p);
    assert.strictEqual(reopened.pushes.filter((x) => x.tagSuffix === 'gap').length, 2);
    assert.strictEqual(reopened.patch.gapNudgeCount, 2);
});

test('the gap nudge stops for good after three events', () => {
    let p = pact();
    let events = 0;

    // Open and close the gap far more times than the cap allows.
    for (let round = 0; round < 8; round++) {
        p.progress[A] = { 'act-1': 10, 'act-2': 0 };    // 50% vs 0% — wide
        p.progress[B] = {};
        let out = progressNudges(p);
        if (out.pushes.some((x) => x.tagSuffix === 'gap')) events += 1;
        p = applyPatch(p, out.patch);

        p.progress[B] = { 'act-9': 10 };                // 50% vs 50% — closed
        p = applyPatch(p, progressNudges(p).patch);
    }

    assert.strictEqual(events, GAP_NUDGE_CAP);
    assert.strictEqual(p.gapNudgeCount, GAP_NUDGE_CAP);
});

test('the original document shape drives the gap nudge just the same', () => {
    const p = legacyPact({ progress: { [A]: 7, [B]: 1 } });   // 70% vs 10%
    const out = progressNudges(p);
    assert.strictEqual(out.pushes.filter((x) => x.tagSuffix === 'gap').length, 2);
    assert.strictEqual(out.patch.gapNudgeCount, 1);
});

// ── Everything else stays quiet ───────────────────────────────────────────

test('a pact that is not active earns nothing', () => {
    ['pending', 'resolved', 'declined', 'cancelled', 'expired'].forEach((status) => {
        const p = pact({ status, progress: { [A]: { 'act-1': 10 }, [B]: {} } });
        const out = progressNudges(p);
        assert.deepStrictEqual(out.pushes, [], status);
        assert.deepStrictEqual(out.patch, {}, status);
    });
});

test('a fresh pact with no progress writes nothing at all', () => {
    const out = progressNudges(pact());
    assert.deepStrictEqual(out.patch, {}, 'no write means no re-entrant trigger run');
    assert.deepStrictEqual(out.pushes, []);
});

test('a nudge falls back to a neutral name when one is missing', () => {
    const p = pact({ names: {}, progress: { [A]: { 'act-1': 8 }, [B]: {} } });
    p.gapNudgeArmed = false;   // isolate the halfway copy
    const half = progressNudges(p).pushes.find((x) => x.tagSuffix === 'half');
    assert.strictEqual(half, undefined, '40% is not halfway');

    const p2 = pact({ names: {}, progress: { [A]: { 'act-1': 10 }, [B]: {} } });
    const body = progressNudges(p2).pushes.find((x) => x.tagSuffix === 'half').body;
    assert.match(body, /^Your partner is halfway/);
});
