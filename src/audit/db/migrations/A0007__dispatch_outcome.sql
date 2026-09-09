-- A0007 — the audit store learns the local dispatch outcome.
--
-- =================================================================================
-- WHY THIS ROW KIND HAS TO REACH THIS PLANE
--
-- `I17` is a two-sided diff over `journal_seq`, and `30 §5.2` gives a gap in that diff
-- "exactly one interpretation" — suppression. A control-side row kind this store cannot
-- ingest is therefore a PERMANENT false suppression signal, so a new control kind is not
-- optional here. That is the reason `A0005` gave for `OUTBOX_CLAIMED` and it is unchanged.
--
-- `30 §5.10` is the second reason, and S1J sharpens it. `I8`'s additive verification list
-- is built from dispatches outside `NORMAL` (`§5.7.2` item 6), and `I17f(a)`/`I17f(c)` are
-- evaluated by THIS plane from ITS OWN holdings. `§38` of the S1J mandate requires the
-- audit plane to be able to determine, later and without asking the control plane:
--
--     the claim required the `DISPATCHED_UNMIRRORED` tag; the gateway sent that
--     requirement to the adapter; and the resulting local dispatch/outcome state is
--     associated with that degraded interval or override.
--
-- The first is on the `OUTBOX_CLAIMED` row this store already holds. The second and third
-- are on THIS row: `outbox_requires_unmirrored_tag` is REQUIRED-PRESENT on it, and
-- `override_id` travels with it. Without this migration the audit plane could see a claim
-- that required the tag and never see whether any dispatch followed it.
-- =================================================================================
--
-- =================================================================================
-- WHAT THIS ROW DOES NOT TELL THE AUDIT PLANE
--
-- `DISPATCH_OUTCOME` records that a TRUSTED IN-PROCESS ADAPTER was invoked under a fresh
-- claim and what typed result it returned. At S1J that adapter is a deterministic MOCK
-- with no network, no credential and no provider behind it.
--
-- So the audit plane learns a LOCAL STATE MACHINE FACT and nothing about any provider. It
-- does not learn that a message was accepted, delivered, verified or settled; `I20`'s
-- provider-reported accepted count requires this plane's own ESP read credential, which
-- `37` S3/S4 provisions and S1J does not, and `I20` stays OPEN.
-- =================================================================================
--
-- =================================================================================
-- INDEPENDENCE, RESTATED FOR THIS FILE
--
-- `30 §5.3a` declares a field order for `acos.journal.outbox_claimed.v1` and for NO OTHER
-- KIND, and says a kind in service without one there "is a defect of this class". S1J puts
-- a second kind in service, so THE ORDER BELOW IS TRANSCRIBED FROM
-- `docs/implementation/S1J-contract.md §5` — the position `A0005` was in before v1.3.4
-- (JCS-02) made `§5.3a` normative, and recorded as `S1J-C5` for the owner to declare or
-- rename.
--
-- WHAT DOES NOT CHANGE IS THE INDEPENDENCE DISCIPLINE. This file does not read
-- `src/db/migrations/0012__dispatch_outcome.sql`, cannot call its functions and is not
-- linked to it. `tests/support/jcs1Oracle.ts` is the hand-authored THIRD reading and
-- `tests/integration/gateway/dispatch-outcome-journal-rows.test.ts` judges BOTH planes
-- against it, never against each other (`36 §0`).
--
-- **NO INSERTION ORDER ANYWHERE.** A positional concatenation, field by field. This file
-- adds three columns at the END of the table while placing their fields in the MIDDLE of
-- the order, which is precisely why `30 §5.3` forbids reflecting over physical columns.
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
    'OUTBOX_CLAIMED',
    -- S1J. The typed outcome of one claimed dispatch attempt against a trusted adapter.
    'DISPATCH_OUTCOME'
  ));

ALTER TABLE audit_journal
  ADD COLUMN dispatch_adapter       TEXT,
  ADD COLUMN dispatch_outcome_kind  TEXT,
  ADD COLUMN dispatch_effect_status TEXT;

-- The audit plane's OWN reading of the declared domains. A control plane that pushed an
-- outcome kind or a post-dispatch status this plane has never heard of is REFUSED rather
-- than recorded — the behaviour `30 §5.1` item 2 asks of a replicating verifier, and the
-- discipline `A0006`'s row-3 CHECK established.
--
-- `ADAPTER_FAILED` IS DELIBERATELY ABSENT, and so is `PRESUMED_EXECUTED`. `24 §3` K4
-- declares a RESPONSE to an adapter failure and no state for it, and the IRRECOVERABLE
-- unknown branch's MIE consumption is undeclared (`S1J-C1`, `S1J-C2`). This plane refuses
-- a row asserting either, which is the fail-closed direction.
ALTER TABLE audit_journal
  ADD CONSTRAINT audit_journal_dispatch_outcome_kind_declared
    CHECK (dispatch_outcome_kind IS NULL
           OR dispatch_outcome_kind IN ('ADAPTER_RETURNED', 'OUTCOME_UNKNOWN')),
  ADD CONSTRAINT audit_journal_dispatch_effect_status_declared
    CHECK (dispatch_effect_status IS NULL
           OR dispatch_effect_status IN ('DISPATCHED_AWAITING_VERIFICATION',
                                         'DISPATCHED_OUTCOME_UNKNOWN'));


-- =================================================================================
-- PART 2 — THE INDEPENDENT TRANSCRIPTION OF THE FIELD ORDERS
--
-- Branches 1 through 6 are A0001's, A0002's, A0005's and A0006's, byte for byte, so every
-- row this store already holds recomputes to the `audit_row_hash` it holds and the
-- ACCEPTED `VC-A3` fixtures still discriminate. Only branch 7 is new.
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
      || audit_jcs1_field(audit_jcs1_text (row_in.outbox_claim_clock_ref))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.occurred_at))
      || audit_jcs1_field(audit_jcs1_bytes(row_in.prev_hash))

    -- BRANCH 7 — `acos.journal.dispatch_outcome.v1`, S1J. Twenty fields, transcribed from
    -- `docs/implementation/S1J-contract.md §5` and not from the control plane's migration.
    --
    -- FIELDS 14 THROUGH 16 ARE THE OUTCOME ITSELF: which trusted adapter was invoked, the
    -- typed kind it returned, and the local status that followed. FIELD 17 is `§5.7.2`
    -- item 5's requirement, REQUIRED-PRESENT, and FIELD 18 is the override under which the
    -- claim was taken, NULLABLE — the two operands `§38` needs from this plane's own copy.
    WHEN 'DISPATCH_OUTCOME' THEN
         audit_jcs1_field(audit_jcs1_text('acos.journal.dispatch_outcome.v1'))
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
      || audit_jcs1_field(audit_jcs1_text (row_in.dispatch_adapter))
      || audit_jcs1_field(audit_jcs1_text (row_in.dispatch_outcome_kind))
      || audit_jcs1_field(audit_jcs1_text (row_in.dispatch_effect_status))
      || audit_jcs1_field(audit_jcs1_bool (row_in.outbox_requires_unmirrored_tag))
      || audit_jcs1_field(audit_jcs1_text (row_in.override_id))
      || audit_jcs1_field(audit_jcs1_ts   (row_in.occurred_at))
      || audit_jcs1_field(audit_jcs1_bytes(row_in.prev_hash))

  END;
$fn$;


-- =================================================================================
-- PART 3 — THE INGEST SIGNATURE, WIDENED BY THREE
--
-- The three new parameters go LAST and carry `DEFAULT NULL`, so every ACCEPTED shorter
-- call site still resolves to this function unchanged. `DROP` then `CREATE` rather than
-- `CREATE OR REPLACE`, because a changed signature would otherwise create a second
-- overload and make the shorter calls ambiguous — the reasoning A0002 recorded and A0005
-- and A0006 each repeated.
--
-- EVERY HANDLER IS CARRIED FORWARD UNCHANGED. Re-declaring at a wider signature must not
-- drop one, and `store-write-availability.test.ts` asserts the `30 §5.7.1a` mapping still
-- agrees with `src/audit/storeWriteAvailability.ts`.
-- =================================================================================

DROP FUNCTION audit_ingest_journal_row(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT,
  BIGINT, BIGINT, BYTEA, TIMESTAMPTZ, BYTEA, BYTEA, BYTEA,
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT
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
  p_outbox_claim_clock_ref         TEXT        DEFAULT NULL,
  p_dispatch_adapter               TEXT        DEFAULT NULL,
  p_dispatch_outcome_kind          TEXT        DEFAULT NULL,
  p_dispatch_effect_status         TEXT        DEFAULT NULL
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
      outbox_claim_clock_ref,
      dispatch_adapter, dispatch_outcome_kind, dispatch_effect_status
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
      p_outbox_claim_clock_ref,
      p_dispatch_adapter, p_dispatch_outcome_kind, p_dispatch_effect_status
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
  TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION audit_ingest_journal_row(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT,
  BIGINT, BIGINT, BYTEA, TIMESTAMPTZ, BYTEA, BYTEA, BYTEA,
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT,
  TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN, TEXT, TEXT, TEXT, TEXT
) TO acos_audit_replication;

RESET ROLE;
