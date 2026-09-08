import type { ActionClass, Recoverability } from '../canonicalisation/actionCatalogue.js';
import type { MirrorState } from './mirrorState.js';

/**
 * `30 §5.1` ITEM 4 — THE ORDERED FIRST-MATCH DISPATCH PRECEDENCE, EVALUATED INSIDE THE
 * DECLARED MIRROR STATE. A PURE KERNEL DECISION.
 *
 * =================================================================================
 * THIS FUNCTION DISPATCHES NOTHING AND CANNOT.
 *
 * It returns a DISPOSITION. There is no adapter, no HTTP client, no outbox, no exclusive
 * claim and no `DISPATCHED` effect state in this slice, and `no-dispatch-boundary.test.ts`
 * asserts each as an absence in `src/`. `30 §5.1`'s ordering block has a third arrow —
 * "dispatch, per (4)" — and S1H computes (4) and stops.
 * =================================================================================
 *
 * =================================================================================
 * `30 §5.1` ITEM 4, VERBATIM. THIS IS THE SPECIFICATION.
 *
 *   "**Evaluate in order. First match wins.**
 *
 *    | # | Condition | Behaviour |
 *    | **1** | `recoverability == IRRECOVERABLE` | **Halt.** No send, no reship, no public
 *            post, no address edit. Unmirrored and unundoable is the combination the mirror
 *            exists for. |
 *    | **2** | Above the per-action approval floor **and not** clock-bearing | **Halt.** The
 *            approval itself proceeds normally; what halts is *dispatch* of an
 *            already-approved above-floor effect while unmirrored. |
 *    | **3** | Clock-bearing (a live statutory clock citing a RECORD-grade fact, `§9.1`) and
 *            `recoverability == COMPENSABLE` | **Dispatch**, in `NORMAL` and
 *            `CORROBORATED_DEGRADED` only. Journal `DISPATCHED_UNMIRRORED` and raise it in
 *            V6. **In `UNCORROBORATED_STALL`, suspend** (§5.6) — this row is the inversion,
 *            and the only escape is a `DegradedModeOverride` scoped to this row (§5.7.2). |
 *    | **4** | `recoverability == COMPENSABLE`, discretionary | **Suspend.** |
 *    | **5** | `recoverability == REVERSIBLE` | **Dispatch** against the committed, locally
 *            chained journal. |
 *
 *    **Row 2 before row 3, and row 1 before both.** [...] **Approval-bearing effects
 *    evaluate at rows 3 or 5 once approved**; the approval gate is `26 §12`'s concern and
 *    is not re-litigated here."
 *
 * `22 §3.1`'s state-qualified table, which is the same rule with the state column printed:
 *
 *   | row | class                                | NORMAL   | UNCORROBORATED | CORROBORATED
 *   | 1   | IRRECOVERABLE                        | Halt     | Halt           | Halt
 *   | 2   | above floor, not clock-bearing       | Halt     | Halt           | Halt
 *   | 3   | COMPENSABLE inside a live clock      | Dispatch | **Suspend**    | Dispatch, tagged
 *   | 4   | COMPENSABLE discretionary            | Suspend  | Suspend        | Suspend
 *   | 5   | REVERSIBLE                           | Dispatch | Dispatch       | Dispatch
 *
 *   "Rows 3 and 4 are the only rows a `DegradedModeOverride` can restore, and rows 1 and 2
 *    are unreachable by override (`30 §5.7.2`)."
 *
 * `36 §6`: "`CORROBORATED_DEGRADED`: as `NORMAL`, **with every dispatch tagged
 * `DISPATCHED_UNMIRRORED`**."
 * =================================================================================
 *
 * ---------------------------------------------------------------------------------
 * WHY THIS IS AN ARRAY AND NOT A MAP, A SWITCH OR A PREDICATE SET
 *
 * `30 §5.1` item 4 is an ORDERED FIRST-MATCH LIST and AUD-05 is what happens when it is
 * not treated as one: "v1.1 presented five independent rows and **two of them matched
 * simultaneously for the most consequential case.** A $30 refund inside a live FTC clock is
 * COMPENSABLE-inside-a-clock [...] **and** above the $25 per-action approval floor [...].
 * The table declared no precedence, so the largest and most time-critical refund class had
 * two contradictory specified behaviours."
 *
 * So the rows are a literal array in the architecture's own order, evaluation stops at the
 * first match, and the matched row number is part of the output — because `VC-A6` requires
 * asserting WHICH row decided, and "the right answer for the wrong reason" is how an
 * unordered implementation passes an outcome-only test.
 *
 * `tests/support/mirrorPrecedenceTable.ts` is a HAND-AUTHORED expected-disposition table
 * written from `22 §3.1` and `30 §5.1`, importing nothing from this file, and
 * `unsafe-precedence-order.ts` is the mandatory vulnerable control that reorders these rows
 * and is shown to differ.
 * ---------------------------------------------------------------------------------
 */

/**
 * The dispositions. `30 §5.1`'s own three words, prefixed so no reader can mistake
 * `DISPATCH_ELIGIBLE` for a dispatch.
 *
 * `30 §5.1` says "Dispatch", "Suspend", "Halt". S1H has no dispatcher, so the permissive
 * outcome is named for what it actually is: this effect would be handed to the dispatcher
 * that `37` S4 builds.
 */
export const DISPOSITIONS = ['DISPATCH_ELIGIBLE', 'SUSPEND', 'HALT'] as const;

export type Disposition = (typeof DISPOSITIONS)[number];

/**
 * The operands. EVERY ONE IS AUTHORITATIVE KERNEL STATE, AND NONE IS MODEL-SUPPLIED.
 *
 * `26 §1` Corollary 3: "the request must be built by the ceiling's enforcer, not by its
 * subject." The provenance of each, stated so a reviewer can check it against the source:
 *
 *   `mirrorState`          `mirrorStateMachine.ts`, from `mirror_declaration` and
 *                          `mirror_corroboration`. Not a parameter of any caller-facing API.
 *   `recoverability`       `ACTION_CATALOGUE[action_class]`. `26 §5`: "Assigned per action
 *                          class in the catalogue, **not per request, and never by a
 *                          model**", and `I21` makes it type-level unreachable from
 *                          `ProposedIntent`.
 *   `clockBearing`         `statutoryClock.ts`, from a LIVE `statutory_clock` row whose
 *                          `source_record_ref` resolves to a retained RECORD-grade
 *                          artifact (`I56`). `24 §3` K10: a model "may not [...] create a
 *                          clock, or influence the fact a clock cites."
 *   `aboveApprovalFloor`   `26 §12`'s approval gate. SEE THE NOTE BELOW.
 *   `hasRecordedApproval`  the effect's `approval_id`, kernel state since S1F.
 *   `activeOverride`       `degraded_mode_override`, status `ACTIVE`, owner-granted under a
 *                          real Ed25519 signature.
 *   `now`                  the control database clock (`36 §6`).
 *
 * ---------------------------------------------------------------------------------
 * `aboveApprovalFloor` IS A BOOLEAN OPERAND AND THE THRESHOLD BEHIND IT IS UNDECLARED.
 *
 * `50 §2` class 3 lists the "approval floor" as a field of the owner-signed action
 * catalogue. `30 §5.1`'s explanation and `22 §3.1` both refer to "the $25 per-action approval
 * floor" in prose. **NO NUMERIC `approval_floor` QUANTITY IS DECLARED ANYWHERE IN v1.3.2** —
 * `51 §3.1` declares `refund.create`'s `per_action_max` as $25.00, which is a DENY boundary
 * (`26 §8`: `total_exposure <= 25.00` or the action denies `PER_ACTION`), not an approval
 * boundary, and `26 §12`'s tier table gives no monetary thresholds at all.
 *
 * `§42` of the S1H mandate forbids inventing it. So this classifier takes the predicate as
 * a DECLARED OPERAND, supplied by `26 §12`'s approval machinery, which `37` S5 builds. The
 * ROW-2 BEHAVIOUR is fully implemented and fully tested over both values of the boolean;
 * what is PARTIAL is the derivation of the boolean, and `S1H-result.md §10` reports it as
 * such with the citation. `S1H-owner-clarifications.md S1H-C1` asks the owner to declare
 * the quantity.
 * ---------------------------------------------------------------------------------
 */
export interface PrecedenceOperands {
  readonly mirrorState: MirrorState;
  readonly actionClass: ActionClass;
  readonly recoverability: Recoverability;
  readonly clockBearing: boolean;
  readonly aboveApprovalFloor: boolean;
  readonly hasRecordedApproval: boolean;
  readonly activeOverride: OverrideScope | null;
  readonly now: Date;
}

/**
 * The part of a `DegradedModeOverride` this pure function reads. `30 §5.7.2`'s scope
 * fields, plus the two counters `I63(a)` bounds.
 *
 * `30 §5.7.2`'s SCOPE RULE is why `recoverabilityClasses` cannot hold `IRRECOVERABLE` and
 * `precedenceRows` cannot hold 1 or 2: "there is no grant path that admits it". That is a
 * DATABASE CHECK in `0009__mirror_state.sql`, so a value this type could not legally hold
 * cannot be read out of the store — and the guard below is a second refusal rather than the
 * only one, for the reason `36 §0` gives about single-mechanism properties.
 */
export interface OverrideScope {
  readonly overrideId: string;
  readonly effectClasses: readonly string[];
  readonly recoverabilityClasses: readonly string[];
  readonly precedenceRows: readonly number[];
  readonly startsAt: Date;
  readonly expiresAt: Date;
  readonly effectCountCap: bigint;
  readonly effectsDispatched: bigint;
  readonly status: string;
}

export interface PrecedenceDecision {
  readonly disposition: Disposition;
  /** Which of `30 §5.1`'s five rows decided. `VC-A6` asserts this, not only the outcome. */
  readonly matchedRow: 1 | 2 | 3 | 4 | 5;
  /**
   * `30 §5.7.2` item 5: "Every dispatch under it is tagged `DISPATCHED_UNMIRRORED` and
   * carries `override_id`". `36 §6`: in `CORROBORATED_DEGRADED`, "every dispatch tagged".
   *
   * A DETERMINISTIC PROPERTY, NOT A TAG. No effect is dispatched in S1H, so nothing is
   * tagged; `§35` of the S1H mandate permits exactly this, and `I17f`'s actual dispatch→tag
   * runtime enforcement stays OPEN until the execution slice.
   */
  readonly requiresUnmirroredTag: boolean;
  /** Set when an override is what made a suspended row eligible. `30 §5.7.2` item 5. */
  readonly overrideId: string | null;
  /**
   * Whether a `DegradedModeOverride` could restore this row at all — rows 3 and 4 only.
   *
   * `30 §5.1` item 5: "An override restores precedence rows 3 and 4 only, never rows 1 or
   * 2." So for a HALT at row 1 or row 2 this is `false`, and the owner has no escape to be
   * offered. That is the answer to "owner action required?" and it is derived from the
   * matched row rather than being a fourth disposition the architecture does not declare.
   */
  readonly ownerOverrideAvailable: boolean;
  /**
   * Which row decided and why, in words. NOT named `rationale`: `26 §2.0` reserves that for
   * the model's free text and `source-rules.test.ts` rule 1 forbids the word outside three
   * named modules. This string is kernel-authored and derived from the operands.
   */
  readonly explanation: string;
}

/** `30 §5.1` item 4's rows, in the architecture's order. Index 0 is row 1. */
const ROWS = [1, 2, 3, 4, 5] as const;

/**
 * The ORDER, exported so `unsafe-precedence-order.ts` can permute a copy of it and
 * `first-match-order.test.ts` can assert production's is the architecture's.
 *
 * A test that read the order from the evaluator it is testing would be `36 §0`'s
 * self-validating test, so the assertion is against a literal written out in the test file
 * from `30 §5.1` — this constant exists to be COMPARED, not to be trusted.
 */
export const PRECEDENCE_ROW_ORDER: readonly number[] = ROWS;

/** `30 §5.1` row 1. */
function matchesRow1(o: PrecedenceOperands): boolean {
  return o.recoverability === 'IRRECOVERABLE';
}

/**
 * `30 §5.1` row 2 — "Above the per-action approval floor **and not** clock-bearing".
 *
 * Plus the approval rule the same item states: "**Approval-bearing effects evaluate at rows
 * 3 or 5 once approved**". `phase2-v1.2-remediation-ledger.md` states the applied change in
 * the operative form: "an effect carrying a recorded approval is evaluated at row 3 or row
 * 5, NEVER ROW 2, because the approval floor's purpose is satisfied."
 *
 * So a recorded approval removes row 2's match. `S1H-owner-clarifications.md S1H-C7`
 * records that "rows 3 or 5" is imprecise where the effect is COMPENSABLE and
 * discretionary — such an effect falls to row 4 and suspends, since row 3 requires a clock
 * — and that "never row 2" is the operative half.
 */
function matchesRow2(o: PrecedenceOperands): boolean {
  return o.aboveApprovalFloor && !o.clockBearing && !o.hasRecordedApproval;
}

/** `30 §5.1` row 3 — clock-bearing AND COMPENSABLE. Both conjuncts, verbatim. */
function matchesRow3(o: PrecedenceOperands): boolean {
  return o.clockBearing && o.recoverability === 'COMPENSABLE';
}

/**
 * `30 §5.1` row 4 — "`recoverability == COMPENSABLE`, discretionary".
 *
 * "Discretionary" is the complement of row 3's clock inside the COMPENSABLE class, and
 * `22 §3.1` prints the pair as "COMPENSABLE inside a live statutory clock" against
 * "COMPENSABLE discretionary". First-match ordering makes the `!clockBearing` conjunct
 * redundant here — row 3 would already have matched — and it is written out anyway so the
 * predicate reads correctly in isolation and so a reordering of the array changes the
 * OUTCOME rather than silently producing the same answer.
 */
function matchesRow4(o: PrecedenceOperands): boolean {
  return o.recoverability === 'COMPENSABLE' && !o.clockBearing;
}

/** `30 §5.1` row 5. */
function matchesRow5(o: PrecedenceOperands): boolean {
  return o.recoverability === 'REVERSIBLE';
}

const ROW_PREDICATES: readonly ((o: PrecedenceOperands) => boolean)[] = [
  matchesRow1,
  matchesRow2,
  matchesRow3,
  matchesRow4,
  matchesRow5,
];

/**
 * `I63(a)` — is this override in scope for this effect and this row?
 *
 * Registry `I63(a)`: "no effect is dispatched under a `DegradedModeOverride` outside its
 * declared `effect_classes[]`, `recoverability_classes[]` and `precedence_rows[]`, outside
 * `[starts_at, expires_at)`, or beyond `effect_count_cap` or `monetary_exposure_cap`."
 *
 * The monetary leg is checked in the CLAIMING TRANSACTION rather than here, because it
 * needs the effect's `total_exposure` and a `FOR UPDATE` on the counter — see
 * `degradedModeOverride.ts`. Every other leg is a pure predicate and is checked here.
 *
 * `[starts_at, expires_at)` is half-open, exactly as written: `now >= starts_at` and
 * `now < expires_at`.
 */
function overrideCovers(
  override: OverrideScope,
  row: number,
  o: PrecedenceOperands,
): boolean {
  if (override.status !== 'ACTIVE') return false;
  if (o.now.getTime() < override.startsAt.getTime()) return false;
  if (o.now.getTime() >= override.expiresAt.getTime()) return false;
  // `30 §5.1` item 5 / `§5.7.2` scope rule, as a second refusal on top of the DB CHECK.
  if (row !== 3 && row !== 4) return false;
  if (!override.precedenceRows.includes(row)) return false;
  if (!override.recoverabilityClasses.includes(o.recoverability)) return false;
  // Structural, restated: `IRRECOVERABLE` has no grant path (`51 §3.6`).
  if (o.recoverability === 'IRRECOVERABLE') return false;
  if (!override.effectClasses.includes(o.actionClass)) return false;
  if (override.effectsDispatched >= override.effectCountCap) return false;
  return true;
}

/**
 * Classify one effect. ORDERED, FIRST-MATCH, TOTAL.
 *
 * The five rows are exhaustive over the three recoverability classes: row 1 takes
 * IRRECOVERABLE, rows 3 and 4 partition COMPENSABLE, row 5 takes REVERSIBLE, and row 2
 * intercepts above-floor unapproved non-clock-bearing effects of any class. The `throw` at
 * the end is therefore unreachable and is an assertion rather than a fallback — a default
 * disposition would be a sixth rule the architecture does not declare.
 */
export function classifyDispatchPrecedence(o: PrecedenceOperands): PrecedenceDecision {
  // `36 §6`: "`CORROBORATED_DEGRADED`: as `NORMAL`, with every dispatch tagged
  // `DISPATCHED_UNMIRRORED`." So the tag follows the STATE for ordinary dispatch, and
  // `30 §5.7.2` item 5 adds it for every override dispatch regardless of state.
  const stateRequiresTag = o.mirrorState === 'CORROBORATED_DEGRADED';

  for (let index = 0; index < ROW_PREDICATES.length; index += 1) {
    if (!ROW_PREDICATES[index]!(o)) continue;
    const row = ROWS[index]!;
    const overrideApplies =
      o.activeOverride !== null && overrideCovers(o.activeOverride, row, o);
    const ownerOverrideAvailable = row === 3 || row === 4;

    switch (row) {
      case 1:
        // "Halt. [...] Unmirrored and unundoable is the combination the mirror exists for."
        // In all three states — `22 §3.1` prints Halt/Halt/Halt — and unreachable by
        // override, so the override is not even consulted.
        return {
          disposition: 'HALT',
          matchedRow: 1,
          requiresUnmirroredTag: false,
          overrideId: null,
          ownerOverrideAvailable: false,
          explanation:
            'row 1: recoverability == IRRECOVERABLE halts in every mirror state and is ' +
            'unreachable by override (30 §5.1 item 4 row 1, item 5; 22 §3.1)',
        };

      case 2:
        return {
          disposition: 'HALT',
          matchedRow: 2,
          requiresUnmirroredTag: false,
          overrideId: null,
          ownerOverrideAvailable: false,
          explanation:
            'row 2: above the per-action approval floor, not clock-bearing and carrying no ' +
            'recorded approval; halts in every mirror state and is unreachable by override ' +
            '(30 §5.1 item 4 row 2, item 5)',
        };

      case 3:
        // "**Dispatch**, in `NORMAL` and `CORROBORATED_DEGRADED` only. [...] **In
        // `UNCORROBORATED_STALL`, suspend** — this row is the inversion, and the only escape
        // is a `DegradedModeOverride` scoped to this row."
        if (o.mirrorState === 'UNCORROBORATED_STALL') {
          if (overrideApplies) {
            return {
              disposition: 'DISPATCH_ELIGIBLE',
              matchedRow: 3,
              requiresUnmirroredTag: true,
              overrideId: o.activeOverride!.overrideId,
              ownerOverrideAvailable,
              explanation:
                'row 3 in UNCORROBORATED_STALL suspends, and this effect is inside the ' +
                `scope of override ${o.activeOverride!.overrideId} (30 §5.1 item 5, §5.7.2)`,
            };
          }
          return {
            disposition: 'SUSPEND',
            matchedRow: 3,
            requiresUnmirroredTag: false,
            overrideId: null,
            ownerOverrideAvailable,
            explanation:
              'row 3 in UNCORROBORATED_STALL: THE INVERSION. A unilateral control-side ' +
              'declaration suspends the clock-bearing COMPENSABLE dispatch it would ' +
              'otherwise have obtained (30 §5.6, §5.1 item 4 row 3)',
          };
        }
        return {
          disposition: 'DISPATCH_ELIGIBLE',
          matchedRow: 3,
          requiresUnmirroredTag: stateRequiresTag || overrideApplies,
          overrideId: overrideApplies ? o.activeOverride!.overrideId : null,
          ownerOverrideAvailable,
          explanation:
            `row 3 in ${o.mirrorState}: clock-bearing COMPENSABLE dispatches — the clock ` +
            'outranks the mirror (30 §5.1 item 4 row 3; 22 §3.1)',
        };

      case 4:
        // "Suspend." In all three states — `22 §3.1` prints Suspend/Suspend/Suspend — and
        // restorable by an override scoped to row 4 (`30 §5.1` item 5).
        if (overrideApplies) {
          return {
            disposition: 'DISPATCH_ELIGIBLE',
            matchedRow: 4,
            requiresUnmirroredTag: true,
            overrideId: o.activeOverride!.overrideId,
            ownerOverrideAvailable,
            explanation:
              'row 4 suspends in every mirror state, and this effect is inside the scope ' +
              `of override ${o.activeOverride!.overrideId} (30 §5.1 item 5, §5.7.2)`,
          };
        }
        return {
          disposition: 'SUSPEND',
          matchedRow: 4,
          requiresUnmirroredTag: false,
          overrideId: null,
          ownerOverrideAvailable,
          explanation:
            'row 4: COMPENSABLE discretionary suspends in every mirror state ' +
            '(30 §5.1 item 4 row 4; 22 §3.1)',
        };

      case 5:
        // "**Dispatch** against the committed, locally chained journal." In all three
        // states. `36 §6` adds the tag in `CORROBORATED_DEGRADED`: "as `NORMAL`, with every
        // dispatch tagged". Not tagged in `UNCORROBORATED_STALL`, because `I17f(a)` forbids
        // the tag without a covering PUBLISHED interval and in that state none is known to
        // exist — the residual is `S1H-result.md §10`'s `I17f(c)` partition case.
        return {
          disposition: 'DISPATCH_ELIGIBLE',
          matchedRow: 5,
          requiresUnmirroredTag: stateRequiresTag,
          overrideId: null,
          ownerOverrideAvailable: false,
          explanation:
            `row 5 in ${o.mirrorState}: REVERSIBLE dispatches against the committed, ` +
            'locally chained journal (30 §5.1 item 4 row 5; 22 §3.1)',
        };
    }
  }

  throw new Error(
    `30 §5.1 item 4's five rows are exhaustive and none matched: ${JSON.stringify({
      recoverability: o.recoverability,
      clockBearing: o.clockBearing,
      aboveApprovalFloor: o.aboveApprovalFloor,
    })}`,
  );
}
