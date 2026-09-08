-- A0002 — the AUDIT-OWNED `MIRROR_INPUT_STALL` intervals, the signed
-- `MirrorInputStallSignal`, and `I17f(b)`'s `ATTESTATION_DIVERGENCE`. S1H.
--
-- =================================================================================
-- THIS FILE RUNS ON THE AUDIT POSTGRESQL SERVER, WHICH IS NOT THE CONTROL SERVER.
--
-- Same boundary A0001 declared: `src/db/migrations/` is the control plane's schema,
-- `src/audit/db/migrations/` is this one, and no transaction spans them.
--
-- `30 §5.7`, the row that makes this file necessary:
--
--   | **Audit plane** | **`MirrorInputStallSignal`** — the signed artifact the control
--   | plane must fetch to reach `CORROBORATED_DEGRADED` | **audit → control**, pull, over
--   | a declared path | **No.** Signed under a key held only by the audit plane; the
--   | control plane holds the public key and can verify BUT NOT MINT OR EXTEND.
--
-- So the signal ORIGINATES HERE and the control plane has no write path to it. That is a
-- GRANT, at the bottom of this file, and `audit-signal-ownership.test.ts` attempts every
-- forbidden operation against real PostgreSQL as the real replication role.
-- =================================================================================
--
-- =================================================================================
-- WHERE THE SIGNAL'S OPERANDS COME FROM — AUDIT-OWNED FACTS ONLY
--
-- `30 §5.7.1`'s `MirrorInputStallSignal` carries `last_attestation_seq` and
-- `last_attestation_received_at`. Both are read from `audit_journal` — rows THIS STORE
-- received and independently re-chained. Nothing in this file reads:
--
--   - the control plane's `mirrored_at`               (not a column of this store at all)
--   - the control plane's declared mirror state        (arrives only as a journal row, and
--                                                       is I17f(b)'s SUBJECT, not an input)
--   - a caller-supplied audit-health boolean           (no such parameter exists)
--   - the control database                             (`24 §3` K11's declared inputs
--                                                       contain no control-database read)
--
-- `30 §5.7`: "Absence of expected attestations (k=3) | audit-internal observation | No [it
-- cannot be forged]. It is an absence observed by the other party." That absence, and this
-- store's own reachability observation, are the only inputs.
-- =================================================================================

SET LOCAL ROLE acos_audit_owner;


-- =================================================================================
-- PART 1 — THE THREE NEW JOURNAL ROW KINDS, TRANSCRIBED INDEPENDENTLY
--
-- The control plane declares these orders in `src/db/migrations/0009__mirror_state.sql`.
-- This file does not read that file, cannot call its functions, and is not linked to it.
-- The orders below are transcribed from the same specification —
-- `docs/implementation/S1H-contract.md §4` — and `mirror-journal-rows.test.ts` judges BOTH
-- against a hand-authored FOURTH reading in `tests/support/jcs1Oracle.ts`, never against
-- each other. That is `VC-A3`'s discipline extended to the new kinds, and A0001's own
-- reasoning applies unchanged: "a chain the writer computes proves nothing".
--
-- The audit plane needs `AUDIT_MIRROR_DEGRADED` in particular because `I17f(b)` is
-- evaluated from THIS side and the declaration is one of its two operands.
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
    'DEGRADED_MODE_OVERRIDE_EVENT'
  ));

ALTER TABLE audit_journal
  ADD COLUMN mirror_declaration_id        TEXT,
  ADD COLUMN mirror_declaration_event     TEXT,
  ADD COLUMN mirror_observed_reason       TEXT,
  ADD COLUMN corroboration_signal_id      TEXT,
  ADD COLUMN corroboration_interval_start TIMESTAMPTZ,
  ADD COLUMN corroboration_observed_at    TIMESTAMPTZ,
  ADD COLUMN corroboration_expires_at     TIMESTAMPTZ,
  ADD COLUMN corroboration_reason         TEXT,
  ADD COLUMN override_id                  TEXT,
  ADD COLUMN override_event               TEXT,
  ADD COLUMN override_actor               TEXT;

/*
 * The declared field orders. Branches 1 and 2 are A0001's, byte for byte — same domain
 * tags, same orders, same `audit_jcs1_*` calls — so every row this store already holds
 * recomputes to the `audit_row_hash` it holds and the ACCEPTED `VC-A3` fixtures still
 * discriminate.
 */
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

  END;
$fn$;


-- =================================================================================
-- PART 2 — THE PUBLISHED STALL INTERVAL
--
-- `I17f(a)`: "No effect carries `DISPATCHED_UNMIRRORED` without a concurrent audit-plane
-- `MIRROR_INPUT_STALL` interval covering its dispatch timestamp."
-- `30 §5.7.1`, replay protection: "`I17f(a)` evaluates every `DISPATCHED_UNMIRRORED`
-- dispatch timestamp against THE AUDIT PLANE'S OWN RECORD OF THE INTERVALS IT PUBLISHED,
-- so a dispatch justified by a replayed signal is a critical incident on a fact the
-- control plane does not hold and cannot rewrite."
--
-- This table is that record. `interval_end` is NULL while the condition holds.
-- =================================================================================

CREATE TABLE audit_mirror_stall_interval (
  company_id     TEXT        NOT NULL,
  interval_id    TEXT        NOT NULL,

  interval_start TIMESTAMPTZ NOT NULL,
  interval_end   TIMESTAMPTZ,

  -- `30 §5.7.1`'s `reason` enum, verbatim.
  reason         TEXT        NOT NULL,

  -- The audit-owned observation the interval rests on, retained for forensics and for the
  -- signal's own fields. Read from `audit_journal`; never supplied by a caller.
  opening_last_attestation_seq         BIGINT      NOT NULL,
  opening_last_attestation_received_at TIMESTAMPTZ,

  observed_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  observed_by    TEXT        NOT NULL DEFAULT SESSION_USER,

  PRIMARY KEY (company_id, interval_id),

  CONSTRAINT audit_stall_interval_reason_declared CHECK (reason IN (
    'ATTESTATION_STALL', 'PUSH_PATH_UNREACHABLE', 'STORE_WRITE_REJECTED')),
  CONSTRAINT audit_stall_interval_ends_after_start
    CHECK (interval_end IS NULL OR interval_end >= interval_start)
);

-- One open interval per company, for the same reason the control plane allows one open
-- declaration: "is a stall published" must be a question with one answer.
CREATE UNIQUE INDEX audit_mirror_stall_interval_one_open
  ON audit_mirror_stall_interval (company_id) WHERE interval_end IS NULL;


-- =================================================================================
-- PART 3 — THE SIGNAL, `30 §5.7.1`'s CONTRACT
--
--     MirrorInputStallSignal {
--       signal_id          UUID              -- unique per issuance; never reused
--       company_id
--       observed_at        timestamptz       -- audit-plane clock, RFC 3339 UTC, 6 digits
--       interval_start     timestamptz       -- start of the stall interval it covers
--       last_attestation_seq        BIGINT   -- the newest max_journal_seq received
--       last_attestation_received_at timestamptz
--       reason             enum { ATTESTATION_STALL, PUSH_PATH_UNREACHABLE,
--                                 STORE_WRITE_REJECTED }
--       expires_at         timestamptz       -- observed_at + max_age
--       audit_instance_id                    -- which audit-plane instance issued it
--       signature          bytea             -- Ed25519 over ACOS-JCS-1 canonical bytes
--     }
--
-- `max_age` = **5 MINUTES**, `CONFIGURED`, declared in `§5.7.1`'s table. It is transcribed
-- once, into `audit_mirror_signal_max_age()`, and the CHECK below binds `expires_at` to it
-- so a row whose two timestamps disagree with the declared value cannot exist.
--
-- `Issuance`: "re-issued every `attestation_cadence` (5 minutes) for as long as the
-- condition holds, EACH ISSUANCE CARRYING A FRESH `signal_id` AND `observed_at`. No signal
-- is issued when no stall condition holds."
-- =================================================================================

/* `30 §5.7.1`: "**`max_age`** | **5 minutes** = `attestation_cadence × 1`, `CONFIGURED`." */
CREATE FUNCTION audit_mirror_signal_max_age() RETURNS INTERVAL
LANGUAGE sql IMMUTABLE AS $fn$ SELECT INTERVAL '5 minutes'; $fn$;

CREATE TABLE audit_mirror_input_stall_signal (
  company_id                   TEXT        NOT NULL,
  signal_id                    TEXT        NOT NULL,
  interval_id                  TEXT        NOT NULL,

  observed_at                  TIMESTAMPTZ NOT NULL,
  interval_start               TIMESTAMPTZ NOT NULL,
  last_attestation_seq         BIGINT      NOT NULL,
  -- NULLABLE, and NULL means exactly one thing: NO attestation has ever been received from
  -- this company. `30 §5.7.1` prints the struct without nullability markers, and a stall
  -- declared before the first attestation ever arrives has no instant to report. Filling it
  -- with a fabricated timestamp inside a SIGNED artifact is the alternative, and it is worse.
  --
  -- It is NOT paired with `last_attestation_seq = 0`: an attestation over an empty journal
  -- legitimately reports `max_journal_seq = 0` WITH a real arrival instant, which is exactly
  -- `30 §5.4`'s "the empty attestation is the entire point". `S1H-owner-clarifications.md
  -- S1H-C5` records the nullability and its single meaning.
  last_attestation_received_at TIMESTAMPTZ,
  reason                       TEXT        NOT NULL,
  expires_at                   TIMESTAMPTZ NOT NULL,
  audit_instance_id            TEXT        NOT NULL,

  -- Ed25519, 64 bytes, produced by the audit-plane ISSUER PROCESS under a private key that
  -- `30 §5.7.1` says is "generated on and never leaving the audit-plane host". The key is
  -- not in this database and no function here can produce a signature.
  signature                    BYTEA       NOT NULL,

  -- The bytes the signature covers, as the issuer signed them. The trigger below requires
  -- them to EQUAL this store's own canonicalisation of the structured fields, which is the
  -- same discipline A0001 applies to `transmitted_bytes`: a signature over bytes nobody
  -- re-derived would be a signature over the issuer's own assertion.
  signed_bytes                 BYTEA       NOT NULL,

  issued_at                    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  issued_by                    TEXT        NOT NULL DEFAULT SESSION_USER,

  PRIMARY KEY (company_id, signal_id),
  FOREIGN KEY (company_id, interval_id)
    REFERENCES audit_mirror_stall_interval(company_id, interval_id),

  CONSTRAINT audit_signal_reason_declared CHECK (reason IN (
    'ATTESTATION_STALL', 'PUSH_PATH_UNREACHABLE', 'STORE_WRITE_REJECTED')),
  -- `30 §5.7.1`: "`expires_at` — `observed_at + max_age`".
  CONSTRAINT audit_signal_expiry_is_max_age
    CHECK (expires_at = observed_at + audit_mirror_signal_max_age()),
  CONSTRAINT audit_signal_ed25519_length CHECK (length(signature) = 64),
  CONSTRAINT audit_signal_covers_its_interval CHECK (observed_at >= interval_start),
  CONSTRAINT audit_signal_attestation_seq_non_negative CHECK (last_attestation_seq >= 0)
);

CREATE INDEX audit_mirror_signal_by_company_issue
  ON audit_mirror_input_stall_signal (company_id, observed_at DESC);

/*
 * The signal's DECLARED FIELD ORDER, and the bytes the Ed25519 signature covers.
 *
 * `30 §5.7.1`: "`signature` bytea — Ed25519 over `ACOS-JCS-1` canonical bytes OF THE
 * FIELDS ABOVE." So `signature` itself is not a member, exactly as `prev_hash` is a member
 * of a journal row and `row_hash` is not.
 *
 * The order is the order `§5.7.1` PRINTS THE STRUCT IN, with `signal_id` first because it
 * is the struct's first member. `30 §5.3` requires the order to be declared per row kind;
 * the declaration for this artifact is `docs/implementation/S1H-contract.md §5`.
 *
 * THE CONTROL PLANE RECONSTRUCTS THESE BYTES INDEPENDENTLY. `src/kernel/mirror/
 * signalCanonicalBytes.ts` is a second implementation, over the accepted TypeScript
 * `ACOS-JCS-1` module, and it never receives `signed_bytes` from the wire — it builds them
 * from the structured fields and verifies the signature over its OWN construction. A
 * signature verified against bytes the signer chose would be a signature over an
 * assertion. `corroboration-signal-cross-implementation.test.ts` judges this function and
 * that module against a hand-authored third reading.
 */
CREATE FUNCTION audit_mirror_signal_canonical_bytes(
  p_signal_id                    TEXT,
  p_company_id                   TEXT,
  p_observed_at                  TIMESTAMPTZ,
  p_interval_start               TIMESTAMPTZ,
  p_last_attestation_seq         BIGINT,
  p_last_attestation_received_at TIMESTAMPTZ,
  p_reason                       TEXT,
  p_expires_at                   TIMESTAMPTZ,
  p_audit_instance_id            TEXT
) RETURNS BYTEA
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT audit_jcs1_field(audit_jcs1_text('acos.mirror_input_stall_signal.v1'))
      || audit_jcs1_field(audit_jcs1_text(p_signal_id))
      || audit_jcs1_field(audit_jcs1_text(p_company_id))
      || audit_jcs1_field(audit_jcs1_ts  (p_observed_at))
      || audit_jcs1_field(audit_jcs1_ts  (p_interval_start))
      || audit_jcs1_field(audit_jcs1_int (p_last_attestation_seq))
      || audit_jcs1_field(audit_jcs1_ts  (p_last_attestation_received_at))
      || audit_jcs1_field(audit_jcs1_text(p_reason))
      || audit_jcs1_field(audit_jcs1_ts  (p_expires_at))
      || audit_jcs1_field(audit_jcs1_text(p_audit_instance_id));
$fn$;

/*
 * On insert: the store recomputes the canonical bytes from the STRUCTURED fields and
 * refuses the row unless `signed_bytes` equals them.
 *
 * Two things this closes. A signature over bytes that do not correspond to the stored
 * fields — so the row and the artifact the control plane verifies cannot diverge. And a
 * signature over bytes built by a canonicaliser that is not this store's, which would make
 * `§5.7.1`'s "Ed25519 over `ACOS-JCS-1` canonical bytes" an unverified claim.
 *
 * The signature itself is NOT verified here: Ed25519 is not available in this server, and
 * the party that needs to verify it is the control plane, which holds only the public key
 * (control artifact class 24, `50 §2`).
 */
CREATE FUNCTION audit_mirror_signal_bind_bytes() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_bytes BYTEA;
BEGIN
  v_bytes := audit_mirror_signal_canonical_bytes(
    NEW.signal_id, NEW.company_id, NEW.observed_at, NEW.interval_start,
    NEW.last_attestation_seq, NEW.last_attestation_received_at,
    NEW.reason, NEW.expires_at, NEW.audit_instance_id);

  IF NEW.signed_bytes IS DISTINCT FROM v_bytes THEN
    RAISE EXCEPTION 'AUDIT_SIGNAL_CANONICAL_MISMATCH'
      USING ERRCODE = 'ACS41',
            DETAIL  = 'the signed bytes are not this store''s own ACOS-JCS-1 '
                      'canonicalisation of the signal''s fields (30 §5.7.1)';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER audit_mirror_signal_binds_bytes
  BEFORE INSERT ON audit_mirror_input_stall_signal
  FOR EACH ROW EXECUTE FUNCTION audit_mirror_signal_bind_bytes();

/*
 * Append-only, both tables.
 *
 * `30 §5.7.1`, "Minting and extension": "Extending a signal's life by rewriting
 * `expires_at` breaks the signature." True — and it is also refused here, because a store
 * that permitted the rewrite would be a store whose own record of what it published could
 * be edited, and `I17f(a)` reads exactly that record.
 *
 * The stall interval admits ONE update — closing it — for the same reason `effect_journal`
 * admits one: the interval's end is not known when it opens. Everything else is refused.
 */
CREATE FUNCTION audit_mirror_signal_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE_audit_mirror_input_stall_signal'
    USING ERRCODE = 'ACS33',
          DETAIL  = 'a published MirrorInputStallSignal is immutable (30 §5.7.1)';
END;
$fn$;

CREATE TRIGGER audit_mirror_signal_immutable
  BEFORE UPDATE OR DELETE ON audit_mirror_input_stall_signal
  FOR EACH ROW EXECUTE FUNCTION audit_mirror_signal_append_only();

CREATE FUNCTION audit_mirror_stall_interval_close_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY_TABLE_audit_mirror_stall_interval'
      USING ERRCODE = 'ACS33',
            DETAIL  = 'DELETE would remove a published interval I17f(a) reads';
  END IF;
  IF (to_jsonb(NEW) - 'interval_end') IS DISTINCT FROM (to_jsonb(OLD) - 'interval_end') THEN
    RAISE EXCEPTION 'AUDIT_STALL_INTERVAL_IMMUTABLE'
      USING ERRCODE = 'ACS33',
            DETAIL  = 'only interval_end may be set on a published stall interval';
  END IF;
  IF OLD.interval_end IS NOT NULL THEN
    RAISE EXCEPTION 'AUDIT_STALL_INTERVAL_ALREADY_CLOSED'
      USING ERRCODE = 'ACS33',
            DETAIL  = 'a closed interval cannot be reopened or re-ended';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER audit_mirror_stall_interval_immutable
  BEFORE UPDATE OR DELETE ON audit_mirror_stall_interval
  FOR EACH ROW EXECUTE FUNCTION audit_mirror_stall_interval_close_only();


-- =================================================================================
-- PART 4 — `I17f(b)`: `ATTESTATION_DIVERGENCE`
--
-- Registry `I17f`: "**(b) DETECTOR** (reclassified v1.3, TA-09). An audit-plane
-- `MIRROR_INPUT_STALL` with no corresponding journaled control-plane
-- `AUDIT_MIRROR_DEGRADED` declaration raises `ATTESTATION_DIVERGENCE` at CRITICAL."
--
-- `30 §5.7`, on why it is a DETECTOR and not an invariant, and on what it cannot
-- distinguish: the declaration travels "control → audit, OVER THE PUSH PATH WHOSE FAILURE
-- IT DECLARES", and "its non-arrival is DEFINITIONALLY INDISTINGUISHABLE from the
-- condition it declares. That indistinguishability is `I17f(b)`'s subject."
--
-- So the incident is raised in both branches and ATTRIBUTES NEITHER.
-- `i17f-attestation-divergence.test.ts` asserts that the incident detail claims no
-- attribution, because `30 §5.7`'s whole point is that it cannot.
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
    -- `I17f(b)`, v1.3, TA-09.
    'ATTESTATION_DIVERGENCE'
  ));


-- =================================================================================
-- PART 5 — THE INGEST ENTRY POINT, EXTENDED FOR THE NEW KINDS
--
-- The eleven new parameters carry DEFAULT NULL, so the ACCEPTED 27-argument call sites in
-- `post-commit-and-crash-matrix.test.ts` and `vc-a3-cross-implementation.test.ts` still
-- resolve to this function unchanged and their assertions still hold. `DROP` then `CREATE`
-- rather than `CREATE OR REPLACE`, because a changed signature would otherwise create a
-- second overload and make a 27-argument call ambiguous.
-- =================================================================================

DROP FUNCTION audit_ingest_journal_row(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT,
  BIGINT, BIGINT, BYTEA, TIMESTAMPTZ, BYTEA, BYTEA, BYTEA
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
  END;

  RETURN 'ACCEPTED';
END;
$fn$;


-- =================================================================================
-- PART 6 — GRANTS
--
-- `30 §5.7.1`, Transport: "HTTPS, control plane → audit plane, PULL ONLY. The control
-- plane authenticates with a READ-ONLY BEARER CREDENTIAL scoped to this endpoint and to
-- V7. THE AUDIT PLANE ACCEPTS NO WRITES ON THIS PATH, so the fetch opens no new
-- suppression channel."
--
-- The repository harness cannot provision an HTTPS host, so the "read-only credential
-- scoped to this endpoint" is realised as a DEDICATED POSTGRESQL ROLE with SELECT on the
-- two signal tables and nothing else — which is the same substitution A0001 made for the
-- write direction, and `S1H-result.md §5` reports the HTTP endpoint itself OPEN.
--
-- WHAT MATTERS IS PRESERVED EXACTLY: the fetch role is DISTINCT from the replication role,
-- and NEITHER can write here.
-- =================================================================================

RESET ROLE;

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'acos_audit_signal_reader') THEN
    CREATE ROLE acos_audit_signal_reader LOGIN PASSWORD 'acos_audit_signal_dev';
  END IF;
END;
$roles$;

DO $connect$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO acos_audit_signal_reader',
                 current_database());
END;
$connect$;

GRANT USAGE ON SCHEMA public TO acos_audit_signal_reader;

SET LOCAL ROLE acos_audit_owner;

-- The control plane's FETCH credential. SELECT on the two signal tables, and nothing else
-- anywhere in this database.
GRANT SELECT ON audit_mirror_input_stall_signal TO acos_audit_signal_reader;
GRANT SELECT ON audit_mirror_stall_interval     TO acos_audit_signal_reader;

-- Explicit refusals, written out for the same reason A0001 wrote its own out: the tests
-- attempt each of them as the real role and a reviewer should read the intent beside them.
--
-- THE CONTROL PLANE'S REPLICATION PRINCIPAL HOLDS NOTHING ON THE SIGNAL AT ALL. `§27` of
-- the S1H mandate enumerates INSERT, UPDATE, DELETE, re-signing, changing the timestamp,
-- extending the interval and altering freshness metadata; every one of them requires a
-- privilege that is not granted below.
REVOKE ALL ON audit_mirror_input_stall_signal FROM acos_audit_replication;
REVOKE ALL ON audit_mirror_stall_interval     FROM acos_audit_replication;
REVOKE ALL ON audit_mirror_input_stall_signal FROM PUBLIC;
REVOKE ALL ON audit_mirror_stall_interval     FROM PUBLIC;

-- And the FETCH role holds nothing on the holdings, the incidents or the quota: a read
-- credential for the corroboration signal is not a read credential for the audit record.
REVOKE ALL ON audit_journal      FROM acos_audit_signal_reader;
REVOKE ALL ON audit_incident     FROM acos_audit_signal_reader;
REVOKE ALL ON audit_insert_quota FROM acos_audit_signal_reader;

REVOKE ALL ON FUNCTION audit_mirror_signal_canonical_bytes(
  TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TEXT)
  FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_mirror_signal_bind_bytes()            FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_mirror_signal_append_only()           FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_mirror_stall_interval_close_only()    FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_mirror_signal_max_age()               FROM PUBLIC;

-- The audit plane's own evaluator OWNS the observation and the issuance. It reads the
-- holdings (A0001), publishes intervals and issues signals. It still holds no INSERT on
-- `audit_journal`, so it cannot manufacture the attestation absence it then publishes a
-- stall about.
GRANT SELECT, INSERT, UPDATE ON audit_mirror_stall_interval     TO acos_audit_evaluator;
GRANT SELECT, INSERT         ON audit_mirror_input_stall_signal TO acos_audit_evaluator;
GRANT EXECUTE ON FUNCTION audit_mirror_signal_canonical_bytes(
  TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, BIGINT, TIMESTAMPTZ, TEXT, TIMESTAMPTZ, TEXT)
  TO acos_audit_evaluator;
GRANT EXECUTE ON FUNCTION audit_mirror_signal_max_age() TO acos_audit_evaluator;

-- The extended ingest entry point, re-granted at its new signature.
GRANT EXECUTE ON FUNCTION audit_ingest_journal_row(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT,
  BIGINT, BIGINT, BYTEA, TIMESTAMPTZ, BYTEA, BYTEA, BYTEA,
  TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ, TIMESTAMPTZ, TIMESTAMPTZ, TEXT, TEXT, TEXT, TEXT
) TO acos_audit_replication;

RESET ROLE;
