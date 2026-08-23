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

const MAX_NEW_ACTIVITIES = 3;   // new practices per quest
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

/** Live activities, most-recently-completed first, capped. */
function liveActivities(userData, now = new Date()) {
    const refMs = now.getTime();
    return collectActivities(userData)
        .filter(({ act }) => isCountable(act))
        .map(({ act, dim }) => ({ act, dim, last: lastCompletionMs(act) }))
        .filter(({ act, last }) => last > 0 && refMs - last <= lookbackDays(act) * 86400000)
        .sort((a, b) => b.last - a.last)
        .slice(0, MAX_ACTIVITIES_SENT)
        .map(({ act, dim }) => ({
            id: act.id,
            name: String(act.name || '').slice(0, 80),
            frequency: act.frequency || 'weekly',
            dimensionId: dim.id,
            dimension: String(dim.name || '').slice(0, 40),
            baseXP: Math.max(1, act.baseXP || 1),
            streak: act.streak || 0,
        }));
}

// ── Prompt ──────────────────────────────────────────────────────────────────
// The LEAF vocabulary is carried over verbatim from the tech-tree generator,
// where it was tuned against how this model actually malforms output.

const SYSTEM_PROMPT = `You decompose a stated intention into a quest: a structure of groups, steps and repeat counts, built mostly out of activities the user ALREADY does.

Your job is decomposition and ordering, not discovery. Do not propose a life direction; take the request as given and make it doable.

Output ONE JSON object. No prose, no markdown fences.

{"name":str,"emoji":str,"description":str,
 "cadence":{"type":"oneoff"|"recurring"},
 "groups":[{"kind":"group","name":str,"ordered":bool,"repeat":int,"children":[LEAF|GROUP,...]}]}

LEAF, pick per step:
 reuses a real activity: {"kind":"leaf","type":"activity","linkedActivityId":"<real activityId from INPUT>","resetMode":"per-cycle","requiredCount":n}
 one-off step:           {"kind":"leaf","type":"task","name":str,"resetMode":"once","requiredCount":1}
 new practice:           {"kind":"leaf","type":"activity","spec":{"name":str,"description":str,"baseXP":1..50,"frequency":"daily|weekly|biweekly|monthly|occasional","dimensionId":"<real dimensionId>"},"resetMode":"per-cycle","requiredCount":n}

RULES
1. BUILD IT OUT OF WHAT THEY ALREADY DO. The activities in INPUT are the raw material. A quest assembled from their real activities is the good outcome; one padded with new practices and errands is a failure, even if it reads well. Reach for a real linkedActivityId first, every time.
2. NEW PRACTICES ARE A LAST RESORT — at most ${MAX_NEW_ACTIVITIES}, and zero is the normal, correct answer. Propose one ONLY when the quest is impossible without it and nothing in INPUT comes close. Discovering new practices is another part of this app's job, not yours. If you are tempted by a new practice, look again for an existing activity that covers it.
3. Task leaves are for genuine one-off errands that are not habits — book the venue, buy soil. Use them sparingly; a checklist of chores is not a quest. Never turn a one-time errand into an activity.
4. NEVER use the same linkedActivityId twice anywhere in the quest. One activity, one leaf. If it is needed throughout, give that single leaf a higher requiredCount, or put it in a group with repeat > 1 — never a second copy in another group.
5. Every new-practice spec MUST carry a "description": one short sentence saying what doing it actually involves, so it stands on its own in the user's tracker.
6. At most ${MAX_LEAVES} leaves in total, nesting at most ${MAX_DEPTH} deep. A sprawling tree is unreadable and impossible to finish.
7. ordered:true only when the sequence genuinely matters. Default to a checklist.
8. repeat > 1 only for a recurring quest or a genuinely cyclical group.
9. Terse names. A group name is two or three words.
10. Honour the requested size. "A few days" means one group and a handful of leaves, not a twelve-week programme.`;

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
            type = 'task';  // demote the excess rather than dropping it
        } else if (spec && (spec.baseXP || spec.frequency || spec.dimensionId || l.name)) {
            counter.newActs++;
            counter.leaves++;
            return {
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
    liveActivities, buildComposePrompt, validateGroup, validateLeaf, validateSpec, buildCtx,
};
