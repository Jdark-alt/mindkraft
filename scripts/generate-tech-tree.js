// ── Tech Tree (Map) generation worker — v2 ──────────────────────────────────
// Runs on a GitHub Actions schedule (see .github/workflows/tech-tree-worker.yml).
// Picks up userData.techTree.pendingRequest flags written by the client, builds
// the prompt from the user's REAL Firestore data (never trusts client-supplied
// context), calls the model through the isolated adapter below, validates the
// response, writes the resulting lines/stations/nodes back, and clears the flag.
// The worker is the sole authority on cooldowns and rate limits — a tampered
// client can write a request, but only this script decides whether it's honored.
//
// v2 (see mindkraft-tree-v2-spec):
//   - Goals are first-class; each goal → one Line ending in a named terminus.
//   - Nodes carry a polymorphic payload: activity | quest | challenge.
//   - Stations declare a "resolve any N" threshold over the segment below them.
//   - Request types: generate, add_line, expand, regenerate, revise, quest_patch.
//   - materializeNodes/validate is the single validator for every request type.

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

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
        model: process.env.TECH_TREE_MODEL || 'claude-haiku-4-5',
        fallbackModels: [],
        maxTokens: { generate: 9000, add_line: 6000, expand: 3500, regenerate: 6000, revise: 2500, quest_patch: 2500 },
        keyHint: 'ANTHROPIC_API_KEY',
    },
    {
        name: 'gemini',
        key: (process.env.GEMINI_API_KEY || '').trim(),
        base: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: process.env.TECH_TREE_MODEL || 'gemini-2.5-flash',
        fallbackModels: ['gemini-2.0-flash'],
        maxTokens: { generate: 9000, add_line: 6000, expand: 4000, regenerate: 6000, revise: 2500, quest_patch: 2500 },
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

// ── v2 constants (spec §2, §5, §6, §9) ──────────────────────────────────────
// Line colour is line identity, NOT dimension colour (spec §2.3). A fixed
// palette of 5 — the same map cannot legibly carry more than 5 goals (§3.1).
const LINE_PALETTE = ['#a8446e', '#5a9fd4', '#c98a3f', '#8a9a5b', '#7a6ff0'];
const LOAD_WEIGHT = { daily: 7, weekly: 1, biweekly: 0.5, monthly: 0.25, occasional: 0.25, 'one-time': 0.25 };
const LOAD_BUDGET_HEADROOM = 8;          // generation may not push load past +8 actions/week (§6.4)
const MAX_GOALS = 5;                     // §3.1
const MAX_NEW_ACTIVITIES_PER_QUEST = 3;  // §5.3 hard cap
const MAX_NODES = 40;                    // hard ceiling across all lines; scope decides the real count
const REGEN_COOLDOWN_DAYS = 30;          // per-line regenerate cooldown (§9.1)
const REVISION_LIMIT = 3;                // keep a rate limit, kill the 24h clock (§0.4)
const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'occasional'];

const MAX_TOKENS = { generate: 6000, add_line: 4500, expand: 3000, regenerate: 4500, revise: 2000, quest_patch: 2000 };

// ── Local date construction (spec §10.14) ───────────────────────────────────
// NEVER toISOString().slice(0,10) for a *date* — it has caused production
// incidents. cycleHistory timestamps stay full ISO; only date comparisons
// localise. The worker runs in UTC, so a plain ISO timestamp is fine for
// createdAt/resolvedAt (they are instants, not calendar dates).
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

// Weekly load = sum of per-week weights over active activities (spec §6.4).
// '3x/week'-style custom frequencies weight by their per-week count where the
// data exposes one; otherwise a conservative default.
function weeklyLoad(userData) {
    let sum = 0;
    collectActivities(userData).forEach(({ act }) => {
        if (act.archived || act.deleted) return;
        const f = act.frequency;
        if (f === 'custom') {
            const per = customPerWeek(act);
            sum += per;
        } else {
            sum += (LOAD_WEIGHT[f] != null ? LOAD_WEIGHT[f] : 1);
        }
    });
    return Math.round(sum * 10) / 10;
}
function customPerWeek(act) {
    // Custom activities encode a per-week target in a few possible fields
    // across the app's history; fall back to 3 (a common custom cadence).
    const n = act.customTimesPerWeek || act.timesPerWeek ||
        (Array.isArray(act.customDays) ? act.customDays.length : 0);
    return n > 0 ? Math.min(7, n) : 3;
}

// "Clean cycle" — a sealed cycle that actually completed its required items.
// A force-sealed cycle (confirm() override) pays zero bonus and must NOT count
// toward node resolution or quest patching (spec §6.1, §7.7).
function cleanCycleCount(p) {
    return ((p && p.cycleHistory) || []).filter(c =>
        c && c.itemsTotal > 0 && c.itemsCompleted >= c.itemsTotal).length;
}

function newId(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Cooldown / gate enforcement (spec §3.1, §7.6, §9.1) ─────────────────────

function canProcessRequest(req, techTree, userData) {
    const activities = collectActivities(userData);
    const goals = (techTree.goals || []).filter(g => !g.retiredAt);

    if (req.type === 'generate') {
        if (!goals.length) return 'No goals set — add a goal first.';
        if (activities.length < 3) return 'Need at least 3 active activities.';
        return null;
    }
    if (req.type === 'add_line') {
        const goal = goals.find(g => g.id === (req.payload && req.payload.goalId));
        if (!goal) return 'That goal no longer exists.';
        if (goals.filter(g => (techTree.lines || []).some(l => l.goalId === g.id && l.status !== 'retired')).length >= MAX_GOALS)
            return 'The map can hold at most ' + MAX_GOALS + ' lines.';
        return null;
    }
    if (req.type === 'expand') {
        const ids = (req.payload && req.payload.resolvedNodeIds) || [];
        const some = (techTree.nodes || []).some(n => ids.indexOf(n.id) !== -1 && n.resolvedAt);
        if (!some) return 'Nothing to expand from.';
        return null;
    }
    if (req.type === 'regenerate') {
        const line = (techTree.lines || []).find(l => l.id === (req.payload && req.payload.lineId));
        if (!line) return 'That line no longer exists.';
        const last = line.regeneratedAt || techTree.lastGeneratedAt;
        if (last) {
            const ageDays = (Date.now() - new Date(last).getTime()) / 86400000;
            if (ageDays < REGEN_COOLDOWN_DAYS)
                return 'This line was regenerated recently — free again in ' +
                    Math.ceil(REGEN_COOLDOWN_DAYS - ageDays) + ' days.';
        }
        return null;
    }
    if (req.type === 'revise') {
        if ((techTree.revisionsUsed || 0) >= REVISION_LIMIT) return 'Revision limit reached.';
        if (!req.payload || !String(req.payload.note || '').trim()) return 'Revision needs a correction note.';
        return null;
    }
    if (req.type === 'quest_patch') {
        return null; // worker validates the target project below
    }
    return 'Unknown request type.';
}

// ── Prompt building ─────────────────────────────────────────────────────────

function activitySnapshot(userData) {
    return collectActivities(userData).slice(0, 60).map(({ act, dim }) => ({
        activityId: act.id,
        name: act.name,
        description: (act.description || '').slice(0, 120),
        dimensionId: dim.id,
        frequency: act.frequency,
        completionCount: act.completionCount || (act.completionHistory || []).length || 0,
        currentStreak: act.currentStreak || 0,
        masteredAt: act.techTreeMasteredAt || null,
    }));
}

const PAYLOAD_RULES = `
PAYLOAD — every node IS one of three things. Choose by what the thing IS, never
by whether it already exists:
- "activity": a durable practice that deserves its own streak and should
  outlive any quest containing it. It is part of who the user becomes.
  e.g. "Zone 2 run, 3x/week".
- "quest": a composite — several things that only mean something together, or a
  sequence with a shape. cadence.type "oneoff" when it finishes ("Ship video
  #1"); "recurring" when it's a theme that seals and restarts forever ("Weekly
  training block", resolveRule.cleanCycles ~4).
- "challenge": a time-boxed pace over activities that already exist.

QUEST GROUPS (must match the app's shape EXACTLY):
  group = { "kind":"group", "name":str, "ordered":bool, "repeat":int>=1,
            "children":[group|leaf] }   // ordered=true is a pipeline, false a checklist
  leaf  = { "kind":"leaf", "type":"activity"|"task", "name":str,
            "resetMode":"per-cycle"|"once", "requiredCount":int>=1,
            "linkedActivityId":str|null,          // activity leaves that reuse a real activity
            "spec":{ "baseXP":1..50, "frequency":str, "dimensionId":str } | null,
            "_promotable":{ "baseXP":1..50, "frequency":str, "dimensionId":str } | null }
  Decide each leaf the same way: scaffolding that dies with the quest -> "task";
  a practice that should outlive it -> "activity" (give it a "spec"); a practice
  the user ALREADY has -> "activity" with "linkedActivityId" set (no spec).
  Nobody wants a streak on "make a thumbnail"; nobody wants "sleep window"
  trapped inside one quest.
  HARD CAP: at most ${MAX_NEW_ACTIVITIES_PER_QUEST} NEW activities per quest
  (activity leaves with a spec and no linkedActivityId). No cap on tasks.
  Attach "_promotable" to any TASK leaf that could sensibly become a real
  activity later (it powers a "Make activity" button; it is dropped on accept).

For an "activity" node, payload is:
  { "type":"activity", "spec":{ "name":str,"description":str,"baseXP":1..50,
    "frequency":"daily|weekly|biweekly|monthly|occasional","dimensionId":str },
    "mastery":{ "target":int, "windowDays":int|null } }`;

function buildGeneratePrompt(userData, opts) {
    const techTree = userData.techTree;
    const { dimensionList, pathList } = activePathsAndDims(userData);
    const goals = (techTree.goals || []).filter(g => !g.retiredAt)
        .filter(g => !opts.goalIds || opts.goalIds.indexOf(g.id) !== -1)
        .map(g => ({ goalId: g.id, rawText: g.rawText, sharpened: g.sharpened || null, kind: g.kind || null }));

    const load = weeklyLoad(userData);
    const rejections = (techTree.rejections || []).slice(-40).map(r => r.nodeTitle + ' (' + r.reason + ')');
    const userNodes = (techTree.nodes || []).filter(n => n.source === 'user').map(n => n.title);
    const resolvedTitles = (techTree.nodes || []).filter(n => n.resolvedAt).map(n => n.title);

    const system = `You are the Map generation engine for Mindkraft, a life-planning app whose
skill map reads like a transit map: each GOAL is a coloured LINE that runs from
the user to a named TERMINUS (summit), with STATIONS (milestones) along the way
and NODES (the actual practices/quests) in the SEGMENTS between stations.

Output ONLY one valid JSON object — no prose, no markdown fences.

STEP 1 — READ EACH GOAL. For every goal return a "reading":
  { "goalId", "sharpened", "shortName", "kind", "kindReason" }
  - "sharpened": a concrete, DEFENSIBLE reading of what they typed. Turn
    "get healthy" into "Lose 10kg and hold it by December", not a restatement.
  - "shortName": <=14 chars, the line label ("Health", "Channel", "The job").
  - "kind": "destination" if there is a stated outcome/number/event, OR the goal
    is genuinely BOTH a routine and an outcome (a routine + losing 10kg is ONE
    destination reached by rhythms — the rhythm becomes the segments, never a
    second line). "rhythm" ONLY when there is genuinely no outcome at all — a
    pure way of living like "be a person who trains". Too vague to tell ->
    "destination" with the most useful concrete reading you can defend.
  - "kindReason": REQUIRED and non-null when kind is "rhythm" (why there is no
    finish line); null otherwise.

STEP 2 — BUILD THE MAP.
  - Emit ONE line per goal. Never merge two goals into one line; never leave a
    goal without a line.
  - Each line gets 2-4 STATIONS plus a terminus. Station titles are milestones
    in the user's language ("First video", "Consistent cadence", "Scaling"),
    NEVER "Tier 2" / "Phase 1".
  - terminus: destination -> { "kind":"flag" }; rhythm -> { "kind":"loop" }.
  - Each station declares "threshold" = resolve ANY N nodes in the segment BELOW
    it. threshold must be >=2 AND <= the number of nodes you emit into that
    segment.
  - Emit 2-4 NODES per segment. Segments deeper than the frontier get the
    minimum; expansion fills them later.
  - ONE daily anchor per line maximum. Everything else weekly or lighter. Total
    new load across all lines must not push weekly load past +${LOAD_BUDGET_HEADROOM}
    (the user is at ${load} actions/week now).
  - 0-2 INTERCHANGES total, only where two lines genuinely share a seam. Each
    names exactly two distinct goals and credits a station on BOTH. Never
    manufacture one for symmetry.
  - 0-3 FRESH PICKS — nodes with "goalId":null that serve no station. The
    quarantine for genuinely serendipitous suggestions that advance nothing.

NODE RULES:
  - Genuinely new and concrete — never a vague umbrella, never a rebrand of an
    existing activity ("a more consistent version of X" is forbidden — specify
    new CONTENT). Get more specific further out: a far node reads like a coach's
    prescription, not a poster slogan.
  - Do not force connections; a prerequisite must genuinely enable the thing. A
    node may depend on another node via {"type":"node_mastered","nodeTitle":".."}
    (exact title of another node in your output) or on a real existing activity
    via {"type":"activity_mastered","activityId":".."}. Never invent IDs.
  - Vary the kind of action across output. Never pad a small goal to hit a cap.
  - If an activity is too ambiguous to use, omit it rather than guessing.
${PAYLOAD_RULES}

VISION: also return "vision" — 1-2 sentences, second person, vivid and specific
to their goals. No motivation-poster fluff.

OUTPUT SCHEMA (a single JSON object, nothing else):
{ "vision": string,
  "readings": [{ "goalId":str, "sharpened":str, "shortName":str,
                 "kind":"destination"|"rhythm", "kindReason":str|null }],
  "lines": [{ "goalId":str,
              "stations":[{ "index":int, "title":str, "threshold":int }],
              "terminus":{ "title":str, "kind":"flag"|"loop" } }],
  "nodes": [{ "goalId":str|null, "segmentIndex":int,
              "title":str, "description":str, "dimensionId":str,
              "isTerminus":bool,
              "prerequisites":[{"type":"node_mastered","nodeTitle":str}|{"type":"activity_mastered","activityId":str}],
              "payload": <activity|quest|challenge payload> }],
  "interchanges": [{ "title":str, "description":str, "dimensionId":str,
                     "goalIds":[str,str], "stationIndices":[int,int],
                     "payload": <payload> }] }`;

    const input = {
        goals,
        dimensions: dimensionList,
        paths: pathList,
        activeActivities: activitySnapshot(userData),
        loadBudget: { current: load, headroom: LOAD_BUDGET_HEADROOM },
        rejections,
        userAddedNodeTitles: userNodes,
        alreadyResolved: resolvedTitles,
    };
    if (opts.mode === 'add_line') {
        input._mode = 'ADD ONE LINE for the single goal above; do not touch other lines.';
    }
    if (opts.mode === 'regenerate') {
        input._mode = 'REGENERATE this line: replace its unclaimed frontier with a fresh route to the SAME terminus. Build on the alreadyResolved titles; honour rejections.';
        input._resolvedOnLine = opts.resolvedOnLine || [];
        input._terminus = opts.terminus || null;
    }
    if (opts.mode === 'revise') {
        input._mode = 'REVISION: the user flagged the node(s) in _nodesToRevise with feedback in _note. Return replacement node(s) that directly address the feedback (not a light reword), following every rule.';
        input._nodesToRevise = opts.nodesToRevise || [];
        input._note = String(opts.note || '').slice(0, 240);
    }
    return { system, user: 'INPUT:\n' + JSON.stringify(input) };
}

function buildExpandPrompt(userData, ctx) {
    const load = weeklyLoad(userData);
    const rejections = (userData.techTree.rejections || []).slice(-40).map(r => r.nodeTitle + ' (' + r.reason + ')');
    const { dimensionList } = activePathsAndDims(userData);
    const system = `You extend a user's Map after they RESOLVED a node. Emit 2-3 sibling nodes
that the resolved node now makes possible AND that move toward the next station.

THE MONOTONIC CONSTRAINT: every node you emit MUST reduce the distance to SOME
station — not necessarily this one. A node serving nothing is rejected. Vary the
payload type by what each thing IS. Respect the load budget (the user is at ${load}
actions/week; do not push past +${LOAD_BUDGET_HEADROOM}). Do not re-suggest
anything in rejections or already in the segment.
${PAYLOAD_RULES}

Output ONLY: { "nodes":[{ "segmentIndex":int, "title":str, "description":str,
  "dimensionId":str, "prerequisites":[...], "payload": <payload> }] }`;
    const input = {
        resolvedNode: { title: ctx.resolved.title, segmentIndex: ctx.resolved.segmentIndex },
        workingToward: ctx.terminusTitle,
        nextStation: ctx.stationTitle,
        segmentNodes: ctx.segmentTitles,
        dimensions: dimensionList,
        activityHistory: ctx.activityHistory || null,
        rejections,
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
const FETCH_TIMEOUT_MS = 45000;

async function callModel(prompt, maxTokens) {
    if (!PROVIDER.key) {
        throw new Error(PROVIDER.keyHint + ' secret is missing or empty — add it under repo Settings → Secrets and variables → Actions');
    }
    async function once(tokens) {
        if (PROVIDER.kind === 'anthropic') {
            const res = await fetch(PROVIDER.base + '/v1/messages', {
                method: 'POST',
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
                headers: {
                    'x-api-key': PROVIDER.key,
                    'anthropic-version': '2023-06-01',
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    model: PROVIDER.activeModel || PROVIDER.model,
                    max_tokens: tokens,
                    temperature: 0.6,
                    system: prompt.system,
                    messages: [{ role: 'user', content: prompt.user }],
                }),
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Model API error ${res.status}: ${text.slice(0, 300)}`);
            }
            const data = await res.json();
            const text = (data.content || []).map(c => c.text || '').join('');
            if (!text) throw new Error('Model returned no content');
            return { content: text, finishReason: data.stop_reason === 'max_tokens' ? 'length' : data.stop_reason };
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
        readings: Array.isArray(parsed.readings) ? parsed.readings : [],
        lines: Array.isArray(parsed.lines) ? parsed.lines : [],
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        interchanges: Array.isArray(parsed.interchanges) ? parsed.interchanges : [],
        challenges: Array.isArray(parsed.challenges) ? parsed.challenges : [],
    };
}

// ── Payload validation (spec §2.6, §2.7, §5.7) ──────────────────────────────
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
                    ? Math.max(1, parseInt(raw.mastery.windowDays, 10) || masteryWindowFor(frequency))
                    : masteryWindowFor(frequency),
            },
        };
    }

    if (raw.type === 'quest') {
        const s = raw.spec || {};
        const counter = { newActs: 0 };
        const groups = (Array.isArray(s.groups) ? s.groups : [])
            .map(g => validateGroup(g, ctx, counter)).filter(Boolean);
        if (!groups.length) return null;                    // §5.7.3: every quest needs ≥1 valid group
        const cadType = (s.cadence && s.cadence.type === 'recurring') ? 'recurring' : 'oneoff';
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
            payload.resolveRule = { cleanCycles: Math.min(12, Math.max(1, parseInt((raw.resolveRule || {}).cleanCycles, 10) || 4)) };
        }
        return payload;
    }

    if (raw.type === 'challenge') {
        const s = raw.spec || {};
        // Challenge payloads reference existing activities only (validated by
        // the caller against real ids); keep a minimal, safe shape.
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

function masteryTargetFor(freq) {
    return ({ daily: 15, weekly: 6, biweekly: 4, monthly: 3, occasional: 3 })[freq] || 6;
}
function masteryWindowFor(freq) {
    return ({ daily: 30, weekly: 90, biweekly: 120, monthly: 180, occasional: null })[freq] || 90;
}

// Recursively validate a quest group. Mutates counter.newActs to enforce the
// 3-new-activity cap (excess new-activity leaves are demoted to tasks §5.7.4).
function validateGroup(g, ctx, counter) {
    if (!g || typeof g !== 'object') return null;
    if (g.kind === 'leaf' || g.type) return null; // a bare leaf at group position — skip
    const children = (Array.isArray(g.children) ? g.children : [])
        .map(c => (c && c.kind === 'group') ? validateGroup(c, ctx, counter) : validateLeaf(c, ctx, counter))
        .filter(Boolean);
    if (!children.length) return null;             // §5.7.3: every group has ≥1 child
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
            type = 'task'; // §5.7.4 truncate the excess to tasks
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
    // task leaf — §5.7.3 requires a non-empty name
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

// ── Node materialization (spec §2.5, §5.7) ──────────────────────────────────
// Turns raw model nodes into schema-valid v2 nodes with a resolved lineId /
// segmentIndex / payload. Drops individual bad nodes, never the whole response.
function materializeNodes(parsed, userData, goalToLine) {
    const activities = collectActivities(userData);
    const ctxBase = {
        dimIds: new Set((userData.dimensions || []).map(d => d.id)),
        pathIds: new Set(),
        activityIds: new Set(activities.map(e => e.act.id)),
        fallbackDim: (userData.dimensions || [])[0] ? userData.dimensions[0].id : 'uncategorized',
    };
    (userData.dimensions || []).forEach(d => (d.paths || []).forEach(p => ctxBase.pathIds.add(p.id)));

    const now = nowISO();
    const built = [];
    const byTitle = {};

    (parsed.nodes || []).forEach(r => {
        if (!r || typeof r.title !== 'string' || !r.title.trim()) return;
        const goalId = r.goalId || null;
        const line = goalId ? goalToLine[goalId] : null;                 // §5.7.1: bad goalId -> fresh pick
        const dimensionId = ctxBase.dimIds.has(r.dimensionId) ? r.dimensionId : ctxBase.fallbackDim;
        const payload = validatePayload(r.payload, {
            dimIds: ctxBase.dimIds, pathIds: ctxBase.pathIds, activityIds: ctxBase.activityIds,
            fallbackDim: ctxBase.fallbackDim, title: r.title, description: r.description, dimensionId,
        });
        if (!payload) return;                                            // §5.7.2/.3: bad payload -> drop node
        const node = {
            id: newId('ttn'),
            source: 'ai',
            createdAt: now,
            lineId: line ? line.id : null,
            segmentIndex: line ? Math.max(0, parseInt(r.segmentIndex, 10) || 0) : null,
            isTerminus: !!r.isTerminus,
            lifecycle: 'locked',                                         // recomputed by the client
            resolvedAt: null,
            resolvedVia: null,
            interchange: null,
            title: String(r.title).trim().slice(0, 80),
            description: String(r.description || '').slice(0, 240),
            dimensionId,
            prerequisites: [],
            parentNodeId: null,
            payload,
        };
        built.push({ node, rawPrereqs: Array.isArray(r.prerequisites) ? r.prerequisites : [] });
        byTitle[node.title.toLowerCase()] = node;
    });

    // Interchanges (§5.7.8): must name exactly two distinct existing goals.
    (parsed.interchanges || []).forEach(r => {
        if (!r || typeof r.title !== 'string' || !r.title.trim()) return;
        const gids = Array.isArray(r.goalIds) ? r.goalIds : [];
        const l0 = goalToLine[gids[0]], l1 = goalToLine[gids[1]];
        const dimensionId = ctxBase.dimIds.has(r.dimensionId) ? r.dimensionId : ctxBase.fallbackDim;
        const payload = validatePayload(r.payload, {
            dimIds: ctxBase.dimIds, pathIds: ctxBase.pathIds, activityIds: ctxBase.activityIds,
            fallbackDim: ctxBase.fallbackDim, title: r.title, description: r.description, dimensionId,
        });
        if (!payload) return;
        const si = Array.isArray(r.stationIndices) ? r.stationIndices : [0, 0];
        if (l0 && l1 && l0.id !== l1.id) {
            const node = {
                id: newId('ttn'), source: 'ai', createdAt: now,
                lineId: l0.id, segmentIndex: Math.max(0, parseInt(si[0], 10) || 0),
                isTerminus: false, lifecycle: 'locked', resolvedAt: null, resolvedVia: null,
                interchange: { lineIds: [l0.id, l1.id], stationIds: [] },
                title: String(r.title).trim().slice(0, 80),
                description: String(r.description || '').slice(0, 240),
                dimensionId, prerequisites: [], parentNodeId: null, payload,
            };
            built.push({ node, rawPrereqs: [] });
            byTitle[node.title.toLowerCase()] = node;
        } else if (l0) {
            // §5.7.8 demote to a normal node on the first line
            const node = {
                id: newId('ttn'), source: 'ai', createdAt: now,
                lineId: l0.id, segmentIndex: Math.max(0, parseInt(si[0], 10) || 0),
                isTerminus: false, lifecycle: 'locked', resolvedAt: null, resolvedVia: null,
                interchange: null,
                title: String(r.title).trim().slice(0, 80),
                description: String(r.description || '').slice(0, 240),
                dimensionId, prerequisites: [], parentNodeId: null, payload,
            };
            built.push({ node, rawPrereqs: [] });
        }
    });

    // Resolve prerequisites (drop unresolvable rather than guessing §5.7.7).
    const activityById = {};
    activities.forEach(({ act }) => { activityById[act.id] = act; });
    built.forEach(b => {
        b.rawPrereqs.forEach(pr => {
            if (!pr || typeof pr !== 'object') return;
            if (pr.type === 'activity_mastered' && activityById[pr.activityId]) {
                b.node.prerequisites.push({ type: 'activity_mastered', activityId: pr.activityId });
            } else if (pr.type === 'node_mastered') {
                const ref = pr.nodeTitle ? byTitle[String(pr.nodeTitle).toLowerCase()] : null;
                if (ref && ref.id !== b.node.id) b.node.prerequisites.push({ type: 'node_mastered', nodeId: ref.id });
            }
        });
    });

    // Cycle detection on prerequisite edges (§5.7.9) — drop the offending edge.
    const byId = {};
    built.forEach(b => { byId[b.node.id] = b.node; });
    built.forEach(b => {
        b.node.prerequisites = b.node.prerequisites.filter(pr => {
            if (pr.type !== 'node_mastered') return true;
            return !reaches(pr.nodeId, b.node.id, byId, {});
        });
    });

    const nodes = built.map(b => b.node);

    // Load-budget cap across the whole response (§5.7.10): drop lowest-priority
    // (deepest, latest) new-activity-bearing nodes until new load fits +8/week.
    enforceLoadBudget(nodes, userData);

    // Station threshold clamp (§5.7.6) happens in validateLinesStations against
    // the emitted node counts per segment.
    return nodes;
}

function reaches(fromId, targetId, byId, guard) {
    if (fromId === targetId) return true;
    if (guard[fromId]) return false;
    guard[fromId] = true;
    const n = byId[fromId];
    if (!n) return false;
    return (n.prerequisites || []).some(pr => pr.type === 'node_mastered' && reaches(pr.nodeId, targetId, byId, guard));
}

function nodeNewLoad(node) {
    // Weekly load a node would add if fully accepted: an activity node, plus any
    // new-activity leaves inside a quest node.
    let load = 0;
    const w = f => (LOAD_WEIGHT[f] != null ? LOAD_WEIGHT[f] : 1);
    if (node.payload.type === 'activity') {
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

function enforceLoadBudget(nodes, userData) {
    let total = nodes.reduce((s, n) => s + nodeNewLoad(n), 0);
    if (total <= LOAD_BUDGET_HEADROOM) return;
    // Drop the heaviest / deepest nodes first until it fits. Never drop a node
    // that is already resolved (fresh generation has none, but expansion may
    // run alongside existing nodes — those are not in this array).
    const ranked = nodes.slice().sort((a, b) => (b.segmentIndex || 0) - (a.segmentIndex || 0) || nodeNewLoad(b) - nodeNewLoad(a));
    for (const n of ranked) {
        if (total <= LOAD_BUDGET_HEADROOM) break;
        const load = nodeNewLoad(n);
        if (load <= 0) continue;
        const idx = nodes.indexOf(n);
        if (idx !== -1) { nodes.splice(idx, 1); total -= load; }
    }
}

// ── Lines / stations (spec §2.3, §2.4, §5.7.6) ──────────────────────────────
function validateLinesStations(parsed, userData, goals, colorStart) {
    const lines = [];
    const goalToLine = {};
    (parsed.lines || []).forEach((rl, i) => {
        const goal = goals.find(g => g.id === rl.goalId);
        if (!goal || goalToLine[goal.id]) return;                       // one line per goal
        const kind = (rl.terminus && rl.terminus.kind === 'loop') ? 'loop' : 'flag';
        let stations = (Array.isArray(rl.stations) ? rl.stations : [])
            .map((s, idx) => ({
                id: newId('st'),
                lineId: null,
                index: (typeof s.index === 'number') ? s.index : idx,
                title: String(s.title || 'Milestone').slice(0, 24),
                threshold: Math.max(2, parseInt(s.threshold, 10) || 2),
                reachedAt: null,
            }))
            .sort((a, b) => a.index - b.index)
            .map((s, idx) => (s.index = idx, s));
        if (!stations.length) {
            stations = [{ id: newId('st'), lineId: null, index: 0, title: 'Getting started', threshold: 2, reachedAt: null }];
        }
        const line = {
            id: newId('line'),
            goalId: goal.id,
            color: LINE_PALETTE[(colorStart + i) % LINE_PALETTE.length],
            status: 'active',
            terminus: { title: String((rl.terminus && rl.terminus.title) || goal.shortName || 'Summit').slice(0, 60), kind, nodeId: null },
            stations,
            regeneratedAt: null,
        };
        stations.forEach(s => (s.lineId = line.id));
        lines.push(line);
        goalToLine[goal.id] = line;
    });
    return { lines, goalToLine };
}

// Clamp station thresholds to the node count in their segment (§5.7.6). Runs
// after nodes exist so it can count them.
function clampThresholds(lines, nodes) {
    lines.forEach(line => {
        line.stations.forEach(st => {
            const count = nodes.filter(n => n.lineId === line.id && n.segmentIndex === st.index).length;
            if (count >= 2) st.threshold = Math.min(st.threshold, count);
            else st.threshold = Math.max(2, st.threshold); // keep >=2 even if underfilled; expansion may fill it
        });
    });
}

// ── Readings (spec §3.4, §3.5) ──────────────────────────────────────────────
function applyReadings(parsed, goals) {
    const merge = [];
    const sharpenedTexts = {};
    (parsed.readings || []).forEach(r => {
        const goal = goals.find(g => g.id === r.goalId);
        if (!goal) return;
        goal.sharpened = String(r.sharpened || goal.rawText).slice(0, 200);
        goal.shortName = String(r.shortName || goal.rawText).slice(0, 14);
        goal.kind = r.kind === 'rhythm' ? 'rhythm' : 'destination';
        goal.kindReason = goal.kind === 'rhythm' ? (r.kindReason ? String(r.kindReason).slice(0, 200) : 'There is no finish line here — this is a way of living.') : null;
        const key = goal.sharpened.trim().toLowerCase();
        if (sharpenedTexts[key]) merge.push([sharpenedTexts[key], goal.id]);
        else sharpenedTexts[key] = goal.id;
    });
    // Any goal the model skipped: fail safe (§3.6) — don't block a tree.
    goals.forEach(g => {
        if (!g.sharpened) { g.sharpened = g.rawText; g.kind = g.kind || 'destination'; g.shortName = g.shortName || String(g.rawText).slice(0, 14); }
    });
    return merge.length ? merge[0] : null; // one merge suggestion, offered once (§3.6)
}

// ── Push (best-effort, spec §4.4, §7.3) ─────────────────────────────────────
async function sendMapPush(userData, body) {
    if (!webpush) return;
    const sub = userData.pushSubscription;
    if (!sub || !sub.endpoint || !sub.keys) return;
    try {
        await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: sub.keys },
            JSON.stringify({ title: 'Mindkraft ⚔️', body: body || 'Your map is ready.' })
        );
    } catch (err) {
        console.warn('  push failed (status ' + (err.statusCode || '?') + ')');
    }
}

// ── Per-request processing ──────────────────────────────────────────────────
async function processUser(docRef, userData) {
    const techTree = userData.techTree || {};
    const req = techTree.pendingRequest;
    console.log(`Processing ${req.type} for user ${docRef.id}`);

    // Stale-after-regenerate guard (§7.6, §10.16): an expand landing after a
    // regenerate on the same line is discarded.
    const rejection = canProcessRequest(req, techTree, userData);
    if (rejection) {
        console.log(`  Rejected: ${rejection}`);
        await docRef.update({
            'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
            'techTree.lastError': rejection,
            'techTree.status': (techTree.lines && techTree.lines.length) ? 'ready' : 'error',
        });
        return;
    }

    if (req.type === 'generate' || req.type === 'add_line' || req.type === 'regenerate' || req.type === 'revise') {
        await processGenerateFamily(docRef, userData, req);
        return;
    }
    if (req.type === 'expand') {
        await processExpand(docRef, userData, req);
        return;
    }
    if (req.type === 'quest_patch') {
        // Client-initiated patch requests are not used in v2 — the worker emits
        // patch proposals from expand. Clear the flag safely.
        await docRef.update({ 'techTree.pendingRequest': admin.firestore.FieldValue.delete() });
        return;
    }
}

async function processGenerateFamily(docRef, userData, req) {
    const techTree = userData.techTree;
    const goals = (techTree.goals || []).filter(g => !g.retiredAt);

    let opts = { mode: req.type };
    let goalIds = null;
    let colorStart = 0;

    if (req.type === 'add_line') {
        goalIds = [req.payload.goalId];
        opts.goalIds = goalIds;
        colorStart = (techTree.lines || []).filter(l => l.status !== 'retired').length;
    } else if (req.type === 'regenerate') {
        const line = (techTree.lines || []).find(l => l.id === req.payload.lineId);
        goalIds = [line.goalId];
        opts.goalIds = goalIds;
        opts.terminus = line.terminus;
        opts.resolvedOnLine = (techTree.nodes || []).filter(n => n.lineId === line.id && n.resolvedAt).map(n => n.title);
        colorStart = (techTree.lines || []).indexOf(line);
    } else if (req.type === 'revise') {
        const ids = (req.payload.nodeIds) || [];
        const flagged = (techTree.nodes || []).filter(n => ids.indexOf(n.id) !== -1);
        opts.nodesToRevise = flagged.map(n => ({ title: n.title, description: n.description }));
        opts.note = req.payload.note;
        // Revision reuses the goals of the flagged nodes' lines.
        const lineIds = new Set(flagged.map(n => n.lineId).filter(Boolean));
        const revGoalIds = (techTree.lines || []).filter(l => lineIds.has(l.id)).map(l => l.goalId);
        goalIds = revGoalIds.length ? revGoalIds : goals.map(g => g.id);
        opts.goalIds = goalIds;
    }

    const scopedGoals = goals.filter(g => !goalIds || goalIds.indexOf(g.id) !== -1);
    const prompt = buildGeneratePrompt(userData, opts);
    const budget = (PROVIDER.maxTokens && PROVIDER.maxTokens[req.type]) || MAX_TOKENS[req.type] || 4000;
    const raw = await callModel(prompt, budget);
    const parsed = parseModelJson(raw);

    // Apply the model's readings onto the scoped goals (sharpened/shortName/kind).
    const mergeSuggestion = applyReadings(parsed, scopedGoals);

    const { lines: newLines, goalToLine } = validateLinesStations(parsed, userData, scopedGoals, colorStart);
    if (!newLines.length && (req.type === 'generate' || req.type === 'add_line')) {
        throw new Error('Model produced no valid lines');
    }
    let newNodes = materializeNodes(parsed, userData, goalToLine);
    if (!newNodes.length && req.type === 'generate') {
        throw new Error('Model produced no valid nodes');
    }
    clampThresholds(newLines, newNodes);

    const challenges = validateChallenges(parsed.challenges, userData);

    // Merge into the existing tree, preserving everything immortal (§9.2).
    const now = nowISO();
    const oldNodes = techTree.nodes || [];
    const oldLines = techTree.lines || [];
    let lines, nodes;

    if (req.type === 'generate') {
        lines = newLines;
        nodes = newNodes;
    } else if (req.type === 'add_line') {
        lines = oldLines.concat(newLines);
        nodes = oldNodes.concat(newNodes);
    } else if (req.type === 'regenerate') {
        const targetLineId = req.payload.lineId;
        const newLine = newLines[0];
        // Keep resolved + reached; replace unclaimed frontier on this line only.
        const keptNodes = oldNodes.filter(n =>
            n.lineId !== targetLineId || n.resolvedAt || n.lifecycle === 'active');
        // Re-point kept nodes to the new line id; carry reached stations forward.
        const oldLine = oldLines.find(l => l.id === targetLineId);
        if (newLine && oldLine) {
            newLine.regeneratedAt = now;
            // Preserve reached stations by index.
            newLine.stations.forEach(st => {
                const prev = (oldLine.stations || []).find(o => o.index === st.index && o.reachedAt);
                if (prev) st.reachedAt = prev.reachedAt;
            });
            keptNodes.forEach(n => { if (n.lineId === targetLineId) n.lineId = newLine.id; });
        }
        lines = oldLines.map(l => l.id === targetLineId ? (newLine || l) : l);
        nodes = keptNodes.concat(newNodes);
    } else { // revise
        const ids = new Set((req.payload.nodeIds) || []);
        const keptNodes = oldNodes.filter(n => !ids.has(n.id) || n.resolvedAt || n.lifecycle === 'active');
        // revise keeps existing lines; only swap flagged nodes' payloads/titles.
        lines = oldLines;
        // Re-home revised nodes onto their original lines/segments where possible.
        const flaggedOld = oldNodes.filter(n => ids.has(n.id));
        newNodes.forEach((nn, i) => {
            const old = flaggedOld[i];
            if (old) { nn.lineId = old.lineId; nn.segmentIndex = old.segmentIndex; }
        });
        nodes = keptNodes.concat(newNodes);
    }

    const connections = buildConnections(nodes);

    const update = {
        'techTree.schemaVersion': 2,
        'techTree.status': 'ready',
        'techTree.goals': techTree.goals,        // readings mutate goal objects in place
        'techTree.lines': lines,
        'techTree.nodes': nodes,
        'techTree.connections': connections,
        'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
        'techTree.lastError': admin.firestore.FieldValue.delete(),
        'techTree.lastGeneratedAt': now,
        'techTree.suggestedChallenges': challenges,
    };
    if (req.type === 'revise') {
        update['techTree.revisionsUsed'] = (techTree.revisionsUsed || 0) + 1;
    }
    if (parsed.vision && (req.type === 'generate')) update['techTree.vision'] = parsed.vision;
    else if (parsed.vision && !techTree.vision) update['techTree.vision'] = parsed.vision;
    if (mergeSuggestion) update['techTree.mergeSuggestion'] = mergeSuggestion;

    await docRef.update(update);
    console.log(`  Done — ${req.type}: ${newLines.length} line(s), ${newNodes.length} node(s), ${challenges.length} challenge(s)`);
    await sendMapPush(userData, req.type === 'generate' ? 'Your map is ready.' : 'Your map has changed — take a look.');
}

async function processExpand(docRef, userData, req) {
    const techTree = userData.techTree;
    const ids = (req.payload && req.payload.resolvedNodeIds) || [];
    const nodes = techTree.nodes || [];
    const lines = techTree.lines || [];
    const activities = collectActivities(userData);
    const actById = {};
    activities.forEach(({ act }) => { actById[act.id] = act; });

    const added = [];
    const patches = [];

    for (const id of ids) {
        const resolved = nodes.find(n => n.id === id && n.resolvedAt);
        if (!resolved) continue;
        // §10.8: a resolved fresh pick has nothing to converge toward.
        if (!resolved.lineId) continue;
        const line = lines.find(l => l.id === resolved.lineId);
        if (!line) continue;

        // §7.7: a recurring quest node that just resolved / gained clean cycles
        // may earn a quest_patch proposal instead of new sibling nodes.
        if (resolved.payload && resolved.payload.type === 'quest'
            && resolved.payload.spec && resolved.payload.spec.cadence.type === 'recurring'
            && resolved.payload.projectId) {
            const proj = (userData.projects || []).find(p => p.id === resolved.payload.projectId);
            if (proj && cleanCycleCount(proj) >= 4) {
                const patch = await tryQuestPatch(userData, proj, resolved);
                if (patch) { patches.push(patch); continue; }
            }
        }

        // Fan 2-3 sibling nodes into the resolved node's segment (§7.2).
        const nextStation = (line.stations || []).find(s => s.index >= resolved.segmentIndex && !s.reachedAt)
            || (line.stations || [])[line.stations.length - 1];
        const segTitles = nodes.filter(n => n.lineId === line.id && n.segmentIndex === resolved.segmentIndex).map(n => n.title);
        const act = resolved.payload.activityId ? actById[resolved.payload.activityId] : null;
        const ctx = {
            resolved,
            terminusTitle: line.terminus.title,
            stationTitle: nextStation ? nextStation.title : line.terminus.title,
            segmentTitles: segTitles,
            activityHistory: act ? { completions: act.completionCount || 0, streak: act.currentStreak || 0 } : null,
        };
        const prompt = buildExpandPrompt(userData, ctx);
        const budget = (PROVIDER.maxTokens && PROVIDER.maxTokens.expand) || MAX_TOKENS.expand;
        let parsed;
        try {
            parsed = parseModelJson(await callModel(prompt, budget));
        } catch (e) {
            console.warn('  expand parse failed:', e.message);
            continue;
        }
        const goalToLine = {}; goalToLine[line.goalId] = line;
        // Force every emitted node onto this segment (monotonic §7.4).
        (parsed.nodes || []).forEach(n => { n.goalId = line.goalId; if (n.segmentIndex == null) n.segmentIndex = resolved.segmentIndex; });
        let fanned = materializeNodes({ nodes: parsed.nodes, interchanges: [] }, userData, goalToLine).slice(0, 3);
        fanned.forEach(n => { n.parentNodeId = resolved.id; n.segmentIndex = resolved.segmentIndex; });
        added.push.apply(added, fanned);
    }

    const update = {
        'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
        'techTree.lastError': admin.firestore.FieldValue.delete(),
        'techTree.lastExpandAt': nowISO(),
        'techTree.status': 'ready',
    };
    if (added.length) {
        const allNodes = nodes.concat(added);
        update['techTree.nodes'] = allNodes;
        update['techTree.connections'] = buildConnections(allNodes);
    }
    if (patches.length) {
        update['techTree.questPatches'] = (techTree.questPatches || []).concat(patches);
    }
    await docRef.update(update);
    console.log(`  Done — expand: ${added.length} new node(s), ${patches.length} patch proposal(s)`);
    if (added.length) await sendMapPush(userData, 'Resolving a node opened new paths on your map.');
    else if (patches.length) await sendMapPush(userData, 'A quest is ready to grow.');
}

// §7.7 quest patch — a proposal, never a silent write. Ops: add_group only here.
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
        const raw = await callModel({ system, user: 'INPUT:\n' + JSON.stringify(input) }, MAX_TOKENS.quest_patch);
        let text = String(raw).trim().replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
        parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    } catch (e) { return null; }
    if (!parsed || parsed.skip || parsed.op !== 'add_group' || !parsed.group) return null;
    const ctx = {
        dimIds: new Set((userData.dimensions || []).map(d => d.id)),
        pathIds: new Set(), activityIds: new Set(collectActivities(userData).map(e => e.act.id)),
        fallbackDim: (userData.dimensions || [])[0] ? userData.dimensions[0].id : 'uncategorized',
    };
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

// Connections mirror prerequisite edges for rendering.
function buildConnections(nodes) {
    const byId = {};
    nodes.forEach(n => { byId[n.id] = n; });
    const out = [];
    nodes.forEach(n => {
        (n.prerequisites || []).forEach(pr => {
            if (pr.type === 'node_mastered' && byId[pr.nodeId]) out.push({ fromNodeId: pr.nodeId, toNodeId: n.id });
        });
    });
    return out;
}

// Suggested challenges reference existing activities only (spec kept from v1).
function validateChallenges(rawChallenges, userData) {
    const activityIds = new Set();
    collectActivities(userData).forEach(({ act }) => activityIds.add(act.id));
    const out = [];
    for (const raw of (rawChallenges || [])) {
        if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) continue;
        const targets = {};
        Object.entries(raw.activityTargets || {}).forEach(([id, n]) => {
            if (activityIds.has(id)) targets[id] = Math.min(100, Math.max(1, parseInt(n, 10) || 1));
        });
        if (!Object.keys(targets).length) continue;
        out.push({
            id: newId('ttc'),
            title: String(raw.title).trim().slice(0, 80),
            description: String(raw.description || '').slice(0, 200),
            durationDays: Math.min(180, Math.max(7, parseInt(raw.durationDays, 10) || 30)),
            activityTargets: targets,
            status: 'suggested',
            createdAt: nowISO(),
        });
        if (out.length >= 3) break;
    }
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
    console.log('Map (Tech Tree) worker v2 run at', nowISO());
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
                    // §10.13: after 3 attempts, surface an error + retry affordance.
                    await docSnap.ref.update({
                        'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
                        'techTree.status': (userData.techTree.lines && userData.techTree.lines.length) ? 'ready' : 'error',
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
}

main()
    .then(() => process.exit(0))
    .catch(err => { console.error('Fatal error:', err); process.exit(1); });
