// ══════════════════════════════════════════════════════════════════════════
// Navigation — the bottom bar, in every style and both themes.
//
//     node test/nav/nav.test.mjs
//
// Two things here are invisible from a screenshot and were both broken, which
// is why they get a suite of their own.
//
// THE DEAD ZONE. `.mk-nav-shield` does two jobs at once: it darkens the strip
// of screen the nav sits in, and it swallows taps so a miss between nav
// controls cannot complete an activity on the card underneath. Those jobs want
// different heights — the gradient has to start well above the nav or it reads
// as a hard edge — and for a while they shared one. The result was an 82px band
// of visible, ordinary-looking content that silently refused taps. Nothing
// about that is visible; it is only findable by asking, pixel by pixel, which
// element would actually receive a tap. So that is what this does.
//
// THE THEME. The five bottom-nav styles were built dark and their surfaces were
// written as literal rgba(). The app has a light theme, so on white the nav
// stayed a black slab. Asserted here by reading the painted colour in both
// themes and requiring it to actually change.
//
// Both are checked for EVERY style, because each one carries its own height and
// its own surface, and a fix that lands on the default and misses the other
// four is the same bug with better odds.
// ══════════════════════════════════════════════════════════════════════════
import fs from 'fs';
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { build, serve } from '../social/harness.mjs';

const PORT = 8795;
const dir = build();
const server = await serve(dir, PORT);
const browser = await chromium.launch();
// A phone. Every style but the desktop Plate fallback is phone-only, and the
// dead zone only exists under the mobile media query.
const page = await browser.newPage({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
const errs = [];
page.on('pageerror', e => errs.push('PAGEERROR: ' + e.message));
await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 45000 });
await page.waitForTimeout(800);

// The harness never runs the real sign-in, so the app sits on its loading
// screen with #appContainer hidden — and a hidden container means every
// element has a zero-size box and every measurement below reads 0.
await page.evaluate(() => {
    document.getElementById('loading').style.display = 'none';
    document.getElementById('appContainer').style.display = 'block';
    window.currentUser = { uid: 'uidMe', displayName: 'Mira', photoURL: null };
    window.userData = {
        level: 5, currentXP: 0, totalXP: 0, friends: [], settings: {}, rewards: {},
        dimensions: [{ id: 'd1', name: 'Body', dimTotalXP: 0, paths: [
            { id: 'p1', name: 'Fit', activities: [] } ] }],
    };
    window._dataOwnerUid = 'uidMe';
    window._dataLoadFailed = false;
    try { window.switchTab('activities'); } catch (e) {}
});

const log = [];
const ok = (n, c, x) => log.push((c ? 'PASS ' : 'FAIL ') + n + (x !== undefined ? '  ' + JSON.stringify(x) : ''));

// style name → [body class, the nav element that style shows]
const STYLES = [
    ['plate',            'mk-nav-plate',                        'mkNavPlate'],
    ['plume',            'mk-nav-plume',                        'mkNavPlume'],
    ['ledger',           'mk-nav-ledger',                       'mkNavLedger'],
    ['ledger collapsed', 'mk-nav-ledger mk-ledger-collapsed',   'mkNavLedger'],
    ['spine',            'mk-nav-spine',                        'mkNavSpine'],
    ['arc',              'mk-nav-arc',                          'mkNavArc'],
];

/** Switch style/theme and let the shield's height transition finish. */
async function apply(bodyClass, theme) {
    await page.evaluate(({ bodyClass, theme }) => {
        document.body.className = bodyClass;
        document.documentElement.setAttribute('data-theme-mode', theme);
    }, { bodyClass, theme });
    await page.waitForTimeout(420);
}

// ── The dead zone ─────────────────────────────────────────────────────────
//
// Walk upward from the nav's own top edge one step at a time and ask what
// would receive a tap there. The nav itself and the shield both count as
// "swallowed"; the first hit that is neither ends the band. A few pixels is
// the deliberate buffer for a fingertip landing a hair high on the nav's edge.
// Anything more is a control somebody cannot press.
const BUFFER_MAX = 8;

for (const [name, cls, navId] of STYLES) {
    await apply(cls, 'dark');
    const r = await page.evaluate((navId) => {
        const nav = document.getElementById(navId);
        const rect = nav.getBoundingClientRect();
        const x = window.innerWidth / 2;
        let dead = 0;
        for (let up = 2; up <= 160; up += 2) {
            const el = document.elementFromPoint(x, rect.top - up);
            const swallowed = el && (el.id === 'mkNavShield' ||
                                     (el.closest && el.closest('.mk-bottom-nav')));
            if (!swallowed) break;
            dead = up;
        }
        return { dead, navTop: Math.round(rect.top), navH: Math.round(rect.height) };
    }, navId);
    ok('no dead zone above the ' + name + ' nav', r.dead <= BUFFER_MAX, r);
}

// The gradient must NOT shrink to the hit area — it is what stops content
// colliding with the nav visually, and it is the reason the two heights were
// ever conflated. Assert they are still deliberately different.
await apply('mk-nav-plate', 'dark');
const heights = await page.evaluate(() => {
    const sh = document.getElementById('mkNavShield');
    return {
        gradient: parseFloat(getComputedStyle(sh).height),
        block: parseFloat(getComputedStyle(sh, '::after').height),
    };
});
ok('the gradient still reaches well above the nav',
    heights.gradient >= 180, heights);
ok('the tap-swallower is much shorter than the gradient',
    heights.block < heights.gradient - 40, heights);

// A hit area that eases into place keeps swallowing taps over ground the nav
// has already left — for 320ms after the ledger collapses, in the one case
// where a style's height actually changes at runtime.
const blockTransition = await page.evaluate(() =>
    getComputedStyle(document.getElementById('mkNavShield'), '::after').transitionProperty);
ok('the tap-swallower does not animate its height',
    !/height/.test(blockTransition), blockTransition);

// ── Touch targets ─────────────────────────────────────────────────────────
//
// Every nav control has to be pressable by a thumb. 44px is the usual floor;
// several of these styles are deliberately compact, so the assertion is on the
// PRESSABLE box — which for a small icon means its padded button, not the glyph.
// Only controls that are actually LIVE count. Several styles park the
// non-current sections at zero height with pointer-events:none — those are not
// small targets, they are absent ones, and counting them would bury the real
// finding under noise.
const MIN_TARGET = 24;

for (const [name, cls, navId] of STYLES) {
    if (name === 'arc') continue;   // radial: labels ride a rotating dial
    await apply(cls, 'dark');
    const small = await page.evaluate(({ navId, MIN_TARGET }) => {
        const nav = document.getElementById(navId);
        return Array.from(nav.querySelectorAll('button'))
            .filter(b => {
                const cs = getComputedStyle(b);
                if (cs.pointerEvents === 'none' || cs.visibility === 'hidden') return false;
                if (parseFloat(cs.opacity) === 0) return false;
                // A parent collapsed to nothing takes its children with it.
                for (let el = b; el && el !== nav; el = el.parentElement) {
                    const p = getComputedStyle(el);
                    if (p.pointerEvents === 'none' || parseFloat(p.opacity) === 0) return false;
                    if (el.getBoundingClientRect().height < 1) return false;
                }
                return true;
            })
            .map(b => { const r = b.getBoundingClientRect();
                        return { cls: (b.className || '').split(' ')[0],
                                 t: (b.textContent || '').trim().slice(0, 14) || b.className,
                                 w: Math.round(r.width), h: Math.round(r.height) }; })
            .filter(b => b.w < MIN_TARGET || b.h < MIN_TARGET)
            // Three controls are deliberately below the floor and are RAISED
            // WITH JERRY rather than silently resized here, because each is
            // pinned by geometry that cannot absorb the change:
            //
            //   .mk-ledger-name  15px tall, and the band around it is exactly
            //                    15px of content box — growing it moves all
            //                    four bands and the Ledger's 150px total.
            //   .mk-ledger-sub   22px, inside a .mk-ledger-subs row with a
            //                    fixed 22px height that animates open.
            //   .mk-spine-sub    22px, and fitSpine() already SHRINKS these at
            //                    runtime until three names fit the bar —
            //                    growing them fights that logic directly.
            //
            // Anything NOT on this list is a regression: a new control that
            // came in under the floor, or one of these three having been
            // restyled without the exemption being revisited.
            .filter(b => !['mk-ledger-name', 'mk-ledger-sub', 'mk-spine-sub'].includes(b.cls));
    }, { navId, MIN_TARGET });
    ok('every live ' + name + ' nav control clears ' + MIN_TARGET + 'px', small.length === 0, small);
}

// ── The theme ─────────────────────────────────────────────────────────────
//
// The surface each style paints must actually differ between themes. A style
// whose background is byte-identical on dark and light is one that was written
// with a literal colour and never wired to the theme.
const THEMED = [
    ['plate',  'mk-nav-plate',  '#mkNavPlate'],
    ['plume',  'mk-nav-plume',  '#mkNavPlume .mk-plume-pill'],
    ['ledger', 'mk-nav-ledger', '#mkNavLedger'],
    ['spine',  'mk-nav-spine',  '#mkNavSpine'],
    ['arc',    'mk-nav-arc',    '#mkNavArc .mk-arc-disc-tab'],
];
for (const [name, cls, sel] of THEMED) {
    await apply(cls, 'dark');
    const dark = await page.evaluate(s => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).backgroundColor + '|' + getComputedStyle(el).backgroundImage : null;
    }, sel);
    await apply(cls, 'light');
    const light = await page.evaluate(s => {
        const el = document.querySelector(s);
        return el ? getComputedStyle(el).backgroundColor + '|' + getComputedStyle(el).backgroundImage : null;
    }, sel);
    ok('the ' + name + ' nav surface changes with the theme',
        !!dark && !!light && dark !== light, { dark, light });
}

// The scrim behind the nav is the other half of the same picture: a dark scrim
// left on a white page is a grey smear across the bottom of every screen.
await apply('mk-nav-plate', 'dark');
const scrimDark = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mk-scrim').trim());
await apply('mk-nav-plate', 'light');
const scrimLight = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue('--mk-scrim').trim());
ok('the nav scrim follows the theme', scrimDark !== scrimLight, { scrimDark, scrimLight });

// The active item has to stay findable on white. It is the one thing in the
// nav that is not decoration.
for (const [name, cls, activeSel] of [
    ['plate',  'mk-nav-plate',  '.mk-plate-tab.active'],
    ['plume',  'mk-nav-plume',  '.mk-plume-tab.active'],
    ['ledger', 'mk-nav-ledger', '.mk-ledger-sub.active'],
    ['spine',  'mk-nav-spine',  '.mk-spine-tab.active'],
]) {
    await apply(cls, 'light');
    const c = await page.evaluate(s => {
        const el = document.querySelector(s);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { color: cs.color, bg: cs.backgroundColor };
    }, activeSel);
    // The accent is electric blue; on light it must not have fallen back to a
    // near-black or near-white that reads as "no selection".
    const isAccent = c && /rgb\(\s*(\d+),\s*(\d+),\s*(\d+)/.test(c.color) && (() => {
        const [, r, g, b] = c.color.match(/rgb\(\s*(\d+),\s*(\d+),\s*(\d+)/).map(Number);
        return b > r + 20 && b > 100;     // blue-dominant
    })();
    ok('the active ' + name + ' item is still the accent on light', !!isAccent, c);
}

// ── Reduced motion ────────────────────────────────────────────────────────
//
// The nav is the busiest moving thing in the app and was the one block in the
// stylesheet that ignored the preference entirely.
await page.emulateMedia({ reducedMotion: 'reduce' });
await apply('mk-nav-arc', 'dark');
const stillMoves = await page.evaluate(() => {
    const sels = ['.mk-arc-ring', '.mk-plate-bar', '.mk-ledger-band', '.mk-plume-pill',
                  '.mk-spine-sub', '.mk-nav-shield'];
    return sels.filter(s => {
        const el = document.querySelector(s);
        if (!el) return false;
        const t = getComputedStyle(el).transitionDuration;
        return t && t.split(',').some(d => parseFloat(d) > 0);
    });
});
ok('nothing in the nav animates under reduced motion', stillMoves.length === 0, stillMoves);

const pageAnim = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'mk-anim-fwd';
    document.body.appendChild(el);
    const n = getComputedStyle(el).animationName;
    el.remove();
    return n;
});
ok('the page transition is dropped under reduced motion', pageAnim === 'none', pageAnim);
await page.emulateMedia({ reducedMotion: 'no-preference' });

// ── No leftovers from the retired flat nav ────────────────────────────────
//
// The old six-tab `.nav-tabs` bar is kept in the DOM at zero size so app.js can
// still find its `.nav-tab` nodes to mark active. It must stay inert: if it
// ever regains a box it is a second bottom bar sitting on top of the real one.
await apply('mk-nav-plate', 'dark');
const legacy = await page.evaluate(() => {
    const el = document.querySelector('.nav-tabs');
    if (!el) return { present: false };
    const r = el.getBoundingClientRect();
    return { present: true, w: Math.round(r.width), h: Math.round(r.height),
             pe: getComputedStyle(el).pointerEvents };
});
ok('the retired flat nav bar takes no taps and no meaningful space',
    legacy.present && legacy.pe === 'none' && legacy.w <= 4 && legacy.h <= 4, legacy);

log.forEach(l => console.log(l));
errs.forEach(e => console.log(e));
const failed = log.filter(l => l.startsWith('FAIL')).length;
console.log(`\n${log.length - failed} passed, ${failed} failed` +
            (errs.length ? `, ${errs.length} page errors` : ''));

await browser.close();
server.close();
fs.rmSync(dir, { recursive: true, force: true });
process.exit(failed || errs.length ? 1 : 0);
