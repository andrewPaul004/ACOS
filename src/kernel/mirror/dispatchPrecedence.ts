import {
  DEGRADED_MODE_TIMING,
  DEGRADED_PER_ACTION_APPROVAL_FLOOR,
  isAboveDegradedApprovalFloor,
  isFullHaltPosture,
} from './degradedModeThresholds.js';
import type { ActionClass, Recoverability } from '../canonicalisation/actionCatalogue.js';
import { toDb, type Money } from '../exposure/money.js';
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
 *    | **2** | Above the per-action approval floor (`degraded_per_action_approval_floor_
 *            monetary`, **$20.00**, `51 §3.7`; compared against `effect.request.exposure.
 *            total_exposure`) **and not** clock-bearing | **Halt.** The approval itself
 *            proceeds normally; what halts is *dispatch* of an already-approved above-floor
 *            effect while unmirrored. |
 *    | **3** | Clock-bearing (a live statutory clock citing a RECORD-grade fact, `§9.1`) and
 *            `recoverability == COMPENSABLE` | **Dispatch**, in `NORMAL` and
 *            `CORROBORATED_DEGRADED` only. Journal `DISPATCHED_UNMIRRORED` and raise it in
 *            V6. **In `UNCORROBORATED_STALL`, suspend** (§5.6) — this row is the inversion,
 *            and the only escape is a `DegradedModeOverride` scoped to this row (§5.7.2). |
 *    | **4** | `recoverability == COMPENSABLE`, discretionary | **Suspend.** |
 *    | **5** | `recoverability == REVERSIBLE` | **Dispatch** against the committed, locally
 *            chained journal. |
 *
 *    And item 5's second rule, which qualifies every row above (v1.3.3, `§5.1a`): "Mirror
 *    unreachable continuously for at or beyond `audit_unreachable_full_halt_threshold`
 *    (**30 minutes**, `51 §3.8`) halts **all** classes including REVERSIBLE — the point at
 *    which the company stops."
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
 * simultaneously for the most consequential case.** A refund inside a live FTC clock is
 * COMPENSABLE-inside-a-clock [...] **and** above the per-action approval floor [...]. The
 * table declared no precedence, so the largest and most time-critical refund class had two
 * contradictory specified behaviours."
 *
 * v1.3.3 corrects the same passage's own arithmetic: v1.1 stated that floor in prose as the
 * same `$25` figure as `refund.create`'s `per_action_max`, and `30 §5.1a` records that the
 * two are different quantities of different kinds. The declared floor is `$20.00`, so the
 * ambiguous fixture is a `$22.00` refund inside a live clock rather than a `$30` one — a
 * `$30` refund now DENIES `PER_ACTION` and never reaches this function at all.
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
 *   `totalExposure`        the effect's `exposure.total_exposure`, built by step R's own
 *                          constructor. `51 §3.7`'s declared comparison operand for the
 *                          approval floor. SEE THE NOTE BELOW.
 *   `hasRecordedApproval`  the effect's `approval_id`, kernel state since S1F.
 *   `activeOverride`       `degraded_mode_override`, status `ACTIVE`, owner-granted under a
 *                          real Ed25519 signature.
 *   `unreachableSince`     `mirror_declaration.opened_at` for the company's OPEN declaration,
 *                          or `null` when none is open. `30 §5.1a`'s `continuous_unreachability`
 *                          operand. SEE THE SECOND NOTE BELOW.
 *   `now`                  the control database clock (`36 §6`).
 *
 * ---------------------------------------------------------------------------------
 * THE APPROVAL FLOOR IS DERIVED HERE. THE CALLER CANNOT CHOOSE IT. (v1.3.3, S1H-C1)
 *
 * S1H shipped this classifier with `aboveApprovalFloor: boolean` as a caller-supplied
 * operand, because v1.3.2 declared no numeric floor anywhere and `§42` of the S1H mandate
 * forbids inventing one. That was reported as `S1H-C1` and as PARTIAL, and it was an
 * AUTHORITY ESCAPE HATCH: a caller passing `false` skipped row 2 entirely.
 *
 * **v1.3.3 declares the quantity, so the boolean is gone.** `51 §3.7`:
 * `degraded_per_action_approval_floor_monetary` = **USD 20.00**, compared **strictly**
 * against `effect.request.exposure.total_exposure`. This classifier takes the MONEY and
 * derives the predicate through `isAboveDegradedApprovalFloor`, which is the one place the
 * comparison happens.
 *
 * There is no seam, TEST-ONLY or otherwise, that re-admits the boolean. The pure truth
 * table is still exercised over both of its values — by choosing exposures on either side
 * of the declared floor, which is strictly stronger than a seam because it also proves the
 * derivation.
 * ---------------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------------
 * THE FULL-HALT POSTURE IS DERIVED HERE TOO, FROM THE DECLARATION'S AGE. (v1.3.3, S1H-C10)
 *
 * `30 §5.1` item 5: "Mirror unreachable continuously for at or beyond
 * `audit_unreachable_full_halt_threshold` (**30 minutes**, `51 §3.8`) halts **all** classes
 * including REVERSIBLE — the point at which the company stops."
 *
 * `unreachableSince` is `mirror_declaration.opened_at`, not a boolean and not an elapsed
 * count, for the same reason the floor is a `Money`: a `fullHalt: boolean` would be the same
 * escape hatch one release later. `30 §5.1a` declares the timer semantics and they fall out
 * of the schema — the declaration is opened once, at most one is open per company, and none
 * of the events the architecture lists as NOT resetting the timer touches `opened_at`.
 *
 * THE ONE COHERENCE GUARD. `30 §5.6`'s three states are entered from the mirror
 * OBSERVATION, and `mirrorStateMachine.ts` opens a declaration on entering either degraded
 * state and closes it on returning to `NORMAL`. So `mirrorState !== 'NORMAL'` and
 * `unreachableSince === null` is not a conservative reading — it is an INCOHERENT operand
 * pair, and the only way to produce it is to hand-build operands that the durable machine
 * would never produce. It throws. `NORMAL` with a non-null `unreachableSince` throws for the
 * same reason in the other direction. Without the guard, passing `null` alongside
 * `UNCORROBORATED_STALL` would be exactly the boolean escape hatch this pass removed.
 * ---------------------------------------------------------------------------------
 */
export interface PrecedenceOperands {
  readonly mirrorState: MirrorState;
  readonly actionClass: ActionClass;
  readonly recoverability: Recoverability;
  readonly clockBearing: boolean;
  /**
   * `effect.request.exposure.total_exposure`. `51 §3.7`'s declared comparison operand for
   * the approval floor, and the same operand `51 §3.1` declares for `per_action_max`.
   *
   * NOT `vendor_amount`. NOT a dispatch amount. NOT a model-supplied amount. There is no
   * second monetary field on this type, so there is nothing to confuse it with.
   */
  readonly totalExposure: Money;
  readonly hasRecordedApproval: boolean;
  readonly activeOverride: OverrideScope | null;
  /**
   * `mirror_declaration.opened_at` for the company's OPEN declaration, or `null` when none
   * is open — `30 §5.1a`'s `continuous_unreachability` operand.
   *
   * Must be non-null exactly when `mirrorState !== 'NORMAL'`; the classifier throws on the
   * incoherent pairs rather than reading them conservatively, because a `null` accepted
   * alongside a degraded state would be the escape hatch v1.3.3 removed.
   */
  readonly unreachableSince: Date | null;
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
  /**
   * `30 §5.1a`'s FULL-HALT POSTURE — whether the company's open declaration has been open
   * for at or beyond `audit_unreachable_full_halt_threshold` (v1.3.3, S1H-C10).
   *
   * Reported rather than folded silently into `disposition`, because `VC-A2g` has to be able
   * to assert WHY a REVERSIBLE effect halted: at row 5 with the posture, not at row 1. It is
   * DERIVED from `unreachableSince` and `now`; no caller supplies it.
   */
  readonly fullHaltPosture: boolean;
  /**
   * Set when the FULL-HALT POSTURE is what reduced this row's disposition to `HALT`.
   *
   * `false` for a row that halts on its own merits — rows 1 and 2 halt in every state and in
   * or out of the posture — so a reader cannot mistake the posture for the cause of a halt
   * it did not cause.
   */
  readonly haltedByFullHaltPosture: boolean;
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
  // `51 §3.7`'s strict comparison, derived here and nowhere else in `src/`. The operand is
  // the effect's own `total_exposure`; there is no boolean a caller could supply instead.
  return (
    isAboveDegradedApprovalFloor(o.totalExposure) && !o.clockBearing && !o.hasRecordedApproval
  );
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
/** The ordered first-match evaluation INSIDE the declared state. `§5.1a`'s posture is
 * applied by `classifyDispatchPrecedence` over this result, so `matchedRow` here is always
 * the row `30 §5.1` item 4 itself selects. */
type WithinStateDecision = Omit<
  PrecedenceDecision,
  'fullHaltPosture' | 'haltedByFullHaltPosture'
>;

function classifyWithinState(o: PrecedenceOperands): WithinStateDecision {
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
      totalExposure: toDb(o.totalExposure),
      approvalFloor: toDb(DEGRADED_PER_ACTION_APPROVAL_FLOOR),
    })}`,
  );
}

/**
 * `30 §5.1a`'s `continuous_unreachability`, and the coherence guard on its operand.
 *
 * `30 §5.1a`, verbatim:
 *
 *   continuous_unreachability = now() − declaration.opened_at   , for the open declaration
 *   continuous_unreachability = 0                               , when no declaration is open
 *
 * The guard is not defensive programming. `30 §5.6` enters a degraded state from the mirror
 * OBSERVATION, and `mirrorStateMachine.ts` opens the `AUDIT_MIRROR_DEGRADED` declaration in
 * the same transaction as that entry and closes it on the return to `NORMAL`. So the two
 * incoherent pairs below cannot arise from the durable machine at all, and accepting either
 * would reintroduce exactly the escape hatch v1.3.3 removed from the approval floor: a
 * caller could pass `UNCORROBORATED_STALL` with `unreachableSince: null` and buy an
 * indefinite exemption from the posture.
 */
function continuousUnreachabilityMs(o: PrecedenceOperands): number {
  if (o.mirrorState === 'NORMAL') {
    if (o.unreachableSince !== null) {
      throw new Error(
        'incoherent operands: mirrorState is NORMAL and unreachableSince is non-null. ' +
          '30 §5.6 row 1 is the mirror acknowledging, and a NORMAL resolution closes the ' +
          'AUDIT_MIRROR_DEGRADED declaration (30 §5.7), so no declaration can be open',
      );
    }
    return 0;
  }
  if (o.unreachableSince === null) {
    throw new Error(
      `incoherent operands: mirrorState is ${o.mirrorState} and unreachableSince is null. ` +
        'Both degraded states are entered from the mirror observation and open a ' +
        'declaration (30 §5.6, §5.7), so opened_at exists. 30 §5.1a reads its age as ' +
        'continuous_unreachability and a null here would exempt the state from the ' +
        'FULL-HALT POSTURE indefinitely',
    );
  }
  return o.now.getTime() - o.unreachableSince.getTime();
}

/**
 * Classify one effect. ORDERED, FIRST-MATCH, TOTAL, THEN QUALIFIED BY `§5.1a`'s POSTURE.
 *
 * =================================================================================
 * `30 §5.1a`'s FULL-HALT POSTURE, APPLIED AFTER THE ROW IS DECIDED AND NOT INSTEAD OF IT.
 *
 * `30 §5.1a`: "In the posture, item 4's ordered list is evaluated and then every disposition
 * is reduced to Halt, for **every** recoverability class including REVERSIBLE."
 *
 * So the ordered list runs first and `matchedRow` still reports the architecture's own answer
 * — `VC-A2g` needs to assert that a REVERSIBLE effect halted at ROW 5 UNDER THE POSTURE and
 * not at row 1, and a posture implemented as a sixth row or as an early return would lose
 * that. It is a REDUCTION over the disposition, which is also why it cannot make anything
 * more permissive: `HALT` is the strictest of the three (`mirrorPrecedenceTable.ts`'s
 * `PERMISSIVENESS`) and the reduction only ever moves toward it.
 *
 * THE OVERRIDE, COMPOSED EXACTLY AS `§5.1a` COMPOSES IT. Item 5 says the override is the
 * only escape from "either the halt or `UNCORROBORATED_STALL`'s row-3 suspension", and one
 * sentence later that "an override restores precedence rows 3 and 4 only, never rows 1 or 2".
 * `§5.1a` resolves the composition: "in the posture, rows 3 and 4 are restorable by an
 * in-scope override; rows 1, 2 and 5 are not."
 *
 * The implementation of that is one line — the reduction is skipped exactly where the row's
 * own evaluation already consulted an in-scope override and came out eligible. Row 5 has no
 * override path anywhere in the slice: `precedence_rows` cannot hold `5` (`51 §3.6`, a DB
 * CHECK in `0009`, and `overrideCovers`'s own `row !== 3 && row !== 4` refusal), so a row-5
 * dispatch in the posture halts with no escape to offer.
 * =================================================================================
 */
export function classifyDispatchPrecedence(o: PrecedenceOperands): PrecedenceDecision {
  const unreachableMs = continuousUnreachabilityMs(o);
  const fullHaltPosture = isFullHaltPosture(unreachableMs);
  const within = classifyWithinState(o);

  if (!fullHaltPosture) {
    return { ...within, fullHaltPosture: false, haltedByFullHaltPosture: false };
  }

  // Rows 3 and 4 restored by an in-scope override are the declared escape and survive. Every
  // other disposition — including row 5's REVERSIBLE dispatch, which is what item 5's "all
  // classes including REVERSIBLE" is about — reduces to HALT.
  const restoredByOverride = within.overrideId !== null;
  if (restoredByOverride) {
    return {
      ...within,
      fullHaltPosture: true,
      haltedByFullHaltPosture: false,
      explanation:
        `${within.explanation}; the FULL-HALT POSTURE holds (continuous unreachability ` +
        `${String(unreachableMs)}ms >= ${String(
          DEGRADED_MODE_TIMING.auditUnreachableFullHaltMs,
        )}ms, 51 §3.8) and row ${String(within.matchedRow)} is inside the override's scope, ` +
        'which 30 §5.1 item 5 makes the only escape from the halt (30 §5.1a)',
    };
  }

  if (within.disposition === 'HALT') {
    // Rows 1 and 2 halt on their own merits, in or out of the posture. Reporting the posture
    // as the CAUSE here would be false, so `haltedByFullHaltPosture` stays `false`.
    return { ...within, fullHaltPosture: true, haltedByFullHaltPosture: false };
  }

  return {
    disposition: 'HALT',
    matchedRow: within.matchedRow,
    // A HALT dispatches nothing, so there is nothing to tag and no override to attribute.
    requiresUnmirroredTag: false,
    overrideId: null,
    // Rows 3 and 4 still have an escape to offer the owner; rows 1, 2 and 5 do not.
    ownerOverrideAvailable: within.ownerOverrideAvailable,
    explanation:
      `row ${String(within.matchedRow)} in ${o.mirrorState} resolved ${within.disposition}, ` +
      'and the FULL-HALT POSTURE reduces it to HALT: continuous unreachability ' +
      `${String(unreachableMs)}ms >= audit_unreachable_full_halt_threshold ` +
      `${String(DEGRADED_MODE_TIMING.auditUnreachableFullHaltMs)}ms (51 §3.8), which halts ` +
      'all classes including REVERSIBLE (30 §5.1 item 5, §5.1a)',
    fullHaltPosture: true,
    haltedByFullHaltPosture: true,
  };
}

