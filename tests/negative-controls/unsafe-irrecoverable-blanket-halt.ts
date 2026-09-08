/**
 * TEST-ONLY. The v1.3.3 reading of `30 §5.1` item 4 row 1: IRRECOVERABLE halts in EVERY
 * state.
 *
 * =================================================================================
 * WHAT `§11` OF THE S1I OWNER-RESOLUTION MANDATE REQUIRES:
 *
 *   "Add a TEST-ONLY vulnerable control reflecting the v1.3.3 defective reading:
 *    IRRECOVERABLE HALT in every state. Required discrimination: under NORMAL vulnerable
 *    denies; production permits; under degraded states both deny. **This proves the
 *    correction is narrow.**"
 * =================================================================================
 *
 * =================================================================================
 * THIS IS AN UNUSUAL CONTROL, AND THE DIRECTION IS WHY.
 *
 * Every other vulnerable control in this directory is MORE PERMISSIVE than production —
 * it claims twice, it reclaims a lease, it trusts a caller's boolean. **This one is
 * STRICTER.** That is deliberate and it is the only shape that can prove what `§11` asks
 * for.
 *
 * A correction that made IRRECOVERABLE eligible has two ways to be wrong:
 *
 *   1. it did not happen — row 1 still halts in `NORMAL`. A control that permits more
 *      would not detect this; the suite would simply agree with production that everything
 *      halts, which is what S1I already asserted.
 *   2. it went too far — row 1 became eligible in a degraded state too. Detected by
 *      comparing against the hand-authored oracle, which halts there.
 *
 * So the discriminating control for (1) has to be the OLD, STRICTER reading, and the
 * required result is a DISAGREEMENT in `NORMAL` and an AGREEMENT everywhere else. An
 * agreement in `NORMAL` means the correction did not land; a disagreement in a degraded
 * state means it landed too widely. **Both are failures, and they fail in different
 * assertions.**
 * =================================================================================
 *
 * =================================================================================
 * THE DEFECT, TRANSCRIBED FROM THE ARTIFACT IT CAME FROM.
 *
 * `docs/architecture/v1.3.3/deliverables/22-architecture-principles.md` `§3.1`, verbatim
 * as v1.3.3 issued it:
 *
 *     | 1 | IRRECOVERABLE | **Halt** | **Halt** | **Halt** |
 *
 * `phase2-v1.3.4-errata.md` IRN-01 records why that was a defect: `30 §5.1` item 4 is
 * introduced as "Dispatch precedence **while the mirror is unreachable**", row 1's own
 * rationale is a statement about being **unmirrored**, and `NORMAL` is the state in which
 * the effect is not unmirrored. Composed with item 5's "never rows 1 or 2" and `51 §3.6`'s
 * DATABASE CHECK, the printed table made an IRRECOVERABLE effect permanently
 * undispatchable — so ADR-026, `25 §7`'s outbox, `25 §5`'s `PRESUMED_EXECUTED` branch,
 * `I20` and `37` S4's autonomous sends all specified mechanisms with no reachable subject.
 * =================================================================================
 *
 * THIS FILE IMPORTS NOTHING FROM `src/`. It is a hand-written transcription of one table
 * cell, exactly as `tests/support/mirrorPrecedenceTable.ts` is a hand-written
 * transcription of the whole table. A control that called production's classifier and
 * negated its answer would prove nothing about the artifact.
 */

/** Transcribed. Not imported from `src/kernel/mirror/mirrorState.ts`. */
export type VulnerableState = 'NORMAL' | 'UNCORROBORATED_STALL' | 'CORROBORATED_DEGRADED';

export type VulnerableDisposition = 'DISPATCH_ELIGIBLE' | 'SUSPEND' | 'HALT';

export interface VulnerableRow1Decision {
  readonly disposition: VulnerableDisposition;
  readonly matchedRow: 1;
  readonly ownerOverrideAvailable: false;
}

/**
 * v1.3.3's row 1, in every state, with or without an override, in or out of the posture.
 *
 * The parameters are accepted and then IGNORED, which is the defect stated as a signature:
 * under the printed table no operand other than `recoverability == IRRECOVERABLE` could
 * change the answer, and that is exactly what made the class undispatchable.
 */
export function unsafeIrrecoverableRow1(
  _state: VulnerableState,
  _options: {
    readonly overrideInScope?: boolean;
    readonly fullHaltPosture?: boolean;
  } = {},
): VulnerableRow1Decision {
  return {
    disposition: 'HALT',
    matchedRow: 1,
    // `30 §5.1` item 5: "An override restores precedence rows 3 and 4 only, never rows 1
    // or 2." UNCHANGED by v1.3.4 — this is the one thing the vulnerable reading got right
    // and production still agrees with it in every state.
    ownerOverrideAvailable: false,
  };
}
