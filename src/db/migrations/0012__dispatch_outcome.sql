-- 0012 — the local dispatch outcome, and the unknown-outcome state machine.
--
-- =================================================================================
-- WHAT THIS MIGRATION IS, AND WHICH SLICE THE ARCHITECTURE ASSIGNS IT TO
--
-- `phase2-v1.3.4-errata.md` SEQ-01 splits ADR-026 across two slices and names the second
-- one's contents, verbatim:
--
--     "**The later execution/adapter slice builds:** the real adapter and the HTTP or
--      vendor-SDK call; provider idempotency headers and the provider query primitive;
--      **the unknown-outcome runtime transition and `PRESUMED_EXECUTED`; MIE consumption
--      at the execution/outcome point**; the provider sandbox, delivery-event
--      reconciliation, `VERIFIED` and `NEVER_SENT`; and `I36`'s declared verification
--      against a real ESP sandbox, together with `I20`."
--
-- `37 §2` prints the same list. S1J builds the KERNEL-SEMANTICS half of it against a
-- deterministic in-process MOCK adapter and builds none of the vendor half: there is no
-- HTTP client, no provider idempotency header, no provider query, no sandbox, no
-- delivery-event reconciliation, no `VERIFIED` and no `NEVER_SENT` in this file or
-- anywhere under `src/`.
-- =================================================================================
--
-- =================================================================================
-- WHY THE OUTCOME IS A SEPARATE TABLE AND NOT A COLUMN ON `dispatch_outbox`
--
-- `25 §7`'s declared state machine (v1.3.4, OBX-01), verbatim:
--
--     "**Exactly two states: `ENQUEUED` and `CLAIMED`. Exactly one transition:
--      `ENQUEUED → CLAIMED`. No transition out of `CLAIMED`, and no second transition
--      into it.**"
--
-- `0010`'s `dispatch_outbox_state_machine` trigger enforces that by refusing EVERY UPDATE
-- to a `CLAIMED` row. So an outcome cannot be a column on that row without either
-- weakening the trigger or adding a second transition — and both are `I36`. The outcome
-- is therefore a SEPARATE row that REFERENCES the claim, and `dispatch_outbox` is not
-- touched by this migration at all. `§26` of the S1J mandate — "every outcome branch
-- remains non-reclaimable" — is then true by construction rather than by a check: the
-- claim API's `ALREADY_CLAIMED` refusal reads `dispatch_outbox.status`, which no outcome
-- can change.
--
-- AND WHY IT IS NOT A COLUMN ON `effect` EITHER. `0007`'s `effect` table carries
-- `acos_append_only` and `CHECK (status IN ('AUTHORISED', 'AWAITING_APPROVAL'))`, with
-- `33 §6` making a correction "a new row with supersedes". There is no UPDATE path to
-- `effect.status` for any role. `24 §3` K4 requires every effect to reach a terminal
-- status, and the mechanism by which an append-only effect ledger carries a post-dispatch
-- status is not declared in v1.3.4 — recorded as `S1J-C3`. This migration declares it:
-- the outcome row carries the post-dispatch status, one row per outbox identity, and the
-- effect's effective status is `effect.status` until an outcome row exists and that row's
-- `effect_status` afterwards.
-- =================================================================================
--
-- =================================================================================
-- THE TWO OUTCOME KINDS THIS TABLE ADMITS, AND THE TWO IT REFUSES
--
-- `25 §5`'s lifecycle names the adapter's two informative results as edge labels:
--
--     EXECUTING --> VERIFYING: adapter returned
--     EXECUTING --> ATTEMPT_UNRESOLVED: timeout / ambiguous
--
-- and `24 §3` K4's "Failure behaviour" names the same two plus one more: "On adapter
-- failure, bounded retry with jitter against the same idempotency key, then dead-letter
-- to an Incident. On ambiguous outcome, status by recoverability class".
--
--   ADMITTED — `ADAPTER_RETURNED`. `25 §5`'s "adapter returned". The effect is NOT
--   terminal: `25 §5` is explicit that "a 200 from an API is not evidence that the world
--   changed. Verification is an independent read-back", and `24 §3` K4 reaches `VERIFIED`
--   only from that read-back. S1J performs no read-back and claims no `VERIFIED`.
--
--   ADMITTED — `OUTCOME_UNKNOWN`, for REVERSIBLE and COMPENSABLE only. `35 §4`'s
--   declared effect-row state, verbatim: "The effect row is in state
--   `DISPATCHED_OUTCOME_UNKNOWN`. This is a distinct state, not an error — conflating
--   'failed' with 'unknown' is what produces double execution."
--
--   REFUSED — `OUTCOME_UNKNOWN` for IRRECOVERABLE. The `irrecoverable_unknown_undeclared`
--   CHECK below is the fail-closed encoding of `S1J-C1`. See its own comment.
--
--   REFUSED — `ADAPTER_FAILED`. `24 §3` K4 declares the RESPONSE ("bounded retry with
--   jitter against the same idempotency key") and declares no effect state for it, and
--   the declared response contradicts `25 §7`'s "no transition out of `CLAIMED`, and no
--   second transition into it": a retry of a claimed row has no row to claim. Recorded as
--   `S1J-C2`. `§19` of the S1J mandate: "If no immediate known-not-sent state exists, do
--   not invent one. Report the omission as architecture-driven." There is no `CHECK` arm
--   for it, so the database refuses the row.
-- =================================================================================


-- ---------------------------------------------------------------------------------
-- PART 1 — THE PARENT KEY THE OUTCOME ROW POINTS AT.
--
-- A composite unique index over the outbox columns an outcome must agree with, so the
-- agreement is a FOREIGN KEY rather than a trigger comparison. Every member is NOT NULL
-- on a `CLAIMED` row and `claim_id` is NULL on an `ENQUEUED` one, so an outcome row for a
-- row that was never claimed has no parent to match: THE ORDERING IS ENFORCED BY THE KEY
-- SPACE, not by a check.
-- ---------------------------------------------------------------------------------
CREATE UNIQUE INDEX dispatch_outbox_claimed_identity
  ON dispatch_outbox (company_id, idempotency_key, outbox_id, effect_id, authorisation_id,
                      claim_id, adapter, recoverability);


-- ---------------------------------------------------------------------------------
-- PART 2 — THE OUTCOME ROW.
-- ---------------------------------------------------------------------------------
CREATE TABLE effect_dispatch_outcome (
  -- IDENTITY. `25 §7`'s effect idempotency key is the primary key, for the reason `0010`
  -- gave: it is the semantic effect identity, and one intended external effect has at
  -- most one local outcome. `§25` of the mandate's double-processing race is decided
  -- here, in the key space, and not only by the row lock the service takes.
  company_id              TEXT        NOT NULL REFERENCES company(company_id),
  idempotency_key         TEXT        NOT NULL,

  outbox_id               TEXT        NOT NULL UNIQUE,
  effect_id               TEXT        NOT NULL UNIQUE,
  authorisation_id        TEXT        NOT NULL UNIQUE,
  -- The claim this outcome belongs to. NOT NULL, and a foreign-key member, so an outcome
  -- can only exist for a claim that committed.
  claim_id                TEXT        NOT NULL UNIQUE,

  -- `26 §5`: "Assigned per action class in the catalogue, not per request, and never by a
  -- model." Both of these are FOREIGN-KEY MEMBERS against the outbox row, which is itself
  -- key-bound to the committed `effect`. `§17` of the mandate: a caller that claims a
  -- different recoverability, or a different adapter, cannot write it here — the only
  -- admissible values are the ones the committed effect holds.
  adapter                 TEXT        NOT NULL,
  recoverability          TEXT        NOT NULL,

  -- THE TYPED ADAPTER OUTCOME. `§14` of the mandate: "The adapter is part of the TCB. The
  -- model must not choose the outcome." This is the kind the trusted adapter returned,
  -- from the closed domain below, and it is never a parsed error string.
  outcome_kind            TEXT        NOT NULL,

  -- THE RESULTING POST-DISPATCH EFFECT STATUS. Derived from `(recoverability,
  -- outcome_kind)` by the biconditional CHECKs below, so the state machine is the
  -- database's and not a service's.
  effect_status           TEXT        NOT NULL,

  -- The adapter's own opaque references. NON-AUTHORITATIVE, and deliberately narrow.
  --
  -- `36 §7` / `I26`: "Every RECORD-grade fact resolves to a retained vendor response with
  -- a matching content hash [...] A compromised adapter must produce a well-formed VENDOR
  -- RESPONSE, not a well-formed ACOS FACT." So what is stored is a HASH and an opaque
  -- reference, and nothing parsed out of a response body is authority for anything.
  --
  -- `§33` of the mandate: there is NO exposure column, NO amount, NO reservation figure,
  -- NO MIE limit and NO threshold here. An adapter does not choose economic quantities.
  provider_reference      TEXT,
  raw_response_hash       TEXT,

  -- `30 §5.7.2` item 5 / `36 §6` / `§12` and `§38` of the mandate.
  --
  -- `requires_unmirrored_tag` is COPIED FROM THE CLAIM and `unmirrored_tag_sent` records
  -- what the gateway put on the envelope. The CHECK below makes them equal, so an adapter
  -- or a mapper that drops the tag cannot produce a committed outcome row: the suppression
  -- is refused by the database rather than detected by a reviewer.
  requires_unmirrored_tag BOOLEAN     NOT NULL,
  unmirrored_tag_sent     BOOLEAN     NOT NULL,
  override_id             TEXT,

  -- `§20` of the mandate. The economic consequence of THIS outcome, recorded as a value so
  -- that "nothing moved" is an assertion in the row rather than an absence a reader has to
  -- infer. The CHECK pins it to `NONE`; widening it is a migration and an owner decision.
  economic_movement       TEXT        NOT NULL,

  -- `§6` of the mandate's ordering, recorded: the instant the trusted adapter was invoked,
  -- which is necessarily after the claim committed, and the instant its typed outcome was
  -- durably resolved locally.
  invoked_at              TIMESTAMPTZ NOT NULL,
  outcome_at              TIMESTAMPTZ NOT NULL,

  -- The `DISPATCH_OUTCOME` journal row's sequence. `23 §6` B8's record of this fact.
  journal_seq             BIGINT      NOT NULL,

  PRIMARY KEY (company_id, idempotency_key),

  -- THE BINDING TO THE COMMITTED CLAIM. Eight columns, all NOT NULL, against PART 1's
  -- unique index. An outcome for an unclaimed row, for another company's row, for another
  -- effect, under a relabelled recoverability or against a substituted adapter has no
  -- parent row and is refused by the key.
  FOREIGN KEY (company_id, idempotency_key, outbox_id, effect_id, authorisation_id,
               claim_id, adapter, recoverability)
    REFERENCES dispatch_outbox (company_id, idempotency_key, outbox_id, effect_id,
                                authorisation_id, claim_id, adapter, recoverability),

  FOREIGN KEY (company_id, override_id)
    REFERENCES degraded_mode_override (company_id, override_id),

  -- ---------------------------------------------------------------------------------
  -- THE DECLARED DOMAINS
  -- ---------------------------------------------------------------------------------
  --
  -- `25 §5`'s "adapter returned" and `35 §4`'s unknown. `ADAPTER_FAILED` IS ABSENT — see
  -- the header note and `S1J-C2`.
  CONSTRAINT dispatch_outcome_kind_declared
    CHECK (outcome_kind IN ('ADAPTER_RETURNED', 'OUTCOME_UNKNOWN')),

  -- `35 §4`'s literal, and one implementation declaration.
  --
  -- `DISPATCHED_OUTCOME_UNKNOWN` is `35 §4`'s own state name for the effect row and is
  -- transcribed, not chosen.
  --
  -- `DISPATCHED_AWAITING_VERIFICATION` IS AN IMPLEMENTATION DECLARATION — `S1J-C4`. The
  -- SEMANTICS are declared: `25 §5` moves the work item to `VERIFYING` when the adapter
  -- returns, states that "a 200 from an API is not evidence that the world changed", and
  -- `24 §3` K4 reaches `VERIFIED` only from an independent read-back. What v1.3.4 does not
  -- declare is an IDENTIFIER for the effect row's own state in that interval: there is no
  -- `DISPATCHED` state anywhere in the package. The name is built from `35 §4`'s prefix so
  -- the two post-dispatch states share a domain, and it is deliberately NEITHER `VERIFIED`
  -- (K4's terminal literal) NOR `DISPATCHED` (declared nowhere).
  CONSTRAINT dispatch_outcome_effect_status_declared
    CHECK (effect_status IN ('DISPATCHED_AWAITING_VERIFICATION',
                             'DISPATCHED_OUTCOME_UNKNOWN')),

  CONSTRAINT dispatch_outcome_recoverability_declared
    CHECK (recoverability IN ('REVERSIBLE', 'COMPENSABLE', 'IRRECOVERABLE')),

  -- THE STATE MACHINE, AS TWO BICONDITIONALS. A service bug is a constraint violation
  -- rather than a quiet wrong answer, which is the discipline `0011`'s
  -- `dispatch_outbox_clock_evidence_is_row_3` set.
  CONSTRAINT dispatch_outcome_returned_is_awaiting_verification
    CHECK ((outcome_kind = 'ADAPTER_RETURNED')
           = (effect_status = 'DISPATCHED_AWAITING_VERIFICATION')),
  CONSTRAINT dispatch_outcome_unknown_is_outcome_unknown
    CHECK ((outcome_kind = 'OUTCOME_UNKNOWN')
           = (effect_status = 'DISPATCHED_OUTCOME_UNKNOWN')),

  /*
   * THE FAIL-CLOSED ENCODING OF `S1J-C1`. THE LOAD-BEARING CONSTRAINT IN THIS FILE.
   *
   * v1.3.4 states the IRRECOVERABLE unknown-outcome policy in four places, and all four
   * state it as ONE inseparable pair:
   *
   *   `25 §10`:  "**Assume it happened. Never re-dispatch.** Mark `PRESUMED_EXECUTED`,
   *              consume the irrecoverable unit, and resolve later from the provider's
   *              delivery event matched on the correlation tag."
   *   `24 §3` K4: "irrecoverable assumes executed, marks `PRESUMED_EXECUTED`, **consumes
   *              the irrecoverable unit** and never re-dispatches".
   *   `34` ADR-026 item 3: the same sentence.
   *   `35 §12.3`: "It is marked `PRESUMED_EXECUTED`, **the irrecoverable unit is
   *              consumed**, and the provider's delivery event [...] resolves it".
   *
   * WHAT "CONSUME THE IRRECOVERABLE UNIT" IS AS A LEDGER MUTATION IS DECLARED NOWHERE.
   *
   *   - `24 §3` K5's authoritative `window_balance` schema carries THREE irrecoverable
   *     terms — `reserved_irrecoverable`, `presumed_irrecoverable`,
   *     `realised_irrecoverable` — and no artifact says which pair a consumption moves.
   *   - The registry binds `I3`'s term 3 to "`Σ presumed exposure of effects in
   *     **PRESUMED_SETTLED**`", and `PRESUMED_SETTLED` is `I32`'s liquidity-override
   *     state for a MONEY reservation, not `PRESUMED_EXECUTED`.
   *   - `I20` bounds provider-accepted messages against "Σ **reserved** irrecoverable
   *     units", and its own test column requires a fixture window "including a
   *     `PRESUMED_EXECUTED` row" — which reads as the reserved term still standing after
   *     the consumption, and therefore as NOT a decrement of `reserved_irrecoverable`.
   *   - `26 §7` step R's PROSE reserves "`exposure.total_exposure` into the ordinary
   *     reservation term — `I3` term 1"; its FLOWCHART node reserves "money ·
   *     irrecoverable-count". `51 §2` gives the MIE windows both a `max_count` and a
   *     `max_irrecoverable_units` at the same figures (13 / 43), so which of the two
   *     ledgers `MIE_discretionary` headroom IS is not decided either.
   *   - And the accepted implementation reserves NEITHER: `stepR.reserveOrdinary` moves
   *     `reserved_monetary` and `reserved_count`, and `reserved_irrecoverable` has no
   *     production writer in any accepted slice. THERE IS NO RESERVED UNIT TO CONSUME.
   *
   * `§2` and `§47` of the S1J mandate: "If v1.3.4 does not define the answer
   * sufficiently: RETURN PARTIAL. [...] do not create a new MIE accounting scheme."
   *
   * So this CHECK refuses the row. The consequence is stated rather than hidden: an
   * IRRECOVERABLE effect whose mock dispatch returns an unknown outcome reaches NO
   * durable outcome state, and `PRESUMED_EXECUTED` does not exist in this schema.
   *
   * THE SAFETY PROPERTY IS UNAFFECTED, and that is why the refusal is safe. The outbox row
   * stays `CLAIMED`, `0010`'s trigger admits no UPDATE to it, and the claim API returns
   * `ALREADY_CLAIMED` to every path — recovery, fork and manual replay included. "Never
   * re-dispatch" holds. What is missing is the ACCOUNTING half, and inventing it is what
   * the mandate forbids.
   */
  CONSTRAINT dispatch_outcome_irrecoverable_unknown_undeclared
    CHECK (NOT (recoverability = 'IRRECOVERABLE' AND outcome_kind = 'OUTCOME_UNKNOWN')),

  /*
   * `§12` AND `§38`. The adapter may not suppress the degraded-state requirement.
   *
   * `30 §5.7.2` item 5: "Every dispatch under it is tagged `DISPATCHED_UNMIRRORED` and
   * carries `override_id`." `36 §6`: in `CORROBORATED_DEGRADED`, "every dispatch tagged".
   *
   * The claim recorded the REQUIREMENT (`dispatch_outbox.claim_requires_unmirrored_tag`);
   * this row records what the gateway actually put on the envelope. Equality is a CHECK,
   * so `§40` item 6's attack — an adapter or mapper that drops the tag — cannot produce a
   * committed row.
   */
  CONSTRAINT dispatch_outcome_unmirrored_tag_not_suppressed
    CHECK (unmirrored_tag_sent = requires_unmirrored_tag),

  /*
   * `§20`, `§33` AND `§42`. NO ECONOMIC MOVEMENT IS DECLARED FOR EITHER ADMITTED BRANCH.
   *
   *   `ADAPTER_RETURNED`. `25 §5`: "A 200 from an API is not evidence that the world
   *   changed [...] and for money, it is the settlement reconciliation, not the API
   *   response." `24 §3` K5's realised term is fed by "settlement events from the finance
   *   computation", which `28 §4` owns and S1J does not build. So a returned adapter call
   *   realises nothing, and `§18`'s "if architecture says success makes it realised" is
   *   answered: it does not.
   *
   *   `OUTCOME_UNKNOWN` for money. `35 §4`: "The exposure reservation **remains held**. It
   *   is not released on timeout, because releasing it would let a retry plus a concurrent
   *   proposal collectively exceed the window." Holding is the ABSENCE of a movement, and
   *   the presumed term is `I32`'s override path, not this one.
   *
   * Pinning the column means a later slice that moves money on an outcome must change this
   * constraint, which is a migration and a review rather than a diff nobody reads.
   */
  CONSTRAINT dispatch_outcome_economic_movement_declared
    CHECK (economic_movement = 'NONE'),

  CONSTRAINT dispatch_outcome_response_hash_shape
    CHECK (raw_response_hash IS NULL OR raw_response_hash ~ '^[0-9a-f]{64}$'),

  -- `§6`: claim COMMIT strictly precedes adapter invocation, and the invocation precedes
  -- its own outcome. Recorded as an ordering constraint on the instants.
  CONSTRAINT dispatch_outcome_invocation_precedes_outcome
    CHECK (invoked_at <= outcome_at)
);

/*
 * APPEND-ONLY. `33 §6`: a correction is "a new row with supersedes", never an in-place
 * rewrite, and the outcome of a dispatch attempt is exactly the class of fact that must
 * not be editable after the event. Composed with the primary key this is what makes
 * `§25`'s "at most one may perform state movement" true for all time rather than only
 * inside one transaction.
 */
CREATE TRIGGER effect_dispatch_outcome_append_only
  BEFORE UPDATE OR DELETE ON effect_dispatch_outcome
  FOR EACH ROW EXECUTE FUNCTION acos_append_only();

/*
 * The two nullable claim facts a FOREIGN KEY cannot carry.
 *
 * `override_id` is nullable on both sides, so `MATCH SIMPLE` would not enforce agreement
 * when it is NULL, and `requires_unmirrored_tag` is nullable on the outbox row (it is NULL
 * while `ENQUEUED`). A trigger reads the parent row and compares both, so an outcome
 * cannot quietly claim a different override or a different degraded-state requirement from
 * the claim it belongs to.
 */
CREATE FUNCTION dispatch_outcome_agrees_with_claim() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_status         TEXT;
  v_requires_tag   BOOLEAN;
  v_override_id    TEXT;
BEGIN
  SELECT status, claim_requires_unmirrored_tag, claim_override_id
    INTO v_status, v_requires_tag, v_override_id
    FROM dispatch_outbox
   WHERE company_id = NEW.company_id AND idempotency_key = NEW.idempotency_key;

  IF NOT FOUND THEN
    -- Unreachable: the composite foreign key resolves first. An assertion.
    RAISE EXCEPTION 'DISPATCH_OUTCOME_WITHOUT_OUTBOX_ROW'
      USING ERRCODE = 'ACS37',
            DETAIL  = format('company=%s idempotency_key=%s',
                             NEW.company_id, NEW.idempotency_key);
  END IF;

  IF v_status <> 'CLAIMED' THEN
    RAISE EXCEPTION 'DISPATCH_OUTCOME_WITHOUT_CLAIM'
      USING ERRCODE = 'ACS37',
            DETAIL  = format(
              'an outcome requires a committed claim (25 §7, 30 §5.1 item 3); '
              || 'outbox_id=%s status=%s', NEW.outbox_id, v_status);
  END IF;

  IF NEW.requires_unmirrored_tag IS DISTINCT FROM v_requires_tag THEN
    RAISE EXCEPTION 'DISPATCH_OUTCOME_TAG_REQUIREMENT_DIVERGED'
      USING ERRCODE = 'ACS37',
            DETAIL  = format(
              'the claim required %s and the outcome recorded %s (30 §5.7.2 item 5, 36 §6); '
              || 'outbox_id=%s', v_requires_tag, NEW.requires_unmirrored_tag, NEW.outbox_id);
  END IF;

  IF NEW.override_id IS DISTINCT FROM v_override_id THEN
    RAISE EXCEPTION 'DISPATCH_OUTCOME_OVERRIDE_DIVERGED'
      USING ERRCODE = 'ACS37',
            DETAIL  = format(
              'the claim was taken under override %s and the outcome cites %s '
              || '(30 §5.7.2 item 5); outbox_id=%s',
              v_override_id, NEW.override_id, NEW.outbox_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER dispatch_outcome_agrees_with_claim
  BEFORE INSERT ON effect_dispatch_outcome
  FOR EACH ROW EXECUTE FUNCTION dispatch_outcome_agrees_with_claim();


-- =================================================================================
-- PART 3 — THE JOURNAL ROW KIND FOR THE OUTCOME
--
-- `23 §6` B8: "No effect originating in reasoning can occur that is not recorded." The
-- claim was the last record BEFORE an effect could leave; this is the first record AFTER
-- one may have. It travels the SAME `effect_journal`, the SAME `journal_counter`, the SAME
-- chain trigger and the SAME replication path, for the reason `0008`, `0009` and `0010`
-- each gave: a second table would be `30 §5.4`'s "second unverified channel".
--
-- CONTROL-ARTIFACT CONSEQUENCE, DISCLOSED AND NOT DISCHARGED. `50 §2` class 20 is
-- "`ACOS-JCS-1`: column order per row kind", and `30 §5.3a` says a row kind in service
-- without a declared order there "is a defect of this class". v1.3.4 declares an order for
-- `acos.journal.outbox_claimed.v1` and for no other kind. THIS MIGRATION PUTS A SECOND
-- KIND IN SERVICE, so the order below is transcribed from `docs/implementation/
-- S1J-contract.md §5` — an IMPLEMENTATION DECLARATION, recorded as `S1J-C5`, in exactly
-- the position `S1I-C4` occupied before the owner made `30 §5.3a` normative. The class-20
-- signature has been owed since v1.3.2 and is STILL OWED; this extends the same owed
-- obligation and NOTHING HERE CLAIMS IT IS SIGNED.
-- =================================================================================

ALTER TABLE effect_journal
  DROP CONSTRAINT journal_row_kind_declared;

ALTER TABLE effect_journal
  ADD CONSTRAINT journal_row_kind_declared
  CHECK (journal_row_kind IN (
    'EFFECT_AUTHORISATION',
    'JOURNAL_ATTESTATION',
    'AUDIT_MIRROR_DEGRADED',
    'MIRROR_CORROBORATION_CONSUMED',
    'DEGRADED_MODE_OVERRIDE_EVENT',
    'OUTBOX_CLAIMED',
    -- S1J. The typed adapter outcome of one claimed dispatch attempt.
    --
    -- THE NAME IS `DISPATCH_OUTCOME`, NOT `DISPATCHED`. It records that a trusted adapter
    -- was invoked under a fresh claim and what typed result it returned. It records no
    -- provider acceptance, no delivery, no verification and no settlement, and the mock
    -- adapter S1J tests it with is not evidence about any provider.
    'DISPATCH_OUTCOME'
  ));

ALTER TABLE effect_journal
  ADD COLUMN dispatch_adapter       TEXT,
  ADD COLUMN dispatch_outcome_kind  TEXT,
  ADD COLUMN dispatch_effect_status TEXT;

/*
 * The per-kind shape, extended.
 *
 * The six ACCEPTED arms are reproduced clause for clause with the three new columns added
 * as REQUIRED-ABSENT — the discipline `0008`, `0009` and `0010` each applied: an accepted
 * row kind must not silently acquire a permissible new field.
 */
ALTER TABLE effect_journal
  DROP CONSTRAINT journal_row_shape_per_kind;

ALTER TABLE effect_journal
  ADD CONSTRAINT journal_row_shape_per_kind CHECK (
    CASE journal_row_kind
      WHEN 'EFFECT_AUTHORISATION' THEN
             effect_id                      IS NOT NULL
         AND authorisation_id               IS NOT NULL
         AND decision_id                    IS NOT NULL
         AND reservation_id                 IS NOT NULL
         AND idempotency_key                IS NOT NULL
         AND action_class                   IS NOT NULL
         AND resource_ref                   IS NOT NULL
         AND verdict                        IS NOT NULL
         AND total_exposure                 IS NOT NULL
         AND is_rate_class                  IS NOT NULL
         AND dispatch_payload_hash          IS NOT NULL
         AND constructor_semantic_major     IS NOT NULL
         AND constructor_non_semantic_minor IS NOT NULL
         AND policy_version                 IS NOT NULL
         AND attested_max_journal_seq       IS NULL
         AND attested_row_count             IS NULL
         AND attested_head_hash             IS NULL
         AND mirror_declaration_id          IS NULL
         AND mirror_declaration_event       IS NULL
         AND mirror_observed_reason         IS NULL
         AND corroboration_signal_id        IS NULL
         AND corroboration_interval_start   IS NULL
         AND corroboration_observed_at      IS NULL
         AND corroboration_expires_at       IS NULL
         AND corroboration_reason           IS NULL
         AND override_id                    IS NULL
         AND override_event                 IS NULL
         AND override_actor                 IS NULL
         AND outbox_id                      IS NULL
         AND outbox_correlation_tag         IS NULL
         AND outbox_claim_id                IS NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND outbox_requires_unmirrored_tag IS NULL
         AND dispatch_adapter               IS NULL
         AND dispatch_outcome_kind          IS NULL
         AND dispatch_effect_status         IS NULL

      WHEN 'JOURNAL_ATTESTATION' THEN
             attested_max_journal_seq       IS NOT NULL
         AND attested_row_count             IS NOT NULL
         AND attested_head_hash             IS NOT NULL
         AND effect_id                      IS NULL
         AND authorisation_id               IS NULL
         AND decision_id                    IS NULL
         AND reservation_id                 IS NULL
         AND approval_id                    IS NULL
         AND idempotency_key                IS NULL
         AND action_class                   IS NULL
         AND resource_ref                   IS NULL
         AND verdict                        IS NULL
         AND vendor_amount                  IS NULL
         AND total_exposure                 IS NULL
         AND forward_integral               IS NULL
         AND is_rate_class                  IS NULL
         AND dispatch_payload_hash          IS NULL
         AND constructor_semantic_major     IS NULL
         AND constructor_non_semantic_minor IS NULL
         AND policy_version                 IS NULL
         AND mirror_declaration_id          IS NULL
         AND mirror_declaration_event       IS NULL
         AND mirror_observed_reason         IS NULL
         AND corroboration_signal_id        IS NULL
         AND corroboration_interval_start   IS NULL
         AND corroboration_observed_at      IS NULL
         AND corroboration_expires_at       IS NULL
         AND corroboration_reason           IS NULL
         AND override_id                    IS NULL
         AND override_event                 IS NULL
         AND override_actor                 IS NULL
         AND outbox_id                      IS NULL
         AND outbox_correlation_tag         IS NULL
         AND outbox_claim_id                IS NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND outbox_requires_unmirrored_tag IS NULL
         AND dispatch_adapter               IS NULL
         AND dispatch_outcome_kind          IS NULL
         AND dispatch_effect_status         IS NULL

      WHEN 'AUDIT_MIRROR_DEGRADED' THEN
             mirror_declaration_id          IS NOT NULL
         AND mirror_declaration_event       IS NOT NULL
         AND effect_id                      IS NULL
         AND authorisation_id               IS NULL
         AND decision_id                    IS NULL
         AND reservation_id                 IS NULL
         AND approval_id                    IS NULL
         AND idempotency_key                IS NULL
         AND action_class                   IS NULL
         AND resource_ref                   IS NULL
         AND verdict                        IS NULL
         AND vendor_amount                  IS NULL
         AND total_exposure                 IS NULL
         AND forward_integral               IS NULL
         AND is_rate_class                  IS NULL
         AND dispatch_payload_hash          IS NULL
         AND constructor_semantic_major     IS NULL
         AND constructor_non_semantic_minor IS NULL
         AND policy_version                 IS NULL
         AND attested_max_journal_seq       IS NULL
         AND attested_row_count             IS NULL
         AND attested_head_hash             IS NULL
         AND corroboration_signal_id        IS NULL
         AND corroboration_interval_start   IS NULL
         AND corroboration_observed_at      IS NULL
         AND corroboration_expires_at       IS NULL
         AND corroboration_reason           IS NULL
         AND override_id                    IS NULL
         AND override_event                 IS NULL
         AND override_actor                 IS NULL
         AND outbox_id                      IS NULL
         AND outbox_correlation_tag         IS NULL
         AND outbox_claim_id                IS NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND outbox_requires_unmirrored_tag IS NULL
         AND dispatch_adapter               IS NULL
         AND dispatch_outcome_kind          IS NULL
         AND dispatch_effect_status         IS NULL

      WHEN 'MIRROR_CORROBORATION_CONSUMED' THEN
             corroboration_signal_id        IS NOT NULL
         AND corroboration_interval_start   IS NOT NULL
         AND corroboration_observed_at      IS NOT NULL
         AND corroboration_expires_at       IS NOT NULL
         AND corroboration_reason           IS NOT NULL
         AND effect_id                      IS NULL
         AND authorisation_id               IS NULL
         AND decision_id                    IS NULL
         AND reservation_id                 IS NULL
         AND approval_id                    IS NULL
         AND idempotency_key                IS NULL
         AND action_class                   IS NULL
         AND resource_ref                   IS NULL
         AND verdict                        IS NULL
         AND vendor_amount                  IS NULL
         AND total_exposure                 IS NULL
         AND forward_integral               IS NULL
         AND is_rate_class                  IS NULL
         AND dispatch_payload_hash          IS NULL
         AND constructor_semantic_major     IS NULL
         AND constructor_non_semantic_minor IS NULL
         AND policy_version                 IS NULL
         AND attested_max_journal_seq       IS NULL
         AND attested_row_count             IS NULL
         AND attested_head_hash             IS NULL
         AND mirror_declaration_id          IS NULL
         AND mirror_declaration_event       IS NULL
         AND mirror_observed_reason         IS NULL
         AND override_id                    IS NULL
         AND override_event                 IS NULL
         AND override_actor                 IS NULL
         AND outbox_id                      IS NULL
         AND outbox_correlation_tag         IS NULL
         AND outbox_claim_id                IS NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND outbox_requires_unmirrored_tag IS NULL
         AND dispatch_adapter               IS NULL
         AND dispatch_outcome_kind          IS NULL
         AND dispatch_effect_status         IS NULL

      WHEN 'DEGRADED_MODE_OVERRIDE_EVENT' THEN
             override_id                    IS NOT NULL
         AND override_event                 IS NOT NULL
         AND override_actor                 IS NOT NULL
         AND effect_id                      IS NULL
         AND authorisation_id               IS NULL
         AND decision_id                    IS NULL
         AND reservation_id                 IS NULL
         AND approval_id                    IS NULL
         AND idempotency_key                IS NULL
         AND action_class                   IS NULL
         AND resource_ref                   IS NULL
         AND verdict                        IS NULL
         AND vendor_amount                  IS NULL
         AND total_exposure                 IS NULL
         AND forward_integral               IS NULL
         AND is_rate_class                  IS NULL
         AND dispatch_payload_hash          IS NULL
         AND constructor_semantic_major     IS NULL
         AND constructor_non_semantic_minor IS NULL
         AND policy_version                 IS NULL
         AND attested_max_journal_seq       IS NULL
         AND attested_row_count             IS NULL
         AND attested_head_hash             IS NULL
         AND mirror_declaration_id          IS NULL
         AND mirror_declaration_event       IS NULL
         AND mirror_observed_reason         IS NULL
         AND corroboration_signal_id        IS NULL
         AND corroboration_interval_start   IS NULL
         AND corroboration_observed_at      IS NULL
         AND corroboration_expires_at       IS NULL
         AND corroboration_reason           IS NULL
         AND outbox_id                      IS NULL
         AND outbox_correlation_tag         IS NULL
         AND outbox_claim_id                IS NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND outbox_requires_unmirrored_tag IS NULL
         AND dispatch_adapter               IS NULL
         AND dispatch_outcome_kind          IS NULL
         AND dispatch_effect_status         IS NULL

      WHEN 'OUTBOX_CLAIMED' THEN
             outbox_id                      IS NOT NULL
         AND outbox_correlation_tag         IS NOT NULL
         AND outbox_claim_id                IS NOT NULL
         AND outbox_matched_row             IS NOT NULL
         AND outbox_mirror_state            IS NOT NULL
         AND outbox_requires_unmirrored_tag IS NOT NULL
         AND effect_id                      IS NOT NULL
         AND authorisation_id               IS NOT NULL
         AND idempotency_key                IS NOT NULL
         AND action_class                   IS NOT NULL
         AND resource_ref                   IS NOT NULL
         AND dispatch_payload_hash          IS NOT NULL
         AND decision_id                    IS NULL
         AND reservation_id                 IS NULL
         AND approval_id                    IS NULL
         AND verdict                        IS NULL
         AND vendor_amount                  IS NULL
         AND total_exposure                 IS NULL
         AND forward_integral               IS NULL
         AND is_rate_class                  IS NULL
         AND constructor_semantic_major     IS NULL
         AND constructor_non_semantic_minor IS NULL
         AND policy_version                 IS NULL
         AND attested_max_journal_seq       IS NULL
         AND attested_row_count             IS NULL
         AND attested_head_hash             IS NULL
         AND mirror_declaration_id          IS NULL
         AND mirror_declaration_event       IS NULL
         AND mirror_observed_reason         IS NULL
         AND corroboration_signal_id        IS NULL
         AND corroboration_interval_start   IS NULL
         AND corroboration_observed_at      IS NULL
         AND corroboration_expires_at       IS NULL
         AND corroboration_reason           IS NULL
         AND override_event                 IS NULL
         AND override_actor                 IS NULL
         -- REQUIRED-ABSENT, S1J. A claim is not an outcome, and `30 §5.10`'s reading
         -- depends on the two being distinguishable rows rather than one row with
         -- optional halves.
         AND dispatch_adapter               IS NULL
         AND dispatch_outcome_kind          IS NULL
         AND dispatch_effect_status         IS NULL

      /*
       * The outcome row, S1J.
       *
       * PRESENT. The claim identity (`outbox_id`, `outbox_claim_id`), the correlation tag
       * — because `§11` of the mandate makes it the value a future delivery event matches
       * on and an audit reader must hold it in its own copy — the effect identity, the
       * adapter, the typed outcome kind, the resulting local status, and `§5.7.2` item 5's
       * degraded-state requirement.
       *
       * `outbox_requires_unmirrored_tag` IS NOT NULL, which is `§38`: "persist enough
       * journal/outcome evidence that the audit plane can later determine [...] the
       * gateway sent the tag requirement to the adapter". A row that could omit it would
       * make that determination impossible from the audit plane's own holdings.
       *
       * REQUIRED-ABSENT. `outbox_matched_row`, `outbox_mirror_state` and
       * `outbox_claim_clock_ref` are facts about the CLAIM and are already in the chained
       * `OUTBOX_CLAIMED` row this one joins to on `outbox_id`. `30 §5.3a`'s own rule:
       * "duplicating an authority-bearing value into a second chained row creates a second
       * place it can disagree with itself." The whole authorisation block is absent for the
       * same reason, one row further back.
       */
      WHEN 'DISPATCH_OUTCOME' THEN
             outbox_id                      IS NOT NULL
         AND outbox_claim_id                IS NOT NULL
         AND outbox_correlation_tag         IS NOT NULL
         AND effect_id                      IS NOT NULL
         AND authorisation_id               IS NOT NULL
         AND idempotency_key                IS NOT NULL
         AND action_class                   IS NOT NULL
         AND resource_ref                   IS NOT NULL
         AND dispatch_payload_hash          IS NOT NULL
         AND dispatch_adapter               IS NOT NULL
         AND dispatch_outcome_kind          IS NOT NULL
         AND dispatch_effect_status         IS NOT NULL
         AND outbox_requires_unmirrored_tag IS NOT NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND decision_id                    IS NULL
         AND reservation_id                 IS NULL
         AND approval_id                    IS NULL
         AND verdict                        IS NULL
         AND vendor_amount                  IS NULL
         AND total_exposure                 IS NULL
         AND forward_integral               IS NULL
         AND is_rate_class                  IS NULL
         AND constructor_semantic_major     IS NULL
         AND constructor_non_semantic_minor IS NULL
         AND policy_version                 IS NULL
         AND attested_max_journal_seq       IS NULL
         AND attested_row_count             IS NULL
         AND attested_head_hash             IS NULL
         AND mirror_declaration_id          IS NULL
         AND mirror_declaration_event       IS NULL
         AND mirror_observed_reason         IS NULL
         AND corroboration_signal_id        IS NULL
         AND corroboration_interval_start   IS NULL
         AND corroboration_observed_at      IS NULL
         AND corroboration_expires_at       IS NULL
         AND corroboration_reason           IS NULL
         AND override_event                 IS NULL
         AND override_actor                 IS NULL

      ELSE FALSE
    END
  );

-- The outcome row's own declared domains, mirroring the outcome table's. The journal and
-- the table cannot disagree about which kinds and which statuses exist.
ALTER TABLE effect_journal
  ADD CONSTRAINT journal_dispatch_outcome_kind_declared
    CHECK (dispatch_outcome_kind IS NULL
           OR dispatch_outcome_kind IN ('ADAPTER_RETURNED', 'OUTCOME_UNKNOWN')),
  ADD CONSTRAINT journal_dispatch_effect_status_declared
    CHECK (dispatch_effect_status IS NULL
           OR dispatch_effect_status IN ('DISPATCHED_AWAITING_VERIFICATION',
                                         'DISPATCHED_OUTCOME_UNKNOWN'));


/*
 * THE CANONICAL BYTES, RE-DECLARED WITH BRANCH 7 IN PLACE.
 *
 * BRANCHES 1 THROUGH 6 ARE `0007`'s, `0008`'s, `0009`'s, `0010`'s AND `0011`'s TO THE
 * BYTE, so every row already chained recomputes to the `row_hash` it holds. Only the new
 * branch is new, and no accepted row kind changes hash.
 *
 * BRANCH 7 IS THE CONTROL PLANE'S INDEPENDENT TRANSCRIPTION of the twenty-field order in
 * `docs/implementation/S1J-contract.md §5`. `A0007` is the AUDIT plane's, written from the
 * same table and never from this file, and `tests/support/jcs1Oracle.ts` is the
 * hand-authored third reading. `dispatch-outcome-journal-rows.test.ts` judges both planes
 * against the oracle and never against each other (`36 §0`).
 *
 * NO INSERTION ORDER. `30 §5.3`: the order "may not depend on an object's or a map's
 * insertion order in any implementation". This is a positional concatenation written out
 * field by field, with no map, no row-to-JSON step and no reflection over physical
 * columns — which matters here because this migration adds three columns at the END of the
 * table while placing their fields in the MIDDLE of the order.
 */
CREATE OR REPLACE FUNCTION effect_journal_canonical_bytes(row_in effect_journal)
RETURNS BYTEA
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE row_in.journal_row_kind

    WHEN 'EFFECT_AUTHORISATION' THEN
         acos_jcs1_field(acos_jcs1_text('acos.journal.effect_authorisation.v1'))
      || acos_jcs1_field(acos_jcs1_text (row_in.company_id))
      || acos_jcs1_field(acos_jcs1_int  (row_in.journal_seq))
      || acos_jcs1_field(acos_jcs1_text (row_in.journal_row_kind))
      || acos_jcs1_field(acos_jcs1_text (row_in.effect_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.authorisation_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.decision_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.reservation_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.approval_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.idempotency_key))
      || acos_jcs1_field(acos_jcs1_text (row_in.action_class))
      || acos_jcs1_field(acos_jcs1_text (row_in.resource_ref))
      || acos_jcs1_field(acos_jcs1_text (row_in.verdict))
      || acos_jcs1_field(acos_jcs1_money(row_in.vendor_amount))
      || acos_jcs1_field(acos_jcs1_money(row_in.total_exposure))
      || acos_jcs1_field(acos_jcs1_money(row_in.forward_integral))
      || acos_jcs1_field(acos_jcs1_bool (row_in.is_rate_class))
      || acos_jcs1_field(acos_jcs1_text (row_in.dispatch_payload_hash))
      || acos_jcs1_field(acos_jcs1_int  (row_in.constructor_semantic_major))
      || acos_jcs1_field(acos_jcs1_int  (row_in.constructor_non_semantic_minor))
      || acos_jcs1_field(acos_jcs1_text (row_in.policy_version))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.occurred_at))
      || acos_jcs1_field(acos_jcs1_bytes(row_in.prev_hash))

    WHEN 'JOURNAL_ATTESTATION' THEN
         acos_jcs1_field(acos_jcs1_text('acos.journal.attestation.v1'))
      || acos_jcs1_field(acos_jcs1_text (row_in.company_id))
      || acos_jcs1_field(acos_jcs1_int  (row_in.journal_seq))
      || acos_jcs1_field(acos_jcs1_text (row_in.journal_row_kind))
      || acos_jcs1_field(acos_jcs1_int  (row_in.attested_max_journal_seq))
      || acos_jcs1_field(acos_jcs1_int  (row_in.attested_row_count))
      || acos_jcs1_field(acos_jcs1_bytes(row_in.attested_head_hash))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.occurred_at))
      || acos_jcs1_field(acos_jcs1_bytes(row_in.prev_hash))

    WHEN 'AUDIT_MIRROR_DEGRADED' THEN
         acos_jcs1_field(acos_jcs1_text('acos.journal.audit_mirror_degraded.v1'))
      || acos_jcs1_field(acos_jcs1_text (row_in.company_id))
      || acos_jcs1_field(acos_jcs1_int  (row_in.journal_seq))
      || acos_jcs1_field(acos_jcs1_text (row_in.journal_row_kind))
      || acos_jcs1_field(acos_jcs1_text (row_in.mirror_declaration_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.mirror_declaration_event))
      || acos_jcs1_field(acos_jcs1_text (row_in.mirror_observed_reason))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.occurred_at))
      || acos_jcs1_field(acos_jcs1_bytes(row_in.prev_hash))

    WHEN 'MIRROR_CORROBORATION_CONSUMED' THEN
         acos_jcs1_field(acos_jcs1_text('acos.journal.mirror_corroboration_consumed.v1'))
      || acos_jcs1_field(acos_jcs1_text (row_in.company_id))
      || acos_jcs1_field(acos_jcs1_int  (row_in.journal_seq))
      || acos_jcs1_field(acos_jcs1_text (row_in.journal_row_kind))
      || acos_jcs1_field(acos_jcs1_text (row_in.corroboration_signal_id))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.corroboration_interval_start))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.corroboration_observed_at))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.corroboration_expires_at))
      || acos_jcs1_field(acos_jcs1_text (row_in.corroboration_reason))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.occurred_at))
      || acos_jcs1_field(acos_jcs1_bytes(row_in.prev_hash))

    WHEN 'DEGRADED_MODE_OVERRIDE_EVENT' THEN
         acos_jcs1_field(acos_jcs1_text('acos.journal.degraded_mode_override_event.v1'))
      || acos_jcs1_field(acos_jcs1_text (row_in.company_id))
      || acos_jcs1_field(acos_jcs1_int  (row_in.journal_seq))
      || acos_jcs1_field(acos_jcs1_text (row_in.journal_row_kind))
      || acos_jcs1_field(acos_jcs1_text (row_in.override_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.override_event))
      || acos_jcs1_field(acos_jcs1_text (row_in.override_actor))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.occurred_at))
      || acos_jcs1_field(acos_jcs1_bytes(row_in.prev_hash))

    WHEN 'OUTBOX_CLAIMED' THEN
         acos_jcs1_field(acos_jcs1_text('acos.journal.outbox_claimed.v1'))
      || acos_jcs1_field(acos_jcs1_text (row_in.company_id))
      || acos_jcs1_field(acos_jcs1_int  (row_in.journal_seq))
      || acos_jcs1_field(acos_jcs1_text (row_in.journal_row_kind))
      || acos_jcs1_field(acos_jcs1_text (row_in.outbox_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.outbox_claim_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.outbox_correlation_tag))
      || acos_jcs1_field(acos_jcs1_text (row_in.effect_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.authorisation_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.idempotency_key))
      || acos_jcs1_field(acos_jcs1_text (row_in.action_class))
      || acos_jcs1_field(acos_jcs1_text (row_in.resource_ref))
      || acos_jcs1_field(acos_jcs1_text (row_in.dispatch_payload_hash))
      || acos_jcs1_field(acos_jcs1_int  (row_in.outbox_matched_row))
      || acos_jcs1_field(acos_jcs1_text (row_in.outbox_mirror_state))
      || acos_jcs1_field(acos_jcs1_bool (row_in.outbox_requires_unmirrored_tag))
      || acos_jcs1_field(acos_jcs1_text (row_in.override_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.outbox_claim_clock_ref))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.occurred_at))
      || acos_jcs1_field(acos_jcs1_bytes(row_in.prev_hash))

    -- BRANCH 7 — `acos.journal.dispatch_outcome.v1`, S1J. Twenty fields, from
    -- `docs/implementation/S1J-contract.md §5`. Fields 18 and 19 are BOTH NULLABLE and
    -- adjacent, so the two reserved `FF FF FF FF` words with no payload between them are
    -- the case v1.2's withdrawn sentinel encoding would have collapsed (v1.3.2, JCS-01).
    WHEN 'DISPATCH_OUTCOME' THEN
         acos_jcs1_field(acos_jcs1_text('acos.journal.dispatch_outcome.v1'))
      || acos_jcs1_field(acos_jcs1_text (row_in.company_id))
      || acos_jcs1_field(acos_jcs1_int  (row_in.journal_seq))
      || acos_jcs1_field(acos_jcs1_text (row_in.journal_row_kind))
      || acos_jcs1_field(acos_jcs1_text (row_in.outbox_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.outbox_claim_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.outbox_correlation_tag))
      || acos_jcs1_field(acos_jcs1_text (row_in.effect_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.authorisation_id))
      || acos_jcs1_field(acos_jcs1_text (row_in.idempotency_key))
      || acos_jcs1_field(acos_jcs1_text (row_in.action_class))
      || acos_jcs1_field(acos_jcs1_text (row_in.resource_ref))
      || acos_jcs1_field(acos_jcs1_text (row_in.dispatch_payload_hash))
      || acos_jcs1_field(acos_jcs1_text (row_in.dispatch_adapter))
      || acos_jcs1_field(acos_jcs1_text (row_in.dispatch_outcome_kind))
      || acos_jcs1_field(acos_jcs1_text (row_in.dispatch_effect_status))
      || acos_jcs1_field(acos_jcs1_bool (row_in.outbox_requires_unmirrored_tag))
      || acos_jcs1_field(acos_jcs1_text (row_in.override_id))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.occurred_at))
      || acos_jcs1_field(acos_jcs1_bytes(row_in.prev_hash))

  END;
$fn$;


/*
 * `emit_dispatch_outcome` — the ONLY writer of a `DISPATCH_OUTCOME` journal row.
 *
 * It allocates the sequence through `journal_allocate_seq`, which takes `journal_counter`
 * `FOR UPDATE` — step 5 of `30 §5.2`'s lock order and LAST, the reading
 * `src/kernel/exposure/lockOrder.ts` records. The outcome transaction's only earlier lock
 * is the `dispatch_outbox` row, so the order is `dispatch_outbox` → `journal_counter` and
 * there is no money-path lock in it, because this transaction moves no money.
 */
CREATE FUNCTION emit_dispatch_outcome(
  p_company_id            TEXT,
  p_outbox_id             TEXT,
  p_claim_id              TEXT,
  p_correlation_tag       TEXT,
  p_effect_id             TEXT,
  p_authorisation_id      TEXT,
  p_idempotency_key       TEXT,
  p_action_class          TEXT,
  p_resource_ref          TEXT,
  p_dispatch_payload_hash TEXT,
  p_adapter               TEXT,
  p_outcome_kind          TEXT,
  p_effect_status         TEXT,
  p_requires_tag          BOOLEAN,
  p_override_id           TEXT,
  p_occurred_at           TIMESTAMPTZ
) RETURNS BIGINT
LANGUAGE plpgsql AS $fn$
DECLARE
  v_seq BIGINT;
BEGIN
  v_seq := journal_allocate_seq(p_company_id);
  INSERT INTO effect_journal (
    company_id, journal_seq, journal_row_kind,
    outbox_id, outbox_claim_id, outbox_correlation_tag,
    effect_id, authorisation_id, idempotency_key, action_class, resource_ref,
    dispatch_payload_hash,
    dispatch_adapter, dispatch_outcome_kind, dispatch_effect_status,
    outbox_requires_unmirrored_tag, override_id, occurred_at
  ) VALUES (
    p_company_id, v_seq, 'DISPATCH_OUTCOME',
    p_outbox_id, p_claim_id, p_correlation_tag,
    p_effect_id, p_authorisation_id, p_idempotency_key, p_action_class, p_resource_ref,
    p_dispatch_payload_hash,
    p_adapter, p_outcome_kind, p_effect_status,
    p_requires_tag, p_override_id, p_occurred_at
  );
  RETURN v_seq;
END;
$fn$;
