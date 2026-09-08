-- A0003 — the AUDIT-OWNED record of `30 §5.7.1a`'s store-write availability failures,
-- which is `STORE_WRITE_REJECTED`'s only operand. S1H, under package issue v1.3.3, SWR-01.
--
-- =================================================================================
-- THIS FILE RUNS ON THE AUDIT POSTGRESQL SERVER, WHICH IS NOT THE CONTROL SERVER.
--
-- Same boundary A0001 and A0002 declared. Nothing here reads the control database, the
-- control plane's `mirrored_at`, the control plane's declared mirror state, or a
-- caller-supplied health boolean, and `plane-independence.test.ts` asserts the absence.
--
-- A0004 replaces the ingest entry point to record into the table this file creates. Two
-- files because `ALTER TYPE ... ADD VALUE` below cannot be USED in the transaction that
-- adds it, and the migration runner wraps each file in one transaction.
-- =================================================================================
--
-- =================================================================================
-- WHY THE OBSERVATION IS A DURABLE AUDIT-OWNED ROW AND NOT A PROCESS VARIABLE.
--
-- `30 §5.7.1a`: "**`STORE_WRITE_REJECTED` is an AUDIT-OWNED derivation.** The control plane
-- cannot cause it, cannot claim it and cannot assert it."
--
-- `observeStall` runs on the audit plane's own scheduler and is a different call from the
-- ingest attempt that failed, so the observation has to survive between the two — and the
-- only place it can survive that the control plane cannot write is this store. A
-- module-level variable would also lose it across a restart, which is the defect
-- `mirror-state-durability.test.ts` spends a whole suite refusing for the mirror state.
--
-- THE CONTROL PLANE HAS NO WRITE PATH TO THIS TABLE. `acos_audit_replication` holds INSERT
-- on `audit_journal` and EXECUTE on the ingest entry point, and nothing else anywhere in
-- this database (`30 §5`: "the control plane holds INSERT and nothing else"). Rows here are
-- written by the ingest function itself under `SECURITY DEFINER` as `acos_audit_owner` —
-- the same mechanism `audit_incident` has used since A0001 — and no grant below gives the
-- replication role SELECT, INSERT, UPDATE or DELETE on it, or EXECUTE on the recorder.
-- =================================================================================
--
-- =================================================================================
-- AND THE HONEST NARROWNESS, RESTATED WHERE IT IS BUILT.
--
-- `30 §5.7.1a`: "the audit plane must be able to write its own interval and signal rows in
-- order to publish anything at all, so the derivation is reachable only where the storage
-- layer is unavailable for the **journal holdings** while the audit plane's own tables
-- remain writable — a per-tablespace or per-relation write failure. Where the whole store is
-- unavailable for writes, nothing is published and the answer is `UNCORROBORATED_STALL` plus
-- the override."
--
-- This table is one of "the audit plane's own tables". If it cannot be written either, the
-- recorder's own INSERT fails, no observation exists, `observeStall` finds nothing and NO
-- SIGNAL IS ISSUED. That is the fail-closed direction, and `§5.6`'s reachability table's
-- last row states it.
-- =================================================================================

SET LOCAL ROLE acos_audit_owner;


-- =================================================================================
-- PART 1 — THE OBSERVATION
-- =================================================================================

/*
 * One row per store-write availability failure the audit plane observed at its own ingress.
 *
 * `failure_class` is a column carrying exactly one admissible value rather than an implied
 * property, because `30 §5.7.1a` declares a SEMANTIC CLASS and a future second class must
 * not be silently folded into this one. The CHECK is the closure.
 *
 * `sqlstate` is recorded for the incident and for review. IT IS NOT WHAT MAKES THE ROW
 * ELIGIBLE: A0004's handler is a literal three-code allowlist and decided that before the
 * row existed, and this column cannot widen it.
 */
CREATE TABLE audit_store_write_failure (
  failure_id     BIGSERIAL   PRIMARY KEY,
  company_id     TEXT        NOT NULL,

  -- The sequence the attempt carried, for the incident. Not an operand of the derivation.
  journal_seq    BIGINT      NOT NULL,

  -- `30 §5.7.1a`'s semantic class. Closed.
  failure_class  TEXT        NOT NULL,

  -- The concrete PostgreSQL code the implementation mapped, recorded for review.
  sqlstate       TEXT        NOT NULL,

  observed_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),

  CONSTRAINT audit_store_write_failure_class_declared
    CHECK (failure_class = 'AUDIT_STORE_WRITE_UNAVAILABLE')
);

CREATE INDEX audit_store_write_failure_by_company
  ON audit_store_write_failure (company_id, observed_at DESC);

/*
 * Append-only, exactly as `audit_journal` and `audit_incident` are.
 *
 * `30 §5.7.1a` makes this the derivation's only operand, so a deletable row would be a
 * deletable corroboration basis.
 */
CREATE FUNCTION audit_store_write_failure_append_only() RETURNS TRIGGER
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE_audit_store_write_failure'
    USING ERRCODE = 'ACS71';
END;
$fn$;

CREATE TRIGGER audit_store_write_failure_immutable
  BEFORE UPDATE OR DELETE ON audit_store_write_failure
  FOR EACH ROW EXECUTE FUNCTION audit_store_write_failure_append_only();


-- =================================================================================
-- PART 2 — THE INCIDENT KIND AND THE INGEST OUTCOME
--
-- A store-write availability failure is an incident in its own right, whatever the mirror
-- mode does — `30 §6.1`: "a failed invariant is an incident, not a log line" — and
-- `§5.7.1a`'s derivation is ADDITIONAL to the incident rather than a replacement for it.
--
-- The OUTCOME is new because the row was not stored and the existing five outcomes each
-- assert something untrue about it: it is not `ACCEPTED`, not a duplicate, not a collision,
-- not a canonical or chain failure, and NOT quota saturation. Reusing `AUDIT_QUOTA_SATURATED`
-- would have been the exact confusion `§5.7.1a` excludes.
--
-- `isAcknowledgement` in `src/audit/transport/journalRecord.ts` admits only `ACCEPTED` and
-- `AUDIT_PUSH_DUPLICATE`, so the new outcome leaves `mirrored_at` NULL and the row stays in
-- the pusher's backlog and is re-pushed. `30 §5.2`'s re-push semantics are unchanged.
-- =================================================================================

ALTER TABLE audit_incident
  DROP CONSTRAINT audit_incident_kind_declared;

ALTER TABLE audit_incident
  ADD CONSTRAINT audit_incident_kind_declared CHECK (kind IN (
    'AUDIT_PUSH_DUPLICATE',
    'AUDIT_SEQUENCE_COLLISION',
    'AUDIT_CANONICAL_MISMATCH',
    'AUDIT_CHAIN_BREAK',
    'AUDIT_COMPLETENESS_GAP',
    'ATTESTATION_INCONSISTENT',
    'ATTESTATION_STALL',
    'AUDIT_QUOTA_SATURATED',
    'ATTESTATION_DIVERGENCE',
    -- `30 §5.7.1a`, v1.3.3, SWR-01.
    'AUDIT_STORE_WRITE_UNAVAILABLE'
  ));

RESET ROLE;

ALTER TYPE audit_ingest_outcome ADD VALUE IF NOT EXISTS 'AUDIT_STORE_WRITE_UNAVAILABLE';

SET LOCAL ROLE acos_audit_owner;


-- =================================================================================
-- PART 3 — RECORDING ONE OBSERVATION
--
-- `SECURITY DEFINER`, so the row is written as `acos_audit_owner` and the replication
-- principal still holds nothing but INSERT on `audit_journal`.
--
-- THE FUNCTION REFUSES ANY CLASS BUT THE DECLARED ONE. It is the only write path to the
-- table, so there is no argument through which a caller could record a quota saturation, a
-- collision or a canonical mismatch as a store-write failure — `failure_class` is validated
-- here and again by the CHECK, and A0004's three-code allowlist decides eligibility before
-- either. It is granted to NOBODY: only the ingest entry point, itself
-- `SECURITY DEFINER`, calls it.
-- =================================================================================

CREATE FUNCTION audit_record_store_write_failure(
  p_company_id    TEXT,
  p_journal_seq   BIGINT,
  p_failure_class TEXT,
  p_sqlstate      TEXT
) RETURNS BIGINT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_id BIGINT;
BEGIN
  IF p_failure_class <> 'AUDIT_STORE_WRITE_UNAVAILABLE' THEN
    RAISE EXCEPTION 'STORE_WRITE_FAILURE_CLASS_NOT_DECLARED: %', p_failure_class
      USING ERRCODE = 'ACS72';
  END IF;

  INSERT INTO audit_store_write_failure
    (company_id, journal_seq, failure_class, sqlstate)
  VALUES (p_company_id, p_journal_seq, p_failure_class, p_sqlstate)
  RETURNING failure_id INTO v_id;

  INSERT INTO audit_incident (company_id, kind, severity, journal_seq, detail)
  VALUES (p_company_id, 'AUDIT_STORE_WRITE_UNAVAILABLE', 'CRITICAL', p_journal_seq,
          jsonb_build_object(
            'reason', '30 §5.7.1a store-write availability failure',
            'sqlstate', p_sqlstate,
            'failure_id', v_id));

  RETURN v_id;
END;
$fn$;


-- =================================================================================
-- PART 4 — THE DERIVATION WINDOW
--
-- `30 §5.7.1`'s Issuance rule re-issues every `attestation_cadence` for as long as the
-- condition holds. A store-write failure observed an hour ago is not a condition that holds
-- now, so the derivation reads only recent observations.
--
-- The window is `attestation_cadence × k` = 15 MINUTES, WHICH IS NOT A NEW QUANTITY. It is
-- the bound `30 §5.4` already declares for attestation silence, the interval `30 §5.10`
-- already declares for `I17f`'s evaluation, and the value `51 §3.8` aligns
-- `mirror_lag_critical_threshold` with. Transcribed, not invented, and
-- `store-write-availability.test.ts` asserts it equals `cadence × k` as arithmetic.
--
-- IT IS NOT `max_age`. `max_age` bounds how long a signal the control plane HOLDS stays
-- valid; this bounds how recently the audit plane must have OBSERVED the condition it signs
-- about. `30 §5.1a`'s closing note keeps the two apart deliberately.
-- =================================================================================

CREATE FUNCTION audit_store_write_failure_window() RETURNS INTERVAL
LANGUAGE sql IMMUTABLE AS $fn$
  -- 30 §5.4: attestation_cadence (5 minutes) x k (3).
  SELECT INTERVAL '15 minutes';
$fn$;


-- =================================================================================
-- GRANTS
--
-- The evaluator reads. NOTHING is granted to `acos_audit_replication`, and the recorder is
-- granted to nobody.
-- =================================================================================

GRANT SELECT ON audit_store_write_failure TO acos_audit_evaluator;
GRANT EXECUTE ON FUNCTION audit_store_write_failure_window() TO acos_audit_evaluator;

REVOKE ALL ON audit_store_write_failure FROM acos_audit_replication;
REVOKE ALL ON audit_store_write_failure FROM acos_audit_signal_reader;
REVOKE ALL ON audit_store_write_failure FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_record_store_write_failure(TEXT, BIGINT, TEXT, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_store_write_failure_append_only() FROM PUBLIC;

RESET ROLE;
