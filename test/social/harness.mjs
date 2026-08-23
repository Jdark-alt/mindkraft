// Builds a throwaway copy of the app whose Firebase CDN imports are remapped
// to the local stubs, serves it, and hands back a Chromium page with app.js
// fully evaluated. The repo's own index.html and app.js are never modified.
//
// build() takes an optional second block of hooks, appended after the shared
// ones. Suites that need to reach different module-private state (the modes
// suite reaches the streak passes and the mode rate card) pass their own
// rather than growing one shared hook object that every suite carries.
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');


const HOOKS = `
        // ── Test hooks (harness only) ─────────────────────────────────────
        window.__t = {
            costs: async function () {
                return { shield: GRIT_SHIELD_COST, giftShield: GRIT_GIFT_SHIELD_COST,
                         boost: GRIT_BOOST_COST, giftBoost: GRIT_GIFT_BOOST_COST };
            },
            ledger: function () {
                var out = _gritLedgerBuffer.map(function (b) { return b.data; });
                var prefix = 'users/' + window.currentUser.uid + '/gritLedger/';
                for (var pair of window.__store) {
                    if (String(pair[0]).indexOf(prefix) === 0) out.push(pair[1]);
                }
                return out;
            },
            inflight: function () { return _giftInflight; },
            queue: function () { return _giftQueue; },
            selfBoostsLeft: function () { return gritBoostsLeftThisMonth(); },
            predict: function (a) { return predictCompletionXP(a); },
            payFor: function (pos, size) { return lbPayForPosition(pos, size); },
            nextAnchor: function () { return lbNextAnchorStr(); },
            awarded: function (marker) { return gritState().awarded[marker] === true; },
            seedGift: function (o) {
                var me = window.currentUser.uid;
                var id = o.id || ('seed-' + Math.random().toString(36).slice(2, 8));
                window.__store.set('users/' + me + '/gifts/' + id, Object.assign({
                    id: id, type: 'xp_boost', senderUid: 'uidX', senderName: 'Sam',
                    receiverUid: me, receiverName: 'Mira',
                    sentAt: new Date().toISOString(), status: 'pending',
                    consumedAt: null, consumedActivityId: null, consumedActivityTitle: null,
                    baseXP: null, awardedXP: null, thanked: false, thankedAt: null
                }, o, { id: id }));
                return id;
            },
            runInbox: function () { return giftRunInbox(); },
            catchUpMirrors: function () { return giftSyncOrphanedMirrors(); },
            seedMirror: function (senderUid, id, o) {
                window.__store.set('users/' + senderUid + '/giftsSent/' + id, Object.assign({
                    id: id, type: 'xp_boost', senderUid: senderUid, senderName: 'Sam',
                    receiverUid: window.currentUser.uid, receiverName: 'Mira',
                    sentAt: new Date().toISOString(), status: 'pending',
                    consumedAt: null, consumedActivityId: null, consumedActivityTitle: null,
                    baseXP: null, awardedXP: null, thanked: false, thankedAt: null
                }, o, { id: id }));
            },
            settleWith: async function (specs, myXP) {
                var me = window.currentUser.uid;
                var closed = lbClosedAnchorStr();
                var eligibleFrom = lbShiftAnchor(closed, -7);
                var a = window.userData.dimensions[0].paths[0].activities[0];
                a.completionHistory.push({
                    date: new Date(closed + 'T12:00:00').toISOString(), xp: myXP
                });
                var st = lbState();
                st.optIn = true;
                st.optInFrom = eligibleFrom;
                st.pub = {
                    scored: specs.map(function (x) { return x.uid; }), scoredFrom: closed,
                    prevScored: [], prevScoredFrom: null, week: null, prev: null
                };
                specs.forEach(function (x) {
                    window.__store.set('leaderboardBoards/' + x.uid, {
                        uid: x.uid, optIn: x.optIn !== false, optInFrom: eligibleFrom,
                        members: x.mutual ? [me] : [], scored: x.mutual ? [me] : [],
                        scoredFrom: closed, prevScored: [], prevScoredFrom: null,
                        week: { anchor: closed, xp: x.xp, completions: x.active ? 3 : 0 },
                        prev: null, displayName: x.uid, photoURL: null, level: 5,
                        updatedAt: new Date().toISOString()
                    });
                });
                delete gritState().awarded['leaderboard:' + closed];
                await lbSettleClosedWeek();
                return Object.assign({ anchor: closed }, st.lastWeek);
            },
            settleAgain: function () { return lbSettleClosedWeek(); }
        };
`;

const IMPORT_MAP = `<script type="importmap">{"imports":{
  "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js":"./stub-firestore.js",
  "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js":"./stub-auth.js",
  "https://www.gstatic.com/firebasejs/10.8.0/firebase-firestore.js":"./stub-firestore.js",
  "https://www.gstatic.com/firebasejs/10.8.0/firebase-analytics.js":"./stub-firestore.js",
  "https://www.gstatic.com/firebasejs/10.8.0/firebase-functions.js":"./stub-firestore.js"
}}</script>`;

export function build(extraHooks) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mk-social-'));
    let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    html = html.replace('<head>', '<head>\n' + IMPORT_MAP);
    fs.writeFileSync(path.join(dir, 'index.html'), html);
    fs.copyFileSync(path.join(root, 'style.css'), path.join(dir, 'style.css'));
    // The hooks are appended to the COPY of app.js, never to the repo's. They
    // sit inside the same module scope, so they can reach the module-private
    // state the invariants are actually about — the silent gift queue, the
    // ledger buffer, the retry-stable id map — without any of it being
    // exported into the shipped app.
    fs.writeFileSync(path.join(dir, 'app.js'),
        fs.readFileSync(path.join(root, 'app.js'), 'utf8') + '\n' + HOOKS +
        (extraHooks ? '\n' + extraHooks : ''));
    for (const f of ['stub-firestore.js', 'stub-auth.js']) {
        fs.copyFileSync(path.join(here, f), path.join(dir, f));
    }
    return dir;
}

export function serve(dir, port) {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    const server = http.createServer((req, res) => {
        const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '') || 'index.html';
        const file = path.join(dir, name);
        if (!file.startsWith(dir) || !fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'text/plain' });
        res.end(fs.readFileSync(file));
    });
    return new Promise(r => server.listen(port, '127.0.0.1', () => r(server)));
}
