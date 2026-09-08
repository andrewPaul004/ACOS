/**
 * The ACOS-owned dispatch outbox: its states, its identities and the refusal vocabulary.
 *
 * =================================================================================
 * WHAT THE OUTBOX IS, IN THE ARCHITECTURE'S OWN WORDS
 *
 * `25 §7`, the fourth idempotency layer, verbatim:
 *
 *   "One outbox row per intended message, unique on the effect idempotency key, carrying
 *    a provider-visible correlation tag (custom header, metadata or tag). The row
 *    transitions to `CLAIMED` in a committed transaction **before** the HTTP call, and a
 *    `CLAIMED` row is never re-dispatched by any path — including recovery, including a
 *    fork, including a manual replay."
 *
 * `34` ADR-026, decision item 2, verbatim:
 *
 *   "At-most-once claim. The row transitions to `CLAIMED` in a committed transaction
 *    before the HTTP call. **A `CLAIMED` row is never re-dispatched by any path** —
 *    recovery, workflow fork, or manual replay (I36)."
 * =================================================================================
 *
 * =================================================================================
 * WHAT THIS SLICE DOES NOT DO, AND WHAT `CLAIMED` THEREFORE DOES NOT MEAN
 *
 * There is no HTTP client, no adapter, no vendor SDK, no credential and no endpoint
 * anywhere under `src/kernel/outbox/`, and `no-transport-boundary.test.ts` asserts each as
 * an absence over the whole source tree.
 *
 * `CLAIMED` means exactly one thing:
 *
 *   ACOS HAS DURABLY COMMITTED THAT THIS EXACT OUTBOX ROW IS CLAIMED FOR ONE EXTERNAL
 *   DISPATCH ATTEMPT.
 *
 * It does NOT mean the request was sent, that a vendor accepted it, that the effect
 * executed, that anything was verified, that external exactly-once holds, that anything
 * was reconciled, or that anything settled. S1I PROVIDES NO EXTERNAL EXACTLY-ONCE. What it
 * proves is one durable outbox identity, one durable claim, and no blind reclaim; what
 * happens after a request leaves a process is the execution slice's problem and the
 * vendor's.
 * =================================================================================
 */

/**
 * The outbox row's two statuses.
 *
 * `CLAIMED` IS `25 §7`'s OWN LITERAL and is transcribed, not chosen.
 *
 * ---------------------------------------------------------------------------------
 * `ENQUEUED` IS AN IMPLEMENTATION DECLARATION — `S1I-C2`.
 *
 * v1.3.3 names `CLAIMED` and says the row "transitions to" it. A transition has a prior
 * state, and no artifact in the package names it: `25 §7`, `34` ADR-026, `24 §4`'s ERD,
 * `33 §6`, `35 §4` and registry `I36` are the six places the outbox appears and none
 * declares a pre-claim identifier.
 *
 * So the STRUCTURE below is architecture — one pre-claim state, one claimed state, exactly
 * one transition between them, and no transition out of `CLAIMED` — and only the
 * IDENTIFIER for the first state is not. `docs/implementation/S1I-owner-clarifications.md`
 * `S1I-C2` records the gap and asks the owner to confirm or rename it.
 * ---------------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------------
 * WHAT IS DELIBERATELY ABSENT FROM THIS UNION — `§22` OF THE S1I MANDATE.
 *
 * No `RETRY_READY`, no `EXPIRED_CLAIM`, no `RECLAIMABLE`, no `AUTO_RETRY`. v1.3.3 declares
 * none of them and each would be a path back out of `CLAIMED`, which is the property the
 * outbox exists to make impossible.
 *
 * No `PRESUMED_EXECUTED`, `VERIFIED` or `NEVER_SENT` either. All three ARE architecture
 * literals — `25 §5` places them on the WORK-ITEM lifecycle and ADR-026 item 4 makes them
 * the resolution of a request that was actually made — but v1.3.3 does not place them in
 * the outbox row's own status domain, and every one of them is reached only from provider
 * evidence. There is no provider. `§23` of the mandate is explicit: "Do NOT generate an
 * unknown outcome in production because no transport exists."
 * ---------------------------------------------------------------------------------
 */
export const OUTBOX_STATUSES = ['ENQUEUED', 'CLAIMED'] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

/**
 * `30 §5.1` item 4's five precedence rows, narrowed to the four that can produce a claim.
 *
 * =================================================================================
 * ROW 2 IS THE ONLY ROW THAT CANNOT, AND v1.3.4 (IRN-01) IS WHY ROW 1 NOW CAN.
 *
 * `22 §3.1` prints row 2 as **Halt** in all three mirror states, and `30 §5.1` item 5
 * makes it unreachable by override: "An override restores precedence rows 3 and 4 only,
 * never rows 1 or 2." So a claim decided at row 2 is not a state this system can produce,
 * and the type says so as well as the database CHECK does.
 *
 * ROW 1 WAS IN THAT SET UNTIL v1.3.4. `30 §5.1b` corrects row 1's `NORMAL` cell only: an
 * otherwise-valid IRRECOVERABLE effect is `DISPATCH_ELIGIBLE` in `NORMAL` and still halts
 * in `UNCORROBORATED_STALL`, in `CORROBORATED_DEGRADED`, under the `§5.1a` posture and
 * against any override. So a claim CAN be decided at row 1 — in `NORMAL`, and nowhere
 * else — and a type that excluded it would make the class ADR-026 is titled for
 * unclaimable, which is the defect IRN-01 records.
 *
 * `claim_mirror_state` is on the same row, so a row-1 claim recorded in a degraded state
 * is detectable after the fact and `outbox-irrecoverable-claim.test.ts` asserts none
 * exists.
 * =================================================================================
 */
export type ClaimingRow = 1 | 3 | 4 | 5;

/**
 * A committed outbox row, as the claim service and the introspection readers see it.
 *
 * `payloadCanonicalBytes` IS THE POINT OF THIS TYPE. `§9` of the mandate: the canonical
 * effect is crossing an asynchronous boundary, and a future dispatcher must not rebuild the
 * vendor request from current mutable state. These are the bytes the canonicaliser emitted
 * at authorisation time, and `dispatch_outbox_payload_binds_hash` makes the database refuse
 * any row whose bytes do not hash to the committed authorised `dispatch_payload_hash`.
 *
 * There is deliberately NO structured payload field, and no `vendorParameters`. A second
 * representation is a second thing to disagree with the hash.
 */
export interface OutboxRow {
  readonly companyId: string;
  readonly idempotencyKey: string;
  readonly outboxId: string;
  readonly effectId: string;
  readonly authorisationId: string;
  readonly actionClass: string;
  /**
   * `26 §5`: "Assigned per action class in the catalogue, not per request, and never by a
   * model." Read out of the committed `effect` row, held there by the composite foreign
   * key, and never a parameter of any function in this directory.
   */
  readonly recoverability: string;
  readonly adapter: string;
  readonly resourceRef: string;
  readonly dispatchPayloadHash: string;
  readonly payloadCanonicalBytes: Buffer;
  readonly correlationTag: string;
  readonly status: OutboxStatus;
  readonly enqueuedAt: Date;
  readonly claimId: string | null;
  readonly claimedAt: Date | null;
  readonly claimedBy: string | null;
  readonly claimMatchedRow: ClaimingRow | null;
  readonly claimMirrorState: string | null;
  /**
   * `30 §5.7.2` item 5: "Every dispatch under it is tagged `DISPATCHED_UNMIRRORED` and
   * carries `override_id`." `36 §6`: in `CORROBORATED_DEGRADED`, "every dispatch tagged".
   *
   * `§16` of the mandate: the REQUIREMENT is preserved immutably on the claim so the
   * execution slice cannot forget that this dispatch was authorised outside `NORMAL`.
   * NOTHING IS TAGGED HERE, because nothing is dispatched, and `I17f(a)`/`I17f(c)`'s
   * actual dispatch→tag enforcement stays OPEN.
   */
  readonly claimRequiresUnmirroredTag: boolean | null;
  /** `30 §5.7.2` item 5's `override_id` — the specific authority, not a boolean. */
  readonly claimOverrideId: string | null;
  /**
   * `30 §9.2.5`'s evidentiary clock — v1.3.4 (CSB-01), `I65`.
   *
   * The live statutory obligation that made row 3 the reason this claim was permitted,
   * and NULL at every other matched row. `0011`'s
   * `dispatch_outbox_clock_evidence_is_row_3` CHECK is the biconditional, and its
   * companion trigger refuses a clock of another company, of another case, or one that
   * was not live at `claimed_at`.
   */
  readonly claimClockRef: string | null;
}

/** The database row shape, for the readers in this directory. Not exported further. */
export interface OutboxDbRow {
  readonly company_id: string;
  readonly idempotency_key: string;
  readonly outbox_id: string;
  readonly effect_id: string;
  readonly authorisation_id: string;
  readonly action_class: string;
  readonly recoverability: string;
  readonly adapter: string;
  readonly resource_ref: string;
  readonly dispatch_payload_hash: string;
  readonly payload_canonical_bytes: Buffer;
  readonly correlation_tag: string;
  readonly status: OutboxStatus;
  readonly enqueued_at: Date;
  readonly claim_id: string | null;
  readonly claimed_at: Date | null;
  readonly claimed_by: string | null;
  readonly claim_matched_row: number | null;
  readonly claim_mirror_state: string | null;
  readonly claim_requires_unmirrored_tag: boolean | null;
  readonly claim_override_id: string | null;
  readonly claim_clock_ref: string | null;
}

export const OUTBOX_COLUMNS = `company_id, idempotency_key, outbox_id, effect_id,
       authorisation_id, action_class, recoverability, adapter, resource_ref,
       dispatch_payload_hash, payload_canonical_bytes, correlation_tag, status,
       enqueued_at, claim_id, claimed_at, claimed_by, claim_matched_row,
       claim_mirror_state, claim_requires_unmirrored_tag, claim_override_id,
       claim_clock_ref`;

export function toOutboxRow(row: OutboxDbRow): OutboxRow {
  return {
    companyId: row.company_id,
    idempotencyKey: row.idempotency_key,
    outboxId: row.outbox_id,
    effectId: row.effect_id,
    authorisationId: row.authorisation_id,
    actionClass: row.action_class,
    recoverability: row.recoverability,
    adapter: row.adapter,
    resourceRef: row.resource_ref,
    dispatchPayloadHash: row.dispatch_payload_hash,
    payloadCanonicalBytes: row.payload_canonical_bytes,
    correlationTag: row.correlation_tag,
    status: row.status,
    enqueuedAt: row.enqueued_at,
    claimId: row.claim_id,
    claimedAt: row.claimed_at,
    claimedBy: row.claimed_by,
    claimMatchedRow: row.claim_matched_row as ClaimingRow | null,
    claimMirrorState: row.claim_mirror_state,
    claimRequiresUnmirroredTag: row.claim_requires_unmirrored_tag,
    claimOverrideId: row.claim_override_id,
    claimClockRef: row.claim_clock_ref,
  };
}

/**
 * The closed refusal vocabulary. A refusal is DATA, not an exception string.
 *
 * `26 §7`'s denial categories set the precedent and `26 §2.2`'s probing rule the reason:
 * a caller learns THAT it was refused and one declared category, and never a
 * distinguishable internal detail it could iterate against.
 */
export const ENQUEUE_REFUSALS = [
  /** No committed `effect` row with this id, or it belongs to another company. */
  'EFFECT_NOT_FOUND',
  /**
   * The effect exists but is not `AUTHORISED`. `26 §12`'s approval resume, verify mode and
   * `R′` are unbuilt, so an `AWAITING_APPROVAL` effect holds no authority to dispatch and
   * must not acquire an outbox row a later claim could take.
   */
  'EFFECT_NOT_AUTHORISED',
  /**
   * `I66` / `25 §7`'s outbox scope — v1.3.4 (OBX-02), resolving `S1I-C5`.
   *
   * "Every effect that will cross an external-write boundary takes exactly one outbox row,
   *  and an internal-only effect takes none. The scope predicate is `effect requires
   *  external dispatch`, derived from the closed action catalogue's execution metadata."
   *
   * The outbox is a DISPATCH-boundary mechanism (`25 §7`'s fourth idempotency layer, and
   * `31 §2` / `33 §1` / ADR-002's "duplicate prevention at the dispatch boundary"). An
   * internal-only effect crosses no such boundary, so a row for it would be a claim
   * against a dispatch that cannot happen — and `I36`'s "a CLAIMED row is never
   * re-dispatched" would then be a constraint on nothing.
   */
  'EFFECT_IS_INTERNAL_ONLY',
  /**
   * The supplied bytes do not hash to the committed authorised `dispatch_payload_hash`.
   *
   * THIS IS THE RECONSTRUCTION GUARD. `§9` of the mandate forbids a future dispatch
   * rebuilding the request from live state; this refusal is what makes a reconstruction
   * that DRIFTED unenqueueable rather than silently accepted. A drifted effect needs a
   * fresh authorisation, and `§27`'s recovery path returns this rather than a payload.
   */
  'PAYLOAD_HASH_DIVERGED',
  /** A row for this effect idempotency identity already exists. `25 §7`, `I36`. */
  'ALREADY_ENQUEUED',
] as const;

export type EnqueueRefusal = (typeof ENQUEUE_REFUSALS)[number];

export const CLAIM_REFUSALS = [
  /** No outbox row for this identity. */
  'OUTBOX_ROW_NOT_FOUND',
  /**
   * `25 §7` / `I36`: the row is already `CLAIMED` and is never re-dispatched by any path.
   *
   * THE DETERMINISTIC ALREADY-CLAIMED OUTCOME. Returned to the loser of a concurrent race,
   * to a restarted process, to the same worker asking twice, and to a manual replay. There
   * is no elapsed time, no clock and no parameter that turns it into a claim.
   */
  'ALREADY_CLAIMED',
  /**
   * `30 §5.1` item 4 classified this effect `SUSPEND` against CURRENT authoritative state.
   * The row stays `ENQUEUED` and remains claimable if the state legitimately changes —
   * `§14`'s reverse case — and nothing is written.
   */
  'PRE_DISPATCH_SUSPENDED',
  /** `30 §5.1` item 4 classified this effect `HALT`. Rows 1 and 2, and the posture. */
  'PRE_DISPATCH_HALTED',
  /**
   * The classifier made this effect eligible only under an override, and the override's
   * allowance could not be taken in this transaction — expired, exhausted, out of scope,
   * over `I63(a)`'s monetary cap, or over `I63(b)`'s rolling aggregate.
   */
  'OVERRIDE_ALLOWANCE_REFUSED',
] as const;

export type ClaimRefusal = (typeof CLAIM_REFUSALS)[number];
