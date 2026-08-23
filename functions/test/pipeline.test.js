// The exact case that went wrong: a video pipeline built from activities the
// user already has, with real stages and ordering.
const assert = require('node:assert');
const { test } = require('node:test');
const qc = require('../lib/quest-composer');

const userData = { dimensions: [{ id:'d1', name:'Craft', paths:[{ id:'p1', name:'Video', activities:[
    { id:'ideate', name:'Ideate and script', baseXP:12, frequency:'weekly',
      completionHistory:[{date:new Date(Date.now()-30*86400000).toISOString(), xp:12}] },
    { id:'shoot',  name:'Shoot a video', baseXP:15, frequency:'weekly',
      completionHistory:[{date:new Date(Date.now()-25*86400000).toISOString(), xp:15}] },
    { id:'edit',   name:'Edit a video', baseXP:18, frequency:'weekly',
      completionHistory:[{date:new Date(Date.now()-1*86400000).toISOString(), xp:18}] },
    { id:'vague',  name:'Do something new or exciting', baseXP:5, frequency:'weekly',
      completionHistory:[{date:new Date(Date.now()-2*86400000).toISOString(), xp:5}] },
]}]}]};

test('all three pipeline stages reach the model, not just the recent one', () => {
    const menu = qc.activityMenu(userData);
    const ids = menu.map(a => a.id);
    assert.ok(ids.includes('ideate'), 'ideate and script is offered');
    assert.ok(ids.includes('shoot'),  'shoot a video is offered');
    assert.ok(ids.includes('edit'),   'edit a video is offered');
    // and the model is told which are current
    assert.strictEqual(menu.find(a => a.id === 'edit').doneRecently, true);
    assert.strictEqual(menu.find(a => a.id === 'shoot').doneRecently, false);
});

test('a full production pipeline survives validation intact', () => {
    const activities = qc.activityMenu(userData);
    const ctx = qc.buildCtx(userData, activities);
    // what a good answer looks like
    const model = { name:'YouTube pipeline', emoji:'🎬', description:'One video, start to finish.',
      cadence:{ type:'recurring' },
      groups:[
        { kind:'group', name:'Planning', ordered:false, repeat:1, children:[
            { kind:'leaf', type:'activity', linkedActivityId:'ideate', resetMode:'per-cycle', requiredCount:1 },
            { kind:'leaf', type:'task', name:'Pick the thumbnail concept', resetMode:'once', requiredCount:1 } ]},
        { kind:'group', name:'Production', ordered:true, repeat:1, children:[
            { kind:'leaf', type:'activity', linkedActivityId:'shoot', resetMode:'per-cycle', requiredCount:1 },
            { kind:'leaf', type:'activity', linkedActivityId:'edit',  resetMode:'per-cycle', requiredCount:1 },
            { kind:'leaf', type:'task', name:'Design the thumbnail', resetMode:'once', requiredCount:1 } ]},
        { kind:'group', name:'Publish', ordered:true, repeat:1, children:[
            { kind:'leaf', type:'task', name:'Write title and description', resetMode:'once', requiredCount:1 },
            { kind:'leaf', type:'task', name:'Publish', resetMode:'once', requiredCount:1 } ]},
        { kind:'group', name:'Review', ordered:false, repeat:1, children:[
            { kind:'leaf', type:'activity', resetMode:'per-cycle', requiredCount:1,
              spec:{ name:'Review analytics', description:'Check retention and click-through on the last upload.',
                     baseXP:8, frequency:'weekly', dimensionId:'d1' } } ]},
      ]};
    const spec = qc.validateSpec(model, ctx, 'recurring');
    assert.ok(spec, 'the pipeline validated');
    assert.strictEqual(spec.groups.length, 4, 'all four stages survived');
    assert.deepStrictEqual(spec.groups.map(g => g.name), ['Planning','Production','Publish','Review']);
    assert.strictEqual(spec.groups[1].ordered, true,  'Production stays a sequence');
    assert.strictEqual(spec.groups[0].ordered, false, 'Planning stays a checklist');
    assert.strictEqual(spec.cadence.type, 'recurring');

    const leaves = [];
    (function walk(ns){ ns.forEach(n => n.kind==='group' ? walk(n.children) : leaves.push(n)); })(spec.groups);
    const linked = leaves.filter(l => l.linkedActivityId).map(l => l.linkedActivityId).sort();
    assert.deepStrictEqual(linked, ['edit','ideate','shoot'], 'all three real activities are used');
    assert.strictEqual(leaves.filter(l => l.type === 'task').length, 4, 'the one-off steps stayed tasks');
    assert.strictEqual(leaves.filter(l => l.spec).length, 1, 'one new practice, within the share');
    assert.ok(!linked.includes('vague'), 'the catch-all activity was not dragged in');
});

test('a nine-leaf quest allows three new practices, not one', () => {
    assert.strictEqual(qc.newActivityAllowance(9), 3);
});
