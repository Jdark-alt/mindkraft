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
  setDoc(doc(ctx.firestore(), 'versusChallenges', id), payload(o)));

console.log('── CREATE ──');
await t('challenger creates a valid invite', () => assertSucceeds(setDoc(doc(dbA,'versusChallenges','c1'), payload())));
await t('non-friend is refused (C has no friends)', () =>
  assertFails(setDoc(doc(dbC,'versusChallenges','x1'), payload({ createdBy: C, opponent: B, participants: [C,B],
    mapping:{[C]:{r1:{activityId:'a',activityName:'a'}},[B]:{}}, progress:{[C]:{},[B]:{}},
    totals:{[C]:0,[B]:0}, payout:{[C]:0,[B]:0}, payoutClaimed:{[C]:false,[B]:false},
    seen:{[C]:NOW,[B]:0}, names:{[C]:'Cal',[B]:'Ben'} }))));
await t('cannot create on someone else\'s behalf', () =>
  assertFails(setDoc(doc(dbB,'versusChallenges','x2'), payload())));
await t('stake below 25 refused', () => assertFails(setDoc(doc(dbA,'versusChallenges','x3'), payload({stake:10,pot:10}))));
await t('stake above 100 refused', () => assertFails(setDoc(doc(dbA,'versusChallenges','x4'), payload({stake:500,pot:500}))));
await t('pot must equal stake at invite', () => assertFails(setDoc(doc(dbA,'versusChallenges','x5'), payload({pot:5000}))));
await t('cannot self-start as active', () => assertFails(setDoc(doc(dbA,'versusChallenges','x6'), payload({status:'active'}))));
await t('cannot pre-credit a payout', () => assertFails(setDoc(doc(dbA,'versusChallenges','x7'), payload({payout:{[A]:9999,[B]:0}}))));
await t('cannot pre-fill own progress', () => assertFails(setDoc(doc(dbA,'versusChallenges','x8'), payload({progress:{[A]:{r1:3},[B]:{}}}))));

console.log('── READ ──');
await t('participant reads', () => assertSucceeds(getDoc(doc(dbA,'versusChallenges','c1'))));
await t('other participant reads', () => assertSucceeds(getDoc(doc(dbB,'versusChallenges','c1'))));
await t('stranger cannot read', () => assertFails(getDoc(doc(dbC,'versusChallenges','c1'))));
await t('the app\'s own list query is allowed', () => assertSucceeds(getDocs(query(
  collection(dbA,'versusChallenges'), where('participants','array-contains',A),
  where('status','in',['pending','active','resolved','expired','declined','cancelled'])))));
await t('a query that would leak other people\'s wagers is refused', () =>
  assertFails(getDocs(query(collection(dbC,'versusChallenges'), where('status','==','active')))));

console.log('── DELETE ──');
await t('nobody may delete a challenge', () => assertFails(deleteDoc(doc(dbA,'versusChallenges','c1'))));

console.log('── ACCEPT ──');
await seed('c2');
const acceptPatch = { status:'active', pot:100, startedAt:NOW, endsAt:NOW + 10*86400000,
  ['mapping.'+B]: { r1:{activityId:'b1',activityName:'Jog'}, r2:{activityId:'b2',activityName:'Bike'} },
  ['seen.'+B]: NOW };
await t('opponent accepts', () => assertSucceeds(updateDoc(doc(dbB,'versusChallenges','c2'), acceptPatch)));
await seed('c3');
await t('challenger cannot accept their own invite', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c3'), acceptPatch)));
await t('cannot accept with a short pot', () => assertFails(updateDoc(doc(dbB,'versusChallenges','c3'),
  Object.assign({}, acceptPatch, { pot: 50 }))));
await t('cannot accept leaving a requirement unmapped', () => assertFails(updateDoc(doc(dbB,'versusChallenges','c3'),
  Object.assign({}, acceptPatch, { ['mapping.'+B]: { r1:{activityId:'b1',activityName:'Jog'} } }))));
await t('cannot stretch the deadline past durationDays', () => assertFails(updateDoc(doc(dbB,'versusChallenges','c3'),
  Object.assign({}, acceptPatch, { endsAt: NOW + 900*86400000 }))));

console.log('── PLAY ──');
const active = { status:'active', pot:100, startedAt:NOW-86400000, endsAt:NOW+9*86400000,
  mapping:{ [A]:{r1:{activityId:'a1',activityName:'Run'},r2:{activityId:'a2',activityName:'Read'}},
            [B]:{r1:{activityId:'b1',activityName:'Jog'},r2:{activityId:'b2',activityName:'Bike'}} } };
await seed('c4', Object.assign({}, active, { progress:{[A]:{},[B]:{r1:2}}, totals:{[A]:0,[B]:2} }));
await t('own progress increments', () => assertSucceeds(updateDoc(doc(dbA,'versusChallenges','c4'),
  { ['progress.'+A+'.r1']: 1, ['totals.'+A]: 1 })));
await t('cannot write the opponent\'s progress', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c4'),
  { ['progress.'+B+'.r1']: 3, ['totals.'+B]: 3 })));
await t('cannot sabotage the opponent\'s total', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c4'),
  { ['totals.'+B]: 0 })));
await t('cannot rewrite the opponent\'s mapping', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c4'),
  { ['mapping.'+B]: {} })));
await t('cannot rewrite the agreed requirements mid-run', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c4'),
  { requirements: [{ reqId:'r1', name:'Run', targetCount:1 }] })));
await t('cannot lower the stake mid-run', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c4'), { stake: 1 })));
await t('cannot inflate the pot out of thin air', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c4'), { pot: 100000 })));
await t('cannot move the deadline once set', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c4'),
  { endsAt: NOW + 900*86400000 })));
await t('own seen stamp is fine', () => assertSucceeds(updateDoc(doc(dbA,'versusChallenges','c4'), { ['seen.'+A]: NOW })));
await t('cannot stamp seen for the opponent', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c4'), { ['seen.'+B]: NOW })));

console.log('── RESOLVE ──');
const ahead = Object.assign({}, active, { progress:{[A]:{r1:3,r2:2},[B]:{r1:1}}, totals:{[A]:5,[B]:1} });
await seed('c5', ahead);
await t('the side that is ahead may take the pot', () => assertSucceeds(updateDoc(doc(dbA,'versusChallenges','c5'),
  { status:'resolved', winner:A, outcome:'completed_first', resolvedAt:NOW, pot:0, payout:{[A]:100,[B]:0} })));
await seed('c6', ahead);
await t('the side that is BEHIND cannot declare itself winner', () => assertFails(updateDoc(doc(dbB,'versusChallenges','c6'),
  { status:'resolved', winner:B, outcome:'deadline_lead', resolvedAt:NOW, pot:0, payout:{[B]:100,[A]:0} })));
await t('cannot pay out more than the pot', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c6'),
  { status:'resolved', winner:A, outcome:'deadline_lead', resolvedAt:NOW, pot:0, payout:{[A]:100000,[B]:0} })));
await t('cannot resolve while keeping the pot', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c6'),
  { status:'resolved', winner:A, outcome:'deadline_lead', resolvedAt:NOW, pot:100, payout:{[A]:100,[B]:0} })));
await seed('c7', ahead);
await t('forfeit hands the pot to the OTHER side', () => assertSucceeds(updateDoc(doc(dbA,'versusChallenges','c7'),
  { status:'resolved', winner:B, outcome:'forfeit', resolvedAt:NOW, pot:0, payout:{[B]:100,[A]:0} })));
await seed('c8', ahead);
await t('cannot "forfeit" yourself into a win', () => assertFails(updateDoc(doc(dbA,'versusChallenges','c8'),
  { status:'resolved', winner:A, outcome:'forfeit', resolvedAt:NOW, pot:0, payout:{[A]:100,[B]:0} })));
await t('an already-resolved challenge cannot be re-resolved', () => assertFails(updateDoc(doc(dbB,'versusChallenges','c7'),
  { status:'resolved', winner:B, outcome:'deadline_lead', resolvedAt:NOW, pot:0, payout:{[B]:100,[A]:0} })));

console.log('── EXACT CLIENT WRITES ──');
// vsCommitProgress crossing the final target: the increment and the
// resolution land in ONE write.
await seed('w1', Object.assign({}, active, { progress:{[A]:{r1:3,r2:1},[B]:{r1:1}}, totals:{[A]:4,[B]:1} }));
await t('winning increment + resolution in a single write', () => assertSucceeds(updateDoc(doc(dbA,'versusChallenges','w1'),
  { ['progress.'+A+'.r2']: 2, ['totals.'+A]: 5,
    status:'resolved', winner:A, outcome:'completed_first', resolvedAt:NOW, pot:0, payout:{[A]:100,[B]:0} })));
// vsForfeit carries two extra diagnostic fields.
await seed('w2', Object.assign({}, active, { progress:{[A]:{},[B]:{r1:2}}, totals:{[A]:0,[B]:2} }));
await t('forfeit write with forfeitedBy/forfeitReason', () => assertSucceeds(updateDoc(doc(dbA,'versusChallenges','w2'),
  { status:'resolved', winner:B, outcome:'forfeit', resolvedAt:NOW, pot:0, payout:{[B]:100,[A]:0},
    forfeitedBy:A, forfeitReason:'activity deleted' })));
// …but the extra fields must not become a way to smuggle a win.
await seed('w3', Object.assign({}, active, { progress:{[A]:{},[B]:{r1:2}}, totals:{[A]:0,[B]:2} }));
await t('extra fields cannot smuggle a win to the forfeiter', () => assertFails(updateDoc(doc(dbA,'versusChallenges','w3'),
  { status:'resolved', winner:A, outcome:'forfeit', resolvedAt:NOW, pot:0, payout:{[A]:100,[B]:0},
    forfeitedBy:B, forfeitReason:'nope' })));

console.log('── DECLINE / CANCEL / EXPIRE ──');
await seed('d1');
await t('opponent declines, challenger is owed the pot', () => assertSucceeds(updateDoc(doc(dbB,'versusChallenges','d1'),
  { status:'declined', outcome:'declined_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:50,[B]:0} })));
await seed('d2');
await t('decliner cannot redirect the refund to themselves', () => assertFails(updateDoc(doc(dbB,'versusChallenges','d2'),
  { status:'declined', outcome:'declined_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:0,[B]:50} })));
await t('opponent cannot "cancel" the challenger\'s invite', () => assertFails(updateDoc(doc(dbB,'versusChallenges','d2'),
  { status:'cancelled', outcome:'cancelled_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:50,[B]:0} })));
await t('challenger withdraws their own invite', () => assertSucceeds(updateDoc(doc(dbA,'versusChallenges','d2'),
  { status:'cancelled', outcome:'cancelled_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:50,[B]:0} })));
await seed('d3');
await t('cannot expire an invite that is still in date', () => assertFails(updateDoc(doc(dbB,'versusChallenges','d3'),
  { status:'expired', outcome:'expired_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:50,[B]:0} })));
await seed('d4', { expiresAt: NOW - 1000 });
await t('an out-of-date invite expires', () => assertSucceeds(updateDoc(doc(dbA,'versusChallenges','d4'),
  { status:'expired', outcome:'expired_refund', winner:null, resolvedAt:NOW, pot:0, payout:{[A]:50,[B]:0} })));

console.log('── CLAIM ──');
const settled = { status:'resolved', pot:0, winner:A, outcome:'deadline_lead', resolvedAt:NOW,
  startedAt:NOW-9*86400000, endsAt:NOW-86400000, payout:{[A]:100,[B]:0},
  progress:{[A]:{r1:3,r2:2},[B]:{r1:1}}, totals:{[A]:5,[B]:1} };
await seed('p1', settled);
await t('winner claims their own payout', () => assertSucceeds(updateDoc(doc(dbA,'versusChallenges','p1'),
  { ['payoutClaimed.'+A]: true })));
await t('cannot claim a second time by flipping the flag again', () => assertFails(updateDoc(doc(dbA,'versusChallenges','p1'),
  { ['payoutClaimed.'+A]: true, payout: {[A]:100,[B]:0}, pot: 0, ['totals.'+A]: 99 })));
await t('cannot un-claim to be paid again', () => assertFails(updateDoc(doc(dbA,'versusChallenges','p1'),
  { ['payoutClaimed.'+A]: false })));
await seed('p2', settled);
await t('cannot flip the opponent\'s claim flag', () => assertFails(updateDoc(doc(dbB,'versusChallenges','p2'),
  { ['payoutClaimed.'+A]: true })));
await t('cannot rewrite the payout before claiming it', () => assertFails(updateDoc(doc(dbA,'versusChallenges','p2'),
  { payout:{[A]:100000,[B]:0}, ['payoutClaimed.'+A]: true })));

console.log('── GRIT LEDGER ──');
await t('owner appends a ledger entry', () => assertSucceeds(setDoc(doc(dbA,'users',A,'gritLedger','e1'),
  { at:new Date().toISOString(), delta:-50, balanceAfter:150, reason:'challenge_stake', meta:{} })));
await t('owner reads their ledger', () => assertSucceeds(getDoc(doc(dbA,'users',A,'gritLedger','e1'))));
await t('ledger entries cannot be rewritten', () => assertFails(updateDoc(doc(dbA,'users',A,'gritLedger','e1'), { delta: 9999 })));
await t('ledger entries cannot be deleted', () => assertFails(deleteDoc(doc(dbA,'users',A,'gritLedger','e1'))));
await t('nobody else can read your ledger', () => assertFails(getDoc(doc(dbB,'users',A,'gritLedger','e1'))));

console.log('── GIFTS: CREATE ──');
// A and B are mutual friends; C has nobody.
const SENT = '2026-08-20T09:00:00.000Z';
function gift(o = {}) {
  return Object.assign({
    id: 'g1', type: 'shield', senderUid: A, senderName: 'Ana',
    receiverUid: B, receiverName: 'Ben', sentAt: SENT, status: 'pending',
    consumedAt: null, consumedActivityId: null, consumedActivityTitle: null,
    baseXP: null, awardedXP: null, thanked: false, thankedAt: null
  }, o);
}
const giftAt = (d, owner, col, id) => doc(d, 'users', owner, col, id);

await t('sender creates a gift in a friend\'s inbox', () =>
  assertSucceeds(setDoc(giftAt(dbA, B, 'gifts', 'g1'), gift())));
await t('sender creates the matching mirror in their own tree', () =>
  assertSucceeds(setDoc(giftAt(dbA, A, 'giftsSent', 'g1'), gift())));
await t('an xp_boost gift is allowed', () =>
  assertSucceeds(setDoc(giftAt(dbA, B, 'gifts', 'g2'), gift({ id: 'g2', type: 'xp_boost' }))));
await t('an invented gift type is refused', () =>
  assertFails(setDoc(giftAt(dbA, B, 'gifts', 'x1'), gift({ id: 'x1', type: 'infinite_xp' }))));
await t('a spoofed senderUid is refused', () =>
  assertFails(setDoc(giftAt(dbA, B, 'gifts', 'x2'), gift({ id: 'x2', senderUid: C }))));
await t('a non-friend cannot gift', () =>
  assertFails(setDoc(giftAt(dbC, B, 'gifts', 'x3'), gift({ id: 'x3', senderUid: C, receiverUid: B }))));
await t('you cannot create a gift in your OWN inbox', () =>
  assertFails(setDoc(giftAt(dbB, B, 'gifts', 'x4'), gift({ id: 'x4', senderUid: B, receiverUid: B }))));
await t('the document id must match the gift id', () =>
  assertFails(setDoc(giftAt(dbA, B, 'gifts', 'x5'), gift({ id: 'not-x5' }))));
await t('a gift cannot be born consumed', () =>
  assertFails(setDoc(giftAt(dbA, B, 'gifts', 'x6'), gift({ id: 'x6', status: 'consumed' }))));
await t('a gift cannot be born thanked', () =>
  assertFails(setDoc(giftAt(dbA, B, 'gifts', 'x7'), gift({ id: 'x7', thanked: true }))));
await t('a gift cannot carry pre-filled XP', () =>
  assertFails(setDoc(giftAt(dbA, B, 'gifts', 'x8'), gift({ id: 'x8', awardedXP: 9999 }))));
await t('a gift cannot smuggle an extra field', () =>
  assertFails(setDoc(giftAt(dbA, B, 'gifts', 'x9'), gift({ id: 'x9', message: 'hello there' }))));
await t('the receiverUid must match the inbox owner', () =>
  assertFails(setDoc(giftAt(dbA, B, 'gifts', 'xa'), gift({ id: 'xa', receiverUid: C }))));

console.log('── GIFTS: READ ──');
await t('receiver reads their own inbox', () => assertSucceeds(getDoc(giftAt(dbB, B, 'gifts', 'g1'))));
await t('sender cannot read the receiver\'s inbox', () => assertFails(getDoc(giftAt(dbA, B, 'gifts', 'g1'))));
await t('a stranger cannot read someone\'s inbox', () => assertFails(getDoc(giftAt(dbC, B, 'gifts', 'g1'))));
await t('sender reads their own giftsSent', () => assertSucceeds(getDoc(giftAt(dbA, A, 'giftsSent', 'g1'))));
await t('receiver cannot read the sender\'s giftsSent', () => assertFails(getDoc(giftAt(dbB, A, 'giftsSent', 'g1'))));

console.log('── GIFTS: CONSUME ──');
await t('receiver consumes their gift', () => assertSucceeds(updateDoc(giftAt(dbB, B, 'gifts', 'g2'), {
  status: 'consumed', consumedAt: SENT, consumedActivityId: 'a1',
  consumedActivityTitle: 'Run', baseXP: 20, awardedXP: 40 })));
await t('receiver may set thanks on their own gift', () =>
  assertSucceeds(updateDoc(giftAt(dbB, B, 'gifts', 'g2'), { thanked: true, thankedAt: SENT, mirrorSynced: true })));
await t('receiver cannot rewrite who sent it', () =>
  assertFails(updateDoc(giftAt(dbB, B, 'gifts', 'g2'), { status: 'consumed', senderUid: C })));
await t('receiver cannot rewrite the gift type', () =>
  assertFails(updateDoc(giftAt(dbB, B, 'gifts', 'g2'), { status: 'consumed', type: 'shield' })));
await t('receiver cannot backdate sentAt', () =>
  assertFails(updateDoc(giftAt(dbB, B, 'gifts', 'g2'), { status: 'consumed', sentAt: '2020-01-01T00:00:00.000Z' })));
await t('receiver cannot un-consume a gift', () =>
  assertFails(updateDoc(giftAt(dbB, B, 'gifts', 'g2'), { status: 'pending' })));
await t('sender cannot consume the gift they sent', () =>
  assertFails(updateDoc(giftAt(dbA, B, 'gifts', 'g1'), { status: 'consumed', consumedAt: SENT })));
await t('nobody may delete a gift', () => assertFails(deleteDoc(giftAt(dbB, B, 'gifts', 'g1'))));

console.log('── GIFTS: THE MIRROR ──');
await env.withSecurityRulesDisabled(async ctx =>
  setDoc(doc(ctx.firestore(), 'users', A, 'giftsSent', 'g2'), gift({ id: 'g2', type: 'xp_boost' })));
await t('receiver stamps the four fields on the sender\'s mirror', () =>
  assertSucceeds(updateDoc(giftAt(dbB, A, 'giftsSent', 'g2'), {
    status: 'consumed', consumedAt: SENT, thanked: true, thankedAt: SENT })));
await t('receiver cannot touch a fifth field on the mirror', () =>
  assertFails(updateDoc(giftAt(dbB, A, 'giftsSent', 'g2'), {
    status: 'consumed', consumedAt: SENT, thanked: true, thankedAt: SENT, awardedXP: 9999 })));
await t('a third party cannot write the mirror', () =>
  assertFails(updateDoc(giftAt(dbC, A, 'giftsSent', 'g2'), {
    status: 'consumed', consumedAt: SENT, thanked: false, thankedAt: null })));
await t('nobody may delete a mirror', () => assertFails(deleteDoc(giftAt(dbA, A, 'giftsSent', 'g2'))));
await t('you cannot plant a mirror in someone else\'s tree', () =>
  assertFails(setDoc(giftAt(dbB, A, 'giftsSent', 'x10'), gift({ id: 'x10', senderUid: A, receiverUid: B }))));

console.log('── LEADERBOARD BOARDS ──');
const board = (uid, o = {}) => Object.assign({
  uid, optIn: true, optInFrom: '2026-08-17', members: [], scored: [], prevScored: [],
  scoredFrom: '2026-08-17', prevScoredFrom: null,
  week: { anchor: '2026-08-17', xp: 100, completions: 5 }, prev: null,
  displayName: 'Someone', photoURL: null, level: 9, updatedAt: SENT
}, o);

await t('owner publishes their board', () =>
  assertSucceeds(setDoc(doc(dbA, 'leaderboardBoards', A), board(A, { members: [B], scored: [B] }))));
await t('you cannot publish someone else\'s board', () =>
  assertFails(setDoc(doc(dbC, 'leaderboardBoards', A), board(A))));
await t('the uid field must match the document', () =>
  assertFails(setDoc(doc(dbA, 'leaderboardBoards', A), board(C))));
await t('a member of the board may read it — this IS the mutuality test', () =>
  assertSucceeds(getDoc(doc(dbB, 'leaderboardBoards', A))));
await t('someone not on the board cannot read it', () =>
  assertFails(getDoc(doc(dbC, 'leaderboardBoards', A))));
await t('owner reads their own board', () => assertSucceeds(getDoc(doc(dbA, 'leaderboardBoards', A))));
await env.withSecurityRulesDisabled(async ctx =>
  setDoc(doc(ctx.firestore(), 'leaderboardBoards', A), board(A, { members: [], scored: [], prevScored: [B], prevScoredFrom: '2026-08-10' })));
await t('a member of last week\'s frozen roster may still read it', () =>
  assertSucceeds(getDoc(doc(dbB, 'leaderboardBoards', A))));
await t('owner withdraws their board on opting out', () =>
  assertSucceeds(deleteDoc(doc(dbA, 'leaderboardBoards', A))));
await t('nobody else may delete a board', () => {
  return env.withSecurityRulesDisabled(async ctx =>
    setDoc(doc(ctx.firestore(), 'leaderboardBoards', A), board(A, { members: [B] })))
    .then(() => assertFails(deleteDoc(doc(dbB, 'leaderboardBoards', A))));
});

console.log('── PACTS ──');
// Pact Mode's shared record. Same escrow shape as a challenge, but the two
// sides commit SEPARATE targets and share only the outcome — so the accept
// rule has to let the partner write their own term while pinning the
// initiator's, and neither side may touch the other's progress counter.
const pactDoc = (id, o = {}) => Object.assign({
  id, schemaVersion: 1, participants: [A, B], createdBy: A, partner: B,
  names: { [A]: 'Ana', [B]: 'Ben' }, status: 'pending',
  stake: 40, pot: 40, durationDays: 7,
  createdAt: NOW, expiresAt: NOW + 7 * 86400000,
  startedAt: null, endsAt: null,
  terms: { [A]: { activityId: 'a1', activityName: 'Run', target: 5 } },
  progress: { [A]: 0, [B]: 0 },
  outcome: null, failedBy: null, resolvedAt: null,
  payout: { [A]: 0, [B]: 0 }, payoutClaimed: { [A]: false, [B]: false }, seen: {}
}, o);
const seedPact = (id, o) => env.withSecurityRulesDisabled(async ctx =>
  setDoc(doc(ctx.firestore(), 'pacts', id), pactDoc(id, o)));

await t('initiator creates a valid pact', () =>
  assertSucceeds(setDoc(doc(dbA, 'pacts', 'p1'), pactDoc('p1'))));
await t('a pact with a non-friend is refused', () =>
  assertFails(setDoc(doc(dbC, 'pacts', 'px1'), pactDoc('px1', {
    participants: [C, B], createdBy: C, partner: B,
    names: { [C]: 'Cal', [B]: 'Ben' },
    terms: { [C]: { activityId: 'a1', activityName: 'Run', target: 5 } },
    progress: { [C]: 0, [B]: 0 }, payout: { [C]: 0, [B]: 0 },
    payoutClaimed: { [C]: false, [B]: false } }))));
await t('you cannot create a pact on someone else\'s behalf', () =>
  assertFails(setDoc(doc(dbB, 'pacts', 'px2'), pactDoc('px2'))));
await t('a pact with yourself is refused', () =>
  assertFails(setDoc(doc(dbA, 'pacts', 'px3'), pactDoc('px3', {
    participants: [A], partner: A }))));
await t('the pot must equal the stake at create — no minting', () =>
  assertFails(setDoc(doc(dbA, 'pacts', 'px4'), pactDoc('px4', { pot: 400 }))));
await t('a window under 5 days is refused', () =>
  assertFails(setDoc(doc(dbA, 'pacts', 'px5'), pactDoc('px5', { durationDays: 2 }))));
await t('a pact cannot be created already active', () =>
  assertFails(setDoc(doc(dbA, 'pacts', 'px6'), pactDoc('px6', { status: 'active', startedAt: NOW }))));

await t('a participant reads the pact', () => assertSucceeds(getDoc(doc(dbB, 'pacts', 'p1'))));
await t('a stranger cannot read the pact', () => assertFails(getDoc(doc(dbC, 'pacts', 'p1'))));

await seedPact('p2');
await t('the partner accepts with their own term', () =>
  assertSucceeds(updateDoc(doc(dbB, 'pacts', 'p2'), {
    status: 'active', pot: 80, startedAt: NOW, endsAt: NOW + 7 * 86400000,
    ['terms.' + B]: { activityId: 'b1', activityName: 'Swim', target: 4 },
    ['names.' + B]: 'Ben' })));
await seedPact('p3');
await t('accepting cannot rewrite the initiator\'s term', () =>
  assertFails(updateDoc(doc(dbB, 'pacts', 'p3'), {
    status: 'active', pot: 80, startedAt: NOW, endsAt: NOW + 7 * 86400000,
    ['terms.' + A]: { activityId: 'a1', activityName: 'Run', target: 1 },
    ['terms.' + B]: { activityId: 'b1', activityName: 'Swim', target: 4 } })));
await seedPact('p4');
await t('the initiator cannot accept their own pact', () =>
  assertFails(updateDoc(doc(dbA, 'pacts', 'p4'), {
    status: 'active', pot: 80, startedAt: NOW, endsAt: NOW + 7 * 86400000,
    ['terms.' + A]: { activityId: 'a1', activityName: 'Run', target: 5 } })));
await seedPact('p5');
await t('accepting cannot inflate the pot', () =>
  assertFails(updateDoc(doc(dbB, 'pacts', 'p5'), {
    status: 'active', pot: 800, startedAt: NOW, endsAt: NOW + 7 * 86400000,
    ['terms.' + B]: { activityId: 'b1', activityName: 'Swim', target: 4 } })));

const ACTIVE = { status: 'active', pot: 80, startedAt: NOW, endsAt: NOW + 7 * 86400000,
  terms: { [A]: { activityId: 'a1', activityName: 'Run', target: 5 },
           [B]: { activityId: 'b1', activityName: 'Swim', target: 4 } } };
await seedPact('p6', ACTIVE);
await t('you move your own progress', () =>
  assertSucceeds(updateDoc(doc(dbA, 'pacts', 'p6'), { ['progress.' + A]: 1 })));
await t('you cannot move your partner\'s progress', () =>
  assertFails(updateDoc(doc(dbA, 'pacts', 'p6'), { ['progress.' + B]: 4 })));
await t('a stranger cannot move anyone\'s progress', () =>
  assertFails(updateDoc(doc(dbC, 'pacts', 'p6'), { ['progress.' + A]: 9 })));

// Multi-activity pacts keep the per-activity counters INSIDE progress[uid], as
// a map rather than a number. That shape is the reason these rules did not have
// to change: the branch pins the OTHER side by equality, which holds for a map
// exactly as it did for an integer. If that ever stopped being true, a partner
// could be locked out of their own progress writes — so it is pinned here.
const ACTIVE_MULTI = { status: 'active', pot: 80, startedAt: NOW, endsAt: NOW + 7 * 86400000,
  terms: { [A]: { items: [{ activityId: 'a1', activityName: 'Run', target: 5 },
                          { activityId: 'a2', activityName: 'Read', target: 3 }] },
           [B]: { items: [{ activityId: 'b1', activityName: 'Swim', target: 4 }] } },
  progress: { [A]: { a1: 0, a2: 0 }, [B]: { b1: 0 } } };
await seedPact('pm1', ACTIVE_MULTI);
await t('you move one of your own activities', () =>
  assertSucceeds(updateDoc(doc(dbA, 'pacts', 'pm1'), { ['progress.' + A + '.a1']: 1 })));
await t('you move a second of your own activities', () =>
  assertSucceeds(updateDoc(doc(dbA, 'pacts', 'pm1'), { ['progress.' + A + '.a2']: 2 })));
await t('you cannot move an activity on your partner\'s side', () =>
  assertFails(updateDoc(doc(dbA, 'pacts', 'pm1'), { ['progress.' + B + '.b1']: 4 })));
await t('you cannot replace your partner\'s whole counter map', () =>
  assertFails(updateDoc(doc(dbA, 'pacts', 'pm1'), { ['progress.' + B]: { b1: 4 } })));
await t('a multi-activity pact still refuses a smuggled term change', () =>
  assertFails(updateDoc(doc(dbA, 'pacts', 'pm1'), {
    ['progress.' + A + '.a1']: 2,
    ['terms.' + A]: { items: [{ activityId: 'a1', activityName: 'Run', target: 1 }] } })));
await t('the partner accepts with several activities of their own', () => {
  return seedPact('pm2').then(() => assertSucceeds(updateDoc(doc(dbB, 'pacts', 'pm2'), {
    status: 'active', pot: 80, startedAt: NOW, endsAt: NOW + 7 * 86400000,
    ['terms.' + B]: { items: [{ activityId: 'b1', activityName: 'Swim', target: 4 },
                              { activityId: 'b2', activityName: 'Cycle', target: 6 }] },
    ['names.' + B]: 'Ben' })));
});

await seedPact('p7', ACTIVE);
await t('either side may record the resolution', () =>
  assertSucceeds(updateDoc(doc(dbB, 'pacts', 'p7'), {
    status: 'resolved', outcome: 'broken', failedBy: A, resolvedAt: NOW,
    pot: 0, payout: { [A]: 0, [B]: 0 } })));
await t('a resolution that leaves Grit in the pot is refused', () => {
  return seedPact('p8', ACTIVE).then(() => assertFails(updateDoc(doc(dbA, 'pacts', 'p8'), {
    status: 'resolved', outcome: 'kept', failedBy: null, resolvedAt: NOW,
    pot: 80, payout: { [A]: 52, [B]: 52 } })));
});
await t('resolution cannot smuggle a term change through with it', () => {
  return seedPact('p9', ACTIVE).then(() => assertFails(updateDoc(doc(dbA, 'pacts', 'p9'), {
    status: 'resolved', outcome: 'kept', resolvedAt: NOW, pot: 0,
    payout: { [A]: 52, [B]: 52 },
    ['terms.' + B]: { activityId: 'b1', activityName: 'Swim', target: 1 } })));
});

const RESOLVED = Object.assign({}, ACTIVE, { status: 'resolved', outcome: 'kept',
  resolvedAt: NOW, pot: 0, payout: { [A]: 52, [B]: 52 } });
await seedPact('p10', RESOLVED);
await t('you claim your own payout', () =>
  assertSucceeds(updateDoc(doc(dbA, 'pacts', 'p10'), { ['payoutClaimed.' + A]: true })));
await t('you cannot claim on your partner\'s behalf', () => {
  return seedPact('p11', RESOLVED).then(() => assertFails(
    updateDoc(doc(dbA, 'pacts', 'p11'), { ['payoutClaimed.' + B]: true })));
});
await t('a claim cannot be replayed to pay twice', () => {
  return seedPact('p12', Object.assign({}, RESOLVED, { payoutClaimed: { [A]: true, [B]: false } }))
    .then(() => assertFails(updateDoc(doc(dbA, 'pacts', 'p12'), { ['payoutClaimed.' + A]: true })));
});
await t('a claim cannot raise its own payout on the way through', () => {
  return seedPact('p13', RESOLVED).then(() => assertFails(updateDoc(doc(dbA, 'pacts', 'p13'), {
    ['payoutClaimed.' + A]: true, ['payout.' + A]: 5000 })));
});
await t('a pact that happened cannot be deleted', () =>
  assertFails(deleteDoc(doc(dbA, 'pacts', 'p10'))));

console.log('── FRIEND REQUESTS ──');
// Adding by code is unilateral: the sender writes this document to tell the
// other person it happened. The only write the RECIPIENT makes is the accept
// marker, which exists solely so onFriendRequestWrite can tell an accept from
// a dismissal — the delete looks identical either way. It must not be a way for
// the recipient to put arbitrary text in front of the sender.
const freq = (o = {}) => Object.assign({
  toUID: B, fromUID: A, fromName: 'Ana', fromPhotoURL: null, fromCode: 'MK-AAAA',
  createdAt: new Date(NOW).toISOString()
}, o);
const seedReq = (id, o) => env.withSecurityRulesDisabled(async ctx =>
  setDoc(doc(ctx.firestore(), 'friendRequests', id), freq(o)));

await t('you send a request as yourself', () =>
  assertSucceeds(setDoc(doc(dbA, 'friendRequests', 'fr1'), freq())));
await t('you cannot send a request as someone else', () =>
  assertFails(setDoc(doc(dbC, 'friendRequests', 'fx1'), freq())));
await t('the recipient reads it', () => assertSucceeds(getDoc(doc(dbB, 'friendRequests', 'fr1'))));
await t('the sender cannot read it back', () => assertFails(getDoc(doc(dbA, 'friendRequests', 'fr1'))));
await t('a stranger cannot read it', () => assertFails(getDoc(doc(dbC, 'friendRequests', 'fr1'))));

await seedReq('fr2');
await t('the recipient stamps the accept marker', () =>
  assertSucceeds(updateDoc(doc(dbB, 'friendRequests', 'fr2'), {
    status: 'accepted', toName: 'Ben', acceptedAt: new Date(NOW).toISOString() })));
await t('the sender cannot stamp it for them', () => {
  return seedReq('fr3').then(() => assertFails(updateDoc(doc(dbA, 'friendRequests', 'fr3'), {
    status: 'accepted', toName: 'Ana', acceptedAt: new Date(NOW).toISOString() })));
});
await t('a stranger cannot stamp it', () => {
  return seedReq('fr4').then(() => assertFails(updateDoc(doc(dbC, 'friendRequests', 'fr4'), {
    status: 'accepted', toName: 'Cal', acceptedAt: new Date(NOW).toISOString() })));
});
await t('the marker cannot be any status but accepted', () => {
  return seedReq('fr5').then(() => assertFails(updateDoc(doc(dbB, 'friendRequests', 'fr5'), {
    status: 'declined', toName: 'Ben' })));
});
await t('the marker cannot rewrite who it came from', () => {
  return seedReq('fr6').then(() => assertFails(updateDoc(doc(dbB, 'friendRequests', 'fr6'), {
    status: 'accepted', toName: 'Ben', fromUID: C })));
});
await t('the marker cannot carry an essay', () => {
  return seedReq('fr7').then(() => assertFails(updateDoc(doc(dbB, 'friendRequests', 'fr7'), {
    status: 'accepted', toName: 'x'.repeat(400) })));
});
await t('the recipient dismisses it', () =>
  assertSucceeds(deleteDoc(doc(dbB, 'friendRequests', 'fr1'))));
await t('the sender cannot delete it', () => {
  return seedReq('fr8').then(() => assertFails(deleteDoc(doc(dbA, 'friendRequests', 'fr8'))));
});

console.log('── MODE REMINDERS ──');
const modeReminder = (o = {}) => Object.assign({
  type: 'mode', modeKind: 'habit', modeId: 'md-1', phase: 'pre',
  activityId: 'a1', activityName: 'Run', localTime: '21:00', timezone: 'UTC',
  windowStart: '22:00', windowEnd: '23:00', why: 'mine', anchor: '',
  active: true, nextSendAt: null, lastSentDate: null
}, o);
await t('you create your own mode reminder', () =>
  assertSucceeds(setDoc(doc(dbA, 'users', A, 'reminders', 'mode-habit-1'), modeReminder())));
await t('a mode reminder cannot masquerade as the general one', () =>
  assertFails(setDoc(doc(dbA, 'users', A, 'reminders', 'general'), modeReminder())));
await t('a mode reminder cannot take an activity-reminder id', () =>
  assertFails(setDoc(doc(dbA, 'users', A, 'reminders', 'ar-1'), modeReminder())));
await t('an unknown modeKind is refused', () =>
  assertFails(setDoc(doc(dbA, 'users', A, 'reminders', 'mode-x-1'), modeReminder({ modeKind: 'berserk' }))));
await t('a bad time is refused', () =>
  assertFails(setDoc(doc(dbA, 'users', A, 'reminders', 'mode-habit-2'), modeReminder({ localTime: '99:99' }))));
await t('you cannot plant a reminder in someone else\'s tree', () =>
  assertFails(setDoc(doc(dbB, 'users', A, 'reminders', 'mode-habit-3'), modeReminder())));

console.log('── NO CROSS-ACCOUNT LEAK ──');
await t('a participant still cannot read the other\'s user document', () => assertFails(getDoc(doc(dbB,'users',A))));

console.log(`\n${pass} passed, ${fail} failed`);
await env.cleanup();
process.exit(fail ? 1 : 0);
