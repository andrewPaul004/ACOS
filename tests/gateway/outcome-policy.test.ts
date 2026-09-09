import { describe, expect, it } from 'vitest';

import {
  ECONOMIC_MOVEMENTS,
  POST_DISPATCH_EFFECT_STATUSES,
  UNDECLARED_POLICY_REASONS,
  outcomePolicyFor,
} from '../../src/kernel/gateway/outcomePolicy.js';
import { ADAPTER_OUTCOME_KINDS } from '../../src/kernel/gateway/adapterPort.js';
import { EXPECTED_OUTCOMES, expectedOutcomeFor } from '../support/s1jOutcomeTable.js';
import {
  unsafePolicyCollapsingUnknownToFailed,
  unsafePolicyFromClaimedRecoverability,
  unsafePolicyReleasingReservationOnUnknown,
} from '../negative-controls/unsafe-outcome-policy.js';

/**
 * `25 §10` — THE RECOVERABILITY-KEYED OUTCOME POLICY, AGAINST A HAND-AUTHORED TABLE.
 *
 * =================================================================================
 * THE ORACLE IS `tests/support/s1jOutcomeTable.ts`, AND IT IMPORTS NOTHING.
 *
 * `§41`: "Forbidden: expected outcome read from production recoverability policy; expected
 * state read from production transition table." So the expected answers in this file come
 * from a table transcribed by hand from `25 §10`, `25 §5`, `35 §4` and `24 §3` K4, with the
 * passage on every row — and `production-vs-oracle` is a comparison of two independent
 * readings rather than a function compared with itself.
 *
 * This suite is PURE. No database, no fixture, no clock. `outcomePolicyFor` takes two
 * scalars and returns a decision, so the whole of `25 §10` can be exercised over its
 * complete input space — three classes × three outcome kinds, all nine — which is the one
 * thing an integration test cannot do cheaply.
 * =================================================================================
 */

const CLASSES = ['REVERSIBLE', 'COMPENSABLE', 'IRRECOVERABLE'] as const;

describe('`25 §10` — the complete input space, against the hand-authored table', () => {
  it('the oracle is exhaustive: nine rows, three classes × three outcome kinds', () => {
    expect(EXPECTED_OUTCOMES).toHaveLength(9);
    expect([...ADAPTER_OUTCOME_KINDS]).toEqual([
      'ADAPTER_RETURNED',
      'OUTCOME_UNKNOWN',
      'ADAPTER_FAILED',
    ]);
  });

  for (const recoverability of CLASSES) {
    for (const outcomeKind of ADAPTER_OUTCOME_KINDS) {
      it(`(${recoverability}, ${outcomeKind}) matches the specification-derived row`, () => {
        const expected = expectedOutcomeFor(recoverability, outcomeKind);
        const actual = outcomePolicyFor(recoverability, outcomeKind);

        expect(actual.kind, expected.source).toBe(expected.disposition);
        if (actual.kind === 'RESOLVE') {
          expect(actual.effectStatus).toBe(expected.effectStatus);
          expect(actual.economicMovement).toBe(expected.economicMovement);
          expect(actual.redispatchPermitted).toBe(false);
          expect(actual.reservationHeld).toBe(true);
        }
      });
    }
  }
});

describe('the declared domains are exactly the architecture literals', () => {
  it('`35 §4`s `DISPATCHED_OUTCOME_UNKNOWN` is present, and `VERIFIED` is not', () => {
    /*
     * `24 §3` K4 lists `VERIFIED` among the terminal statuses and `25 §5` reaches it only
     * from "an independent read-back". S1J performs no read-back, so no branch may produce
     * it — and the domain says so rather than a comment saying so.
     */
    expect([...POST_DISPATCH_EFFECT_STATUSES]).toEqual([
      'DISPATCHED_AWAITING_VERIFICATION',
      'DISPATCHED_OUTCOME_UNKNOWN',
    ]);
    expect(POST_DISPATCH_EFFECT_STATUSES as readonly string[]).not.toContain('VERIFIED');
    expect(POST_DISPATCH_EFFECT_STATUSES as readonly string[]).not.toContain('NEVER_SENT');
    expect(POST_DISPATCH_EFFECT_STATUSES as readonly string[]).not.toContain(
      'PRESUMED_EXECUTED',
    );
    expect(POST_DISPATCH_EFFECT_STATUSES as readonly string[]).not.toContain('DISPATCHED');
  });

  it('there is exactly ONE economic movement, and it is `NONE`', () => {
    /*
     * `§18`'s conditional — "if architecture says success makes it realised" — is answered
     * in the negative: `25 §5` says verification "for money [...] is the settlement
     * reconciliation, not the API response", and `24 §3` K5's realised term is fed by
     * settlement events `28 §4` owns and S1J does not build.
     *
     * `35 §4`'s hold is likewise the ABSENCE of a movement rather than a movement into the
     * presumed term: the registry binds `I3`'s term 3 to `PRESUMED_SETTLED`, which `I32`
     * and `26 §10.3` define as the liquidity-override state for a money reservation.
     */
    expect([...ECONOMIC_MOVEMENTS]).toEqual(['NONE']);
  });

  it('the two undeclared reasons name the two open architecture points', () => {
    expect([...UNDECLARED_POLICY_REASONS]).toEqual([
      'IRRECOVERABLE_UNKNOWN_MIE_TRANSITION_UNDECLARED',
      'KNOWN_FAILURE_STATE_UNDECLARED',
    ]);
  });
});

describe('`§16` — THE IRRECOVERABLE UNKNOWN BRANCH IS PARTIAL, AND SAYS WHY', () => {
  it('it refuses rather than guessing, and names `S1J-C1`', () => {
    const policy = outcomePolicyFor('IRRECOVERABLE', 'OUTCOME_UNKNOWN');
    expect(policy.kind).toBe('UNDECLARED');
    if (policy.kind !== 'UNDECLARED') return;
    expect(policy.reason).toBe('IRRECOVERABLE_UNKNOWN_MIE_TRANSITION_UNDECLARED');
    // The refusal carries the architecture citation, so an owner reading a refusal in a
    // log sees which artifact is incomplete rather than an opaque code.
    expect(policy.detail).toContain('25 §10');
    expect(policy.detail).toContain('S1J-C1');
    // AND IT SAYS THE SAFETY HALF STILL HOLDS. `25 §7`: a `CLAIMED` row "is never
    // re-dispatched by any path".
    expect(policy.detail).toContain('never re-dispatched');
  });

  it('and the MONEY unknown branch is NOT partial — it resolves, and holds', () => {
    // The discrimination that matters for `§45`: the PARTIAL is scoped to one cell of
    // `25 §10`'s table and does not spread to its neighbour.
    for (const money of ['REVERSIBLE', 'COMPENSABLE'] as const) {
      const policy = outcomePolicyFor(money, 'OUTCOME_UNKNOWN');
      expect(policy.kind).toBe('RESOLVE');
      if (policy.kind !== 'RESOLVE') return;
      expect(policy.effectStatus).toBe('DISPATCHED_OUTCOME_UNKNOWN');
      expect(policy.reservationHeld).toBe(true);
      expect(policy.economicMovement).toBe('NONE');
      expect(policy.source).toContain('25 §10 row 1');
    }
  });
});

describe('`§19` — A KNOWN ADAPTER FAILURE HAS NO DECLARED STATE, FOR ANY CLASS', () => {
  for (const recoverability of CLASSES) {
    it(`${recoverability}: UNDECLARED, citing K4 against OBX-01`, () => {
      const policy = outcomePolicyFor(recoverability, 'ADAPTER_FAILED');
      expect(policy.kind).toBe('UNDECLARED');
      if (policy.kind !== 'UNDECLARED') return;
      expect(policy.reason).toBe('KNOWN_FAILURE_STATE_UNDECLARED');
      expect(policy.detail).toContain('24 §3 K4');
      expect(policy.detail).toContain('25 §7 OBX-01');
      expect(policy.detail).toContain('S1J-C2');
    });
  }

  it('and `NEVER_SENT` is NOT reused for it — `§19` forbids exactly that', () => {
    /*
     * `25 §10`: "Delivery-event reconciliation resolves `PRESUMED_EXECUTED` to `VERIFIED`
     * or `NEVER_SENT`." `35 §12.3`: "A `NEVER_SENT` row is a new proposal requiring fresh
     * authorisation, never a retry." So `NEVER_SENT` is PROVIDER evidence after a
     * presumption, not a local reading of an adapter's own error, and using it here would
     * be `§31`'s faked reconciliation.
     */
    const detail = outcomePolicyFor('IRRECOVERABLE', 'ADAPTER_FAILED');
    expect(detail.kind).toBe('UNDECLARED');
    expect(JSON.stringify(detail)).not.toContain('NEVER_SENT');
  });
});

describe('`§40` items 7, 8 and 9 — THE VULNERABLE POLICIES DISCRIMINATE', () => {
  it('CONTROL 7 — a caller-claimed recoverability changes the unsafe answer and not production’s', () => {
    /*
     * `§17`, both directions.
     *
     * PRODUCTION takes the class from the committed `effect` row, so there is no parameter
     * for the attacker's claim to enter through and the two calls below are the SAME call.
     * The unsafe policy takes it as an argument and follows it.
     */
    // Direction 1: an authoritative IRRECOVERABLE effect, relabelled REVERSIBLE.
    const unsafeRelabelled = unsafePolicyFromClaimedRecoverability(
      'REVERSIBLE',
      'OUTCOME_UNKNOWN',
    );
    expect(unsafeRelabelled.effectStatus).toBe('DISPATCHED_OUTCOME_UNKNOWN');
    expect(unsafeRelabelled.mieMovement).toBe('NONE');
    // Production, for the SAME authoritative effect: UNDECLARED, and no MIE movement is
    // performed because none is declared.
    const productionIrrecoverable = outcomePolicyFor('IRRECOVERABLE', 'OUTCOME_UNKNOWN');
    expect(productionIrrecoverable.kind).toBe('UNDECLARED');

    // Direction 2 (`§17`'s reverse): an authoritative money effect, claimed IRRECOVERABLE.
    const unsafeSpoofedUp = unsafePolicyFromClaimedRecoverability(
      'IRRECOVERABLE',
      'OUTCOME_UNKNOWN',
    );
    expect(unsafeSpoofedUp.effectStatus).toBe('PRESUMED_EXECUTED');
    // THE MIE UNIT THE ATTACKER WANTED CONSUMED.
    expect(unsafeSpoofedUp.mieMovement).toBe('RESERVED_TO_PRESUMED');
    // Production, for the SAME authoritative money effect: hold, and no MIE movement.
    const productionMoney = outcomePolicyFor('COMPENSABLE', 'OUTCOME_UNKNOWN');
    expect(productionMoney.kind).toBe('RESOLVE');
    if (productionMoney.kind !== 'RESOLVE') return;
    expect(productionMoney.effectStatus).toBe('DISPATCHED_OUTCOME_UNKNOWN');
    expect(productionMoney.economicMovement).toBe('NONE');
  });

  it('CONTROL 8 — the unsafe policy RELEASES the reservation on a money unknown', () => {
    const unsafe = unsafePolicyReleasingReservationOnUnknown('COMPENSABLE', 'OUTCOME_UNKNOWN');
    expect(unsafe.reservation).toBe('RELEASED');

    // `35 §4`: "The exposure reservation remains held. It is not released on timeout,
    // because releasing it would let a retry plus a concurrent proposal collectively exceed
    // the window." Production's decision carries `reservationHeld: true` and — the stronger
    // property — its transaction issues no statement against the ledger at all, which
    // `outcome-money-unknown.test.ts` asserts against direct SQL.
    const production = outcomePolicyFor('COMPENSABLE', 'OUTCOME_UNKNOWN');
    expect(production.kind).toBe('RESOLVE');
    if (production.kind !== 'RESOLVE') return;
    expect(production.reservationHeld).toBe(true);
  });

  it('CONTROL 9 — the unsafe policy COLLAPSES unknown into FAILED and permits redispatch', () => {
    /*
     * `35 §11`: "Every double-execution bug in this class comes from that collapse."
     */
    const unsafe = unsafePolicyCollapsingUnknownToFailed('COMPENSABLE', 'OUTCOME_UNKNOWN');
    expect(unsafe.effectStatus).toBe('FAILED');
    expect(unsafe.redispatchPermitted).toBe(true);
    expect(unsafe.reservation).toBe('RELEASED');

    const production = outcomePolicyFor('COMPENSABLE', 'OUTCOME_UNKNOWN');
    expect(production.kind).toBe('RESOLVE');
    if (production.kind !== 'RESOLVE') return;
    expect(production.effectStatus).toBe('DISPATCHED_OUTCOME_UNKNOWN');
    expect(production.redispatchPermitted).toBe(false);
    expect(production.reservationHeld).toBe(true);
  });

  it('and NO production branch, over the whole input space, permits a redispatch', () => {
    for (const recoverability of CLASSES) {
      for (const outcomeKind of ADAPTER_OUTCOME_KINDS) {
        const policy = outcomePolicyFor(recoverability, outcomeKind);
        if (policy.kind === 'RESOLVE') expect(policy.redispatchPermitted).toBe(false);
      }
    }
  });
});
