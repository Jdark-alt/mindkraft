const assert = require('node:assert');
const { test } = require('node:test');
const qc = require('../lib/quest-composer');

const ctx = {
    activityIds: new Set(['a1', 'a2', 'a3']),
    dimIds: new Set(['d1', 'd2']),
    fallbackDim: 'd1',
};
const counter = () => ({ newActs: 0, leaves: 0, linked: {} });
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

test('a dormant activity is still offered — it is still theirs', () => {
    // The bug this replaces: hard-filtering on recency hid "shoot a video"
    // from a video quest because it had not been done that week.
    const menu = qc.activityMenu(mkUser([
        act('a1', 'Edit a video', 1),
        act('a2', 'Shoot a video', 40),
        act('a3', 'Ideate and script', 25),
    ]));
    assert.deepStrictEqual(menu.map((a) => a.id).sort(), ['a1', 'a2', 'a3']);
});

test('recency is a signal, not a gate, and ranks the list', () => {
    const menu = qc.activityMenu(mkUser([
        act('old', 'Old', 40),
        act('fresh', 'Fresh', 1),
    ]));
    assert.strictEqual(menu[0].id, 'fresh', 'most recent first');
    assert.strictEqual(menu[0].doneRecently, true);
    assert.strictEqual(menu[1].doneRecently, false);
});

test('a never-completed activity is offered too', () => {
    const menu = qc.activityMenu(mkUser([act('a1', 'Brand new', null)]));
    assert.deepStrictEqual(menu.map((a) => a.id), ['a1']);
    assert.strictEqual(menu[0].doneRecently, false);
});

test('the description is passed so vague names can be judged', () => {
    const menu = qc.activityMenu(mkUser([
        Object.assign(act('a1', 'Do something new', 1), { description: 'Try an unfamiliar hobby.' }),
        act('a2', 'No description', 1),
    ]));
    assert.strictEqual(menu.find((a) => a.id === 'a1').description, 'Try an unfamiliar hobby.');
    assert.ok(!('description' in menu.find((a) => a.id === 'a2')));
});

test('archived, deleted and punitive activities are excluded', () => {
    const live = qc.activityMenu(mkUser([
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
    const live = qc.activityMenu(mkUser(acts));
    assert.strictEqual(live.length, 40);
    assert.ok(live[0].name);
});

test('a penalty entry does not count as a real completion', () => {
    const user = mkUser([{
        id: 'p1', name: 'Penalised', baseXP: 5, frequency: 'weekly',
        completionHistory: [{ date: new Date().toISOString(), xp: -5, isPenalty: true }],
    }]);
    const menu = qc.activityMenu(user);
    assert.strictEqual(menu.length, 1, 'still offered — it is still their activity');
    assert.strictEqual(menu[0].doneRecently, false, 'but a penalty is not a completion');
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
    assert.match(p.system, /built mostly out of activities they ALREADY track/);
    assert.match(p.system, /No prose, no markdown fences/);
});

// ── one activity, one leaf ──────────────────────────────────────────────────

test('the same activity in two groups collapses to one leaf', () => {
    const spec = qc.validateSpec({ name:'X', groups:[
        grp([leaf({type:'activity',linkedActivityId:'a1',requiredCount:2}), leaf({type:'task',name:'p'})], {name:'Week 1'}),
        grp([leaf({type:'activity',linkedActivityId:'a1',requiredCount:3}), leaf({type:'task',name:'q'})], {name:'Week 2'}),
    ]}, ctx);
    const linked = [];
    (function walk(ns){ ns.forEach(n => n.kind==='group' ? walk(n.children) : (n.linkedActivityId && linked.push(n))); })(spec.groups);
    assert.strictEqual(linked.length, 1, 'exactly one leaf for a1');
    assert.strictEqual(linked[0].requiredCount, 5, 'the repeat folded into it, work preserved');
});

test('a duplicate inside a single group also collapses', () => {
    const spec = qc.validateSpec({ name:'X', groups:[grp([
        leaf({type:'activity',linkedActivityId:'a1',requiredCount:1}),
        leaf({type:'activity',linkedActivityId:'a1',requiredCount:1}),
        leaf({type:'activity',linkedActivityId:'a2',requiredCount:1}),
    ])]}, ctx);
    const linked = [];
    (function walk(ns){ ns.forEach(n => n.kind==='group' ? walk(n.children) : (n.linkedActivityId && linked.push(n))); })(spec.groups);
    assert.deepStrictEqual(linked.map(l=>l.linkedActivityId).sort(), ['a1','a2']);
    assert.strictEqual(linked.find(l=>l.linkedActivityId==='a1').requiredCount, 2);
});

test('different activities are never merged', () => {
    const spec = qc.validateSpec({ name:'X', groups:[grp([
        leaf({type:'activity',linkedActivityId:'a1'}),
        leaf({type:'activity',linkedActivityId:'a2'}),
        leaf({type:'activity',linkedActivityId:'a3'}),
    ])]}, ctx);
    assert.strictEqual(spec.groups[0].children.length, 3);
});

test('a group left empty by deduping does not survive as a husk', () => {
    const spec = qc.validateSpec({ name:'X', groups:[
        grp([leaf({type:'activity',linkedActivityId:'a1'})], {name:'First'}),
        grp([leaf({type:'activity',linkedActivityId:'a1'})], {name:'Duplicate only'}),
    ]}, ctx);
    assert.strictEqual(spec.groups.length, 1, 'the all-duplicate group is dropped');
    assert.strictEqual(spec.groups[0].name, 'First');
});

// ── new activities carry a description ──────────────────────────────────────

test('a new-practice description is carried through', () => {
    const l = qc.validateLeaf(leaf({ type:'activity', spec:{
        name:'Tempo run', description:'A sustained 20-minute effort at threshold pace.',
        baseXP:12, frequency:'weekly', dimensionId:'d1' } }), ctx, counter());
    assert.strictEqual(l.spec.description, 'A sustained 20-minute effort at threshold pace.');
});

test('a missing description is an empty string, never undefined', () => {
    const l = qc.validateLeaf(leaf({ type:'activity',
        spec:{ name:'X', baseXP:8, frequency:'daily', dimensionId:'d1' } }), ctx, counter());
    assert.strictEqual(l.spec.description, '');
});

test('an over-long description is truncated', () => {
    const l = qc.validateLeaf(leaf({ type:'activity',
        spec:{ name:'X', description:'z'.repeat(500), baseXP:8, frequency:'daily', dimensionId:'d1' } }), ctx, counter());
    assert.strictEqual(l.spec.description.length, 200);
});

// ── the prompt states the new rules ─────────────────────────────────────────

test('the prompt forbids duplicate ids and demands a description', () => {
    const p = qc.buildComposePrompt({ activities:[], dimensions:[], request:'x', shape:'oneoff', size:null });
    assert.match(p.system, /NEVER use the same linkedActivityId twice/);
    assert.match(p.system, /It must carry a "description"/);
    assert.match(p.system, /A NEW PRACTICE is only for/);
    assert.match(p.system, /"description":str/, 'the schema advertises it');
});

// ── the new-practice share ──────────────────────────────────────────────────

test('the allowance scales with the size of the quest', () => {
    assert.strictEqual(qc.newActivityAllowance(3), 2, 'a small quest still gets a floor of 2');
    assert.strictEqual(qc.newActivityAllowance(10), 3, '~30%');
    assert.strictEqual(qc.newActivityAllowance(20), 6, 'capped');
    assert.strictEqual(qc.newActivityAllowance(60), 6, 'never runs away');
});

test('a big quest may introduce more than the old flat three', () => {
    const kids = [];
    for (let i = 0; i < 12; i++) kids.push(leaf({ type:'task', name:'step ' + i }));
    for (let i = 0; i < 5; i++) kids.push(leaf({ type:'activity',
        spec:{ name:'New ' + i, description:'d', baseXP:8, frequency:'weekly', dimensionId:'d1' } }));
    const spec = qc.validateSpec({ name:'X', groups:[grp(kids)] }, ctx);
    const leaves = [];
    (function walk(ns){ ns.forEach(n => n.kind==='group' ? walk(n.children) : leaves.push(n)); })(spec.groups);
    const news = leaves.filter(l => l.type === 'activity' && l.spec);
    assert.strictEqual(news.length, 5, '17 leaves allows 5 new practices');
});

test('a tiny quest cannot be mostly new practices', () => {
    const kids = [leaf({ type:'activity', linkedActivityId:'a1' })];
    for (let i = 0; i < 5; i++) kids.push(leaf({ type:'activity',
        spec:{ name:'New ' + i, description:'d', baseXP:8, frequency:'weekly', dimensionId:'d1' } }));
    const spec = qc.validateSpec({ name:'X', groups:[grp(kids)] }, ctx);
    const leaves = [];
    (function walk(ns){ ns.forEach(n => n.kind==='group' ? walk(n.children) : leaves.push(n)); })(spec.groups);
    const news = leaves.filter(l => l.type === 'activity' && l.spec);
    assert.strictEqual(news.length, 2, '6 leaves allows only the floor of 2');
    assert.strictEqual(leaves.length, 6, 'and nothing was lost');
    const demoted = leaves.filter(l => l.type === 'task');
    assert.strictEqual(demoted.length, 3, 'the 3 excess new practices became tasks, keeping the steps');
    assert.ok(demoted.every(l => l.name), 'each demoted step kept a name');
});

// ── the prompt says the things that were going wrong ────────────────────────

test('the prompt tells it to read the whole list and match on meaning', () => {
    const p = qc.buildComposePrompt({ activities:[], dimensions:[], request:'x', shape:'oneoff', size:null });
    assert.match(p.system, /READ THE WHOLE ACTIVITY LIST/);
    assert.match(p.system, /Match on MEANING/);
    assert.match(p.system, /ideate and script/, 'the pipeline example is spelled out');
});

test('the prompt forbids dragging in vague catch-all activities', () => {
    const p = qc.buildComposePrompt({ activities:[], dimensions:[], request:'x', shape:'oneoff', size:null });
    assert.match(p.system, /NEVER link a vague or catch-all activity/);
    assert.match(p.system, /do something new/);
});

test('the prompt asks for real stages and considered ordering', () => {
    const p = qc.buildComposePrompt({ activities:[], dimensions:[], request:'x', shape:'oneoff', size:null });
    assert.match(p.system, /BUILD THE REAL SHAPE OF THE WORK/);
    assert.match(p.system, /USE ordered:true WHEN THE SEQUENCE IS REAL/);
    assert.match(p.system, /Do not make everything ordered/);
    assert.match(p.system, /TWO THIRDS/);
    assert.match(p.system, /Reach for a task before a new practice/);
});

test('dormancy is explicitly not a reason to skip an activity', () => {
    const p = qc.buildComposePrompt({ activities:[], dimensions:[], request:'x', shape:'oneoff', size:null });
    assert.match(p.system, /doneRecently:false.* does NOT mean unavailable/s);
});
