import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 400, height: 900 } });
const errs = [];
p.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
p.on('dialog', d => d.accept());
await p.goto('http://localhost:8766/index.html', { waitUntil: 'load', timeout: 45000 });
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
      challenges:[],
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
  boot(500, chain, { revealMigratedAt:new Date().toISOString(), masteriesSinceRegen:0 });
  // Nothing mastered since the last regeneration: the gate must hold no
  // matter how rich the user is.
  window.userData.dimensions[0].paths[0].activities[0].techTreeMasteredAt = null;
  window.userData.techTree.lastRegenAt = new Date().toISOString();
  let r = window.__ttRegen();
  ok('§6 rich but no mastery → refused', r.affordable && !r.masteryMet, r);
  // Master it again, in the past, with no prior regeneration — the gate opens.
  window.userData.dimensions[0].paths[0].activities[0].techTreeMasteredAt = new Date().toISOString();
  window.userData.techTree.lastRegenAt = null;
  window.userData.grit.balance = 50;
  r = window.__ttRegen();
  ok('§6 mastery but poor → refused', r.masteryMet && !r.affordable, r);
  window.userData.grit.balance = 500;
  r = window.__ttRegen();
  ok('§6 both met → allowed', r.masteryMet && r.affordable);

  await window.ttConfirmReveal('n1');
  const balPre = window.__grit().balance;
  await window.ttConfirmRegen();
  tt = window.__ttEnsure();
  ok('§6 regeneration charged 200', window.__grit().balance === balPre - 200, window.__grit().balance);
  ok('§6 masteriesSinceRegen reset', tt.masteriesSinceRegen === 0);
  ok('§6 lastRegenAt stamped', !!tt.lastRegenAt);
  ok('§6 request queued for the generator', !!tt.pendingRequest && tt.status === 'generating');
  ok('§6.1 keep list carries the revealed node',
     (tt.pendingRequest.payload.keepNodeIds || []).includes('n1'),
     tt.pendingRequest.payload.keepNodeIds);
  ok('§6.1 keep list excludes silhouettes',
     !(tt.pendingRequest.payload.keepNodeIds || []).includes('n3'));

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

  return log;
});
console.log(out.join('\n'));
const f = out.filter(l=>l.startsWith('FAIL')).length;
console.log(`\n${out.length - f} passed, ${f} failed`);
console.log('page errors:', errs.length ? errs : 'none');
await b.close();
