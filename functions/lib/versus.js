'use strict';

// ══════════════════════════════════════════════════════════════════════════
// VERSUS CHALLENGE RESOLUTION
// ══════════════════════════════════════════════════════════════════════════
//
// Until now every Versus Challenge resolved lazily, on whichever client
// happened to open the app after the deadline. That is fine for the numbers —
// the document is the record and it settles eventually — but it is useless for
// a notification: nothing fires if neither participant opens the app, so the
// push about a challenge you just lost could arrive days late or never.
//
// So resolution moves here, and this module is deliberately PURE: it takes a
// challenge document and returns the patch that resolves it, or null. No
// Firestore, no clock of its own, no pushes. That is what makes the rules the
// money depends on testable, and it keeps index.js's scheduled job to nothing
// but "query, patch, notify".
//
// The logic is a direct port of vsResolveDeadline / vsTerminatePending /
// vsBuildResolution in app.js. It has to stay a port: both runtimes write the
// same documents, and a divergence would mean two clients and one scheduler
// disagreeing about who won. The rules in firestore.rules are the third copy
// of the same contract, and they are the one that actually stops a bad write
// — this module runs with admin credentials and is not checked by them, so
// anything relaxed here is relaxed for real.
//
// Grit is NOT moved here. Resolution records what is owed in `payout` and
// zeroes the pot; each participant's own client claims its half, exactly as
// before (app.js vsClaimPayout). A server-side credit would need to write
// another user's balance document, which nothing in this codebase does.

/**
 * Capped per requirement: excess completions never inflate a total. The
 * stored counters are already capped on write; this is the read-side belt to
 * the same braces, and what resolution compares.
 */
function cappedTotal(challenge, uid) {
    const prog = (challenge.progress && challenge.progress[uid]) || {};
    return (challenge.requirements || []).reduce(
        (sum, req) => sum + Math.min(prog[req.reqId] || 0, req.targetCount || 0),
        0
    );
}

/** Every requirement at or past its target. An empty list is never complete. */
function hasCompleted(challenge, uid) {
    const prog = (challenge.progress && challenge.progress[uid]) || {};
    const reqs = challenge.requirements || [];
    if (!reqs.length) return false;
    return reqs.every((req) => (prog[req.reqId] || 0) >= (req.targetCount || 0));
}

/** The participant who is not `uid`. */
function otherParticipant(challenge, uid) {
    const p = challenge.participants || [];
    return p[0] === uid ? p[1] : p[0];
}

/** A display name, read off the document's own denormalized map. */
function displayName(challenge, uid) {
    return (challenge.names && challenge.names[uid]) || 'Your opponent';
}

/**
 * The terminal patch for an active challenge.
 *
 * A tie refunds both stakes whole — no coin flip, because a wager where
 * nobody lost should not manufacture a loser.
 */
function buildResolution(challenge, winnerUid, outcome, now) {
    const participants = challenge.participants || [];
    const payout = {};
    participants.forEach((uid) => { payout[uid] = 0; });
    if (winnerUid) {
        payout[winnerUid] = challenge.pot;
    } else {
        participants.forEach((uid) => {
            payout[uid] = Math.round(challenge.pot / participants.length);
        });
    }
    return {
        status: 'resolved',
        winner: winnerUid || null,
        outcome,
        resolvedAt: now,
        pot: 0,
        payout,
    };
}

/**
 * Resolve an ACTIVE challenge whose deadline has passed.
 * @returns {object|null} the patch, or null when the challenge is not due.
 */
function resolveDeadlinePatch(challenge, now) {
    if (!challenge || challenge.status !== 'active') return null;
    if (!challenge.endsAt || now <= challenge.endsAt) return null;

    const p = challenge.participants || [];
    if (p.length !== 2) return null;
    const [a, b] = p;

    // Re-derive both totals from the counters rather than trusting the
    // denormalised value, and re-apply the per-requirement cap.
    const ta = cappedTotal(challenge, a);
    const tb = cappedTotal(challenge, b);

    // A side that quietly reached every target without the resolving write
    // landing still wins outright.
    const doneA = hasCompleted(challenge, a);
    const doneB = hasCompleted(challenge, b);

    if (doneA && !doneB) return buildResolution(challenge, a, 'completed_first', now);
    if (doneB && !doneA) return buildResolution(challenge, b, 'completed_first', now);
    if (ta > tb)         return buildResolution(challenge, a, 'deadline_lead', now);
    if (tb > ta)         return buildResolution(challenge, b, 'deadline_lead', now);
    return buildResolution(challenge, null, 'tie_refund', now);
}

/**
 * Expire a PENDING invite nobody answered.
 *
 * Only the challenger has paid while a challenge is pending — escrow happens
 * at invite — so the whole pot is owed back to them.
 * @returns {object|null} the patch, or null when the invite has not expired.
 */
function expirePendingPatch(challenge, now) {
    if (!challenge || challenge.status !== 'pending') return null;
    if (!challenge.expiresAt || now <= challenge.expiresAt) return null;

    const payout = {};
    (challenge.participants || []).forEach((uid) => { payout[uid] = 0; });
    payout[challenge.createdBy] = challenge.pot;

    return {
        status: 'expired',
        outcome: 'expired_refund',
        winner: null,
        resolvedAt: now,
        pot: 0,
        payout,
    };
}

/**
 * What to tell one participant about a resolved challenge.
 *
 * Names the outcome from that person's side, the way Pact resolution names
 * who fell short: both people already know who is who, and softening it would
 * undercut the point of staking anything.
 */
function resolutionBody(challenge, uid) {
    const name = challenge.name || 'your challenge';
    const them = displayName(challenge, otherParticipant(challenge, uid));
    const mine = cappedTotal(challenge, uid);
    const theirs = cappedTotal(challenge, otherParticipant(challenge, uid));
    const score = ' ' + mine + '–' + theirs + '.';

    if (challenge.outcome === 'forfeit') {
        return challenge.forfeitedBy === uid
            ? 'You forfeited “' + name + '”. The pot goes to ' + them + '.'
            : them + ' forfeited “' + name + '”. The whole pot is yours.';
    }
    if (challenge.outcome === 'tie_refund') {
        return '“' + name + '” ended level' + score + ' Both stakes come back whole.';
    }
    if (challenge.winner === uid) {
        return 'You won “' + name + '”' + score + ' The pot is yours — open Mindkraft to claim it.';
    }
    return them + ' won “' + name + '”' + score + ' Your stake is gone.';
}

module.exports = {
    cappedTotal,
    hasCompleted,
    otherParticipant,
    displayName,
    buildResolution,
    resolveDeadlinePatch,
    expirePendingPatch,
    resolutionBody,
};
