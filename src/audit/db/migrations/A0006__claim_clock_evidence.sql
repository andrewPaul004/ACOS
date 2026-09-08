-- A0006 — the audit store learns the claim's evidentiary statutory clock.
--
-- =================================================================================
-- WHY THE AUDIT PLANE NEEDS THIS FIELD, AND WHY IT IS THE CLOCK RATHER THAN THE CASE
--
-- `30 §9.2.5`, v1.3.4 (CSB-01), states the purpose in the form of the question it exists
-- to make answerable:
--
--     "Where row 3 is the reason a dispatch decision resolved permissively, the selected
--      `clock_ref` is persisted as evidence on that decision, so that a later audit can
--      answer: *which live statutory obligation justified this?*"
--
-- **A LATER AUDIT.** That is this plane. Row 3 is the one relaxation in the architecture
-- — `30 §9.1`: "the statutory clock is a lever on the audit plane" — so the evidence for
-- a claim taken under it has to reach the plane the lever acts on, from the plane's own
-- copy. Control-plane state the control plane can rewrite would not answer the question.
--
-- **AND IT IS THE CLOCK, NOT THE CASE.** `30 §5.3a`: "`case_ref` is deliberately NOT a
-- field of this row [...] field 18 already records the *clock* the binding selected,
-- which is the fact an audit needs, and it is the narrower disclosure." `30 §9.2.6` makes
-- the same choice for the vendor payload. A support-case identifier is not made to travel
-- further than the property requires.
-- =================================================================================
--
-- =================================================================================
-- INDEPENDENCE, RESTATED FOR THIS FILE — AND NOW AGAINST A NORMATIVE ORDER
--
-- A0005 transcribed its order from `docs/implementation/S1I-contract.md §5`, because
-- v1.3.3 declared no order for any row kind. **v1.3.4 (JCS-02) changes that**:
-- `30 §5.3a` declares the twenty-field order for `acos.journal.outbox_claimed.v1` in the
-- specification, which is what `30 §5.3` had always required — "Fixed, declared per row
-- kind, in the specification".
--
-- **THE ORDER BELOW IS TRANSCRIBED FROM `30 §5.3a`.** This file does not read
-- `src/db/migrations/0011__effect_case_binding.sql`, cannot call its functions and is not
-- linked to it. `30 §5.3a` states the obligation this file is discharging:
--
--     "The control-plane and audit-plane implementations must each transcribe the
--      specification independently. Neither may read the other, and neither may read a
--      shared canonicalisation helper that would make agreement automatic — agreement two
--      implementations obtain from one source is not a cross-implementation check."
--
-- `tests/support/jcs1Oracle.ts` is the hand-authored THIRD reading and
-- `tests/integration/outbox/outbox-journal-rows.test.ts` judges BOTH planes against it,
-- never against each other. `36 §2.6`'s byte-identity fixture must fail on a seeded swap
-- of two fields, and `outbox-claim-field-order.test.ts` seeds exactly that.
--
-- **NO INSERTION ORDER ANYWHERE.** `30 §5.3a`: "The order may not depend on an object's
-- or a map's insertion order in any implementation." This function is a positional
-- concatenation written out field by field; there is no map, no row-to-JSON step and no
-- reflection over the table's physical columns — which `30 §5.3` separately forbids,
-- because "a migration reorders" them and `A0005` and this file both add columns at the
-- end of the table while adding a field in the MIDDLE of the order.
-- =================================================================================

SET LOCAL ROLE acos_audit_owner;


-- =================================================================================
-- PART 1 — THE COLUMN
--
-- NULLABLE, and constrained to the row that can carry it. `30 §5.3a` field 18:
-- "text, NULLABLE. §9.2.5's deterministically selected evidentiary clock. Non-NULL only
-- where the matched row is 3; NULL otherwise."
--
-- The CHECK is the audit plane's OWN reading of that rule, not a copy of the control
-- plane's. If a control plane ever pushed a claim row citing a clock at a matched row
-- other than 3, this store would refuse it rather than record it — which is the
-- behaviour `30 §5.1` item 2 asks of a replicating verifier.
-- =================================================================================

ALTER TABLE audit_journal
  ADD COLUMN outbox_claim_clock_ref TEXT;

ALTER TABLE audit_journal
  ADD CONSTRAINT audit_journal_outbox_clock_ref_is_row_3
    CHECK (outbox_claim_clock_ref IS NULL OR outbox_matched_row = 3);


-- =================================================================================
-- PART 2 — THE CANONICAL BYTES, WITH FIELD 18 IN PLACE
--
-- Branches 1 through 5 are A0001's, A0002's and A0003's to the byte, so every row
-- already chained in this store recomputes to the `row_hash` it holds.
--
-- Branch 6 gains field 18 between `override_id` (17) and `occurred_at` (now 19), which
-- moves the `row_hash` of every `OUTBOX_CLAIMED` row. Admissible for the reason
-- `30 §5.3` gives for the v1.3.2 framing correction and which is still true: there is no
-- deployed chain. A deployed one would need the declared chain-versioning and re-anchor.
-- =================================================================================

CREATE OR REPLACE FUNCTION audit_journal_canonical_bytes(row_in audit_journal)
RETURNS BYTEA
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT CASE row_in.journal_row_kind

    WHEN 'EFFECT_AUTHORISATION' THEN
         audit_jcs1_field(audit_jcs1_text('acos.journal.effect_authorisation.v1'))
      || audit_jcs1_field(audit_jcs1_text (row_in.company_id))
      || audit_jcs1_field(audit_jcs1_int  (row_in.journal_seq))
      || audit_jcs1_field(audit_jcs1_text (row_in.journal_row_kind))
      || audit_jcs1_field(audit_jcs1_text (row_in.effect_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.authorisation_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.decision_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.reservation_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.approval_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.idempotency_key))
      || audit_jcs1_field(audit_jcs1_text (row_in.action_class))
      || audit_jcs1_field(audit_jcs1_text (row_in.resource_ref))
      || audit_jcs1_field(audit_jcs1_text (row_in.verdict))
      || audit_jcs1_field(audit_jcs1_money(row_in.vendor_amount))
      || audit_jcs1_field(audit_jcs1_money(row_in.total_exposure))
      || audit_jcs1_field(audit_jcs1_money(row_in.forward_integral))
      || audit_jcs1_field(audit_jcs1_bool (row_in.is_rate_class))
      || audit_jcs1_field(audit_jcs1_text (row_in.dispatch_payload_hash))
      || audit_jcs1_field(audit_jcs1_int  (row_in.constructor_semantic_major))
      || audit_jcs1_field(audit_jcs1_int  (row_in.constructor_non_semantic_minor))
      || audit_jcs1_field(audit_jcs1_text (row_in.policy_version))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.occurred_at))
      || audit_jcs1_field(audit_jcs1_bytes(row_in.prev_hash))

    WHEN 'JOURNAL_ATTESTATION' THEN
         audit_jcs1_field(audit_jcs1_text('acos.journal.attestation.v1'))
      || audit_jcs1_field(audit_jcs1_text (row_in.company_id))
      || audit_jcs1_field(audit_jcs1_int  (row_in.journal_seq))
      || audit_jcs1_field(audit_jcs1_text (row_in.journal_row_kind))
      || audit_jcs1_field(audit_jcs1_int  (row_in.attested_max_journal_seq))
      || audit_jcs1_field(audit_jcs1_int  (row_in.attested_row_count))
      || audit_jcs1_field(audit_jcs1_bytes(row_in.attested_head_hash))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.occurred_at))
      || audit_jcs1_field(audit_jcs1_bytes(row_in.prev_hash))

    WHEN 'AUDIT_MIRROR_DEGRADED' THEN
         audit_jcs1_field(audit_jcs1_text('acos.journal.audit_mirror_degraded.v1'))
      || audit_jcs1_field(audit_jcs1_text (row_in.company_id))
      || audit_jcs1_field(audit_jcs1_int  (row_in.journal_seq))
      || audit_jcs1_field(audit_jcs1_text (row_in.journal_row_kind))
      || audit_jcs1_field(audit_jcs1_text (row_in.mirror_declaration_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.mirror_declaration_event))
      || audit_jcs1_field(audit_jcs1_text (row_in.mirror_observed_reason))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.occurred_at))
      || audit_jcs1_field(audit_jcs1_bytes(row_in.prev_hash))

    WHEN 'MIRROR_CORROBORATION_CONSUMED' THEN
         audit_jcs1_field(audit_jcs1_text('acos.journal.mirror_corroboration_consumed.v1'))
      || audit_jcs1_field(audit_jcs1_text (row_in.company_id))
      || audit_jcs1_field(audit_jcs1_int  (row_in.journal_seq))
      || audit_jcs1_field(audit_jcs1_text (row_in.journal_row_kind))
      || audit_jcs1_field(audit_jcs1_text (row_in.corroboration_signal_id))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.corroboration_interval_start))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.corroboration_observed_at))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.corroboration_expires_at))
      || audit_jcs1_field(audit_jcs1_text (row_in.corroboration_reason))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.occurred_at))
      || audit_jcs1_field(audit_jcs1_bytes(row_in.prev_hash))

    WHEN 'DEGRADED_MODE_OVERRIDE_EVENT' THEN
         audit_jcs1_field(audit_jcs1_text('acos.journal.degraded_mode_override_event.v1'))
      || audit_jcs1_field(audit_jcs1_text (row_in.company_id))
      || audit_jcs1_field(audit_jcs1_int  (row_in.journal_seq))
      || audit_jcs1_field(audit_jcs1_text (row_in.journal_row_kind))
      || audit_jcs1_field(audit_jcs1_text (row_in.override_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.override_event))
      || audit_jcs1_field(audit_jcs1_text (row_in.override_actor))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.occurred_at))
      || audit_jcs1_field(audit_jcs1_bytes(row_in.prev_hash))

    WHEN 'OUTBOX_CLAIMED' THEN
         audit_jcs1_field(audit_jcs1_text('acos.journal.outbox_claimed.v1'))
      || audit_jcs1_field(audit_jcs1_text (row_in.company_id))
      || audit_jcs1_field(audit_jcs1_int  (row_in.journal_seq))
      || audit_jcs1_field(audit_jcs1_text (row_in.journal_row_kind))
      || audit_jcs1_field(audit_jcs1_text (row_in.outbox_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.outbox_claim_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.outbox_correlation_tag))
      || audit_jcs1_field(audit_jcs1_text (row_in.effect_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.authorisation_id))
      || audit_jcs1_field(audit_jcs1_text (row_in.idempotency_key))
      || audit_jcs1_field(audit_jcs1_text (row_in.action_class))
      || audit_jcs1_field(audit_jcs1_text (row_in.resource_ref))
      || audit_jcs1_field(audit_jcs1_text (row_in.dispatch_payload_hash))
      || audit_jcs1_field(audit_jcs1_int  (row_in.outbox_matched_row))
      || audit_jcs1_field(audit_jcs1_text (row_in.outbox_mirror_state))
      || audit_jcs1_field(audit_jcs1_bool (row_in.outbox_requires_unmirrored_tag))
      || audit_jcs1_field(audit_jcs1_text (row_in.override_id))
      -- FIELD 18, new at v1.3.4 (JCS-02). `30 §5.3a`: the deterministically selected
      -- evidentiary clock, non-NULL only where the matched row is 3. NULL frames as
      -- the reserved `FF FF FF FF` word and carries no payload (v1.3.2, JCS-01).
      || audit_jcs1_field(audit_jcs1_text (row_in.outbox_claim_clock_ref))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.occurred_at))
      || audit_jcs1_field(audit_jcs1_bytes(row_in.prev_hash))

  END;
$fn$;


-- =================================================================================
-- PART 3 — THE INGEST ENTRY POINT, EXTENDED BY ONE PARAMETER
--
-- `DEFAULT NULL`, so every ACCEPTED shorter call site still resolves to this function
-- unchanged. `DROP` then `CREATE` rather than `CREATE OR REPLACE`, because a changed
-- signature would otherwise create a second overload and make the shorter calls
-- ambiguous — the reasoning A0002 recorded and A0005 repeated.
-- =================================================================================

DROP FUNCTION audit_ingest_journal_row(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT,
  BIGINT, BIGINT, BYTEA, TIMESTAMPTZ, BYTEA, BYTEA, BYTEA,
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN
);

CREATE FUNCTION audit_ingest_journal_row(
  p_company_id                     TEXT,
  p_journal_seq                    BIGINT,
  p_journal_row_kind               TEXT,
  p_effect_id                      TEXT,
  p_authorisation_id               TEXT,
  p_decision_id                    TEXT,
  p_reservation_id                 TEXT,
  p_approval_id                    TEXT,
  p_idempotency_key                TEXT,
  p_action_class                   TEXT,
  p_resource_ref                   TEXT,
  p_verdict                        TEXT,
  p_vendor_amount                  NUMERIC,
  p_total_exposure                 NUMERIC,
  p_forward_integral               NUMERIC,
  p_is_rate_class                  BOOLEAN,
  p_dispatch_payload_hash          TEXT,
  p_constructor_semantic_major     INTEGER,
  p_constructor_non_semantic_minor INTEGER,
  p_policy_version                 TEXT,
  p_attested_max_journal_seq       BIGINT,
  p_attested_row_count             BIGINT,
  p_attested_head_hash             BYTEA,
  p_occurred_at                    TIMESTAMPTZ,
  p_prev_hash                      BYTEA,
  p_claimed_row_hash               BYTEA,
  p_transmitted_bytes              BYTEA,
  p_mirror_declaration_id          TEXT        DEFAULT NULL,
  p_mirror_declaration_event       TEXT        DEFAULT NULL,
  p_mirror_observed_reason         TEXT        DEFAULT NULL,
  p_corroboration_signal_id        TEXT        DEFAULT NULL,
  p_corroboration_interval_start   TIMESTAMPTZ DEFAULT NULL,
  p_corroboration_observed_at      TIMESTAMPTZ DEFAULT NULL,
  p_corroboration_expires_at       TIMESTAMPTZ DEFAULT NULL,
  p_corroboration_reason           TEXT        DEFAULT NULL,
  p_override_id                    TEXT        DEFAULT NULL,
  p_override_event                 TEXT        DEFAULT NULL,
  p_override_actor                 TEXT        DEFAULT NULL,
  p_outbox_id                      TEXT        DEFAULT NULL,
  p_outbox_correlation_tag         TEXT        DEFAULT NULL,
  p_outbox_claim_id                TEXT        DEFAULT NULL,
  p_outbox_matched_row             INTEGER     DEFAULT NULL,
  p_outbox_mirror_state            TEXT        DEFAULT NULL,
  p_outbox_requires_unmirrored_tag BOOLEAN     DEFAULT NULL,
  p_outbox_claim_clock_ref         TEXT        DEFAULT NULL
) RETURNS audit_ingest_outcome
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_existing BYTEA;
BEGIN
  SELECT claimed_row_hash INTO v_existing
    FROM audit_journal
   WHERE company_id = p_company_id AND journal_seq = p_journal_seq;

  IF FOUND THEN
    IF v_existing = p_claimed_row_hash THEN
      INSERT INTO audit_incident (company_id, kind, severity, journal_seq, detail)
      VALUES (p_company_id, 'AUDIT_PUSH_DUPLICATE', 'INFO', p_journal_seq,
              jsonb_build_object('reason', 'expected retry (30 §5.2)'));
      RETURN 'AUDIT_PUSH_DUPLICATE';
    END IF;
    INSERT INTO audit_incident (company_id, kind, severity, journal_seq, detail)
    VALUES (p_company_id, 'AUDIT_SEQUENCE_COLLISION', 'CRITICAL', p_journal_seq,
            jsonb_build_object(
              'reason', 'two different rows claiming one sequence (30 §5.2)',
              'held_row_hash', encode(v_existing, 'hex'),
              'offered_row_hash', encode(p_claimed_row_hash, 'hex')));
    RETURN 'AUDIT_SEQUENCE_COLLISION';
  END IF;

  BEGIN
    INSERT INTO audit_journal (
      company_id, journal_seq, journal_row_kind,
      effect_id, authorisation_id, decision_id, reservation_id, approval_id,
      idempotency_key, action_class, resource_ref, verdict,
      vendor_amount, total_exposure, forward_integral, is_rate_class,
      dispatch_payload_hash, constructor_semantic_major, constructor_non_semantic_minor,
      policy_version, attested_max_journal_seq, attested_row_count, attested_head_hash,
      occurred_at, prev_hash, claimed_row_hash, transmitted_bytes,
      mirror_declaration_id, mirror_declaration_event, mirror_observed_reason,
      corroboration_signal_id, corroboration_interval_start, corroboration_observed_at,
      corroboration_expires_at, corroboration_reason,
      override_id, override_event, override_actor,
      outbox_id, outbox_correlation_tag, outbox_claim_id,
      outbox_matched_row, outbox_mirror_state, outbox_requires_unmirrored_tag,
      outbox_claim_clock_ref
    ) VALUES (
      p_company_id, p_journal_seq, p_journal_row_kind,
      p_effect_id, p_authorisation_id, p_decision_id, p_reservation_id, p_approval_id,
      p_idempotency_key, p_action_class, p_resource_ref, p_verdict,
      p_vendor_amount, p_total_exposure, p_forward_integral, p_is_rate_class,
      p_dispatch_payload_hash, p_constructor_semantic_major, p_constructor_non_semantic_minor,
      p_policy_version, p_attested_max_journal_seq, p_attested_row_count, p_attested_head_hash,
      p_occurred_at, p_prev_hash, p_claimed_row_hash, p_transmitted_bytes,
      p_mirror_declaration_id, p_mirror_declaration_event, p_mirror_observed_reason,
      p_corroboration_signal_id, p_corroboration_interval_start, p_corroboration_observed_at,
      p_corroboration_expires_at, p_corroboration_reason,
      p_override_id, p_override_event, p_override_actor,
      p_outbox_id, p_outbox_correlation_tag, p_outbox_claim_id,
      p_outbox_matched_row, p_outbox_mirror_state, p_outbox_requires_unmirrored_tag,
      p_outbox_claim_clock_ref
    );
  EXCEPTION
    WHEN unique_violation THEN
      SELECT claimed_row_hash INTO v_existing
        FROM audit_journal
       WHERE company_id = p_company_id AND journal_seq = p_journal_seq;
      IF v_existing = p_claimed_row_hash THEN
        INSERT INTO audit_incident (company_id, kind, severity, journal_seq, detail)
        VALUES (p_company_id, 'AUDIT_PUSH_DUPLICATE', 'INFO', p_journal_seq,
                jsonb_build_object('reason', 'concurrent expected retry (30 §5.2)'));
        RETURN 'AUDIT_PUSH_DUPLICATE';
      END IF;
      INSERT INTO audit_incident (company_id, kind, severity, journal_seq, detail)
      VALUES (p_company_id, 'AUDIT_SEQUENCE_COLLISION', 'CRITICAL', p_journal_seq,
              jsonb_build_object('reason', 'concurrent conflicting push (30 §5.2)'));
      RETURN 'AUDIT_SEQUENCE_COLLISION';

    WHEN sqlstate 'ACS41' THEN
      INSERT INTO audit_incident (company_id, kind, severity, journal_seq, detail)
      VALUES (p_company_id,
              CASE WHEN SQLERRM LIKE 'AUDIT_CHAIN_BREAK%' THEN 'AUDIT_CHAIN_BREAK'
                   ELSE 'AUDIT_CANONICAL_MISMATCH' END,
              'CRITICAL', p_journal_seq,
              jsonb_build_object('reason', SQLERRM));
      RETURN CASE WHEN SQLERRM LIKE 'AUDIT_CHAIN_BREAK%'
                  THEN 'AUDIT_CHAIN_BREAK'::audit_ingest_outcome
                  ELSE 'AUDIT_CANONICAL_MISMATCH'::audit_ingest_outcome END;

    WHEN sqlstate 'ACS18' THEN
      INSERT INTO audit_incident (company_id, kind, severity, journal_seq, detail)
      VALUES (p_company_id, 'AUDIT_QUOTA_SATURATED', 'CRITICAL', p_journal_seq,
              jsonb_build_object('reason', SQLERRM));
      RETURN 'AUDIT_QUOTA_SATURATED';

    -- `30 5.7.1a`'s closed store-write availability mapping, carried FORWARD FROM A0004
    -- AND A0005 UNCHANGED. Re-declaring the function at a wider signature must not drop a
    -- handler, and `store-write-availability.test.ts` asserts this handler still agrees
    -- with `src/audit/storeWriteAvailability.ts`.
    WHEN sqlstate '53100' OR sqlstate '58030' OR sqlstate '25006' THEN
      PERFORM audit_record_store_write_failure(
        p_company_id, p_journal_seq, 'AUDIT_STORE_WRITE_UNAVAILABLE', SQLSTATE);
      RETURN 'AUDIT_STORE_WRITE_UNAVAILABLE';
  END;

  RETURN 'ACCEPTED';
END;
$fn$;

REVOKE ALL ON FUNCTION audit_ingest_journal_row(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT,
  BIGINT, BIGINT, BYTEA, TIMESTAMPTZ, BYTEA, BYTEA, BYTEA,
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION audit_ingest_journal_row(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT,
  BIGINT, BIGINT, BYTEA, TIMESTAMPTZ, BYTEA, BYTEA, BYTEA,
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT
) TO acos_audit_replication;

RESET ROLE;
