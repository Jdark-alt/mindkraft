'use strict';

// ── Map ("Weave my web") generator ──────────────────────────────────────────
//
// Ported from the tech-tree worker this repo used to run on a GitHub Actions
// cron: the client wrote techTree.pendingRequest and waited minutes for the
// worker to notice it. This module is the same generation logic behind an
// instant callable instead (see weaveWeb in ../index.js), the shape the Quest
// Composer already proved out.
//
// What changed in the move, and nothing else:
//   - one provider (the shared lib/model.js adapter) instead of a four-
//     provider fallback chain built for flaky CI runners;
//   - no per-node "revise" mode — a node the user does not like is rejected
//     or accepted and then edited like any other activity;
//   - no Firestore writes. Everything is returned to the caller, which is
//     what keeps generation clear of saveUserData()'s full-document
//     overwrite — the same reason the Quest Composer returns its draft.
//
// The PROMPTS and the validation rules are unchanged: what the model is asked
// to produce, the tier logic, the anchors/fusions/wildcard rules and the
// payload contract are all the same as the worker's.

// Goal colour is goal identity. A fixed palette of 5 — the same web cannot
// legibly carry more than 5 goals.
const GOAL_PALETTE = ['#a8446e', '#5a9fd4', '#c98a3f', '#8a9a5b', '#7a6ff0'];
const LOAD_WEIGHT = { daily: 7, weekly: 1, biweekly: 0.5, monthly: 0.25, occasional: 0.25, 'one-time': 0.25 };
const LOAD_BUDGET_HEADROOM = 8;          // only nodes AVAILABLE at birth count
const MAX_GOALS = 5;
const MAX_NODES = 40;                    // hard ceiling across the whole web
const MIN_ACTIVITIES = 3;                // the gate on a first generation
const WILDCARD_MAX_XP = 8;
const ACTIVITY_SNAPSHOT_CAP = 80;
const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'occasional'];

// One reweave per goal per month, and one whole-tree regeneration per month,
// on separate clocks. Neither starts at the first generation — the initial
// weave is free and immediate.
const REGEN_COOLDOWN_DAYS = 30;

// A node with no prerequisites is born revealed — the anchors (the user's own
// activities, which they can obviously already read) and the wildcard.
// Everything the roadmap hangs off an anchor is bought with Grit.
const REVEAL_COST = 40;

const MAX_TOKENS = { generate: 7000, add_goal: 4500, regenerate: 4500, expand: 2000 };

const VALID_MODES = ['generate', 'add_goal', 'regenerate', 'expand'];

function nowISO() { return new Date().toISOString(); }

function newId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function stampReveal(node) {
    if (!node) return node;
    if (typeof node.revealCost !== 'number') node.revealCost = REVEAL_COST;
    if (typeof node.revealed !== 'boolean') {
        node.revealed = !(node.prerequisites || []).length
            || node.lifecycle === 'active' || !!node.resolvedAt;
        node.revealedAt = node.revealed ? (node.createdAt || nowISO()) : null;
    }
    if (node.revealedAt === undefined) node.revealedAt = null;
    return node;
}

// ── Helpers over the user's schema ──────────────────────────────────────────

function collectActivities(userData) {
    const out = [];
    (userData.dimensions || []).forEach((dim) =>
        (dim.paths || []).forEach((path) =>
            (path.activities || []).forEach((act) => out.push({ act, dim, path }))));
    return out;
}

function liveActivities(userData) {
    return collectActivities(userData).filter(({ act }) => !act.archived && !act.deleted);
}

function activePathsAndDims(userData) {
    const dimensionList = (userData.dimensions || []).map((d) => ({ dimensionId: d.id, name: d.name }));
    const pathList = [];
    (userData.dimensions || []).forEach((d) =>
        (d.paths || []).forEach((p) => pathList.push({ pathId: p.id, name: p.name, dimensionId: d.id })));
    return { dimensionList, pathList };
}

function customPerWeek(act) {
    const n = act.customTimesPerWeek || act.timesPerWeek ||
        (Array.isArray(act.customDays) ? act.customDays.length : 0);
    return n > 0 ? Math.min(7, n) : 3;
}

// Weekly load = sum of per-week weights over active activities.
function weeklyLoad(userData) {
    let sum = 0;
    liveActivities(userData).forEach(({ act }) => {
        const f = act.frequency;
        if (f === 'custom') sum += customPerWeek(act);
        else sum += (LOAD_WEIGHT[f] != null ? LOAD_WEIGHT[f] : 1);
    });
    return Math.round(sum * 10) / 10;
}

// ROLLING WINDOW mastery check: count completions within the trailing
// windowDays from today. 87 completions ending six months ago must NOT
// resolve a 30-day-window mastery. windowDays null = lifetime count.
// Horizons stay human: a node should clear in ~2-3 months. Dailies get a
// roomier window (reps come fast); weekly/monthly must never stretch half a
// year just to unlock the next tier.
const MASTERY_TARGET_BY_FREQ = { daily: 15, weekly: 6, biweekly: 3, monthly: 2, occasional: 3 };
const MASTERY_WINDOW_BY_FREQ = { daily: 45, weekly: 90, biweekly: 90, monthly: 90, occasional: null };
const MASTERY_WINDOW_MAX = 120;

function masteryTargetFor(freq) { return MASTERY_TARGET_BY_FREQ[freq] || 6; }
function masteryWindowFor(freq) {
    return MASTERY_WINDOW_BY_FREQ[freq] !== undefined ? MASTERY_WINDOW_BY_FREQ[freq] : 90;
}
function masteryThresholdFor(act) {
    if (act.techTreeMastery && act.techTreeMastery.count) {
        return { count: act.techTreeMastery.count, windowDays: act.techTreeMastery.windowDays };
    }
    return { count: masteryTargetFor(act.frequency), windowDays: masteryWindowFor(act.frequency) };
}
function rollingWindowMet(act) {
    if (act.techTreeMasteredAt) return true;
    const th = masteryThresholdFor(act);
    const target = Math.max(1, th.count || 1);
    const cutoff = th.windowDays ? Date.now() - th.windowDays * 86400000 : null;
    const k = (act.completionHistory || []).filter((ev) => {
        if (!ev || ev.isPenalty || (ev.xp || 0) <= 0) return false;
        return cutoff === null || new Date(ev.date).getTime() >= cutoff;
    }).length;
    return k >= target;
}

// ── Gates ───────────────────────────────────────────────────────────────────
// The server is the sole authority on whether a request is honoured. A
// tampered client can ask for anything; only this decides.
//
// Returns null when the request may proceed, or a { reason, message } the
// caller hands straight back to the client.

function daysSince(iso) {
    if (!iso) return Infinity;
    const t = new Date(iso).getTime();
    if (!isFinite(t)) return Infinity;
    return (Date.now() - t) / 86400000;
}

function cooldownLeft(iso) {
    return Math.max(0, Math.ceil(REGEN_COOLDOWN_DAYS - daysSince(iso)));
}

function liveNodes(techTree) {
    return (techTree.nodes || []).filter((n) => n && n.lifecycle !== 'archived');
}

function gateFor(mode, techTree, userData, payload, usage) {
    const goals = (techTree.goals || []).filter((g) => !g.retiredAt);
    const activities = liveActivities(userData);
    payload = payload || {};
    usage = usage || {};

    if (mode === 'generate') {
        if (!goals.length) return { reason: 'gate', message: 'Add a goal first.' };
        if (activities.length < MIN_ACTIVITIES) {
            return { reason: 'gate', message: 'Need at least ' + MIN_ACTIVITIES + ' activities.' };
        }
        // A first weave is free and immediate. Rebuilding a web that already
        // exists is the whole-tree regeneration, and that is once a month.
        if (liveNodes(techTree).length) {
            const left = cooldownLeft(usage.lastTreeRegenAt);
            if (left > 0) {
                return {
                    reason: 'cooldown',
                    message: 'The whole web can be regenerated once a month — ' + left + ' day' +
                        (left === 1 ? '' : 's') + ' to go.',
                    days: left,
                };
            }
        }
        return null;
    }

    if (mode === 'add_goal') {
        if (!goals.some((g) => g.id === payload.goalId)) {
            return { reason: 'gate', message: 'That goal no longer exists.' };
        }
        if (goals.length > MAX_GOALS) {
            return { reason: 'gate', message: 'The web can hold at most ' + MAX_GOALS + ' goals.' };
        }
        return null;
    }

    if (mode === 'regenerate') {
        if (!goals.some((g) => g.id === payload.goalId)) {
            return { reason: 'gate', message: 'That goal no longer exists.' };
        }
        const left = cooldownLeft((usage.goalRegenAt || {})[payload.goalId]);
        if (left > 0) {
            return {
                reason: 'cooldown',
                message: 'This thread can be rewoven once a month — ' + left + ' day' +
                    (left === 1 ? '' : 's') + ' to go.',
                days: left,
            };
        }
        return null;
    }

    if (mode === 'expand') {
        if (!liveNodes(techTree).length) return { reason: 'gate', message: 'Nothing to grow from.' };
        return null;
    }

    return { reason: 'gate', message: 'Unknown request.' };
}

// ── Prompt building ─────────────────────────────────────────────────────────

// lean=true drops descriptions/streaks — expansion calls only need names +
// mastery state, so the fat snapshot was pure input cost there.
function activitySnapshot(userData, lean) {
    return collectActivities(userData).slice(0, ACTIVITY_SNAPSHOT_CAP).map(({ act, dim }) => (lean ? {
        activityId: act.id,
        name: act.name,
        dimensionId: dim.id,
        frequency: act.frequency,
        mastered: !!act.techTreeMasteredAt,
    } : {
        activityId: act.id,
        name: act.name,
        description: (act.description || '').slice(0, 90),
        dimensionId: dim.id,
        frequency: act.frequency,
        completionCount: act.completionCount || (act.completionHistory || []).length || 0,
        currentStreak: act.currentStreak || 0,
        masteredAt: act.techTreeMasteredAt || null,
    }));
}

function rejectionStrings(techTree) {
    return (techTree.rejections || []).slice(-40).map((r) =>
        r.nodeTitle + ' (' + (r.reason || 'rejected') + (r.role ? ' · ' + r.role : '') + ')');
}

// The user's own XP scale — suggestions should feel native to it, not like
// they came from a different economy.
function typicalXP(userData) {
    const xs = liveActivities(userData)
        .map(({ act }) => act.baseXP || 0).filter((x) => x > 0).sort((a, b) => a - b);
    if (!xs.length) return { average: 10, p25: 8, p75: 15 };
    const avg = Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
    const q = (p) => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    return { average: avg, p25: q(0.25), p75: q(0.75) };
}

const PAYLOAD_RULES = `
PAYLOAD SHAPES (copy these EXACTLY):
activity — a durable practice with its own streak:
 {"type":"activity","spec":{"name":str,"description":str,"baseXP":1..50,
  "frequency":"daily|weekly|biweekly|monthly|occasional","dimensionId":str},
  "mastery":{"target":int,"windowDays":int|null}}
An activity is the ONLY payload shape. The map proposes practices, nothing else.`;

function buildGeneratePrompt(userData, opts) {
    const techTree = userData.techTree || {};
    const { dimensionList, pathList } = activePathsAndDims(userData);
    const goals = (techTree.goals || []).filter((g) => !g.retiredAt)
        .filter((g) => !opts.goalIds || opts.goalIds.indexOf(g.id) !== -1)
        .map((g) => ({ goalId: g.id, rawText: g.rawText, sharpened: g.sharpened || null, kind: g.kind || null }));

    const load = weeklyLoad(userData);
    const xp = typicalXP(userData);
    const userNodes = (techTree.nodes || []).filter((n) => n.source === 'user').map((n) => n.title);
    const resolvedTitles = (techTree.nodes || []).filter((n) => n.resolvedAt).map((n) => n.title);

    const system = `You generate the Web for Mindkraft, a life-gamification app: the user's REAL
activities are anchors, and a TIERED ROADMAP of new activities grows out of
them toward each goal. Output ONLY one valid JSON object — no prose, no
markdown fences. Be TERSE everywhere: "description" is one plain sentence
(<=90 chars), never tips or coaching talk; set "whyNow" to null unless one
short clause genuinely earns its place.

1. GOALS — one "goals" entry per DISTINCT goal (split an input entry only
   when it names separate life domains; max ${MAX_GOALS} total).
   "sharpened": one concrete, defensible reading (a target, not a
   restatement). "shortName": <=14 chars, unique. "fromGoalId": the input
   goalId it derives from, or null. "kind": "destination" if any outcome is
   stated, else "rhythm" (then "kindReason" is required; else null).

2. ANCHORS — per goal, the 2-5 input activityIds that genuinely serve it:
   {"activityId":str,"whyNow":null}. Only real ids from the input.

3. ROADMAP (the core of the response) — per goal, map the WHOLE journey to
   the goal as TIERS of new activities, 4-9 nodes: tier 1 builds directly
   on the anchors, each later tier is the next real step after the one
   before, and the final tier is the goal within reach. Be thorough in
   COVERAGE (every major step appears, correctly sequenced), shallow in
   DETAIL (small nodes, terse text). EVERY roadmap node carries >=1
   prerequisite — that is what draws the tree:
     tier 1:      [{"type":"activity_mastered","activityId":"<anchor id>"}]
     later tiers: [{"type":"node_mastered","nodeTitle":"<EXACT title of a
                   node in YOUR output for this goal>"}]
   role: "suggestion" (or "upgrade" when it deepens one anchor directly).
   The user sees the whole locked chain from day one and unlocks it by
   mastering tier after tier — sequence it honestly.

4. FUSIONS — top-level "fusions": 0-2. A pair of anchors from DIFFERENT
   dimensions whose combination is so natural anyone would nod (a walking
   phone call, cooking for friends). If the connection needs explaining,
   drop it — never force one. {"title","description","whyNow":null,
   "dimensionId","sourceActivityIds":[id,id],"payload"}. A fusion only
   unlocks once BOTH sources are mastered.

5. WILDCARD — top-level "wildcards": exactly 1. No goal, no prerequisites,
   tiny (<=2 actions/week, baseXP <=${WILDCARD_MAX_XP}), a universally positive concrete
   practice their goals would never surface.

RULES: baseXP near the user's average (${xp.average}, typical ${xp.p25}-${xp.p75}).
Mastery reachable in 60-90 days at the stated frequency (daily: up to
~45-day window; weekly ~6/90d; biweekly ~3/90d; monthly ~2/90d) — never
longer. Available-at-birth load may add at most +${LOAD_BUDGET_HEADROOM}/week
(locked tiers are exempt; the user is at ${load}/week). Do not re-suggest
anything in rejections, userAddedNodeTitles or alreadyResolved.
${PAYLOAD_RULES}

Also "vision": 1-2 second-person sentences specific to their goals.

OUTPUT (one JSON object, nothing else):
{ "vision": str,
  "goals": [{ "fromGoalId": str|null, "sharpened": str, "shortName": str,
     "kind": "destination"|"rhythm", "kindReason": str|null,
     "anchors": [{ "activityId": str, "whyNow": null }],
     "nodes": [{ "role": str, "title": str, "description": str,
                 "whyNow": null, "dimensionId": str,
                 "prerequisites": [{"type":"activity_mastered","activityId":str}|{"type":"node_mastered","nodeTitle":str}],
                 "payload": <activity payload> }] }],
  "fusions": [{ "title": str, "description": str, "whyNow": null, "dimensionId": str,
                "sourceActivityIds": [str, str], "payload": <activity payload> }],
  "wildcards": [{ "title": str, "description": str, "whyNow": null, "dimensionId": str,
                  "payload": <activity payload> }] }`;

    const input = {
        goals,
        dimensions: dimensionList,
        paths: pathList,
        activeActivities: activitySnapshot(userData),
        loadBudget: { current: load, headroom: LOAD_BUDGET_HEADROOM },
        typicalXP: xp,
        rejections: rejectionStrings(techTree),
        userAddedNodeTitles: userNodes,
        alreadyResolved: resolvedTitles,
    };
    if (opts.mode === 'add_goal') {
        input._mode = 'ADD ONE GOAL: weave nodes for the single goal above into the existing web; do not touch other goals. Fusions may pair its anchors with anchors of existing goals (listed in _existingAnchors). Emit 0-1 wildcards only if the web has none.';
        input._existingAnchors = opts.existingAnchors || [];
    }
    if (opts.mode === 'regenerate') {
        input._mode = 'REWEAVE this goal\'s thread: replace its unclaimed suggestions with a fresh tiered roadmap (same contract). Build on alreadyResolved; honour rejections. Do not emit wildcards.';
        input._resolvedOnGoal = opts.resolvedOnGoal || [];
    }
    return { system, user: 'INPUT:\n' + JSON.stringify(input) };
}

// Expansion prompt: fan 1-3 nodes under a freshly mastered thing. Explicitly
// allowed to propose new fusions using the mastered node as one source, and to
// attach prerequisites to real existing activities.
function buildExpandPrompt(userData, ctx) {
    const load = weeklyLoad(userData);
    const { dimensionList } = activePathsAndDims(userData);
    const system = `You extend a user's Web after they MASTERED something. Emit 1-3 SMALL
complementary nodes this mastery now makes possible — support work, the
next notch, or a natural pairing with another REAL activity from the input
(including ones not yet on the map, if they genuinely fit). Not a restart,
no filler; emit fewer over forcing one. Be TERSE: "description" one plain
sentence (<=90 chars), no tips; "whyNow": null.

EVERY node carries >=1 prerequisite: the mastered node via
{"type":"node_mastered","nodeTitle":"<EXACT input.resolvedNode.title>"} or a
real activity via {"type":"activity_mastered","activityId":...}. Never
invent activityIds. A "fusion" node must carry BOTH sources as
prerequisites — it unlocks only when both are mastered.

Do not re-suggest anything in rejections or existingNodeTitles. Added load
stays under +${LOAD_BUDGET_HEADROOM}/week (user is at ${load}/week).
${PAYLOAD_RULES}

Output ONLY: { "nodes":[{ "role":"upgrade"|"fusion"|"suggestion",
  "title":str, "description":str, "whyNow":null, "dimensionId":str,
  "prerequisites":[...], "payload": <payload> }] }`;
    const input = {
        resolvedNode: ctx.resolvedNode,
        goals: ctx.goals,
        dimensions: dimensionList,
        activeActivities: ctx.activities,
        existingNodeTitles: ctx.existingTitles,
        rejections: ctx.rejections,
        loadBudget: { current: load, headroom: LOAD_BUDGET_HEADROOM },
    };
    return { system, user: 'INPUT:\n' + JSON.stringify(input) };
}

// Wildcard replenish: a small dedicated call that mints 1-2 fresh wildcards
// when the previous ones were accepted or finished. Same contract as
// generation STEP 5: no goal, no prerequisites, tiny load, concrete.
function buildWildcardPrompt(userData, techTree, slots, existingTitles) {
    const { dimensionList } = activePathsAndDims(userData);
    const xp = typicalXP(userData);
    const system = `Suggest exactly ${slots} WILDCARD practice(s) for a life-gamification user:
universally positive, concrete acts their goals would never surface — not
motivational fluff. No goal, no prerequisites, tiny load (<=2 actions/week,
baseXP <=${WILDCARD_MAX_XP}; the user's XP scale averages ${xp.average}). Do not repeat
anything in existingNodeTitles or rejections.
Output ONLY: { "wildcards": [{ "title":str, "description":str, "whyNow":str,
  "dimensionId":str, "payload": <activity payload> }] }`;
    const input = {
        dimensions: dimensionList,
        activeActivities: activitySnapshot(userData, true).map((a) => a.name),
        existingNodeTitles: existingTitles,
        rejections: rejectionStrings(techTree),
    };
    return { system, user: 'INPUT:\n' + JSON.stringify(input) };
}

// ── Response shaping ────────────────────────────────────────────────────────

function normalizeParsed(parsed) {
    const p = parsed && typeof parsed === 'object' ? parsed : {};
    return {
        vision: typeof p.vision === 'string' ? p.vision.trim().slice(0, 300) : null,
        goals: Array.isArray(p.goals) ? p.goals : [],
        fusions: Array.isArray(p.fusions) ? p.fusions : [],
        wildcards: Array.isArray(p.wildcards) ? p.wildcards : [],
        nodes: Array.isArray(p.nodes) ? p.nodes : [],
    };
}

// Returns a schema-valid payload, or null to drop the node. An activity is the
// only shape the map produces.
function validatePayload(raw, ctx) {
    if (!raw || typeof raw !== 'object') return null;
    if (raw.type !== 'activity') return null;

    const s = raw.spec || {};
    const frequency = VALID_FREQUENCIES.indexOf(s.frequency) !== -1 ? s.frequency : 'weekly';
    const dimensionId = ctx.dimIds.has(s.dimensionId) ? s.dimensionId
        : (ctx.dimIds.has(ctx.dimensionId) ? ctx.dimensionId : ctx.fallbackDim);
    return {
        type: 'activity',
        activityId: null,
        spec: {
            name: String(s.name || ctx.title).trim().slice(0, 80),
            description: String(s.description || ctx.description || '').slice(0, 240),
            baseXP: Math.min(50, Math.max(1, parseInt(s.baseXP, 10) || 10)),
            frequency,
            dimensionId,
            suggestedPathId: ctx.pathIds.has(s.suggestedPathId) ? s.suggestedPathId : null,
        },
        mastery: {
            target: Math.min(60, Math.max(1, parseInt((raw.mastery || {}).target, 10) || masteryTargetFor(frequency))),
            windowDays: (raw.mastery && raw.mastery.windowDays != null)
                ? Math.min(MASTERY_WINDOW_MAX, Math.max(1, parseInt(raw.mastery.windowDays, 10) || masteryWindowFor(frequency)))
                : masteryWindowFor(frequency),
        },
    };
}

function nodeCtx(userData) {
    const ctx = {
        dimIds: new Set((userData.dimensions || []).map((d) => d.id)),
        pathIds: new Set(),
        activityIds: new Set(collectActivities(userData).map((e) => e.act.id)),
        fallbackDim: (userData.dimensions || [])[0] ? userData.dimensions[0].id : 'uncategorized',
    };
    (userData.dimensions || []).forEach((d) => (d.paths || []).forEach((p) => ctx.pathIds.add(p.id)));
    return ctx;
}

function whyNowOf(raw) {
    return (raw && typeof raw.whyNow === 'string' && raw.whyNow.trim())
        ? raw.whyNow.trim().slice(0, 200) : null;
}

// Weekly load a node would add if fully accepted.
function nodeNewLoad(node) {
    if (node.payload.type !== 'activity' || node.payload.activityId) return 0;
    const f = node.payload.spec.frequency;
    return LOAD_WEIGHT[f] != null ? LOAD_WEIGHT[f] : 1;
}

// The load budget applies ONLY to nodes born available. Anchors cost 0; locked
// tiers are exempt. Drop the heaviest available suggestions until they fit.
function enforceLoadBudget(nodes) {
    const counted = nodes.filter((n) => n.lifecycle === 'available' && n.role !== 'anchor');
    let total = counted.reduce((s, n) => s + nodeNewLoad(n), 0);
    if (total <= LOAD_BUDGET_HEADROOM) return;
    const ranked = counted.slice().sort((a, b) => nodeNewLoad(b) - nodeNewLoad(a));
    for (const n of ranked) {
        if (total <= LOAD_BUDGET_HEADROOM) break;
        const load = nodeNewLoad(n);
        if (load <= 0) continue;
        const idx = nodes.indexOf(n);
        if (idx !== -1) { nodes.splice(idx, 1); total -= load; }
    }
}

// Prerequisite cycle guard.
function reaches(fromId, targetId, byId, guard) {
    if (fromId === targetId) return true;
    if (guard[fromId]) return false;
    guard[fromId] = true;
    const n = byId[fromId];
    if (!n) return false;
    return (n.prerequisites || []).some((pr) => pr.type === 'node_mastered' && reaches(pr.nodeId, targetId, byId, guard));
}

// Lifecycle at birth: anchors -> active (resolved if the rolling window is
// already met); nodes with met prereqs and wildcards -> available; everything
// else -> locked. Mastery is the ONLY key — fusions included: a fusion with
// any unmastered source is born locked, exactly like a tier node.
function lifecycleAtBirth(node, actById, resolvedByAnchor) {
    if (node.role === 'anchor') return 'active';
    if (node.role === 'wildcard') return 'available';
    const met = (node.prerequisites || []).every((pr) => {
        if (pr.type === 'activity_mastered') {
            const act = actById[pr.activityId];
            if (!act) return false;
            return !!act.techTreeMasteredAt || rollingWindowMet(act);
        }
        if (pr.type === 'node_mastered') {
            // Within a fresh response only anchors can already be resolved.
            return !!resolvedByAnchor[pr.nodeId];
        }
        return true;
    });
    return met ? 'available' : 'locked';
}

// Build the web from a nested generate/add_goal/regenerate response.
// Returns { goals, nodes }.
function materializeWeb(parsed, userData, existingGoals, opts) {
    opts = opts || {};
    parsed = normalizeParsed(parsed);
    const ctx = nodeCtx(userData);
    const now = nowISO();
    const activities = collectActivities(userData);
    const actById = {};
    activities.forEach(({ act }) => { actById[act.id] = act; });
    const actDim = {};
    activities.forEach(({ act, dim }) => { actDim[act.id] = dim.id; });

    const goals = [];
    const usedExisting = {};
    // Colours belonging to threads this call is NOT rebuilding. A goal's
    // colour is its identity on the web, so one already wearing a colour keeps
    // it; only a brand-new goal draws from the palette, and it must not draw a
    // colour another thread is already using.
    const usedColors = {};
    (opts.reservedColors || []).forEach((c) => { if (c) usedColors[c] = true; });
    const positional = !!opts.positional;
    const cap = positional ? Math.max(1, existingGoals.length) : MAX_GOALS;

    const built = [];                  // { node, rawPrereqs }
    const byTitle = {};
    const anchorByActivity = {};       // activityId -> anchor node
    const resolvedByAnchor = {};       // anchor node id -> true if resolved at birth
    const goalOfActivity = {};         // activityId -> [goalIds] (via anchors)

    function claimColor(goal) {
        if (goal.color) { usedColors[goal.color] = true; return goal.color; }
        const c = GOAL_PALETTE.find((x) => !usedColors[x]) || GOAL_PALETTE[goals.length % GOAL_PALETTE.length];
        usedColors[c] = true;
        return c;
    }

    function addAnchor(activityId, goalId, whyNow) {
        const act = actById[activityId];
        if (!act) return null;
        let node = anchorByActivity[activityId];
        if (node) {
            if (goalId && node.goalIds.indexOf(goalId) === -1) node.goalIds.push(goalId);
            if (!node.whyNow && whyNow) node.whyNow = whyNow;
            return node;
        }
        const mastered = !!act.techTreeMasteredAt || rollingWindowMet(act);
        const th = masteryThresholdFor(act);
        node = {
            id: newId('ttn'), source: 'ai', createdAt: now,
            role: 'anchor', goalIds: goalId ? [goalId] : [],
            dimensionId: actDim[activityId] || ctx.fallbackDim,
            lifecycle: 'active',
            resolvedAt: mastered ? (act.techTreeMasteredAt || now) : null,
            resolvedVia: mastered ? 'mastery' : null,
            title: String(act.name || 'Activity').slice(0, 80),
            description: String(act.description || '').slice(0, 240),
            whyNow: whyNow || null,
            prerequisites: [],
            payload: {
                type: 'activity', activityId: activityId,
                spec: {
                    name: act.name, description: (act.description || '').slice(0, 240),
                    baseXP: act.baseXP || 10, frequency: act.frequency || 'weekly',
                    dimensionId: actDim[activityId] || ctx.fallbackDim, suggestedPathId: null,
                },
                mastery: { target: th.count, windowDays: th.windowDays },
            },
        };
        anchorByActivity[activityId] = node;
        if (node.resolvedAt) resolvedByAnchor[node.id] = true;
        built.push({ node, rawPrereqs: [] });
        byTitle[node.title.toLowerCase()] = node;
        return node;
    }

    function buildNode(nr, goalIds, role) {
        if (!nr || typeof nr.title !== 'string' || !nr.title.trim()) return null;
        const dimensionId = ctx.dimIds.has(nr.dimensionId) ? nr.dimensionId : ctx.fallbackDim;
        const payload = validatePayload(nr.payload, {
            dimIds: ctx.dimIds, pathIds: ctx.pathIds, activityIds: ctx.activityIds,
            fallbackDim: ctx.fallbackDim, title: nr.title, description: nr.description, dimensionId,
        });
        if (!payload) return null;
        const node = {
            id: newId('ttn'), source: 'ai', createdAt: now,
            role: role, goalIds: (goalIds || []).slice(),
            dimensionId,
            lifecycle: 'locked',                 // set properly after prereq resolution
            resolvedAt: null, resolvedVia: null,
            title: String(nr.title).trim().slice(0, 80),
            description: String(nr.description || '').slice(0, 240),
            whyNow: whyNowOf(nr),
            prerequisites: [],
            payload,
        };
        built.push({ node, rawPrereqs: Array.isArray(nr.prerequisites) ? nr.prerequisites : [] });
        byTitle[node.title.toLowerCase()] = node;
        return node;
    }

    // Goals + their anchors + their nodes.
    parsed.goals.slice(0, cap).forEach((gr, i) => {
        if (!gr || typeof gr !== 'object') return;
        let goal;
        if (positional) {
            goal = existingGoals[i] || existingGoals[existingGoals.length - 1] || null;
        } else {
            goal = gr.fromGoalId ? existingGoals.find((g) => g.id === gr.fromGoalId && !usedExisting[g.id]) : null;
        }
        if (goal) usedExisting[goal.id] = true;
        else {
            goal = {
                id: newId('goal'), rawText: '', createdAt: now, achievedAt: null,
                retiredAt: null, sharpenedEditedByUser: false, color: null, regeneratedAt: null,
            };
        }
        goal.sharpened = String(gr.sharpened || goal.rawText || 'Goal').slice(0, 200);
        goal.shortName = String(gr.shortName || goal.rawText || 'Goal').slice(0, 14);
        goal.kind = gr.kind === 'rhythm' ? 'rhythm' : 'destination';
        goal.kindReason = goal.kind === 'rhythm'
            ? (gr.kindReason ? String(gr.kindReason).slice(0, 200) : 'There is no finish line here — a way of living.')
            : null;
        if (!goal.rawText) goal.rawText = goal.sharpened;
        goal.color = claimColor(goal);
        goals.push(goal);

        (Array.isArray(gr.anchors) ? gr.anchors : []).slice(0, 5).forEach((a) => {
            if (!a || !a.activityId) return;
            const node = addAnchor(a.activityId, goal.id, whyNowOf(a));
            if (node) (goalOfActivity[a.activityId] = goalOfActivity[a.activityId] || []).push(goal.id);
        });
        (Array.isArray(gr.nodes) ? gr.nodes : []).forEach((nr) => {
            buildNode(nr, [goal.id], nr && nr.role === 'upgrade' ? 'upgrade' : 'suggestion');
        });
    });

    // Fusions: sources must be real activities in DIFFERENT dimensions.
    // goalIds = union of the source anchors' goals. Dishonest ones are dropped.
    parsed.fusions.slice(0, 2).forEach((fr) => {
        if (!fr || typeof fr !== 'object') return;
        const srcIds = (Array.isArray(fr.sourceActivityIds) ? fr.sourceActivityIds : []).filter((id) => actById[id]);
        const srcDims = Array.from(new Set(srcIds.map((id) => actDim[id])));
        if (srcIds.length < 2 || srcDims.length < 2) return;
        const goalIds = [];
        srcIds.forEach((id) => (goalOfActivity[id] || []).forEach((gid) => {
            if (goalIds.indexOf(gid) === -1) goalIds.push(gid);
        }));
        const node = buildNode(fr, goalIds, 'fusion');
        if (!node) return;
        // Ensure both sources are anchored so the fusion has visible roots.
        srcIds.slice(0, 2).forEach((id) => addAnchor(id, null, null));
        node.prerequisites = srcIds.slice(0, 2).map((id) => ({ type: 'activity_mastered', activityId: id }));
    });

    // Wildcards: 0-2, no goal, no prereqs, tiny load.
    parsed.wildcards.slice(0, 2).forEach((wr) => {
        if (!wr || typeof wr !== 'object') return;
        const node = buildNode(wr, [], 'wildcard');
        if (!node) return;
        node.payload.spec.baseXP = Math.min(WILDCARD_MAX_XP, node.payload.spec.baseXP);
        if (node.payload.spec.frequency === 'daily') node.payload.spec.frequency = 'weekly';
        node.prerequisites = [];
        node.lifecycle = 'available';
    });

    // Resolve prerequisites (drop unresolvable rather than guessing).
    built.forEach((b) => {
        b.rawPrereqs.forEach((pr) => {
            if (!pr || typeof pr !== 'object') return;
            if (pr.type === 'activity_mastered' && actById[pr.activityId]) {
                b.node.prerequisites.push({ type: 'activity_mastered', activityId: pr.activityId });
            } else if (pr.type === 'node_mastered') {
                const ref = pr.nodeTitle ? byTitle[String(pr.nodeTitle).toLowerCase()] : null;
                if (ref && ref.id !== b.node.id) b.node.prerequisites.push({ type: 'node_mastered', nodeId: ref.id });
            }
        });
    });

    // Cycle detection on prerequisite edges — drop the offending edge.
    const byId = {};
    built.forEach((b) => { byId[b.node.id] = b.node; });
    built.forEach((b) => {
        b.node.prerequisites = b.node.prerequisites.filter((pr) =>
            pr.type !== 'node_mastered' || !reaches(pr.nodeId, b.node.id, byId, {}));
    });

    // Lifecycle at birth, then the scoped load budget.
    const nodes = built.map((b) => b.node);
    nodes.forEach((n) => {
        if (n.role === 'anchor' || n.role === 'wildcard') return;
        n.lifecycle = lifecycleAtBirth(n, actById, resolvedByAnchor);
    });
    enforceLoadBudget(nodes);
    return { goals, nodes: nodes.slice(0, MAX_NODES) };
}

// Merge an incoming node set with kept old nodes: an incoming anchor for an
// activity that already has a node folds its goalIds into the existing node
// instead of duplicating it.
function mergeNodes(kept, incoming) {
    const anchorFor = {};
    kept.forEach((n) => { if (n.payload && n.payload.activityId) anchorFor[n.payload.activityId] = n; });
    const out = kept.slice();
    const idMap = {};      // incoming node id -> surviving node id
    incoming.forEach((n) => {
        const aid = n.payload && n.payload.activityId;
        if (aid && anchorFor[aid]) {
            const keep = anchorFor[aid];
            if (!Array.isArray(keep.goalIds)) keep.goalIds = [];
            (n.goalIds || []).forEach((gid) => { if (keep.goalIds.indexOf(gid) === -1) keep.goalIds.push(gid); });
            if (!keep.whyNow && n.whyNow) keep.whyNow = n.whyNow;
            if (!keep.role) keep.role = 'anchor';
            idMap[n.id] = keep.id;
            return;
        }
        if (aid) anchorFor[aid] = n;
        out.push(n);
    });
    // Re-point prerequisites at surviving node ids.
    out.forEach((n) => {
        (n.prerequisites || []).forEach((pr) => {
            if (pr.type === 'node_mastered' && idMap[pr.nodeId]) pr.nodeId = idMap[pr.nodeId];
        });
    });
    return out;
}

// Trim the least-committed first: locked suggestions from the back.
function enforceNodeCeiling(nodes) {
    if (nodes.length <= MAX_NODES) return nodes;
    const overflow = nodes.length - MAX_NODES;
    let dropped = 0;
    for (let i = nodes.length - 1; i >= 0 && dropped < overflow; i--) {
        const n = nodes[i];
        if (!n.resolvedAt && n.lifecycle !== 'active' && n.role !== 'anchor'
            && n.source !== 'user' && !n.revealed) {
            nodes.splice(i, 1); dropped++;
        }
    }
    return nodes;
}

/**
 * Fold a fresh generate/add_goal/regenerate result into the existing web.
 * Returns { goals, nodes, vision } — the caller hands it straight back to the
 * client, which is the only writer of users/{uid}.
 */
function foldGeneration(mode, techTree, built, parsedVision, scopedGoalId) {
    const oldNodes = techTree.nodes || [];
    let outGoals;
    let outNodes;

    if (mode === 'generate') {
        // A full rebuild replaces the frontier, but everything the user has
        // accepted, resolved OR paid Grit to reveal is immortal. Only
        // silhouettes are discarded.
        outGoals = built.goals.concat((techTree.goals || []).filter((g) => g.retiredAt));
        const goalIdSet = new Set(outGoals.map((g) => g.id));
        const survivors = oldNodes
            .filter((n) => n.resolvedAt || n.lifecycle === 'active' || n.revealed)
            .map((n) => Object.assign({}, n, { goalIds: (n.goalIds || []).filter((gid) => goalIdSet.has(gid)) }));
        outNodes = mergeNodes(survivors, built.nodes);
    } else if (mode === 'add_goal') {
        outGoals = techTree.goals || [];
        outNodes = mergeNodes(oldNodes, built.nodes);
    } else { // regenerate — one goal's unclaimed frontier only
        outGoals = techTree.goals || [];
        const kept = oldNodes.filter((n) => {
            const servesOnlyThis = (n.goalIds || []).length === 1 && n.goalIds[0] === scopedGoalId;
            return !servesOnlyThis || n.resolvedAt || n.lifecycle === 'active' || n.source === 'user';
        });
        outNodes = mergeNodes(kept, built.nodes);
    }

    outNodes.forEach(stampReveal);
    enforceNodeCeiling(outNodes);

    const out = { goals: outGoals, nodes: outNodes };
    if (parsedVision && (mode === 'generate' || !techTree.vision)) out.vision = parsedVision;
    return out;
}

/**
 * Materialize the nodes an expansion fans under one freshly mastered node.
 * Pure: takes the parsed model output, returns new nodes ready to append.
 */
function materializeExpansion(parsed, userData, techTree, resolved, existingTitles) {
    parsed = normalizeParsed(parsed);
    const ctx = nodeCtx(userData);
    const now = nowISO();
    const nodes = techTree.nodes || [];
    const activities = collectActivities(userData);
    const actById = {};
    activities.forEach(({ act }) => { actById[act.id] = act; });
    const actDim = {};
    activities.forEach(({ act, dim }) => { actDim[act.id] = dim.id; });

    const byTitle = {};
    nodes.forEach((n) => { byTitle[String(n.title).toLowerCase()] = n; });
    const seen = new Set(existingTitles.map((t) => String(t).toLowerCase()));

    const fanned = [];
    parsed.nodes.slice(0, 3).forEach((nr) => {
        if (!nr || typeof nr.title !== 'string' || !nr.title.trim()) return;
        if (seen.has(nr.title.trim().toLowerCase())) return;
        const dimensionId = ctx.dimIds.has(nr.dimensionId) ? nr.dimensionId : resolved.dimensionId;
        const payload = validatePayload(nr.payload, {
            dimIds: ctx.dimIds, pathIds: ctx.pathIds, activityIds: ctx.activityIds,
            fallbackDim: ctx.fallbackDim, title: nr.title, description: nr.description, dimensionId,
        });
        if (!payload) return;
        const role = ['upgrade', 'fusion', 'suggestion'].indexOf(nr.role) !== -1 ? nr.role : 'suggestion';
        const node = {
            id: newId('ttn'), source: 'ai', createdAt: now,
            role, goalIds: (resolved.goalIds || []).slice(),
            dimensionId,
            lifecycle: 'locked', resolvedAt: null, resolvedVia: null,
            title: String(nr.title).trim().slice(0, 80),
            description: String(nr.description || '').slice(0, 240),
            whyNow: whyNowOf(nr),
            prerequisites: [],
            payload,
        };
        // Expansion may attach prerequisites to real existing activities and
        // to already-existing nodes (by exact title).
        (Array.isArray(nr.prerequisites) ? nr.prerequisites : []).forEach((pr) => {
            if (!pr || typeof pr !== 'object') return;
            if (pr.type === 'activity_mastered' && actById[pr.activityId]) {
                node.prerequisites.push({ type: 'activity_mastered', activityId: pr.activityId });
            } else if (pr.type === 'node_mastered' && pr.nodeTitle) {
                const ref = byTitle[String(pr.nodeTitle).toLowerCase()];
                if (ref) node.prerequisites.push({ type: 'node_mastered', nodeId: ref.id });
            }
        });
        if (!node.prerequisites.length) {
            node.prerequisites = [{ type: 'node_mastered', nodeId: resolved.id }];
        }
        if (role === 'fusion') {
            // A fusion needs a live cross-dimensional co-source; if every
            // prereq sits in one dimension it is not an honest fusion.
            const dims = new Set(node.prerequisites.map((pr) =>
                (pr.type === 'activity_mastered' ? actDim[pr.activityId]
                    : (nodes.find((n) => n.id === pr.nodeId) || {}).dimensionId)));
            if (dims.size < 2) node.role = 'suggestion';
        }
        // Lifecycle: prereqs on the resolved node are met; fusions open when
        // their sources are alive.
        const met = node.prerequisites.every((pr) => {
            if (pr.type === 'activity_mastered') {
                const act = actById[pr.activityId];
                if (!act) return false;
                if (node.role === 'fusion') return true;
                return !!act.techTreeMasteredAt || rollingWindowMet(act);
            }
            const t = nodes.find((n) => n.id === pr.nodeId);
            if (node.role === 'fusion') return !!(t && (t.resolvedAt || t.lifecycle === 'active'));
            return !!(t && t.resolvedAt);
        });
        node.lifecycle = met ? 'available' : 'locked';
        fanned.push(node);
        seen.add(node.title.toLowerCase());
    });
    enforceLoadBudget(fanned);
    fanned.forEach(stampReveal);
    return fanned;
}

/** Materialize replenished wildcards from the dedicated wildcard call. */
function materializeWildcards(parsed, userData, slots, existingTitles) {
    parsed = normalizeParsed(parsed);
    const ctx = nodeCtx(userData);
    const now = nowISO();
    const out = [];
    const seen = new Set(existingTitles.map((t) => String(t).toLowerCase()));
    parsed.wildcards.slice(0, slots).forEach((wr) => {
        if (!wr || typeof wr.title !== 'string' || !wr.title.trim()) return;
        if (seen.has(wr.title.trim().toLowerCase())) return;
        const dimensionId = ctx.dimIds.has(wr.dimensionId) ? wr.dimensionId : ctx.fallbackDim;
        const payload = validatePayload(wr.payload, {
            dimIds: ctx.dimIds, pathIds: ctx.pathIds, activityIds: ctx.activityIds,
            fallbackDim: ctx.fallbackDim, title: wr.title, description: wr.description, dimensionId,
        });
        if (!payload) return;
        payload.spec.baseXP = Math.min(WILDCARD_MAX_XP, payload.spec.baseXP);
        if (payload.spec.frequency === 'daily') payload.spec.frequency = 'weekly';
        out.push(stampReveal({
            id: newId('ttn'), source: 'ai', createdAt: now,
            role: 'wildcard', goalIds: [], dimensionId,
            lifecycle: 'available', resolvedAt: null, resolvedVia: null,
            title: String(wr.title).trim().slice(0, 80),
            description: String(wr.description || '').slice(0, 240),
            whyNow: whyNowOf(wr), prerequisites: [], payload,
        }));
        seen.add(wr.title.trim().toLowerCase());
    });
    return out;
}

module.exports = {
    GOAL_PALETTE,
    MAX_GOALS,
    MAX_NODES,
    MIN_ACTIVITIES,
    MAX_TOKENS,
    REGEN_COOLDOWN_DAYS,
    VALID_MODES,
    activitySnapshot,
    buildExpandPrompt,
    buildGeneratePrompt,
    buildWildcardPrompt,
    collectActivities,
    cooldownLeft,
    foldGeneration,
    gateFor,
    liveNodes,
    materializeExpansion,
    materializeWeb,
    materializeWildcards,
    mergeNodes,
    rejectionStrings,
    rollingWindowMet,
    stampReveal,
    validatePayload,
    weeklyLoad,
};
