// ══════════════════════════════════════════════════════════════════════════
// Friends/gifting/leaderboard-payout invariants, asserted against the real
// app.js in headless Chromium with a stubbed Firestore.
//
//     node test/social/social.test.mjs
//
// Covers the §10 invariants of the gifting spec that are testable without a
// server: the half-price rule, spend-before-write and the refund on failure,
// the stable giftId, the silent queue, one gift per completion and never
// beyond 2x, self-purchased boosts going first, shields resolving into the
// pool, thanks carrying no text, and the leaderboard payout arithmetic
// including its two anti-farming rules.
// ══════════════════════════════════════════════════════════════════════════
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { build, serve } from './harness.mjs';

const PORT = 8771;
const dir = build();
const server = await serve(dir, PORT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('dialog', d => d.accept());
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(1000);

const out = await page.evaluate(async () => {
    const log = [];
    const ok = (n, c, x) => log.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : ''));

    const ME = 'uidMe', FRIEND = 'uidPal';
    const act = (id, n) => ({
        id, name: n, baseXP: 10, frequency: 'daily', completionHistory: [],
        completionCount: 0, streak: 0, bestStreak: 0, totalXP: 0
    });

    function boot(balance) {
        window.__store.clear();
        window.__fail.clear();
        window.__writes.length = 0;
        window.currentUser = { uid: ME, displayName: 'Mira', photoURL: null };
        window.userData = {
            level: 12, currentXP: 0, totalXP: 0, friends: [FRIEND],
            friendCode: 'MK-AAAA', profile: { username: 'Mira' },
            leaderboardHidden: [], rewards: {}, settings: {},
            grit: {
                schemaVersion: 1, balance, lifetimeEarned: balance, lifetimeSpent: 0,
                shieldPool: 0, week: null, awarded: {}, boostPurchases: [],
                cadence: {}, pendingBoost: null
            },
            dimensions: [{ id: 'd1', name: 'Body', dimTotalXP: 0, paths: [
                { id: 'p1', name: 'Fit', activities: [act('a1', 'Run'), act('a2', 'Read')] }
            ] }]
        };
        window._dataOwnerUid = ME;
        window._dataLoadFailed = false;
        window.__store.set('users/' + ME, JSON.parse(JSON.stringify(window.userData)));
        window.__store.set('users/' + FRIEND, { friends: [ME] });
    }

    const G = () => window.userData.grit;
    const giftDocs = (owner, col) => {
        const out = [];
        const prefix = 'users/' + owner + '/' + col + '/';
        for (const [p, v] of window.__store) if (p.startsWith(prefix)) out.push(v);
        return out;
    };

    // ── Invariant 1: gifted costs exactly half ────────────────────────────
    boot(500);
    const half = await window.__t.costs();
    ok('a gifted shield is half the self price', half.giftShield * 2 === half.shield, half);
    ok('a gifted boost is half the self price', half.giftBoost * 2 === half.boost, half);

    // ── Invariants 2 + 3: spend, then write; one id; both mirrors ─────────
    boot(500);
    let res = await window.giftSend('shield', FRIEND, 'Pal');
    const inbox = giftDocs(FRIEND, 'gifts');
    const sent  = giftDocs(ME, 'giftsSent');
    ok('the send succeeds', res.ok === true, res.message);
    ok('Grit is spent at the gifted price', G().balance === 500 - half.giftShield, G().balance);
    ok('the gift lands in the receiver\'s subcollection', inbox.length === 1);
    ok('the sender mirror is written too', sent.length === 1);
    ok('both mirrors carry the same giftId', inbox[0] && sent[0] && inbox[0].id === sent[0].id);
    ok('both display names are denormalized at write time',
        inbox[0].senderName === 'Mira' && inbox[0].receiverName === 'Pal', inbox[0]);
    ok('the gift is born pending and unthanked',
        inbox[0].status === 'pending' && inbox[0].thanked === false && inbox[0].consumedAt === null);
    ok('a ledger entry names the receiver',
        window.__t.ledger().some(e => e.reason === 'gift_shield' && e.meta.receiverUid === FRIEND));

    // ── Invariant 2: a failed write refunds ───────────────────────────────
    boot(500);
    window.__fail.add('users/' + FRIEND + '/gifts');
    res = await window.giftSend('shield', FRIEND, 'Pal');
    ok('a refused gift write reports failure', res.ok === false, res.message);
    ok('the refund puts the Grit back', G().balance === 500, G().balance);
    ok('the refund is a correction in the ledger',
        window.__t.ledger().some(e => e.reason === 'correction' && e.delta === half.giftShield));
    ok('neither document survives a failed batch',
        giftDocs(FRIEND, 'gifts').length === 0 && giftDocs(ME, 'giftsSent').length === 0);

    // ── Invariant 3: the id is stable across a retry ──────────────────────
    boot(500);
    window.__fail.add('users/' + FRIEND + '/gifts');
    await window.giftSend('xp_boost', FRIEND, 'Pal');
    const firstId = window.__t.inflight()['xp_boost|' + FRIEND];
    window.__fail.clear();
    await window.giftSend('xp_boost', FRIEND, 'Pal');
    const landed = giftDocs(FRIEND, 'gifts')[0];
    ok('a retry reuses the same giftId', !!firstId && landed && landed.id === firstId, { firstId, landed: landed && landed.id });
    ok('a retry creates exactly one gift', giftDocs(FRIEND, 'gifts').length === 1);

    // ── §3.2: the gifted-boost cap is separate from the self cap ──────────
    boot(1000);
    for (let i = 0; i < 3; i++) await window.giftSend('xp_boost', FRIEND, 'Pal_' + i);
    ok('three gifted boosts are allowed in a month', giftDocs(FRIEND, 'gifts').length === 3);
    res = await window.giftSend('xp_boost', FRIEND, 'Pal');
    ok('a fourth gifted boost is refused', res.ok === false, res.message);
    ok('the self-purchase allowance is untouched by gifting',
        window.__t.selfBoostsLeft() === 1, window.__t.selfBoostsLeft());
    ok('every gifted purchase is tagged as a gift',
        G().boostPurchases.every(p => p.kind === 'gift'), G().boostPurchases);

    // ── §4: a gifted shield resolves straight into the pool ───────────────
    boot(0);
    window.__t.seedGift({ type: 'shield', senderUid: 'uidX', senderName: 'Sam', sentAt: '2026-08-01T00:00:00.000Z' });
    await window.__t.runInbox();
    ok('a gifted shield lands in the pool', G().shieldPool === 1, G().shieldPool);
    ok('the shield gift is marked consumed',
        giftDocs(ME, 'gifts')[0].status === 'consumed');
    await window.__t.runInbox();
    ok('a second inbox pass does not double-credit it', G().shieldPool === 1, G().shieldPool);

    // ── Invariants 5 + 6 + 7: the silent queue ────────────────────────────
    boot(0);
    window.__t.seedGift({ id: 'gA', type: 'xp_boost', senderUid: 'uidX', senderName: 'Sam', sentAt: '2026-08-01T00:00:00.000Z' });
    window.__t.seedGift({ id: 'gB', type: 'xp_boost', senderUid: 'uidY', senderName: 'Sky', sentAt: '2026-08-02T00:00:00.000Z' });
    await window.__t.runInbox();
    ok('the queue is oldest-first', window.__t.queue().map(g => g.id).join(',') === 'gA,gB');
    ok('nothing in the DOM mentions a pending gift',
        !document.body.innerText.toLowerCase().includes('double xp') ||
        !document.body.innerText.toLowerCase().includes('waiting'));

    const a1 = window.userData.dimensions[0].paths[0].activities[0];
    const base = window.__t.predict(a1).preBoostXP;
    let p = window.__t.predict(a1);
    ok('a queued gift doubles the completion', p.earnedXP === base * 2, { base, earned: p.earnedXP });
    ok('it is the oldest gift that is taken', p.giftBoost && p.giftBoost.id === 'gA');

    // A self-purchased boost goes first (invariant 7).
    G().pendingBoost = { activityId: null, purchasedAt: new Date().toISOString() };
    p = window.__t.predict(a1);
    ok('a self-purchased boost is consumed before a gift', p.gritBoosted === true && p.giftBoost === null);
    ok('two boosts never compound past 2x', p.earnedXP === base * 2, p.earnedXP);
    G().pendingBoost = null;

    // One gift per completion.
    await window.completeActivity(0, 0, 0);
    ok('exactly one gift is taken by one completion', window.__t.queue().length === 1, window.__t.queue().length);
    ok('the next gift in line is the second one', window.__t.queue()[0].id === 'gB');
    const consumed = giftDocs(ME, 'gifts').find(g => g.id === 'gA');
    ok('the consumed gift records the activity and both XP figures',
        consumed.status === 'consumed' && consumed.consumedActivityTitle === 'Run' &&
        consumed.awardedXP === consumed.baseXP * 2, consumed);
    ok('the completion recorded the doubled XP',
        a1.completionHistory[a1.completionHistory.length - 1].xp === consumed.awardedXP);

    // ── §5.2 + §5.3: the reveal, and thanks with no text ──────────────────
    await new Promise(r => setTimeout(r, 700));
    const modal = document.getElementById('giftRevealOverlay');
    ok('the reveal modal fires on the consuming completion', !!modal);
    if (modal) {
        ok('the reveal names the sender', modal.innerText.includes('Sam'), modal.innerText.slice(0, 80));
        ok('the reveal shows both XP figures',
            !!modal.querySelector('.gift-reveal-base') && !!modal.querySelector('.gift-reveal-awarded'));
        ok('the reveal carries no free-text input', modal.querySelectorAll('input,textarea').length === 0);
        modal.querySelector('#giftThankBtn').click();
        await new Promise(r => setTimeout(r, 300));
        const btn = document.getElementById('giftThankBtn');
        ok('the thank button disables after tapping', !btn || btn.disabled === true);
    }
    const own = giftDocs(ME, 'gifts').find(g => g.id === 'gA');
    ok('thanks is recorded on the receiver\'s copy', own.thanked === true && !!own.thankedAt, own.thanked);

    // ── §6: the mirror is what tells the sender, exactly once ─────────────
    boot(0);
    window.__t.seedGift({ id: 'gM', type: 'xp_boost', senderUid: 'uidX', senderName: 'Sam',
                          sentAt: '2026-08-01T00:00:00.000Z' });
    window.__t.seedMirror('uidX', 'gM', { type: 'xp_boost', senderUid: 'uidX', senderName: 'Sam' });
    await window.__t.runInbox();
    await window.completeActivity(0, 0, 1);
    await new Promise(r => setTimeout(r, 700));
    let mirror = window.__store.get('users/uidX/giftsSent/gM');
    ok('the mirror still reads pending until the reveal is dismissed',
        mirror.status === 'pending', mirror.status);
    document.getElementById('giftThankBtn').click();
    await new Promise(r => setTimeout(r, 400));
    mirror = window.__store.get('users/uidX/giftsSent/gM');
    ok('dismissing settles the mirror in one write',
        mirror.status === 'consumed' && mirror.thanked === true, mirror);
    ok('the mirror carries the receiver\'s denormalized name',
        mirror.receiverName === 'Mira', mirror.receiverName);
    ok('the mirror never receives the activity or XP detail',
        mirror.awardedXP === null && mirror.consumedActivityId === null, mirror);

    // ── §6: a session that dies before the reveal is dismissed ────────────
    boot(0);
    window.__t.seedGift({ id: 'gO', type: 'xp_boost', senderUid: 'uidX', senderName: 'Sam',
                          sentAt: '2026-08-01T00:00:00.000Z' });
    window.__t.seedMirror('uidX', 'gO', { type: 'xp_boost', senderUid: 'uidX', senderName: 'Sam' });
    await window.__t.runInbox();
    window.__fail.add('users/uidX/giftsSent');
    await window.completeActivity(0, 0, 1);
    await new Promise(r => setTimeout(r, 700));
    const rv = document.getElementById('giftRevealOverlay');
    if (rv) rv.querySelector('#giftRevealClose').click();
    await new Promise(r => setTimeout(r, 400));
    ok('an unreachable mirror leaves the gift unsynced',
        window.__store.get('users/' + ME + '/gifts/gO').mirrorSynced !== true);
    window.__fail.clear();
    await window.__t.catchUpMirrors();
    ok('the next login catches the mirror up',
        window.__store.get('users/uidX/giftsSent/gO').status === 'consumed');
    ok('and marks it synced so it is not retried forever',
        window.__store.get('users/' + ME + '/gifts/gO').mirrorSynced === true);

    // ── §8.3: payout arithmetic, including the spec's worked examples ─────
    const pay = (pos, size) => window.__t.payFor(pos, size);
    ok('a five-person board pays 15 / 10 / nothing',
        pay(1, 5) === 15 && pay(2, 5) === 10 && pay(3, 5) === 0,
        [pay(1, 5), pay(2, 5), pay(3, 5)]);
    ok('a fourteen-scored board pays 42 / 28 / 14',
        pay(1, 14) === 42 && pay(2, 14) === 28 && pay(3, 14) === 14,
        [pay(1, 14), pay(2, 14), pay(3, 14)]);
    ok('a board of two pays nothing at all',
        pay(1, 2) === 0 && pay(2, 2) === 0, [pay(1, 2), pay(2, 2)]);
    ok('third pays nothing below a scoredSize of eight',
        pay(3, 7) === 0 && pay(3, 8) === 8, [pay(3, 7), pay(3, 8)]);
    ok('fourth place never pays', pay(4, 20) === 0);

    const tie = window.lbRank([
        { uid: 'a', xp: 100 }, { uid: 'b', xp: 100 }, { uid: 'c', xp: 50 },
        { uid: 'd', xp: 20 }, { uid: 'e', xp: 10 }
    ], 5);
    ok('a tie splits the combined payout, rounded down',
        tie[0].place === 1 && tie[1].place === 1 &&
        tie[0].grit === Math.floor((15 + 10) / 2) && tie[1].grit === tie[0].grit,
        tie.map(r => [r.uid, r.place, r.grit]));
    ok('the position after a two-way tie for first is third',
        tie[2].place === 3 && tie[2].grit === 0, [tie[2].place, tie[2].grit]);

    // ── §8.1: the two anti-farming rules ──────────────────────────────────
    boot(0);
    const settle = await window.__t.settleWith([
        { uid: 'mutualActive',   mutual: true,  active: true,  xp: 40 },
        { uid: 'mutualDormant',  mutual: true,  active: false, xp: 0  },
        { uid: 'oneSidedActive', mutual: false, active: true,  xp: 900 },
        { uid: 'notOptedIn',     mutual: true,  active: true,  xp: 900, optIn: false }
    ], 120);
    ok('dormant friends do not inflate scoredSize', settle.scoredSize === 2, settle);
    ok('a one-sided board entry pays nothing and does not count',
        !settle.rows.some(r => r.uid === 'oneSidedActive'), settle.rows.map(r => r.uid));
    ok('someone who has not opted in is outside the payout system',
        !settle.rows.some(r => r.uid === 'notOptedIn'));
    ok('a scoredSize below three pays nothing', settle.grit === 0, settle.grit);

    const settle2 = await window.__t.settleWith([
        { uid: 'f1', mutual: true, active: true, xp: 40 },
        { uid: 'f2', mutual: true, active: true, xp: 30 },
        { uid: 'f3', mutual: true, active: true, xp: 20 }
    ], 120);
    ok('a four-strong scored board pays first place 12',
        settle2.scoredSize === 4 && settle2.place === 1 && settle2.grit === 12, settle2);
    ok('the payout is marked awarded for that week',
        window.__t.awarded('leaderboard:' + settle2.anchor) === true);
    const before = window.userData.grit.balance;
    await window.__t.settleAgain();
    ok('a second settlement pass pays nothing more',
        window.userData.grit.balance === before, window.userData.grit.balance);

    // ── §8.7: opting in mid-week takes effect the following Monday ────────
    boot(0);
    await window.lbToggleOptIn();
    const st = window.userData.leaderboard;
    ok('opting in is not effective this week',
        st.optIn === true && st.optInFrom === window.__t.nextAnchor(), st);
    ok('opting in publishes a board document',
        window.__store.has('leaderboardBoards/' + ME));
    await window.lbToggleOptIn();
    ok('opting out withdraws the board',
        window.userData.leaderboard.optIn === false &&
        !window.__store.has('leaderboardBoards/' + ME));

    // ── §1: the tab split ─────────────────────────────────────────────────
    ok('the Friends page exists', !!document.getElementById('peopleTab'));
    ok('the invite box lives on the Friends page',
        document.getElementById('peopleTab').contains(document.getElementById('friendsAddSection')));
    ok('the friends list lives on the Friends page',
        document.getElementById('peopleTab').contains(document.getElementById('friendsAllList')));
    ok('the leaderboard stays on the Leaderboards page',
        document.getElementById('friendsTab').contains(document.getElementById('friendsLeaderboard')));
    ok('requests moved to the Friends page',
        document.getElementById('peopleTab').contains(document.getElementById('friendsRequests')));

    // ── Every tab is open at every level ──────────────────────────────────
    //
    // Analytics, Challenges and Friends used to sit behind level 3, 5 and 7:
    // switchTab() refused, the nav button was greyed with a padlock, and an
    // unlock popup plus a spotlight tour fired on the session after you crossed
    // the line. All of it is gone. The rest of this suite boots at level 12,
    // well past every old threshold, so it would not have noticed either way —
    // hence a fresh level-1 account here.
    boot(1000);
    window.userData.level = 1;

    // Read the nav rather than hard-coding a list, so a tab added later is
    // covered here without anyone remembering to add it.
    const TABS = Array.from(document.querySelectorAll('.nav-tab'))
        .map(function (el) {
            const m = (el.getAttribute('onclick') || '').match(/switchTab\('(\w+)'\)/);
            return m ? m[1] : null;
        })
        .filter(function (n, i, all) { return n && all.indexOf(n) === i; });
    ok('the nav has every tab in it', TABS.length >= 6, TABS);
    TABS.forEach(function (name) {
        const host = document.getElementById(name + 'Tab');
        window.switchTab(name);
        ok('a level-1 account can open the ' + name + ' tab',
            window.currentTab === name && !!host && host.classList.contains('active'));
    });

    ok('no nav button is painted as locked',
        document.querySelectorAll('.nav-tab-locked').length === 0);
    ok('the tour and unlock overlays are gone from the DOM',
        !document.getElementById('spotlightOverlay') &&
        !document.getElementById('unlockPopupOverlay'));
    ok('nothing is left exposing a gating check',
        typeof window.isTabUnlocked === 'undefined' &&
        typeof window.tabUnlockMeta === 'undefined' &&
        typeof window.applyTabLockStyling === 'undefined' &&
        typeof window.checkPendingTabUnlocks === 'undefined' &&
        typeof window.runOnboardingTour === 'undefined' &&
        typeof window.showTabUnlockPopup === 'undefined' &&
        typeof window.acknowledgeTabUnlock === 'undefined');

    return log;
});

await browser.close();
server.close();

out.forEach(l => console.log(l));
errs.forEach(e => console.log(e));
const failed = out.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${out.length - failed} passed, ${failed} failed` + (errs.length ? `, ${errs.length} page errors` : ''));
process.exit(failed || errs.length ? 1 : 0);
