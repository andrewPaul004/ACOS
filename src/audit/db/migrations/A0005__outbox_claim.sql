-- A0005 — the audit store learns the outbox claim row kind.
--
-- =================================================================================
-- WHY THE AUDIT PLANE NEEDS THIS KIND
--
-- `30 §5.1` item 2: "The audit store is a replicating verifier, not a write-ahead
-- dependency. It receives rows, re-chains them under its own trigger, and verifies that
-- the chain it received is internally consistent and gap-free by `journal_seq` — and,
-- v1.2, that it is complete against the attestations."
--
-- `I17` is a TWO-SIDED DIFF over `journal_seq`. A control-side row kind the audit store
-- cannot ingest is a permanent, unresolvable gap in that diff — the audit plane would read
-- the claim's sequence value as suppression. So the moment `0010` adds a kind to the
-- control chain, this store must be able to hold it, and that is not optional.
--
-- `30 §5.10` gives the second reason. `I8`'s additive verification list is built from
-- effects dispatched outside `NORMAL`, and `30 §5.7.2` item 6: "Every dispatch under [an
-- override] enters `I8`'s additive verification list." The claim row carries
-- `outbox_requires_unmirrored_tag` and `override_id`, so the audit plane holds the two
-- operands that list is built from — from ITS OWN copy, which is the whole point of the
-- plane.
-- =================================================================================
--
-- =================================================================================
-- INDEPENDENCE, RESTATED FOR THIS FILE
--
-- The control plane declares this order in `src/db/migrations/0010__dispatch_outbox.sql`.
-- THIS FILE DOES NOT READ THAT FILE, cannot call its functions, and is not linked to it.
-- The order below is transcribed from the same specification —
-- `docs/implementation/S1I-contract.md §5` — and
-- `tests/integration/outbox/outbox-journal-rows.test.ts` judges BOTH against a
-- hand-authored FOURTH reading in `tests/support/jcs1Oracle.ts`, never against each other.
--
-- A0001's own reasoning applies unchanged: "a chain the writer computes proves nothing".
--
-- EVERY NEW COLUMN IS A SCALAR. `ACOS-JCS-1`'s RFC-8785 leg is not engaged on this plane
-- either, so the S1G position stands: no production journal row carries a JSON column.
-- =================================================================================

SET LOCAL ROLE acos_audit_owner;


-- =================================================================================
-- PART 1 — THE KIND AND ITS COLUMNS
-- =================================================================================

ALTER TABLE audit_journal
  DROP CONSTRAINT audit_journal_kind_declared;

ALTER TABLE audit_journal
  ADD CONSTRAINT audit_journal_kind_declared
  CHECK (journal_row_kind IN (
    'EFFECT_AUTHORISATION',
    'JOURNAL_ATTESTATION',
    'AUDIT_MIRROR_DEGRADED',
    'MIRROR_CORROBORATION_CONSUMED',
    'DEGRADED_MODE_OVERRIDE_EVENT',
    -- `25 §7`, ADR-026 item 2, `I36`. A CLAIM, not a dispatch: the audit store learns
    -- that ACOS committed to at most one external attempt, and learns nothing about
    -- whether one happened. `30 §5.4`'s honesty about what the plane can prove applies
    -- here too.
    'OUTBOX_CLAIMED'
  ));

ALTER TABLE audit_journal
  ADD COLUMN outbox_id                      TEXT,
  ADD COLUMN outbox_correlation_tag         TEXT,
  ADD COLUMN outbox_claim_id                TEXT,
  ADD COLUMN outbox_matched_row             INTEGER,
  ADD COLUMN outbox_mirror_state            TEXT,
  ADD COLUMN outbox_requires_unmirrored_tag BOOLEAN;


-- =================================================================================
-- PART 2 — THE INDEPENDENT TRANSCRIPTION OF THE FIELD ORDERS
--
-- Branches 1 through 5 are A0001's and A0002's, byte for byte — same domain tags, same
-- orders, same `audit_jcs1_*` calls — so every row this store already holds recomputes to
-- the `audit_row_hash` it holds and the ACCEPTED `VC-A3` fixtures still discriminate.
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
      || audit_jcs1_field(audit_jcs1_ts   (row_in.occurred_at))
      || audit_jcs1_field(audit_jcs1_bytes(row_in.prev_hash))

  END;
$fn$;


-- =================================================================================
-- PART 3 — THE INGEST ENTRY POINT, EXTENDED
--
-- Six new parameters, each `DEFAULT NULL`, so the ACCEPTED 27- and 38-argument call sites
-- in `post-commit-and-crash-matrix.test.ts`, `vc-a3-cross-implementation.test.ts` and the
-- S1H suites still resolve to this function unchanged and their assertions still hold.
--
-- `DROP` then `CREATE` rather than `CREATE OR REPLACE`, because a changed signature would
-- otherwise create a second overload and make the shorter calls ambiguous. Same reasoning
-- A0002 recorded.
-- =================================================================================

DROP FUNCTION audit_ingest_journal_row(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT,
  BIGINT, BIGINT, BYTEA, TIMESTAMPTZ, BYTEA, BYTEA, BYTEA,
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT
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
  p_outbox_requires_unmirrored_tag BOOLEAN     DEFAULT NULL
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
      outbox_matched_row, outbox_mirror_state, outbox_requires_unmirrored_tag
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
      p_outbox_matched_row, p_outbox_mirror_state, p_outbox_requires_unmirrored_tag
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
    -- UNCHANGED. The three SQLSTATEs, the allowlist and the reasoning are A0004's; this
    -- file re-declares the function at a wider signature and must not drop a handler in
    -- the process. `store-write-availability.test.ts` is an accepted suite and it asserts
    -- this handler agrees with `src/audit/storeWriteAvailability.ts`.
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
  TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION audit_ingest_journal_row(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT,
  BIGINT, BIGINT, BYTEA, TIMESTAMPTZ, BYTEA, BYTEA, BYTEA,
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN
) TO acos_audit_replication;

RESET ROLE;
