import { describe, expect, it } from 'vitest';

import {
  classifyDispatchPrecedence,
  type PrecedenceOperands,
} from '../../src/kernel/mirror/dispatchPrecedence.js';
import { resolveMirrorState } from '../../src/kernel/mirror/mirrorState.js';
import { unsafeSelfDeclaredResolver } from './unsafe-mirror-state-machine.js';
import { PERMISSIVENESS, allOracleCases, expectedFor } from '../support/mirrorPrecedenceTable.js';

/**
 * MANDATORY NEGATIVE CONTROL — SELF-DECLARED DEGRADATION. `§33` OF THE S1H MANDATE.
 *
 * =================================================================================
 * `§33`, verbatim:
 *
 *   "Unsafe state machine: control declaration directly enters relaxed degraded mode.
 *    Production: control declaration alone enters only the stricter uncorroborated state.
 *    **For a clock-bearing compensable effect use a case where the outcomes differ.**
 *    Unsafe: future-dispatch eligible. Production: suspended/halted according to current
 *    table. **This proves the inversion is doing actual security work.**"
 *
 * `30 §5.6` names the defect this reproduces: "v1.1's degraded mode was **declared by the
 * control plane** and it **relaxed** the dispatch rule — clock-bearing COMPENSABLE effects
 * dispatch unmirrored. So a compromised control plane declares degradation and dispatches
 * refunds with no external record, which is a self-authorising escape from the audit plane.
 * `52 §1` Path B."
 *
 * WITHOUT THIS FILE, `vc-a2-inversion.test.ts` would pass identically against an
 * implementation that never reached the relaxed state at all. The unsafe resolver reaches
 * it, on the same operands, and the dispositions differ.
 * =================================================================================
 */

const COMPANY = 'co_s1h';
const T0 = new Date('2026-03-01T12:00:00.000Z');

/** THE DISCRIMINATING FIXTURE: `22 §3.1` row 3 — clock-bearing COMPENSABLE. */
const CLOCK_BEARING_REFUND = {
  actionClass: 'refund.create',
  recoverability: 'COMPENSABLE',
  clockBearing: true,
  aboveApprovalFloor: false,
  hasRecordedApproval: true,
} as const;

function operandsFor(state: 'NORMAL' | 'UNCORROBORATED_STALL' | 'CORROBORATED_DEGRADED') {
  return {
    mirrorState: state,
    ...CLOCK_BEARING_REFUND,
    activeOverride: null,
    now: T0,
  } satisfies PrecedenceOperands;
}

describe('THE SAME INPUT: a control-side declaration, and no audit signal at all', () => {
  const declaration = {
    companyId: COMPANY,
    declarationOpen: true,
    heldCorroboration: null,
    now: T0,
  };

  it('THE UNSAFE MACHINE reaches `CORROBORATED_DEGRADED`', () => {
    expect(unsafeSelfDeclaredResolver(declaration)).toBe('CORROBORATED_DEGRADED');
  });

  it('PRODUCTION reaches `UNCORROBORATED_STALL`', () => {
    expect(resolveMirrorState(declaration).state).toBe('UNCORROBORATED_STALL');
  });

  it('and the two DISAGREE, which is what makes this a control', () => {
    expect(unsafeSelfDeclaredResolver(declaration)).not.toBe(
      resolveMirrorState(declaration).state,
    );
  });
});

describe('THE CONSEQUENCE — for a clock-bearing COMPENSABLE refund the outcomes differ', () => {
  it('UNSAFE: future-dispatch ELIGIBLE, and tagged as though corroborated', () => {
    // The refund `52 §1` Path B wanted. Under the unsafe machine a compromised control plane
    // declares a problem and gets exactly it.
    const unsafeState = unsafeSelfDeclaredResolver({
      companyId: COMPANY,
      declarationOpen: true,
      heldCorroboration: null,
      now: T0,
    });
    const decision = classifyDispatchPrecedence(operandsFor(unsafeState));
    expect(decision.matchedRow).toBe(3);
    expect(decision.disposition).toBe('DISPATCH_ELIGIBLE');
    expect(decision.requiresUnmirroredTag).toBe(true);
  });

  it('PRODUCTION: SUSPENDED — the inversion', () => {
    const productionState = resolveMirrorState({
      companyId: COMPANY,
      declarationOpen: true,
      heldCorroboration: null,
      now: T0,
    }).state;
    const decision = classifyDispatchPrecedence(operandsFor(productionState));
    expect(decision.matchedRow).toBe(3);
    expect(decision.disposition).toBe('SUSPEND');
    // `30 §5.1` item 5: "the only escape is a `DegradedModeOverride` scoped to this row".
    expect(decision.ownerOverrideAvailable).toBe(true);
  });

  it('THE DISCRIMINATION, stated as one assertion', () => {
    const unsafe = classifyDispatchPrecedence(
      operandsFor(
        unsafeSelfDeclaredResolver({
          companyId: COMPANY,
          declarationOpen: true,
          heldCorroboration: null,
          now: T0,
        }),
      ),
    );
    const production = classifyDispatchPrecedence(
      operandsFor(
        resolveMirrorState({
          companyId: COMPANY,
          declarationOpen: true,
          heldCorroboration: null,
          now: T0,
        }).state,
      ),
    );
    expect(unsafe.disposition).toBe('DISPATCH_ELIGIBLE');
    expect(production.disposition).toBe('SUSPEND');
    // AND PRODUCTION IS THE STRICTER OF THE TWO. `§33`'s whole point.
    expect(PERMISSIVENESS[production.disposition]).toBeLessThan(
      PERMISSIVENESS[unsafe.disposition],
    );
  });

  it('and PRODUCTION agrees with the HAND-AUTHORED table while the unsafe machine does not', () => {
    const expected = expectedFor('UNCORROBORATED_STALL', CLOCK_BEARING_REFUND);
    const production = classifyDispatchPrecedence(operandsFor('UNCORROBORATED_STALL'));
    expect(production.disposition).toBe(expected.disposition);

    const unsafeState = unsafeSelfDeclaredResolver({
      companyId: COMPANY,
      declarationOpen: true,
      heldCorroboration: null,
      now: T0,
    });
    expect(classifyDispatchPrecedence(operandsFor(unsafeState)).disposition).not.toBe(
      expected.disposition,
    );
  });
});

describe('THE ATTACK, REPEATED — and it never accumulates', () => {
  it('a caller declaring 500 times gets `UNCORROBORATED_STALL` 500 times', () => {
    // `§5` of the mandate: "A compromised control-side caller repeatedly declares mirror
    // failure while the audit plane is healthy. Production must NEVER reach
    // `CORROBORATED_DEGRADED` solely from that declaration."
    for (let i = 0; i < 500; i += 1) {
      expect(
        resolveMirrorState({
          companyId: COMPANY,
          declarationOpen: true,
          heldCorroboration: null,
          now: new Date(T0.getTime() + i * 1000),
        }).state,
      ).toBe('UNCORROBORATED_STALL');
    }
  });

  it('and for EVERY operand combination the declaration is equal-or-stricter than NORMAL', () => {
    // `§5`: "The resulting authority/disposition must be equal to or stricter than NORMAL for
    // every current recoverability/clock combination." Asserted over the whole cross-product,
    // against the unsafe machine's answer for the same rows so the contrast is complete.
    let strictlyStricterSomewhere = false;
    let unsafeLooserSomewhere = false;

    for (const c of allOracleCases()) {
      const base = { actionClass: 'refund.create' as const, activeOverride: null, now: T0 };
      const normal = classifyDispatchPrecedence({ mirrorState: 'NORMAL', ...base, ...c });
      const production = classifyDispatchPrecedence({
        mirrorState: resolveMirrorState({
          companyId: COMPANY,
          declarationOpen: true,
          heldCorroboration: null,
          now: T0,
        }).state,
        ...base,
        ...c,
      });
      const unsafe = classifyDispatchPrecedence({
        mirrorState: unsafeSelfDeclaredResolver({
          companyId: COMPANY,
          declarationOpen: true,
          heldCorroboration: null,
          now: T0,
        }),
        ...base,
        ...c,
      });

      expect(
        PERMISSIVENESS[production.disposition],
        `production became more permissive for ${JSON.stringify(c)}`,
      ).toBeLessThanOrEqual(PERMISSIVENESS[normal.disposition]);

      if (PERMISSIVENESS[production.disposition] < PERMISSIVENESS[normal.disposition]) {
        strictlyStricterSomewhere = true;
      }
      if (PERMISSIVENESS[unsafe.disposition] > PERMISSIVENESS[production.disposition]) {
        unsafeLooserSomewhere = true;
      }
    }

    // Non-vacuous in BOTH directions: production really does tighten somewhere, and the
    // unsafe machine really is looser somewhere. Either failing would make the control
    // decorative.
    expect(strictlyStricterSomewhere).toBe(true);
    expect(unsafeLooserSomewhere).toBe(true);
  });
});

describe('WHAT THE UNSAFE MACHINE STILL GETS RIGHT, so the control is SHARP', () => {
  it('with no declaration open, both machines say `NORMAL`', () => {
    // A control that differed everywhere would not isolate the defect. The ONLY difference
    // is what a declaration alone unlocks.
    const healthy = {
      companyId: COMPANY,
      declarationOpen: false,
      heldCorroboration: null,
      now: T0,
    };
    expect(unsafeSelfDeclaredResolver(healthy)).toBe('NORMAL');
    expect(resolveMirrorState(healthy).state).toBe('NORMAL');
  });
});
