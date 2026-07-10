// ── Tech Tree generation worker ────────────────────────────────────────────
// Runs on a GitHub Actions schedule (see .github/workflows/tech-tree-worker.yml).
// Picks up userData.techTree.pendingRequest flags written by the client, builds
// the prompt from the user's REAL Firestore data (never trusts client-supplied
// context), calls the model through the isolated adapter below, validates the
// response, writes the resulting nodes back, and clears the flag. The worker is
// the sole authority on cooldowns — a tampered client can write a request, but
// only this script decides whether it's honored.

const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Provider selection ─────────────────────────────────────────────────────
// NVIDIA's hosted NIM endpoint black-holes connections from GitHub-hosted
// runners (requests hang until timeout), so Groq — same Llama 3.3 70B model,
// OpenAI-compatible API, free tier that works from Actions — is preferred
// whenever its key is configured. Both providers speak the chat-completions
// format, so everything outside this block is provider-agnostic.
// Secrets pasted into GitHub often carry a trailing newline — an invalid
// Authorization header makes undici fail with an opaque "fetch failed".
const PROVIDERS = [
    {
        name: 'groq',
        key: (process.env.GROQ_API_KEY || '').trim(),
        base: 'https://api.groq.com/openai/v1',
        model: process.env.TECH_TREE_MODEL || 'llama-3.3-70b-versatile',
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
const PROVIDER = PROVIDERS.find(p => p.key) || PROVIDERS[0];
const MAX_NODES        = 20;  // hard cap across all goals; scope decides the real count
const REGEN_FREE_DAYS  = 30;
const REVISION_LIMIT   = 2;
// Planning-quality output is the priority over token cost (owner's call) —
// budgets sized for multi-goal chains + challenges + vision.
const MAX_TOKENS       = { generate: 7000, regenerate: 3500, revision: 1500 };

// ── Helpers over the user's schema ─────────────────────────────────────────

function collectActivities(userData) {
    const out = [];
    (userData.dimensions || []).forEach(dim =>
        (dim.paths || []).forEach(path =>
            (path.activities || []).forEach(act => out.push({ act, dim, path }))));
    return out;
}

function masteryThresholdFor(act) {
    const defaults = {
        daily:      { count: 15, windowDays: 30 },
        weekly:     { count: 6,  windowDays: 90 },
        biweekly:   { count: 4,  windowDays: 120 },
        monthly:    { count: 3,  windowDays: 180 },
        occasional: { count: 3,  windowDays: null },
        'one-time': { count: 3,  windowDays: null },
        custom:     { count: 6,  windowDays: 90 },
    };
    return act.techTreeMastery || defaults[act.frequency] || defaults.daily;
}

function isActivityMastered(act) {
    return !!act.techTreeMasteredAt;
}

function newNodeId() {
    return 'ttn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── Cooldown / gate enforcement (spec §11) ─────────────────────────────────

function canProcessRequest(req, techTree, userData) {
    const activities = collectActivities(userData);
    if (req.type === 'generate') {
        if (!techTree.goalText || !techTree.goalText.trim()) return 'No goal set — add a goal first.';
        if (activities.length < 3) return 'Need at least 3 active activities.';
        return null;
    }
    if (req.type === 'regenerate') {
        if (techTree.status !== 'generated') return 'Nothing to regenerate yet.';
        const last = techTree.lastGeneratedAt ? new Date(techTree.lastGeneratedAt).getTime() : 0;
        const ageDays = (Date.now() - last) / 86400000;
        if (ageDays < REGEN_FREE_DAYS && !(req.paidXP > 0)) return 'Regenerate is free every 30 days — or costs XP before that.';
        return null;
    }
    if (req.type === 'revision') {
        if (techTree.status !== 'generated') return 'Nothing to revise yet.';
        if ((techTree.revisionsUsedSinceGeneration || 0) >= REVISION_LIMIT) return 'Revision limit reached (2 per generation).';
        if (!techTree.revisionWindowExpiresAt || Date.now() > new Date(techTree.revisionWindowExpiresAt).getTime())
            return 'Revision window (24h after generation) has expired.';
        if (!req.note || !String(req.note).trim()) return 'Revision needs a correction note.';
        return null;
    }
    return 'Unknown request type.';
}

// ── Prompt building (spec §13/§16) ─────────────────────────────────────────

function buildTechTreePrompt(userData, req, nodeCount) {
    const techTree = userData.techTree;
    const activities = collectActivities(userData);

    const dimensionList = (userData.dimensions || []).map(d => ({ dimensionId: d.id, name: d.name }));
    const pathList = [];
    (userData.dimensions || []).forEach(d =>
        (d.paths || []).forEach(p => pathList.push({ pathId: p.id, name: p.name, dimensionId: d.id })));

    const activeActivities = activities.map(({ act, dim }) => {
        const threshold = masteryThresholdFor(act);
        return {
            activityId: act.id,
            name: act.name,
            description: act.description || '',
            dimensionId: dim.id,
            frequency: act.frequency,
            totalCompletions: act.completionCount || 0,
            mastered: isActivityMastered(act),
            masteryTarget: threshold.count,
        };
    });

    const activeNodes = (techTree.nodes || [])
        .filter(n => n.lifecycle === 'active')
        .map(n => n.title);
    const archivedNodes = (techTree.nodes || [])
        .filter(n => n.lifecycle === 'archived')
        .map(n => n.title);

    let system = `You are the Tech Tree generation engine for Mindkraft, a life-gamification app.
Your job: turn the user's stated goal(s) into an achievable, actionable plan —
a tree of unlockable activities plus optional milestone challenges — and paint
the exciting future it leads to.

PROCESS (do this reasoning silently; output only the JSON):
1. Read goalText and identify each DISTINCT goal in it (there may be several).
2. Judge each goal's SCOPE and TIME HORIZON, and size its plan PROPORTIONALLY
   — goals are NOT equal and must not get equal treatment:
   - SMALL (start this week — e.g. "begin a calisthenics routine"): 1-2
     foundational nodes. Do not pad small goals.
   - MEDIUM (weeks to a few months — e.g. "save for a purchase over 4
     months"): a short chain of 2-3 tiers, 2-4 nodes.
   - LARGE (many months to a year+ — e.g. "write a book", "start a YouTube
     channel"): a real plan — 4-5 tiers and typically 5-8 nodes, including
     parallel branches that CONVERGE: high-tier nodes should carry heavier
     prerequisites, often requiring 2-3 separate tier 2-3 nodes to all be
     mastered (e.g. tier 4 "Complete a full first draft" requires tier 3
     "Finish a chapter a month" AND tier 2 "Weekly plot outlining"). The
     final tier is the CAPSTONE: the activity that means actually living
     the goal. Weight: the longer the horizon, the deeper and wider the
     chain, and the heavier the prerequisites near the top.
3. Anchor chains in what the user already does: when an existing activity
   genuinely supports a chain's first steps, connect it with an
   activity_mastered prerequisite (by its given activityId).
4. Additionally propose 1-3 FRESH PICKS: standalone, tier-1, no-prerequisite
   activities that are NOT part of any goal chain — genuinely new things
   that would complement this user's life given their goals and current
   activities (e.g. a recovery habit for someone training hard). Mark them
   by simply giving them an empty prerequisites array and a distinct kind
   of value; never disguise a chain step as a fresh pick.
5. Consider proposing milestone CHALLENGES (see CHALLENGES below).

NODE RULES:
1. Output ONLY valid JSON matching the schema below. No prose, no markdown fences.
2. Every node must be a GENUINELY NEW, CONCRETE activity — a specific behavior
   the user could tick off ("Record a practice video weekly"), never a vague
   umbrella or a summary of things they already do ("Follow a routine",
   "Improve your health", "Stay consistent"). If a draft merely combines or
   rebrands its prerequisites, discard it and propose the NEXT thing those
   habits unlock instead.
3. Do NOT force connections. A prerequisite must genuinely enable the new
   activity — never link nodes just to make the tree look connected. Chains
   come from real dependency; small goals stay foundational (empty
   prerequisites). Never cross-link two unrelated goals' chains.
4. VARY THE KIND of activity across your output — physical, mental, social,
   skill-building, creative, event/milestone. No two nodes may serve nearly
   the same purpose or differ only in intensity/timing.
5. You may combine activities across Dimensions into a "nexus" node
   (isNexus: true, nexusDimensionIds listing every Dimension involved) when it
   creates a genuinely meaningful new activity.
6. If a given activity's name and description together are too ambiguous to
   confidently use, do not reference it in any prerequisite — omit it from
   your reasoning entirely rather than guessing.
7. For every new node, assign a plausible dimensionId and, if a provided Path
   plausibly fits, a suggestedPathId — otherwise null.
8. Suggest frequency (one of: daily, weekly, biweekly, monthly, occasional),
   baseXP (integer 1-50), and a short description consistent with the
   style/scale of the user's existing activities.
9. Total nodes across all goals: at least 3, at most ${nodeCount} — let each
   goal's scope decide the count; never pad to reach the cap.
10. Do not repeat or rename anything listed under already-active or
    already-archived nodes — propose only genuinely new suggestions.
11. A node may depend on another node IN YOUR OUTPUT via
    {"type":"node_mastered","nodeTitle":"<exact title of that other node>"}.
    A node may depend on a real existing activity via
    {"type":"activity_mastered","activityId":"<id from activeActivities>"}.
    Never invent IDs.

CHALLENGES (milestones, distinct from tree nodes):
A challenge is a time-boxed milestone tracking completions of EXISTING
activities only — e.g. "Log 20 runs in 60 days". Where a tree node is a new
action unlocked by mastering what came before, a challenge paces what the
user already does toward a goal. Propose 0-3 TOTAL — and only where a goal
genuinely has scope for one (a pace-able, repetition-driven goal). Many goals
deserve none; NEVER hand one challenge to each goal just to be even-handed.
Reference ONLY activityIds from activeActivities — never nodes or invented
activities. Use existingChallenges to understand what pace this user responds
to, and never duplicate one.

VISION:
Also write "vision": 1-2 sentences, second person, vivid and specific to
their goals — the snapshot of the life these paths lead to. No generic
motivation-poster fluff.

OUTPUT SCHEMA (a single JSON object, nothing else):
{ "vision": string,
  "nodes": [{ "title": string, "description": string, "dimensionId": string,
    "isNexus": boolean, "nexusDimensionIds": string[],
    "prerequisites": [{"type":"node_mastered","nodeTitle":string} | {"type":"activity_mastered","activityId":string}],
    "suggestedActivity": { "name": string, "description": string, "baseXP": number,
      "frequency": string, "dimensionId": string, "suggestedPathId": string|null } }],
  "challenges": [{ "title": string, "description": string, "durationDays": number,
    "activityTargets": { "<activityId>": number } }] }`;

    const existingChallenges = (userData.challenges || []).map(ch => ({
        name: ch.name,
        status: ch.status,
        activityIds: ch.activityIds || [],
        activityTargets: ch.activityTargets || {},
    }));

    const input = {
        goalText: techTree.goalText,
        dimensions: dimensionList,
        paths: pathList,
        activeActivities,
        existingChallenges,
    };
    if (req.type === 'regenerate' || req.type === 'revision') {
        input.activeTreeNodes = activeNodes;
        input.archivedTreeNodes = archivedNodes;
    }
    if (req.type === 'revision') {
        const flagged = (techTree.nodes || []).filter(n => (req.nodeIds || []).includes(n.id));
        input.nodesToRevise = flagged.map(n => ({
            title: n.title,
            description: n.description,
            dimensionId: n.dimensionId,
        }));
        input.userCorrectionNote = String(req.note).slice(0, 240);
        system += `

REVISION MODE: The user flagged the node(s) in "nodesToRevise" with the
targeted feedback in "userCorrectionNote". Return the same JSON object shape
with "nodes" containing replacement node(s) ONLY for the flagged one(s) —
exactly ${nodeCount} node(s) — plus "challenges": [] and "vision": null.
The replacement must directly address the feedback (not a light rewording of
the original), while still following every rule above.`;
    }

    return { system, user: 'INPUT:\n' + JSON.stringify(input, null, 2) };
}

// ── Model adapter (spec §16) ───────────────────────────────────────────────
// The ONLY place that knows about NVIDIA NIM's request/response shape. To move
// to Anthropic/OpenAI/a Cloud Function later, swap this function alone.

// undici buries the real network failure (DNS, TLS, timeout, invalid header)
// in the .cause chain behind a generic "fetch failed" — unwrap it so both the
// Actions log and the in-app error say what actually went wrong.
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

// undici's default header timeout is 300s — a black-holed connection would
// hang each attempt for 5 minutes and blow through the job's time limit
// before the worker can write the error state back to Firestore. Every fetch
// gets a hard deadline instead.
const FETCH_TIMEOUT_MS = 45000;

async function callTechTreeModel(prompt, maxTokens) {
    if (!PROVIDER.key) {
        throw new Error(PROVIDER.keyHint + ' secret is missing or empty — add it under repo Settings → Secrets and variables → Actions');
    }

    async function once(tokens) {
        const res = await fetch(PROVIDER.base + '/chat/completions', {
            method: 'POST',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
            headers: {
                'Authorization': 'Bearer ' + PROVIDER.key,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
            },
            body: JSON.stringify({
                model: PROVIDER.model,
                messages: [
                    { role: 'system', content: prompt.system },
                    { role: 'user', content: prompt.user },
                ],
                temperature: 0.6,
                top_p: 0.9,
                max_tokens: tokens,
            }),
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

    // Network-level failures get 3 attempts with backoff before giving up.
    async function onceWithRetry(tokens) {
        let lastErr;
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                return await once(tokens);
            } catch (err) {
                lastErr = err;
                if (!isNetworkError(err)) throw err;
                console.warn(`  Network error (attempt ${attempt}/3): ${describeError(err)}`);
                if (attempt < 3) await sleep(2000 * attempt);
            }
        }
        throw new Error('Could not reach the model API after 3 attempts: ' + describeError(lastErr));
    }

    let result = await onceWithRetry(maxTokens);
    if (result.finishReason === 'length') {
        // Truncated JSON is unusable — retry once with a bigger budget (spec §16).
        console.warn('finish_reason=length — retrying with higher max_tokens');
        result = await onceWithRetry(Math.min(8192, Math.ceil(maxTokens * 2)));
        if (result.finishReason === 'length') throw new Error('Model output truncated twice — giving up this run');
    }
    return result.content;
}

// ── Response validation & node materialization ─────────────────────────────

// Returns { vision, nodes, challenges } — tolerates the model answering with
// either the object schema or a bare node array (older/revision outputs).
function parseModelJson(raw) {
    let text = String(raw).trim();
    // Defensive: strip markdown fences and any prose around the JSON
    text = text.replace(/^```(?:json)?/m, '').replace(/```\s*$/m, '').trim();
    const objStart = text.indexOf('{');
    const arrStart = text.indexOf('[');
    let parsed;
    if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
        parsed = JSON.parse(text.slice(objStart, text.lastIndexOf('}') + 1));
    } else if (arrStart !== -1) {
        parsed = JSON.parse(text.slice(arrStart, text.lastIndexOf(']') + 1));
    } else {
        throw new Error('No JSON in model output');
    }
    if (Array.isArray(parsed)) return { vision: null, nodes: parsed, challenges: [] };
    return {
        vision: typeof parsed.vision === 'string' ? parsed.vision.trim().slice(0, 300) : null,
        nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
        challenges: Array.isArray(parsed.challenges) ? parsed.challenges : [],
    };
}

// Suggested challenges may only reference real, existing activities (never
// suggested nodes) — anything else is dropped rather than guessed at.
function validateChallenges(rawChallenges, userData) {
    const activityIds = new Set();
    collectActivities(userData).forEach(({ act }) => activityIds.add(act.id));
    const out = [];
    for (const raw of rawChallenges) {
        if (!raw || typeof raw.title !== 'string' || !raw.title.trim()) continue;
        const targets = {};
        Object.entries(raw.activityTargets || {}).forEach(([id, n]) => {
            if (activityIds.has(id)) targets[id] = Math.min(100, Math.max(1, parseInt(n, 10) || 1));
        });
        if (!Object.keys(targets).length) continue;
        out.push({
            id: 'ttc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7),
            title: String(raw.title).trim().slice(0, 80),
            description: String(raw.description || '').slice(0, 200),
            durationDays: Math.min(180, Math.max(7, parseInt(raw.durationDays, 10) || 30)),
            activityTargets: targets,
            status: 'suggested',
            createdAt: new Date().toISOString(),
        });
        if (out.length >= 3) break;
    }
    return out;
}

const VALID_FREQUENCIES = ['daily', 'weekly', 'biweekly', 'monthly', 'occasional'];

// Convert raw model output into schema-valid tech tree nodes (spec §4), plus
// auto-materialized nodes for directly-referenced real activities (spec §7).
function materializeNodes(rawNodes, userData) {
    const activities = collectActivities(userData);
    const activityById = {};
    activities.forEach(({ act, dim }) => { activityById[act.id] = { act, dim }; });
    const dimIds = new Set((userData.dimensions || []).map(d => d.id));
    const pathIds = new Set();
    (userData.dimensions || []).forEach(d => (d.paths || []).forEach(p => pathIds.add(p.id)));
    const fallbackDim = (userData.dimensions || [])[0] ? userData.dimensions[0].id : 'uncategorized';
    const existingNodes = (userData.techTree && userData.techTree.nodes) || [];

    if (!Array.isArray(rawNodes) || !rawNodes.length) throw new Error('Model returned an empty node list');

    // First pass — build suggested nodes with resolved dimension/frequency
    const now = new Date().toISOString();
    const built = rawNodes
        .filter(r => r && typeof r.title === 'string' && r.title.trim())
        .map(r => {
            const sug = r.suggestedActivity || {};
            const dimensionId = dimIds.has(r.dimensionId) ? r.dimensionId : fallbackDim;
            const frequency = VALID_FREQUENCIES.includes(sug.frequency) ? sug.frequency : 'weekly';
            return {
                node: {
                    id: newNodeId(),
                    kind: 'suggested',
                    resolvedVia: null,
                    activityId: null,
                    lifecycle: 'locked', // recomputed below
                    dimensionId,
                    isNexus: !!r.isNexus,
                    nexusDimensionIds: Array.isArray(r.nexusDimensionIds)
                        ? r.nexusDimensionIds.filter(id => dimIds.has(id)) : [],
                    tier: 1, // recomputed below
                    prerequisites: [],
                    title: String(r.title).trim().slice(0, 80),
                    description: String(r.description || sug.description || '').slice(0, 240),
                    suggestedActivity: {
                        name: String(sug.name || r.title).trim().slice(0, 80),
                        description: String(sug.description || r.description || '').slice(0, 240),
                        baseXP: Math.min(50, Math.max(1, parseInt(sug.baseXP, 10) || 10)),
                        frequency,
                        dimensionId: dimIds.has(sug.dimensionId) ? sug.dimensionId : dimensionId,
                        suggestedPathId: pathIds.has(sug.suggestedPathId) ? sug.suggestedPathId : null,
                    },
                    source: 'ai',
                    createdAt: now,
                },
                rawPrereqs: Array.isArray(r.prerequisites) ? r.prerequisites : [],
            };
        });

    if (!built.length) throw new Error('No valid nodes in model output');

    const byTitle = {};
    built.forEach(b => { byTitle[b.node.title.toLowerCase()] = b.node; });

    // Auto-materialize referenced real activities as existing-kind nodes (§7)
    const autoNodes = [];
    function nodeForActivity(activityId) {
        const already = existingNodes.find(n => n.activityId === activityId)
            || autoNodes.find(n => n.activityId === activityId);
        if (already) return already;
        const entry = activityById[activityId];
        if (!entry) return null;
        const node = {
            id: newNodeId(),
            kind: 'existing',
            resolvedVia: 'auto_referenced',
            activityId,
            lifecycle: 'active',
            dimensionId: entry.dim.id,
            isNexus: false,
            nexusDimensionIds: [],
            tier: 1,
            prerequisites: [],
            title: entry.act.name,
            description: entry.act.description || '',
            suggestedActivity: null,
            source: 'ai',
            createdAt: now,
        };
        autoNodes.push(node);
        return node;
    }

    // Second pass — resolve prerequisites (drop anything unresolvable rather than guessing)
    built.forEach(b => {
        b.rawPrereqs.forEach(pr => {
            if (!pr || typeof pr !== 'object') return;
            if (pr.type === 'activity_mastered' && activityById[pr.activityId]) {
                nodeForActivity(pr.activityId); // ensure the branch renders (§7)
                b.node.prerequisites.push({ type: 'activity_mastered', activityId: pr.activityId });
            } else if (pr.type === 'node_mastered') {
                const ref = pr.nodeTitle ? byTitle[String(pr.nodeTitle).toLowerCase()] : null;
                if (ref && ref.id !== b.node.id) {
                    b.node.prerequisites.push({ type: 'node_mastered', nodeId: ref.id });
                }
            }
        });
    });

    const suggested = built.map(b => b.node);
    const all = suggested.concat(autoNodes);

    // Tiers: 1 + longest prerequisite chain (activity prereqs anchor at tier 2)
    const byId = {};
    all.concat(existingNodes).forEach(n => { byId[n.id] = n; });
    const memo = {};
    function depth(node, guard) {
        if (memo[node.id] !== undefined) return memo[node.id];
        if (guard[node.id]) return 1;
        guard[node.id] = true;
        let d = 1;
        (node.prerequisites || []).forEach(pr => {
            if (pr.type === 'node_mastered' && byId[pr.nodeId]) d = Math.max(d, 1 + depth(byId[pr.nodeId], guard));
            else if (pr.type === 'activity_mastered') d = Math.max(d, 2);
        });
        delete guard[node.id];
        memo[node.id] = d;
        return d;
    }
    suggested.forEach(n => { n.tier = depth(n, {}); });

    // Lifecycle: available when every prerequisite is already mastered
    function prereqMet(pr) {
        if (pr.type === 'activity_mastered') {
            const entry = activityById[pr.activityId];
            return !!(entry && entry.act.techTreeMasteredAt);
        }
        const target = byId[pr.nodeId];
        if (!target) return true;
        if (target.kind === 'existing' && target.activityId) {
            const entry = activityById[target.activityId];
            return !!(entry && entry.act.techTreeMasteredAt);
        }
        return false; // depends on another fresh suggestion — locked until that's mastered
    }
    suggested.forEach(n => {
        n.lifecycle = (n.prerequisites || []).every(prereqMet) ? 'available' : 'locked';
    });

    // Connections mirror prerequisite edges for rendering
    const activityToNode = {};
    all.concat(existingNodes).forEach(n => { if (n.activityId) activityToNode[n.activityId] = n.id; });
    const connections = [];
    suggested.forEach(n => {
        (n.prerequisites || []).forEach(pr => {
            const fromId = pr.type === 'node_mastered' ? pr.nodeId : activityToNode[pr.activityId];
            if (fromId) connections.push({ fromNodeId: fromId, toNodeId: n.id });
        });
    });

    return { suggested, autoNodes, connections };
}

// ── Per-request processing ─────────────────────────────────────────────────

async function processUser(docRef, userData) {
    const techTree = userData.techTree;
    const req = techTree.pendingRequest;
    console.log(`Processing ${req.type} for user ${docRef.id}`);

    const rejection = canProcessRequest(req, techTree, userData);
    if (rejection) {
        console.log(`  Rejected: ${rejection}`);
        await docRef.update({
            'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
            'techTree.lastError': rejection,
        });
        return;
    }

    const isRevision = req.type === 'revision';
    const flaggedIds = isRevision ? (req.nodeIds || []) : [];
    // Upper bound only — the model sizes the real count from goal scope.
    const nodeCount = req.type === 'generate' ? MAX_NODES
        : req.type === 'regenerate' ? 8
        : Math.max(1, flaggedIds.length);

    const prompt = buildTechTreePrompt(userData, req, nodeCount);
    const raw = await callTechTreeModel(prompt, MAX_TOKENS[req.type] || 2000);
    const parsed = parseModelJson(raw);
    const { suggested, autoNodes, connections } = materializeNodes(parsed.nodes.slice(0, MAX_NODES), userData);
    const suggestedChallenges = isRevision ? null : validateChallenges(parsed.challenges, userData);

    const now = new Date();
    const nowISO = now.toISOString();
    const oldNodes = techTree.nodes || [];
    const oldConnections = techTree.connections || [];
    let nodes, allConnections;

    if (req.type === 'generate') {
        nodes = suggested.concat(autoNodes);
        allConnections = connections;
    } else if (req.type === 'regenerate') {
        // Regenerate only reshapes locked/available/archived suggestions —
        // active (resolved) nodes are permanent (spec §11).
        const kept = oldNodes.filter(n => n.lifecycle === 'active' || n.kind === 'existing');
        const keptIds = new Set(kept.map(n => n.id));
        nodes = kept.concat(suggested, autoNodes.filter(n => !keptIds.has(n.id)));
        const nodeIds = new Set(nodes.map(n => n.id));
        allConnections = oldConnections
            .filter(c => nodeIds.has(c.fromNodeId) && nodeIds.has(c.toNodeId))
            .concat(connections);
    } else {
        // Revision: swap only the flagged suggested node(s)
        const kept = oldNodes.filter(n => !(flaggedIds.includes(n.id) && n.kind === 'suggested'));
        const keptIds = new Set(kept.map(n => n.id));
        nodes = kept.concat(suggested, autoNodes.filter(n => !keptIds.has(n.id)));
        const nodeIds = new Set(nodes.map(n => n.id));
        allConnections = oldConnections
            .filter(c => nodeIds.has(c.fromNodeId) && nodeIds.has(c.toNodeId))
            .concat(connections);
    }

    const update = {
        'techTree.nodes': nodes,
        'techTree.connections': allConnections,
        'techTree.status': 'generated',
        'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
        'techTree.lastError': admin.firestore.FieldValue.delete(),
    };
    if (isRevision) {
        update['techTree.revisionsUsedSinceGeneration'] =
            (techTree.revisionsUsedSinceGeneration || 0) + 1;
    } else {
        update['techTree.lastGeneratedAt'] = nowISO;
        update['techTree.revisionsUsedSinceGeneration'] = 0;
        update['techTree.revisionWindowExpiresAt'] = new Date(now.getTime() + 24 * 3600000).toISOString();
        // Fresh suggestions replace old ones wholesale — accepted challenges
        // already live in userData.challenges, dismissed ones shouldn't linger.
        update['techTree.suggestedChallenges'] = suggestedChallenges;
        if (parsed.vision) update['techTree.vision'] = parsed.vision;
    }
    await docRef.update(update);
    console.log(`  Done — ${suggested.length} new node(s), ${autoNodes.length} auto-referenced, `
        + (suggestedChallenges ? suggestedChallenges.length : 0) + ' challenge(s)'
        + (parsed.vision ? ', vision set' : ''));
}

// ── Main ───────────────────────────────────────────────────────────────────

// One cheap GET through the exact same transport as the generation call —
// separates "network/credentials broken" from "generation logic broken" right
// in the Actions log.
async function nimPreflight() {
    if (!PROVIDER.key) {
        console.error('Preflight: ' + PROVIDER.keyHint + ' secret is missing or empty.');
        return;
    }
    const started = Date.now();
    try {
        const res = await fetch(PROVIDER.base + '/models', {
            signal: AbortSignal.timeout(15000),
            headers: { 'Authorization': 'Bearer ' + PROVIDER.key },
        });
        console.log('Preflight [' + PROVIDER.name + ']: HTTP', res.status, 'in', Date.now() - started, 'ms',
            res.status === 401 ? '(key rejected — check the ' + PROVIDER.keyHint + ' secret)' : '');
    } catch (err) {
        console.error('Preflight [' + PROVIDER.name + '] failed after', Date.now() - started, 'ms:', describeError(err));
    }
}

async function main() {
    console.log('Tech Tree worker run at', new Date().toISOString());
    console.log('Node', process.version, '| provider:', PROVIDER.name, '| model:', PROVIDER.model,
        '| key configured:', PROVIDER.key ? `yes (${PROVIDER.key.length} chars)` : 'NO — set ' + PROVIDER.keyHint);
    // Full-collection scan + in-code filter, same pattern as send-reminders.js
    // (avoids needing a composite index for a '!=' query on a map field).
    const snapshot = await db.collection('users').get();
    const pending = snapshot.docs.filter(d => {
        const u = d.data();
        return u.techTree && u.techTree.pendingRequest;
    });
    let processed = 0, failed = 0;

    if (pending.length) await nimPreflight();

    for (const docSnap of pending) {
        const userData = docSnap.data();
        try {
            await processUser(docSnap.ref, userData);
            processed++;
        } catch (err) {
            failed++;
            console.error(`  Error for user ${docSnap.id}:`, describeError(err));
            // Clear the flag with a user-visible error so the client doesn't
            // sit in "Building your tree…" forever.
            try {
                await docSnap.ref.update({
                    'techTree.pendingRequest': admin.firestore.FieldValue.delete(),
                    'techTree.lastError': 'Generation failed — ' + describeError(err).slice(0, 200),
                });
            } catch (e2) {
                console.error('  Could not write error state:', e2.message);
            }
        }
    }
    console.log(`Done. Processed: ${processed}, failed: ${failed}, scanned: ${snapshot.size}`);
}

// Explicit exit — firebase-admin's gRPC channels can keep the event loop
// alive after the work is done, which would idle the job until its timeout.
main()
    .then(() => process.exit(0))
    .catch(err => { console.error('Fatal error:', err); process.exit(1); });
