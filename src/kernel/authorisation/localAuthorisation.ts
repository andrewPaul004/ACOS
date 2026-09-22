import type { Client } from '../../db/pool.js';
import { hashConcat, hex } from '../canonicalisation/canonicalBytes.js';
import type { ConstructorVersionIdentity } from '../canonicalisation/constructorVersion.js';
import type { HeldEntityLease } from '../enumeration/entityLease.js';
import { hasSqlstate, WindowExhausted } from '../exposure/errors.js';
import {
  acquireMoneyPathLocks,
  allocateJournalSeq,
  declaredOrder,
} from '../exposure/lockOrder.js';
import { isZero, toDb, type Money } from '../exposure/money.js';
import { withSerialisationRetry } from '../exposure/retry.js';
import {
  authoriseRateClass,
  reserveOrdinary,
  type ExposureBlock,
  type StandingWindowTarget,
} from '../exposure/stepR.js';
import type { WindowInstance } from '../exposure/windowInstance.js';
import {
  Ed25519DecisionSigner,
  type DecisionSigner,
  type DecisionSigningFields,
} from './decisionSignature.js';
import {
  InjectedCommitAbort,
  LOCAL_SQLSTATE,
  LocalAuthorisationDenied as LocalAuthorisationDeniedError,
  type LocalCommitPoint,
} from './localAuthorisationErrors.js';
import type {
  CommittedWindowInstance,
  LocalAuthorisationLineage,
  LocalAuthorisationOutcome,
} from './localAuthorisationResult.js';
import { LOCAL_AUTHORISATION_STEPS, type LocalAuthorisationStep } from './localSteps.js';
import { resolveReferencedWindowInstances } from './referencedWindows.js';

/**
 * S1F — THE LOCAL AUTHORISATION TRANSACTION. `26 §7` steps R through W, in ONE `BEGIN`.
 *
 * =====================================================================================
 * THE ONE SENTENCE THIS MODULE EXISTS TO MAKE TRUE
 *
 * `33 §1`, the decisive property of the selected architecture, verbatim:
 *
 *   "The exposure reservation, the authorisation decision, the effect journal row with its
 *    gap-free sequence and local chain hash, and the resulting state transition commit or
 *    fail together, as a single Postgres transaction."
 *
 * and, on why it was decisive, verbatim:
 *
 *   "`26 §10`'s authorised-loss quantities are the governing control of the whole system,
 *    and their validity rests entirely on reservations being uncheatable under concurrency.
 *    Option B makes that a distributed protocol; Option C makes it a race between a log
 *    append and a projection. Both put the most likely location of a subtle bug inside the
 *    mechanism that bounds financial loss. A makes it a `BEGIN`."
 *
 * There is exactly one `withSerialisationRetry` call in this file and exactly one `work`
 * function inside it. Every row named below is written by that function. Nothing in `src/`
 * commits a reservation in one transaction and its decision in another, and
 * tests/integration/authority/local-transaction-atomicity.test.ts asserts it by killing the
 * transaction at eleven declared points and reading the database afterwards.
 *
 * =====================================================================================
 * THE WRITE ORDER, AND THE ONE PLACE TWO PASSAGES ORDER DIFFERENTLY
 *
 * `30 §5.1` item 3 prints the order of writes:
 *
 *     window_balance FOR UPDATE, ascending window_id · journal_counter FOR UPDATE, last
 *     authorisation row · effect row (status = AUTHORISED) · reservation row
 *     state transition · journal row
 *
 * `26 §7` orders the GATES, and its load-bearing property 8 states the R/T ordering and its
 * purpose, verbatim:
 *
 *   "Idempotency check happens after reservation and before permit (steps T–V), so a
 *    duplicate proposal returns the prior result AND THE RESERVATION IS RELEASED rather
 *    than double-counted."
 *
 * `30 §5.1` puts the effect row before the reservation row; `26 §7` puts R before T, and its
 * stated consequence — a *released* reservation — is only reachable if the reservation was
 * taken before the duplicate was detected.
 *
 * **This is a difference in write order inside one transaction, not a difference in
 * mechanism.** Under a single commit the intermediate order is unobservable in every
 * respect but one: which condition determines the outcome when two of them hold at once —
 * a duplicate proposal that also lacks headroom. `26 §7` decides that case explicitly and
 * gives its reason; `30 §5.1`'s list appears inside a section whose subject is the LOCK
 * order and the single commit point, both of which this module honours exactly. So the gate
 * order is `26 §7`'s, the lock order and the commit point are `30 §5.1`'s and `30 §5.2`'s,
 * and the divergence is confined to the position of one INSERT.
 *
 * The consequence is asserted rather than left implicit:
 * tests/integration/authority/local-idempotency.test.ts's "a duplicate that ALSO lacks
 * headroom denies WINDOW_EXHAUSTED, because R precedes T".
 *
 * The implemented order is therefore:
 *
 *   1  window_balance rows FOR UPDATE, ascending window_id      (30 §5.2 step 1)
 *   2  standing_window_exposure rows FOR UPDATE                 (24 §3 K5, S1A step 2)
 *   3  journal_counter FOR UPDATE, LAST                         (30 §5.2 step 3)
 *   -- SAVEPOINT: everything below is one attempt, releasable as a unit
 *   4  authorisation row + authorisation_window_instance rows    (30 §5.1)
 *   5  R  — exposure_reservation, reservation_window_instance, window_balance,
 *           and for a rate class StandingAuthorization +
 *           StandingRevocationAuthority + standing_window_exposure
 *   6  S  — the approval requirement
 *   7  T/U — the effect row; its (company_id, idempotency_key) key IS I42
 *      V  — on a unique violation: release the attempt and return the prior result
 *   8  the approval row, where step S found a tier
 *   9  W  — the signed AuthorizationDecision
 *  10  journal_seq allocation, then the journal row with its DB-computed chain
 *  COMMIT
 *
 * =====================================================================================
 * WHAT THIS MODULE DOES NOT DO
 *
 * No HTTP. No adapter. No outbox. No external claim. No vendor idempotency. No audit-store
 * push. No reconciliation. No settlement. No approval RESUME and no `R′`. No dispatch of
 * any kind, by any path, under any outcome. `26 §7` step X — the audit write — is not here
 * and cannot be: `30 §5.1`, verbatim, "cross-database atomicity is not attempted, because
 * it does not exist."
 * =====================================================================================
 */

/** The instant source. The kernel's own, never a caller's per-call parameter. */
export interface LocalAuthorisationClock {
  now(): Date;
}

/**
 * The kernel-owned handle S1E's pipeline hands to S1F.
 *
 * ---------------------------------------------------------------------------------
 * WHAT IS DELIBERATELY ABSENT
 *
 * There is no `DispatchPayload` field, no `adapterMethod`, no `vendorParameters`, no
 * `monetaryEffect`, no `preconditionToken` and no credential. `26 §2.1` binds the request
 * and the payload by one hash and the pipeline holds both; what crosses into this module is
 * the request's economics, the `dispatch_payload_hash` that binds it, and the two payload
 * fields the JOURNAL and the EFFECT ROW require by name — the idempotency key (`25 §7`) and
 * the adapter (`24 §3` K4's effect row). Neither is sufficient to dispatch: there is no
 * method, no parameter map and no amount here.
 *
 * There is also no `windowInstances` field, no `reservationAmount`, no `journalSeq` and no
 * `approvalRequirement` override. Every one of those is derived inside the transaction from
 * state the caller cannot reach.
 * ---------------------------------------------------------------------------------
 */
export interface LocalAuthorisationRequestFacts {
  readonly companyId: string;
  readonly sessionId: string;
  readonly taskId: string;
  readonly principalId: string;
  /**
   * `26 §2.1`: "the authorisation reference the gateway allocates". It is the
   * `authorisation` row's primary key and the seed for every other identifier this
   * transaction mints, so every id is a deterministic function of it and a `40001` retry
   * regenerates the same ones.
   */
  readonly authorisationRef: string;
  readonly actionClass: string;
  readonly resourceRef: string;
  readonly resourceId: string;
  readonly dispatchPayloadHash: string;
  readonly intentHash: string;
  readonly contextDigest: string;
  readonly constructorVersion: ConstructorVersionIdentity;
  readonly policyVersion: string;
  readonly exposure: ExposureBlock;
  readonly recoverability: 'REVERSIBLE' | 'COMPENSABLE' | 'IRRECOVERABLE';
  readonly valueDirection: string;
  readonly adapter: string;
  /** `25 §7`'s effect key, computed by the kernel BEFORE this transaction. */
  readonly idempotencyKey: string;
  /**
   * `26 §2.1`'s `enumeration_ref` and `selected_option.option_id`, PERSISTED — v1.3.5
   * (SER-01).
   *
   * =================================================================================
   * WHY THEY ARE HERE, AND WHAT THEY ARE NOT
   *
   * `25 §14.1` makes dispatch-time revalidation MANDATORY and specifies its operands: "the
   * original `action_class`, the original resource identity, **the original
   * enumeration/option identity** and the original constructor/version identity". Three of
   * the four were already on the committed `authorisation` row; the enumeration/option pair
   * was not, so a dispatch one epoch later had nothing to revalidate against.
   *
   * `26 §2.1` HAD ALWAYS REQUIRED THEM ON THE REQUEST — "enumeration_ref — the
   * enumeration_id and its computed_at, for lineage" and "the enumerated option whose
   * option_id the selector names" — so persisting them closes a conformance gap in the row
   * rather than adding a new authority fact.
   *
   * THEY ARE NOT AUTHORITY OPERANDS OF THIS TRANSACTION. Nothing at steps R through W reads
   * either: the gates already ran at C′, under the Epoch-A lease, against these exact
   * values. What they are is EVIDENCE, written once and read one epoch later.
   *
   * NULLABLE, AND THE NULL CASE IS THE RATE BRANCH. `campaign.budget.set` is entered
   * through `commitLocalAuthorisation` directly and never traverses C′ (`26 §7` step C2, no
   * registered constructor), so it has no enumeration and no option. `dispatchRevalidation.ts`
   * refuses to dispatch an effect whose identity is absent rather than treating absence as a
   * pass — the fail-closed direction, recorded in the S1J owner resolution.
   * =================================================================================
   */
  readonly enumerationId: string | null;
  readonly optionId: string | null;
  /** The UNION the matching grants reference (S1E-C4). Every entry constrains the effect. */
  readonly windowRefs: readonly string[];
  /** `26 §4`, intersected at its highest across matching grants by the accepted S1E resolver. */
  readonly approvalRequirement: string;
  readonly autonomyLevel: string;
  readonly gateClass: string;
  /** Count-ledger units this effect consumes against every referenced instance. */
  readonly countUnits: bigint;
}

/** The rate-class extension. `26 §2.1.3`'s handoff, and nothing else. */
export interface RateClassFacts {
  readonly revocationEffectClass: string;
  readonly rateAmount: Money;
  readonly rateCurrency: string;
  readonly ratePeriod: string;
  readonly expiresAt: Date;
  readonly cessationGraceHours: number;
  /** `standing_cap(s, w_instance)` per referenced instance, and the in-scope decision. */
  readonly standingCapFor: (instance: WindowInstance) => {
    readonly standingCap: Money;
    readonly instanceInScope: boolean;
  };
}

export type LocalAuthorisationInput =
  | { readonly kind: 'ORDINARY'; readonly facts: LocalAuthorisationRequestFacts }
  | {
      readonly kind: 'RATE';
      readonly facts: LocalAuthorisationRequestFacts;
      readonly rate: RateClassFacts;
    };

export interface LocalAuthorisationOptions {
  readonly clock: LocalAuthorisationClock;
  readonly signer: DecisionSigner;
  readonly lineage: Omit<LocalAuthorisationLineage, 'localStepsEvaluated' | 'serialisationRetries'>;
  /** Bounded `40001` retry. `40P01` is never retried — see `retry.ts`. */
  readonly maxAttempts?: number;
  /**
   * TEST-ONLY. Invoked at each declared point inside the transaction so `36 §2`'s
   * kill-point matrix can abort a real transaction at a real place. Production passes
   * nothing; the hook receives no authority value and returns nothing that is read.
   */
  readonly at?: (point: LocalCommitPoint) => Promise<void>;
}

export { Ed25519DecisionSigner };

/** The five identifiers this transaction mints, all derived from the authorisation ref. */
interface MintedIds {
  readonly authorisationId: string;
  readonly reservationId: string;
  readonly effectId: string;
  readonly decisionId: string;
  readonly approvalId: string;
  readonly standingAuthorizationId: string;
  readonly revocationAuthorityId: string;
}

/**
 * Deterministic identifiers.
 *
 * `30 §5.2` requires the idempotency key to be "computed before the transaction that
 * allocates the sequence" so "a retry after a crash would [not] compute a different key".
 * The same argument applies to every other identifier this transaction writes: a `40001`
 * retry that minted a fresh `reservation_id` would leave the first attempt's rolled-back id
 * in the caller's hands, and a crash-and-resubmit that minted a fresh `decision_id` would
 * make the prior-result lookup ambiguous.
 *
 * So there is NO random source and NO clock read in this function. Every id is
 * `H(domain ‖ authorisation_ref)` under the accepted framed-concatenation construction.
 */
function mintIds(authorisationRef: string): MintedIds {
  const derive = (domain: string): string =>
    hex(hashConcat(`acos.s1f.${domain}.v1`, [authorisationRef])).slice(0, 32);
  return {
    authorisationId: authorisationRef,
    reservationId: `reservation:${derive('reservation_id')}`,
    effectId: `effect:${derive('effect_id')}`,
    decisionId: `decision:${derive('decision_id')}`,
    approvalId: `approval:${derive('approval_id')}`,
    standingAuthorizationId: `standing:${derive('standing_authorization_id')}`,
    revocationAuthorityId: `revocation:${derive('revocation_authority_id')}`,
  };
}

interface PriorEffectRow {
  readonly effect_id: string;
  readonly authorisation_id: string;
  readonly status: string;
  readonly decision_id: string | null;
  readonly reservation_id: string | null;
  readonly journal_seq: string | null;
}

/**
 * Run `26 §7` steps R–W as one PostgreSQL transaction on the lease's own connection.
 *
 * The lease is NOT re-acquired and NOT re-checked by proxy: the transaction runs on
 * `lease.client`, which is the connection that holds the session-scoped advisory lock, so
 * the lock is held by construction for the whole transaction and `lease.assertHeld()`
 * asserts it at entry, after the isolation check, and again after the commit.
 */
export async function commitLocalAuthorisation(
  lease: HeldEntityLease,
  input: LocalAuthorisationInput,
  options: LocalAuthorisationOptions,
): Promise<LocalAuthorisationOutcome> {
  const facts = input.facts;
  lease.assertHeld();
  if (lease.key.companyId !== facts.companyId) {
    throw new Error(
      `the entity execution lease is for company ${lease.key.companyId}, not ${facts.companyId}`,
    );
  }

  // `26 §2.1.3`'s field table, asserted before anything is locked. A misconstructed
  // exposure block is a DEFECT and must not be softened into a denial: softening it would
  // hide the exact TB-03 shape behind a plausible `WINDOW_EXHAUSTED`.
  if (input.kind === 'RATE') {
    if (!isZero(facts.exposure.totalExposure)) {
      throw new Error(
        `a rate class has total_exposure = 0.00 (26 §2.1.3); got ${toDb(facts.exposure.totalExposure)}`,
      );
    }
    if (facts.exposure.forwardIntegral === null) {
      throw new Error('a rate class carries a forward_integral (26 §2.1.3)');
    }
  } else if (facts.exposure.forwardIntegral !== null) {
    throw new Error(
      'a non-rate class carries no forward_integral (26 §2.1, 26 §2.1.3); ' +
        'this is a construction defect, not a denial',
    );
  }

  const ids = mintIds(facts.authorisationRef);
  const at = options.clock.now();
  const evaluated: LocalAuthorisationStep[] = [];
  const hook = options.at ?? (async (): Promise<void> => undefined);
  /**
   * Attempts entered, counted inside the work function.
   *
   * `withSerialisationRetry` reports the absorbed-retry count on SUCCESS. It cannot report
   * one on a DENIAL, because a `WINDOW_EXHAUSTED` is not retryable and propagates
   * immediately — so a proposal that absorbed a `40001` and then denied would report zero
   * retries from the outer catch. The count is kept here instead, so every outcome carries
   * the true figure and `30 §5.2`'s "intended cost" stays visible on the denial path too.
   */
  let attempts = 0;

  const finish = (retries: number): LocalAuthorisationLineage =>
    Object.freeze({
      ...options.lineage,
      localStepsEvaluated: Object.freeze([...evaluated]),
      serialisationRetries: retries,
    });

  try {
    const outcome = await withSerialisationRetry(
      lease.client,
      async (tx: Client): Promise<LocalAuthorisationOutcome> => {
        // Each attempt re-runs the whole body. The step trace is per-attempt, not
        // cumulative, so a retry does not report step R twice.
        evaluated.length = 0;
        attempts += 1;

        // ---------------------------------------------------------------------------
        // ISOLATION — ASSERTED AT THE DATABASE, NOT ASSUMED FROM CONFIGURATION
        //
        // `33 §6`, verbatim: "v1.1: isolation is set and asserted at the connection, and
        // the constraint is the backstop rather than the guard (R9, MAL-08). v1.0 stated
        // serialisable as intent, and a reservation written inside a framework
        // @transaction at default isolation silently reintroduces write skew on the SUM
        // guard — which `36 §14`'s 10x load test [...] cannot reproduce."
        //
        // So the level is read back out of PostgreSQL. A comment, a default, a framework
        // setting and an application constant are all things that can be true of the code
        // and false of the transaction.
        // ---------------------------------------------------------------------------
        const isolation = await tx.query<{ level: string }>(
          `SELECT current_setting('transaction_isolation') AS level`,
        );
        const level = isolation.rows[0]?.level ?? 'unknown';
        if (level !== 'serializable') {
          throw new Error(
            `the local authorisation transaction requires SERIALIZABLE isolation (33 §6); ` +
              `PostgreSQL reports "${level}"`,
          );
        }
        lease.assertHeld();
        await hook('AFTER_ISOLATION_ASSERTED');

        // ---------------------------------------------------------------------------
        // EVERY referenced applicable window instance, derived from authoritative state
        // ---------------------------------------------------------------------------
        const referenced = await resolveReferencedWindowInstances(
          tx,
          facts.companyId,
          facts.windowRefs,
          at,
        );

        // ---------------------------------------------------------------------------
        // THE DECLARED LOCK ORDER, taken through the single acquisition site.
        //
        // `30 §5.2` (AUD-04) as resolved by S1A owner clarification §1:
        //   1. window_balance          FOR UPDATE, ascending (window_id, instance key)
        //   2. standing_window_exposure FOR UPDATE
        //   3. journal_counter          FOR UPDATE — LAST
        //   4. everything else
        //
        // The counter is taken here and CONSUMED at step 10. Taking it now rather than at
        // the journal insert is what makes it "last" among LOCKS while every row write
        // stays in slot 4 — `30 §5.2`: "The counter is taken last because it is the most
        // contended and holding it across the balance checks would serialise every company
        // operation behind the slowest one."
        // ---------------------------------------------------------------------------
        const instanceRefs = referenced.map((w) => ({
          windowId: w.windowId,
          windowInstanceKey: w.instance.key,
        }));
        if (options.at !== undefined && instanceRefs.length > 0) {
          // TEST-ONLY SPLIT. `36 §2`'s kill-point matrix needs an abort "after the first
          // window lock/check", and production takes all of its locks in one call. So when
          // — and only when — a hook is present, the lowest-ordered instance is locked
          // first on its own so the hook can fire between the two acquisitions. The ORDER
          // is unchanged: `declaredOrder` chooses the same first row the single call would
          // have locked first, and the second call re-locks it as a no-op before
          // continuing. Production issues exactly one acquisition.
          const first = declaredOrder(instanceRefs)[0]!;
          await acquireMoneyPathLocks(tx, {
            companyId: facts.companyId,
            windowInstances: [first],
            includeStandingRows: false,
            includeJournalCounter: false,
          });
          await hook('AFTER_FIRST_WINDOW_LOCK');
        }
        await acquireMoneyPathLocks(tx, {
          companyId: facts.companyId,
          windowInstances: instanceRefs,
          includeStandingRows: input.kind === 'RATE',
          includeJournalCounter: true,
        });
        await hook('AFTER_ALL_WINDOW_LOCKS');

        // Everything below the savepoint is ONE ATTEMPT. `26 §7` step V releases the
        // reservation for a duplicate, and this is that release: the locks taken above are
        // acquired BEFORE the savepoint and are therefore retained across the rollback,
        // which is what stops a concurrent proposal taking the slot in the gap.
        await tx.query('SAVEPOINT s1f_attempt');

        // ---------------------------------------------------------------------------
        // The authorisation row. `30 §5.1`'s first write.
        // ---------------------------------------------------------------------------
        await tx.query(
          `INSERT INTO authorisation (
             authorisation_id, company_id, principal_id, session_id, task_id,
             action_class, resource_ref, resource_id,
             dispatch_payload_hash, intent_hash, context_digest,
             constructor_id, constructor_semantic_major, constructor_non_semantic_minor,
             policy_version,
             vendor_amount, total_exposure, forward_integral, is_rate_class,
             recoverability, value_direction, autonomy_level, gate_class, created_at,
             enumeration_id, option_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                   $16::NUMERIC,$17::NUMERIC,$18::NUMERIC,$19,$20,$21,$22,$23,$24,$25,$26)`,
          [
            ids.authorisationId,
            facts.companyId,
            facts.principalId,
            facts.sessionId,
            facts.taskId,
            facts.actionClass,
            facts.resourceRef,
            facts.resourceId,
            facts.dispatchPayloadHash,
            facts.intentHash,
            facts.contextDigest,
            facts.constructorVersion.constructorId,
            facts.constructorVersion.semanticMajor,
            facts.constructorVersion.nonSemanticMinor,
            facts.policyVersion,
            facts.exposure.vendorAmount === null ? null : toDb(facts.exposure.vendorAmount),
            toDb(facts.exposure.totalExposure),
            facts.exposure.forwardIntegral === null
              ? null
              : toDb(facts.exposure.forwardIntegral),
            input.kind === 'RATE',
            facts.recoverability,
            facts.valueDirection,
            facts.autonomyLevel,
            facts.gateClass,
            at,
            // `25 §14.1`'s revalidation identity. Evidence, not an operand of this
            // transaction — see the facts type's own header.
            facts.enumerationId,
            facts.optionId,
          ],
        );
        for (const window of referenced) {
          await tx.query(
            `INSERT INTO authorisation_window_instance
               (authorisation_id, company_id, window_id, window_instance_key)
             VALUES ($1,$2,$3,$4)`,
            [ids.authorisationId, facts.companyId, window.windowId, window.instance.key],
          );
        }
        await hook('AFTER_AUTHORISATION_ROW');

        // ---------------------------------------------------------------------------
        // STEP R. The ACCEPTED S1A implementation, called unchanged.
        //
        // `participatesInJournal` is FALSE because the counter is already held above and
        // the sequence is allocated at step 10, next to the journal row it numbers. The
        // accepted step-R functions take the declared locks again through the same single
        // acquisition site; re-locking rows this transaction already holds is a no-op in
        // the same declared order, and it keeps the money-path lock discipline in exactly
        // one module.
        // ---------------------------------------------------------------------------
        evaluated.push('R');
        if (input.kind === 'ORDINARY') {
          await reserveOrdinary(tx, {
            companyId: facts.companyId,
            authorisationId: ids.authorisationId,
            reservationId: ids.reservationId,
            actionClass: facts.actionClass,
            resourceRef: facts.resourceRef,
            exposure: facts.exposure,
            windows: referenced.map((w) => ({
              instance: w.instance,
              countUnits: facts.countUnits,
            })),
            at,
            participatesInJournal: false,
          });
          await hook('AFTER_RESERVATION_ROW');
        } else {
          const standingWindows: StandingWindowTarget[] = referenced.map((w) => {
            const cap = input.rate.standingCapFor(w.instance);
            return {
              instance: w.instance,
              countUnits: facts.countUnits,
              standingCap: cap.standingCap,
              instanceInScope: cap.instanceInScope,
            };
          });
          await authoriseRateClass(tx, {
            companyId: facts.companyId,
            authorisationId: ids.authorisationId,
            reservationId: ids.reservationId,
            actionClass: facts.actionClass,
            resourceRef: facts.resourceRef,
            exposure: facts.exposure,
            standingAuthorizationId: ids.standingAuthorizationId,
            revocationAuthorityId: ids.revocationAuthorityId,
            revocationEffectClass: input.rate.revocationEffectClass,
            adapter: facts.adapter,
            rateAmount: input.rate.rateAmount,
            rateCurrency: input.rate.rateCurrency,
            ratePeriod: input.rate.ratePeriod,
            createdAt: at,
            expiresAt: input.rate.expiresAt,
            cessationGraceHours: input.rate.cessationGraceHours,
            windows: standingWindows,
            participatesInJournal: false,
          });
          await hook('AFTER_RESERVATION_ROW');
          await hook('AFTER_STANDING_ROWS');
        }

        // ---------------------------------------------------------------------------
        // STEP S — the approval requirement. `26 §7`: NONE continues to T; a tier returns
        // "REQUIRE_APPROVAL — reservation held", with the reservation ALREADY COMMITTED in
        // this same transaction (property 6, SR5).
        // ---------------------------------------------------------------------------
        evaluated.push('S');
        const requiresApproval = facts.approvalRequirement !== 'NONE';

        // ---------------------------------------------------------------------------
        // STEPS T/U/V — the effect row, and `I42`.
        //
        // `33 §6`: "`effects` primary key includes the idempotency key with a unique
        // constraint (I42), so a duplicate proposal cannot create a second row even if
        // every layer above it fails."
        //
        // The insert IS the check. A `SELECT` first would be a check that two concurrent
        // transactions can both pass; the primary key is a check exactly one of them can.
        // ---------------------------------------------------------------------------
        evaluated.push('T');
        evaluated.push('U');
        try {
          await tx.query(
            `INSERT INTO effect (
               company_id, idempotency_key, effect_id, authorisation_id,
               action_class, resource_ref, adapter, recoverability, gate_class,
               status, created_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
            [
              facts.companyId,
              facts.idempotencyKey,
              ids.effectId,
              ids.authorisationId,
              facts.actionClass,
              facts.resourceRef,
              facts.adapter,
              facts.recoverability,
              facts.gateClass,
              requiresApproval ? 'AWAITING_APPROVAL' : 'AUTHORISED',
              at,
            ],
          );
        } catch (error) {
          if (!hasSqlstate(error, LOCAL_SQLSTATE.UNIQUE_VIOLATION)) throw error;
          // ---------------------------------------------------------------------------
          // STEP V — "RETURN PRIOR RESULT — no new effect".
          //
          // The attempt is released to the savepoint, which takes the reservation, its
          // window-instance rows, the `reserved_monetary` movement, the standing rows and
          // the authorisation row with it. The window locks were taken BEFORE the
          // savepoint and are retained, so no concurrent proposal can occupy the released
          // headroom before this transaction commits.
          //
          // Nothing new is committed: no second reservation (so no double consumption of
          // exposure), no second effect, no second decision and no new journal row.
          // ---------------------------------------------------------------------------
          await tx.query('ROLLBACK TO SAVEPOINT s1f_attempt');
          evaluated.push('V');
          const prior = await tx.query<PriorEffectRow>(
            `SELECT e.effect_id, e.authorisation_id, e.status,
                    d.decision_id, d.reservation_id, j.journal_seq
               FROM effect e
               LEFT JOIN authorisation_decision d ON d.effect_id = e.effect_id
               LEFT JOIN effect_journal j ON j.effect_id = e.effect_id
              WHERE e.company_id = $1 AND e.idempotency_key = $2`,
            [facts.companyId, facts.idempotencyKey],
          );
          const row = prior.rows[0];
          if (row === undefined) {
            // The unique violation says a row with this key exists; not finding it means
            // the constraint and the read disagree, which is corruption rather than a
            // condition a proposal can produce.
            throw new Error(
              `I42 refused idempotency key ${facts.idempotencyKey} and no prior effect row is readable`,
            );
          }
          return Object.freeze({
            outcome: 'DUPLICATE_PRIOR_RESULT' as const,
            priorEffectId: row.effect_id,
            priorAuthorisationId: row.authorisation_id,
            priorDecisionId: row.decision_id,
            priorReservationId: row.reservation_id,
            priorStatus: row.status,
            priorJournalSeq: row.journal_seq === null ? null : BigInt(row.journal_seq),
            // Re-stamped by `withRetryCount` from the retry helper's own tally.
            lineage: finish(Math.max(0, attempts - 1)),
          });
        }
        await hook('AFTER_EFFECT_ROW');

        // ---------------------------------------------------------------------------
        // The approval object, where step S found a tier.
        //
        // `25 §12` item 2: "An Approval object is created in kernel state, carrying the
        // proposal hash, the reservation_id, the authorisation reference and the
        // idempotency key. The proposing workflow terminates. It does not suspend."
        //
        // INITIAL STATE ONLY. `PENDING`, and no transition out of it exists in `src/`.
        // ---------------------------------------------------------------------------
        let approvalId: string | null = null;
        if (requiresApproval) {
          approvalId = ids.approvalId;
          await tx.query(
            `INSERT INTO approval (
               approval_id, company_id, authorisation_id, reservation_id, effect_id,
               idempotency_key, proposal_hash, dispatch_payload_hash,
               constructor_semantic_major, constructor_non_semantic_minor,
               tier, state, created_at, reservation_expires_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'PENDING',$12,$13)`,
            [
              approvalId,
              facts.companyId,
              ids.authorisationId,
              ids.reservationId,
              ids.effectId,
              facts.idempotencyKey,
              // `26 §12`: the approval binds the PROPOSAL hash. `26 §2.1`'s
              // `intent_hash` is the commitment over the proposal the worker made.
              facts.intentHash,
              facts.dispatchPayloadHash,
              facts.constructorVersion.semanticMajor,
              facts.constructorVersion.nonSemanticMinor,
              facts.approvalRequirement,
              at,
              reservationTtl(facts.approvalRequirement, at),
            ],
          );
          await hook('AFTER_APPROVAL_ROW');
        }

        // ---------------------------------------------------------------------------
        // STEP W — PERMIT, and the SIGNED AuthorizationDecision.
        //
        // `I2` is structural on this row: `reservation_id` is NOT NULL with a foreign key,
        // so a decision without a reservation is refused by the database rather than
        // detected by a checker. `26 §2.1.3` removed the last candidate exemption — the
        // rate class writes a real zero-amount row — so there is no exempt class to carve
        // out at S1.
        // ---------------------------------------------------------------------------
        evaluated.push('W');
        const verdict = requiresApproval ? ('REQUIRE_APPROVAL' as const) : ('PERMIT' as const);
        const signingFields: DecisionSigningFields = {
          decisionId: ids.decisionId,
          companyId: facts.companyId,
          authorisationId: ids.authorisationId,
          effectId: ids.effectId,
          reservationId: ids.reservationId,
          approvalId,
          verdict,
          approvalRequirement: facts.approvalRequirement,
          actionClass: facts.actionClass,
          resourceRef: facts.resourceRef,
          idempotencyKey: facts.idempotencyKey,
          dispatchPayloadHash: facts.dispatchPayloadHash,
          vendorAmount: facts.exposure.vendorAmount,
          totalExposure: facts.exposure.totalExposure,
          forwardIntegral: facts.exposure.forwardIntegral,
          isRateClass: input.kind === 'RATE',
          constructorSemanticMajor: facts.constructorVersion.semanticMajor,
          constructorNonSemanticMinor: facts.constructorVersion.nonSemanticMinor,
          policyVersion: facts.policyVersion,
          decidedAt: at,
        };
        const signed = options.signer.sign(signingFields);
        await tx.query(
          `INSERT INTO authorisation_decision (
             decision_id, company_id, authorisation_id, effect_id, reservation_id,
             approval_id, verdict, approval_requirement,
             constructor_semantic_major, constructor_non_semantic_minor, policy_version,
             decided_at, signed_bytes_hash, signature, signing_key_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [
            ids.decisionId,
            facts.companyId,
            ids.authorisationId,
            ids.effectId,
            ids.reservationId,
            approvalId,
            verdict,
            facts.approvalRequirement,
            facts.constructorVersion.semanticMajor,
            facts.constructorVersion.nonSemanticMinor,
            facts.policyVersion,
            at,
            signed.signedBytesHash,
            signed.signature,
            signed.signingKeyId,
          ],
        );
        await hook('AFTER_DECISION_ROW');

        // ---------------------------------------------------------------------------
        // The journal row, with the gap-free sequence and the DB-computed local chain.
        //
        // `30 §5.2`: the counter row is taken FOR UPDATE (above, last in the lock order)
        // "inside the same transaction as the journal insert", which "serialises all
        // journal writes per company, which is the intended cost".
        //
        // The sequence is allocated on the ROW, never from a PostgreSQL sequence: `30 §5.2`
        // is explicit that "nextval outside the transaction leaves permanent gaps on
        // rollback, and a gap is the one signal I17 reads as suppression". So an aborted
        // attempt leaves no gap, and the concurrency test asserts two successful
        // authorisations land on ADJACENT values.
        //
        // `prev_hash` and `row_hash` are NOT supplied here. `I17d` requires them to be
        // "computed by database functions inside each instance", and 0007's trigger refuses
        // a caller-supplied value.
        // ---------------------------------------------------------------------------
        const journalSeq = await allocateJournalSeq(tx, facts.companyId);
        await hook('AFTER_JOURNAL_SEQ_ALLOCATED');
        await tx.query(
          `INSERT INTO effect_journal (
             company_id, journal_seq, journal_row_kind,
             effect_id, authorisation_id, decision_id, reservation_id, approval_id,
             idempotency_key, action_class, resource_ref, verdict,
             vendor_amount, total_exposure, forward_integral, is_rate_class,
             dispatch_payload_hash,
             constructor_semantic_major, constructor_non_semantic_minor, policy_version,
             occurred_at)
           VALUES ($1,$2,'EFFECT_AUTHORISATION',$3,$4,$5,$6,$7,$8,$9,$10,$11,
                   $12::NUMERIC,$13::NUMERIC,$14::NUMERIC,$15,$16,$17,$18,$19,$20)`,
          [
            facts.companyId,
            journalSeq.toString(),
            ids.effectId,
            ids.authorisationId,
            ids.decisionId,
            ids.reservationId,
            approvalId,
            facts.idempotencyKey,
            facts.actionClass,
            facts.resourceRef,
            verdict,
            facts.exposure.vendorAmount === null ? null : toDb(facts.exposure.vendorAmount),
            toDb(facts.exposure.totalExposure),
            facts.exposure.forwardIntegral === null
              ? null
              : toDb(facts.exposure.forwardIntegral),
            input.kind === 'RATE',
            facts.dispatchPayloadHash,
            facts.constructorVersion.semanticMajor,
            facts.constructorVersion.nonSemanticMinor,
            facts.policyVersion,
            at,
          ],
        );
        await hook('AFTER_JOURNAL_ROW');

        // The lease must STILL be held at the commit point. This is the assertion that
        // distinguishes "one session held the lock across propose→local-authorisation" from
        // "a session held it at the start".
        lease.assertHeld();

        const windowInstances: readonly CommittedWindowInstance[] = Object.freeze(
          referenced.map((w) =>
            Object.freeze({ windowId: w.windowId, windowInstanceKey: w.instance.key }),
          ),
        );

        if (requiresApproval && approvalId !== null) {
          return Object.freeze({
            outcome: 'LOCAL_AUTHORISATION_PENDING_APPROVAL' as const,
            verdict: 'REQUIRE_APPROVAL' as const,
            localStatus: 'AWAITING_APPROVAL' as const,
            authorisationId: ids.authorisationId,
            decisionId: ids.decisionId,
            effectId: ids.effectId,
            reservationId: ids.reservationId,
            approvalId,
            approvalTier: facts.approvalRequirement,
            journalSeq,
            windowInstances,
            // Re-stamped by `withRetryCount` from the retry helper's own tally.
            lineage: finish(Math.max(0, attempts - 1)),
          });
        }
        return Object.freeze({
          outcome: 'LOCAL_AUTHORISATION_COMMITTED' as const,
          verdict: 'PERMIT' as const,
          localStatus: 'AUTHORISED' as const,
          authorisationId: ids.authorisationId,
          decisionId: ids.decisionId,
          effectId: ids.effectId,
          reservationId: ids.reservationId,
          journalSeq,
          windowInstances,
          // Re-stamped by `withRetryCount` from the retry helper's own tally.
          lineage: finish(Math.max(0, attempts - 1)),
        });
      },
      options.maxAttempts === undefined
        ? { isolation: 'SERIALIZABLE' }
        : { isolation: 'SERIALIZABLE', maxAttempts: options.maxAttempts },
    );

    // The lease outlives the transaction — it is a session-scoped advisory lock on this
    // connection, not a transaction lock — and that property is what VC-C3's continuous
    // span rests on. Asserted after COMMIT, not before.
    lease.assertHeld();
    return withRetryCount(outcome.value, outcome.retries);
  } catch (error) {
    if (error instanceof WindowExhausted) {
      // `26 §7` D13. The whole transaction rolled back: no reservation, no authorisation,
      // no effect, no decision, no approval, no journal row and no consumed sequence.
      return Object.freeze({
        outcome: 'LOCAL_AUTHORISATION_DENIED' as const,
        step: 'R' as const,
        code: 'WINDOW_EXHAUSTED' as const,
        detail: 'COMMITMENT_GUARD_REFUSED' as const,
        lineage: finish(Math.max(0, attempts - 1)),
      });
    }
    if (error instanceof LocalAuthorisationDeniedError) {
      return Object.freeze({
        outcome: 'LOCAL_AUTHORISATION_DENIED' as const,
        step: error.step,
        code: error.code,
        detail: error.detail,
        lineage: finish(Math.max(0, attempts - 1)),
      });
    }
    // Everything else — an injected abort, a defect, an attack, a `40P01` — propagates as
    // itself. `retry.ts`: a retried deadlock "would erase the only signal that the ordering
    // claim the whole deadlock proof rests on is no longer true."
    throw error;
  }
}

/** Re-stamp the absorbed-retry count onto whichever committed variant was produced. */
function withRetryCount(
  outcome: LocalAuthorisationOutcome,
  retries: number,
): LocalAuthorisationOutcome {
  if (
    outcome.outcome === 'LOCAL_AUTHORISATION_COMMITTED' ||
    outcome.outcome === 'LOCAL_AUTHORISATION_PENDING_APPROVAL' ||
    outcome.outcome === 'DUPLICATE_PRIOR_RESULT' ||
    outcome.outcome === 'LOCAL_AUTHORISATION_DENIED'
  ) {
    return Object.freeze({
      ...outcome,
      lineage: Object.freeze({ ...outcome.lineage, serialisationRetries: retries }),
    });
  }
  return outcome;
}

/**
 * `26 §12.1`, verbatim: "reservation_ttl = tier.sla + reaper_grace: TIER_1 24h + 6h,
 * TIER_2 48h + 6h. OWNER-tier reservations are exempt from reaping and their held exposure
 * is attributed to `I32`'s starvation metric."
 *
 * The value is RECORDED. No reaper reads it in S1F — reservation expiry, the reaper and
 * `I32`'s metric are all unbuilt — and writing the correct TTL now is cheaper than
 * discovering later that every pending approval carried a null one.
 */
function reservationTtl(tier: string, at: Date): Date | null {
  const HOUR = 3_600_000;
  switch (tier) {
    case 'TIER_1':
      return new Date(at.getTime() + (24 + 6) * HOUR);
    case 'TIER_2':
      return new Date(at.getTime() + (48 + 6) * HOUR);
    case 'OWNER':
      return null;
    default:
      throw new Error(`unknown approval tier ${tier} (26 §12)`);
  }
}

export { LOCAL_AUTHORISATION_STEPS, InjectedCommitAbort };
