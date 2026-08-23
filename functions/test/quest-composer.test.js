const assert = require('node:assert');
const { test } = require('node:test');
const qc = require('../lib/quest-composer');

const ctx = {
    activityIds: new Set(['a1', 'a2', 'a3']),
    dimIds: new Set(['d1', 'd2']),
    fallbackDim: 'd1',
};
const counter = () => ({ newActs: 0, leaves: 0 });
const leaf = (o) => Object.assign({ kind: 'leaf' }, o);
const grp = (children, o) => Object.assign({ kind: 'group', name: 'G', children }, o || {});

// ── the repair behaviour that made quests generate at all ────────────────────

test('a spec wrapper is optional', () => {
    const withWrap = qc.validateSpec({ spec: { name: 'X', groups: [grp([leaf({ type: 'task', name: 's' })])] } }, ctx);
    const without = qc.validateSpec({ name: 'X', groups: [grp([leaf({ type: 'task', name: 's' })])] }, ctx);
    assert.ok(withWrap && without);
    assert.strictEqual(withWrap.groups.length, 1);
    assert.strictEqual(without.groups.length, 1);
});

test('loose leaves where groups belong are gathered, not dropped', () => {
    const spec = qc.validateSpec({
        name: 'X',
        groups: [leaf({ type: 'activity', linkedActivityId: 'a1' }), leaf({ type: 'task', name: 'buy soil' })],
    }, ctx);
    assert.ok(spec, 'the quest survived');
    assert.strictEqual(spec.groups.length, 1);
    assert.strictEqual(spec.groups[0].name, 'Steps');
    assert.strictEqual(spec.groups[0].children.length, 2);
});

test('a mix of real groups and loose leaves keeps both', () => {
    const spec = qc.validateSpec({
        name: 'X',
        groups: [grp([leaf({ type: 'task', name: 'a' })]), leaf({ type: 'task', name: 'loose' })],
    }, ctx);
    assert.strictEqual(spec.groups.length, 2);
    assert.strictEqual(spec.groups[1].name, 'Steps');
});

test('zero valid groups is a failure, not a half-empty quest', () => {
    assert.strictEqual(qc.validateSpec({ name: 'X', groups: [] }, ctx), null);
    assert.strictEqual(qc.validateSpec({ name: 'X', groups: [grp([])] }, ctx), null);
    assert.strictEqual(qc.validateSpec(null, ctx), null);
    // a group of nothing but unusable leaves
    assert.strictEqual(qc.validateSpec({ name: 'X', groups: [grp([leaf({ type: 'task' })])] }, ctx), null);
});

// ── invented ids ────────────────────────────────────────────────────────────

test('a real linkedActivityId is kept', () => {
    const l = qc.validateLeaf(leaf({ type: 'activity', linkedActivityId: 'a1', requiredCount: 3 }), ctx, counter());
    assert.strictEqual(l.type, 'activity');
    assert.strictEqual(l.linkedActivityId, 'a1');
    assert.strictEqual(l.requiredCount, 3);
});

test('an invented linkedActivityId never reaches the client', () => {
    // no spec, no name -> unusable, dropped
    assert.strictEqual(qc.validateLeaf(leaf({ type: 'activity', linkedActivityId: 'GHOST' }), ctx, counter()), null);
    // with a name it degrades to a task rather than a broken activity link
    const l = qc.validateLeaf(leaf({ type: 'activity', linkedActivityId: 'GHOST', name: 'do it' }), ctx, counter());
    assert.strictEqual(l.type, 'activity');           // it has a usable spec via name
    assert.strictEqual(l.linkedActivityId, null);     // but never the invented id
});

test('a new-activity leaf falls back to a real dimension', () => {
    const l = qc.validateLeaf(leaf({
        type: 'activity', spec: { name: 'Write', baseXP: 9, frequency: 'daily', dimensionId: 'NOPE' },
    }), ctx, counter());
    assert.strictEqual(l.spec.dimensionId, 'd1');
    assert.strictEqual(l.spec.frequency, 'daily');
});

test('a bogus frequency falls back to weekly, baseXP is clamped', () => {
    const l = qc.validateLeaf(leaf({
        type: 'activity', spec: { name: 'X', baseXP: 9999, frequency: 'hourly', dimensionId: 'd2' },
    }), ctx, counter());
    assert.strictEqual(l.spec.frequency, 'weekly');
    assert.strictEqual(l.spec.baseXP, 50);
});

// ── caps enforced in code, not just asked for in the prompt ─────────────────

test('the new-activity cap demotes the excess to tasks', () => {
    const c = counter();
    const made = [1, 2, 3, 4, 5].map((i) => qc.validateLeaf(leaf({
        type: 'activity', name: 'New ' + i, spec: { name: 'New ' + i, baseXP: 8, frequency: 'daily', dimensionId: 'd1' },
    }), ctx, c));
    assert.strictEqual(made.filter((x) => x.type === 'activity').length, qc.MAX_NEW_ACTIVITIES);
    assert.strictEqual(made.filter((x) => x.type === 'task').length, 2, 'demoted, not dropped');
});

test('total leaves are truncated at the cap', () => {
    const many = [];
    for (let i = 0; i < 40; i++) many.push(leaf({ type: 'task', name: 'step ' + i }));
    const spec = qc.validateSpec({ name: 'X', groups: [grp(many)] }, ctx);
    let count = 0;
    (function walk(ns) { ns.forEach((n) => (n.kind === 'group' ? walk(n.children) : count++)); })(spec.groups);
    assert.strictEqual(count, qc.MAX_LEAVES);
});

test('excess depth is flattened, and its steps survive', () => {
    // 5 deep, one leaf at the bottom
    let node = grp([leaf({ type: 'task', name: 'deep' })]);
    for (let i = 0; i < 4; i++) node = grp([node]);
    const spec = qc.validateSpec({ name: 'X', groups: [node] }, ctx);
    assert.ok(spec, 'not rejected for being too deep');
    let deepest = 0, leaves = 0;
    (function walk(ns, d) {
        ns.forEach((n) => {
            if (n.kind === 'group') { deepest = Math.max(deepest, d + 1); walk(n.children, d + 1); }
            else leaves++;
        });
    })(spec.groups, 0);
    assert.ok(deepest <= qc.MAX_DEPTH, 'depth ' + deepest + ' is within ' + qc.MAX_DEPTH);
    assert.strictEqual(leaves, 1, 'the buried step survived the flattening');
});

// ── cadence ─────────────────────────────────────────────────────────────────

test('cadence honours the model, then the requested shape', () => {
    const g = [grp([leaf({ type: 'task', name: 's' })])];
    assert.strictEqual(qc.validateSpec({ groups: g, cadence: { type: 'recurring' } }, ctx, 'oneoff').cadence.type, 'recurring');
    assert.strictEqual(qc.validateSpec({ groups: g }, ctx, 'recurring').cadence.type, 'recurring');
    assert.strictEqual(qc.validateSpec({ groups: g }, ctx, 'oneoff').cadence.type, 'oneoff');
    assert.strictEqual(qc.validateSpec({ groups: g, cadence: { type: 'nonsense' } }, ctx, 'recurring').cadence.type, 'recurring');
});

// ── which activities get offered to the model ───────────────────────────────

const mkUser = (acts) => ({
    dimensions: [{ id: 'd1', name: 'Body', paths: [{ id: 'p1', name: 'Fit', activities: acts }] }],
});
const act = (id, name, daysAgo, extra) => Object.assign({
    id, name, baseXP: 10, frequency: 'weekly',
    completionHistory: daysAgo === null ? [] : [{ date: new Date(Date.now() - daysAgo * 86400000).toISOString(), xp: 10 }],
}, extra || {});

test('only live activities are sent', () => {
    const live = qc.liveActivities(mkUser([
        act('a1', 'Run', 1),        // inside a 7-day window
        act('a2', 'Parked', 40),    // long dormant
        act('a3', 'Never', null),   // never completed
    ]));
    assert.deepStrictEqual(live.map((a) => a.id), ['a1']);
});

test('the lookback window is frequency-shaped', () => {
    const live = qc.liveActivities(mkUser([
        act('m1', 'Monthly', 20, { frequency: 'monthly' }),   // 30-day window — live
        act('w1', 'Weekly', 20, { frequency: 'weekly' }),     // 7-day window — dormant
    ]));
    assert.deepStrictEqual(live.map((a) => a.id), ['m1']);
});

test('archived, deleted and punitive activities are excluded', () => {
    const live = qc.liveActivities(mkUser([
        act('a1', 'Fine', 1),
        act('a2', 'Archived', 1, { archived: true }),
        act('a3', 'Deleted', 1, { deleted: true }),
        act('a4', 'Punitive', 1, { isNegative: true, isSkipNegative: false }),
    ]));
    assert.deepStrictEqual(live.map((a) => a.id), ['a1']);
});

test('most recently completed first, capped at 40', () => {
    const acts = [];
    for (let i = 0; i < 60; i++) acts.push(act('a' + i, 'A' + i, (i % 6) * 0.5));
    const live = qc.liveActivities(mkUser(acts));
    assert.strictEqual(live.length, 40);
    assert.ok(live[0].name);
});

test('a penalty entry does not count as a completion', () => {
    const user = mkUser([{
        id: 'p1', name: 'Penalised', baseXP: 5, frequency: 'weekly',
        completionHistory: [{ date: new Date().toISOString(), xp: -5, isPenalty: true }],
    }]);
    assert.strictEqual(qc.liveActivities(user).length, 0);
});

// ── prompt ──────────────────────────────────────────────────────────────────

test('the prompt carries the request, shape and the real ids', () => {
    const p = qc.buildComposePrompt({
        activities: [{ id: 'a1', name: 'Run' }],
        dimensions: [{ id: 'd1', name: 'Body' }],
        request: 'Run a 10K in eight weeks',
        shape: 'oneoff',
        size: 'weeks',
    });
    assert.match(p.user, /Run a 10K in eight weeks/);
    assert.match(p.user, /"a1"/);
    assert.match(p.user, /a few weeks/);
    assert.match(p.system, /STRONGLY PREFER linked leaves/);
    assert.match(p.system, /No prose, no markdown fences/);
});
