// ══════════════════════════════════════════════════════════════════════════
// Modes invariants, asserted against the real app.js in headless Chromium
// with a stubbed Firestore.
//
//     node test/modes/modes.test.mjs
//
// The centre of gravity here is the streak interaction. processStreakSystem()
// is the single authoritative writer for streak and shield state and it
// RE-DERIVES both from completionHistory on every login — so Recovery and
// Insurance can only work as additive passes on either side of that walk,
// never inside it. If that ever stops holding, these are the tests that say
// so, because nothing about it is visible from the UI.
//
// Also covered: the Berserk target's dampener (a personal best must make
// tomorrow a little harder, not proportionally harder), the Focus Window
// multiplier and its exclusions, Stake's all-or-nothing payout, Habit's
// completions-vs-days-elapsed counter and its pause/resume rule, the
// one-mode-at-a-time guard, and the rate card itself.
// ══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { build, serve } from '../social/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const hooks = fs.readFileSync(path.join(here, 'hooks.js'), 'utf8');

const PORT = 8773;
const dir = build(hooks);
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
    const DAY = 86400000;

    function dayStr(offset) {
        const d = new Date(); d.setHours(0, 0, 0, 0);
        d.setDate(d.getDate() + offset);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
               '-' + String(d.getDate()).padStart(2, '0');
    }
    function stamp(offset, hour) {
        const d = new Date(); d.setHours(hour == null ? 12 : hour, 0, 0, 0);
        d.setDate(d.getDate() + offset);
        return d.toISOString();
    }

    function act(id, n, extra) {
        return Object.assign({
            id, name: n, baseXP: 10, frequency: 'daily', completionHistory: [],
            completionCount: 0, streak: 0, bestStreak: 0, totalXP: 0
        }, extra || {});
    }

    function boot(balance, activities) {
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
            modes: null,
            dimensions: [{ id: 'd1', name: 'Body', dimTotalXP: 0, paths: [
                { id: 'p1', name: 'Fit', activities: activities || [act('a1', 'Run')] }
            ] }]
        };
        window._dataOwnerUid = ME;
        window._dataLoadFailed = false;
        window.__store.set('users/' + ME, JSON.parse(JSON.stringify(window.userData)));
        window.__store.set('users/' + FRIEND, { friends: [ME] });
    }

    const A = () => window.userData.dimensions[0].paths[0].activities[0];
    const G = () => window.userData.grit;

    // Six hits, then four straight misses. Three base shields absorb the
    // first three; the fourth is unshielded, so the authoritative walk breaks
    // the streak. This is the exact shape Insurance exists to survive.
    function brokenStreakActivity() {
        const hist = [];
        for (let d = -10; d <= -5; d++) hist.push({ date: stamp(d), xp: 10 });
        return act('a1', 'Run', {
            completionHistory: hist,
            completionCount: hist.length,
            streak: 6, bestStreak: 6,
            lastCompleted: stamp(-5),
            streakStartWindow: dayStr(-10),
            lastProcessedDate: dayStr(-1),
            skipPenaltyWindow: dayStr(-1)
        });
    }

    // ══ THE RATE CARD ═════════════════════════════════════════════════════
    boot(1000);
    const card = await window.__mm.card();
    ok('habit costs 30', card.cost.habit === 30, card.cost);
    ok('berserk costs 40', card.cost.berserk === 40);
    ok('insurance costs 20', card.cost.insurance === 20);
    ok('recovery costs 15', card.cost.recovery === 15);
    ok('focus costs 25', card.cost.focus === 25);
    ok('the stake wager runs 25 to 100 in steps of 25',
        card.wagerMin === 25 && card.wagerMax === 100 && card.wagerStep === 25);
    ok('a won wager returns 30% on top', card.wagerReturn === 0.30);
    ok('a pact stakes 40 a side', card.pactWager === 40);
    ok('berserk swings 30% either way', card.berserkSwing === 0.30);
    ok('focus is well under berserk', card.focusMultiplier < card.berserkSwing / 2,
        [card.focusMultiplier, card.berserkSwing]);
    ok('all seven modes are present', card.kinds.length === 7, card.kinds);

    // ══ ONE MODE AT A TIME ════════════════════════════════════════════════
    boot(1000);
    let r = await window.__mm.activate('focus', {
        windowStart: '18:00', windowEnd: '20:00', targetDays: 14,
        daysElapsed: 0, lastCountedDay: null, bonusXP: 0, bonusCount: 0 }, 25);
    ok('a mode activates and spends its cost', r.ok && G().balance === 975, G().balance);
    r = await window.__mm.activate('recovery', { activities: [] }, 15);
    ok('a second mode is refused while one is running', !r.ok, r.message);
    ok('the refusal names the running mode', /Focus Window/.test(r.message || ''), r.message);
    ok('the refusal costs nothing', G().balance === 975, G().balance);

    // ══ AN ENTRY COST IS NOT REFUNDED ═════════════════════════════════════
    await window.__mm.end('ended');
    ok('ending a mode does not refund its entry cost', G().balance === 975, G().balance);
    ok('the run is archived', window.__mm.state().history.length === 1);

    // ══ INSURANCE ═════════════════════════════════════════════════════════
    // Control: without insurance, the walk breaks the streak.
    boot(1000, [brokenStreakActivity()]);
    await window.__mm.streakPass();
    ok('control — an unshielded miss breaks the streak', A().streak === 0, A().streak);

    // Insured: the same history, the same walk, a different outcome.
    boot(1000, [brokenStreakActivity()]);
    r = await window.__mm.activate('insurance',
        { activities: [{ activityId: 'a1', activityName: 'Run' }], lastCheckInDay: null }, 20);
    ok('insurance activates', r.ok, r.message);
    await window.__mm.streakPass();
    ok('an insured streak survives an unshielded miss', A().streak === 6, A().streak);
    ok('the protection is recorded as an offset, not on the activity',
        window.__mm.offsets().a1 === 6 && A().insuranceOffset === undefined,
        window.__mm.offsets());
    ok('the shields it would have spent are handed back',
        (A().shieldsConsumed || 0) === 0, A().shieldsConsumed);

    // Logging still moves the streak: insurance suspends the downside only.
    A().streak = 7;                       // as completeActivity would leave it
    window.__mm.rearm();
    await window.__mm.streakPass();
    ok('logging still raises an insured streak', A().streak >= 7, A().streak);

    // Turning it off keeps the days already protected — they were genuinely
    // insured — but stops the offset growing.
    const heldBefore = window.__mm.offsets().a1;
    await window.__mm.end('ended');
    ok('the days already protected survive the mode ending',
        window.__mm.offsets().a1 === heldBefore, window.__mm.offsets());
    window.__mm.rearm();
    await window.__mm.streakPass();
    ok('and the streak still stands after it ends', A().streak > 0, A().streak);

    // …but only until the activity is genuinely missed again. Push the grace
    // stamp back far enough that the gap outlasts the shields and the credit
    // has to go: a streak that really broke must not be propped up forever.
    window.userData.modes.offsetFrom.a1 = dayStr(-30);
    window.__mm.rearm();
    await window.__mm.streakPass();
    ok('a gap that outlasts the shields after cover ends drops the credit',
        A().streak === 0 && window.__mm.offsets().a1 === undefined,
        [A().streak, window.__mm.offsets()]);

    // A genuine break with no insurance in force drops the credit.
    boot(1000, [brokenStreakActivity()]);
    window.userData.modes = { schemaVersion: 1, active: null, pending: [], history: [],
                              suspendedHabit: null, streakOffsets: { a1: 6 }, offsetDay: {} };
    await window.__mm.streakPass();
    ok('an uninsured break drops the credit rather than resurrecting it',
        A().streak === 0 && window.__mm.offsets().a1 === undefined,
        [A().streak, window.__mm.offsets()]);

    // ══ RECOVERY ══════════════════════════════════════════════════════════
    boot(1000, [act('a1', 'Run', { streak: 3, bestStreak: 12, lastCompleted: stamp(-1) })]);
    ok('the ceiling is read from history, not stored on the activity',
        window.__mm.ceilingFor('a1') === 12 && A().recoveryCeiling === undefined);
    r = await window.__mm.activate('recovery', {
        activities: [{ activityId: 'a1', activityName: 'Run', ceiling: 12,
                       startStreak: 3, granted: 0, lastBonusDay: null }] }, 15);
    ok('recovery activates', r.ok, r.message);

    A().streak = 4;                       // completeActivity's own +1
    window.__mm.onCompletion('a1');
    ok('a completion under the ceiling earns one bonus step', A().streak === 5, A().streak);
    ok('the bonus is an offset, tracked outside the activity',
        window.__mm.offsets().a1 === 1, window.__mm.offsets());

    // At the ceiling the bonus stops — the mode helps you REACH your peak.
    A().streak = 12;
    window.__mm.active().activities[0].lastBonusDay = null;
    window.userData.modes.active.activities[0].lastBonusDay = null;
    window.__mm.onCompletion('a1');
    ok('no bonus once the ceiling is reached', A().streak === 12, A().streak);

    // Peak + 1 is the hard ceiling: one normal step past the peak, never two.
    boot(1000, [act('a1', 'Run', { streak: 11, bestStreak: 12, lastCompleted: stamp(-1) })]);
    await window.__mm.activate('recovery', {
        activities: [{ activityId: 'a1', activityName: 'Run', ceiling: 12,
                       startStreak: 11, granted: 0, lastBonusDay: null }] }, 15);
    A().streak = 12;                      // the normal increment took it to the peak
    window.__mm.onCompletion('a1');
    ok('recovery never pushes a streak past its old peak', A().streak === 12, A().streak);

    // Undo takes the bonus back with it.
    boot(1000, [act('a1', 'Run', { streak: 3, bestStreak: 12, lastCompleted: stamp(-1) })]);
    await window.__mm.activate('recovery', {
        activities: [{ activityId: 'a1', activityName: 'Run', ceiling: 12,
                       startStreak: 3, granted: 0, lastBonusDay: null }] }, 15);
    A().streak = 4;
    window.__mm.onCompletion('a1');
    const afterBonus = A().streak;
    window.__mm.onUndo('a1');
    ok('undoing a completion takes the recovery bonus back',
        A().streak === afterBonus - 1 && window.__mm.offsets().a1 === undefined,
        [afterBonus, A().streak, window.__mm.offsets()]);

    // ══ BERSERK ═══════════════════════════════════════════════════════════
    // A brand-new account still gets a real target rather than zero.
    boot(1000);
    ok('an empty account gets the floor, not a free win',
        window.__mm.berserkTarget(1) === card.berserkFloor, window.__mm.berserkTarget(1));

    // A steady account: the target IS the trailing average.
    function seedSteady(perDay, days) {
        const hist = [];
        for (let d = -days; d <= -1; d++) hist.push({ date: stamp(d), xp: perDay });
        boot(1000, [act('a1', 'Run', { completionHistory: hist, completionCount: days })]);
    }
    seedSteady(1200, 28);
    const steady = window.__mm.berserkTarget(1);
    ok('a steady account targets its own trailing average', steady === 100, steady);
    ok('the target scales with the window', window.__mm.berserkTarget(3) === steady * 3,
        window.__mm.berserkTarget(3));

    // Now a personal best yesterday. The undamped 7-day average would be
    // ~157/hr; the dampener has to land it well below that while still
    // raising it above the steady figure.
    (function () {
        const hist = [];
        for (let d = -28; d <= -2; d++) hist.push({ date: stamp(d), xp: 1200 });
        hist.push({ date: stamp(-1), xp: 6000 });
        boot(1000, [act('a1', 'Run', { completionHistory: hist, completionCount: 28 })]);
    })();
    const afterPB = window.__mm.berserkTarget(1);
    const undamped = Math.round(((1200 * 6 + 6000) / 7) / 12);
    ok('a personal best raises tomorrow\'s target', afterPB > steady, [steady, afterPB]);
    ok('but only a little — not one-for-one with the spike',
        afterPB < steady + (undamped - steady) / 2, [steady, afterPB, undamped]);

    // Win and loss both move the user's own XP ledger, not a shadow one.
    boot(1000);
    const beforeXP = window.userData.totalXP;
    await window.__mm.activate('berserk', {
        hours: 1, startedAtMs: Date.now() - 1000, endsAt: Date.now() + 3600000,
        targetXP: 100, perHourTarget: 100, resolved: false }, 40);
    A().completionHistory.push({ date: new Date().toISOString(), xp: 200 });
    ok('berserk progress is the XP earned in the window', window.__mm.berserkEarned() === 200,
        window.__mm.berserkEarned());
    await window.__mm.resolveBerserk();
    ok('clearing the target pays 30% of what was earned',
        window.userData.totalXP === beforeXP + 60, [beforeXP, window.userData.totalXP]);
    ok('a cleared berserk ends the mode', window.__mm.active() === null);

    boot(1000);
    await window.__mm.activate('berserk', {
        hours: 1, startedAtMs: Date.now() - 7200000, endsAt: Date.now() - 3600000,
        targetXP: 100, perHourTarget: 100, resolved: false }, 40);
    window.userData.totalXP = 5000; window.userData.currentXP = 5000;
    await window.__mm.resolveBerserk();
    ok('an expired berserk takes 30% of the target when nothing was logged',
        window.userData.totalXP === 5000 - 30, window.userData.totalXP);
    ok('a lost berserk ends the mode', window.__mm.active() === null);
    ok('berserk never touches Grit beyond its entry cost', G().balance === 960, G().balance);

    // ══ FOCUS WINDOW ══════════════════════════════════════════════════════
    boot(1000, [act('a1', 'Run'), act('a2', 'Scroll', { isNegative: true })]);
    await window.__mm.activate('focus', {
        windowStart: '18:00', windowEnd: '20:00', targetDays: 14,
        daysElapsed: 0, lastCountedDay: null, bonusXP: 0, bonusCount: 0 }, 25);
    const inside = new Date(); inside.setHours(19, 0, 0, 0);
    const outside = new Date(); outside.setHours(9, 0, 0, 0);
    ok('a completion inside the window earns the multiplier',
        window.__mm.multiplierFor('a1', inside.getTime()) === card.focusMultiplier,
        window.__mm.multiplierFor('a1', inside.getTime()));
    ok('a completion outside it earns nothing',
        window.__mm.multiplierFor('a1', outside.getTime()) === 0);
    ok('a negative habit is never multiplied',
        window.__mm.multiplierFor('a2', inside.getTime()) === 0);

    // A window that crosses midnight is a window, not two.
    ok('22:00–01:00 contains 23:30', window.__mm.windowTest('22:00', '01:00', '23:30'));
    ok('22:00–01:00 contains 00:30', window.__mm.windowTest('22:00', '01:00', '00:30'));
    ok('22:00–01:00 does not contain 12:00', !window.__mm.windowTest('22:00', '01:00', '12:00'));

    // ══ STAKE ═════════════════════════════════════════════════════════════
    boot(1000, [act('a1', 'Run'), act('a2', 'Read')]);
    r = await window.__mm.activate('stake', {
        items: [{ activityId: 'a1', activityName: 'Run', target: 3, count: 0 },
                { activityId: 'a2', activityName: 'Read', target: 2, count: 0 }],
        days: 5, wager: 50, resolved: false }, 50);
    ok('the wager leaves the balance on activation', r.ok && G().balance === 950, G().balance);
    window.userData.modes.active.items[0].count = 3;
    window.userData.modes.active.items[1].count = 2;
    await window.__mm.resolveStake();
    ok('every target hit returns the wager plus 30%', G().balance === 950 + 65, G().balance);

    boot(1000, [act('a1', 'Run'), act('a2', 'Read')]);
    await window.__mm.activate('stake', {
        items: [{ activityId: 'a1', activityName: 'Run', target: 3, count: 0 },
                { activityId: 'a2', activityName: 'Read', target: 2, count: 0 }],
        days: 5, wager: 50, resolved: false }, 50);
    window.userData.modes.active.startedDay = (function () {
        const d = new Date(); d.setDate(d.getDate() - 9);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
               '-' + String(d.getDate()).padStart(2, '0');
    })();
    window.userData.modes.active.items[0].count = 3;   // one target short
    await window.__mm.resolveStake();
    ok('one target short forfeits the whole wager', G().balance === 950, G().balance);
    ok('a lost stake ends the mode', window.__mm.active() === null);

    // ══ ENDING EARLY ══════════════════════════════════════════════════════
    // Both wagered modes have to actually END when the user ends them. A
    // guard that quietly returns instead leaves the mode running with its
    // stake gone, which is the worst of both outcomes.
    boot(1000, [act('a1', 'Run')]);
    await window.__mm.activate('berserk', {
        hours: 2, startedAtMs: Date.now() - 1000, endsAt: Date.now() + 7200000,
        targetXP: 500, perHourTarget: 250, resolved: false }, 40);
    await window.__mm.resolveBerserk();
    ok('an unfinished berserk window keeps running on its own',
        window.__mm.active() !== null);
    await window.__mm.resolveBerserk(true);
    ok('ending berserk early actually ends it', window.__mm.active() === null);

    boot(1000, [act('a1', 'Run'), act('a2', 'Read')]);
    await window.__mm.activate('stake', {
        items: [{ activityId: 'a1', activityName: 'Run', target: 3, count: 0 },
                { activityId: 'a2', activityName: 'Read', target: 2, count: 0 }],
        days: 10, wager: 50, resolved: false }, 50);
    await window.__mm.resolveStake();
    ok('an unfinished stake keeps running on its own', window.__mm.active() !== null);
    await window.__mm.resolveStake(true);
    ok('ending a stake early actually ends it', window.__mm.active() === null);
    ok('and forfeits the wager', G().balance === 950, G().balance);

    // ══ HABIT ═════════════════════════════════════════════════════════════
    boot(1000, [act('a1', 'Run')]);
    r = await window.__mm.activate('habit', {
        habits: [{ activityId: 'a1', activityName: 'Run', windowStart: '22:00',
                   windowEnd: '23:00', anchor: 'after brushing my teeth',
                   why: 'Because I want to finish things.', completions: 0,
                   lastCompletedDay: null, milestonesShown: [], overlayDismissedDay: null }],
        targetDays: 33, daysElapsed: 0, lastCountedDay: null }, 30);
    ok('habit activates', r.ok, r.message);
    ok('the why text is stored verbatim',
        window.__mm.active().habits[0].why === 'Because I want to finish things.');
    ok('the anchor is stored as plain text with nothing derived from it',
        window.__mm.active().habits[0].anchor === 'after brushing my teeth');

    // Completions and days elapsed are two independent counters, and a habit
    // shows only the pair — there is no streak here to break.
    window.__mm.onCompletion('a1');
    ok('a completion increments the count', window.__mm.active().habits[0].completions === 1);
    window.__mm.onCompletion('a1');
    ok('a second completion the same day does not double-count',
        window.__mm.active().habits[0].completions === 1);
    ok('a habit keeps no streak of its own',
        window.__mm.active().habits[0].streak === undefined);

    // Day count only advances while the mode is on.
    window.userData.modes.active.lastCountedDay = dayStr(-4);
    window.__mm.habitAdvance();
    ok('the day count catches up while the mode is on',
        window.__mm.active().daysElapsed === 4, window.__mm.active().daysElapsed);

    await window.__mm.end('ended');
    ok('turning habit mode off suspends it rather than deleting it',
        !!window.__mm.state().suspendedHabit && window.__mm.active() === null);
    ok('the suspended run keeps its progress',
        window.__mm.state().suspendedHabit.payload.daysElapsed === 4);
    ok('a missed day did not break anything — only the count differs',
        window.__mm.state().suspendedHabit.payload.habits[0].completions === 1);

    window.userData.modes.suspendedHabit.offAt =
        new Date(Date.now() - 9 * 86400000).toISOString();
    await window.__mm.runPass();
    ok('a habit left off for more than a week stops being resumable',
        window.__mm.state().suspendedHabit === null);

    // ══ PACT: THE TWO DOCUMENT SHAPES ═════════════════════════════════════
    //
    // Both sides of a Pact may now name several activities, each with its own
    // target. Pacts written before that finish out under the shape they were
    // agreed under — read tolerance, not migration — so every reader has to
    // give the same answer for both. Nothing about that is visible from the
    // UI, and getting it wrong would silently zero a running pact's progress.
    const OLD_PACT = {
        id: 'pc-old', status: 'active', participants: [ME, FRIEND],
        createdBy: ME, partner: FRIEND, stake: 40, pot: 80,
        names: { [ME]: 'Me', [FRIEND]: 'Pal' },
        endsAt: Date.now() + 20 * DAY,
        terms: { [ME]:     { activityId: 'a1', activityName: 'Run', target: 10 },
                 [FRIEND]: { activityId: 'b1', activityName: 'Swim', target: 10 } },
        progress: { [ME]: 5, [FRIEND]: 1 }
    };
    const NEW_PACT = {
        id: 'pc-new', status: 'active', participants: [ME, FRIEND],
        createdBy: ME, partner: FRIEND, stake: 40, pot: 80,
        names: { [ME]: 'Me', [FRIEND]: 'Pal' },
        endsAt: Date.now() + 20 * DAY,
        terms: { [ME]: { items: [{ activityId: 'a1', activityName: 'Run', target: 5 },
                                 { activityId: 'a2', activityName: 'Read', target: 5 }] },
                 [FRIEND]: { items: [{ activityId: 'b1', activityName: 'Swim', target: 10 }] } },
        progress: { [ME]: { a1: 5 }, [FRIEND]: { b1: 1 } }
    };

    ok('the original shape reads as one activity',
        window.__mm.pactItems(OLD_PACT, ME).length === 1);
    ok('the new shape reads as many',
        window.__mm.pactItems(NEW_PACT, ME).length === 2);
    ok('a bare number counter still reads',
        window.__mm.pactCount(OLD_PACT, ME, 'a1') === 5);
    ok('a per-activity counter reads',
        window.__mm.pactCount(NEW_PACT, ME, 'a1') === 5 &&
        window.__mm.pactCount(NEW_PACT, ME, 'a2') === 0);

    const oldStats = window.__mm.pactStats(OLD_PACT, ME);
    const newStats = window.__mm.pactStats(NEW_PACT, ME);
    ok('both shapes agree on the percentage',
        oldStats.pct === 50 && newStats.pct === 50, [oldStats, newStats]);
    ok('neither side is complete at half', !oldStats.hit && !newStats.hit);

    ok('an over-logged activity cannot carry an under-logged one', (function () {
        const p = JSON.parse(JSON.stringify(NEW_PACT));
        p.progress[ME] = { a1: 500 };
        const st = window.__mm.pactStats(p, ME);
        return st.done === 5 && st.pct === 50 && !st.hit;
    })());

    ok('a side is complete only when every activity is', (function () {
        const p = JSON.parse(JSON.stringify(NEW_PACT));
        p.progress[ME] = { a1: 5, a2: 5 };
        return window.__mm.pactStats(p, ME).hit === true;
    })());

    ok('a partner who has not accepted reads as empty, not as done',
        window.__mm.pactStats({ status: 'active', participants: [ME, FRIEND],
                                terms: {}, progress: {} }, FRIEND).hit === false);

    ok('the term summary names every activity',
        window.__mm.pactSummary(NEW_PACT, ME) === 'Run × 5, Read × 5',
        window.__mm.pactSummary(NEW_PACT, ME));

    // Out of reach is judged per activity, not on the totals — several
    // activities can be logged on the same day, so a combined shortfall is
    // not the same thing as an unreachable one.
    ok('a combined shortfall that is still reachable does not break the pact', (function () {
        const p = JSON.parse(JSON.stringify(NEW_PACT));
        p.endsAt = Date.now() + 5 * DAY;
        p.progress[ME] = { a1: 0, a2: 0 };          // 10 short across two items
        return window.__mm.pactImpossible(p, ME) === false;
    })());
    ok('a single activity that cannot be finished does break it', (function () {
        const p = JSON.parse(JSON.stringify(NEW_PACT));
        p.endsAt = Date.now() + 2 * DAY;
        p.progress[ME] = { a1: 0, a2: 5 };          // 5 short on one, 2 days left
        return window.__mm.pactImpossible(p, ME) === true;
    })());

    ok('resolution reads both shapes the same way', (function () {
        const oldP = JSON.parse(JSON.stringify(OLD_PACT));
        oldP.progress = { [ME]: 10, [FRIEND]: 10 };
        const newP = JSON.parse(JSON.stringify(NEW_PACT));
        newP.progress = { [ME]: { a1: 5, a2: 5 }, [FRIEND]: { b1: 10 } };
        return window.__mm.pactResolution(oldP).outcome === 'kept' &&
               window.__mm.pactResolution(newP).outcome === 'kept';
    })());
    ok('resolution names the side that fell short', (function () {
        const p = JSON.parse(JSON.stringify(NEW_PACT));
        p.progress = { [ME]: { a1: 5, a2: 5 }, [FRIEND]: { b1: 1 } };
        const res = window.__mm.pactResolution(p);
        return res.outcome === 'broken' && res.failedBy === FRIEND;
    })());

    // The local mode object carries the same two shapes, for the same reason.
    ok('the local mode object reads the original shape',
        window.__mm.modePactItems({ kind: 'pact', activityId: 'a1',
                                    activityName: 'Run', target: 10 }).length === 1);
    ok('the local mode object reads the new shape',
        window.__mm.modePactItems({ kind: 'pact', items: [
            { activityId: 'a1', activityName: 'Run', target: 5 },
            { activityId: 'a2', activityName: 'Read', target: 5 }] }).length === 2);
    ok('the completion hook matches any of the mode\'s activities', (function () {
        const a = { kind: 'pact', items: [{ activityId: 'a1', activityName: 'Run', target: 5 },
                                          { activityId: 'a2', activityName: 'Read', target: 5 }] };
        return window.__mm.modePactHas(a, 'a2') && !window.__mm.modePactHas(a, 'zz');
    })());

    // ══ PACT: THE SETUP SHEET ═════════════════════════════════════════════
    //
    // Driven for real rather than asserted on, because the sheet is what turns
    // picks into the document shape everything above reads — and it borrows
    // Stake Mode's multi-select picker, which had never been pointed at a Pact.
    boot(1000, [act('a1', 'Run'), act('a2', 'Read'), act('a3', 'Stretch')]);
    window._friendProfileCache = { [FRIEND]: { displayName: 'Pal', level: 9 } };

    ok('the pact sheet opens', window.__mm.openSetup('pact'));
    const sheet = () => document.getElementById('modeSheet');
    const sheetText = () => sheet().textContent;
    ok('it asks who first', /Who with\?/.test(sheetText()));

    await window.pactPickPartner(FRIEND);
    ok('it asks for activities, plural', /Your activities/.test(sheetText()));
    ok('the multi-select picker is on screen', !!sheet().querySelector('.md-dd-list'));
    ok('the send button starts dead, and says why',
        !!sheet().querySelector('.md-sheet-foot .md-btn-primary[disabled]') &&
        /Pick at least one activity/.test(sheetText()));

    window.modeTogglePick('a1', 3);
    ok('picking one activity adds one target row',
        sheet().querySelectorAll('.md-target-row').length === 1);
    ok('a single completion is under the floor, and the sheet says so',
        !!sheet().querySelector('.md-sheet-foot .md-btn-primary[disabled]') &&
        /3\+ completions in total/.test(sheetText()));
    window.pactBump('a1', 2);
    ok('three completions clears the floor',
        !sheet().querySelector('.md-sheet-foot .md-btn-primary[disabled]'));

    window.modeTogglePick('a2', 3);
    window.modeTogglePick('a3', 3);
    ok('three activities give three target rows',
        sheet().querySelectorAll('.md-target-row').length === 3);
    window.modeTogglePick('a3', 3);
    ok('unpicking one takes its row with it',
        sheet().querySelectorAll('.md-target-row').length === 2);
    window.modeTogglePick('a3', 3);

    window.pactBump('a2', 4);    // 5
    window.pactBump('a3', 9);    // 10
    await window.pactSend();

    const pactDocs = Array.from(window.__store).filter(p => String(p[0]).startsWith('pacts/'));
    ok('sending writes exactly one pact', pactDocs.length === 1, pactDocs.length);
    const sent = pactDocs.length ? pactDocs[0][1] : null;
    ok('the term is a list, not a single activity',
        !!sent && Array.isArray((sent.terms[ME] || {}).items) &&
        sent.terms[ME].items.length === 3, sent && sent.terms[ME]);
    ok('every pick kept its own target', !!sent && JSON.stringify(
        sent.terms[ME].items.map(i => [i.activityName, i.target])
            .sort((x, y) => x[0].localeCompare(y[0]))) ===
        JSON.stringify([['Read', 5], ['Run', 3], ['Stretch', 10]]),
        sent && sent.terms[ME].items.map(i => [i.activityName, i.target]));
    ok('progress starts as a per-activity map, not a number',
        !!sent && typeof sent.progress[ME] === 'object' && sent.progress[ME] !== null,
        sent && sent.progress);
    ok('the totals add up across the whole side',
        !!sent && window.__mm.pactStats(sent, ME).total === 18,
        sent && window.__mm.pactStats(sent, ME));
    ok('the partner is invited with a full summary of it',
        !!sent && window.__mm.pactSummary(sent, ME) === 'Run × 3, Read × 5, Stretch × 10',
        sent && window.__mm.pactSummary(sent, ME));
    window.__mm.closeSetup();

    return log;
});

out.forEach(l => console.log(l));
errs.forEach(e => console.log(e));
const pass = out.filter(l => l.startsWith('PASS')).length;
const fail = out.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${pass} passed, ${fail} failed`);

await browser.close();
server.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail || errs.length ? 1 : 0);
