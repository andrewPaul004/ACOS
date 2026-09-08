/**
 * The control → audit transport record. S1G, `26 §7` step X.
 *
 * =================================================================================
 * THIS TYPE IS THE ENTIRE DECLARED INPUT OF THE AUDIT PLANE.
 *
 * `24 §3` K11 "Inputs", verbatim: "The control plane's **primary journal rows**, pushed
 * asynchronously and verified for gap-freedom; **`JournalAttestation` rows every 5
 * minutes**; **its own read-only vendor credentials**; independently computed metrics."
 *
 * `30 §5.4`, on why the list has no fourth entry: "The audit plane has no independent
 * reading of [the control journal's true maximum] and by construction cannot: R10 removed
 * the replica deliberately, and `24 §3` K11's declared inputs contain no control-database
 * read."
 *
 * So the audit plane learns control-side journal facts through THIS RECORD and through
 * the attestation rows that arrive in the same shape, and through nothing else. At S1G
 * the vendor credentials do not exist (`37` S3) and the metric layer does not exist
 * (`37` S6), so this record is the whole input surface.
 * =================================================================================
 *
 * THREE KINDS OF FIELD, AND THE AUDIT STORE TREATS THEM DIFFERENTLY.
 *
 *   `fields`             STRUCTURED. The logical row, field by field. This is what the
 *                        audit store canonicalises FOR ITSELF. `30 §5.4`: what the audit
 *                        plane obtains is "internal consistency [...] because the audit
 *                        store re-chains over the transmitted `ACOS-JCS-1` bytes under
 *                        its own trigger (`I17d`, `I41`)" — which is only true if the
 *                        structured fields are what it starts from.
 *
 *   `transmittedBytes`   The control plane's `ACOS-JCS-1` byte string. `30 §5.3`: "The
 *                        transmitted bytes are what is hashed." The audit store requires
 *                        its OWN construction from `fields` to equal this, so the two
 *                        canonicalisers are compared on every single row rather than only
 *                        at the next `VC-A3` run.
 *
 *   `claimedRowHash`     A CLAIM. `30 §5.9`: a chain "proves nothing at all if the writer
 *                        computes the hashes." It is compared. It is never an INSERT
 *                        value that bypasses audit computation, and there is no code path
 *                        in `src/audit/` that writes it into a chain column.
 *
 * `fields.prevHash` is likewise a claim about the control chain, and the audit store
 * checks it against the row it actually holds at `journalSeq - 1` rather than believing it.
 */

/**
 * The declared row kinds, all on ONE chain and ONE transport.
 *
 * S1G carried two. S1H adds three — `30 §5.7`'s `AUDIT_MIRROR_DEGRADED` declaration,
 * `30 §5.7.1`'s consumed-signal record, and `30 §5.7.2` item 7's override lifecycle events.
 * All three travel this path for the reason 0008 gave for the attestation: a second table
 * or a second transport would be `30 §5.4`'s "second unverified channel".
 *
 * `I17f(b)` in particular REQUIRES `AUDIT_MIRROR_DEGRADED` to arrive here, because the
 * audit plane evaluates that clause from its own holdings and the declaration is one of its
 * two operands.
 */
export type JournalRowKind =
  | 'EFFECT_AUTHORISATION'
  | 'JOURNAL_ATTESTATION'
  | 'AUDIT_MIRROR_DEGRADED'
  | 'MIRROR_CORROBORATION_CONSUMED'
  | 'DEGRADED_MODE_OVERRIDE_EVENT'
  /**
   * S1I. `25 §7` / ADR-026 item 2 / `I36`: the at-most-once outbox claim, recorded.
   *
   * IT TRAVELS THIS PATH BECAUSE `I17` IS A TWO-SIDED DIFF OVER `journal_seq`. A
   * control-side kind the audit store cannot ingest is a permanent gap in that diff, and
   * `30 §5.2` gives a gap "exactly one interpretation" — suppression. So a new control
   * kind is not optional here.
   *
   * `30 §5.10` is the second reason: `I8`'s additive verification list is built from
   * dispatches outside `NORMAL` (`§5.7.2` item 6), and this row carries
   * `outboxRequiresUnmirroredTag` and `overrideId` — the two operands that list needs,
   * held in the audit plane's OWN copy.
   *
   * IT IS A CLAIM AND NOT A DISPATCH. The audit plane learns that ACOS committed to at
   * most one external attempt. It learns nothing about whether one happened, because
   * nothing did.
   */
  | 'OUTBOX_CLAIMED';

/**
 * The structured fields of one journal row.
 *
 * Money arrives as a STRING at the column's declared scale and is never converted to a
 * JavaScript number anywhere on this path. `30 §5.3`: "Per-column declared decimal scale,
 * serialised as a string at that exact scale. `25.0` and `25.00` are different bytes,
 * deliberately." A `number` here would make `25.00` and `25.0` the same value in transit
 * and the divergence would appear as a canonical mismatch with no recoverable cause.
 *
 * Timestamps travel as `Date`, and `prevHash`/`attestedHeadHash` as raw bytes. Neither is
 * pre-formatted by the sender: formatting is canonicalisation, and canonicalisation is
 * what the receiver must do for itself.
 */
export interface JournalRowFields {
  readonly companyId: string;
  readonly journalSeq: bigint;
  readonly journalRowKind: JournalRowKind;

  readonly effectId: string | null;
  readonly authorisationId: string | null;
  readonly decisionId: string | null;
  readonly reservationId: string | null;
  readonly approvalId: string | null;
  readonly idempotencyKey: string | null;
  readonly actionClass: string | null;
  readonly resourceRef: string | null;
  readonly verdict: string | null;
  readonly vendorAmount: string | null;
  readonly totalExposure: string | null;
  readonly forwardIntegral: string | null;
  readonly isRateClass: boolean | null;
  readonly dispatchPayloadHash: string | null;
  readonly constructorSemanticMajor: number | null;
  readonly constructorNonSemanticMinor: number | null;
  readonly policyVersion: string | null;

  /** `30 §5.4`'s `max_journal_seq`, `row_count` and `head_hash`. Attestation rows only. */
  readonly attestedMaxJournalSeq: bigint | null;
  readonly attestedRowCount: bigint | null;
  readonly attestedHeadHash: Uint8Array | null;

  /** `30 §5.7`'s declaration row. `AUDIT_MIRROR_DEGRADED` only. */
  readonly mirrorDeclarationId: string | null;
  readonly mirrorDeclarationEvent: string | null;
  readonly mirrorObservedReason: string | null;

  /** `30 §5.7.1`'s consumed-signal record. `MIRROR_CORROBORATION_CONSUMED` only. */
  readonly corroborationSignalId: string | null;
  readonly corroborationIntervalStart: Date | null;
  readonly corroborationObservedAt: Date | null;
  readonly corroborationExpiresAt: Date | null;
  readonly corroborationReason: string | null;

  /**
   * `30 §5.7.2` item 7's lifecycle events. `DEGRADED_MODE_OVERRIDE_EVENT` — and
   * `overrideId` ALONE also on `OUTBOX_CLAIMED`, because `§5.7.2` item 5 requires an
   * override-backed dispatch to "carry `override_id`". The EVENT columns stay absent
   * there: item 7 makes each override event "its own row".
   */
  readonly overrideId: string | null;
  readonly overrideEvent: string | null;
  readonly overrideActor: string | null;

  /** S1I. `25 §7`'s outbox claim. `OUTBOX_CLAIMED` only. */
  readonly outboxId: string | null;
  readonly outboxCorrelationTag: string | null;
  readonly outboxClaimId: string | null;
  readonly outboxMatchedRow: number | null;
  readonly outboxMirrorState: string | null;
  readonly outboxRequiresUnmirroredTag: boolean | null;
  /**
   * `30 §5.3a` field 18, and `30 §9.2.5`'s evidentiary clock — v1.3.4 (CSB-01, JCS-02).
   *
   * The live statutory obligation that made `30 §5.1` row 3 the reason a claim was
   * permitted, non-NULL only at that row. It travels because the question it answers —
   * "which live statutory obligation justified this?" — is an AUDIT question, and
   * control-plane state the control plane can rewrite would not answer it.
   *
   * `case_ref` ITSELF DOES NOT TRAVEL. `30 §5.3a`: the clock reference "is the fact an
   * audit needs, and it is the narrower disclosure."
   */
  readonly outboxClaimClockRef: string | null;

  /** `30 §5.4`'s `attested_at` on an attestation row; the effect's instant otherwise. */
  readonly occurredAt: Date;

  /** A CLAIM about the control chain. Checked against the held predecessor, not trusted. */
  readonly prevHash: Uint8Array | null;
}

export interface JournalTransportRecord {
  readonly fields: JournalRowFields;
  /** `30 §5.3`: "the transmitted bytes are what is hashed". */
  readonly transmittedBytes: Uint8Array;
  /** A CLAIM. Compared on arrival; never copied into a chain column. */
  readonly claimedRowHash: Uint8Array;
}

/**
 * `30 §5.2`'s re-push outcomes, plus the fail-closed refusals `I17`/`I41` require.
 *
 * `AUDIT_PUSH_DUPLICATE` is INFO and is the EXPECTED retry — the pusher treats it as
 * success. Everything else that is not `ACCEPTED` leaves the audit store's holdings
 * unchanged.
 */
export type AuditIngestOutcome =
  | 'ACCEPTED'
  | 'AUDIT_PUSH_DUPLICATE'
  | 'AUDIT_SEQUENCE_COLLISION'
  | 'AUDIT_CANONICAL_MISMATCH'
  | 'AUDIT_CHAIN_BREAK'
  | 'AUDIT_QUOTA_SATURATED'
  /**
   * `30 §5.7.1a`, v1.3.3, SWR-01. The row was authenticated, admissible, canonical,
   * correctly chained, non-colliding, not a duplicate and in quota, and the audit storage
   * layer could not durably accept it.
   *
   * IT IS NOT `AUDIT_QUOTA_SATURATED` and reusing that member would have been the exact
   * confusion `§5.7.1a` excludes normatively. The row is NOT stored, so this is not an
   * acknowledgement and `mirrored_at` stays NULL — `30 §5.2`'s re-push semantics apply
   * unchanged.
   */
  | 'AUDIT_STORE_WRITE_UNAVAILABLE';

/** The two outcomes after which the control plane may record its advisory `mirrored_at`. */
export function isAcknowledgement(outcome: AuditIngestOutcome): boolean {
  return outcome === 'ACCEPTED' || outcome === 'AUDIT_PUSH_DUPLICATE';
}
