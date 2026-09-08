-- 0007 — the local authorisation transaction: authorisation, effect, decision, approval
--        and the control-plane effect journal with its gap-free sequence and local chain.
--
-- Architecture source, and the one sentence this whole migration exists to make true:
--
--   `33 §1`, the decisive property of the selected architecture (Option A), verbatim:
--
--     "The exposure reservation, the authorisation decision, the effect journal row with
--      its gap-free sequence and local chain hash, and the resulting state transition
--      commit or fail together, as a single Postgres transaction."
--
--   `33 §6` names the tables that transaction spans, verbatim:
--
--     "§1's transaction spans `authorisations`, `effects`, `exposure_reservations` and
--      `state_facts` — four module schemas [...] The `effect_path` role spans
--      `authorisations`, `effects`, `exposure_reservations`, `state_facts` and `journal`,
--      and it is declared the privileged path."
--
--   `30 §5.1` item 3 prints the ORDER of the writes inside that transaction, verbatim:
--
--     BEGIN
--       SELECT ... FOR UPDATE on window_balance rows, ascending window_id   -- §5.2 lock order
--       SELECT ... FOR UPDATE on journal_counter(company_id)                -- last
--       authorisation row
--       effect row (status = AUTHORISED)
--       reservation row
--       state transition
--       journal row (journal_seq, local prev_hash/row_hash over ACOS-JCS-1 bytes)
--     COMMIT                                  -- durable, locally chained, gap-free
--
-- `exposure_reservation`, `reservation_window_instance`, `window_balance`,
-- `standing_authorization`, `standing_revocation_authority`, `standing_window_exposure`
-- and `journal_counter` are the ACCEPTED S1A substrate and are not touched here. What
-- 0007 adds is everything else on that list.
--
-- ---------------------------------------------------------------------------------
-- NAMING
--
-- `33 §6` writes the table names in the plural (`authorisations`, `effects`, `journal`).
-- Migrations 0001–0006 are uniformly singular (`company`, `state_fact`,
-- `exposure_reservation`, `authority_grant`). The repository convention wins over the
-- prose's plural because the prose is not a schema — `33 §6` says so in its own first
-- line, "Not a schema" — and a mixed convention inside one database is worse than either.
-- `authorisation_decision` is named in full rather than as `decision` because `24 §3` K9's
-- "decision records" are a DIFFERENT entity (the CEO/worker decision with its frozen
-- evidence set), and one table cannot be both.
-- ---------------------------------------------------------------------------------


-- ---------------------------------------------------------------------------------
-- Append-only enforcement.
--
-- `33 §6`, verbatim: "Append-only tables (`state_facts`, `effects`, `authorisations`,
-- `decisions`, `evidence`, `experiment_registrations`) have no UPDATE or DELETE grant for
-- any application role. Correction is a new row with `supersedes`."
--
-- The architecture's mechanism is a GRANT. S1 runs as one database role — `33 §6` is
-- explicit that per-module roles "are not isolation against compromised in-process code"
-- and that the `effect_path` role spans all five schemas anyway — so at S1 there is no
-- second role to withhold the grant from. A trigger is the substitute that actually
-- refuses the write in this deployment, and it refuses it for the privileged role too,
-- which a grant to a single role could not. Recorded in
-- docs/implementation/S1F-implementation-log.md.
-- ---------------------------------------------------------------------------------
CREATE FUNCTION acos_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE_%', TG_TABLE_NAME
    USING ERRCODE = 'ACS33',
          DETAIL  = format('%s on %s is refused; correction is a new row',
                           TG_OP, TG_TABLE_NAME);
END;
$$;


-- =================================================================================
-- ACOS-JCS-1, in the control database
--
-- `30 §5.3`, the hazard table, verbatim in the rules column:
--
--   NUMERIC scale        "Per-column declared decimal scale, serialised as a string at
--                         that exact scale. 25.0 and 25.00 are different bytes"
--   Timestamps           "RFC 3339, UTC, exactly 6 fractional digits, Z suffix."
--   Column order         "Fixed, declared per row kind, in the specification — never the
--                         physical column order, which a migration reorders."
--   Nulls vs empty       "Single 0x00 sentinel byte for null; an empty string is a
--                         zero-length value."
--   Unicode form         "UTF-8, NFC."
--   Field framing        "Every field prefixed with its 4-byte big-endian byte length, so
--                         no separator can be forged by content."
--
-- `I17d`, verbatim: "Hash and sequence values are computed by database functions inside
-- each instance, under roles the writing principal cannot execute as." So the chain is
-- computed HERE, by the database, and the trigger refuses a caller-supplied value.
--
-- ---------------------------------------------------------------------------------
-- WHAT THIS IS NOT
--
-- This is NOT `VC-A3`. VC-A3 is byte-identity between two INDEPENDENT INSTANCES — the
-- control trigger and the AUDIT store's own trigger, each re-chaining the same logical
-- rows in its own database — and S1F builds no audit store, no transport and no second
-- chain. VC-A3 remains OPEN and is reported as such.
--
-- The journal row kind declared below carries NO JSON-valued column, deliberately. RFC
-- 8785 in PL/pgSQL would be a second canonicaliser for the hardest of the seven hazards,
-- and the row does not need one: every field is text, integer, boolean, money, timestamp
-- or bytes. `30 §5.3`'s JSON rule is therefore not exercised by this row kind and no
-- SQL-side JCS implementation is introduced.
-- ---------------------------------------------------------------------------------

/* One field, framed: its 4-byte big-endian byte length, then its bytes. */
CREATE FUNCTION acos_jcs1_field(value BYTEA) RETURNS BYTEA
LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT int4send(length(value)) || value;
$$;

/* The null sentinel: one 0x00 byte. */
CREATE FUNCTION acos_jcs1_null() RETURNS BYTEA
LANGUAGE sql IMMUTABLE AS $$
  SELECT '\x00'::BYTEA;
$$;

/*
 * Text: UTF-8, NFC.
 *
 * U+0000 is inadmissible in ACOS canonical text — owner clarification S1B-C8, which
 * restores injectivity against the null sentinel. PostgreSQL `text` cannot hold U+0000
 * at all, so the exclusion is already structural here; it is asserted rather than
 * assumed so that the two implementations agree on the reason and not merely on the
 * outcome.
 */
CREATE FUNCTION acos_jcs1_text(value TEXT) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL THEN RETURN acos_jcs1_null(); END IF;
  RETURN convert_to(normalize(value, NFC), 'UTF8');
END;
$$;

/* Money: the declared scale is 2 and the rendering is at exactly that scale. */
CREATE FUNCTION acos_jcs1_money(value NUMERIC) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL THEN RETURN acos_jcs1_null(); END IF;
  RETURN convert_to(to_char(value, 'FM99999999999999990.00'), 'UTF8');
END;
$$;

CREATE FUNCTION acos_jcs1_int(value BIGINT) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL THEN RETURN acos_jcs1_null(); END IF;
  RETURN convert_to(value::TEXT, 'UTF8');
END;
$$;

CREATE FUNCTION acos_jcs1_bool(value BOOLEAN) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL THEN RETURN acos_jcs1_null(); END IF;
  RETURN convert_to(CASE WHEN value THEN 'true' ELSE 'false' END, 'UTF8');
END;
$$;

/* Timestamps: RFC 3339, UTC, exactly six fractional digits, Z suffix. */
CREATE FUNCTION acos_jcs1_ts(value TIMESTAMPTZ) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL THEN RETURN acos_jcs1_null(); END IF;
  RETURN convert_to(
    to_char(value AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'), 'UTF8');
END;
$$;

CREATE FUNCTION acos_jcs1_bytes(value BYTEA) RETURNS BYTEA
LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
  IF value IS NULL THEN RETURN acos_jcs1_null(); END IF;
  RETURN value;
END;
$$;


-- =================================================================================
-- The authorisation row
--
-- `26 §2.1`'s `AuthorizationRequest`, as committed state. The row records the exposure
-- the whole sequence was evaluated over, so `I18b` can be checked against PERSISTED
-- authority rather than against an in-memory object that a later statement could have
-- replaced.
-- =================================================================================
CREATE TABLE authorisation (
  authorisation_id                TEXT        PRIMARY KEY,
  company_id                      TEXT        NOT NULL REFERENCES company(company_id),

  -- `26 §3`: "stamped by the kernel from the authenticated caller identity and not a
  -- parameter any caller can set."
  principal_id                    TEXT        NOT NULL,
  session_id                      TEXT        NOT NULL,
  task_id                         TEXT        NOT NULL,

  action_class                    TEXT        NOT NULL,
  resource_ref                    TEXT        NOT NULL,
  resource_id                     TEXT        NOT NULL,

  -- `26 §2.1`: "binds this request to exactly one dispatch payload."
  dispatch_payload_hash           TEXT        NOT NULL,
  -- Lineage only. `26 §2.1`'s `intent_hash`, the commitment over the model's opaque
  -- proposal text; see the ACCEPTED S1B `lineage.ts`, which owns that commitment and is
  -- the only place under `src/` permitted to name the field it commits to.
  intent_hash                     TEXT        NOT NULL,
  context_digest                  TEXT        NOT NULL,

  -- `26 §2.1.2`: "constructor_version is recorded on the AuthorizationRequest, the
  -- AuthorizationDecision, the journal row, the approval binding [...] and the replay
  -- context."
  constructor_id                  TEXT        NOT NULL,
  constructor_semantic_major      INTEGER     NOT NULL,
  constructor_non_semantic_minor  INTEGER     NOT NULL,
  -- `26 §11`'s content hash over the Cedar schema and policy set.
  policy_version                  TEXT        NOT NULL,

  -- `26 §2.1`'s exposure block, frozen. `I18b` is checked between THIS row and
  -- exposure_reservation.amount, both persisted.
  vendor_amount                   NUMERIC(18,2),
  total_exposure                  NUMERIC(18,2) NOT NULL,
  forward_integral                NUMERIC(18,2),
  is_rate_class                   BOOLEAN     NOT NULL,
  recoverability                  TEXT        NOT NULL,
  value_direction                 TEXT        NOT NULL,

  autonomy_level                  TEXT        NOT NULL,
  gate_class                      TEXT        NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL,

  CONSTRAINT authorisation_total_exposure_non_negative CHECK (total_exposure >= 0),
  -- `I18c`, the same inequality the reservation row carries, asserted on the request too.
  CONSTRAINT authorisation_i18c_total_ge_vendor
    CHECK (vendor_amount IS NULL OR total_exposure >= vendor_amount),
  -- `26 §2.1.3`'s field table for a rate class: vendor_amount NULL, total_exposure 0.00.
  CONSTRAINT authorisation_rate_class_fields
    CHECK (NOT is_rate_class OR (total_exposure = 0.00 AND vendor_amount IS NULL)),
  -- `phase2-v1.3.1-errata.md §1`: forward_integral is "a separate field that is not a
  -- component of total_exposure". A non-rate class carries none.
  CONSTRAINT authorisation_non_rate_carries_no_forward_integral
    CHECK (is_rate_class OR forward_integral IS NULL),
  CONSTRAINT authorisation_recoverability_declared
    CHECK (recoverability IN ('REVERSIBLE', 'COMPENSABLE', 'IRRECOVERABLE')),

  -- `principal` is keyed `(company_id, principal_id)`, so the reference carries both
  -- halves. A single-column reference would not compile and, more to the point, would let
  -- one company's authorisation name another company's principal.
  FOREIGN KEY (company_id, principal_id) REFERENCES principal(company_id, principal_id)
);

CREATE TRIGGER authorisation_append_only
  BEFORE UPDATE OR DELETE ON authorisation
  FOR EACH ROW EXECUTE FUNCTION acos_append_only();

/*
 * Which window INSTANCES constrained this authorisation.
 *
 * `26 §7` step R reserves "against every named window instance the matching grants
 * reference". `reservation_window_instance` already records the instances the RESERVATION
 * moved; this records the instances the AUTHORITY named, which is what makes "every
 * referenced window bound this effect" checkable independently of the reservation's own
 * bookkeeping. For a passing authorisation the two sets are equal, and a test asserts it.
 */
CREATE TABLE authorisation_window_instance (
  authorisation_id    TEXT NOT NULL REFERENCES authorisation(authorisation_id),
  company_id          TEXT NOT NULL,
  window_id           TEXT NOT NULL,
  window_instance_key TEXT NOT NULL,
  PRIMARY KEY (authorisation_id, window_id, window_instance_key),
  FOREIGN KEY (company_id, window_id, window_instance_key)
    REFERENCES window_balance(company_id, window_id, window_instance_key)
);

CREATE TRIGGER authorisation_window_instance_append_only
  BEFORE UPDATE OR DELETE ON authorisation_window_instance
  FOR EACH ROW EXECUTE FUNCTION acos_append_only();


-- =================================================================================
-- The effect row — and `I42`
--
-- `33 §6`, verbatim: "`effects` primary key includes the idempotency key with a unique
-- constraint (I42), so a duplicate proposal cannot create a second row even if every
-- layer above it fails."
--
-- Registry `I42`: "No two `Effect` rows share an idempotency key. | Control | DB (unique
-- constraint) | Insert fails; the duplicate proposal returns the prior result."
--
-- So the primary key IS (company_id, idempotency_key). `effect_id` is a surrogate and
-- carries its own uniqueness so foreign keys can name it, but it is not the key that
-- decides duplication: making it the primary key and the idempotency key merely unique
-- would satisfy the registry and not `33 §6`.
-- =================================================================================
CREATE TABLE effect (
  company_id        TEXT        NOT NULL REFERENCES company(company_id),
  -- `25 §7`: H(task_id ‖ action_class ‖ resource_id ‖ semantic_param_digest). NEVER
  -- including journal_seq (`24 §3` K4, `30 §5.2` SR-A4), which is allocated afterwards.
  idempotency_key   TEXT        NOT NULL,

  effect_id         TEXT        NOT NULL UNIQUE,
  -- `24 §3` K5 `I31` is enforced on exposure_reservation.authorisation_id; the same
  -- one-authorisation-one-effect property is enforced here so a second effect cannot be
  -- attached to an authorisation that already has one.
  authorisation_id  TEXT        NOT NULL UNIQUE REFERENCES authorisation(authorisation_id),

  action_class      TEXT        NOT NULL,
  resource_ref      TEXT        NOT NULL,
  adapter           TEXT        NOT NULL,
  recoverability    TEXT        NOT NULL,
  gate_class        TEXT        NOT NULL,

  -- `30 §5.1`'s ordering block writes the "effect row (status = AUTHORISED)". S1F writes
  -- exactly the two statuses a LOCAL authorisation can produce and no terminal status:
  -- `24 §3` K4's terminal set (VERIFIED, FAILED, COMPENSATED, PRESUMED_EXECUTED,
  -- UNRESOLVED_DISCREPANCY) is reached only after dispatch, and S1F dispatches nothing.
  -- The status is not updated in place — the table is append-only and `33 §6` makes
  -- correction "a new row with supersedes" — so no status transition exists in S1F.
  status            TEXT        NOT NULL,

  created_at        TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (company_id, idempotency_key),

  CONSTRAINT effect_status_is_a_local_authorisation_status
    CHECK (status IN ('AUTHORISED', 'AWAITING_APPROVAL')),
  CONSTRAINT effect_recoverability_declared
    CHECK (recoverability IN ('REVERSIBLE', 'COMPENSABLE', 'IRRECOVERABLE'))
);

CREATE TRIGGER effect_append_only
  BEFORE UPDATE OR DELETE ON effect
  FOR EACH ROW EXECUTE FUNCTION acos_append_only();


-- =================================================================================
-- The approval object — INITIAL DURABLE STATE ONLY
--
-- `26 §7` load-bearing property 6, verbatim: "Reservation precedes approval (step R
-- before S), SR5. The window is committed across the human latency gap and released on
-- denial or expiry."
--
-- `25 §12` item 2, verbatim: "An `Approval` object is created in kernel state, carrying
-- the proposal hash, the `reservation_id`, the authorisation reference and the
-- idempotency key. The proposing workflow terminates. It does not suspend."
--
-- The row is therefore INSEPARABLE from step R's transaction: the reservation is held for
-- it, and a committed reservation whose approval object was written by a later
-- transaction would have an interval in which headroom was consumed for an approval that
-- does not exist. S1F creates it.
--
-- ---------------------------------------------------------------------------------
-- WHAT S1F DOES NOT BUILD HERE
--
-- The RESUME half. No `APPROVED`, `RESUMING`, `CONSUMED`, `DENIED`, `EXPIRED` or
-- `SUPERSEDED` transition is performed by any code in `src/`; step `R′`, verify mode,
-- the two `26 §12.1` resume denials, `RemedyObligation` and `I58` are
-- all absent. `26 §12.2`'s transition TABLE is not installed as a trigger either — that
-- is `I60`'s second clause and it belongs with the transitions it constrains.
--
-- What IS installed is `I60`'s first clause, because it is a schema prerequisite of the
-- initial row rather than of the resume: the unique partial index on `RESUMING`.
-- ---------------------------------------------------------------------------------
CREATE TABLE approval (
  approval_id                     TEXT        PRIMARY KEY,
  company_id                      TEXT        NOT NULL REFERENCES company(company_id),
  authorisation_id                TEXT        NOT NULL UNIQUE
                                                REFERENCES authorisation(authorisation_id),
  -- `25 §12`: the approval carries the reservation it holds. NOT NULL and a real foreign
  -- key, so an approval cannot exist without the reservation `26 §7` property 6 holds for
  -- it.
  reservation_id                  TEXT        NOT NULL
                                                REFERENCES exposure_reservation(reservation_id),
  effect_id                       TEXT        NOT NULL REFERENCES effect(effect_id),
  idempotency_key                 TEXT        NOT NULL,
  -- `26 §12`: "An approval binds to a proposal hash, to the dispatch_payload_hash, and in
  -- v1.2 to the constructor_version."
  proposal_hash                   TEXT        NOT NULL,
  dispatch_payload_hash           TEXT        NOT NULL,
  constructor_semantic_major      INTEGER     NOT NULL,
  constructor_non_semantic_minor  INTEGER     NOT NULL,

  tier                            TEXT        NOT NULL,
  state                           TEXT        NOT NULL,
  created_at                      TIMESTAMPTZ NOT NULL,
  -- `26 §12.1`: "reservation_ttl = tier.sla + reaper_grace: TIER_1 24h + 6h, TIER_2 48h +
  -- 6h. OWNER-tier reservations are exempt from reaping" — so NULL for OWNER, and no
  -- reaper exists in S1F to consume it either way.
  reservation_expires_at          TIMESTAMPTZ,

  CONSTRAINT approval_tier_declared CHECK (tier IN ('TIER_1', 'TIER_2', 'OWNER')),
  CONSTRAINT approval_state_declared
    CHECK (state IN ('PENDING', 'APPROVED', 'RESUMING', 'CONSUMED',
                     'DENIED', 'EXPIRED', 'SUPERSEDED')),
  -- OWNER tier has no auto-expiry (`26 §12`); every other tier has one.
  CONSTRAINT approval_owner_tier_has_no_reservation_ttl
    CHECK ((tier = 'OWNER') = (reservation_expires_at IS NULL))
);

-- `26 §12.2`, verbatim: "`RESUMING` carries a unique partial index on `(approval_id)`
-- (I60), so a second resume cannot start."
--
-- Transcribed exactly as declared. With `approval_id` as the primary key the index is
-- structurally redundant, and that is recorded rather than silently "improved": the
-- architecture names this index, S1F installs the index it names, and if a later slice
-- gives a resume its own row the index is already the shape `I60` asks for.
CREATE UNIQUE INDEX approval_single_resuming
  ON approval (approval_id) WHERE state = 'RESUMING';


-- =================================================================================
-- The AuthorizationDecision — `26 §7` step W
--
-- Registry `I2`, verbatim: "Every `AuthorizationDecision` with verdict PERMIT has a
-- `Reservation`, or belongs to a documented zero-exposure action class. [...] v1.2: the
-- `StandingRevocationAuthority` path creates a zero-amount reservation row, so it is not
-- an exemption."
--
-- `26 §2.1.3` extends the same reasoning to the rate class: "the row exists, so I2 is
-- satisfied without a carve-out". There is therefore NO exempt class at S1, and I2 is
-- made STRUCTURAL: `reservation_id` is NOT NULL with a foreign key. A decision without a
-- reservation is not a violation to detect — it is a row the database refuses.
-- =================================================================================
CREATE TABLE authorisation_decision (
  decision_id                     TEXT        PRIMARY KEY,
  company_id                      TEXT        NOT NULL REFERENCES company(company_id),
  authorisation_id                TEXT        NOT NULL UNIQUE
                                                REFERENCES authorisation(authorisation_id),
  effect_id                       TEXT        NOT NULL UNIQUE REFERENCES effect(effect_id),
  -- I2, structurally.
  reservation_id                  TEXT        NOT NULL UNIQUE
                                                REFERENCES exposure_reservation(reservation_id),
  approval_id                     TEXT        UNIQUE REFERENCES approval(approval_id),

  verdict                         TEXT        NOT NULL,
  approval_requirement            TEXT        NOT NULL,
  constructor_semantic_major      INTEGER     NOT NULL,
  constructor_non_semantic_minor  INTEGER     NOT NULL,
  policy_version                  TEXT        NOT NULL,
  decided_at                      TIMESTAMPTZ NOT NULL,

  -- `26 §7` step W: "PERMIT + emit signed AuthorizationDecision". Ed25519 over the
  -- ACOS-JCS-1 canonical bytes of every field except the signature, the same construction
  -- `30 §5.3` specifies and the accepted S1B `ConstructorVersionRecord` already uses.
  signed_bytes_hash               TEXT        NOT NULL,
  signature                       BYTEA       NOT NULL,
  signing_key_id                  TEXT        NOT NULL,

  CONSTRAINT decision_verdict_declared
    CHECK (verdict IN ('PERMIT', 'REQUIRE_APPROVAL')),
  -- `26 §7` step S: `NONE` goes to T and then to PERMIT at W; a tier goes to O2,
  -- REQUIRE_APPROVAL with the reservation held. The two are not independent.
  CONSTRAINT decision_verdict_matches_approval_requirement
    CHECK ((verdict = 'PERMIT') = (approval_requirement = 'NONE')),
  CONSTRAINT decision_approval_present_iff_requires_approval
    CHECK ((verdict = 'REQUIRE_APPROVAL') = (approval_id IS NOT NULL)),
  CONSTRAINT decision_signature_non_empty CHECK (length(signature) = 64)
);

CREATE TRIGGER authorisation_decision_append_only
  BEFORE UPDATE OR DELETE ON authorisation_decision
  FOR EACH ROW EXECUTE FUNCTION acos_append_only();


-- =================================================================================
-- The control-plane effect journal
--
-- `30 §5.1` item 1, verbatim: "The primary journal lives in the control database — where
-- it already lived — with three additions: a company-scoped gap-free monotonic
-- journal_seq (allocation in §5.2), a local hash chain over ACOS-JCS-1 canonical bytes
-- (§5.3) computed by a control-DB trigger, and a mirrored_at column, null until the audit
-- store acknowledges."
--
-- `30 §5.2`, verbatim: "journal_seq must be gap-free per company, which forbids a
-- sequence. PostgreSQL sequences are non-transactional: nextval outside the transaction
-- leaves permanent gaps on rollback, and a gap is the one signal I17 reads as
-- suppression. The allocator is therefore a row" — `journal_counter`, from 0001, taken
-- FOR UPDATE last in the declared lock order.
-- =================================================================================
CREATE TABLE effect_journal (
  company_id                      TEXT        NOT NULL REFERENCES company(company_id),
  journal_seq                     BIGINT      NOT NULL,

  -- `24 §3` K4 names `journal_row_kind = READ` for `enumerate_effects`. The authorisation
  -- path's kind is declared here; S1F writes exactly one kind.
  journal_row_kind                TEXT        NOT NULL,

  effect_id                       TEXT        NOT NULL REFERENCES effect(effect_id),
  authorisation_id                TEXT        NOT NULL REFERENCES authorisation(authorisation_id),
  decision_id                     TEXT        NOT NULL REFERENCES authorisation_decision(decision_id),
  reservation_id                  TEXT        NOT NULL REFERENCES exposure_reservation(reservation_id),
  approval_id                     TEXT        REFERENCES approval(approval_id),
  idempotency_key                 TEXT        NOT NULL,

  action_class                    TEXT        NOT NULL,
  resource_ref                    TEXT        NOT NULL,
  verdict                         TEXT        NOT NULL,
  vendor_amount                   NUMERIC(18,2),
  total_exposure                  NUMERIC(18,2) NOT NULL,
  forward_integral                NUMERIC(18,2),
  is_rate_class                   BOOLEAN     NOT NULL,
  dispatch_payload_hash           TEXT        NOT NULL,
  constructor_semantic_major      INTEGER     NOT NULL,
  constructor_non_semantic_minor  INTEGER     NOT NULL,
  policy_version                  TEXT        NOT NULL,
  occurred_at                     TIMESTAMPTZ NOT NULL,

  -- Computed by the trigger below. `I17d`: a caller-supplied value is refused.
  prev_hash                       BYTEA,
  row_hash                        BYTEA,

  -- `30 §5.2`: "Set on first successful acknowledgement, advisory only. It is a
  -- control-plane column, so a compromised control plane can set it freely; nothing
  -- depends on it." No S1F code sets it; the audit push is not built.
  mirrored_at                     TIMESTAMPTZ,

  -- `30 §5.2`'s re-push contract names `UNIQUE(company_id, journal_seq)`. It is the
  -- primary key here, which is the same constraint and one fewer index.
  PRIMARY KEY (company_id, journal_seq),

  CONSTRAINT journal_seq_positive CHECK (journal_seq >= 1),
  CONSTRAINT journal_row_kind_declared
    CHECK (journal_row_kind IN ('EFFECT_AUTHORISATION')),
  CONSTRAINT journal_verdict_declared
    CHECK (verdict IN ('PERMIT', 'REQUIRE_APPROVAL'))
);

/*
 * The declared field order for row kind `acos.journal.effect_authorisation.v1`.
 *
 * `30 §5.3`: "Fixed, declared per row kind, in the specification — never the physical
 * column order, which a migration reorders." The order below is the SPECIFICATION for
 * this row kind and it is written out as an explicit sequence of framed fields rather
 * than derived from the catalogue, so a column added or moved by a later migration cannot
 * silently change the bytes.
 *
 * `mirrored_at` is DELIBERATELY ABSENT from the hashed set. `30 §5.2` calls it "advisory
 * only" and it is mutated after the row commits; including it would break the chain on
 * every acknowledgement. `prev_hash` IS included — that is what makes it a chain.
 */
CREATE FUNCTION effect_journal_canonical_bytes(row_in effect_journal) RETURNS BYTEA
LANGUAGE sql IMMUTABLE AS $$
  SELECT acos_jcs1_field(acos_jcs1_text('acos.journal.effect_authorisation.v1'))
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
      || acos_jcs1_field(acos_jcs1_bytes(row_in.prev_hash));
$$;

/*
 * The chain, and the gap.
 *
 * Three properties, all enforced here rather than in application code:
 *
 *   I17d       the writer may not supply prev_hash or row_hash.
 *   gap-free   journal_seq must be exactly one more than the company's current maximum.
 *              `30 §5.2` makes a gap "the one signal I17 reads as suppression", so a
 *              caller that skipped one is refused rather than recorded.
 *   the chain   prev_hash is the previous committed row's row_hash; the genesis row's
 *              prev_hash is 32 zero bytes.
 */
CREATE FUNCTION effect_journal_chain() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_max  BIGINT;
  v_prev BYTEA;
BEGIN
  IF NEW.prev_hash IS NOT NULL OR NEW.row_hash IS NOT NULL THEN
    RAISE EXCEPTION 'I17D_CALLER_SUPPLIED_CHAIN'
      USING ERRCODE = 'ACS17',
            DETAIL  = 'prev_hash and row_hash are computed by the database (I17d)';
  END IF;

  SELECT max(journal_seq) INTO v_max
    FROM effect_journal WHERE company_id = NEW.company_id;

  IF NEW.journal_seq <> COALESCE(v_max, 0) + 1 THEN
    RAISE EXCEPTION 'JOURNAL_SEQUENCE_NOT_CONTIGUOUS'
      USING ERRCODE = 'ACS30',
            DETAIL  = format('company=%s supplied=%s expected=%s',
                             NEW.company_id, NEW.journal_seq, COALESCE(v_max, 0) + 1);
  END IF;

  IF v_max IS NULL THEN
    v_prev := decode(repeat('00', 32), 'hex');
  ELSE
    SELECT row_hash INTO v_prev
      FROM effect_journal
     WHERE company_id = NEW.company_id AND journal_seq = v_max;
  END IF;

  NEW.prev_hash := v_prev;
  NEW.row_hash  := sha256(effect_journal_canonical_bytes(NEW));
  RETURN NEW;
END;
$$;

CREATE TRIGGER effect_journal_chain
  BEFORE INSERT ON effect_journal
  FOR EACH ROW EXECUTE FUNCTION effect_journal_chain();

/*
 * The journal row is append-only EXCEPT for `mirrored_at`.
 *
 * `30 §5.2` requires `mirrored_at` to be settable "on first successful acknowledgement",
 * so a blanket append-only trigger would forbid the one write the specification requires.
 * Every other column is refused, including the chain columns — a rewrite of a chained row
 * is what the chain exists to make impossible.
 */
CREATE FUNCTION effect_journal_immutable_except_mirrored_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY_TABLE_effect_journal'
      USING ERRCODE = 'ACS33', DETAIL = 'DELETE on effect_journal is refused';
  END IF;
  IF (NEW.*) IS DISTINCT FROM (OLD.*) THEN
    -- Compare everything with mirrored_at normalised away. If anything else moved, refuse.
    IF ROW(NEW.company_id, NEW.journal_seq, NEW.journal_row_kind, NEW.effect_id,
           NEW.authorisation_id, NEW.decision_id, NEW.reservation_id, NEW.approval_id,
           NEW.idempotency_key, NEW.action_class, NEW.resource_ref, NEW.verdict,
           NEW.vendor_amount, NEW.total_exposure, NEW.forward_integral, NEW.is_rate_class,
           NEW.dispatch_payload_hash, NEW.constructor_semantic_major,
           NEW.constructor_non_semantic_minor, NEW.policy_version, NEW.occurred_at,
           NEW.prev_hash, NEW.row_hash)
       IS DISTINCT FROM
       ROW(OLD.company_id, OLD.journal_seq, OLD.journal_row_kind, OLD.effect_id,
           OLD.authorisation_id, OLD.decision_id, OLD.reservation_id, OLD.approval_id,
           OLD.idempotency_key, OLD.action_class, OLD.resource_ref, OLD.verdict,
           OLD.vendor_amount, OLD.total_exposure, OLD.forward_integral, OLD.is_rate_class,
           OLD.dispatch_payload_hash, OLD.constructor_semantic_major,
           OLD.constructor_non_semantic_minor, OLD.policy_version, OLD.occurred_at,
           OLD.prev_hash, OLD.row_hash)
    THEN
      RAISE EXCEPTION 'JOURNAL_ROW_IMMUTABLE'
        USING ERRCODE = 'ACS33',
              DETAIL  = 'only mirrored_at may be updated on effect_journal (30 §5.2)';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER effect_journal_immutable
  BEFORE UPDATE OR DELETE ON effect_journal
  FOR EACH ROW EXECUTE FUNCTION effect_journal_immutable_except_mirrored_at();
