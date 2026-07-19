// ── Map generation worker — v3 "The Web" ────────────────────────────────────
// Runs on a GitHub Actions schedule (see .github/workflows/tech-tree-worker.yml).
// Picks up userData.techTree.pendingRequest flags written by the client, builds
// the prompt from the user's REAL Firestore data (never trusts client-supplied
// context), calls the model through the isolated adapter below, validates the
// response, writes the resulting goals/nodes back, and clears the flag.
// The worker is the sole authority on cooldowns and rate limits — a tampered
// client can write a request, but only this script decides whether it's honored.
//
// v3 (mindkraft-map-v3 spec):
//   - Activity-centric web: the user's REAL activities are ANCHORS; upgrades,
//     quests, fusions and wildcards grow out of them.
//   - Goals are coloured threads (goal.color), not containers. No lines,
//     stations, terminus or segments — edges derive from prerequisites.
//   - Node record: role anchor|upgrade|fusion|wildcard|suggestion, goalIds[],
//     whyNow, lifecycle at birth (§6).
//   - Request types: generate, add_goal (né add_line), expand, regenerate,
//     revise. Expansion also proposes quest absorption (link_activity).

const admin = require('firebase-admin');

// Lazy init so the pure validation/generation functions can be required in a
// unit test without a service account. main() calls initAdmin() before any I/O.
let db = null;
function initAdmin() {
    if (db) return;
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
    db = admin.firestore();
}

// Push is best-effort — a map that generated fine must never fail because a
// notification couldn't be sent. web-push is only wired up when VAPID keys are
// present (they already power scripts/send-reminders.js).
let webpush = null;
try {
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
        webpush = require('web-push');
        webpush.setVapidDetails(
            'mailto:' + (process.env.VAPID_CONTACT_EMAIL || 'admin@mindkraft.life'),
            process.env.VAPID_PUBLIC_KEY,
            process.env.VAPID_PRIVATE_KEY
        );
    }
} catch (e) {
    console.warn('web-push unavailable — map-ready notifications disabled:', e.message);
    webpush = null;
}

// ── Provider selection ─────────────────────────────────────────────────────
// NVIDIA's hosted NIM endpoint black-holes connections from GitHub-hosted
// runners (requests hang until timeout), so Groq — OpenAI-compatible API, free
// tier that works from Actions — is preferred whenever its key is configured.
// Both providers speak the chat-completions format, so everything outside this
// block is provider-agnostic. Secrets pasted into GitHub often carry a trailing
// newline — an invalid Authorization header makes undici fail with an opaque
// "fetch failed" — so every key is trimmed.
const PROVIDERS = [
    {
        name: 'anthropic',
        kind: 'anthropic', // native Messages API, not OpenAI-compatible
        key: (process.env.ANTHROPIC_API_KEY || '').trim(),
        base: 'https://api.anthropic.com',
        // Haiku, strictly: Sonnet's precision never justified its ~3-5x
        // token price for this feature, and quest reliability turned out to
        // be a prompt/validator problem, not a model-strength problem.
        // ANTHROPIC_MODEL pins this provider alone (TECH_TREE_MODEL applies
        // to every provider, so an Anthropic id there would poison the
        // others).
        model: process.env.ANTHROPIC_MODEL || process.env.TECH_TREE_MODEL || 'claude-haiku-4-5',
        fallbackModels: [],
        maxTokens: { generate: 7000, add_goal: 4500, expand: 2000, regenerate: 4500, revise: 2000, quest_patch: 1500 },
        keyHint: 'ANTHROPIC_API_KEY',
    },
    {
        name: 'gemini',
        key: (process.env.GEMINI_API_KEY || '').trim(),
        base: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: process.env.TECH_TREE_MODEL || 'gemini-2.5-flash',
        fallbackModels: ['gemini-2.0-flash'],
        maxTokens: { generate: 9000, add_goal: 6000, expand: 4000, regenerate: 6000, revise: 2500, quest_patch: 2500 },
        keyHint: 'GEMINI_API_KEY',
    },
    {
        name: 'groq',
        key: (process.env.GROQ_API_KEY || '').trim(),
        base: 'https://api.groq.com/openai/v1',
        model: process.env.TECH_TREE_MODEL || 'openai/gpt-oss-120b',
        fallbackModels: ['moonshotai/kimi-k2-instruct', 'llama-3.3-70b-versatile'],
        keyHint: 'GROQ_API_KEY',
    },
    {
        name: 'nvidia-nim',
        key: (process.env.NVIDIA_API_KEY || '').trim(),
        base: 'https://integrate.api.nvidia.com/v1',
        model: process.env.TECH_TREE_MODEL || 'meta/llama-3.3-70b-instruct',
        keyHint: 'NVIDIA_API_KEY',
    },
];
let _providerIdx = PROVIDERS.findIndex(p => p.key);
if (_providerIdx === -1) _providerIdx = 0;
let PROVIDER = PROVIDERS[_providerIdx];
function advanceProvider() {
    for (let i = _providerIdx + 1; i < PROVIDERS.length; i++) {
        if (PROVIDERS[i].key) {
            _providerIdx = i;
            PROVIDER = PROVIDERS[i];
            console.warn(`  Switching provider to '${PROVIDER.name}' (${PROVIDER.activeModel || PROVIDER.model})`);
            return true;
        }
    }
    return false;
}

// ── v3 constants ────────────────────────────────────────────────────────────
// Goal colour is goal identity. A fixed palette of 5 — the same web cannot
// legibly carry more than 5 goals.
const GOAL_PALETTE = ['#a8446e', '#5a9fd4', '#c98a3f', '#8a9a5b', '#7a6ff0'];
const LOAD_WEIGHT = { daily: 7, weekly: 1, biweekly: 0.5, monthly: 0.25, occasional: 0.25, 'one-time': 0.25 };
const LOAD_BUDGET_HEADROOM = 8;          // only nodes AVAILABLE at birth count (§6 LOAD RULE)
const MAX_GOALS = 5;
const MAX_NEW_ACTIVITIES_PER_QUEST = 3;  // hard cap, verbatim from v2
const MAX_NODES = 40;                    // hard ceiling across the whole web
const REGEN_COOLDOWN_DAYS = 30;          // per-goal regenerate cooldown
const REVISION_LIMIT = 3;
const WILDCARD_MAX_XP = 8;               // §8: wildcards ≤8 XP
const ACTIVITY_SNAPSHOT_CAP = 80;        // §6: raised from 60
const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'occasional'];

const MAX_TOKENS = { generate: 7000, add_goal: 4500, expand: 2000, regenerate: 4500, revise: 1800, quest_patch: 1500 };
function tokenBudget(type) {
    const t = type === 'add_line' ? 'add_goal' : type;
    return (PROVIDER.maxTokens && (PROVIDER.maxTokens[t] || PROVIDER.maxTokens.add_line)) || MAX_TOKENS[t] || 4000;
}

// ── Local date construction ─────────────────────────────────────────────────
// NEVER toISOString().slice(0,10) for a *date*. The worker runs in UTC, so a
// plain ISO timestamp is fine for createdAt/resolvedAt (instants, not dates).
function nowISO() { return new Date().toISOString(); }

// ── Helpers over the user's schema ─────────────────────────────────────────

function collectActivities(userData) {
    const out = [];
    (userData.dimensions || []).forEach(dim =>
        (dim.paths || []).forEach(path =>
            (path.activities || []).forEach(act => out.push({ act, dim, path }))));
    return out;
}

function activePathsAndDims(userData) {
    const dimensionList = (userData.dimensions || []).map(d => ({ dimensionId: d.id, name: d.name }));
    const pathList = [];
    (userData.dimensions || []).forEach(d =>
        (d.paths || []).forEach(p => pathList.push({ pathId: p.id, name: p.name, dimensionId: d.id })));
    return { dimensionList, pathList };
}

// Weekly load = sum of per-week weights over active activities.
function weeklyLoad(userData) {
    let sum = 0;
    collectActivities(userData).forEach(({ act }) => {
        if (act.archived || act.deleted) return;
        const f = act.frequency;
        if (f === 'custom') sum += customPerWeek(act);
        else sum += (LOAD_WEIGHT[f] != null ? LOAD_WEIGHT[f] : 1);
    });
    return Math.round(sum * 10) / 10;
}
function customPerWeek(act) {
    const n = act.customTimesPerWeek || act.timesPerWeek ||
        (Array.isArray(act.customDays) ? act.customDays.length : 0);
    return n > 0 ? Math.min(7, n) : 3;
}

// "Clean cycle" — a sealed cycle that actually completed its required items.
function cleanCycleCount(p) {
    return ((p && p.cycleHistory) || []).filter(c =>
        c && c.itemsTotal > 0 && c.itemsCompleted >= c.itemsTotal).length;
}

// ROLLING WINDOW mastery check (§3): count completions within the trailing
// windowDays from today. 87 completions ending six months ago must NOT
// resolve a 30-day-window mastery. windowDays null = lifetime count.
// Horizons stay human: a node should clear in ~2-3 months. Dailies get a
// roomier window (reps come fast); weekly/monthly must never stretch half a
// year just to unlock the next tier.
const MASTERY_TARGET_BY_FREQ = { daily: 15, weekly: 6, biweekly: 3, monthly: 2, occasional: 3 };
const MASTERY_WINDOW_BY_FREQ = { daily: 45, weekly: 90, biweekly: 90, monthly: 90, occasional: null };
const MASTERY_WINDOW_MAX = 120;
function masteryTargetFor(freq) { return MASTERY_TARGET_BY_FREQ[freq] || 6; }
function masteryWindowFor(freq) { return MASTERY_WINDOW_BY_FREQ[freq] !== undefined ? MASTERY_WINDOW_BY_FREQ[freq] : 90; }
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
    const k = (act.completionHistory || []).filter(ev => {
        if (!ev || ev.isPenalty || (ev.xp || 0) <= 0) return false;
        return cutoff === null || new Date(ev.date).getTime() >= cutoff;
    }).length;
    return k >= target;
}

function newId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Server-side v2 → v3 shape guard ────────────────────────────────────────
// Mirrors the client migration (idempotent, non-destructive) so the worker
// can safely process a request written by an old cached client against a v2
// doc. Persisted by whichever write follows.
function ensureV3Shape(techTree) {
    if (!techTree || techTree.schemaVersion === 3) return techTree;
    const lines = Array.isArray(techTree.lines) ? techTree.lines : [];
    const lineById = {};
    lines.forEach(l => { if (l && l.id) lineById[l.id] = l; });
    (techTree.goals || []).forEach(g => {
        if (g.color) return;
        const line = lines.find(l => l.goalId === g.id);
        if (line && line.color) g.color = line.color;
    });
    const used = {};
    (techTree.goals || []).forEach(g => { if (g.color) used[g.color] = true; });
    (techTree.goals || []).forEach((g, i) => {
        if (g.color) return;
        g.color = GOAL_PALETTE.find(c => !used[c]) || GOAL_PALETTE[i % GOAL_PALETTE.length];
        used[g.color] = true;
    });
    lines.forEach(l => {
        if (!l || !l.regeneratedAt) return;
        const g = (techTree.goals || []).find(x => x.id === l.goalId);
        if (g && !g.regeneratedAt) g.regeneratedAt = l.regeneratedAt;
    });
    (techTree.nodes || []).forEach(n => {
        if (!Array.isArray(n.goalIds)) {
            const line = n.lineId ? lineById[n.lineId] : null;
            n.goalIds = (line && line.goalId) ? [line.goalId] : [];
            if (n.interchange && Array.isArray(n.interchange.lineIds)) {
                n.interchange.lineIds.forEach(lid => {
                    const l2 = lineById[lid];
                    if (l2 && l2.goalId && n.goalIds.indexOf(l2.goalId) === -1) n.goalIds.push(l2.goalId);
                });
            }
        }
        if (!n.role) n.role = (n.payload && n.payload.activityId) ? 'anchor' : 'suggestion';
        if (n.whyNow === undefined) n.whyNow = null;
        if (!n.dimensionId) n.dimensionId = 'uncategorized';
        if (!Array.isArray(n.prerequisites)) n.prerequisites = [];
        delete n.lineId; delete n.segmentIndex; delete n.isTerminus;
        delete n.interchange; delete n.parentNodeId;
    });
    delete techTree.lines; delete techTree.northStarLineId;
    delete techTree.connections; delete techTree.mergeSuggestion;
    techTree.schemaVersion = 3;
    return techTree;
}

// ── Cooldown / gate enforcement ─────────────────────────────────────────────

function canProcessRequest(req, techTree, userData) {
    const activities = collectActivities(userData);
    const goals = (techTree.goals || []).filter(g => !g.retiredAt);
    const type = req.type === 'add_line' ? 'add_goal' : req.type;

    if (type === 'generate') {
        if (!goals.length) return 'No goals set — add a goal first.';
        if (activities.length < 3) return 'Need at least 3 active activities.';
        return null;
    }
    if (type === 'add_goal') {
        const goal = goals.find(g => g.id === (req.payload && req.payload.goalId));
        if (!goal) return 'That goal no longer exists.';
        if (goals.length > MAX_GOALS) return 'The web can hold at most ' + MAX_GOALS + ' goals.';
        return null;
    }
    if (type === 'expand') {
        const ids = (req.payload && req.payload.resolvedNodeIds) || (req.payload && req.payload.nodeIds) || [];
        const some = (techTree.nodes || []).some(n => ids.indexOf(n.id) !== -1 && n.resolvedAt);
        // Auto-growth passes may arrive without ids — the worker picks its
        // own sources (recent resolutions, absorption, wildcard refills).
        if (!some && !(req.payload && req.payload.auto)) return 'Nothing to expand from.';
        return null;
    }
    if (type === 'regenerate') {
        const goalId = req.payload && (req.payload.goalId || null);
        let goal = goalId ? goals.find(g => g.id === goalId) : null;
        // Legacy v2 clients send lineId; the line is gone post-migration, so
        // fall back to the first goal rather than stranding the request.
        if (!goal && req.payload && req.payload.lineId) goal = goals[0];
        if (!goal) return 'That goal no longer exists.';
        const last = goal.regeneratedAt || techTree.lastGeneratedAt;
        if (last) {
            const ageDays = (Date.now() - new Date(last).getTime()) / 86400000;
            if (ageDays < REGEN_COOLDOWN_DAYS)
                return 'This thread was rewoven recently — free again in ' +
                    Math.ceil(REGEN_COOLDOWN_DAYS - ageDays) + ' days.';
        }
        return null;
    }
    if (type === 'revise') {
        if ((techTree.revisionsUsed || 0) >= REVISION_LIMIT) return 'Revision limit reached.';
        if (!req.payload || !String(req.payload.note || '').trim()) return 'Revision needs a correction note.';
        return null;
    }
    if (type === 'quest_patch') return null;
    return 'Unknown request type.';
}

// ── Prompt building ─────────────────────────────────────────────────────────

// lean=true drops descriptions/streaks — expansion calls run every few days
// and only need names + mastery state, so the fat snapshot was pure input
// cost there.
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
    return (techTree.rejections || []).slice(-40).map(r =>
        r.nodeTitle + ' (' + (r.reason || 'rejected') + (r.role ? ' · ' + r.role : '') + ')');
}

// The user's own XP scale — suggestions should feel native to it, not like
// they came from a different economy.
function typicalXP(userData) {
    const xs = collectActivities(userData)
        .filter(({ act }) => !act.archived && !act.deleted)
        .map(({ act }) => act.baseXP || 0).filter(x => x > 0).sort((a, b) => a - b);
    if (!xs.length) return { average: 10, p25: 8, p75: 15 };
    const avg = Math.round(xs.reduce((s, x) => s + x, 0) / xs.length);
    const q = p => xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
    return { average: avg, p25: q(0.25), p75: q(0.75) };
}

const PAYLOAD_RULES = `
PAYLOAD SHAPES (copy these EXACTLY):
activity — a durable practice with its own streak:
 {"type":"activity","spec":{"name":str,"description":str,"baseXP":1..50,
  "frequency":"daily|weekly|biweekly|monthly|occasional","dimensionId":str},
  "mastery":{"target":int,"windowDays":int|null}}
quest — a few steps that only mean something together. A simple flat
checklist is a GOOD quest:
 {"type":"quest","spec":{"name":str,"emoji":str,"description":str,
  "cadence":{"type":"oneoff"|"recurring"},
  "groups":[{"kind":"group","name":str,"ordered":bool,"repeat":1,"children":[LEAF,...]}]},
  "resolveRule":{"cleanCycles":4}}      // resolveRule ONLY when recurring
LEAF, pick per step:
 reuses a real activity: {"kind":"leaf","type":"activity","linkedActivityId":"<real activityId>","resetMode":"per-cycle","requiredCount":1}
 one-off step:           {"kind":"leaf","type":"task","name":str,"resetMode":"once","requiredCount":1}
 new practice (max ${MAX_NEW_ACTIVITIES_PER_QUEST}/quest): {"kind":"leaf","type":"activity","spec":{"name":str,"baseXP":1..50,"frequency":str,"dimensionId":str},"resetMode":"per-cycle","requiredCount":1}
Prefer linked leaves (what the user already does) and task leaves.`;

function buildGeneratePrompt(userData, opts) {
    const techTree = userData.techTree;
    const { dimensionList, pathList } = activePathsAndDims(userData);
    const goals = (techTree.goals || []).filter(g => !g.retiredAt)
        .filter(g => !opts.goalIds || opts.goalIds.indexOf(g.id) !== -1)
        .map(g => ({ goalId: g.id, rawText: g.rawText, sharpened: g.sharpened || null, kind: g.kind || null }));

    const load = weeklyLoad(userData);
    const xp = typicalXP(userData);
    const userNodes = (techTree.nodes || []).filter(n => n.source === 'user').map(n => n.title);
    const resolvedTitles = (techTree.nodes || []).filter(n => n.resolvedAt).map(n => n.title);

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

4. QUESTS — 0-2 in the WHOLE response, not per goal. Only where a few steps
   genuinely belong together; a simple checklist whose leaves link real
   anchor activityIds is ideal (payload type "quest" below, in the most
   relevant goal's "nodes"). Skip freely if none fits.

5. FUSIONS — top-level "fusions": 0-2. A pair of anchors from DIFFERENT
   dimensions whose combination is so natural anyone would nod (a walking
   phone call, cooking for friends). If the connection needs explaining,
   drop it — never force one. {"title","description","whyNow":null,
   "dimensionId","sourceActivityIds":[id,id],"payload"}. A fusion only
   unlocks once BOTH sources are mastered.

6. WILDCARD — top-level "wildcards": exactly 1. No goal, no prerequisites,
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
                 "payload": <activity|quest payload> }] }],
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
    if (opts.mode === 'revise') {
        input._mode = 'REVISION: the user flagged the node(s) in _nodesToRevise with feedback in _note. Return replacement node(s) in the goal\'s "nodes" array that directly address the feedback (not a light reword), following every rule. Do not emit anchors, fusions or wildcards.';
        input._nodesToRevise = opts.nodesToRevise || [];
        input._note = String(opts.note || '').slice(0, 240);
    }
    return { system, user: 'INPUT:\n' + JSON.stringify(input) };
}

// Expansion prompt (§6.1): fan 2-3 nodes under a freshly mastered thing.
// Explicitly allowed to propose new fusions using the mastered node as one
// source, and to attach prerequisites to real existing activities.
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

Output ONLY: { "nodes":[{ "role":"upgrade"|"fusion"|"quest"|"suggestion",
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

// ── Model adapter ────────────────────────────────────────────────────────────
function describeError(err) {
    const parts = [];
    let e = err;
    for (let i = 0; e && i < 5; i++) {
        parts.push(e.code ? `${e.message} [${e.code}]` : e.message);
        e = e.cause;
    }
    return parts.join(' ← ');
}
function isNetworkError(err) {
    return err && (err.message === 'fetch failed'
        || err.name === 'TimeoutError' || err.name === 'AbortError'
        || (err.cause && err.cause.code));
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
// Full v3 generations (mandatory quest JSON, ~8-9k output tokens) can run
// well past two minutes of wall-clock on Sonnet-class models. The Anthropic
// path therefore STREAMS: the call only dies if the stream stalls for
// IDLE_TIMEOUT_MS or exceeds the hard TOTAL cap — never on healthy, slow
// generation. OpenAI-compatible providers (fast flash/groq models) keep a
// plain non-streaming timeout.
const FETCH_TIMEOUT_MS = 120000;
const STREAM_IDLE_TIMEOUT_MS = 60000;
const STREAM_TOTAL_TIMEOUT_MS = 420000;
function timeoutError(msg) {
    const err = new Error(msg);
    err.name = 'TimeoutError';
    return err;
}

async function callModel(prompt, maxTokens) {
    if (!PROVIDER.key) {
        throw new Error(PROVIDER.keyHint + ' secret is missing or empty — add it under repo Settings → Secrets and variables → Actions');
    }
    async function once(tokens) {
        if (PROVIDER.kind === 'anthropic') {
            // Streamed SSE call: abort on a stalled stream, not on duration.
            const controller = new AbortController();
            let idleTimer = null;
            const totalTimer = setTimeout(() => controller.abort(timeoutError('model stream exceeded ' + (STREAM_TOTAL_TIMEOUT_MS / 1000) + 's total')), STREAM_TOTAL_TIMEOUT_MS);
            const bumpIdle = () => {
                if (idleTimer) clearTimeout(idleTimer);
                idleTimer = setTimeout(() => controller.abort(timeoutError('model stream stalled >' + (STREAM_IDLE_TIMEOUT_MS / 1000) + 's')), STREAM_IDLE_TIMEOUT_MS);
            };
            bumpIdle();
            try {
                const res = await fetch(PROVIDER.base + '/v1/messages', {
                    method: 'POST',
                    signal: controller.signal,
                    headers: {
                        'x-api-key': PROVIDER.key,
                        'anthropic-version': '2023-06-01',
                        'Content-Type': 'application/json',
                        'Accept': 'text/event-stream',
                    },
                    body: JSON.stringify({
                        model: PROVIDER.activeModel || PROVIDER.model,
                        max_tokens: tokens,
                        temperature: 0.6,
                        system: prompt.system,
                        messages: [{ role: 'user', content: prompt.user }],
                        stream: true,
                    }),
                });
                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    throw new Error(`Model API error ${res.status}: ${text.slice(0, 300)}`);
                }
                const reader = res.body.getReader();
                const decoder = new TextDecoder();
                let buf = '', text = '', stopReason = null;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    bumpIdle();
                    buf += decoder.decode(value, { stream: true });
                    let nl;
                    while ((nl = buf.indexOf('\n')) !== -1) {
                        const line = buf.slice(0, nl).trim();
                        buf = buf.slice(nl + 1);
                        if (!line.startsWith('data:')) continue;
                        const payload = line.slice(5).trim();
                        if (!payload || payload === '[DONE]') continue;
                        let ev;
                        try { ev = JSON.parse(payload); } catch (e) { continue; }
                        if (ev.type === 'content_block_delta' && ev.delta && typeof ev.delta.text === 'string') text += ev.delta.text;
                        else if (ev.type === 'message_delta' && ev.delta && ev.delta.stop_reason) stopReason = ev.delta.stop_reason;
                        else if (ev.type === 'error') throw new Error('Model stream error: ' + JSON.stringify(ev.error || ev).slice(0, 300));
                    }
                }
                if (!text) throw new Error('Model returned no content');
                return { content: text, finishReason: stopReason === 'max_tokens' ? 'length' : (stopReason || 'stop') };
            } finally {
                clearTimeout(totalTimer);
                if (idleTimer) clearTimeout(idleTimer);
            }
        }
        const res = await fetch(PROVIDER.base + '/chat/completions', {
            method: 'POST',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: {
                'Authorization': 'Bearer ' + PROVIDER.key,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify(Object.assign({
                model: PROVIDER.activeModel || PROVIDER.model,
                messages: [
                    { role: 'system', content: prompt.system },
                    { role: 'user', content: prompt.user },
                ],
                temperature: 0.6,
                top_p: 0.9,
                max_tokens: tokens,
            }, /^openai\/gpt-oss/.test(PROVIDER.activeModel || PROVIDER.model)
                ? { reasoning_effort: 'low' } : {})),
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Model API error ${res.status}: ${text.slice(0, 300)}`);
        }
        const data = await res.json();
        const choice = data.choices && data.choices[0];
        if (!choice || !choice.message) throw new Error('Model returned no choices');
        return { content: choice.message.content, finishReason: choice.finish_reason };
    }

    async function onceWithRetry(tokens) {
        let lastErr, currentTokens = tokens, netAttempts = 0;
        for (let attempt = 1; attempt <= 6; attempt++) {
            try {
                return await once(currentTokens);
            } catch (err) {
                lastErr = err;
                const msg = err.message || '';
                const modelProblem = /Model API error (400|404)/.test(msg) && /model/i.test(msg);
                const quotaProblem = /Model API error 429/.test(msg) && /quota|billing/i.test(msg);
                if (modelProblem || quotaProblem) {
                    const chain = PROVIDER.fallbackModels || (PROVIDER.fallbackModel ? [PROVIDER.fallbackModel] : []);
                    const current = PROVIDER.activeModel || PROVIDER.model;
                    const next = chain[chain.indexOf(current) + 1] || (current === PROVIDER.model ? chain[0] : null);
                    if (next) {
                        console.warn(`  Model '${current}' ${quotaProblem ? 'out of quota' : 'unavailable'} — falling back to '${next}'`);
                        PROVIDER.activeModel = next;
                        continue;
                    }
                    if (advanceProvider()) continue;
                    if (quotaProblem) throw new Error('All configured model providers are out of quota — try again later or add a paid key. ' + describeError(err));
                }
                if (/Model API error 413/.test(msg)) {
                    const fit = msg.match(/Limit (\d+), Requested (\d+)/);
                    let next;
                    if (fit) {
                        const promptCost = parseInt(fit[2], 10) - currentTokens;
                        next = parseInt(fit[1], 10) - promptCost - 200;
                    } else {
                        next = Math.floor(currentTokens * 0.6);
                    }
                    if (next >= 900 && next < currentTokens) {
                        currentTokens = next;
                        console.warn(`  413 request-too-large — retrying with max_tokens=${currentTokens}`);
                        continue;
                    }
                    if (attempt < 6) {
                        console.warn('  413 with no room left this minute — waiting 30s');
                        await sleep(30000);
                        continue;
                    }
                }
                if (/Model API error 429/.test(msg) && attempt < 6) {
                    console.warn('  429 rate-limited — waiting 20s');
                    await sleep(20000);
                    continue;
                }
                if (!isNetworkError(err)) throw err;
                netAttempts++;
                // Two straight timeouts on one provider — try the next one
                // before giving up on the whole request.
                if (netAttempts === 2 && advanceProvider()) {
                    console.warn(`  Repeated network trouble (${describeError(err)}) — switching provider`);
                    netAttempts = 0;
                    continue;
                }
                if (netAttempts >= 3) break;
                console.warn(`  Network error (attempt ${netAttempts}/3): ${describeError(err)}`);
                await sleep(2000 * netAttempts);
            }
        }
        throw new Error('Model request kept failing: ' + describeError(lastErr));
    }

    let result = await onceWithRetry(maxTokens);
    if (result.finishReason === 'length') {
        console.warn('finish_reason=length — retrying with higher max_tokens');
        result = await onceWithRetry(Math.min(12000, Math.ceil(maxTokens * 2)));
        if (result.finishReason === 'length') throw new Error('Model output truncated twice — giving up this run');
    }
    return result.content;
}

// ── Response parsing ─────────────────────────────────────────────────────────
function parseModelJson(raw) {
    let text = String(raw).trim();
    text = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
    const objStart = text.indexOf('{');
    if (objStart === -1) throw new Error('No JSON object in model output');
    const parsed = JSON.parse(text.slice(objStart, text.lastIndexOf('}') + 1));
    return {
        vision: typeof parsed.vision === 'string' ? parsed.vision.trim().slice(0, 300) : null,
        goals: Array.isArray(parsed.goals) ? parsed.goals : [],
        fusions: Array.isArray(parsed.fusions) ? parsed.fusions : [],
        wildcards: Array.isArray(parsed.wildcards) ? parsed.wildcards : [],
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],           // expand
        proposals: Array.isArray(parsed.proposals) ? parsed.proposals : [], // absorption
    };
}

// ── Payload validation ──────────────────────────────────────────────────────
// Returns a schema-valid payload, or null to drop the node. Enforces the quest
// group/leaf shape verbatim and the 3-new-activity cap (excess -> tasks).
function validatePayload(raw, ctx) {
    if (!raw || typeof raw !== 'object') return null;
    const dimOK = id => ctx.dimIds.has(id);
    const dimOf = id => (dimOK(id) ? id : ctx.fallbackDim);

    if (raw.type === 'activity') {
        const s = raw.spec || {};
        const frequency = VALID_FREQUENCIES.indexOf(s.frequency) !== -1 ? s.frequency : 'weekly';
        return {
            type: 'activity',
            activityId: null,
            spec: {
                name: String(s.name || ctx.title).trim().slice(0, 80),
                description: String(s.description || ctx.description || '').slice(0, 240),
                baseXP: Math.min(50, Math.max(1, parseInt(s.baseXP, 10) || 10)),
                frequency,
                dimensionId: dimOf(s.dimensionId || ctx.dimensionId),
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

    if (raw.type === 'quest') {
        // Lenient on the envelope: models (Haiku especially) drop the "spec"
        // wrapper or put leaves where groups belong. Repair instead of
        // silently discarding the whole quest — that discard was why quests
        // "never generated".
        const s = raw.spec || raw;
        const counter = { newActs: 0 };
        const rawGroups = Array.isArray(s.groups) ? s.groups
            : (Array.isArray(raw.groups) ? raw.groups : []);
        const looksLeaf = x => x && typeof x === 'object' && x.kind !== 'group'
            && (x.kind === 'leaf' || x.type || x.linkedActivityId);
        const groupsIn = [], looseLeaves = [];
        rawGroups.forEach(x => {
            if (x && typeof x === 'object' && x.kind === 'group') groupsIn.push(x);
            else if (looksLeaf(x)) looseLeaves.push(x);
        });
        if (looseLeaves.length) {
            groupsIn.push({ kind: 'group', name: 'Steps', ordered: false, repeat: 1, children: looseLeaves });
        }
        const groups = groupsIn.map(g => validateGroup(g, ctx, counter)).filter(Boolean);
        if (!groups.length) return null;                    // every quest needs ≥1 valid group
        const cadence = s.cadence || raw.cadence;
        const cadType = (cadence && cadence.type === 'recurring') ? 'recurring' : 'oneoff';
        const payload = {
            type: 'quest',
            projectId: null,
            spec: {
                name: String(s.name || ctx.title).trim().slice(0, 80),
                emoji: String(s.emoji || '🎯').slice(0, 8),
                description: String(s.description || ctx.description || '').slice(0, 240),
                cadence: { type: cadType },
                groups,
            },
        };
        if (cadType === 'recurring') {
            payload.resolveRule = { cleanCycles: Math.min(12, Math.max(1, parseInt((raw.resolveRule || s.resolveRule || {}).cleanCycles, 10) || 4)) };
        }
        return payload;
    }

    if (raw.type === 'challenge') {
        const s = raw.spec || {};
        const targets = {};
        Object.keys(s.activityTargets || {}).forEach(id => {
            if (ctx.activityIds.has(id)) targets[id] = Math.min(100, Math.max(1, parseInt(s.activityTargets[id], 10) || 1));
        });
        if (!Object.keys(targets).length) return null;
        return {
            type: 'challenge',
            challengeId: null,
            spec: {
                name: String(s.name || ctx.title).trim().slice(0, 80),
                description: String(s.description || ctx.description || '').slice(0, 200),
                durationDays: Math.min(180, Math.max(7, parseInt(s.durationDays, 10) || 30)),
                activityTargets: targets,
            },
        };
    }
    return null;
}

// Recursively validate a quest group. Mutates counter.newActs to enforce the
// 3-new-activity cap (excess new-activity leaves are demoted to tasks).
function validateGroup(g, ctx, counter) {
    if (!g || typeof g !== 'object') return null;
    if (g.kind === 'leaf' || g.type) return null; // a bare leaf at group position — skip
    const children = (Array.isArray(g.children) ? g.children : [])
        .map(c => (c && c.kind === 'group') ? validateGroup(c, ctx, counter) : validateLeaf(c, ctx, counter))
        .filter(Boolean);
    if (!children.length) return null;             // every group has ≥1 child
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
    const req = Math.max(1, parseInt(l.requiredCount, 10) || 1);
    const resetMode = l.resetMode === 'once' ? 'once' : 'per-cycle';
    let type = l.type === 'activity' ? 'activity' : 'task';

    if (type === 'activity') {
        if (l.linkedActivityId && ctx.activityIds.has(l.linkedActivityId)) {
            // Links an existing activity — no new activity, no cap cost.
            return {
                id: newId('lf'), kind: 'leaf', type: 'activity', linkedActivityId: l.linkedActivityId,
                name: '', resetMode, requiredCount: req, completedCount: 0, _promotable: null,
            };
        }
        // A NEW activity leaf needs a usable spec; count it against the cap.
        const spec = l.spec || {};
        if (counter.newActs >= MAX_NEW_ACTIVITIES_PER_QUEST) {
            type = 'task'; // truncate the excess to tasks
        } else if (spec && (spec.baseXP || spec.frequency || spec.dimensionId || l.name)) {
            counter.newActs++;
            return {
                id: newId('lf'), kind: 'leaf', type: 'activity', linkedActivityId: null,
                name: '', resetMode, requiredCount: req, completedCount: 0,
                spec: {
                    name: String(spec.name || l.name || 'Practice').slice(0, 80),
                    baseXP: Math.min(50, Math.max(1, parseInt(spec.baseXP, 10) || 8)),
                    frequency: VALID_FREQUENCIES.indexOf(spec.frequency) !== -1 ? spec.frequency : 'weekly',
                    dimensionId: ctx.dimIds.has(spec.dimensionId) ? spec.dimensionId : ctx.fallbackDim,
                },
                _promotable: null,
            };
        } else {
            type = 'task';
        }
    }
    // task leaf — requires a non-empty name
    const name = String(l.name || '').trim();
    if (!name) return null;
    const promo = l._promotable && typeof l._promotable === 'object' ? {
        baseXP: Math.min(50, Math.max(1, parseInt(l._promotable.baseXP, 10) || 8)),
        frequency: VALID_FREQUENCIES.indexOf(l._promotable.frequency) !== -1 ? l._promotable.frequency : 'weekly',
        dimensionId: ctx.dimIds.has(l._promotable.dimensionId) ? l._promotable.dimensionId : ctx.fallbackDim,
    } : null;
    return {
        id: newId('lf'), kind: 'leaf', type: 'task', linkedActivityId: null,
        name: name.slice(0, 80), resetMode, requiredCount: req, completedCount: 0, _promotable: promo,
    };
}

// ── v3 materialization ──────────────────────────────────────────────────────
// Turns the model's nested output into schema-valid v3 nodes. Drops individual
// bad nodes, never the whole response.
function nodeCtx(userData) {
    const ctx = {
        dimIds: new Set((userData.dimensions || []).map(d => d.id)),
        pathIds: new Set(),
        activityIds: new Set(collectActivities(userData).map(e => e.act.id)),
        fallbackDim: (userData.dimensions || [])[0] ? userData.dimensions[0].id : 'uncategorized',
    };
    (userData.dimensions || []).forEach(d => (d.paths || []).forEach(p => ctx.pathIds.add(p.id)));
    return ctx;
}

function whyNowOf(raw) {
    return (raw && typeof raw.whyNow === 'string' && raw.whyNow.trim())
        ? raw.whyNow.trim().slice(0, 200) : null;
}

// Weekly load a node would add if fully accepted.
function nodeNewLoad(node) {
    let load = 0;
    const w = f => (LOAD_WEIGHT[f] != null ? LOAD_WEIGHT[f] : 1);
    if (node.payload.type === 'activity' && !node.payload.activityId) {
        load += w(node.payload.spec.frequency);
    } else if (node.payload.type === 'quest') {
        (function walk(children) {
            (children || []).forEach(c => {
                if (c.kind === 'group') walk(c.children);
                else if (c.type === 'activity' && !c.linkedActivityId && c.spec) load += w(c.spec.frequency);
            });
        })(node.payload.spec.groups);
    }
    return load;
}

// The load budget applies ONLY to nodes born available (§6 LOAD RULE).
// Anchors cost 0; locked tiers are exempt. Drop the heaviest available
// suggestions until the additions fit.
function enforceLoadBudget(nodes) {
    const counted = nodes.filter(n => n.lifecycle === 'available' && n.role !== 'anchor');
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
    return (n.prerequisites || []).some(pr => pr.type === 'node_mastered' && reaches(pr.nodeId, targetId, byId, guard));
}

// Lifecycle at birth (§6): anchors -> active (resolved if rolling window
// already met); nodes with met prereqs and wildcards -> available; everything
// else -> locked. Mastery is the ONLY key — fusions included: a fusion with
// any unmastered source is born locked, exactly like a tier node.
function lifecycleAtBirth(node, actById, resolvedByAnchor) {
    if (node.role === 'anchor') return 'active';
    if (node.role === 'wildcard') return 'available';
    const met = (node.prerequisites || []).every(pr => {
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

// Build the full web from a nested generate/add_goal/regenerate/revise
// response. Returns { goals, nodes }.
function materializeWeb(parsed, userData, existingGoals, opts) {
    opts = opts || {};
    const ctx = nodeCtx(userData);
    const now = nowISO();
    const activities = collectActivities(userData);
    const actById = {};
    activities.forEach(({ act }) => { actById[act.id] = act; });
    const actDim = {};
    activities.forEach(({ act, dim }) => { actDim[act.id] = dim.id; });

    const goals = [];
    const usedExisting = {};
    const usedColors = {};
    (opts.keepColorsOf || []).forEach(g => { if (g.color) usedColors[g.color] = true; });
    const positional = !!opts.positional;
    const cap = positional ? Math.max(1, existingGoals.length) : MAX_GOALS;

    const built = [];                  // { node, rawPrereqs }
    const byTitle = {};
    const anchorByActivity = {};       // activityId -> anchor node
    const resolvedByAnchor = {};       // anchor node id -> true if resolved at birth
    const goalOfActivity = {};         // activityId -> [goalIds] (via anchors)

    function nextColor(pref) {
        if (pref && !usedColors[pref]) { usedColors[pref] = true; return pref; }
        const c = GOAL_PALETTE.find(x => !usedColors[x]) || GOAL_PALETTE[goals.length % GOAL_PALETTE.length];
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
    (parsed.goals || []).slice(0, cap).forEach((gr, i) => {
        if (!gr || typeof gr !== 'object') return;
        let goal;
        if (positional) {
            goal = existingGoals[i] || existingGoals[existingGoals.length - 1] || null;
        } else {
            goal = gr.fromGoalId ? existingGoals.find(g => g.id === gr.fromGoalId && !usedExisting[g.id]) : null;
        }
        if (goal) usedExisting[goal.id] = true;
        else goal = { id: newId('goal'), rawText: '', createdAt: now, achievedAt: null, retiredAt: null, sharpenedEditedByUser: false, color: null, regeneratedAt: null };
        goal.sharpened = String(gr.sharpened || goal.rawText || 'Goal').slice(0, 200);
        goal.shortName = String(gr.shortName || goal.rawText || 'Goal').slice(0, 14);
        goal.kind = gr.kind === 'rhythm' ? 'rhythm' : 'destination';
        goal.kindReason = goal.kind === 'rhythm' ? (gr.kindReason ? String(gr.kindReason).slice(0, 200) : 'There is no finish line here — a way of living.') : null;
        if (!goal.rawText) goal.rawText = goal.sharpened;
        goal.color = nextColor(goal.color);
        goals.push(goal);

        (Array.isArray(gr.anchors) ? gr.anchors : []).slice(0, 5).forEach(a => {
            if (!a || !a.activityId) return;
            const node = addAnchor(a.activityId, goal.id, whyNowOf(a));
            if (node) (goalOfActivity[a.activityId] = goalOfActivity[a.activityId] || []).push(goal.id);
        });
        (Array.isArray(gr.nodes) ? gr.nodes : []).forEach(nr => {
            const role = nr && nr.role === 'upgrade' ? 'upgrade' : 'suggestion';
            buildNode(nr, [goal.id], role);
        });
    });

    // Fusions (STEP 4): sources must be real activities in DIFFERENT
    // dimensions. goalIds = union of the source anchors' goals. Never forced —
    // dishonest ones are dropped.
    (parsed.fusions || []).slice(0, 2).forEach(fr => {
        if (!fr || typeof fr !== 'object') return;
        const srcIds = (Array.isArray(fr.sourceActivityIds) ? fr.sourceActivityIds : []).filter(id => actById[id]);
        const srcDims = Array.from(new Set(srcIds.map(id => actDim[id])));
        if (srcIds.length < 2 || srcDims.length < 2) return;
        const goalIds = [];
        srcIds.forEach(id => (goalOfActivity[id] || []).forEach(gid => { if (goalIds.indexOf(gid) === -1) goalIds.push(gid); }));
        const node = buildNode(fr, goalIds, 'fusion');
        if (!node) return;
        // Ensure both sources are anchored so the fusion has visible roots.
        srcIds.slice(0, 2).forEach(id => addAnchor(id, null, null));
        node.prerequisites = srcIds.slice(0, 2).map(id => ({ type: 'activity_mastered', activityId: id }));
    });

    // Wildcards (STEP 5): exactly 0-2, no goal, no prereqs, tiny load.
    (parsed.wildcards || []).slice(0, 2).forEach(wr => {
        if (!wr || typeof wr !== 'object') return;
        const node = buildNode(wr, [], 'wildcard');
        if (!node) return;
        if (node.payload.type !== 'activity') { built.splice(built.findIndex(b => b.node === node), 1); delete byTitle[node.title.toLowerCase()]; return; }
        node.payload.spec.baseXP = Math.min(WILDCARD_MAX_XP, node.payload.spec.baseXP);
        if (node.payload.spec.frequency === 'daily') node.payload.spec.frequency = 'weekly';
        node.prerequisites = [];
        node.lifecycle = 'available';
    });

    // Resolve prerequisites (drop unresolvable rather than guessing).
    built.forEach(b => {
        b.rawPrereqs.forEach(pr => {
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
    built.forEach(b => { byId[b.node.id] = b.node; });
    built.forEach(b => {
        b.node.prerequisites = b.node.prerequisites.filter(pr =>
            pr.type !== 'node_mastered' || !reaches(pr.nodeId, b.node.id, byId, {}));
    });

    // Lifecycle at birth, then the scoped load budget.
    const nodes = built.map(b => b.node);
    nodes.forEach(n => {
        if (n.role === 'anchor' || n.role === 'wildcard') return;
        n.lifecycle = lifecycleAtBirth(n, actById, resolvedByAnchor);
    });
    enforceLoadBudget(nodes);
    return { goals, nodes: nodes.slice(0, MAX_NODES) };
}

// ── Push (best-effort) ──────────────────────────────────────────────────────
async function sendMapPush(userData, body) {
    if (!webpush) return;
    const sub = userData.pushSubscription;
    if (!sub || !sub.endpoint || !sub.keys) return;
    try {
        await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({ title: 'Mindkraft ⚔️', body: body || 'Your web is ready.' })
        );
    } catch (err) {
        console.warn('  push failed (status ' + (err.statusCode || '?') + ')');
    }
}

// ── Per-request processing ──────────────────────────────────────────────────
async function processUser(docRef, userData) {
    const techTree = ensureV3Shape(userData.techTree || {});
    userData.techTree = techTree;
    const req = techTree.pendingRequest;
    console.log(`Processing ${req.type} for user ${docRef.id}`);

    const rejection = canProcessRequest(req, techTree, userData);
    if (rejection) {
        console.log(`  Rejected: ${rejection}`);
        await docRef.update({
            'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
            'techTree.lastError': rejection,
            'techTree.status': (techTree.nodes && techTree.nodes.length) ? 'ready' : 'error',
        });
        return;
    }

    const type = req.type === 'add_line' ? 'add_goal' : req.type;
    if (type === 'generate' || type === 'add_goal' || type === 'regenerate' || type === 'revise') {
        await processGenerateFamily(docRef, userData, req, type);
        return;
    }
    if (type === 'expand') {
        await processExpand(docRef, userData, req);
        return;
    }
    if (type === 'quest_patch') {
        await docRef.update({ 'techTree.pendingRequest': admin.firestore.FieldValue.delete() });
        return;
    }
}

function anchorSummaries(techTree, actById) {
    return (techTree.nodes || [])
        .filter(n => n.role === 'anchor' && n.payload && n.payload.activityId && actById[n.payload.activityId])
        .map(n => ({ activityId: n.payload.activityId, name: n.title, dimensionId: n.dimensionId }));
}

async function processGenerateFamily(docRef, userData, req, type) {
    const techTree = userData.techTree;
    const goals = (techTree.goals || []).filter(g => !g.retiredAt);
    const activities = collectActivities(userData);
    const actById = {};
    activities.forEach(({ act }) => { actById[act.id] = act; });

    let opts = { mode: type };
    let goalIds = null;
    let scopedGoal = null;

    if (type === 'add_goal') {
        goalIds = [req.payload.goalId];
        opts.goalIds = goalIds;
        opts.existingAnchors = anchorSummaries(techTree, actById);
    } else if (type === 'regenerate') {
        scopedGoal = goals.find(g => g.id === (req.payload && req.payload.goalId)) || goals[0];
        goalIds = [scopedGoal.id];
        opts.goalIds = goalIds;
        opts.resolvedOnGoal = (techTree.nodes || [])
            .filter(n => (n.goalIds || []).indexOf(scopedGoal.id) !== -1 && n.resolvedAt)
            .map(n => n.title);
    } else if (type === 'revise') {
        const ids = (req.payload.nodeIds) || [];
        const flagged = (techTree.nodes || []).filter(n => ids.indexOf(n.id) !== -1);
        opts.nodesToRevise = flagged.map(n => ({ title: n.title, description: n.description }));
        opts.note = req.payload.note;
        const revGoalIds = [];
        flagged.forEach(n => (n.goalIds || []).forEach(gid => { if (revGoalIds.indexOf(gid) === -1) revGoalIds.push(gid); }));
        goalIds = revGoalIds.length ? revGoalIds : goals.map(g => g.id);
        opts.goalIds = goalIds;
    }

    const scopedGoals = goals.filter(g => !goalIds || goalIds.indexOf(g.id) !== -1);
    const mwOpts = {
        positional: type !== 'generate',
        keepColorsOf: type === 'generate' ? [] : goals,
    };
    // Nested materialization: each goal object carries its own anchors +
    // nodes, so nothing can be orphaned by a key mismatch. GENERATE may split
    // one entry into several distinct goals; scoped modes reuse in order.
    // Quests are optional now (0-2 per response) — the old "mandatory quest"
    // full retry doubled the cost of a generation and rarely helped; quest
    // reliability comes from the explicit payload envelope in the prompt and
    // the lenient quest validator instead.
    const parsed = parseModelJson(await callModel(buildGeneratePrompt(userData, opts), tokenBudget(type)));
    const built = materializeWeb(parsed, userData, scopedGoals, mwOpts);
    let newGoals = built.goals;
    let newNodes = built.nodes;
    if (!newGoals.length && (type === 'generate' || type === 'add_goal')) {
        throw new Error('Model produced no valid goals');
    }
    if (!newNodes.length && type === 'generate') {
        throw new Error('Model produced no valid nodes');
    }

    const now = nowISO();
    const oldNodes = techTree.nodes || [];
    let outGoals, outNodes;

    // Merge an incoming node set with kept old nodes: an incoming anchor for
    // an activity that already has a node folds its goalIds into the existing
    // node instead of duplicating it.
    function mergeNodes(kept, incoming) {
        const anchorFor = {};
        kept.forEach(n => { if (n.payload && n.payload.activityId) anchorFor[n.payload.activityId] = n; });
        const out = kept.slice();
        const idMap = {};      // incoming node id -> surviving node id
        incoming.forEach(n => {
            const aid = n.payload && n.payload.activityId;
            if (aid && anchorFor[aid]) {
                const keep = anchorFor[aid];
                (n.goalIds || []).forEach(gid => { if (keep.goalIds.indexOf(gid) === -1) keep.goalIds.push(gid); });
                if (!keep.whyNow && n.whyNow) keep.whyNow = n.whyNow;
                if (!keep.role) keep.role = 'anchor';
                idMap[n.id] = keep.id;
                return;
            }
            if (aid) anchorFor[aid] = n;
            out.push(n);
        });
        // Re-point prerequisites at surviving node ids.
        out.forEach(n => {
            (n.prerequisites || []).forEach(pr => {
                if (pr.type === 'node_mastered' && idMap[pr.nodeId]) pr.nodeId = idMap[pr.nodeId];
            });
        });
        return out;
    }

    if (type === 'generate') {
        // A full rebuild replaces the frontier, but everything the user has
        // accepted or resolved is immortal — carried forward with goalIds
        // filtered to the surviving goals.
        outGoals = newGoals.concat((techTree.goals || []).filter(g => g.retiredAt));
        const goalIdSet = new Set(outGoals.map(g => g.id));
        const survivors = oldNodes
            .filter(n => n.resolvedAt || n.lifecycle === 'active')
            .map(n => Object.assign({}, n, { goalIds: (n.goalIds || []).filter(gid => goalIdSet.has(gid)) }));
        outNodes = mergeNodes(survivors, newNodes);
    } else if (type === 'add_goal') {
        outGoals = techTree.goals;
        outNodes = mergeNodes(oldNodes, newNodes);
    } else if (type === 'regenerate') {
        outGoals = techTree.goals;
        const gid = scopedGoal.id;
        scopedGoal.regeneratedAt = now;
        // Replace only this goal's unclaimed frontier: drop unaccepted nodes
        // that serve ONLY this goal; multi-goal and accepted nodes stay.
        const kept = oldNodes.filter(n => {
            const servesOnlyThis = (n.goalIds || []).length === 1 && n.goalIds[0] === gid;
            return !servesOnlyThis || n.resolvedAt || n.lifecycle === 'active' || n.source === 'user';
        });
        outNodes = mergeNodes(kept, newNodes);
    } else { // revise
        outGoals = techTree.goals;
        const ids = new Set((req.payload.nodeIds) || []);
        const kept = oldNodes.filter(n => !ids.has(n.id) || n.resolvedAt || n.lifecycle === 'active');
        // Replacements inherit the flagged nodes' goalIds when the model
        // omitted them (materialized under the same scoped goals already).
        outNodes = mergeNodes(kept, newNodes);
    }

    if (outNodes.length > MAX_NODES) {
        // Trim the least-committed first: locked suggestions from the back.
        const overflow = outNodes.length - MAX_NODES;
        let dropped = 0;
        for (let i = outNodes.length - 1; i >= 0 && dropped < overflow; i--) {
            const n = outNodes[i];
            if (!n.resolvedAt && n.lifecycle !== 'active' && n.role !== 'anchor' && n.source !== 'user') {
                outNodes.splice(i, 1); dropped++;
            }
        }
    }

    const update = {
        'techTree.schemaVersion': 3,
        'techTree.status': 'ready',
        'techTree.goals': outGoals,
        'techTree.nodes': outNodes,
        'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
        'techTree.lastError': admin.firestore.FieldValue.delete(),
        'techTree.lastGeneratedAt': now,
        // v2 leftovers die with the first v3 write.
        'techTree.lines': admin.firestore.FieldValue.delete(),
        'techTree.connections': admin.firestore.FieldValue.delete(),
        'techTree.northStarLineId': admin.firestore.FieldValue.delete(),
        'techTree.mergeSuggestion': admin.firestore.FieldValue.delete(),
    };
    if (type === 'revise') {
        update['techTree.revisionsUsed'] = (techTree.revisionsUsed || 0) + 1;
    }
    if (parsed.vision && type === 'generate') update['techTree.vision'] = parsed.vision;
    else if (parsed.vision && !techTree.vision) update['techTree.vision'] = parsed.vision;

    await docRef.update(update);
    console.log(`  Done — ${type}: ${newGoals.length} goal(s), ${newNodes.length} new node(s), ${outNodes.length} total`);
    await sendMapPush(userData, type === 'generate' ? 'Your web is ready.' : 'Your web has grown — take a look.');
}

// ── Expansion (§6.1): fan under mastery + quest absorption ──────────────────
async function processExpand(docRef, userData, req) {
    const techTree = userData.techTree;
    let ids = (req.payload && req.payload.resolvedNodeIds) || (req.payload && req.payload.nodeIds) || [];
    const nodes = techTree.nodes || [];
    // Auto-growth without explicit ids: fan from whatever resolved since the
    // last growth pass.
    if (!ids.length && req.payload && req.payload.auto) {
        const sinceT = techTree.lastExpandAt ? new Date(techTree.lastExpandAt).getTime() : 0;
        ids = nodes
            .filter(n => n.resolvedAt && n.lifecycle !== 'archived' && new Date(n.resolvedAt).getTime() > sinceT)
            .sort((a, b) => new Date(a.resolvedAt) - new Date(b.resolvedAt))
            .slice(-2).map(n => n.id);
    }
    const activities = collectActivities(userData);
    const actById = {};
    activities.forEach(({ act }) => { actById[act.id] = act; });
    const actDim = {};
    activities.forEach(({ act, dim }) => { actDim[act.id] = dim.id; });
    const ctx = nodeCtx(userData);
    const now = nowISO();
    const goalsById = {};
    (techTree.goals || []).forEach(g => { goalsById[g.id] = g; });

    const added = [];
    const patches = [];
    const existingTitles = nodes.filter(n => n.lifecycle !== 'archived').map(n => n.title);

    for (const id of ids.slice(0, 3)) {
        const resolved = nodes.find(n => n.id === id && n.resolvedAt);
        if (!resolved) continue;

        // A recurring quest that sealed ≥4 clean cycles may earn an add_group
        // proposal instead of new sibling nodes (kept verbatim from v2).
        if (resolved.payload && resolved.payload.type === 'quest'
            && resolved.payload.spec && resolved.payload.spec.cadence.type === 'recurring'
            && resolved.payload.projectId) {
            const proj = (userData.projects || []).find(p => p.id === resolved.payload.projectId);
            if (proj && cleanCycleCount(proj) >= 4) {
                const patch = await tryQuestPatch(userData, proj, resolved);
                if (patch) { patches.push(patch); continue; }
            }
        }

        const goalNames = (resolved.goalIds || []).map(gid => goalsById[gid]).filter(Boolean)
            .map(g => ({ goalId: g.id, shortName: g.shortName, sharpened: g.sharpened }));
        const promptCtx = {
            resolvedNode: {
                title: resolved.title, role: resolved.role, dimensionId: resolved.dimensionId,
                activity: resolved.payload.activityId && actById[resolved.payload.activityId]
                    ? { activityId: resolved.payload.activityId, completions: actById[resolved.payload.activityId].completionCount || 0 }
                    : null,
            },
            goals: goalNames,
            activities: activitySnapshot(userData, true),
            existingTitles,
            rejections: rejectionStrings(techTree),
        };
        const prompt = buildExpandPrompt(userData, promptCtx);
        let parsed;
        try {
            parsed = parseModelJson(await callModel(prompt, tokenBudget('expand')));
        } catch (e) {
            console.warn('  expand parse failed:', e.message);
            continue;
        }
        const byTitle = {};
        nodes.forEach(n => { byTitle[String(n.title).toLowerCase()] = n; });
        const fanned = [];
        (parsed.nodes || []).slice(0, 3).forEach(nr => {
            if (!nr || typeof nr.title !== 'string' || !nr.title.trim()) return;
            if (byTitle[nr.title.trim().toLowerCase()]) return;      // duplicate of an existing node
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
            // Expansion may attach prerequisites to real existing activities
            // and to already-existing nodes (by exact title).
            (Array.isArray(nr.prerequisites) ? nr.prerequisites : []).forEach(pr => {
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
                // prereq sits in one dimension it's not an honest fusion.
                const dims = new Set(node.prerequisites.map(pr =>
                    pr.type === 'activity_mastered' ? actDim[pr.activityId]
                        : (nodes.find(n => n.id === pr.nodeId) || {}).dimensionId));
                if (dims.size < 2) node.role = 'suggestion';
            }
            // Lifecycle: prereqs on the resolved node are met; fusions open
            // when their sources are alive.
            const met = node.prerequisites.every(pr => {
                if (pr.type === 'activity_mastered') {
                    const act = actById[pr.activityId];
                    if (!act) return false;
                    if (node.role === 'fusion') return true;
                    return !!act.techTreeMasteredAt || rollingWindowMet(act);
                }
                const t = nodes.find(n => n.id === pr.nodeId);
                if (node.role === 'fusion') return !!(t && (t.resolvedAt || t.lifecycle === 'active'));
                return !!(t && t.resolvedAt);
            });
            node.lifecycle = met ? 'available' : 'locked';
            fanned.push(node);
            existingTitles.push(node.title);
        });
        enforceLoadBudget(fanned);
        added.push.apply(added, fanned);
    }

    // Wildcard replenish: once the old wildcards are accepted or done, the
    // web owes the user fresh serendipity (max 2 on offer at any time).
    const openWilds = nodes.filter(n => n.role === 'wildcard' && n.lifecycle === 'available').length;
    const wildSlots = Math.max(0, 2 - openWilds);
    if (wildSlots > 0 && nodes.some(n => n.role === 'wildcard' && n.lifecycle !== 'available' && n.lifecycle !== 'archived')) {
        try {
            const wilds = await tryWildcardReplenish(userData, techTree, wildSlots, existingTitles);
            added.push.apply(added, wilds);
        } catch (e) {
            console.warn('  wildcard replenish failed:', e.message);
        }
    }

    // Quest absorption (§6.1): quests grow with the web. One extra proposal
    // pass per expand run; proposals only, never silent writes.
    let absorb = [];
    try {
        absorb = await tryQuestAbsorption(userData, techTree);
    } catch (e) {
        console.warn('  absorption pass failed:', e.message);
    }
    patches.push.apply(patches, absorb);

    const update = {
        'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
        'techTree.lastError': admin.firestore.FieldValue.delete(),
        'techTree.lastExpandAt': nowISO(),
        'techTree.status': 'ready',
        'techTree.schemaVersion': 3,
    };
    if (added.length) {
        update['techTree.nodes'] = nodes.concat(added);
    }
    if (patches.length) {
        update['techTree.questPatches'] = (techTree.questPatches || []).concat(patches);
    }
    await docRef.update(update);
    console.log(`  Done — expand: ${added.length} new node(s), ${patches.length} patch proposal(s)`);
    if (added.length) await sendMapPush(userData, 'Mastery opened new paths on your web.');
    else if (patches.length) await sendMapPush(userData, 'A quest is ready to grow.');
}

// v2 add_group patch — a recurring quest with ≥4 clean cycles gets ONE new
// group proposal (progressive overload). Kept as-is alongside absorption.
async function tryQuestPatch(userData, proj, node) {
    const { dimensionList } = activePathsAndDims(userData);
    const system = `A recurring quest has sealed >=4 clean cycles. Propose ONE new GROUP to add
that raises the challenge (progressive overload), or return {"skip":true} if
nothing fits. Never remove anything. Output ONLY:
{ "op":"add_group", "group": <group shape>, "rationale": str }  OR  {"skip":true}
${PAYLOAD_RULES}`;
    const input = {
        quest: { name: proj.name, cleanCycles: cleanCycleCount(proj), groupNames: (proj.groups || []).map(g => g.name) },
        dimensions: dimensionList,
    };
    let parsed;
    try {
        const raw = await callModel({ system, user: 'INPUT:\n' + JSON.stringify(input) }, tokenBudget('quest_patch'));
        let text = String(raw).trim().replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
        parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch (e) { return null; }
    if (!parsed || parsed.skip || parsed.op !== 'add_group' || !parsed.group) return null;
    const ctx = nodeCtx(userData);
    const group = validateGroup(parsed.group, ctx, { newActs: 0 });
    if (!group) return null;
    return {
        id: newId('qp'),
        projectId: proj.id,
        op: 'add_group',
        group,
        rationale: String(parsed.rationale || 'You have sealed 4 clean cycles.').slice(0, 200),
        proposedAt: nowISO(),
        status: 'pending',
    };
}

// Wildcard replenish: a small dedicated call that mints 1-2 fresh wildcards
// when the previous ones were accepted or finished. Same contract as
// generation STEP 5: no goal, no prerequisites, tiny load, concrete.
async function tryWildcardReplenish(userData, techTree, slots, existingTitles) {
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
        activeActivities: activitySnapshot(userData, true).map(a => a.name),
        existingNodeTitles: existingTitles,
        rejections: rejectionStrings(techTree),
    };
    const parsed = parseModelJson(await callModel({ system, user: 'INPUT:\n' + JSON.stringify(input) }, tokenBudget('quest_patch')));
    const ctx = nodeCtx(userData);
    const now = nowISO();
    const out = [];
    const seen = new Set(existingTitles.map(t => String(t).toLowerCase()));
    (parsed.wildcards || []).slice(0, slots).forEach(wr => {
        if (!wr || typeof wr.title !== 'string' || !wr.title.trim()) return;
        if (seen.has(wr.title.trim().toLowerCase())) return;
        const dimensionId = ctx.dimIds.has(wr.dimensionId) ? wr.dimensionId : ctx.fallbackDim;
        const payload = validatePayload(wr.payload, {
            dimIds: ctx.dimIds, pathIds: ctx.pathIds, activityIds: ctx.activityIds,
            fallbackDim: ctx.fallbackDim, title: wr.title, description: wr.description, dimensionId,
        });
        if (!payload || payload.type !== 'activity') return;
        payload.spec.baseXP = Math.min(WILDCARD_MAX_XP, payload.spec.baseXP);
        if (payload.spec.frequency === 'daily') payload.spec.frequency = 'weekly';
        out.push({
            id: newId('ttn'), source: 'ai', createdAt: now,
            role: 'wildcard', goalIds: [], dimensionId,
            lifecycle: 'available', resolvedAt: null, resolvedVia: null,
            title: String(wr.title).trim().slice(0, 80),
            description: String(wr.description || '').slice(0, 240),
            whyNow: whyNowOf(wr), prerequisites: [], payload,
        });
        seen.add(wr.title.trim().toLowerCase());
    });
    return out;
}

// Quest absorption (§6.1, new): activities accepted or mastered since
// lastExpandAt may be folded into an existing quest's named group as a linked
// leaf. Rules: proposals only; at most 1 per quest per run; never an activity
// already inside that quest; declines land in rejections with role
// 'absorption' (client-side).
async function tryQuestAbsorption(userData, techTree) {
    const since = techTree.lastExpandAt ? new Date(techTree.lastExpandAt).getTime() : 0;
    const activities = collectActivities(userData);
    const recent = activities.filter(({ act }) => {
        const created = act.createdAt ? new Date(act.createdAt).getTime() : 0;
        const mastered = act.techTreeMasteredAt ? new Date(act.techTreeMasteredAt).getTime() : 0;
        return (created > since || mastered > since) && !act.archived && !act.deleted;
    }).map(({ act, dim }) => ({ activityId: act.id, name: act.name, dimensionId: dim.id, mastered: !!act.techTreeMasteredAt }));
    if (!recent.length) return [];

    const projects = (userData.projects || []).filter(p => p.status === 'active');
    if (!projects.length) return [];
    const linkedIn = {};   // projectId -> Set(activityId)
    function walkLeaves(groups, fn) {
        (function walk(ns) { (ns || []).forEach(n => { if (n.kind === 'group') walk(n.children); else fn(n); }); })(groups);
    }
    projects.forEach(p => {
        const set = new Set();
        walkLeaves(p.groups || [], l => { if (l.linkedActivityId) set.add(l.linkedActivityId); });
        linkedIn[p.id] = set;
    });
    const pendingAbsorb = new Set((techTree.questPatches || [])
        .filter(q => q.op === 'link_activity' && q.status === 'pending')
        .map(q => q.projectId + ':' + q.activityId));

    const questSnap = projects.map(p => ({
        name: p.name,
        groups: (p.groups || []).map(g => g.name || 'Group'),
        linkedActivities: Array.from(linkedIn[p.id]).map(id => {
            const e = activities.find(x => x.act.id === id);
            return e ? e.act.name : id;
        }),
    }));

    const system = `A user's quests can GROW as their web grows. Given their active quests and the
activities they recently accepted or mastered, propose folding an activity
into an existing quest's group as a linked leaf — ONLY where it genuinely
belongs ("You unlocked Speed-read + notes — fold it into the Portfolio
quest's research group?"). Rules: at most ONE proposal per quest; never an
activity already inside that quest; questName and groupName must match the
input EXACTLY; skip freely — a wrong fold is worse than none.
Output ONLY:
{ "proposals": [{ "questName": str, "groupName": str, "activityId": str,
  "resetMode": "per-cycle"|"once", "requiredCount": int>=1,
  "rationale": str }] }  OR  { "proposals": [] }`;
    const input = { quests: questSnap, recentActivities: recent, rejections: rejectionStrings(techTree) };
    let parsed;
    try {
        parsed = parseModelJson(await callModel({ system, user: 'INPUT:\n' + JSON.stringify(input) }, tokenBudget('quest_patch')));
    } catch (e) { return []; }

    const out = [];
    const usedProject = new Set();
    (parsed.proposals || []).forEach(pr => {
        if (!pr || typeof pr !== 'object') return;
        const proj = projects.find(p => String(p.name).trim().toLowerCase() === String(pr.questName || '').trim().toLowerCase());
        if (!proj || usedProject.has(proj.id)) return;
        if (!pr.activityId || !activities.some(e => e.act.id === pr.activityId)) return;
        if (linkedIn[proj.id].has(pr.activityId)) return;
        if (pendingAbsorb.has(proj.id + ':' + pr.activityId)) return;
        const groupName = String(pr.groupName || '').trim();
        const hasGroup = (proj.groups || []).some(g => String(g.name || 'Group').trim().toLowerCase() === groupName.toLowerCase());
        out.push({
            id: newId('qp'),
            projectId: proj.id,
            op: 'link_activity',
            activityId: pr.activityId,
            groupName: hasGroup ? groupName : ((proj.groups || [])[0] ? ((proj.groups || [])[0].name || 'Group') : 'Group'),
            resetMode: pr.resetMode === 'once' ? 'once' : 'per-cycle',
            requiredCount: Math.min(20, Math.max(1, parseInt(pr.requiredCount, 10) || 1)),
            rationale: String(pr.rationale || 'This fits an existing quest.').slice(0, 200),
            proposedAt: nowISO(),
            status: 'pending',
        });
        usedProject.add(proj.id);
    });
    return out;
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function preflight() {
    if (!PROVIDER.key) {
        console.error('Preflight: ' + PROVIDER.keyHint + ' secret is missing or empty.');
        return;
    }
    const started = Date.now();
    try {
        const res = await fetch(
            PROVIDER.kind === 'anthropic' ? PROVIDER.base + '/v1/models' : PROVIDER.base + '/models',
            {
                signal: AbortSignal.timeout(15000),
                headers: PROVIDER.kind === 'anthropic'
                    ? { 'x-api-key': PROVIDER.key, 'anthropic-version': '2023-06-01' }
                    : { 'Authorization': 'Bearer ' + PROVIDER.key },
            });
        console.log('Preflight [' + PROVIDER.name + ']: HTTP', res.status, 'in', Date.now() - started, 'ms',
            res.status === 401 ? '(key rejected — check the ' + PROVIDER.keyHint + ' secret)' : '');
    } catch (err) {
        console.error('Preflight [' + PROVIDER.name + '] failed after', Date.now() - started, 'ms:', describeError(err));
    }
}

async function main() {
    initAdmin();
    console.log('Map (Web) worker v3 run at', nowISO());
    console.log('Node', process.version, '| provider:', PROVIDER.name, '| model:', PROVIDER.model,
        '| key configured:', PROVIDER.key ? `yes (${PROVIDER.key.length} chars)` : 'NO — set ' + PROVIDER.keyHint);
    const snapshot = await db.collection('users').get();
    const pending = snapshot.docs.filter(d => {
        const u = d.data();
        return u.techTree && u.techTree.pendingRequest;
    });
    let processed = 0, failed = 0;

    if (pending.length) await preflight();

    for (const docSnap of pending) {
        const userData = docSnap.data();
        const req = userData.techTree.pendingRequest;
        try {
            await processUser(docSnap.ref, userData);
            processed++;
        } catch (err) {
            failed++;
            console.error(`  Error for user ${docSnap.id}:`, describeError(err));
            const attempts = (req.attempts || 0) + 1;
            try {
                if (attempts >= 3) {
                    // After 3 attempts, surface an error + retry affordance.
                    await docSnap.ref.update({
                        'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
                        'techTree.status': (userData.techTree.nodes && userData.techTree.nodes.length) ? 'ready' : 'error',
                        'techTree.lastError': 'Generation failed — ' + describeError(err).slice(0, 200),
                    });
                } else {
                    // Bump attempts; the next cron run retries.
                    await docSnap.ref.update({ 'techTree.pendingRequest.attempts': attempts });
                }
            } catch (e2) {
                console.error('  Could not write error state:', e2.message);
            }
        }
    }
    console.log(`Done. Processed: ${processed}, failed: ${failed}, scanned: ${snapshot.size}`);
    return { processed, failed };
}

// Exported for unit tests; only run the cron when invoked directly.
module.exports = {
    materializeWeb, validatePayload, validateGroup, validateLeaf,
    ensureV3Shape, canProcessRequest, weeklyLoad, cleanCycleCount,
    rollingWindowMet, parseModelJson, buildGeneratePrompt, buildExpandPrompt,
};

if (require.main === module) {
    // A run that had work and completed NONE of it must show up red on the
    // Actions dashboard — exiting 0 there hid a full outage behind green
    // checkmarks. Partial failures stay green: the failed request's attempts
    // counter retries it on the next cron run.
    main()
        .then(({ processed, failed }) => process.exit(failed > 0 && processed === 0 ? 1 : 0))
        .catch(err => { console.error('Fatal error:', err); process.exit(1); });
}
