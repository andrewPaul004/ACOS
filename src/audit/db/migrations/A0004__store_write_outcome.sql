-- A0004 — the ingest entry point learns `30 §5.7.1a`'s store-write availability class.
-- S1H, under package issue v1.3.3, SWR-01.
--
-- =================================================================================
-- WHY THIS IS A SEPARATE FILE FROM A0003.
--
-- A0003's `ALTER TYPE audit_ingest_outcome ADD VALUE` cannot have its new value USED in the
-- transaction that adds it, and the migration runner wraps each file in one transaction. So
-- the value is added there and first used here.
-- =================================================================================
--
-- =================================================================================
-- WHAT CHANGED, AND WHAT DID NOT.
--
-- ONE new `EXCEPTION` handler is appended, after every existing one. Nothing else in the
-- function moves: the duplicate/collision pre-read, the INSERT, the `unique_violation`
-- handler, the `ACS41` handler and the `ACS18` quota handler are byte-identical to A0002's,
-- and the signature is identical so `CREATE OR REPLACE` keeps every existing GRANT and
-- every existing 27- and 38-argument call site resolving to the same function.
--
-- `post-commit-and-crash-matrix.test.ts` and `vc-a3-cross-implementation.test.ts` are
-- accepted suites that call this function; neither is amended by v1.3.3.
-- =================================================================================

SET LOCAL ROLE acos_audit_owner;


CREATE OR REPLACE FUNCTION audit_ingest_journal_row(
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
  p_override_actor                 TEXT        DEFAULT NULL
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
      override_id, override_event, override_actor
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
      p_override_id, p_override_event, p_override_actor
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

    -- =============================================================================
    -- `30 §5.7.1a` — THE CLOSED STORE-WRITE AVAILABILITY MAPPING. v1.3.3, SWR-01.
    --
    -- THREE SQLSTATEs, A LITERAL ALLOWLIST, AND EVERY OTHER ERROR PROPAGATES.
    --
    --   `53100`  disk_full                    the relation or WAL cannot be extended
    --   `58030`  io_error                     the storage layer failed the write
    --   `25006`  read_only_sql_transaction    the instance will not accept writes at all
    --
    -- `src/audit/storeWriteAvailability.ts` carries the same three and the justification
    -- for each, and `store-write-availability.test.ts` asserts that this handler and that
    -- module agree against a hand-authored third reading — the discipline `36 §0` requires
    -- and the one `override-limits-agree.test.ts` already applies to `51 §3.6`.
    --
    -- WHY REACHING THIS HANDLER ESTABLISHES ALL TEN OF `§5.7.1a`'s CONJUNCTS, structurally
    -- rather than by a checklist:
    --
    --   1  reached ingress          this function is executing. A control-side timeout
    --                              before that never gets here, and `§5.7.1a` excludes it.
    --   2  identity/authentication  EXECUTE is granted to `acos_audit_replication` alone;
    --                              `42501` is raised before the body runs and is excluded.
    --   3  admissible               the declared signature, the row-kind CHECK and the
    --                              column domains. A violation raises `23xxx`, excluded.
    --   4  JCS-1 reconstruction     `audit_journal_chain`, a BEFORE INSERT trigger, raises
    --   5  hash/canonical checks    `ACS41` on either — caught above, RETURNS an outcome.
    --   6  not a collision          RETURNS above, in the pre-read and in the
    --   7  not a benign duplicate   `unique_violation` handler. Neither reaches here.
    --   8  quota available          the same BEFORE INSERT trigger raises `ACS18` — caught
    --                              above, RETURNS `AUDIT_QUOTA_SATURATED`. NEVER here.
    --   9  the write was attempted   the trigger fired, so the INSERT statement ran.
    --  10  it could not commit       one of the three codes above.
    --
    -- SIX OF THE EIGHT DISQUALIFYING CONDITIONS LEAVE THIS FUNCTION THROUGH A `RETURN`,
    -- NOT THROUGH AN EXCEPTION, and the trigger performing conditions 4, 5 and 8 is
    -- `BEFORE INSERT`, so it has already run when the heap write is attempted. The ordering
    -- is therefore a property of this function's control flow. It is asserted against real
    -- PostgreSQL rather than trusted: `store-write-availability.test.ts` drives a
    -- representative of every excluded class and finds zero observations.
    --
    -- THE OBSERVATION IS COMMITTED AND THE OUTCOME IS RETURNED, NOT RE-RAISED. Re-raising
    -- would abort the outer transaction and roll the observation back with it, leaving the
    -- audit plane with no record of its own observation — and `§5.7.1a` makes that record
    -- the derivation's only operand. The row is still NOT STORED: the new outcome is not an
    -- acknowledgement, so `mirrored_at` stays NULL and the pusher re-pushes (`30 §5.2`).
    -- =============================================================================
    WHEN sqlstate '53100' OR sqlstate '58030' OR sqlstate '25006' THEN
      PERFORM audit_record_store_write_failure(
        p_company_id, p_journal_seq, 'AUDIT_STORE_WRITE_UNAVAILABLE', SQLSTATE);
      RETURN 'AUDIT_STORE_WRITE_UNAVAILABLE';
  END;

  RETURN 'ACCEPTED';
END;
$fn$;

RESET ROLE;
