import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { build, serve } from '../social/harness.mjs';

// The suite used to assume something else had already built and served the
// harness on this port, so it died on ERR_CONNECTION_REFUSED before loading a
// line of app code. It builds and serves its own now, the way the social and
// modes suites do.
//
// The hooks below are the module-private tech-tree functions the §-assertions
// are actually about. They live only in the built copy of app.js.
const PORT = 8766;
const dir = build(`
        window.__ttEnsure    = function ()          { return ensureTechTree(); };
        window.__ttRevealable= function (node, tt)  { return ttRevealable(node, tt); };
        window.__ttBlockers  = function (node, tt)  { return ttRevealBlockers(node, tt); };
        window.__ttState     = function (node, tt)  { return ttRevealState(node, tt); };
        window.__ttUnlocked  = function (node, tt)  { return ttNodeUnlocked(node, tt); };
        window.__ttBranchHtml= function (tt)        { return ttBranchHtml(tt); };
        window.__ttSkySvg    = function ()          { return ttBuildWebSVG(ttWebLayout()); };
        window.__ttRegen     = function ()          { return ttRegenStatus(); };
        window.__ttEval      = function ()          { return evaluateTechTreeMastery(); };
        window.__ttNodeSheet = function (id)        { ttOpenNode(id); var el = document.querySelector('.tt-sheet-card'); return el ? el.innerHTML : ''; };
        window.__grit        = function ()          { return gritState(); };
        window.__vsPeekLedger= function ()          { return _gritLedgerBuffer.slice(); };
`);
const server = await serve(dir, PORT);
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 400, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('dialog', d => d.accept());
await p.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 45000 });
await p.waitForTimeout(1200);

const out = await p.evaluate(async () => {
  const log = [], ok = (n,c,x)=>log.push((c?'PASS ':'FAIL ')+n+(x!==undefined?'  '+JSON.stringify(x):''));

  const act = (id,n,mastered)=>({id,name:n,baseXP:10,frequency:'weekly',completionHistory:[],
    completionCount:0,streak:0,totalXP:0,techTreeMastery:{count:6,windowDays:90},
    techTreeMasteredAt: mastered ? new Date().toISOString() : null});

  function boot(balance, nodes, treeExtra) {
    window.currentUser = { uid:'uidT', displayName:'Tess' };
    window.userData = {
      level:12, currentXP:0, totalXP:0, friends:[], profile:{username:'Tess'},
      grit:{schemaVersion:1,balance,lifetimeEarned:balance,lifetimeSpent:0,shieldPool:0,
            week:null,awarded:{},boostPurchases:[],cadence:{}},
      dimensions:[{id:'d1',name:'Body',paths:[{id:'p1',name:'Fit',
        activities:[act('a1','Run',true), act('a2','Read',false)]}]}],
      techTree: Object.assign({
        schemaVersion:3, status:'ready', goals:[{id:'g1',rawText:'Get fit',sharpened:'Get fit',
          shortName:'Fit',color:'#5a9fd4',kind:'rhythm'}],
        nodes: JSON.parse(JSON.stringify(nodes)),
        vision:'', goalText:'Get fit', pendingRequest:null, rejections:[],
        lastExpandAt:null, loadBudget:{current:0,updatedAt:null}, questPatches:[], introSeen:true
      }, treeExtra||{})
    };
    // a1 arrives already mastered; mark its Grit as already paid so these
    // assertions measure only what the test itself triggers.
    window.userData.grit.awarded['mastery:a1'] = true;
    window._dataOwnerUid='uidT'; window._dataLoadFailed=false;
    window.__store.set('users/uidT', JSON.parse(JSON.stringify(window.userData)));
  }
  const N = (id, o) => Object.assign({
    id, source:'ai', createdAt:new Date().toISOString(), role:'suggestion',
    goalIds:['g1'], dimensionId:'d1', lifecycle:'locked', resolvedAt:null, resolvedVia:null,
    title:'Node '+id, description:'desc '+id, whyNow:null, prerequisites:[],
    payload:{ type:'activity', activityId:null,
      spec:{name:'Thing '+id,description:'',baseXP:10,frequency:'weekly',dimensionId:'d1',suggestedPathId:null},
      mastery:{target:6,windowDays:90} }
  }, o);

  // A chain: anchor(a1, mastered) → n1 → n2 → n3, plus a free wildcard.
  const chain = [
    N('anchor1', { role:'anchor', lifecycle:'active', resolvedAt:new Date().toISOString(),
                   resolvedVia:'mastery', title:'Run', payload:{ type:'activity', activityId:'a1',
                   spec:{name:'Run',description:'',baseXP:10,frequency:'weekly',dimensionId:'d1',suggestedPathId:null},
                   mastery:{target:6,windowDays:90} } }),
    N('n1', { prerequisites:[{type:'activity_mastered',activityId:'a1'}] }),
    N('n2', { prerequisites:[{type:'node_mastered',nodeId:'n1'}] }),
    N('n3', { prerequisites:[{type:'node_mastered',nodeId:'n2'}] }),
    N('wild', { role:'wildcard', goalIds:[], prerequisites:[] })
  ];

  // ── §3.1 / §10.2 birth state on a FRESH tree ───────────────────
  boot(500, chain, { revealMigratedAt: new Date().toISOString() });   // already migrated → strict rule
  let tt = window.__ttEnsure();
  const g = id => tt.nodes.find(n=>n.id===id);
  ok('§10.2 anchor (no prereqs) is free', g('anchor1').revealed === true);
  ok('§10.2 wildcard (no prereqs) is free', g('wild').revealed === true);
  ok('§3.1 roadmap tier-1 is NOT free', g('n1').revealed === false);
  ok('§3.1 deeper nodes are dark', g('n2').revealed === false && g('n3').revealed === false);
  ok('§10.10 revealCost stamped at generation', g('n2').revealCost === 40);

  // ── §5.1 lineage: cannot buy the leaf without the branch ────────
  ok('§5.1 n1 revealable (its anchor is revealed)', window.__ttRevealable(g('n1'), tt));
  ok('§5.1 n2 NOT revealable while n1 is dark', !window.__ttRevealable(g('n2'), tt));
  ok('§5.1 n3 NOT revealable', !window.__ttRevealable(g('n3'), tt));
  ok('§5.1 blockers are named', window.__ttBlockers(g('n2'), tt).map(x=>x.id).join()==='n1',
     window.__ttBlockers(g('n2'), tt).map(x=>x.id));

  // ── §5.3 purchase ──────────────────────────────────────────────
  const bal0 = window.__grit().balance;
  await window.ttConfirmReveal('n1');
  tt = window.__ttEnsure();
  ok('§5.3 reveal charged 40', window.__grit().balance === bal0 - 40, window.__grit().balance);
  ok('§5.3 node is revealed', g('n1').revealed === true && !!g('n1').revealedAt);
  ok('§5.3 ledger entry written', !!window.__vsPeekLedger().find(e=>e.data.reason==='node_reveal'));
  ok('§10.4 persisted before grant', window.__store.get('users/uidT').techTree.nodes
      .find(n=>n.id==='n1').revealed === true);
  ok('§5.1 n2 becomes revealable once n1 is lit', window.__ttRevealable(g('n2'), tt));

  // Reveal ≠ adopt: n1 is revealed but its own prereq (a1) IS mastered, so
  // it is adoptable; n2 is revealable but must stay non-adoptable.
  ok('§1 revealed + prereq met = adoptable', window.__ttState(g('n1'), tt) === 'adoptable',
     window.__ttState(g('n1'), tt));
  await window.ttConfirmReveal('n2');
  tt = window.__ttEnsure();
  ok('§1 Grit never buys access — n2 revealed but NOT adoptable',
     window.__ttState(g('n2'), tt) === 'revealed', window.__ttState(g('n2'), tt));
  ok('§10.1 revealing did not change lifecycle', g('n2').lifecycle === 'locked');

  // ── §10.9 silhouettes leak nothing ─────────────────────────────
  const sky = window.__ttSkySvg();
  ok('§10.9 Sky leaks no dark titles', !sky.includes('Node n3') && !sky.includes('desc n3'));
  ok('§8.1 Sky is label-free entirely', !sky.includes('Node n1'), sky.includes('Node n1'));
  const branch = window.__ttBranchHtml(tt);
  ok('§8.2 Branch shows revealed titles', branch.includes('Node n1'));
  ok('§10.9 Branch leaks no dark title', !branch.includes('Node n3'));
  ok('§8.2 Branch shows the lock price', branch.includes('Unrevealed') && branch.includes('40'));

  // ── Insufficient balance refuses ───────────────────────────────
  window.userData.grit.balance = 10;
  const before = window.__grit().balance;
  await window.ttConfirmReveal('n3');
  ok('§5.3 shortfall refuses before charging', window.__grit().balance === before &&
     g('n3').revealed === false, { bal: window.__grit().balance, revealed: g('n3').revealed });

  // ── §5.4 rejection must never strand a branch ──────────────────
  boot(500, chain, { revealMigratedAt: new Date().toISOString() });
  tt = window.__ttEnsure();
  await window.ttConfirmReveal('n1');
  await window.ttConfirmReveal('n2');
  tt = window.__ttEnsure();
  const preReject = window.__ttUnlocked(g('n2'), tt);
  window.ttRejectNode('n1');
  tt = window.__ttEnsure();
  ok('§5.4 rejected node is archived', g('n1').lifecycle === 'archived');
  ok('§5.4 child inherits the ancestor prerequisite',
     JSON.stringify(g('n2').prerequisites) === JSON.stringify([{type:'activity_mastered',activityId:'a1'}]),
     g('n2').prerequisites);
  ok('§5.4 child is NOT stranded — still unlockable', window.__ttUnlocked(g('n2'), tt) === true,
     { before: preReject, after: window.__ttUnlocked(g('n2'), tt) });
  ok('§5.4 grandchild still reachable through the chain',
     window.__ttBlockers(g('n3'), tt).length === 0 || window.__ttRevealable(g('n3'), tt),
     window.__ttBlockers(g('n3'), tt).map(x=>x.id));
  ok('§5.4 rejection does not refund the reveal', g('n2').revealed === true);

  // Reject a tier-1 node: children should end with no prerequisite at all.
  boot(500, chain, { revealMigratedAt: new Date().toISOString() });
  tt = window.__ttEnsure();
  window.ttRejectNode('anchor1');
  tt = window.__ttEnsure();
  ok('§5.4 rejecting an anchor leaves its real activity as the prerequisite',
     JSON.stringify(g('n1').prerequisites) === JSON.stringify([{type:'activity_mastered',activityId:'a1'}]),
     g('n1').prerequisites);
  ok('§5.4 and the child is not stranded by it', window.__ttUnlocked(g('n1'), tt) === true);
  ok('§5.4 those children are immediately revealable', window.__ttRevealable(g('n1'), tt));

  // ── §9 migration: never retroactively charge ───────────────────
  boot(500, chain, {});                       // no revealMigratedAt → legacy tree
  tt = window.__ttEnsure();
  ok('§9 legacy: nodes with met prereqs arrive revealed', g('n1').revealed === true);
  ok('§9 legacy: unmet-prereq nodes stay dark', g('n2').revealed === false);
  ok('§9 migration stamps its marker', !!tt.revealMigratedAt);
  const marker = tt.revealMigratedAt;
  window.__ttEnsure(); window.__ttEnsure();
  ok('§9 migration is idempotent', window.__ttEnsure().revealMigratedAt === marker);

  // ── §6 regeneration gate ───────────────────────────────────────
  // Three gates now, all of which must open: a mastery since the last
  // regeneration, the Grit, and the once-a-month clock.
  boot(500, chain, { revealMigratedAt:new Date().toISOString(), masteriesSinceRegen:0,
                     pendingRequest:{ type:'generate', attempts:0 } });
  ok('§6 a request left over from the worker era is dropped on load',
     window.__ttEnsure().pendingRequest === undefined);
  // Nothing mastered since the last regeneration: the gate must hold no
  // matter how rich the user is.
  window.userData.dimensions[0].paths[0].activities[0].techTreeMasteredAt = null;
  window.userData.techTree.lastRegenAt = new Date().toISOString();
  let r = window.__ttRegen();
  ok('§6 rich but no mastery → refused', r.affordable && !r.masteryMet && !r.ready, r);
  // Master it again, in the past, with no prior regeneration — the gate opens.
  window.userData.dimensions[0].paths[0].activities[0].techTreeMasteredAt = new Date().toISOString();
  window.userData.techTree.lastRegenAt = null;
  window.userData.grit.balance = 50;
  r = window.__ttRegen();
  ok('§6 mastery but poor → refused', r.masteryMet && !r.affordable && !r.ready, r);
  window.userData.grit.balance = 500;
  r = window.__ttRegen();
  ok('§6 mastery + Grit + no clock running → allowed', r.ready, r);

  // The monthly clock is its own veto: it holds against a user who has
  // mastered something and can pay twice over.
  window.userData.techTree.lastRegenAt = new Date(Date.now() - 3 * 86400000).toISOString();
  r = window.__ttRegen();
  ok('§6 regenerated 3 days ago → refused for 27 more', r.cooldown === 27 && !r.ready, r);
  window.userData.techTree.lastRegenAt = new Date(Date.now() - 31 * 86400000).toISOString();
  r = window.__ttRegen();
  ok('§6 a month later → allowed again', r.cooldown === 0 && r.ready, r);
  // A tree that has never been regenerated is not on any clock: the FIRST
  // generation is free and does not start it.
  window.userData.techTree.lastRegenAt = null;
  ok('§6 the initial generation never starts the clock', window.__ttRegen().cooldown === 0);

  // A weave that does not come back costs nothing: the charge follows the
  // web, it no longer rides along with the request. (The harness stubs the
  // callable, so this is exactly the failed-weave path.)
  await window.ttConfirmReveal('n1');
  const balPre = window.__grit().balance;
  const masteriesPre = window.__ttEnsure().masteriesSinceRegen;
  await window.ttConfirmRegen();
  tt = window.__ttEnsure();
  ok('§6 a failed weave charges no Grit', window.__grit().balance === balPre, window.__grit().balance);
  ok('§6 a failed weave does not spend the mastery credit',
     tt.masteriesSinceRegen === masteriesPre, tt.masteriesSinceRegen);
  ok('§6 a failed weave leaves no request behind', tt.pendingRequest === undefined && tt.status !== 'generating',
     { pending: tt.pendingRequest, status: tt.status });

  // ── §7 / §10.8 mastery pays once; resolving pays nothing extra ──
  boot(500, chain, { revealMigratedAt:new Date().toISOString() });
  const gritBefore = window.__grit().balance;
  window.userData.dimensions[0].paths[0].activities[1].techTreeMasteredAt = new Date().toISOString();
  window.__ttEval();
  const earned = window.__grit().balance - gritBefore;
  ok('§7 mastery pays (floor 40)', earned === 40, earned);
  ok('§7/§10.8 resolving the node pays no Grit on top',
     window.__vsPeekLedger().filter(e=>e.data.reason==='mastery').length === 1,
     window.__vsPeekLedger().map(e=>e.data.reason));
  const afterFirst = window.__grit().balance;
  window.__ttEval(); window.__ttEval();
  ok('§10.8 mastery pays exactly once', window.__grit().balance === afterFirst, window.__grit().balance);
  ok('§6 mastery advanced the regen gate',
     window.userData.techTree.masteriesSinceRegen >= 1, window.userData.techTree.masteriesSinceRegen);
  // The gate is derived, so a mastery declared by ttFinishLink's retroactive
  // resolve — which never went through the evaluation pass — still counts.
  window.userData.dimensions[0].paths[0].activities[0].techTreeMasteredAt = new Date().toISOString();
  window.userData.techTree.masteriesSinceRegen = 0;          // simulate a missed increment
  ok('§6 gate self-corrects a drifted counter',
     window.__ttEnsure().masteriesSinceRegen === 2, window.__ttEnsure().masteriesSinceRegen);

  // ── The screens themselves ──────────────────────────────────────
  // The intro is the one place the activity rule used to live as a standing
  // "0/3 activities" badge. It says one plain thing now, and the rule shows
  // up only when it actually blocks a tap.
  boot(500, [], { status:'empty', nodes:[], goals:[] });
  document.getElementById('activitiesSubTechTree').style.display = '';
  document.getElementById('activitiesTab').classList.add('active');
  window.renderTechTree();
  let intro = document.getElementById('techTreeContainer').innerHTML;
  ok('§1 no standing activity-count requirement', !/\/3 activit/i.test(intro), intro.slice(0, 200));
  ok('§1 no gate checklist at all', !/tt-gate/.test(intro));
  ok('§1 the instruction is plain English, no metaphor',
     /Write down your goal below and AI will build a roadmap/.test(intro));
  ok('§1 goal rows are still separate inputs, not one textarea',
     intro.includes('tt-goal-oneline') && !intro.includes('<textarea'));

  // §2 — the reported bug: what is typed into the first row had to survive to
  // generation without the user tapping "Add another goal" first. It lives in
  // techTree.goals from the first keystroke now, not only in the DOM.
  const field = document.querySelector('#ttGoalFields .tt-goal-oneline');
  field.value = 'Run a half marathon';
  field.dispatchEvent(new Event('input', { bubbles: true }));
  ok('§2 typing one goal registers it without adding a second row',
     (window.__ttEnsure().goals || []).map(g => g.rawText).join() === 'Run a half marathon',
     window.__ttEnsure().goals);
  // And it survives a re-render, which used to wipe it back to the stored list.
  window.renderTechTree();
  ok('§2 the typed goal survives a re-render',
     document.querySelector('#ttGoalFields .tt-goal-oneline').value === 'Run a half marathon');

  // §3 — an available node offers accept / link / not now, and nothing that
  // sends a single node back to the model. (n1 and n2 have to be lit first —
  // a silhouette's sheet is the reveal sheet, not the pitch.)
  boot(500, chain, { revealMigratedAt:new Date().toISOString() });
  await window.ttConfirmReveal('n1');
  await window.ttConfirmReveal('n2');
  const sheet = window.__ttNodeSheet('n1');
  ok('§3 Revise is gone from the node sheet', !/Revise/.test(sheet));
  ok('§3 no per-node AI affordance is left', !/ttReviseNode/.test(sheet));
  ok('§3 accept, link and not-now are untouched',
     /ttOpenAccept/.test(sheet) && /ttOpenLinkPicker/.test(sheet) && /ttRejectNode/.test(sheet));
  ok('§3 window.ttReviseNode no longer exists', typeof window.ttReviseNode === 'undefined');
  window.ttCloseSheet();

  // §6 — Branch opens on ONE goal, as a chain: no tier headings, a spine, and
  // every locked node saying in full what opens it.
  window._ttBranchGoal = undefined;
  const linear = window.__ttBranchHtml(window.__ttEnsure());
  ok('§6 Branch opens filtered to a goal, not All', /tt-branch-linear/.test(linear));
  ok('§6 tier headings are gone from the chain', !/tt-branch-tier/.test(linear));
  ok('§6 the unlock condition is stated in full, not clipped to a badge',
     /tt-branch-gate/.test(linear) && /Unlocks after/.test(linear), linear.slice(0, 300));
  ok('§6 All is still one tap away', /ttBranchFilter\(null\)/.test(linear));
  window.ttBranchFilter(null);
  const all = window.__ttBranchHtml(window.__ttEnsure());
  ok('§6 All restores the tier-grouped read', /tt-branch-tier/.test(all) && !/tt-branch-linear/.test(all));

  // §7 — the Sky/Branch toggle carries the app's segmented-control classes.
  window._ttBranchGoal = undefined;
  window.renderTechTree();
  const web = document.getElementById('techTreeContainer').innerHTML;
  ok('§7 the toggle is one control with a selected half',
     /tt-vt-btn on/.test(web) && /aria-selected="true"/.test(web));
  ok('§7 Rebuild no longer shadows Regenerate', !/ttRebuildMap/.test(web));

  return log;
});
console.log(out.join('\n'));
const f = out.filter(l=>l.startsWith('FAIL')).length;
console.log(`\n${out.length - f} passed, ${f} failed`);
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
server.close();
process.exit(f || errs.length ? 1 : 0);
