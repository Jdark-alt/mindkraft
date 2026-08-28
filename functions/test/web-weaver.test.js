'use strict';

// The Map weaver's two jobs the deployed function cannot be trusted to get
// right by inspection: the GATES (the server is the sole authority on whether
// a weave is honoured — a tampered client can ask for anything) and the
// MATERIALIZER (a model that returns almost-right JSON must degrade to a
// smaller valid web, never to a broken one).

const test = require('node:test');
const assert = require('node:assert');

const w = require('../lib/web-weaver');

const DAY = 86400000;
const ago = (days) => new Date(Date.now() - days * DAY).toISOString();

function userDoc(overrides) {
    return Object.assign({
        dimensions: [
            {
                id: 'd1',
                name: 'Body',
                paths: [{
                    id: 'p1',
                    name: 'Fitness',
                    activities: [
                        { id: 'a1', name: 'Run', baseXP: 12, frequency: 'weekly', completionHistory: [] },
                        { id: 'a2', name: 'Stretch', baseXP: 8, frequency: 'daily', completionHistory: [] },
                    ],
                }],
            },
            {
                id: 'd2',
                name: 'Mind',
                paths: [{
                    id: 'p2',
                    name: 'Focus',
                    activities: [{ id: 'a3', name: 'Read', baseXP: 10, frequency: 'weekly', completionHistory: [] }],
                }],
            },
        ],
    }, overrides || {});
}

function techTree(overrides) {
    return Object.assign({
        schemaVersion: 3,
        status: 'empty',
        goals: [{ id: 'g1', rawText: 'Run a half marathon', color: '#a8446e', retiredAt: null }],
        nodes: [],
        rejections: [],
    }, overrides || {});
}

const activityPayload = (name) => ({
    type: 'activity',
    spec: { name, description: 'x', baseXP: 10, frequency: 'weekly', dimensionId: 'd1' },
    mastery: { target: 6, windowDays: 90 },
});

// ── Gates ───────────────────────────────────────────────────────────────────

test('a first generation needs a goal and three activities', () => {
    const u = userDoc();
    assert.strictEqual(w.gateFor('generate', techTree(), u, {}, {}), null);

    const noGoals = techTree({ goals: [] });
    assert.strictEqual(w.gateFor('generate', noGoals, u, {}, {}).reason, 'gate');

    const thin = userDoc({ dimensions: [{ id: 'd1', name: 'Body', paths: [{ id: 'p1', activities: [{ id: 'a1', name: 'Run' }] }] }] });
    assert.strictEqual(w.gateFor('generate', techTree(), thin, {}, {}).reason, 'gate');
});

test('a retired goal does not satisfy the generate gate', () => {
    const tt = techTree({ goals: [{ id: 'g1', rawText: 'Old', retiredAt: ago(3) }] });
    assert.strictEqual(w.gateFor('generate', tt, userDoc(), {}, {}).reason, 'gate');
});

test('the first weave is free — the clock starts at the first regeneration', () => {
    const empty = techTree();
    // No nodes yet, and no recorded regeneration: allowed even though the
    // usage record is untouched.
    assert.strictEqual(w.gateFor('generate', empty, userDoc(), {}, {}), null);

    // A web that already exists: regenerating it is the monthly one.
    const grown = techTree({ nodes: [{ id: 'n1', lifecycle: 'available', title: 'X' }] });
    assert.strictEqual(w.gateFor('generate', grown, userDoc(), {}, { lastTreeRegenAt: ago(3) }).reason, 'cooldown');
    assert.strictEqual(w.gateFor('generate', grown, userDoc(), {}, { lastTreeRegenAt: ago(31) }), null);
});

test('an initial generation never starts the tree clock', () => {
    // Only archived nodes left: still counts as an empty web, still free.
    const tt = techTree({ nodes: [{ id: 'n1', lifecycle: 'archived', title: 'X' }] });
    assert.strictEqual(w.gateFor('generate', tt, userDoc(), {}, { lastTreeRegenAt: ago(1) }), null);
});

test('each goal carries its own monthly reweave clock', () => {
    const tt = techTree({
        goals: [
            { id: 'g1', rawText: 'A', retiredAt: null },
            { id: 'g2', rawText: 'B', retiredAt: null },
        ],
        nodes: [{ id: 'n1', lifecycle: 'available', title: 'X' }],
    });
    const usage = { goalRegenAt: { g1: ago(2) } };
    const blocked = w.gateFor('regenerate', tt, userDoc(), { goalId: 'g1' }, usage);
    assert.strictEqual(blocked.reason, 'cooldown');
    assert.strictEqual(blocked.days, 28);
    // g2 has never been rewoven, so its own clock has not started.
    assert.strictEqual(w.gateFor('regenerate', tt, userDoc(), { goalId: 'g2' }, usage), null);
});

test('the tree clock and the goal clocks are independent', () => {
    const tt = techTree({ nodes: [{ id: 'n1', lifecycle: 'available', title: 'X' }] });
    const usage = { lastTreeRegenAt: ago(1), goalRegenAt: {} };
    assert.strictEqual(w.gateFor('generate', tt, userDoc(), {}, usage).reason, 'cooldown');
    assert.strictEqual(w.gateFor('regenerate', tt, userDoc(), { goalId: 'g1' }, usage), null);
});

test('a weave for a goal that no longer exists is refused', () => {
    const tt = techTree({ nodes: [{ id: 'n1', lifecycle: 'available', title: 'X' }] });
    assert.strictEqual(w.gateFor('regenerate', tt, userDoc(), { goalId: 'nope' }, {}).reason, 'gate');
    assert.strictEqual(w.gateFor('add_goal', tt, userDoc(), { goalId: 'nope' }, {}).reason, 'gate');
});

test('expansion needs a web to grow from', () => {
    assert.strictEqual(w.gateFor('expand', techTree(), userDoc(), {}, {}).reason, 'gate');
    const grown = techTree({ nodes: [{ id: 'n1', lifecycle: 'available', title: 'X' }] });
    assert.strictEqual(w.gateFor('expand', grown, userDoc(), {}, {}), null);
});

// ── Payload validation ──────────────────────────────────────────────────────

const ctx = () => ({
    dimIds: new Set(['d1', 'd2']),
    pathIds: new Set(['p1', 'p2']),
    activityIds: new Set(['a1', 'a2', 'a3']),
    fallbackDim: 'd1',
    title: 'Fallback title',
    description: '',
    dimensionId: 'd1',
});

test('an unknown payload type is dropped, not repaired', () => {
    assert.strictEqual(w.validatePayload({ type: 'quest', spec: {} }, ctx()), null);
    assert.strictEqual(w.validatePayload(null, ctx()), null);
});

test('an out-of-range frequency and XP are clamped, not rejected', () => {
    const p = w.validatePayload({
        type: 'activity',
        spec: { name: 'Tempo run', frequency: 'hourly', baseXP: 900, dimensionId: 'nope' },
    }, ctx());
    assert.strictEqual(p.spec.frequency, 'weekly');
    assert.strictEqual(p.spec.baseXP, 50);
    assert.strictEqual(p.spec.dimensionId, 'd1', 'an invented dimension falls back');
});

// ── Materialization ─────────────────────────────────────────────────────────

function generateResponse() {
    return {
        vision: 'You run further than you thought.',
        goals: [{
            fromGoalId: 'g1',
            sharpened: 'Finish a half marathon in under 2h',
            shortName: 'Half',
            kind: 'destination',
            anchors: [{ activityId: 'a1', whyNow: null }],
            nodes: [
                {
                    role: 'suggestion', title: 'Long slow run', description: 'One longer run a week.',
                    dimensionId: 'd1',
                    prerequisites: [{ type: 'activity_mastered', activityId: 'a1' }],
                    payload: activityPayload('Long slow run'),
                },
                {
                    role: 'suggestion', title: 'Tempo intervals', description: 'Faster efforts.',
                    dimensionId: 'd1',
                    prerequisites: [{ type: 'node_mastered', nodeTitle: 'Long slow run' }],
                    payload: activityPayload('Tempo intervals'),
                },
            ],
        }],
        fusions: [],
        wildcards: [{
            role: 'wildcard', title: 'Call someone you miss', description: 'Once a week.',
            dimensionId: 'd2', payload: activityPayload('Call someone you miss'),
        }],
    };
}

test('a generate response becomes anchors, a locked chain and a wildcard', () => {
    const u = userDoc();
    const built = w.materializeWeb(generateResponse(), u, techTree().goals, { positional: false, keepColorsOf: [] });

    assert.strictEqual(built.goals.length, 1);
    assert.strictEqual(built.goals[0].id, 'g1', 'fromGoalId binds to the existing goal');
    assert.strictEqual(built.goals[0].sharpened, 'Finish a half marathon in under 2h');

    const byTitle = Object.fromEntries(built.nodes.map((n) => [n.title, n]));
    assert.strictEqual(byTitle.Run.role, 'anchor');
    assert.strictEqual(byTitle.Run.lifecycle, 'active');
    assert.strictEqual(byTitle['Long slow run'].lifecycle, 'locked', 'its anchor is not mastered yet');
    assert.strictEqual(byTitle['Call someone you miss'].lifecycle, 'available');
    assert.strictEqual(byTitle['Call someone you miss'].prerequisites.length, 0);

    // Tier 2 hangs off tier 1 by resolved id, not by title.
    const tier2 = byTitle['Tempo intervals'];
    assert.strictEqual(tier2.prerequisites[0].type, 'node_mastered');
    assert.strictEqual(tier2.prerequisites[0].nodeId, byTitle['Long slow run'].id);
});

test('a node whose payload is unusable is dropped without losing the rest', () => {
    const res = generateResponse();
    res.goals[0].nodes[0].payload = { type: 'quest' };
    const built = w.materializeWeb(res, userDoc(), techTree().goals, {});
    const titles = built.nodes.map((n) => n.title);
    assert.ok(!titles.includes('Long slow run'));
    assert.ok(titles.includes('Run'), 'the anchor survives');
    // Its child loses an unresolvable prerequisite rather than pointing at nothing.
    const orphan = built.nodes.find((n) => n.title === 'Tempo intervals');
    assert.strictEqual(orphan.prerequisites.length, 0);
});

test('an invented activityId never becomes an anchor', () => {
    const res = generateResponse();
    res.goals[0].anchors = [{ activityId: 'ghost' }];
    const built = w.materializeWeb(res, userDoc(), techTree().goals, {});
    assert.ok(!built.nodes.some((n) => n.role === 'anchor'));
});

test('a fusion needs two real sources in different dimensions', () => {
    const res = generateResponse();
    res.fusions = [
        { title: 'Same dimension', description: '', dimensionId: 'd1', sourceActivityIds: ['a1', 'a2'], payload: activityPayload('Same dimension') },
        { title: 'Real fusion', description: '', dimensionId: 'd1', sourceActivityIds: ['a1', 'a3'], payload: activityPayload('Real fusion') },
    ];
    const built = w.materializeWeb(res, userDoc(), techTree().goals, {});
    const titles = built.nodes.map((n) => n.title);
    assert.ok(!titles.includes('Same dimension'));
    const fusion = built.nodes.find((n) => n.title === 'Real fusion');
    assert.strictEqual(fusion.role, 'fusion');
    assert.strictEqual(fusion.prerequisites.length, 2);
    assert.strictEqual(fusion.lifecycle, 'locked', 'neither source is mastered');
});

test('a self-referential prerequisite is dropped rather than bricking the branch', () => {
    const res = generateResponse();
    res.goals[0].nodes[1].prerequisites = [{ type: 'node_mastered', nodeTitle: 'Tempo intervals' }];
    const built = w.materializeWeb(res, userDoc(), techTree().goals, {});
    const n = built.nodes.find((x) => x.title === 'Tempo intervals');
    assert.strictEqual(n.prerequisites.length, 0);
});

test('an anchor whose activity is already mastered is born resolved', () => {
    const u = userDoc();
    u.dimensions[0].paths[0].activities[0].techTreeMasteredAt = ago(2);
    const built = w.materializeWeb(generateResponse(), u, techTree().goals, {});
    const anchor = built.nodes.find((n) => n.role === 'anchor');
    assert.ok(anchor.resolvedAt);
    // Its tier-1 child opens immediately.
    assert.strictEqual(built.nodes.find((n) => n.title === 'Long slow run').lifecycle, 'available');
});

test('rolling-window mastery only counts completions inside the window', () => {
    const stale = { frequency: 'weekly', completionHistory: Array.from({ length: 20 }, () => ({ date: ago(200), xp: 5 })) };
    const fresh = { frequency: 'weekly', completionHistory: Array.from({ length: 8 }, () => ({ date: ago(10), xp: 5 })) };
    assert.strictEqual(w.rollingWindowMet(stale), false);
    assert.strictEqual(w.rollingWindowMet(fresh), true);
});

// ── Folding a result into the existing web ──────────────────────────────────

const node = (o) => Object.assign({
    id: 'x', title: 'X', goalIds: ['g1'], lifecycle: 'locked',
    prerequisites: [], payload: { type: 'activity', activityId: null, spec: {} },
}, o);

test('a regeneration keeps what was adopted, mastered or paid for', () => {
    const tt = techTree({
        nodes: [
            node({ id: 'keepActive', lifecycle: 'active' }),
            node({ id: 'keepDone', resolvedAt: ago(1) }),
            node({ id: 'keepBought', revealed: true }),
            node({ id: 'dropDark', revealed: false }),
        ],
    });
    const built = w.materializeWeb(generateResponse(), userDoc(), tt.goals, {});
    const out = w.foldGeneration('generate', tt, built, 'v', null);
    const ids = out.nodes.map((n) => n.id);
    assert.ok(ids.includes('keepActive') && ids.includes('keepDone') && ids.includes('keepBought'));
    assert.ok(!ids.includes('dropDark'), 'only silhouettes are replaced');
});

test('a per-goal reweave leaves every other goal alone', () => {
    const tt = techTree({
        goals: [{ id: 'g1', rawText: 'A' }, { id: 'g2', rawText: 'B' }],
        nodes: [
            node({ id: 'mine', goalIds: ['g1'] }),
            node({ id: 'theirs', goalIds: ['g2'] }),
            node({ id: 'shared', goalIds: ['g1', 'g2'] }),
            node({ id: 'handmade', goalIds: ['g1'], source: 'user' }),
        ],
    });
    const out = w.foldGeneration('regenerate', tt, { goals: [], nodes: [] }, null, 'g1');
    const ids = out.nodes.map((n) => n.id);
    assert.ok(!ids.includes('mine'), 'this goal\'s unclaimed frontier is replaced');
    assert.ok(ids.includes('theirs') && ids.includes('shared') && ids.includes('handmade'));
});

test('an incoming anchor folds into the node that already carries that activity', () => {
    const existing = node({
        id: 'anchor1', role: 'anchor', goalIds: ['g1'], lifecycle: 'active',
        payload: { type: 'activity', activityId: 'a1', spec: {} },
    });
    const incoming = node({
        id: 'anchor2', role: 'anchor', goalIds: ['g2'],
        payload: { type: 'activity', activityId: 'a1', spec: {} },
    });
    const child = node({ id: 'child', prerequisites: [{ type: 'node_mastered', nodeId: 'anchor2' }] });
    const out = w.mergeNodes([existing], [incoming, child]);
    assert.strictEqual(out.length, 2, 'the duplicate anchor is not added twice');
    assert.deepStrictEqual(out[0].goalIds, ['g1', 'g2']);
    assert.strictEqual(out[1].prerequisites[0].nodeId, 'anchor1', 'the child is re-pointed');
});

test('a thread keeps its colour through a reweave', () => {
    const res = generateResponse();
    const goal = { id: 'g1', rawText: 'Run', color: '#c98a3f', retiredAt: null };
    // The reweave reserves every OTHER thread's colour, never its own.
    const built = w.materializeWeb(res, userDoc(), [goal], {
        positional: true, reservedColors: ['#a8446e', '#5a9fd4'],
    });
    assert.strictEqual(built.goals[0].color, '#c98a3f');
});

test('a brand-new goal never draws a colour another thread wears', () => {
    const res = generateResponse();
    res.goals[0].fromGoalId = null;
    const built = w.materializeWeb(res, userDoc(), [], {
        reservedColors: ['#a8446e', '#5a9fd4', '#c98a3f'],
    });
    assert.strictEqual(built.goals[0].color, '#8a9a5b', 'the first free palette entry');
});

test('a split goal does not steal its sibling\'s colour', () => {
    const res = generateResponse();
    res.goals.push(JSON.parse(JSON.stringify(res.goals[0])));
    res.goals[1].fromGoalId = null;
    res.goals[1].shortName = 'Second';
    res.goals[1].nodes = [];
    const goal = { id: 'g1', rawText: 'Run', color: '#a8446e', retiredAt: null };
    const built = w.materializeWeb(res, userDoc(), [goal], { reservedColors: [] });
    assert.strictEqual(built.goals[0].color, '#a8446e');
    assert.notStrictEqual(built.goals[1].color, '#a8446e');
});

test('the vision is only overwritten by a full generation', () => {
    const withVision = techTree({ vision: 'old' });
    const built = { goals: [], nodes: [] };
    assert.strictEqual(w.foldGeneration('generate', withVision, built, 'new', null).vision, 'new');
    assert.strictEqual(w.foldGeneration('add_goal', withVision, built, 'new', null).vision, undefined);
    assert.strictEqual(w.foldGeneration('add_goal', techTree(), built, 'new', null).vision, 'new');
});

test('every node that comes back carries its reveal state', () => {
    const built = w.materializeWeb(generateResponse(), userDoc(), techTree().goals, {});
    const out = w.foldGeneration('generate', techTree(), built, null, null);
    for (const n of out.nodes) {
        assert.strictEqual(typeof n.revealed, 'boolean', n.title);
        assert.strictEqual(typeof n.revealCost, 'number', n.title);
    }
    const wild = out.nodes.find((n) => n.role === 'wildcard');
    assert.strictEqual(wild.revealed, true, 'no prerequisites — born lit');
    assert.strictEqual(out.nodes.find((n) => n.title === 'Tempo intervals').revealed, false);
});

// ── Prompt building ─────────────────────────────────────────────────────────

test('the prompt carries the real activity ids and never a retired goal', () => {
    const tt = techTree({ goals: [{ id: 'g1', rawText: 'Run' }, { id: 'g2', rawText: 'Gone', retiredAt: ago(1) }] });
    const u = userDoc({ techTree: tt });
    const { user } = w.buildGeneratePrompt(u, { mode: 'generate' });
    const input = JSON.parse(user.replace(/^INPUT:\n/, ''));
    assert.deepStrictEqual(input.goals.map((g) => g.goalId), ['g1']);
    assert.ok(input.activeActivities.some((a) => a.activityId === 'a1'));
});

test('a scoped mode names its scope in the prompt', () => {
    const u = userDoc({ techTree: techTree() });
    const add = JSON.parse(w.buildGeneratePrompt(u, { mode: 'add_goal', goalIds: ['g1'], existingAnchors: [] }).user.replace(/^INPUT:\n/, ''));
    assert.match(add._mode, /ADD ONE GOAL/);
    const regen = JSON.parse(w.buildGeneratePrompt(u, { mode: 'regenerate', goalIds: ['g1'] }).user.replace(/^INPUT:\n/, ''));
    assert.match(regen._mode, /REWEAVE/);
});

test('there is no revise mode left to ask for', () => {
    assert.ok(!w.VALID_MODES.includes('revise'));
    const u = userDoc({ techTree: techTree() });
    const plain = JSON.parse(w.buildGeneratePrompt(u, { mode: 'revise', note: 'x' }).user.replace(/^INPUT:\n/, ''));
    assert.strictEqual(plain._mode, undefined, 'an unknown mode adds no instruction');
});
