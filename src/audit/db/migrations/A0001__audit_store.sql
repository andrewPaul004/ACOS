-- A0001 — the AUDIT STORE. S1G.
--
-- =================================================================================
-- THIS FILE RUNS ON A DIFFERENT POSTGRESQL SERVER FROM EVERY OTHER MIGRATION IN THIS
-- REPOSITORY.
--
-- `src/db/migrations/` is the CONTROL plane's schema, applied to `ACOS_CONTROL_PG_URL`.
-- `src/audit/db/migrations/` — this directory — is the AUDIT plane's schema, applied to
-- `ACOS_AUDIT_PG_URL`. Separate directory, separate runner invocation, separate ledger
-- table, separate connection, separate roles, and no transaction spans both.
--
-- `30 §5`, the disqualifying criterion this implements:
--
--   | Separate store | Distinct database instance on a different provider or, at
--   | minimum, a separate account with a separate payment method and separate operator
--   | credentials (v1.1, TEC-04).
--
-- What the repository test harness can create is TWO SEPARATE POSTGRESQL SERVERS. The
-- separate PROVIDER and separate ACCOUNT are provisioning acts the harness cannot
-- perform, `58 §9` records provisioning the separate audit account as
-- permitted-but-not-performed at this phase, and `S1G-result.md` reports that leg OPEN.
-- Nothing here may be read as satisfying it.
--
-- =================================================================================
-- WHY NOTHING IN THIS FILE CALLS THE CONTROL PLANE'S CANONICALISER
--
-- `30 §5.3`: "Two independent hash chains over the same logical rows — one in each
-- database, by design, because a chain the writer computes proves nothing (I17d) — agree
-- only if both canonicalise identically."
--
-- The control plane's `acos_jcs1_*` functions DO NOT EXIST on this server. They are not
-- reachable, not importable and not linkable. The `audit_jcs1_*` functions below are a
-- second implementation of `30 §5.3`, written from the specification, and deliberately
-- built by a different route wherever the specification admits one — the length prefix is
-- assembled byte by byte rather than by `int4send`, money is rendered by a cast to the
-- declared scale rather than by a `to_char` mask, and the timestamp is assembled from
-- parts rather than by one format string. Same declared bytes, different code.
--
-- `VC-A3` is what proves they agree, and its oracle is neither of them: hand-authored
-- fixtures in `tests/integration/audit/vc-a3-cross-implementation.test.ts`.
-- =================================================================================

-- ---------------------------------------------------------------------------------
-- ROLES
--
-- `30 §5`: "Append-only | Enforced at the database layer: the control plane holds INSERT
-- and nothing else, under a per-principal insert quota (I17c)." And `I17d`: "Hash and
-- sequence values are computed by database functions inside each instance, under roles
-- the writing principal cannot execute as."
--
--   acos_audit_owner        owns every table and every function here. NOLOGIN. The
--                           trusted computing base of the audit store.
--   acos_audit_replication  the CONTROL plane's replication principal. INSERT on
--                           `audit_journal` and nothing else. Cannot UPDATE, DELETE,
--                           TRUNCATE, execute the chain function, write an incident, or
--                           touch the quota ledger.
--   acos_audit_evaluator    the AUDIT plane's own checker. SELECT on the holdings,
--                           INSERT on incidents. It cannot insert a journal row, so a
--                           compromised evaluator cannot manufacture the holdings it
--                           then certifies.
--
-- `CREATE ROLE` is cluster-global and this is a disposable local cluster, so each is
-- created only if absent. The passwords are local development values, committed for the
-- same reason `docker-compose.yml`'s are: the environment must be reproducible from a
-- clean clone. No production credential exists anywhere in this repository.
-- ---------------------------------------------------------------------------------

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'acos_audit_owner') THEN
    CREATE ROLE acos_audit_owner NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'acos_audit_replication') THEN
    CREATE ROLE acos_audit_replication LOGIN PASSWORD 'acos_audit_repl_dev';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'acos_audit_evaluator') THEN
    CREATE ROLE acos_audit_evaluator LOGIN PASSWORD 'acos_audit_eval_dev';
  END IF;
END;
$roles$;

-- The migrating superuser becomes a member of the owner role so the objects below are
-- owned by `acos_audit_owner` rather than by whoever ran the migration. Ownership is what
-- makes SECURITY DEFINER mean "as the audit store", not "as the migrator".
GRANT acos_audit_owner TO CURRENT_USER;

DO $connect$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO acos_audit_replication',
                 current_database());
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO acos_audit_evaluator',
                 current_database());
END;
$connect$;

-- Schema-level privileges are set by the SUPERUSER, before the role switch: PostgreSQL 15
-- removed `CREATE` on `public` from `PUBLIC`, so `acos_audit_owner` needs it granted
-- explicitly, and `acos_audit_owner` does not own the schema and could not grant it to
-- itself.
--
-- Nothing is public by default in this store: `USAGE` is granted to the three named roles
-- and `CREATE` to the owner alone. The replication principal can therefore RESOLVE
-- `audit_journal` and nothing more — it cannot create a table, a function, or a view that
-- shadows one.
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE, CREATE ON SCHEMA public TO acos_audit_owner;
GRANT USAGE ON SCHEMA public TO acos_audit_replication;
GRANT USAGE ON SCHEMA public TO acos_audit_evaluator;

SET LOCAL ROLE acos_audit_owner;

/* The MVP audit insert quota. `51`-class CONFIGURED value; local, non-production. */
CREATE FUNCTION audit_default_insert_quota() RETURNS BIGINT
LANGUAGE sql IMMUTABLE AS $fn$ SELECT 10000::BIGINT; $fn$;


-- =================================================================================
-- `ACOS-JCS-1`, INDEPENDENTLY IMPLEMENTED — `30 §5.3`
-- =================================================================================

/*
 * Field framing: "Every field prefixed with its 4-byte big-endian byte length, so no
 * separator can be forged by content."
 *
 * Assembled with `set_byte` rather than `int4send`. `int4send` is the obvious route and
 * the control plane took it; taking the same route would make the two implementations
 * the same implementation with two names.
 */
CREATE FUNCTION audit_jcs1_field(value BYTEA) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE STRICT AS $fn$
DECLARE
  n      INTEGER := length(value);
  prefix BYTEA   := '\x00000000'::BYTEA;
BEGIN
  IF n > 2147483647 THEN
    RAISE EXCEPTION 'JCS1_FIELD_TOO_LONG' USING ERRCODE = 'ACS41';
  END IF;
  prefix := set_byte(prefix, 0, (n >> 24) & 255);
  prefix := set_byte(prefix, 1, (n >> 16) & 255);
  prefix := set_byte(prefix, 2, (n >>  8) & 255);
  prefix := set_byte(prefix, 3,  n        & 255);
  RETURN prefix || value;
END;
$fn$;

/* "Single `0x00` sentinel byte for null; an empty string is a zero-length value." */
CREATE FUNCTION audit_jcs1_null() RETURNS BYTEA
LANGUAGE sql IMMUTABLE AS $fn$ SELECT set_byte('\x00'::BYTEA, 0, 0); $fn$;

/*
 * Text: "UTF-8, NFC."
 *
 * Owner clarification S1B-C8 is what makes the null sentinel injective over text: ACOS
 * canonical text admits no `U+0000`, so no accepted string can imitate it. PostgreSQL
 * `text` cannot store one, so the exclusion is structural on both servers; it is asserted
 * here rather than assumed so the two implementations agree on the REASON and not merely
 * on the outcome.
 */
CREATE FUNCTION audit_jcs1_text(value TEXT) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF value IS NULL THEN RETURN audit_jcs1_null(); END IF;
  -- The check runs over the ENCODED bytes, not over `text`: `chr(0)` is itself rejected
  -- by PostgreSQL, which is the structural half of S1B-C8's argument — a `U+0000` cannot
  -- be constructed here, let alone stored. The assertion is kept so the two
  -- implementations agree on the REASON and not merely on the outcome.
  IF position('\x00'::BYTEA in convert_to(value, 'UTF8')) > 0 THEN
    RAISE EXCEPTION 'JCS1_TEXT_CONTAINS_NUL' USING ERRCODE = 'ACS41';
  END IF;
  RETURN convert_to(normalize(value, NFC), 'UTF8');
END;
$fn$;

/*
 * Money: "Per-column declared decimal scale, serialised as a string at that exact scale.
 * `25.0` and `25.00` are different bytes, deliberately."
 *
 * The declared scale for every money column of the journal row kinds is 2. Rendered by a
 * cast to `NUMERIC(18,2)`, whose text output is by definition at exactly that scale —
 * a different derivation from the control plane's `to_char` mask, from the same rule.
 */
CREATE FUNCTION audit_jcs1_money(value NUMERIC) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF value IS NULL THEN RETURN audit_jcs1_null(); END IF;
  RETURN convert_to((value::NUMERIC(18,2))::TEXT, 'UTF8');
END;
$fn$;

CREATE FUNCTION audit_jcs1_int(value BIGINT) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF value IS NULL THEN RETURN audit_jcs1_null(); END IF;
  RETURN convert_to(format('%s', value), 'UTF8');
END;
$fn$;

CREATE FUNCTION audit_jcs1_bool(value BOOLEAN) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF value IS NULL THEN RETURN audit_jcs1_null(); END IF;
  RETURN convert_to(value::TEXT, 'UTF8');
END;
$fn$;

/* Timestamps: "RFC 3339, UTC, exactly 6 fractional digits, `Z` suffix." Assembled. */
CREATE FUNCTION audit_jcs1_ts(value TIMESTAMPTZ) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE
  utc TIMESTAMP;
BEGIN
  IF value IS NULL THEN RETURN audit_jcs1_null(); END IF;
  utc := value AT TIME ZONE 'UTC';
  RETURN convert_to(
    to_char(utc, 'YYYY-MM-DD') || 'T' ||
    to_char(utc, 'HH24:MI:SS') || '.' ||
    lpad((date_part('microsecond', utc)::BIGINT % 1000000)::TEXT, 6, '0') || 'Z',
    'UTF8');
END;
$fn$;

/*
 * Bytes.
 *
 * `30 §5.3` declares the null sentinel generically and declares no separate rule for a
 * `bytea` value. A `bytea` whose content is EXACTLY the single byte `0x00` therefore
 * frames identically to SQL NULL, and the specification does not distinguish them.
 *
 * NOTHING IS INVENTED HERE. No sentinel, no escape, no prefix. The ambiguous input is
 * REFUSED, on both servers, so an ambiguity cannot be resolved silently in favour of a
 * representation the architecture never declared. See `S1G-owner-clarifications.md`
 * S1G-C1, which records the gap and reports the generic `bytes` leg of `VC-A3` PARTIAL.
 *
 * No declared field of either journal row kind can reach the refusal: the only `bytea`
 * fields are `prev_hash` and `attested_head_hash`, each always NULL or a 32-byte digest.
 */
CREATE FUNCTION audit_jcs1_bytes(value BYTEA) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $fn$
BEGIN
  IF value IS NULL THEN RETURN audit_jcs1_null(); END IF;
  IF value = audit_jcs1_null() THEN
    RAISE EXCEPTION 'JCS1_BYTES_AMBIGUOUS_WITH_NULL_SENTINEL'
      USING ERRCODE = 'ACS41',
            DETAIL  = '30 §5.3 declares no bytes rule that distinguishes a single 0x00 '
                      'byte from null; the value is refused rather than encoded (S1G-C1)';
  END IF;
  RETURN value;
END;
$fn$;


-- =================================================================================
-- THE HOLDINGS
-- =================================================================================

/*
 * `audit_journal` — what the audit store received, and what it independently computed.
 *
 * THREE GROUPS OF COLUMNS, AND THE DIFFERENCE BETWEEN THEM IS THE WHOLE POINT.
 *
 *   1. STRUCTURED FIELDS. The logical row, field by field, in typed columns. These are
 *      the audit store's INPUT to canonicalisation. `30 §5.4`'s honest statement — that
 *      the audit plane obtains "internal consistency and completeness of the latest
 *      attested prefix" — is only true if the audit store canonicalises these itself.
 *
 *   2. CONTROL-PLANE CLAIMS — `claimed_row_hash`, and `prev_hash` read as a claim about
 *      the control chain. `30 §5.9`: a chain "proves nothing at all if the writer
 *      computes the hashes." A supplied hash is EVIDENCE TO COMPARE. It is never an
 *      INSERT value that bypasses computation, and the trigger below refuses a row whose
 *      claim disagrees with what this store computes.
 *
 *   3. AUDIT-SIDE COMPUTED VALUES — `chain_seq`, `audit_prev_hash`, `audit_row_hash`.
 *      Written by the trigger, under `acos_audit_owner`, and refused if supplied (I17d).
 *      `I17b` anchors `{head_hash, chain_seq, row_count}`, so `chain_seq` is a real
 *      audit-local quantity distinct from the control plane's `journal_seq`.
 *
 * `transmitted_bytes` is retained because `30 §5.3` says "the transmitted bytes are what
 * is hashed". The trigger requires the bytes this store independently constructs to EQUAL
 * the transmitted bytes, so the row hash is simultaneously over both — which is stronger
 * than chaining over the wire bytes alone, because a control plane whose canonicaliser
 * has diverged is detected at ingest rather than at the next `VC-A3` run.
 */
CREATE TABLE audit_journal (
  company_id                      TEXT        NOT NULL,
  journal_seq                     BIGINT      NOT NULL,
  journal_row_kind                TEXT        NOT NULL,

  -- Group 1 — the structured fields.
  effect_id                       TEXT,
  authorisation_id                TEXT,
  decision_id                     TEXT,
  reservation_id                  TEXT,
  approval_id                     TEXT,
  idempotency_key                 TEXT,
  action_class                    TEXT,
  resource_ref                    TEXT,
  verdict                         TEXT,
  vendor_amount                   NUMERIC(18,2),
  total_exposure                  NUMERIC(18,2),
  forward_integral                NUMERIC(18,2),
  is_rate_class                   BOOLEAN,
  dispatch_payload_hash           TEXT,
  constructor_semantic_major      INTEGER,
  constructor_non_semantic_minor  INTEGER,
  policy_version                  TEXT,
  attested_max_journal_seq        BIGINT,
  attested_row_count              BIGINT,
  attested_head_hash              BYTEA,
  occurred_at                     TIMESTAMPTZ NOT NULL,
  prev_hash                       BYTEA,

  -- Group 2 — the control plane's claims.
  claimed_row_hash                BYTEA       NOT NULL,
  transmitted_bytes               BYTEA       NOT NULL,

  -- Group 3 — computed here, by the trigger, under the owner role.
  chain_seq                       BIGINT,
  audit_prev_hash                 BYTEA,
  audit_row_hash                  BYTEA,

  -- Provenance of the ingest, for incident forensics. NEVER a correctness operand.
  --
  -- `session_user`, not `CURRENT_USER`. The ingest entry point is SECURITY DEFINER, so
  -- `CURRENT_USER` inside it is the OWNER and would record — and, worse, charge the I17c
  -- quota to — the wrong principal. `session_user` is the role that actually connected.
  received_at                     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  received_from                   TEXT        NOT NULL DEFAULT SESSION_USER,

  -- `30 §5.2`: "UNIQUE(company_id, journal_seq)".
  PRIMARY KEY (company_id, journal_seq),

  CONSTRAINT audit_journal_seq_positive CHECK (journal_seq >= 1),
  CONSTRAINT audit_journal_kind_declared
    CHECK (journal_row_kind IN ('EFFECT_AUTHORISATION', 'JOURNAL_ATTESTATION'))
);

CREATE UNIQUE INDEX audit_journal_chain_seq ON audit_journal (company_id, chain_seq);

/*
 * `audit_incident` — findings the AUDIT plane owns.
 *
 * `24 §3` K11: "Findings cannot be edited or closed by the CEO." Here that is a grant and
 * a trigger, not a note: `acos_audit_replication` holds nothing on this table at all, so
 * the control plane cannot insert, read, rewrite or delete a finding about itself, and
 * `acos_audit_evaluator` holds INSERT and SELECT but not UPDATE or DELETE.
 *
 * S1G implements DETECTION AND PERSISTENCE ONLY. Acknowledgement workflow, escalation,
 * owner delivery and the V6/V7 views are `S5`/`S6` and are not built here.
 */
CREATE TABLE audit_incident (
  incident_id   BIGSERIAL   PRIMARY KEY,
  company_id    TEXT        NOT NULL,
  kind          TEXT        NOT NULL,
  severity      TEXT        NOT NULL,
  journal_seq   BIGINT,
  detected_at   TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  detail        JSONB       NOT NULL,

  CONSTRAINT audit_incident_kind_declared CHECK (kind IN (
    -- `30 §5.2`'s re-push table.
    'AUDIT_PUSH_DUPLICATE',
    'AUDIT_SEQUENCE_COLLISION',
    -- `I17`/`I41`: the received row does not survive independent recomputation.
    'AUDIT_CANONICAL_MISMATCH',
    'AUDIT_CHAIN_BREAK',
    -- `I17`: registry row — `AUDIT_COMPLETENESS_GAP` at CRITICAL.
    'AUDIT_COMPLETENESS_GAP',
    -- `I17e`.
    'ATTESTATION_INCONSISTENT',
    'ATTESTATION_STALL',
    -- `I17c`.
    'AUDIT_QUOTA_SATURATED'
  )),
  CONSTRAINT audit_incident_severity_declared
    CHECK (severity IN ('INFO', 'CRITICAL'))
);

/*
 * `audit_insert_quota` — `I17c`, the audit-side half.
 *
 * `30 §5.1` item 5 and registry `I17c`: "Per-principal insert quotas are enforced at the
 * audit database; saturation is an incident, not a throughput event and not a mode
 * change." And AUDA-05, which is why the quota exists at all: "the control plane holds
 * INSERT with no quota, so filling the audit store converted the whole system into an
 * approval queue."
 *
 * The accounting row is taken FOR UPDATE inside the ingest transaction, so two concurrent
 * pushes cannot both read the same remaining headroom.
 *
 * SCOPE, STATED: `37` S1 builds "insert-only grant under quota", and this is that. The
 * registry schedules `I17c`'s SCHEDULED leg — the continuous check — at S6, and S1G does
 * not build it. `I17c` is reported PARTIAL.
 */
CREATE TABLE audit_insert_quota (
  principal_name  TEXT        NOT NULL,
  window_start    TIMESTAMPTZ NOT NULL,
  max_rows        BIGINT      NOT NULL,
  inserted_rows   BIGINT      NOT NULL DEFAULT 0,
  PRIMARY KEY (principal_name, window_start),
  CONSTRAINT audit_quota_within_bound CHECK (inserted_rows <= max_rows)
);


-- =================================================================================
-- THE DECLARED FIELD ORDERS, INDEPENDENTLY TRANSCRIBED
-- =================================================================================

/*
 * `30 §5.3`: "Fixed, declared per row kind, in the specification — never the physical
 * column order, which a migration reorders."
 *
 * Transcribed here from the specification, on this server, for both row kinds. The
 * control plane's transcription is in `src/db/migrations/0007` and `0008`. Neither reads
 * the other. `VC-A3` is what proves the two transcriptions agree, and it uses a third,
 * hand-authored reading as its oracle.
 */
CREATE FUNCTION audit_journal_canonical_bytes(row_in audit_journal) RETURNS BYTEA
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

  END;
$fn$;


-- =================================================================================
-- INGEST: RECOMPUTE, COMPARE, THEN CHAIN. NEVER TRUST.
-- =================================================================================

/*
 * The audit-side chain trigger. `I17d`, `I41`, and `30 §5.9`'s last-but-two line:
 * "Proves nothing at all if the writer computes the hashes."
 *
 * Seven things happen here, in this order, and every one of them can refuse the row:
 *
 *  1. A caller-supplied `chain_seq`, `audit_prev_hash` or `audit_row_hash` is REFUSED.
 *     `I17d`. The writing principal does not get to choose the chain.
 *
 *  2. The row is canonicalised BY THIS STORE from the STRUCTURED columns.
 *
 *  3. That independently constructed byte string must EQUAL `transmitted_bytes`.
 *     `30 §5.3`: "The transmitted bytes are what is hashed. The audit store re-chains
 *     over the bytes it received, not over a re-serialisation of its own parsed columns.
 *     A parse-then-reserialise step would reintroduce every hazard above at the receiving
 *     end." It cannot reintroduce them here, because the re-serialisation is CHECKED
 *     against the wire rather than substituted for it: the hash is over a byte string
 *     that is simultaneously the transmitted one and this store's own construction, and
 *     any divergence between the two canonicalisers is a refusal at ingest.
 *
 *  4. `sha256` of those bytes must equal `claimed_row_hash`. This is `I17`'s "exactly one
 *     audit row whose `row_hash` matches the transmitted canonical bytes", evaluated on
 *     arrival. The claim is compared, never copied.
 *
 *  5. If this store already holds `journal_seq - 1` for the company, the row's structured
 *     `prev_hash` must equal that row's verified `claimed_row_hash`. That is the CONTROL
 *     chain, verified over the rows this store actually received. If it does not hold the
 *     predecessor, the row is accepted and the absence is left to the gap check — which
 *     is what makes `30 §5.5` case 1's "audit receives 1, 2, 4" observable at all.
 *
 *  6. The AUDIT chain advances: `chain_seq` is this store's own arrival counter, and
 *     `audit_row_hash = sha256(framed(audit_prev_hash) || framed(canonical bytes))`.
 *     Arrival order, not `journal_seq` order, because a store that can hold a gap cannot
 *     chain by a sequence it does not have.
 *
 *  7. The quota is charged. `I17c`.
 *
 * SECURITY DEFINER, owned by `acos_audit_owner`, with a pinned `search_path`.
 */
CREATE FUNCTION audit_journal_chain() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_bytes   BYTEA;
  v_hash    BYTEA;
  v_prevrow BYTEA;
  v_maxchain BIGINT;
  v_prevaudit BYTEA;
  v_quota   audit_insert_quota%ROWTYPE;
  v_window  TIMESTAMPTZ;
BEGIN
  -- 1. I17d.
  IF NEW.chain_seq IS NOT NULL
     OR NEW.audit_prev_hash IS NOT NULL
     OR NEW.audit_row_hash IS NOT NULL THEN
    RAISE EXCEPTION 'I17D_CALLER_SUPPLIED_AUDIT_CHAIN'
      USING ERRCODE = 'ACS17',
            DETAIL  = 'chain_seq, audit_prev_hash and audit_row_hash are computed by the '
                      'audit database (I17d)';
  END IF;

  -- 7a. I17c — charge the quota before doing the work, so a saturating principal cannot
  --     spend the store's CPU on rows it is not permitted to insert.
  v_window := date_trunc('hour', clock_timestamp());
  SELECT * INTO v_quota FROM audit_insert_quota
   WHERE principal_name = SESSION_USER AND window_start = v_window
     FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO audit_insert_quota (principal_name, window_start, max_rows)
    VALUES (SESSION_USER, v_window, audit_default_insert_quota())
    ON CONFLICT (principal_name, window_start) DO NOTHING;
    SELECT * INTO v_quota FROM audit_insert_quota
     WHERE principal_name = SESSION_USER AND window_start = v_window
       FOR UPDATE;
  END IF;
  IF v_quota.inserted_rows >= v_quota.max_rows THEN
    RAISE EXCEPTION 'I17C_AUDIT_INSERT_QUOTA_SATURATED'
      USING ERRCODE = 'ACS18',
            DETAIL  = format('principal=%s window=%s quota=%s',
                             SESSION_USER, v_window, v_quota.max_rows);
  END IF;

  -- 2, 3. Independent canonicalisation, checked against the wire.
  v_bytes := audit_journal_canonical_bytes(NEW);
  IF v_bytes IS NULL THEN
    RAISE EXCEPTION 'AUDIT_CANONICAL_MISMATCH'
      USING ERRCODE = 'ACS41', DETAIL = 'no declared field order for this row kind';
  END IF;
  IF v_bytes IS DISTINCT FROM NEW.transmitted_bytes THEN
    RAISE EXCEPTION 'AUDIT_CANONICAL_MISMATCH'
      USING ERRCODE = 'ACS41',
            DETAIL  = 'the audit store''s own canonicalisation of the structured fields '
                      'does not equal the transmitted bytes';
  END IF;

  -- 4. The claim is compared.
  v_hash := sha256(v_bytes);
  IF v_hash IS DISTINCT FROM NEW.claimed_row_hash THEN
    RAISE EXCEPTION 'AUDIT_CANONICAL_MISMATCH'
      USING ERRCODE = 'ACS41',
            DETAIL  = 'the control-plane row_hash does not match the hash this store '
                      'computed over the row it received';
  END IF;

  -- 5. The control chain, over the rows this store holds.
  SELECT claimed_row_hash INTO v_prevrow
    FROM audit_journal
   WHERE company_id = NEW.company_id AND journal_seq = NEW.journal_seq - 1;
  IF FOUND THEN
    IF NEW.prev_hash IS DISTINCT FROM v_prevrow THEN
      RAISE EXCEPTION 'AUDIT_CHAIN_BREAK'
        USING ERRCODE = 'ACS41',
              DETAIL  = format('company=%s seq=%s prev_hash does not match the row this '
                               'store holds at seq %s',
                               NEW.company_id, NEW.journal_seq, NEW.journal_seq - 1);
    END IF;
  ELSIF NEW.journal_seq = 1 AND NEW.prev_hash IS DISTINCT FROM decode(repeat('00', 32), 'hex') THEN
    RAISE EXCEPTION 'AUDIT_CHAIN_BREAK'
      USING ERRCODE = 'ACS41',
            DETAIL  = 'the genesis row must chain from 32 zero bytes';
  END IF;

  -- 6. This store's own chain, over ARRIVAL order.
  SELECT max(chain_seq) INTO v_maxchain FROM audit_journal WHERE company_id = NEW.company_id;
  IF v_maxchain IS NULL THEN
    v_prevaudit := decode(repeat('00', 32), 'hex');
    NEW.chain_seq := 1;
  ELSE
    SELECT audit_row_hash INTO v_prevaudit
      FROM audit_journal WHERE company_id = NEW.company_id AND chain_seq = v_maxchain;
    NEW.chain_seq := v_maxchain + 1;
  END IF;
  NEW.audit_prev_hash := v_prevaudit;
  NEW.audit_row_hash  := sha256(audit_jcs1_field(v_prevaudit) || audit_jcs1_field(v_bytes));

  -- 7b. Charge.
  UPDATE audit_insert_quota
     SET inserted_rows = inserted_rows + 1
   WHERE principal_name = SESSION_USER AND window_start = v_window;

  RETURN NEW;
END;
$fn$;

CREATE TRIGGER audit_journal_chain
  BEFORE INSERT ON audit_journal
  FOR EACH ROW EXECUTE FUNCTION audit_journal_chain();

/*
 * Accepted audit rows are immutable, and unlike the control journal there is no
 * `mirrored_at`-shaped exception: nothing downstream of this store writes to it.
 */
CREATE FUNCTION audit_journal_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE_audit_journal'
    USING ERRCODE = 'ACS33',
          DETAIL  = format('%s on audit_journal is refused', TG_OP);
END;
$fn$;

CREATE TRIGGER audit_journal_immutable
  BEFORE UPDATE OR DELETE ON audit_journal
  FOR EACH ROW EXECUTE FUNCTION audit_journal_append_only();

CREATE FUNCTION audit_incident_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE_audit_incident'
    USING ERRCODE = 'ACS33',
          DETAIL  = format('%s on audit_incident is refused', TG_OP);
END;
$fn$;

CREATE TRIGGER audit_incident_immutable
  BEFORE UPDATE OR DELETE ON audit_incident
  FOR EACH ROW EXECUTE FUNCTION audit_incident_append_only();


-- =================================================================================
-- THE INGEST ENTRY POINT — `30 §5.2`'s re-push contract
-- =================================================================================

/*
 * `30 §5.2`, the whole table, implemented here:
 *
 *   | UNIQUE(company_id, journal_seq) conflict, IDENTICAL row_hash | ON CONFLICT DO
 *   | NOTHING. Emit `AUDIT_PUSH_DUPLICATE` at INFO. This is the expected retry.
 *   | Conflict, DIFFERING row_hash | Reject. Emit `AUDIT_SEQUENCE_COLLISION` at CRITICAL.
 *   | row_count | count(DISTINCT journal_seq).
 *
 * and its reason, verbatim: "rejecting the duplicate breaks the retry; accepting it
 * duplicates a row inside a hash chain; and counting it inflates `row_count`, which is an
 * ANCHORED quantity, so a benign retry storm would corrupt the anchor."
 *
 * So a benign duplicate advances NOTHING: no second row, no `chain_seq`, no quota charge,
 * no `row_count`. It returns `AUDIT_PUSH_DUPLICATE` and records the INFO incident.
 *
 * A conflicting push at the same sequence returns `AUDIT_SEQUENCE_COLLISION`, records the
 * CRITICAL incident, and LEAVES THE EXISTING ROW ALONE. `30 §5.2`: "Two different rows
 * claiming one sequence is either a control-plane bug or a rewrite attempt, and it is
 * never benign."
 *
 * SECURITY DEFINER so it can write the incident the replication principal must not be
 * able to write, forge or suppress.
 */
CREATE TYPE audit_ingest_outcome AS ENUM (
  'ACCEPTED',
  'AUDIT_PUSH_DUPLICATE',
  'AUDIT_SEQUENCE_COLLISION',
  'AUDIT_CANONICAL_MISMATCH',
  'AUDIT_CHAIN_BREAK',
  'AUDIT_QUOTA_SATURATED'
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
  p_transmitted_bytes              BYTEA
) RETURNS audit_ingest_outcome
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $fn$
DECLARE
  v_existing BYTEA;
BEGIN
  -- The duplicate/collision decision is taken on what this store ALREADY VERIFIED, never
  -- on what the pusher says about it.
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
      occurred_at, prev_hash, claimed_row_hash, transmitted_bytes
    ) VALUES (
      p_company_id, p_journal_seq, p_journal_row_kind,
      p_effect_id, p_authorisation_id, p_decision_id, p_reservation_id, p_approval_id,
      p_idempotency_key, p_action_class, p_resource_ref, p_verdict,
      p_vendor_amount, p_total_exposure, p_forward_integral, p_is_rate_class,
      p_dispatch_payload_hash, p_constructor_semantic_major, p_constructor_non_semantic_minor,
      p_policy_version, p_attested_max_journal_seq, p_attested_row_count, p_attested_head_hash,
      p_occurred_at, p_prev_hash, p_claimed_row_hash, p_transmitted_bytes
    );
  EXCEPTION
    -- Two concurrent pushes at the same sequence. The loser re-reads and classifies on
    -- the row the winner actually committed, so a concurrent EXACT duplicate is still
    -- benign and a concurrent CONFLICTING one is still critical.
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
-- GRANTS — `30 §5`: "the control plane holds INSERT and nothing else"
-- =================================================================================

-- The replication principal. INSERT on the holdings, EXECUTE on the ingest entry point,
-- and NOTHING ELSE anywhere in this database.
GRANT INSERT ON audit_journal TO acos_audit_replication;
GRANT EXECUTE ON FUNCTION audit_ingest_journal_row(
  TEXT, BIGINT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT,
  NUMERIC, NUMERIC, NUMERIC, BOOLEAN, TEXT, INTEGER, INTEGER, TEXT,
  BIGINT, BIGINT, BYTEA, TIMESTAMPTZ, BYTEA, BYTEA, BYTEA
) TO acos_audit_replication;

-- Explicit refusals. Redundant against the default (nothing is granted that is not
-- granted), and written out because `S1G` attempts each of them against real PostgreSQL
-- and a reviewer should be able to read the intent next to the test.
REVOKE ALL ON audit_incident       FROM acos_audit_replication;
REVOKE ALL ON audit_insert_quota   FROM acos_audit_replication;
REVOKE ALL ON SEQUENCE audit_incident_incident_id_seq FROM acos_audit_replication;

-- `I17d`: the writing principal cannot execute the chain function as a role that could
-- choose its output. Revoked from PUBLIC so no future role inherits it by accident.
REVOKE ALL ON FUNCTION audit_journal_chain()          FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_journal_append_only()    FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_incident_append_only()   FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_journal_canonical_bytes(audit_journal) FROM PUBLIC;
REVOKE ALL ON FUNCTION audit_default_insert_quota()   FROM PUBLIC;

-- The audit plane's own evaluator. It reads the holdings and writes findings. It holds
-- no INSERT on `audit_journal`, so it cannot manufacture what it certifies.
GRANT SELECT ON audit_journal      TO acos_audit_evaluator;
GRANT SELECT ON audit_insert_quota TO acos_audit_evaluator;
GRANT SELECT, INSERT ON audit_incident TO acos_audit_evaluator;
GRANT USAGE ON SEQUENCE audit_incident_incident_id_seq TO acos_audit_evaluator;
GRANT EXECUTE ON FUNCTION audit_journal_canonical_bytes(audit_journal) TO acos_audit_evaluator;

RESET ROLE;
