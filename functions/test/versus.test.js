'use strict';

// Versus resolution decides where a real Grit pot goes, and it now runs in two
// places: the client's own transaction and the scheduled resolver. These tests
// pin the half that moved server-side — the rules that say who won, what is
// owed, and when a challenge is not due at all.
//
// The pot invariant is the one that matters most, and firestore.rules enforces
// it for client writes (`potConserved`). The scheduler writes with admin
// credentials and is NOT checked by those rules, so every case below asserts
// it directly: pot zeroed, and the payouts summing back to exactly what the
// pot held.

const test = require('node:test');
const assert = require('node:assert');

const {
    cappedTotal,
    hasCompleted,
    buildResolution,
    resolveDeadlinePatch,
    expirePendingPatch,
    resolutionBody,
} = require('../lib/versus');

const A = 'uid-alice';
const B = 'uid-bob';
const NOW = 1_800_000_000_000;

function challenge(overrides) {
    return Object.assign({
        status: 'active',
        name: 'Ten runs',
        createdBy: A,
        opponent: B,
        participants: [A, B],
        stake: 50,
        pot: 100,
        requirements: [
            { reqId: 'r1', targetCount: 3 },
            { reqId: 'r2', targetCount: 2 },
        ],
        progress: { [A]: {}, [B]: {} },
        totals: { [A]: 0, [B]: 0 },
        names: { [A]: 'Alice', [B]: 'Bob' },
        payout: { [A]: 0, [B]: 0 },
        winner: null,
        outcome: null,
        startedAt: NOW - 10 * 86400000,
        endsAt: NOW - 1000,
        expiresAt: NOW - 20 * 86400000,
    }, overrides || {});
}

/** Pot conserved: zeroed, and the payouts add back up to what it held. */
function assertPotConserved(before, patch) {
    assert.strictEqual(patch.pot, 0, 'pot must be zeroed');
    const paid = Object.values(patch.payout).reduce((s, n) => s + n, 0);
    assert.strictEqual(paid, before.pot, 'payouts must sum to the pot');
    Object.values(patch.payout).forEach((n) =>
        assert.ok(n >= 0, 'no negative payout'));
}

test('cappedTotal never counts past a requirement target', () => {
    const ch = challenge({ progress: { [A]: { r1: 99, r2: 1 }, [B]: {} } });
    assert.strictEqual(cappedTotal(ch, A), 4);   // 3 capped + 1
    assert.strictEqual(cappedTotal(ch, B), 0);
});

test('hasCompleted needs every requirement, and is false with none', () => {
    assert.strictEqual(hasCompleted(challenge({ progress: { [A]: { r1: 3, r2: 2 } } }), A), true);
    assert.strictEqual(hasCompleted(challenge({ progress: { [A]: { r1: 3, r2: 1 } } }), A), false);
    assert.strictEqual(hasCompleted(challenge({ requirements: [] }), A), false);
});

test('an active challenge before its deadline is not due', () => {
    assert.strictEqual(resolveDeadlinePatch(challenge({ endsAt: NOW + 1000 }), NOW), null);
});

test('a challenge that is not active is never resolved by the deadline pass', () => {
    ['pending', 'resolved', 'declined', 'cancelled', 'expired'].forEach((status) => {
        assert.strictEqual(resolveDeadlinePatch(challenge({ status }), NOW), null, status);
    });
});

test('a side that hit every target wins outright, even from behind on nothing', () => {
    const ch = challenge({ progress: { [A]: { r1: 3, r2: 2 }, [B]: { r1: 3 } } });
    const patch = resolveDeadlinePatch(ch, NOW);
    assert.strictEqual(patch.status, 'resolved');
    assert.strictEqual(patch.outcome, 'completed_first');
    assert.strictEqual(patch.winner, A);
    assert.strictEqual(patch.payout[A], 100);
    assert.strictEqual(patch.payout[B], 0);
    assertPotConserved(ch, patch);
});

test('neither side complete — the higher capped total takes it', () => {
    const ch = challenge({ progress: { [A]: { r1: 1 }, [B]: { r1: 3 } } });
    const patch = resolveDeadlinePatch(ch, NOW);
    assert.strictEqual(patch.outcome, 'deadline_lead');
    assert.strictEqual(patch.winner, B);
    assert.strictEqual(patch.payout[B], 100);
    assertPotConserved(ch, patch);
});

test('level at the deadline refunds both stakes whole, with no winner', () => {
    const ch = challenge({ progress: { [A]: { r1: 2 }, [B]: { r2: 2 } } });
    const patch = resolveDeadlinePatch(ch, NOW);
    assert.strictEqual(patch.outcome, 'tie_refund');
    assert.strictEqual(patch.winner, null);
    assert.strictEqual(patch.payout[A], 50);
    assert.strictEqual(patch.payout[B], 50);
    assertPotConserved(ch, patch);
});

test('a stuffed counter cannot buy a win — the cap is re-applied on read', () => {
    // B logged r1 fifty times against a target of 3. Uncapped that is a
    // landslide; capped it is a tie, and a tie refunds.
    const ch = challenge({
        progress: { [A]: { r1: 2, r2: 1 }, [B]: { r1: 50 } },
        totals: { [A]: 3, [B]: 50 },
    });
    const patch = resolveDeadlinePatch(ch, NOW);
    assert.strictEqual(patch.outcome, 'tie_refund');
    assertPotConserved(ch, patch);
});

test('resolution ignores the denormalised totals entirely', () => {
    const ch = challenge({
        progress: { [A]: { r1: 3, r2: 2 }, [B]: {} },
        totals: { [A]: 0, [B]: 999 },       // a lie on the document
    });
    assert.strictEqual(resolveDeadlinePatch(ch, NOW).winner, A);
});

test('an unanswered invite expires and refunds the challenger in full', () => {
    const ch = challenge({ status: 'pending', pot: 50, expiresAt: NOW - 1 });
    const patch = expirePendingPatch(ch, NOW);
    assert.strictEqual(patch.status, 'expired');
    assert.strictEqual(patch.outcome, 'expired_refund');
    assert.strictEqual(patch.winner, null);
    assert.strictEqual(patch.payout[A], 50);
    assert.strictEqual(patch.payout[B], 0);
    assertPotConserved(ch, patch);
});

test('a pending invite still inside its window is not expired', () => {
    assert.strictEqual(
        expirePendingPatch(challenge({ status: 'pending', expiresAt: NOW + 1 }), NOW),
        null
    );
});

test('an accepted challenge is never touched by the expiry pass', () => {
    assert.strictEqual(expirePendingPatch(challenge({ status: 'active' }), NOW), null);
});

test('buildResolution hands a named winner the whole pot', () => {
    const ch = challenge({ pot: 100 });
    const patch = buildResolution(ch, B, 'forfeit', NOW);
    assert.strictEqual(patch.payout[B], 100);
    assert.strictEqual(patch.payout[A], 0);
    assert.strictEqual(patch.resolvedAt, NOW);
    assertPotConserved(ch, patch);
});

test('resolution copy names the outcome from each side', () => {
    const won = challenge({ status: 'resolved', winner: A, outcome: 'deadline_lead',
        progress: { [A]: { r1: 3 }, [B]: { r1: 1 } } });
    assert.match(resolutionBody(won, A), /^You won/);
    assert.match(resolutionBody(won, B), /^Alice won/);

    const tied = challenge({ status: 'resolved', winner: null, outcome: 'tie_refund' });
    assert.match(resolutionBody(tied, A), /ended level/);

    const forfeited = challenge({ status: 'resolved', winner: A, outcome: 'forfeit',
        forfeitedBy: B });
    assert.match(resolutionBody(forfeited, B), /^You forfeited/);
    assert.match(resolutionBody(forfeited, A), /^Bob forfeited/);
});

test('resolution copy survives a missing opponent name', () => {
    const ch = challenge({ status: 'resolved', winner: A, outcome: 'deadline_lead', names: {} });
    assert.match(resolutionBody(ch, B), /Your opponent won/);
});
