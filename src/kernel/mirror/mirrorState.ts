import { corroborationSignalMaxAgeMs } from './degradedModeThresholds.js';

/**
 * `30 §5.6` — THE MIRROR STATE MACHINE, INVERTED. The pure resolution.
 *
 * =================================================================================
 * `30 §5.6`'s TABLE, VERBATIM, BECAUSE EVERY CELL OF IT IS THIS FILE'S SPECIFICATION
 *
 *   | State                     | Entered when
 *   |---------------------------|----------------------------------------------------------
 *   | `NORMAL`                  | Mirror acknowledging within threshold
 *   | `UNCORROBORATED_STALL`    | Control plane observes the mirror unreachable; **no valid,
 *   |                           | unexpired `MirrorInputStallSignal` is held**
 *   | `CORROBORATED_DEGRADED`   | The control plane holds a **valid, signed, unexpired
 *   |                           | `MirrorInputStallSignal`** issued by the audit plane
 *
 * And the property the whole mechanism exists for:
 *
 *   "**The uncorroborated state is stricter than normal operation, not looser.** A control
 *    plane that unilaterally declares a problem thereby **loses** the relaxation it was
 *    declaring in order to obtain — it suspends the very refunds Path B wanted to
 *    dispatch. There is no longer anything to gain by lying, so the transition does not
 *    need to be gated against a lie."
 *
 * `30 §5.7`: "Entry into `CORROBORATED_DEGRADED` requires a valid `MirrorInputStallSignal`
 * and nothing else will do. An audit-plane observation the control plane cannot fetch does
 * not unlock the state; that is the fail-closed direction."
 * =================================================================================
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS FUNCTION IS PURE, AND WHAT THAT BUYS
 *
 * The transition rule is a total function of three durable facts and one clock reading.
 * Making it pure means `vc-a2-inversion.test.ts` can enumerate the entire input space
 * against a hand-authored table rather than sampling it through a database, and it means
 * the durable machine in `mirrorStateMachine.ts` has exactly one place where the rule
 * lives. `mirror-state-durability.test.ts` asserts that the persisted `mirror_state` row
 * always equals a fresh application of THIS function to the durable operands, which is
 * what stops the cached value becoming a second source of truth.
 * ---------------------------------------------------------------------------------
 */

/** `30 §5.6`'s three states. There is no fourth. */
export const MIRROR_STATES = ['NORMAL', 'UNCORROBORATED_STALL', 'CORROBORATED_DEGRADED'] as const;

export type MirrorState = (typeof MIRROR_STATES)[number];

/**
 * `30 §5.7.1`: "**`max_age`** | **5 minutes** = `attestation_cadence × 1`, `CONFIGURED`.
 * Strictly less than `attestation_cadence × k` = 15 minutes, as required, and equal to the
 * re-issuance interval so a control plane in a live corroborated stall always holds a valid
 * one."
 *
 * TRANSCRIBED FROM `30 §5.7.1`, not from a remediation document and not from S1G's
 * `ATTESTATION_STALL_BOUND_MS`. The relationship `max_age < cadence × k` is a declared
 * consequence and `corroboration-signal-contract.test.ts` asserts it as an arithmetic
 * property of the two constants, so a future edit to either cannot silently break it.
 */
/**
 * v1.3.6 (`50 §2c` quantity 4): `corroboration_signal_max_age` is SIGNED class-27 content.
 *
 * `50 §2c`: "**Row 4 was previously owned by no signed class at all.**
 * `corroboration_signal_max_age` gates entry to `CORROBORATED_DEGRADED` — degraded-mode
 * authority — so `§6`'s rule that no authority-bearing field may sit outside every signed
 * artifact boundary requires it to be owned."
 *
 * So the constant is gone and the value is read from the active verified bundle. `50 §2c`
 * also declares the one duplication in the whole inventory: "**The audit plane holds its own
 * copy, and the two copies being equal is a cross-plane obligation, not a second owner.**"
 * — which `src/audit/controlArtifacts/auditPlaneVerifier.ts` reads from ITS OWN verified
 * class-27 bytes rather than from this module.
 */
export function signalMaxAgeMs(): number {
  return corroborationSignalMaxAgeMs();
}

/**
 * The corroboration a state resolution may rest on: a signal the control plane has ALREADY
 * fetched, cryptographically verified and journaled as consumed.
 *
 * There is deliberately no `verified: boolean` field. A structure that could carry
 * `verified: false` into this resolver would make verification a caller's assertion; the
 * only constructor of this type is `corroborationSignal.ts`'s verifier, and
 * `mirrorStateMachine.ts` reads it back out of `mirror_corroboration`, which nothing can
 * insert into without passing that verifier.
 */
export interface HeldCorroboration {
  readonly signalId: string;
  readonly companyId: string;
  /** `30 §5.7.1`: audit-plane clock, the instant the stall was observed. */
  readonly observedAt: Date;
  /** `30 §5.7.1`: `observed_at + max_age`. */
  readonly expiresAt: Date;
  readonly intervalStart: Date;
  readonly reason: CorroborationReason;
}

/** `30 §5.7.1`'s `reason` enum, closed. */
export const CORROBORATION_REASONS = [
  'ATTESTATION_STALL',
  'PUSH_PATH_UNREACHABLE',
  'STORE_WRITE_REJECTED',
] as const;

export type CorroborationReason = (typeof CORROBORATION_REASONS)[number];

/**
 * The operands of one state resolution.
 *
 * `declarationOpen` is the control plane's own observation, journaled as
 * `AUDIT_MIRROR_DEGRADED` (`30 §5.7`). `30 §5.7` on what it is worth: "**Yes, in both
 * directions.** It can be emitted falsely, and its non-arrival is definitionally
 * indistinguishable from the condition it declares." Which is precisely why it reaches only
 * the STRICTER state on its own.
 */
export interface MirrorStateOperands {
  readonly companyId: string;
  /** Is a control-side `AUDIT_MIRROR_DEGRADED` declaration currently open? */
  readonly declarationOpen: boolean;
  /** The newest consumed signal, or `null`. Freshness is evaluated HERE, not at entry. */
  readonly heldCorroboration: HeldCorroboration | null;
  /** `36 §6`'s clock rule: the control database clock, read by the caller. */
  readonly now: Date;
}

/**
 * Anomalies a resolution can observe. NEITHER changes the resolved state — they are
 * reported so the caller can raise what the architecture says to raise.
 *
 * `SIGNAL_HELD_WITHOUT_DECLARATION` is `I17f(b)`'s condition seen from the control side:
 * the audit plane published a stall (which is why a signal exists) and the control plane
 * has no open declaration. Registry `I17f(b)` makes that `ATTESTATION_DIVERGENCE` at
 * CRITICAL, owned by the AUDIT plane, and `30 §5.7` explains why it cannot be attributed.
 * It does NOT enter the relaxed state, because `30 §5.6`'s `UNCORROBORATED_STALL` and
 * `CORROBORATED_DEGRADED` rows both begin from the mirror being observed unreachable.
 */
export type MirrorStateAnomaly =
  | 'SIGNAL_HELD_WITHOUT_DECLARATION'
  | 'CORROBORATION_EXPIRED_WHILE_DECLARED';

export interface MirrorStateResolution {
  readonly state: MirrorState;
  readonly companyId: string;
  readonly evaluatedAt: Date;
  /** The signal the resolution rested on, or `null`. Only ever set for the relaxed state. */
  readonly basisSignalId: string | null;
  readonly anomalies: readonly MirrorStateAnomaly[];
  /**
   * Why the resolution came out as it did, for the journal row and for V6/V7 later.
   *
   * NOT named `rationale`. `26 §2.0` makes `rationale` the model's free text — "NEVER
   * parsed, NEVER interpreted as authority" — and `source-rules.test.ts` rule 1 forbids any
   * file outside three named modules from referencing the word at all. This is a
   * KERNEL-AUTHORED explanation of a deterministic decision, which is a different thing,
   * and it takes a different name so the accepted rule stays absolute.
   */
  readonly explanation: string;
}

/**
 * `30 §5.7.1`'s FRESHNESS RULE, verbatim:
 *
 *   "`now() − signal.observed_at ≤ max_age` **and** `now() < signal.expires_at`, evaluated
 *    on the **control database clock** (`36 §6`'s clock rule). A signal failing either test
 *    **cannot enter the state machine**; the state remains or reverts to
 *    `UNCORROBORATED_STALL`."
 *
 * Both conjuncts are implemented, and they are NOT redundant even though `expires_at`
 * is constrained to `observed_at + max_age`: the first is non-strict and the second is
 * strict, so a signal evaluated EXACTLY at `observed_at + 5 minutes` passes the first and
 * FAILS the second. The boundary therefore rejects, and
 * `corroboration-signal-contract.test.ts` pins that at the millisecond.
 *
 * ---------------------------------------------------------------------------------
 * ONE ADDED REFUSAL, AND IT IS DECLARED AS AN ADDITION RATHER THAN QUOTED.
 *
 * `30 §5.7.1`'s conjunction ADMITS a future-dated signal: if `observed_at > now` then
 * `now − observed_at` is negative, which is `≤ max_age`, and `now < expires_at` holds. The
 * architecture declares no rule for that case. Rather than invent a tolerance quantity —
 * which `§42` of the S1H mandate forbids — this implementation REFUSES the signal, because
 * a signal whose observation instant has not arrived on the evaluating clock has no age to
 * test at all.
 *
 * A REFUSAL CANNOT UNLOCK AUTHORITY. Adding it makes the verifier strictly more refusing
 * than the declared rule, so it cannot move any row of `VC-A2`'s inversion table in the
 * permissive direction. Recorded as `S1H-C6` rather than folded in silently.
 * ---------------------------------------------------------------------------------
 */
export function isCorroborationFresh(signal: HeldCorroboration, now: Date): boolean {
  const ageMs = now.getTime() - signal.observedAt.getTime();
  if (ageMs < 0) return false; // S1H-C6, and strictly stricter than the declared rule.
  if (ageMs > signalMaxAgeMs()) return false; // now() − observed_at ≤ max_age
  return now.getTime() < signal.expiresAt.getTime(); // now() < expires_at
}

/**
 * Resolve `30 §5.6`'s state. TOTAL, DETERMINISTIC, FAIL-CLOSED.
 *
 * ---------------------------------------------------------------------------------
 * WHY THE THREE ROWS ARE READ AS A PARTITION
 *
 * `30 §5.6`'s "Entered when" column gives `CORROBORATED_DEGRADED` one condition — a held
 * valid signal — and gives `UNCORROBORATED_STALL` two: the mirror observed unreachable AND
 * no valid signal. Read as three independent predicates, "mirror acknowledging AND a valid
 * signal held" would satisfy both `NORMAL` and `CORROBORATED_DEGRADED`, and the table would
 * declare no precedence — which is exactly the defect AUD-05 raised one level up and which
 * `30 §5.1` item 4 was rewritten to remove.
 *
 * The reading that makes the three rows MUTUALLY EXCLUSIVE AND EXHAUSTIVE is that the
 * mirror observation is the outer discriminator and the signal is the inner one:
 *
 *   acknowledging                      → `NORMAL`
 *   unreachable, no fresh valid signal → `UNCORROBORATED_STALL`
 *   unreachable, fresh valid signal    → `CORROBORATED_DEGRADED`
 *
 * That is also the STRICTER reading, since it cannot reach the relaxed state on the signal
 * alone. `S1H-owner-clarifications.md S1H-C2` records it, with both readings quoted, and
 * records that no authority differs between them: `22 §3.1`'s table gives precedence row 3
 * "Dispatch" in `NORMAL` and "Dispatch, tagged" in `CORROBORATED_DEGRADED`, so the
 * contested combination dispatches either way and the choice is about the TAG and the
 * incident, not about eligibility.
 * ---------------------------------------------------------------------------------
 */
export function resolveMirrorState(operands: MirrorStateOperands): MirrorStateResolution {
  const { companyId, declarationOpen, heldCorroboration, now } = operands;
  const anomalies: MirrorStateAnomaly[] = [];

  const fresh =
    heldCorroboration !== null &&
    heldCorroboration.companyId === companyId &&
    isCorroborationFresh(heldCorroboration, now);

  if (!declarationOpen) {
    // `30 §5.6`: "`NORMAL` | Mirror acknowledging within threshold".
    if (fresh) anomalies.push('SIGNAL_HELD_WITHOUT_DECLARATION');
    return {
      state: 'NORMAL',
      companyId,
      evaluatedAt: new Date(now.getTime()),
      basisSignalId: null,
      anomalies,
      explanation:
        'no AUDIT_MIRROR_DEGRADED declaration is open, so the mirror is acknowledging ' +
        '(30 §5.6 row 1)',
    };
  }

  if (fresh) {
    // `30 §5.6`: "`CORROBORATED_DEGRADED` | The control plane holds a valid, signed,
    // unexpired `MirrorInputStallSignal` issued by the audit plane".
    return {
      state: 'CORROBORATED_DEGRADED',
      companyId,
      evaluatedAt: new Date(now.getTime()),
      basisSignalId: heldCorroboration.signalId,
      anomalies,
      explanation:
        `a valid unexpired MirrorInputStallSignal (${heldCorroboration.signalId}) is held ` +
        'against an open declaration (30 §5.6 row 3, §5.7.1 freshness rule)',
    };
  }

  // `30 §5.6`: "`UNCORROBORATED_STALL` | Control plane observes the mirror unreachable; no
  // valid, unexpired `MirrorInputStallSignal` is held".
  //
  // `30 §5.7.1`: "A signal failing either test cannot enter the state machine; THE STATE
  // REMAINS OR REVERTS TO `UNCORROBORATED_STALL`." So an expired signal held against an
  // open declaration is not merely ignored — it is the reversion case, and it is reported.
  if (heldCorroboration !== null) anomalies.push('CORROBORATION_EXPIRED_WHILE_DECLARED');
  return {
    state: 'UNCORROBORATED_STALL',
    companyId,
    evaluatedAt: new Date(now.getTime()),
    basisSignalId: null,
    anomalies,
    explanation:
      heldCorroboration === null
        ? 'a declaration is open and no MirrorInputStallSignal has been consumed ' +
          '(30 §5.6 row 2)'
        : `the held signal (${heldCorroboration.signalId}) fails 30 §5.7.1's freshness ` +
          'rule, so the state reverts to UNCORROBORATED_STALL',
  };
}
