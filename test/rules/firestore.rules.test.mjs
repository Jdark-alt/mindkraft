import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { doc, setDoc, getDoc, updateDoc, deleteDoc, collection, query, where, getDocs } from 'firebase/firestore';
import fs from 'fs';

const env = await initializeTestEnvironment({
  projectId: 'demo-mindkraft',
  firestore: { host: '127.0.0.1', port: 8088, rules: fs.readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') }
});

const A = 'uidA', B = 'uidB', C = 'uidC';
const dbA = env.authenticatedContext(A).firestore();
const dbB = env.authenticatedContext(B).firestore();
const dbC = env.authenticatedContext(C).firestore();

let pass = 0, fail = 0;
async function t(name, fn) {
  try { await fn(); console.log('PASS ' + name); pass++; }
  catch (e) { console.log('FAIL ' + name + '  → ' + (e.message || e).split('\n')[0]); fail++; }
}

const NOW = Date.now();
function payload(o = {}) {
  return Object.assign({
    schemaVersion: 2, mode: 'versus', createdBy: A, opponent: B, participants: [A, B],
    status: 'pending', name: 'Dawn patrol', description: 'up at six',
    stake: 50, pot: 50, bonusXP: 20, durationDays: 10,
    createdAt: NOW, expiresAt: NOW + 7 * 86400000,
    startedAt: null, endsAt: null, resolvedAt: null,
    requirements: [{ reqId: 'r1', name: 'Run', targetCount: 3 },
                   { reqId: 'r2', name: 'Read', targetCount: 2 }],
    mapping: { [A]: { r1: { activityId: 'a1', activityName: 'Run' },
                      r2: { activityId: 'a2', activityName: 'Read' } }, [B]: {} },
    progress: { [A]: {}, [B]: {} }, totals: { [A]: 0, [B]: 0 },
    winner: null, outcome: null,
    payout: { [A]: 0, [B]: 0 }, payoutClaimed: { [A]: false, [B]: false },
    seen: { [A]: NOW, [B]: 0 }, names: { [A]: 'Ana', [B]: 'Ben' }
  }, o);
}

// Seed friend lists exactly as the app stores them (userData.friends).
await env.withSecurityRulesDisabled(async ctx => {
  const d = ctx.firestore();
  await setDoc(doc(d, 'users', A), { friends: [B], grit: { balance: 200 } });
  await setDoc(doc(d, 'users', B), { friends: [A], grit: { balance: 200 } });
  await setDoc(doc(d, 'users', C), { friends: [],  grit: { balance: 200 } });
});
const seed = (id, o) => env.withSecurityRulesDisabled(async ctx =>
  setDoc(doc(ctx.firestore(), 'challenges', id), payload(o)));

console.log('── CREATE ──');
await t('challenger creates a valid invite', () => assertSucceeds(setDoc(doc(dbA,'challenges','c1'), payload())));
await t('non-friend is refused (C has no friends)', () =>
  assertFails(setDoc(doc(dbC,'challenges','x1'), payload({ createdBy: C, opponent: B, participants: [C,B],
    mapping:{[C]:{r1:{activityId:'a',activityName:'a'}},[B]:{}}, progress:{[C]:{},[B]:{}},
    totals:{[C]:0,[B]:0}, payout:{[C]:0,[B]:0}, payoutClaimed:{[C]:false,[B]:false},
    seen:{[C]:NOW,[B]:0}, names:{[C]:'Cal',[B]:'Ben'} }))));
await t('cannot create on someone else\'s behalf', () =>
  assertFails(setDoc(doc(dbB,'challenges','x2'), payload())));
await t('stake below 25 refused', () => assertFails(setDoc(doc(dbA,'challenges','x3'), payload({stake:10,pot:10}))));
await t('stake above 100 refused', () => assertFails(setDoc(doc(dbA,'challenges','x4'), payload({stake:500,pot:500}))));
await t('pot must equal stake at invite', () => assertFails(setDoc(doc(dbA,'challenges','x5'), payload({pot:5000}))));
await t('cannot self-start as active', () => assertFails(setDoc(doc(dbA,'challenges','x6'), payload({status:'active'}))));
await t('cannot pre-credit a payout', () => assertFails(setDoc(doc(dbA,'challenges','x7'), payload({payout:{[A]:9999,[B]:0}}))));
await t('cannot pre-fill own progress', () => assertFails(setDoc(doc(dbA,'challenges','x8'), payload({progress:{[A]:{r1:3},[B]:{}}}))));

console.log('── READ ──');
await t('participant reads', () => assertSucceeds(getDoc(doc(dbA,'challenges','c1'))));
await t('other participant reads', () => assertSucceeds(getDoc(doc(dbB,'challenges','c1'))));
await t('stranger cannot read', () => assertFails(getDoc(doc(dbC,'challenges','c1'))));
await t('the app\'s own list query is allowed', () => assertSucceeds(getDocs(query(
  collection(dbA,'challenges'), where('participants','array-contains',A),
  where('status','in',['pending','active','resolved','expired','declined','cancelled'])))));
await t('a query that would leak other people\'s wagers is refused', () =>
  assertFails(getDocs(query(collection(dbC,'challenges'), where('status','==','active')))));

console.log('── DELETE ──');
await t('nobody may delete a challenge', () => assertFails(deleteDoc(doc(dbA,'challenges','c1'))));

console.log('── ACCEPT ──');
await seed('c2');
const acceptPatch = { status:'active', pot:100, startedAt:NOW, endsAt:NOW + 10*86400000,
  ['mapping.'+B]: { r1:{activityId:'b1',activityName:'Jog'}, r2:{activityId:'b2',activityName:'Bike'} },
  ['seen.'+B]: NOW };
await t('opponent accepts', () => assertSucceeds(updateDoc(doc(dbB,'challenges','c2'), acceptPatch)));
await seed('c3');
await t('challenger cannot accept their own invite', () => assertFails(updateDoc(doc(dbA,'challenges','c3'), acceptPatch)));
await t('cannot accept with a short pot', () => assertFails(updateDoc(doc(dbB,'challenges','c3'),
  Object.assign({}, acceptPatch, { pot: 50 }))));
await t('cannot accept leaving a requirement unmapped', () => assertFails(updateDoc(doc(dbB,'challenges','c3'),
  Object.assign({}, acceptPatch, { ['mapping.'+B]: { r1:{activityId:'b1',activityName:'Jog'} } }))));
await t('cannot stretch the deadline past durationDays', () => assertFails(updateDoc(doc(dbB,'challenges','c3'),
  Object.assign({}, acceptPatch, { endsAt: NOW + 900*86400000 }))));

console.log('── PLAY ──');
const active = { status:'active', pot:100, startedAt:NOW-86400000, endsAt:NOW+9*86400000,
  mapping:{ [A]:{r1:{activityId:'a1',activityName:'Run'},r2:{activityId:'a2',activityName:'Read'}},
            [B]:{r1:{activityId:'b1',activityName:'Jog'},r2:{activityId:'b2',activityName:'Bike'}} } };
await seed('c4', Object.assign({}, active, { progress:{[A]:{},[B]:{r1:2}}, totals:{[A]:0,[B]:2} }));
await t('own progress increments', () => assertSucceeds(updateDoc(doc(dbA,'challenges','c4'),
  { ['progress.'+A+'.r1']: 1, ['totals.'+A]: 1 })));
await t('cannot write the opponent\'s progress', () => assertFails(updateDoc(doc(dbA,'challenges','c4'),
  { ['progress.'+B+'.r1']: 3, ['totals.'+B]: 3 })));
await t('cannot sabotage the opponent\'s total', () => assertFails(updateDoc(doc(dbA,'challenges','c4'),
  { ['totals.'+B]: 0 })));
await t('cannot rewrite the opponent\'s mapping', () => assertFails(updateDoc(doc(dbA,'challenges','c4'),
  { ['mapping.'+B]: {} })));
await t('cannot rewrite the agreed requirements mid-run', () => assertFails(updateDoc(doc(dbA,'challenges','c4'),
  { requirements: [{ reqId:'r1', name:'Run', targetCount:1 }] })));
await t('cannot lower the stake mid-run', () => assertFails(updateDoc(doc(dbA,'challenges','c4'), { stake: 1 })));
await t('cannot inflate the pot out of thin air', () => assertFails(updateDoc(doc(dbA,'challenges','c4'), { pot: 100000 })));
await t('cannot move the deadline once set', () => assertFails(updateDoc(doc(dbA,'challenges','c4'),
  { endsAt: NOW + 900*86400000 })));
await t('own seen stamp is fine', () => assertSucceeds(updateDoc(doc(dbA,'challenges','c4'), { ['seen.'+A]: NOW })));
await t('cannot stamp seen for the opponent', () => assertFails(updateDoc(doc(dbA,'challenges','c4'), { ['seen.'+B]: NOW })));

console.log('── RESOLVE ──');
const ahead = Object.assign({}, active, { progress:{[A]:{r1:3,r2:2},[B]:{r1:1}}, totals:{[A]:5,[B]:1} });
await seed('c5', ahead);
await t('the side that is ahead may take the pot', () => assertSucceeds(updateDoc(doc(dbA,'challenges','c5'),
  { status:'resolved', winner:A, outcome:'completed_first', resolvedAt:NOW, pot:0, payout:{[A]:100,[B]:0} })));
await seed('c6', ahead);
await t('the side that is BEHIND cannot declare itself winner', () => assertFails(updateDoc(doc(dbB,'challenges','c6'),
  { status:'resolved', winner:B, outcome:'deadline_lead', resolvedAt:NOW, pot:0, payout:{[B]:100,[A]:0} })));
await t('cannot pay out more than the pot', () => assertFails(updateDoc(doc(dbA,'challenges','c6'),
  { status:'resolved', winner:A, outcome:'deadline_lead', resolvedAt:NOW, pot:0, payout:{[A]:100000,[B]:0} })));
await t('cannot resolve while keeping the pot', () => assertFails(updateDoc(doc(dbA,'challenges','c6'),
  { status:'resolved', winner:A, outcome:'deadline_lead', resolvedAt:NOW, pot:100, payout:{[A]:100,[B]:0} })));
await seed('c7', ahead);
await t('forfeit hands the pot to the OTHER side', () => assertSucceeds(updateDoc(doc(dbA,'challenges','c7'),
  { status:'resolved', winner:B, outcome:'forfeit', resolvedAt:NOW, pot:0, payout:{[B]:100,[A]:0} })));
await seed('c8', ahead);
await t('cannot "forfeit" yourself into a win', () => assertFails(updateDoc(doc(dbA,'challenges','c8'),
  { status:'resolved', winner:A, outcome:'forfeit', resolvedAt:NOW, pot:0, payout:{[A]:100,[B]:0} })));
await t('an already-resolved challenge cannot be re-resolved', () => assertFails(updateDoc(doc(dbB,'challenges','c7'),
  { status:'resolved', winner:B, outcome:'deadline_lead', resolvedAt:NOW, pot:0, payout:{[B]:100,[A]:0} })));

console.log('── EXACT CLIENT WRITES ──');
// vsCommitProgress crossing the final target: the increment and the
// resolution land in ONE write.
await seed('w1', Object.assign({}, active, { progress:{[A]:{r1:3,r2:1},[B]:{r1:1}}, totals:{[A]:4,[B]:1} }));
await t('winning increment + resolution in a single write', () => assertSucceeds(updateDoc(doc(dbA,'challenges','w1'),
  { ['progress.'+A+'.r2']: 2, ['totals.'+A]: 5,
    status:'resolved', winner:A, outcome:'completed_first', resolvedAt:NOW, pot:0, payout:{[A]:100,[B]:0} })));
// vsForfeit carries two extra diagnostic fields.
await seed('w2', Object.assign({}, active, { progress:{[A]:{},[B]:{r1:2}}, totals:{[A]:0,[B]:2} }));
await t('forfeit write with forfeitedBy/forfeitReason', () => assertSucceeds(updateDoc(doc(dbA,'challenges','w2'),
  { status:'resolved', winner:B, outcome:'forfeit', resolvedAt:NOW, pot:0, payout:{[B]:100,[A]:0},
    forfeitedBy:A, forfeitReason:'activity deleted' })));
// …but the extra fields must not become a way to smuggle a win.
await seed('w3', Object.assign({}, active, { progress:{[A]:{},[B]:{r1:2}}, totals:{[A]:0,[B]:2} }));
await t('extra fields cannot smuggle a win to the forfeiter', () => assertFails(updateDoc(doc(dbA,'challenges','w3'),
  { status:'resolved', winner:A, outcome:'forfeit', resolvedAt:NOW, pot:0, payout:{[A]:100,[B]:0},
    forfeitedBy:B, forfeitReason:'nope' })));

console.log('── DECLINE / CANCEL / EXPIRE ──');
await seed('d1');
await t('opponent declines, challenger is owed the pot', () => assertSucceeds(updateDoc(doc(dbB,'challenges','d1'),
  { status:'declined', outcome:'declined_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:50,[B]:0} })));
await seed('d2');
await t('decliner cannot redirect the refund to themselves', () => assertFails(updateDoc(doc(dbB,'challenges','d2'),
  { status:'declined', outcome:'declined_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:0,[B]:50} })));
await t('opponent cannot "cancel" the challenger\'s invite', () => assertFails(updateDoc(doc(dbB,'challenges','d2'),
  { status:'cancelled', outcome:'cancelled_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:50,[B]:0} })));
await t('challenger withdraws their own invite', () => assertSucceeds(updateDoc(doc(dbA,'challenges','d2'),
  { status:'cancelled', outcome:'cancelled_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:50,[B]:0} })));
await seed('d3');
await t('cannot expire an invite that is still in date', () => assertFails(updateDoc(doc(dbB,'challenges','d3'),
  { status:'expired', outcome:'expired_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:50,[B]:0} })));
await seed('d4', { expiresAt: NOW - 1000 });
await t('an out-of-date invite expires', () => assertSucceeds(updateDoc(doc(dbA,'challenges','d4'),
  { status:'expired', outcome:'expired_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:50,[B]:0} })));

console.log('── CLAIM ──');
const settled = { status:'resolved', pot:0, winner:A, outcome:'deadline_lead', resolvedAt:NOW,
  startedAt:NOW-9*86400000, endsAt:NOW-86400000, payout:{[A]:100,[B]:0},
  progress:{[A]:{r1:3,r2:2},[B]:{r1:1}}, totals:{[A]:5,[B]:1} };
await seed('p1', settled);
await t('winner claims their own payout', () => assertSucceeds(updateDoc(doc(dbA,'challenges','p1'),
  { ['payoutClaimed.'+A]: true })));
await t('cannot claim a second time by flipping the flag again', () => assertFails(updateDoc(doc(dbA,'challenges','p1'),
  { ['payoutClaimed.'+A]: true, payout: {[A]:100,[B]:0}, pot: 0, ['totals.'+A]: 99 })));
await t('cannot un-claim to be paid again', () => assertFails(updateDoc(doc(dbA,'challenges','p1'),
  { ['payoutClaimed.'+A]: false })));
await seed('p2', settled);
await t('cannot flip the opponent\'s claim flag', () => assertFails(updateDoc(doc(dbB,'challenges','p2'),
  { ['payoutClaimed.'+A]: true })));
await t('cannot rewrite the payout before claiming it', () => assertFails(updateDoc(doc(dbA,'challenges','p2'),
  { payout:{[A]:100000,[B]:0}, ['payoutClaimed.'+A]: true })));

console.log('── GRIT LEDGER ──');
await t('owner appends a ledger entry', () => assertSucceeds(setDoc(doc(dbA,'users',A,'gritLedger','e1'),
  { at:new Date().toISOString(), delta:-50, balanceAfter:150, reason:'challenge_stake', meta:{} })));
await t('owner reads their ledger', () => assertSucceeds(getDoc(doc(dbA,'users',A,'gritLedger','e1'))));
await t('ledger entries cannot be rewritten', () => assertFails(updateDoc(doc(dbA,'users',A,'gritLedger','e1'), { delta: 9999 })));
await t('ledger entries cannot be deleted', () => assertFails(deleteDoc(doc(dbA,'users',A,'gritLedger','e1'))));
await t('nobody else can read your ledger', () => assertFails(getDoc(doc(dbB,'users',A,'gritLedger','e1'))));

console.log('── NO CROSS-ACCOUNT LEAK ──');
await t('a participant still cannot read the other\'s user document', () => assertFails(getDoc(doc(dbB,'users',A))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
