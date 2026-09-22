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
    // 3 classes x 4 outcome kinds, after v1.3.5 added `NOT_SENT_CONFIRMED` (OBX-05).
    expect(EXPECTED_OUTCOMES).toHaveLength(12);
    // `25 §7.1`: "A trusted adapter reports exactly one of four typed outcomes, and
    // nothing else." Transcribed by hand, in the artifact's own order.
    expect([...ADAPTER_OUTCOME_KINDS]).toEqual([
      'ADAPTER_RETURNED',
      'OUTCOME_UNKNOWN',
      'NOT_SENT_CONFIRMED',
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
          // `25 §7.2` releases on NOT_SENT_CONFIRMED and on nothing else, so this is the
          // hand-authored row's own value rather than a constant.
          expect(actual.commitmentHeld).toBe(expected.commitmentHeld);
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
    // `25 §7.1` (v1.3.5): "The declared non-terminal post-dispatch statuses are
    // `DISPATCHED_AWAITING_VERIFICATION`, `DISPATCHED_OUTCOME_UNKNOWN` and
    // `PRESUMED_EXECUTED`; the declared terminal one is `DISPATCH_NOT_SENT_CONFIRMED`."
    // Four literals, hand-transcribed in that order.
    expect([...POST_DISPATCH_EFFECT_STATUSES]).toEqual([
      'DISPATCHED_AWAITING_VERIFICATION',
      'DISPATCHED_OUTCOME_UNKNOWN',
      'PRESUMED_EXECUTED',
      'DISPATCH_NOT_SENT_CONFIRMED',
    ]);
    // `VERIFIED` and `NEVER_SENT` REMAIN ABSENT, and v1.3.5 does not add them: `25 §10.1`'s
    // REALISE and never-sent RELEASE rows "are reached only from provider evidence", and
    // `25 §7.2` keeps `DISPATCH_NOT_SENT_CONFIRMED` "deliberately NOT `NEVER_SENT`" because
    // the two differ in the KIND of evidence behind them.
    expect(POST_DISPATCH_EFFECT_STATUSES as readonly string[]).not.toContain('VERIFIED');
    expect(POST_DISPATCH_EFFECT_STATUSES as readonly string[]).not.toContain('NEVER_SENT');
    expect(POST_DISPATCH_EFFECT_STATUSES as readonly string[]).not.toContain('DISPATCHED');
  });

  it('the four declared economic movements, and no `REALISED` among them', () => {
    /*
     * `§18`'s conditional — "if architecture says success makes it realised" — is answered
     * in the negative: `25 §5` says verification "for money [...] is the settlement
     * reconciliation, not the API response", and `24 §3` K5's realised term is fed by
     * settlement events `28 §4` owns and S1J does not build.
     *
     * `35 §4`'s MONEY hold is likewise the ABSENCE of a movement rather than a movement into
     * the presumed term: `24 §3` K5 (v1.3.5) gives `presumed_monetary` exactly one producer,
     * `PRESUMED_SETTLED`, which `I32` and `26 §10.3` define as the liquidity-override state
     * for a money reservation — a different ledger from this one.
     *
     * WHAT v1.3.5 ADDED IS THREE MOVEMENTS ON LEDGER 3 AND THE MONEY RELEASE, and no
     * realisation: `25 §10.1`'s PRESUME and confirmed-not-sent RELEASE rows, plus `25 §7.2`'s
     * money release. The REALISE row and the never-sent release stay out because both need
     * independent provider evidence.
     */
    expect([...ECONOMIC_MOVEMENTS]).toEqual([
      'NONE',
      'MIE_RESERVED_TO_PRESUMED',
      'MIE_RESERVED_RELEASED',
      'RESERVATION_RELEASED',
    ]);
    for (const movement of ECONOMIC_MOVEMENTS) {
      expect(movement).not.toContain('REALISED');
    }
  });

  it('ONE undeclared reason survives, and it is a DECLARATION rather than a gap', () => {
    /*
     * The accepted S1J carried TWO. `S1J-C1` — the irrecoverable unknown branch's MIE
     * transition — is CLOSED by MIE-01: `25 §10.1` declares the movement, `51 §2.3` declares
     * the units, and the branch now RESOLVES.
     *
     * What remains is not the second gap either. v1.3.4 left `ADAPTER_FAILED` with no state
     * AND a retry that contradicted OBX-01; v1.3.5 corrects the retry and DECLARES that the
     * kind reaches no state — "Retained for diagnostics only." So the member's name says
     * what the architecture says, and not that the architecture is silent.
     */
    expect([...UNDECLARED_POLICY_REASONS]).toEqual(['ADAPTER_FAILED_REACHES_NO_LOCAL_STATE']);
    expect(UNDECLARED_POLICY_REASONS as readonly string[]).not.toContain(
      'IRRECOVERABLE_UNKNOWN_MIE_TRANSITION_UNDECLARED',
    );
  });
});

describe('MIE-01 — THE IRRECOVERABLE UNKNOWN BRANCH RESOLVES, AND MOVES ONE UNIT', () => {
  it('`25 §10 row 2` + `25 §10.1`: PRESUMED_EXECUTED, reserved → presumed', () => {
    /*
     * THIS IS THE CELL THE ACCEPTED S1J RETURNED PARTIAL FOR, and the reason it can resolve
     * now is a DECLARATION and not a decision: `phase2-v1.3.5-errata.md §1` records that the
     * implementation "returned PARTIAL rather than inventing a counter", and MIE-01 declares
     * the movement four artifacts required and none defined.
     */
    const policy = outcomePolicyFor('IRRECOVERABLE', 'OUTCOME_UNKNOWN');
    expect(policy.kind).toBe('RESOLVE');
    if (policy.kind !== 'RESOLVE') return;
    expect(policy.effectStatus).toBe('PRESUMED_EXECUTED');
    expect(policy.economicMovement).toBe('MIE_RESERVED_TO_PRESUMED');
    // NO HEADROOM. `25 §10.1`: "The sum of the three terms does not fall, so an unknown
    // outcome creates no headroom." The movement RELOCATES the unit; it does not release it.
    expect(policy.commitmentHeld).toBe(true);
    expect(policy.redispatchPermitted).toBe(false);
    expect(policy.source).toContain('25 §10.1');
  });

  it('and `ADAPTER_RETURNED` reaches the SAME state by the SAME movement — OBX-04', () => {
    /*
     * `25 §7.1`: "The unit moves `reserved → presumed` **exactly once**, on whichever of the
     * two outcomes arrives." So the two cells must agree on both columns, and this asserts
     * the agreement rather than restating each cell.
     */
    const unknown = outcomePolicyFor('IRRECOVERABLE', 'OUTCOME_UNKNOWN');
    const returned = outcomePolicyFor('IRRECOVERABLE', 'ADAPTER_RETURNED');
    expect(unknown.kind).toBe('RESOLVE');
    expect(returned.kind).toBe('RESOLVE');
    if (unknown.kind !== 'RESOLVE' || returned.kind !== 'RESOLVE') return;
    expect(returned.effectStatus).toBe(unknown.effectStatus);
    expect(returned.economicMovement).toBe(unknown.economicMovement);
    // AND IT IS NOT THE MONEY ANSWER. The whole point of OBX-04's second correction.
    expect(returned.effectStatus).not.toBe('DISPATCHED_AWAITING_VERIFICATION');
  });

  it('and the MONEY unknown branch is NOT partial — it resolves, and holds', () => {
    // The discrimination that matters for `§45`: the PARTIAL is scoped to one cell of
    // `25 §10`'s table and does not spread to its neighbour.
    for (const money of ['REVERSIBLE', 'COMPENSABLE'] as const) {
      const policy = outcomePolicyFor(money, 'OUTCOME_UNKNOWN');
      expect(policy.kind).toBe('RESOLVE');
      if (policy.kind !== 'RESOLVE') return;
      expect(policy.effectStatus).toBe('DISPATCHED_OUTCOME_UNKNOWN');
      expect(policy.commitmentHeld).toBe(true);
      expect(policy.economicMovement).toBe('NONE');
      expect(policy.source).toContain('25 §10 row 1');
    }
  });
});

describe('OBX-04 — `ADAPTER_FAILED` REACHES NO LOCAL STATE, BY DECLARATION', () => {
  for (const recoverability of CLASSES) {
    it(`${recoverability}: UNDECLARED, citing 25 §7.1's diagnostics-only rule`, () => {
      const policy = outcomePolicyFor(recoverability, 'ADAPTER_FAILED');
      expect(policy.kind).toBe('UNDECLARED');
      if (policy.kind !== 'UNDECLARED') return;
      expect(policy.reason).toBe('ADAPTER_FAILED_REACHES_NO_LOCAL_STATE');
      // The refusal cites the DECLARATION, not an open point: `25 §7.1` retains the kind
      // for diagnostics and says it reaches no state, and OBX-01's no-reclaim rule is why
      // the claim is nonetheless safe where it sits.
      expect(policy.detail).toContain('25 §7.1');
      expect(policy.detail).toContain('OBX-01');
      expect(policy.detail).toContain('never re-dispatched');
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
    // Production, for the SAME authoritative effect: PRESUMED_EXECUTED and the declared
    // `reserved → presumed` movement — NOT the money answer the relabelling asked for.
    const productionIrrecoverable = outcomePolicyFor('IRRECOVERABLE', 'OUTCOME_UNKNOWN');
    expect(productionIrrecoverable.kind).toBe('RESOLVE');
    if (productionIrrecoverable.kind !== 'RESOLVE') return;
    expect(productionIrrecoverable.effectStatus).toBe('PRESUMED_EXECUTED');
    expect(productionIrrecoverable.economicMovement).toBe('MIE_RESERVED_TO_PRESUMED');
    expect(unsafeRelabelled.effectStatus).not.toBe(productionIrrecoverable.effectStatus);

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
    expect(production.commitmentHeld).toBe(true);
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
    expect(production.commitmentHeld).toBe(true);
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
