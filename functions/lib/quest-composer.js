// ── Quest Composer ──────────────────────────────────────────────────────────
//
// Turns "what are you trying to get done?" into a quest spec built mostly out
// of activities the user already does.
//
// The validators here are a byte-for-byte counterpart of qcValidateGroup /
// qcValidateLeaf in app.js. Both copies must run: this one so a malformed
// model response never reaches the client, the client's because the response
// crosses a trust boundary and the builder assumes well-formed input.
// EDIT BOTH OR NEITHER.

// New practices are capped as a SHARE of the quest, not a flat count: three
// new activities in a four-step quest is a different thing from three in a
// twenty-step pipeline. Roughly a third may be new, with a floor so a small
// quest can still introduce one, and a ceiling so nothing runs away.
const NEW_ACTIVITY_SHARE = 0.3;
const MIN_NEW_ACTIVITIES = 2;
const MAX_NEW_ACTIVITIES = 6;
function newActivityAllowance(totalLeaves) {
    return Math.max(MIN_NEW_ACTIVITIES,
        Math.min(MAX_NEW_ACTIVITIES, Math.round(totalLeaves * NEW_ACTIVITY_SHARE)));
}
const MAX_LEAVES = 20;          // total leaves, enforced not just requested
const MAX_DEPTH = 3;            // group nesting
const MAX_ACTIVITIES_SENT = 40; // raw material offered to the model
const MIN_ACTIVITIES = 3;       // below this there is nothing to build from
const REQUEST_MAX_CHARS = 280;

const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'occasional'];

function newId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ── Which activities are real enough to build a quest from ──────────────────
// The same liveness rule the Grit weekly quota uses: at least one completion
// inside a frequency-shaped lookback window. Someone with fifty-three parked
// activities should not have all fifty-three offered as raw material.

function lookbackDays(a) {
    switch (a.frequency) {
        case 'daily':
        case 'weekly': return 7;
        case 'biweekly': return 14;
        case 'monthly': return 30;
        case 'custom':
            if (a.customSubtype === 'days') return 7;
            return Math.max(7, a.customDays || 1);
        default: return 7;
    }
}

function isCountable(a) {
    return !!a && !a.archived && !a.deleted && !(a.isNegative && !a.isSkipNegative);
}

function lastCompletionMs(a) {
    const hist = a.completionHistory || [];
    let newest = 0;
    for (let i = hist.length - 1; i >= 0; i--) {
        const e = hist[i];
        if (!e || e.isPenalty || (e.xp || 0) <= 0) continue;
        const t = new Date(e.date).getTime();
        if (!isNaN(t) && t > newest) newest = t;
    }
    return newest;
}

function collectActivities(userData) {
    const out = [];
    (userData.dimensions || []).forEach((dim) => {
        (dim.paths || []).forEach((path) => {
            (path.activities || []).forEach((act) => {
                if (act && act.id) out.push({ act, dim });
            });
        });
    });
    return out;
}

/**
 * The activity menu offered to the model: everything the user owns, ranked so
 * what they are actively doing comes first.
 *
 * This deliberately does NOT hard-filter on recency. It used to, using the
 * Grit liveness window, and that was wrong: someone building a video pipeline
 * has "shoot a video" and "ideate and script" in their tracker but may not
 * have touched them this week — so the composer never saw them and built the
 * quest out of the one activity that happened to be recent. An activity you
 * own is raw material whether or not you did it on Tuesday.
 *
 * Recency still matters, so it is passed to the model as a signal rather than
 * a gate, and the 40-cap keeps a big tracker from flooding the prompt.
 */
function activityMenu(userData, now = new Date()) {
    const refMs = now.getTime();
    return collectActivities(userData)
        .filter(({ act }) => isCountable(act))
        .map(({ act, dim }) => ({ act, dim, last: lastCompletionMs(act) }))
        .sort((a, b) => b.last - a.last)          // actively used first
        .slice(0, MAX_ACTIVITIES_SENT)
        .map(({ act, dim, last }) => {
            const entry = {
                id: act.id,
                name: String(act.name || '').slice(0, 80),
                frequency: act.frequency || 'weekly',
                dimensionId: dim.id,
                dimension: String(dim.name || '').slice(0, 40),
                baseXP: Math.max(1, act.baseXP || 1),
                streak: act.streak || 0,
                doneRecently: last > 0 && refMs - last <= lookbackDays(act) * 86400000,
            };
            // The description is what tells the model whether a vaguely named
            // activity actually covers the work in front of it.
            const desc = String(act.description || '').trim();
            if (desc) entry.description = desc.slice(0, 160);
            return entry;
        });
}

// ── Prompt ──────────────────────────────────────────────────────────────────
// The LEAF vocabulary is carried over verbatim from the tech-tree generator,
// where it was tuned against how this model actually malforms output.

const SYSTEM_PROMPT = `You are a planner. You take something a person is trying to get done and turn it into a quest: a real structure of stages, steps and repeat counts, built mostly out of activities they ALREADY track.

Your job is decomposition and ordering. Do not propose a life direction — this app has a separate Map for discovery. Take the stated intention and make it genuinely doable.

Output ONE JSON object. No prose, no markdown fences.

{"name":str,"emoji":str,"description":str,
 "cadence":{"type":"oneoff"|"recurring"},
 "groups":[{"kind":"group","name":str,"ordered":bool,"repeat":int,"children":[LEAF|GROUP,...]}]}

LEAF, pick per step:
 reuses a real activity: {"kind":"leaf","type":"activity","linkedActivityId":"<real activityId from INPUT>","resetMode":"per-cycle","requiredCount":n}
 one-off step:           {"kind":"leaf","type":"task","name":str,"resetMode":"once","requiredCount":1}
 new practice:           {"kind":"leaf","type":"activity","spec":{"name":str,"description":str,"baseXP":1..50,"frequency":"daily|weekly|biweekly|monthly|occasional","dimensionId":"<real dimensionId>"},"resetMode":"per-cycle","requiredCount":n}

── PLAN PROPERLY ──────────────────────────────────────────────────────────
1. BUILD THE REAL SHAPE OF THE WORK. Most things worth doing have stages, and each stage is a GROUP. A video habit is not one list — it is planning, production, post-production, publishing, and reviewing how it did. Name the stages the way someone doing the work would.
2. USE ordered:true WHEN THE SEQUENCE IS REAL. A production line is ordered: you cannot edit footage you have not shot. A set of independent chores is not — leave those unordered. Do not make everything ordered, and do not make everything a flat checklist. Judge each group on its own.
3. SIZE IT HONESTLY. "A few days" is one group and a handful of steps. "A few weeks" is two or three groups. "A few months" can be three to five. A recurring routine is usually one or two groups that cycle. Never pad to look thorough.
4. repeat > 1 only for a group that genuinely runs more than once per cycle.
5. Terse names. A group name is two or three words.

── USE WHAT THEY ALREADY DO ───────────────────────────────────────────────
6. READ THE WHOLE ACTIVITY LIST BEFORE YOU BUILD. Match on MEANING, not wording: "ideate and script", "shoot a video" and "edit a video" are three separate stages of one pipeline and all three belong in a video quest. Missing an activity that obviously fits is the single worst thing you can do here — it makes the quest feel like it was written by someone who never looked.
7. \`doneRecently:false\` does NOT mean unavailable. It is still their activity and still the right leaf if it fits the work. Recency only breaks ties.
8. NEVER link a vague or catch-all activity — "do something new", "be productive", "misc" — unless the request is literally about that. A generic activity dragged into a specific quest is noise, and the user notices immediately. If nothing genuinely fits a step, write a task or a new practice instead.

── WHEN TO ADD SOMETHING NEW ──────────────────────────────────────────────
9. Roughly TWO THIRDS of the quest should be activities they already have. The remaining third may be new steps where there is a real gap — do not force the ratio in either direction, and never invent a step the quest does not need.
10. A TASK is for a one-off or per-cycle step that is not a habit worth tracking forever: design the thumbnail, write the description, publish it, book the venue, buy soil. Reach for a task before a new practice — most gaps are tasks.
11. A NEW PRACTICE is only for something they should be doing repeatedly, and would want a streak on. It must carry a "description": one short sentence on what doing it actually involves.

── LIMITS ─────────────────────────────────────────────────────────────────
12. NEVER use the same linkedActivityId twice anywhere in the quest. One activity, one leaf. If it recurs throughout, raise its requiredCount or put it in a group with repeat > 1.
13. At most ${MAX_LEAVES} leaves in total, nesting at most ${MAX_DEPTH} deep.`;

function buildComposePrompt({ activities, dimensions, request, shape, size }) {
    const sizeLine = size
        ? { days: 'a few days', weeks: 'a few weeks', months: 'a few months' }[size]
        : 'unspecified — you decide';
    const input = {
        request,
        shape,
        shapeMeaning: shape === 'recurring'
            ? 'a routine that cycles — cadence.type must be "recurring"'
            : 'a project with an end state — cadence.type must be "oneoff"',
        roughSize: sizeLine,
        activities,
        dimensions,
    };
    return { system: SYSTEM_PROMPT, user: 'INPUT:\n' + JSON.stringify(input) };
}

// ── Validation ──────────────────────────────────────────────────────────────
// Lenient on the envelope by design. This model drops the "spec" wrapper and
// puts leaves where groups belong; an earlier strict implementation discarded
// the whole quest when it did, which is why quests "never generated". Repair
// malformed envelopes rather than rejecting them.

function validateGroup(g, ctx, counter, depth) {
    if (!g || typeof g !== 'object') return null;
    if (g.kind === 'leaf' || g.type) return null; // a bare leaf at group position
    depth = depth || 1;

    const raw = Array.isArray(g.children) ? g.children : [];
    const children = [];
    for (const c of raw) {
        if (counter.leaves >= MAX_LEAVES) break;   // §14.3 — a cap enforced, not requested
        let built;
        if (c && c.kind === 'group') {
            // Past the depth ceiling a nested group is flattened into its
            // parent rather than dropped, so its steps survive.
            if (depth >= MAX_DEPTH) {
                const inner = validateGroup(c, ctx, counter, depth);
                if (inner) children.push.apply(children, inner.children);
                continue;
            }
            built = validateGroup(c, ctx, counter, depth + 1);
        } else {
            built = validateLeaf(c, ctx, counter);
        }
        if (built) children.push(built);
    }
    if (!children.length) return null;             // every group has >=1 child

    return {
        id: newId('grp'),
        kind: 'group',
        name: String(g.name || '').slice(0, 60),
        ordered: !!g.ordered,
        repeat: Math.max(1, parseInt(g.repeat, 10) || 1),
        repsDone: 0,
        children,
    };
}

function validateLeaf(l, ctx, counter) {
    if (!l || typeof l !== 'object') return null;
    if (counter.leaves >= MAX_LEAVES) return null;

    const req = Math.max(1, parseInt(l.requiredCount, 10) || 1);
    const resetMode = l.resetMode === 'once' ? 'once' : 'per-cycle';
    let type = l.type === 'activity' ? 'activity' : 'task';

    if (type === 'activity') {
        // The authoritative activity list lives here, so an invented id is
        // caught rather than carried into the builder.
        if (l.linkedActivityId && ctx.activityIds.has(l.linkedActivityId)) {
            // One activity, one leaf. The model likes to repeat an activity in
            // every group it feels relevant to, which shows up as duplicate
            // cards for the same thing. A repeat is FOLDED INTO the first leaf
            // rather than dropped, so the work it represents survives.
            if (!counter.linked) counter.linked = {};
            const seen = counter.linked[l.linkedActivityId];
            if (seen) {
                seen.requiredCount = Math.min(99, seen.requiredCount + req);
                return null;
            }
            counter.leaves++;
            const built = {
                id: newId('lf'), kind: 'leaf', type: 'activity', linkedActivityId: l.linkedActivityId,
                name: '', resetMode, requiredCount: req, completedCount: 0,
            };
            counter.linked[l.linkedActivityId] = built;
            return built;
        }
        const spec = l.spec || {};
        if (counter.newActs >= MAX_NEW_ACTIVITIES) {
            type = 'task';  // hard ceiling; the share is applied afterwards
        } else if (spec && (spec.baseXP || spec.frequency || spec.dimensionId || l.name)) {
            counter.newActs++;
            counter.leaves++;
            const madeNew = {
                id: newId('lf'), kind: 'leaf', type: 'activity', linkedActivityId: null,
                name: '', resetMode, requiredCount: req, completedCount: 0,
                spec: {
                    name: String(spec.name || l.name || 'Practice').slice(0, 80),
                    description: String(spec.description || '').slice(0, 200),
                    baseXP: Math.min(50, Math.max(1, parseInt(spec.baseXP, 10) || 8)),
                    frequency: VALID_FREQUENCIES.indexOf(spec.frequency) !== -1 ? spec.frequency : 'weekly',
                    dimensionId: ctx.dimIds.has(spec.dimensionId) ? spec.dimensionId : ctx.fallbackDim,
                },
            };
            if (!counter.newLeaves) counter.newLeaves = [];
            counter.newLeaves.push(madeNew);
            return madeNew;
        } else {
            type = 'task';
        }
    }

    const name = String(l.name || '').trim();
    if (!name) return null;   // a task leaf needs a name
    counter.leaves++;
    return {
        id: newId('lf'), kind: 'leaf', type: 'task', linkedActivityId: null,
        name: name.slice(0, 80), resetMode, requiredCount: req, completedCount: 0,
    };
}

/**
 * Repair and validate a whole quest envelope. Returns a spec or null.
 * Null means the composition failed — never a half-empty quest handed to the
 * user to discover in the builder.
 */
function validateSpec(raw, ctx, fallbackShape) {
    if (!raw || typeof raw !== 'object') return null;
    const s = raw.spec || raw;
    const counter = { newActs: 0, leaves: 0, linked: {} };

    const rawGroups = Array.isArray(s.groups) ? s.groups
        : (Array.isArray(raw.groups) ? raw.groups : []);

    // Leaves arriving where groups belong are gathered into one synthetic
    // group rather than thrown away. This is load-bearing.
    const looksLeaf = (x) => x && typeof x === 'object' && x.kind !== 'group'
        && (x.kind === 'leaf' || x.type || x.linkedActivityId);
    const groupsIn = [];
    const looseLeaves = [];
    rawGroups.forEach((x) => {
        if (x && typeof x === 'object' && x.kind === 'group') groupsIn.push(x);
        else if (looksLeaf(x)) looseLeaves.push(x);
    });
    if (looseLeaves.length) {
        groupsIn.push({ kind: 'group', name: 'Steps', ordered: false, repeat: 1, children: looseLeaves });
    }

    const groups = groupsIn.map((g) => validateGroup(g, ctx, counter, 1)).filter(Boolean);
    if (!groups.length) return null;

    demoteExcessNewActivities(counter);

    const cadence = s.cadence || raw.cadence;
    const cadType = (cadence && cadence.type === 'recurring') ? 'recurring'
        : (cadence && cadence.type === 'oneoff') ? 'oneoff'
        : (fallbackShape === 'recurring' ? 'recurring' : 'oneoff');

    return {
        name: String(s.name || 'New quest').trim().slice(0, 80),
        emoji: String(s.emoji || '🎯').slice(0, 8),
        description: String(s.description || '').slice(0, 240),
        cadence: { type: cadType },
        groups,
    };
}

/**
 * Applies the new-practice share once the quest's real size is known. The
 * excess is DEMOTED to tasks, never dropped: the step is still part of the
 * plan, it just stops being a lifelong commitment. Later leaves go first, so
 * the ones the model reached for earliest — usually the load-bearing ones —
 * survive.
 */
function demoteExcessNewActivities(counter) {
    const made = counter.newLeaves || [];
    const allowed = newActivityAllowance(counter.leaves);
    if (made.length <= allowed) return 0;
    const excess = made.slice(allowed);
    excess.forEach((leaf) => {
        leaf.type = 'task';
        leaf.name = String((leaf.spec && leaf.spec.name) || 'Step').slice(0, 80);
        leaf.linkedActivityId = null;
        delete leaf.spec;
    });
    counter.newActs -= excess.length;
    return excess.length;
}

function buildCtx(userData, activities) {
    const dimIds = new Set((userData.dimensions || []).map((d) => d.id));
    return {
        activityIds: new Set(activities.map((a) => a.id)),
        dimIds,
        fallbackDim: (userData.dimensions || [])[0] ? userData.dimensions[0].id : 'uncategorized',
    };
}

module.exports = {
    MAX_NEW_ACTIVITIES, MAX_LEAVES, MAX_DEPTH, MIN_ACTIVITIES, REQUEST_MAX_CHARS,
    newActivityAllowance, demoteExcessNewActivities,
    activityMenu, buildComposePrompt, validateGroup, validateLeaf, validateSpec, buildCtx,
};
