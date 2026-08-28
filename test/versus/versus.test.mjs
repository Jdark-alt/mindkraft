// ══════════════════════════════════════════════════════════════════════════
// Versus challenges — the flow, end to end, against the real app.js in
// headless Chromium with a stubbed Firestore.
//
//     node test/versus/versus.test.mjs
//
// Two passes over one page. The first is the sender: the opponent picker,
// the searchable activity picker that replaced the native <select>, the
// stakes panel, and what actually lands in the challenge document —
// requirement names backfilled from the activity, and the advanced-settings
// seed the receiver needs. Then the live board: the hero bar, the
// subordinate opponent bar, and the breakdown's per-activity sub-bars for
// both sides.
//
// The second pass is the receiver: the one-sentence ask, the two buttons,
// and the settings actually crossing into the activity modal when they
// choose "Add to my activities".
//
// Also asserts the removals — no sub-tab row, no solo challenge surface,
// no group challenge surface — since a leftover host element is the way a
// half-finished deletion hides.
// ══════════════════════════════════════════════════════════════════════════
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { build, serve } from '../social/harness.mjs';

const PORT = 8792;
const dir = build(`
        window.__vs = {
            refetch: function () { return vsFetch(true); },
            paint:   function () { return vsPaint(); },
            load:    function (uid) { return loadUserData(uid); },
            save:    function ()    { return saveUserData(); },
            schemaVersion: function () { return USER_SCHEMA_VERSION; }
        };
`);
const server = await serve(dir, PORT);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 400, height: 900 } });
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
page.on('console', m => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (/Failed to load resource|bad HTTP response code/.test(t)) return;  // sw.js, not served here
  errs.push('CONSOLE: ' + t);
});
page.on('dialog', d => d.accept());
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(1000);

const out = await page.evaluate(async () => {
  const log = [];
  const ok = (n, c, x) => log.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 220) : ''));
  const ME = 'uidMe', PAL = 'uidPal';
  try {
  const act = (id, n, extra) => Object.assign({
    id, name: n, baseXP: 10, frequency: 'daily', completionHistory: [],
    completionCount: 0, streak: 0, bestStreak: 0, totalXP: 0
  }, extra || {});

  window.__store.clear(); window.__fail.clear(); window.__writes.length = 0;
  window.currentUser = { uid: ME, displayName: 'Mira', photoURL: null };
  window._dataOwnerUid = ME; window._dataLoadFailed = false;
  window.userData = {
    level: 12, currentXP: 0, totalXP: 0, friends: [PAL], onboardingComplete: true,
    friendCode: 'MK-AAAA', profile: { username: 'Mira' },
    leaderboardHidden: [], rewards: {}, settings: {},
    grit: { schemaVersion: 1, balance: 500, lifetimeEarned: 500, lifetimeSpent: 0,
            shieldPool: 0, week: null, awarded: {}, boostPurchases: [],
            cadence: {}, pendingBoost: null },
    dimensions: [{ id: 'd1', name: 'Body', dimTotalXP: 0, paths: [{ id: 'p1', name: 'Fit',
      activities: [ act('a1', 'Morning Run'),
                    act('a2', 'No Junk Food', { isSkipNegative: true, negativeXpMode: 'skip',
                                                allowMultiplePerDay: false }),
                    act('a3', 'Read') ] }] }]
  };
  window.__store.set('users/' + ME, JSON.parse(JSON.stringify(window.userData)));
  window.__store.set('publicProfiles/' + PAL, { displayName: 'Priya', level: 9, characterTitle: 'Seeker' });

  const $ = s => document.querySelector(s);
  const txt = s => { const e = $(s); return e ? e.textContent.trim() : null; };

  // ── The tab itself ───────────────────────────────────────────────
  ok('the Challenges tab has no sub-tab row left', !document.getElementById('challengesSubTabs'));
  ok('versusContent is the whole tab', !!document.getElementById('versusContent'));
  ok('the solo challenge container is gone', !document.getElementById('challengesContainer'));
  ok('the group challenge container is gone', !document.getElementById('groupChallengeContent'));
  ok('the solo challenge modal is gone', !document.getElementById('challengeModal'));

  switchTab('challenges');
  await new Promise(r => setTimeout(r, 400));
  ok('the empty state renders', !!$('.vs-empty'), txt('.vs-empty-text'));

  // ── Create flow ──────────────────────────────────────────────────
  await window.vsOpenCreate();
  await new Promise(r => setTimeout(r, 300));
  ok('the opponent picker uses the friend-row idiom', !!$('.vs-opprow'));
  ok('the opponent shows an avatar', !!$('.vs-opprow .vs-avatar'));
  ok('the opponent shows name and meta', txt('.vs-opprow-name') === 'Priya', txt('.vs-opprow-meta'));

  window.vsPickOpponent(0);
  await new Promise(r => setTimeout(r, 150));
  ok('the terms sheet opens', !!$('#vsName'));
  ok('there is no native activity select', !$('#vsRowAct0') && !$('.vs-req select'));
  ok('there is no per-requirement name field', !$('#vsRowName0'));
  ok('the activity trigger is a button', !!$('.vs-actbtn'));
  ok('the stakes panel replaced the summary block', $$('.vs-stake-cell').length === 3);
  ok('the stake reads in gold', !!$('.vs-tone-gold'), txt('.vs-tone-gold .vs-stake-val'));
  ok('the XP payout reads in green', !!$('.vs-tone-xp'), txt('.vs-tone-xp .vs-stake-val'));

  // Open the searchable picker and filter it.
  window.vsOpenPicker(0);
  await new Promise(r => setTimeout(r, 120));
  ok('the picker opens with a search field', !!$('#vsActSearch'));
  const allRows = $$('#vsActList .vs-pickrow').length;
  window.vsFilterActs('junk');
  await new Promise(r => setTimeout(r, 60));
  const filtered = $$('#vsActList .vs-pickrow');
  ok('filtering narrows the list', allRows === 3 && filtered.length === 1,
     { allRows, filtered: filtered.length, name: filtered[0] && filtered[0].textContent.trim() });

  window.vsPickAct(0, 'a1');
  await new Promise(r => setTimeout(r, 120));
  ok('picking closes the picker and shows the choice', !$('#vsActSearch') &&
     $('.vs-actbtn').classList.contains('has-value'), txt('.vs-actbtn-label'));

  window.vsAddRow();
  await new Promise(r => setTimeout(r, 120));
  ok('a second requirement row is added', $$('.vs-req').length === 2);
  window.vsPickAct(1, 'a2');
  await new Promise(r => setTimeout(r, 120));

  // The stakes panel is a flex item of .ay-modal-body with overflow:hidden,
  // which zeroes its automatic minimum size — it collapsed to its 2px of
  // border once the form grew past one requirement, while the cells inside
  // still measured full height. Measure the container, not the cells.
  document.getElementById('appContainer').style.display = 'block';
  await new Promise(r => setTimeout(r, 100));
  const panelH = $('.vs-stakes').getBoundingClientRect().height;
  const cellH  = $('.vs-stake-cell').getBoundingClientRect().height;
  ok('the stakes panel does not collapse as the form grows',
     panelH >= cellH && panelH > 40, { panelH: Math.round(panelH), cellH: Math.round(cellH) });

  document.getElementById('vsName').value = 'Two weeks of mornings';
  document.getElementById('vsRowTarget0').value = '20';
  document.getElementById('vsRowTarget1').value = '10';
  await window.vsSubmitCreate();
  await new Promise(r => setTimeout(r, 500));

  const chDocs = [...window.__store].filter(p => String(p[0]).startsWith('versusChallenges/'));
  ok('the challenge document was written to the versusChallenges collection', chDocs.length === 1);
  ok('nothing was written to the retired challenges collection',
     ![...window.__store].some(p => /^challenges\//.test(String(p[0]))));
  const ch = chDocs[0] && chDocs[0][1];
  const reqs = (ch && ch.requirements) || [];
  ok('a requirement carries no name field of its own',
     reqs.every(r => !('name' in r)), reqs.map(r => Object.keys(r)));
  ok("its label reads off the creator's frozen mapping",
     reqs.map(r => ch.mapping[ME][r.reqId].activityName).join('|') === 'Morning Run|No Junk Food',
     reqs.map(r => ch.mapping[ME][r.reqId].activityName));
  ok('the negative-XP settings crossed into the seed',
     !!(reqs[1] && reqs[1].seed && reqs[1].seed.isSkipNegative === true &&
        reqs[1].seed.negativeXpMode === 'skip'), reqs[1] && reqs[1].seed);
  ok('the stake was escrowed', ch && ch.pot === 25 && ch.stake === 25, { pot: ch && ch.pot });
  ok('the balance was debited', gritBalance() === 475, gritBalance());

  // ── The live board ───────────────────────────────────────────────
  const id = chDocs[0][0].split('/')[1];
  const live = window.__store.get('versusChallenges/' + id);
  live.status = 'active';
  live.startedAt = Date.now() - 1000;
  live.endsAt = Date.now() + 6 * 86400000;
  live.pot = 50;
  live.mapping[PAL] = { [reqs[0].reqId]: { activityId: 'x1', activityName: 'Jog' },
                        [reqs[1].reqId]: { activityId: 'x2', activityName: 'Clean eating' } };
  live.progress[ME] = { [reqs[0].reqId]: 9, [reqs[1].reqId]: 3 };
  live.progress[PAL] = { [reqs[0].reqId]: 5, [reqs[1].reqId]: 2 };
  window.__store.set('versusChallenges/' + id, live);
  await window.__vs.refetch();
  window.__vs.paint();
  await new Promise(r => setTimeout(r, 200));

  ok('the board renders', !!$('.vs-board[data-state="active"]'));
  ok('the hero shows the capped total', txt('.vs-count-cur') === '12' && txt('.vs-count-tgt') === '30',
     txt('.vs-count'));
  ok('the hero shows a percentage', txt('.vs-hero-pct') === '40%', txt('.vs-hero-pct'));
  ok('the pot reads in gold', txt('.vs-gold') === '50 Grit pot', txt('.vs-gold'));
  const oppW  = $('.vs-opp').getBoundingClientRect().width;
  const heroW = $('.vs-hero').getBoundingClientRect().width;
  ok('the opponent bar is subordinate in width', oppW > 0 && oppW < heroW * 0.8,
     { oppW: Math.round(oppW), heroW: Math.round(heroW), ratio: +(oppW / heroW).toFixed(2) });
  ok('the opponent bar shows their score', txt('.vs-opp-count') === '7/30', txt('.vs-opp-count'));
  ok('the lead reads correctly', txt('.vs-lead') === 'you lead', txt('.vs-lead'));
  ok('the breakdown is collapsed by default', !$('.vs-breakdown'));

  window.vsToggleDetail(id);
  await new Promise(r => setTimeout(r, 200));
  ok('expanding shows both players', $$('.vs-bd-group').length === 2,
     $$('.vs-bd-head').map(e => e.textContent));
  const subs = $$('.vs-sub');
  ok('there is one sub-bar per activity per side', subs.length === 4,
     subs.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok('your sub-bars name your own activities',
     subs[0].textContent.includes('Morning Run'), subs[0].textContent.trim());
  ok("the opponent's sub-bars name theirs and are quiet",
     subs[2].textContent.includes('Jog') && subs[2].classList.contains('vs-sub-quiet'));
  ok("the opponent's own total bar sits above their sub-bars", !!$('.vs-bd-total'));

  // Hand the receiver pass the id of the challenge just created.
  window.__chId = id;

  } catch (e) { log.push('THREW: ' + (e && e.stack || e)); }
  return log;

  function $$(s) { return Array.from(document.querySelectorAll(s)); }
});

// ══════════════════════════════════════════════════════════════════════════
// The receiver's side. Same page, re-booted as the opponent, against the
// challenge document the sender pass just wrote.
// ══════════════════════════════════════════════════════════════════════════
const out2 = await page.evaluate(async () => {
  const log = [];
  const ok = (n, c, x) => log.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 220) : ''));
  const $ = s => document.querySelector(s);
  const txt = s => { const e = $(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; };
  const ME = 'uidPal', SENDER = 'uidMe';
  const id = window.__chId;

  try {
  const act = (i, n) => ({ id: i, name: n, baseXP: 10, frequency: 'daily',
    completionHistory: [], completionCount: 0, streak: 0, bestStreak: 0, totalXP: 0 });

  window.currentUser = { uid: ME, displayName: 'Priya', photoURL: null };
  window._dataOwnerUid = ME;
  window.userData = {
    level: 12, currentXP: 0, totalXP: 0, friends: [SENDER], onboardingComplete: true,
    profile: { username: 'Priya' }, leaderboardHidden: [], rewards: {}, settings: {},
    grit: { schemaVersion: 1, balance: 300, lifetimeEarned: 300, lifetimeSpent: 0,
            shieldPool: 0, week: null, awarded: {}, boostPurchases: [],
            cadence: {}, pendingBoost: null },
    dimensions: [{ id: 'd1', name: 'Body', dimTotalXP: 0, paths: [{ id: 'p1', name: 'Fit',
      activities: [act('b1', 'Evening Jog'), act('b2', 'Salad Days')] }] }]
  };
  window.__store.set('users/' + ME, JSON.parse(JSON.stringify(window.userData)));

  // The sender pass drove that document to `active` to paint the board.
  // Wind it back to the invite the receiver would actually be answering.
  const inv = window.__store.get('versusChallenges/' + id);
  Object.assign(inv, { status: 'pending', pot: inv.stake, startedAt: null, endsAt: null });
  inv.progress[SENDER] = {}; inv.progress[ME] = {}; inv.mapping[ME] = {};
  window.__store.set('versusChallenges/' + id, inv);
  await window.__vs.refetch();

  await window.vsOpenAccept(id);
  await new Promise(r => setTimeout(r, 200));

  // §6 — one sentence, two buttons, nothing else.
  ok('the ask is a single sentence naming sender, activity and target',
     /Mira challenged you to perform Morning Run 20 times in 2 weeks\./.test(txt('.vs-ask')),
     txt('.vs-ask'));
  const choices = Array.from(document.querySelectorAll('.vs-choice'));
  ok('there are exactly two choices', choices.length === 2,
     choices.map(c => c.textContent.trim()));
  ok('the create path is the primary one', choices[0].classList.contains('vs-choice-primary') &&
     choices[0].textContent.trim() === 'Add to my activities');
  ok('the other maps an activity they already have',
     choices[1].textContent.trim() === 'Use one of my activities');
  ok('the step dots still track progress', document.querySelectorAll('.vs-stepdot').length === 2);
  ok('no requirement-name copy survives on this screen',
     !$('.modal-body').textContent.includes('maps their own activity'));

  // "Add to my activities" hands off to the real activity modal, seeded.
  window.vsCreateActivityFor();
  await new Promise(r => setTimeout(r, 250));
  ok('the real activity modal opened', document.getElementById('activityModal')
     .classList.contains('active'));
  ok('it is seeded with the activity name',
     document.getElementById('activityName').value === 'Morning Run',
     document.getElementById('activityName').value);
  ok('it is seeded with the base XP', document.getElementById('activityXP').value === '10');
  window.closeActivityModal();
  await new Promise(r => setTimeout(r, 200));
  ok('backing out returns to the walkthrough rather than stranding you', !!$('.vs-ask'));

  // Requirement 2 is the skip-negative habit — its settings must cross.
  window.vsAcceptGoto(1);
  await new Promise(r => setTimeout(r, 150));
  ok('the second ask names the second activity',
     /No Junk Food 10 times/.test(txt('.vs-ask')), txt('.vs-ask'));
  window.vsCreateActivityFor();
  await new Promise(r => setTimeout(r, 250));
  ok("the sender's negative-XP setting crossed",
     document.getElementById('activityNegativeEnabled').checked === true);
  ok('and so did its mode',
     document.querySelector('input[name="negativeXpMode"]:checked').value === 'skip',
     document.querySelector('input[name="negativeXpMode"]:checked').value);
  ok('the advanced section was opened so it is not a surprise',
     document.getElementById('negativeXpSection').style.display === 'flex');
  window.closeActivityModal();
  await new Promise(r => setTimeout(r, 200));

  // The other path: map activities they already own, and review.
  window.vsAcceptGoto(0);
  await new Promise(r => setTimeout(r, 150));
  window.vsOpenPick();
  await new Promise(r => setTimeout(r, 150));
  ok('the swap path lists their own activities',
     document.querySelectorAll('.vs-pickrow').length === 2,
     Array.from(document.querySelectorAll('.vs-pickrow-name')).map(e => e.textContent));
  window.vsMapExisting('b1');
  await new Promise(r => setTimeout(r, 200));
  ok('mapping advances to the next requirement', /No Junk Food/.test(txt('.vs-ask')));
  window.vsMapExisting('b2');
  await new Promise(r => setTimeout(r, 250));

  // §7 — the receiver's stakes screen.
  ok('the review screen shows the stakes panel',
     document.querySelectorAll('.vs-stake-cell').length === 3);
  ok('their stake reads in gold', txt('.vs-tone-gold .vs-stake-val') === '25 Grit',
     txt('.vs-tone-gold .vs-stake-val'));
  ok('their balance is not flagged short', !$('.vs-tone-short'));
  ok('the review lists requirement against mapped activity',
     txt('.vs-review') === 'Morning Run ×20Evening JogchangeNo Junk Food ×10Salad Dayschange',
     txt('.vs-review'));
  ok('accept is enabled once everything is mapped',
     !document.getElementById('vsAcceptBtn').disabled);

  await window.vsSubmitAccept();
  await new Promise(r => setTimeout(r, 400));
  const ch = window.__store.get('versusChallenges/' + id);
  ok('accepting made the challenge active', ch.status === 'active', ch.status);
  ok('the pot is both stakes', ch.pot === 50, ch.pot);
  ok("the receiver's mapping was written", Object.keys(ch.mapping[ME]).length === 2);
  ok("the receiver's balance was debited", gritBalance() === 275, gritBalance());

  } catch (e) { log.push('THREW: ' + (e && e.stack || e)); }
  return log;
});

// ══════════════════════════════════════════════════════════════════════════
// The retirement purge. A document written before the Challenges overhaul
// still carries the retired fields; loading it must strip them and write the
// clean version back, and a Restore Backup must not walk them in again.
// ══════════════════════════════════════════════════════════════════════════
const out3 = await page.evaluate(async () => {
  const log = [];
  const ok = (n, c, x) => log.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x).slice(0, 220) : ''));
  const OLD = 'uidLegacy';

  try {
  // Exactly the shape a pre-overhaul account had.
  const legacy = {
    level: 9, currentXP: 0, totalXP: 0, dimensions: [], friends: [], rewards: {}, settings: {},
    challenges: [{ id: 'c-old', name: 'Old solo challenge', status: 'active' }],
    activeGroupChallengeId: 'grp-old',
    vsDraftMappings: { 'vs-dead': { r1: { activityId: 'gone', activityName: 'Gone' } } },
    vsSeenResults: { 'vs-dead': true },
    autoBackup: {
      savedAt: new Date().toISOString(), savedDate: '2026-08-01',
      data: {
        level: 9, dimensions: [],
        challenges: [{ id: 'c-old', name: 'Old solo challenge', status: 'active' }],
        activeGroupChallengeId: 'grp-old',
        vsDraftMappings: { 'vs-dead': {} }, vsSeenResults: { 'vs-dead': true }
      }
    }
  };
  window.__store.set('users/' + OLD, JSON.parse(JSON.stringify(legacy)));
  window.currentUser = { uid: OLD, displayName: 'Legacy' };
  window.__writes.length = 0;
  await window.__vs.load(OLD);
  await new Promise(r => setTimeout(r, 350));

  const RETIRED = ['challenges', 'activeGroupChallengeId', 'vsDraftMappings', 'vsSeenResults'];
  ok('the retired fields are gone from memory',
     RETIRED.every(f => !(f in window.userData)),
     RETIRED.filter(f => f in window.userData));
  ok('the document is stamped at the current schema version',
     window.userData.schemaVersion === window.__vs.schemaVersion(),
     window.userData.schemaVersion);
  ok('the purge was persisted, not just done in memory',
     RETIRED.every(f => !(f in (window.__store.get('users/' + OLD) || {}))),
     RETIRED.filter(f => f in (window.__store.get('users/' + OLD) || {})));
  ok('the backup snapshot was cleaned too, so a restore cannot resurrect them',
     RETIRED.every(f => !(f in window.userData.autoBackup.data)),
     RETIRED.filter(f => f in window.userData.autoBackup.data));
  ok('data that is not retired is left alone', window.userData.level === 9);

  // A second load must be a no-op — the migration is version-gated, so it
  // cannot keep wiping live versus drafts every time the app starts.
  window.userData.vsDraftMappings = { 'vs-live': { r1: { activityId: 'a1', activityName: 'Run' } } };
  await window.__vs.save();
  await window.__vs.load(OLD);
  await new Promise(r => setTimeout(r, 300));
  ok('a later versus draft survives the next load',
     !!(window.userData.vsDraftMappings && window.userData.vsDraftMappings['vs-live']),
     window.userData.vsDraftMappings);

  } catch (e) { log.push('THREW: ' + (e && e.stack || e)); }
  return log;
});

const all = out.concat(out2, out3);
console.log(all.join('\n'));
if (errs.length) console.log('\n' + errs.join('\n'));
const fails = all.filter(l => l.startsWith('FAIL') || l.startsWith('THREW')).length;
console.log(`\n${all.length - fails} passed, ${fails} failed, ${errs.length} page errors`);
await browser.close(); server.close();
process.exit(fails || errs.length ? 1 : 0);
