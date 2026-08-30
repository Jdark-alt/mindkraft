'use strict';

// ══════════════════════════════════════════════════════════════════════════
// PACT PROGRESS — the shared reading of "how far along is each side"
// ══════════════════════════════════════════════════════════════════════════
//
// Two things need this number and they must agree: resolution ("has this side
// hit everything it committed to") and the two progress nudges below it (the
// halfway mark, and the gap between partners). So it is computed once, here,
// and both read it.
//
// It is a port of pactStats() in app.js rather than a shared import, because
// there is nothing to share it through: app.js is a browser ES module served
// straight to the page, functions/ is CommonJS on Node, and this repo has no
// build step between them. What keeps the two honest is that the shape is
// small and the tests below pin the arithmetic on both sides of the read
// tolerance.
//
// TWO DOCUMENT SHAPES. A pact created before multi-activity support stores one
// activity per side:
//
//     terms[uid]    = { activityId, activityName, target }
//     progress[uid] = <number>
//
// One created since stores as many as each side wanted:
//
//     terms[uid]    = { items: [{ activityId, activityName, target }] }
//     progress[uid] = { <activityId>: <count> }
//
// Read tolerance, not migration: a pact already running finishes out under the
// shape both people agreed to. Nothing here ever writes the old shape back.

/** One side's committed activities, in either shape. */
function items(pact, uid) {
    const term = (pact.terms && pact.terms[uid]) || null;
    if (!term) return [];
    if (Array.isArray(term.items)) {
        return term.items.filter((it) => it && it.activityId);
    }
    if (term.activityId) return [term];   // the single-activity shape
    return [];
}

/** One activity's counter for one side, in either shape. */
function count(pact, uid, activityId) {
    const prog = pact.progress && pact.progress[uid];
    if (typeof prog === 'number') return prog;   // the single-activity shape
    return (prog && prog[String(activityId)]) || 0;
}

/**
 * One side of the pact: completions done, completions committed, the
 * percentage between them, and whether every activity is at its target.
 *
 * Capped per activity, so an over-logged item can never carry an under-logged
 * one — which is also what stops a 200% on one activity reading as a side that
 * has "hit the halfway mark" while another sits at zero.
 */
function stats(pact, uid) {
    const list = items(pact, uid);
    let done = 0;
    let total = 0;
    let hit = list.length > 0;
    for (const it of list) {
        const target = Math.max(1, it.target || 1);
        const n = Math.min(count(pact, uid, it.activityId), target);
        done += n;
        total += target;
        if (n < target) hit = false;
    }
    return {
        done,
        total,
        hit,
        pct: total > 0 ? Math.round((done / total) * 100) : 0,
    };
}

// ── Nudge thresholds ──────────────────────────────────────────────────────

const MILESTONE_PCT = 50;
const GAP_PCT = 30;
const GAP_NUDGE_CAP = 3;

/**
 * Decide which progress nudges an active pact has earned, and what has to be
 * written back so they never fire twice for the same reason.
 *
 * Pure: takes the document, returns { patch, pushes } and touches nothing.
 * That matters here more than usual, because the caller writes the patch
 * BEFORE sending — a re-entrant trigger run that saw the flags unset would
 * push again, and a duplicate nudge is worse than a missed one.
 *
 * Two rules, and the second is the whole reason this is not a one-liner:
 *
 *   HALFWAY is a one-time flag per person per pact. It cannot repeat, so it
 *   needs no cap: two people, two possible pushes, ever.
 *
 *   THE GAP flaps. One person pulls 30 points ahead, the other logs twice and
 *   it closes, then it opens again — a naive "fire while the gap is wide"
 *   check would push on essentially every completion for the rest of the pact.
 *   So it is armed/disarmed: firing disarms it, and only the gap CLOSING back
 *   under the threshold re-arms it. On top of that a hard cap of three events
 *   for the life of the pact, because someone who stays consistently behind
 *   would otherwise be nudged every time they briefly caught up. Both pushes
 *   in one gap event — the one chasing and the one ahead — count as ONE event.
 *
 * @returns {{patch: object, pushes: Array<{uid: string, tagSuffix: string, body: string}>}}
 */
function progressNudges(pact) {
    const patch = {};
    const pushes = [];
    const participants = pact.participants || [];
    if (pact.status !== 'active' || participants.length !== 2) {
        return { patch, pushes };
    }

    const [a, b] = participants;
    const pctOf = { [a]: stats(pact, a).pct, [b]: stats(pact, b).pct };
    const nameOf = (uid) => (pact.names && pact.names[uid]) || 'Your partner';
    const other = (uid) => (uid === a ? b : a);

    // ── Halfway ───────────────────────────────────────────────────────────
    const reached = pact.reached50 || {};
    for (const uid of participants) {
        if (pctOf[uid] < MILESTONE_PCT || reached[uid]) continue;
        patch['reached50.' + uid] = true;
        pushes.push({
            uid: other(uid),
            // A distinct tag per KIND of nudge. All pact pushes share one tag
            // per pact so the tray holds one card, not a pile — but halfway and
            // the gap can be earned by the same write, and collapsing them onto
            // each other would silently eat one of the two.
            tagSuffix: 'half',
            body: nameOf(uid) + ' is halfway through their side of your Pact.',
        });
    }

    // ── The gap ───────────────────────────────────────────────────────────
    const gap = Math.abs(pctOf[a] - pctOf[b]);
    const fired = pact.gapNudgeCount || 0;
    const armed = pact.gapNudgeArmed !== false;   // absent means armed

    if (gap >= GAP_PCT && armed && fired < GAP_NUDGE_CAP) {
        const leader = pctOf[a] > pctOf[b] ? a : b;
        const trailer = other(leader);
        patch.gapNudgeCount = fired + 1;
        patch.gapNudgeArmed = false;
        pushes.push({
            uid: trailer,
            tagSuffix: 'gap',
            body: nameOf(leader) + ' is pulling ahead on your Pact. There is still time — ' +
                  'and if you fall short you both lose the stake.',
        });
        pushes.push({
            uid: leader,
            tagSuffix: 'gap',
            body: 'You are well ahead of ' + nameOf(trailer) + ' on your Pact. ' +
                  'A nudge from you is worth more than one from us.',
        });
    } else if (gap < GAP_PCT && !armed) {
        // Closed back up — the next time it opens is a new event.
        patch.gapNudgeArmed = true;
    }

    return { patch, pushes };
}

module.exports = {
    items,
    count,
    stats,
    progressNudges,
    MILESTONE_PCT,
    GAP_PCT,
    GAP_NUDGE_CAP,
};
