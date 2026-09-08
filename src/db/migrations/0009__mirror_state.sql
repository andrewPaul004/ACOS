-- 0009 — THE MIRROR STATE MACHINE, its journal row kinds, the statutory-clock provenance
-- leg of `I56`, and `DegradedModeOverride` with `I63`. S1H.
--
-- =================================================================================
-- WHAT THIS MIGRATION IS, AND THE ONE THING IT IS NOT
--
-- `30 §5.6` declares three states and `30 §5.1` item 4 declares an ordered first-match
-- dispatch precedence evaluated INSIDE the declared state. This migration builds the
-- DURABLE OPERANDS of that machine and the journal rows that record its transitions.
--
-- IT DISPATCHES NOTHING. There is no adapter, no outbox, no exclusive claim, no external
-- call and no `DISPATCHED` effect state anywhere in this file or in the slice. The
-- classifier that reads this state is a PURE function in
-- `src/kernel/mirror/dispatchPrecedence.ts` and its output is a disposition, not a send.
-- =================================================================================
--
-- ---------------------------------------------------------------------------------
-- WHY THE STATE IS DERIVED AND ALSO PERSISTED
--
-- `30 §5.6`'s table defines each state by the conditions under which it is *entered*:
--
--   | `NORMAL`                | Mirror acknowledging within threshold
--   | `UNCORROBORATED_STALL`  | Control plane observes the mirror unreachable; no valid,
--   |                         | unexpired `MirrorInputStallSignal` is held
--   | `CORROBORATED_DEGRADED` | The control plane holds a valid, signed, unexpired
--   |                         | `MirrorInputStallSignal` issued by the audit plane
--
-- So the state is a FUNCTION of two durable facts and one clock reading, and the
-- authoritative representation is the facts: `mirror_declaration` (the control-side
-- declaration, `30 §5.7`'s `AUDIT_MIRROR_DEGRADED` row) and `mirror_corroboration` (the
-- consumed signals, `30 §5.7.1`).
--
-- `mirror_state` below is the RESOLVED value, written in the same transaction as the
-- journal row that caused the transition. It exists so a restart has a durable reading and
-- so a transition is an auditable event rather than a recomputation — and
-- `mirror-state-durability.test.ts` asserts that the persisted value always equals a fresh
-- derivation from the operands, which is what stops it becoming an independent source of
-- truth that could drift.
--
-- `30 §5.7.1`: "Extending it by holding it is bounded by `max_age`, evaluated at EVERY
-- STATE EVALUATION AND NOT ONLY AT ENTRY." That is why the resolved row carries
-- `evaluated_at` and why every read re-derives: a cached `CORROBORATED_DEGRADED` that
-- outlived its signal would be exactly the defect TA-06 raised.
-- ---------------------------------------------------------------------------------


-- =================================================================================
-- PART 1 — THE JOURNAL ROW KINDS
--
-- `30 §5.7.2` item 7: "Creation, grant, second approval, each cap decrement, exhaustion,
-- expiry and revocation are journaled, each as its own row."
-- `30 §5.7`: the control-side declaration IS "`AUDIT_MIRROR_DEGRADED` journal row — the
-- declaration itself".
-- `30 §5.7.1`: "`signal_id` is recorded in the journal on consumption."
--
-- Three new kinds, on the SAME `effect_journal`, the SAME `journal_counter`, the SAME
-- chain trigger and the SAME replication path — for the reason 0008 gave for the
-- attestation: a second table would be `30 §5.4`'s "second unverified channel".
--
-- EVERY NEW COLUMN IS A SCALAR. No JSON, no JSONB, no array reaches a hashed field, so
-- `ACOS-JCS-1`'s RFC-8785 leg is not engaged by this migration on either plane and the
-- S1G position — no production row carries a JSON column — is preserved rather than
-- quietly extended. `mirror-journal-rows.test.ts` asserts that as a schema property.
-- =================================================================================

ALTER TABLE effect_journal
  DROP CONSTRAINT journal_row_kind_declared;

ALTER TABLE effect_journal
  ADD CONSTRAINT journal_row_kind_declared
  CHECK (journal_row_kind IN (
    'EFFECT_AUTHORISATION',
    'JOURNAL_ATTESTATION',
    -- `30 §5.7`, `30 §5.1` item 5, `I17f(b)`. The control plane's own declaration that it
    -- observes the mirror unreachable. `30 §5.7` on what it is worth: "Yes, in both
    -- directions. It can be emitted falsely, and its non-arrival is definitionally
    -- indistinguishable from the condition it declares."
    'AUDIT_MIRROR_DEGRADED',
    -- `30 §5.7.1` replay protection: "a `signal_id` already consumed cannot re-enter the
    -- state machine."
    'MIRROR_CORROBORATION_CONSUMED',
    -- `30 §5.7.2` item 7.
    'DEGRADED_MODE_OVERRIDE_EVENT'
  ));

ALTER TABLE effect_journal
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
 * The per-kind shape. The two ACCEPTED arms are reproduced column by column with the S1H
 * columns added as REQUIRED-ABSENT, which is how 0008 extended 0007's arm: an accepted row
 * kind must not silently acquire a permissible new field.
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

      WHEN 'AUDIT_MIRROR_DEGRADED' THEN
             mirror_declaration_id          IS NOT NULL
         AND mirror_declaration_event       IS NOT NULL
         AND mirror_observed_reason         IS NOT NULL
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

      ELSE FALSE
    END
  );

-- The declared enumerations for the new discriminators. `30 §5.7.2` item 7 names the seven
-- override events; the declaration is closed so an unnamed eighth cannot be journaled.
ALTER TABLE effect_journal
  ADD CONSTRAINT journal_mirror_declaration_event_declared
    CHECK (mirror_declaration_event IS NULL
           OR mirror_declaration_event IN ('OPENED', 'CLOSED')),
  ADD CONSTRAINT journal_override_event_declared
    CHECK (override_event IS NULL OR override_event IN (
      'REQUESTED', 'GRANTED', 'SECOND_APPROVED',
      'ALLOWANCE_TAKEN', 'EXHAUSTED', 'EXPIRED', 'REVOKED')),
  -- `30 §5.7.1`'s `reason` enum, verbatim and closed.
  ADD CONSTRAINT journal_corroboration_reason_declared
    CHECK (corroboration_reason IS NULL OR corroboration_reason IN (
      'ATTESTATION_STALL', 'PUSH_PATH_UNREACHABLE', 'STORE_WRITE_REJECTED'));


/*
 * The declared field orders for the three new kinds, appended to 0008's dispatch.
 *
 * BRANCHES 1 AND 2 ARE 0007's AND 0008's FUNCTIONS TO THE BYTE. Same domain tags, same
 * field orders, same `acos_jcs1_*` calls. Every row already chained recomputes to the
 * `row_hash` it holds, and the ACCEPTED `journal-sequencing.test.ts` and
 * `vc-a3-cross-implementation.test.ts` oracles still discriminate.
 *
 * BRANCHES 3, 4 AND 5 are declared here for the first time, exactly as 0008 declared the
 * attestation's order for the first time. `30 §5.3` requires the order to be "declared per
 * row kind, in the specification"; the specification for these three kinds is
 * `docs/implementation/S1H-contract.md §4`, and `S1H-owner-clarifications.md` records that
 * the architecture mandates the JOURNALING of these facts (`30 §5.7`, `§5.7.1`, `§5.7.2`
 * item 7) without declaring a byte order for them, so the order is an implementation
 * declaration and not an architecture quotation.
 *
 * The audit plane transcribes the same three orders INDEPENDENTLY in `A0002`, and
 * `mirror-journal-rows.test.ts` judges both against a hand-authored fourth reading in
 * `tests/support/jcs1Oracle.ts` — never against each other.
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

  END;
$fn$;


/*
 * ---------------------------------------------------------------------------------
 * A DEFECT CARRIED IN FROM S1G, CLOSED HERE — `S1H-C4`.
 *
 * 0007's immutability trigger compares an EXPLICIT column list with `mirrored_at`
 * normalised away. 0008 added `attested_max_journal_seq`, `attested_row_count` and
 * `attested_head_hash` and DID NOT extend that list, so an `UPDATE` touching only those
 * three columns passed the outer `(NEW.*) IS DISTINCT FROM (OLD.*)` test and then compared
 * EQUAL on the inner list — no exception, mutation allowed. The attested prefix of a
 * chained journal row was mutable in the control database, which is the rewrite `I41` and
 * `30 §5.5` case 5 exist to make impossible.
 *
 * The repair is not "add three more columns to the list", because a sixth migration adding
 * a seventh column would reopen it. The comparison is now over EVERY column with
 * `mirrored_at` removed, so the guard is total by construction and a future `ALTER TABLE`
 * cannot narrow it by omission.
 *
 * This is STRICTLY MORE REFUSING than the accepted trigger — the one permitted update,
 * `mirrored_at`, is still permitted, and every previously refused update is still refused.
 * `to_jsonb` renders `numeric` through its own text output, so `25.0` and `25.00` remain
 * distinguishable here exactly as `ACOS-JCS-1` requires them to be.
 * ---------------------------------------------------------------------------------
 */
CREATE OR REPLACE FUNCTION effect_journal_immutable_except_mirrored_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'APPEND_ONLY_TABLE_effect_journal'
      USING ERRCODE = 'ACS33', DETAIL = 'DELETE on effect_journal is refused';
  END IF;
  IF (to_jsonb(NEW) - 'mirrored_at') IS DISTINCT FROM (to_jsonb(OLD) - 'mirrored_at') THEN
    RAISE EXCEPTION 'JOURNAL_ROW_IMMUTABLE'
      USING ERRCODE = 'ACS33',
            DETAIL  = 'only mirrored_at may be updated on effect_journal (30 §5.2)';
  END IF;
  RETURN NEW;
END;
$$;


-- =================================================================================
-- PART 2 — `I56`: STATUTORY-CLOCK PROVENANCE
--
-- `30 §9.1`, verbatim:
--
--     Clock { id, statute, case_ref, started_at, deadline_at,
--             source_record_ref }          // MANDATORY, RECORD grade
--
--   "`I56` (RECORD-grade): a clock may be created, extended or restarted ONLY by citing a
--    RECORD-grade fact — the processor's refund request object, the GDPR erasure request as
--    received at the ingress, the platform's own dispute record. NO OBSERVATION, NO CLAIM,
--    NO `DECISION_DELEGATED` FACT MAY START A CLOCK, and no model-authored summary may."
--
-- Registry `I56` enforcement: "DB (not-null + FK to the retained artifact) + RUNTIME
-- (deterministic detector)", and the S1 leg is the SCHEMA.
--
-- Why the clock is here at all: `30 §5.1` precedence row 3 is the ONLY relaxation in the
-- architecture and `clock_bearing` is its operand. `24 §3` K10: a model "may not create a
-- clock, or influence the fact a clock cites." A boolean parameter would have made the
-- lever a request field.
-- =================================================================================

/*
 * The retained RECORD-grade artifact a clock may cite.
 *
 * The four `kind` values are `I56`'s own enumeration — "a processor dispute webhook, a
 * retained raw inbound message with its content hash, a carrier or regulator record, or a
 * signed owner action" — and the set is CLOSED, so a kind the registry does not name has
 * no insert path rather than failing a later check.
 *
 * `content_hash` is mandatory on every kind, not only on the inbound-message kind, because
 * `I26`'s rule — "every RECORD-grade fact resolves to a retained vendor response with a
 * matching content hash" — is what makes "retained" mean something.
 *
 * WHAT IS DELIBERATELY ABSENT: any column a model or a worker could write. `provenance`
 * records the grade and the CHECK admits `RECORD` alone, so there is no row shape in which
 * an OBSERVATION, a CLAIM or a `DECISION_DELEGATED` fact is storable here at all. `I56`'s
 * negative control — a triage worker classifying every case as a clock-bearing refund —
 * therefore has nothing to cite, which is the structural form of the property.
 */
CREATE TABLE retained_source_record (
  company_id       TEXT        NOT NULL REFERENCES company(company_id),
  source_record_id TEXT        NOT NULL,

  kind             TEXT        NOT NULL,
  provenance       TEXT        NOT NULL,

  -- The retained bytes' digest. `I26`.
  content_hash     BYTEA       NOT NULL,
  -- Who or what the record came FROM, outside ACOS. Never a principal of this system.
  external_ref     TEXT        NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (company_id, source_record_id),

  CONSTRAINT retained_source_record_kind_declared CHECK (kind IN (
    'PROCESSOR_DISPUTE_WEBHOOK',
    'RETAINED_RAW_INBOUND_MESSAGE',
    'CARRIER_OR_REGULATOR_RECORD',
    'SIGNED_OWNER_ACTION'
  )),
  -- `I56`: "No OBSERVATION, no CLAIM, no `DECISION_DELEGATED` fact may start a clock."
  -- Enforced by there being no other admissible grade in this table.
  CONSTRAINT retained_source_record_is_record_grade CHECK (provenance = 'RECORD'),
  CONSTRAINT retained_source_record_hash_length CHECK (length(content_hash) = 32)
);

CREATE FUNCTION retained_source_record_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE_retained_source_record'
    USING ERRCODE = 'ACS33',
          DETAIL  = 'a retained RECORD-grade artifact is immutable (I26, I56)';
END;
$$;

CREATE TRIGGER retained_source_record_immutable
  BEFORE UPDATE OR DELETE ON retained_source_record
  FOR EACH ROW EXECUTE FUNCTION retained_source_record_append_only();

/*
 * The statutory clock. `30 §9.1`'s shape, with `source_record_ref` as a NOT NULL FOREIGN
 * KEY — which is registry `I56`'s declared enforcement, and which is why a clock cannot be
 * created without a retained RECORD-grade artifact existing first.
 *
 * `closed_at` is the liveness discriminator. `30 §5.1` row 3 reads "a LIVE statutory
 * clock", so a closed clock is not an operand of the relaxation.
 *
 * ON `30 §26`-CLASS VOLUME RULES — TA-08, AND WHY THEY ARE NOT HERE.
 * `phase2-v1.3-lower-severity-register.md` TA-08 schedules "at most one live clock per
 * `(case_ref, statute)`", the duplicate-`source_record_ref` collapse rule and the
 * per-window anomaly bound as a LATER MVP SLICE (S5), and states in the same row that
 * "`I56`'s schema leg is S1 and is unaffected; the bound is about live clocks, which land
 * at S5." Those three rules are therefore NOT normative at S1 and are not invented here.
 * `S1H-result.md §9` reports them deferred with that citation.
 */
CREATE TABLE statutory_clock (
  company_id        TEXT        NOT NULL REFERENCES company(company_id),
  clock_id          TEXT        NOT NULL,

  statute           TEXT        NOT NULL,
  case_ref          TEXT        NOT NULL,
  started_at        TIMESTAMPTZ NOT NULL,
  deadline_at       TIMESTAMPTZ NOT NULL,
  closed_at         TIMESTAMPTZ,

  -- `30 §9.1`: "MANDATORY, RECORD grade". Registry `I56`: "DB (not-null + FK to the
  -- retained artifact)".
  source_record_ref TEXT        NOT NULL,

  PRIMARY KEY (company_id, clock_id),
  FOREIGN KEY (company_id, source_record_ref)
    REFERENCES retained_source_record(company_id, source_record_id),

  -- `24 §3` K10 names the statutes: "GDPR 72h / 1 month, CCPA 45d, FTC 30d and 7 working
  -- days". Closed, so a statute nobody declared cannot buy a row-3 relaxation.
  CONSTRAINT statutory_clock_statute_declared CHECK (statute IN (
    'GDPR_ART_33_72H',
    'GDPR_ART_12_3_ONE_MONTH',
    'CCPA_45D',
    'FTC_30D',
    'FTC_7_WORKING_DAYS'
  )),
  CONSTRAINT statutory_clock_deadline_after_start CHECK (deadline_at > started_at)
);

CREATE INDEX statutory_clock_live ON statutory_clock (company_id, case_ref)
  WHERE closed_at IS NULL;


-- =================================================================================
-- PART 3 — THE CONTROL-SIDE DECLARATION
--
-- `30 §5.6`: `UNCORROBORATED_STALL` is entered when "control plane observes the mirror
-- unreachable; no valid, unexpired `MirrorInputStallSignal` is held".
-- `30 §5.1` item 5: the observation raises `AUDIT_MIRROR_DEGRADED` at CRITICAL.
-- `I17f(b)`: an audit-published stall with NO corresponding journaled declaration raises
-- `ATTESTATION_DIVERGENCE`, so the declaration must be a JOURNAL ROW that reaches the
-- mirror — which is why Part 1 makes it one.
-- =================================================================================

CREATE TABLE mirror_declaration (
  company_id         TEXT        NOT NULL REFERENCES company(company_id),
  declaration_id     TEXT        NOT NULL,

  -- What the control plane observed. `30 §5.7` row 1: "Mirror push acknowledgement
  -- timeout | internal | Yes — trivially. WHICH IS WHY IT ONLY REACHES
  -- `UNCORROBORATED_STALL`, THE STRICTER STATE."
  observed_reason    TEXT        NOT NULL,

  opened_at          TIMESTAMPTZ NOT NULL,
  closed_at          TIMESTAMPTZ,

  -- The journal rows that recorded the two transitions. NOT NULL on open, because a
  -- declaration with no journal row is `28`'s "unaudited mutable boolean".
  opened_journal_seq BIGINT      NOT NULL,
  closed_journal_seq BIGINT,

  PRIMARY KEY (company_id, declaration_id),

  CONSTRAINT mirror_declaration_reason_declared CHECK (observed_reason IN (
    'PUSH_ACK_TIMEOUT',
    'PUSH_PATH_UNREACHABLE',
    'AUDIT_STORE_WRITE_REJECTED'
  )),
  CONSTRAINT mirror_declaration_close_is_complete
    CHECK ((closed_at IS NULL) = (closed_journal_seq IS NULL)),
  CONSTRAINT mirror_declaration_closes_after_opening
    CHECK (closed_at IS NULL OR closed_at >= opened_at)
);

-- At most one OPEN declaration per company. A second concurrent declaration would make
-- "is a declaration open" a question with two answers, and the state machine reads it as
-- a single operand.
CREATE UNIQUE INDEX mirror_declaration_one_open_per_company
  ON mirror_declaration (company_id) WHERE closed_at IS NULL;


-- =================================================================================
-- PART 4 — THE CONSUMED CORROBORATION SIGNALS
--
-- `30 §5.7.1`, the contract, and every field below is one of its fields.
--
-- REPLAY PROTECTION, verbatim: "`signal_id` is recorded in the journal on consumption; a
-- `signal_id` already consumed cannot re-enter the state machine."
--
-- THE CONTROL PLANE CANNOT MINT ONE, verbatim: "Structurally unavailable to the control
-- plane: it holds no private key." This table is the control plane's record of signals it
-- FETCHED AND VERIFIED. It is not the signal's origin — that is `audit_mirror_input_stall`
-- on the audit server, which the control plane holds no INSERT on (`A0002`).
--
-- `expires_at` and `observed_at` are stored so `§5.7.1`'s freshness rule can be re-evaluated
-- at EVERY state evaluation from durable state after a restart, rather than only at the
-- instant of consumption.
-- =================================================================================

CREATE TABLE mirror_corroboration (
  company_id                   TEXT        NOT NULL REFERENCES company(company_id),
  -- `30 §5.7.1`: "unique per issuance; never reused".
  signal_id                    TEXT        NOT NULL,

  interval_start               TIMESTAMPTZ NOT NULL,
  observed_at                  TIMESTAMPTZ NOT NULL,
  expires_at                   TIMESTAMPTZ NOT NULL,
  reason                       TEXT        NOT NULL,
  last_attestation_seq         BIGINT      NOT NULL,
  -- Nullable, and NULL means "no attestation has ever been received". `S1H-C5`; `A0002`
  -- carries the same nullability on the issuing side, for the same reason: a fabricated
  -- timestamp inside a signed artifact is worse than an honest absence.
  last_attestation_received_at TIMESTAMPTZ,
  audit_instance_id            TEXT        NOT NULL,

  -- `30 §5.7.1`: "Ed25519 over `ACOS-JCS-1` canonical bytes of the fields above."
  -- Retained so a later evaluation re-verifies rather than trusting this row's existence.
  signature                    BYTEA       NOT NULL,

  consumed_at                  TIMESTAMPTZ NOT NULL,
  consumed_journal_seq         BIGINT      NOT NULL,

  PRIMARY KEY (company_id, signal_id),

  CONSTRAINT mirror_corroboration_reason_declared CHECK (reason IN (
    'ATTESTATION_STALL', 'PUSH_PATH_UNREACHABLE', 'STORE_WRITE_REJECTED')),
  -- `30 §5.7.1`: "`expires_at` — observed_at + max_age", `max_age` = 5 minutes.
  -- Enforced here so a signal whose two timestamps disagree with the declared max_age
  -- cannot be recorded even if a verifier were bypassed.
  CONSTRAINT mirror_corroboration_expiry_is_max_age
    CHECK (expires_at = observed_at + INTERVAL '5 minutes'),
  CONSTRAINT mirror_corroboration_signature_length CHECK (length(signature) = 64),
  CONSTRAINT mirror_corroboration_attestation_seq_non_negative
    CHECK (last_attestation_seq >= 0)
);

CREATE FUNCTION mirror_corroboration_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE_mirror_corroboration'
    USING ERRCODE = 'ACS33',
          DETAIL  = 'a consumed MirrorInputStallSignal is immutable: rewriting expires_at '
                    'is 30 §5.7.1''s "minting and extension" case';
END;
$$;

CREATE TRIGGER mirror_corroboration_immutable
  BEFORE UPDATE OR DELETE ON mirror_corroboration
  FOR EACH ROW EXECUTE FUNCTION mirror_corroboration_append_only();


-- =================================================================================
-- PART 5 — THE RESOLVED STATE
--
-- The durable reading. `38`'s crash matrix and `mirror-state-durability.test.ts` assert
-- that authority reconstructs from Parts 3, 4 and 6 alone, and that this row never
-- disagrees with a fresh derivation.
-- =================================================================================

CREATE TABLE mirror_state (
  company_id           TEXT        NOT NULL PRIMARY KEY REFERENCES company(company_id),

  state                TEXT        NOT NULL,
  evaluated_at         TIMESTAMPTZ NOT NULL,

  -- The operands the resolution rested on, for forensics. NEVER read as authority: the
  -- derivation reads Parts 3 and 4 directly.
  basis_declaration_id TEXT,
  basis_signal_id      TEXT,

  CONSTRAINT mirror_state_declared CHECK (state IN (
    'NORMAL', 'UNCORROBORATED_STALL', 'CORROBORATED_DEGRADED')),
  -- `30 §5.6`: `CORROBORATED_DEGRADED` is entered only when a signal is held. A resolved
  -- row claiming it with no signal basis is refused by the schema, not only by the code.
  CONSTRAINT mirror_state_corroborated_names_a_signal
    CHECK (state <> 'CORROBORATED_DEGRADED' OR basis_signal_id IS NOT NULL),
  -- And `NORMAL` is the state in which no declaration is open.
  CONSTRAINT mirror_state_normal_names_no_declaration
    CHECK (state <> 'NORMAL' OR basis_declaration_id IS NULL),
  FOREIGN KEY (company_id, basis_declaration_id)
    REFERENCES mirror_declaration(company_id, declaration_id),
  FOREIGN KEY (company_id, basis_signal_id)
    REFERENCES mirror_corroboration(company_id, signal_id)
);


-- =================================================================================
-- PART 6 — `DegradedModeOverride` AND `I63`
--
-- `30 §5.7.2`'s entity, field for field. `51 §3.6`'s eight quantities, transcribed once
-- into `degraded_mode_override_limits()` so the CHECKs, the trigger and the application
-- read one declaration.
--
-- THE OWNER-TIER APPROVER SET is control artifact class 25 (`50 §2`), alongside the eight
-- quantities. It is the ACCEPTED `principal` table with `kind = 'OWNER'` plus
-- `principal_key`, which is the S1E mechanism: `26 §3` rule 1, "each hop is signed by the
-- delegating principal's key, HELD BY THE KERNEL, NOT BY THE MODEL". So owner authority
-- here is a real Ed25519 signature under a key in kernel state, verified by
-- `src/kernel/mirror/degradedModeOverride.ts` — not an `isOwner` parameter, which has no
-- argument position anywhere in this slice.
-- =================================================================================

/*
 * `51 §3.6`, `DESIGN LIMIT — OWNER SIGNED`, non-production MVP values, transcribed:
 *
 *   | `max_override_duration`                        | 24 hours   |
 *   | `max_override_effect_count`                    | 5          |
 *   | `max_override_monetary_exposure`               | $50.00     |
 *   | `max_override_count(30-day rolling)`           | 3          |
 *   | `max_cumulative_override_hours(30-day rolling)`| 72 hours   |
 *   | `max_cumulative_override_effects(30-day rolling)` | 8       |
 *   | `max_cumulative_override_monetary(30-day rolling)`| $100.00 |
 *   | `second_approver_required_from`                | the 2nd    |
 */
CREATE FUNCTION degraded_mode_override_limits()
RETURNS TABLE (
  max_override_duration              INTERVAL,
  max_override_effect_count          BIGINT,
  max_override_monetary_exposure     NUMERIC(18,2),
  max_override_count                 BIGINT,
  max_cumulative_override_hours      INTERVAL,
  max_cumulative_override_effects    BIGINT,
  max_cumulative_override_monetary   NUMERIC(18,2),
  second_approver_required_from      BIGINT,
  composition_window                 INTERVAL
)
LANGUAGE sql IMMUTABLE AS $fn$
  SELECT INTERVAL '24 hours',
         5::BIGINT,
         50.00::NUMERIC(18,2),
         3::BIGINT,
         INTERVAL '72 hours',
         8::BIGINT,
         100.00::NUMERIC(18,2),
         2::BIGINT,
         INTERVAL '30 days';
$fn$;

/*
 * THE ENTITY. `30 §5.7.2`'s declaration, with every bound that section states as a CHECK.
 *
 * WHAT THIS TABLE STRUCTURALLY CANNOT DO — `30 §5.7.2` semantics item 1, verbatim: "It
 * changes no ceiling. [...] The override releases a DISPATCH GATE, never an exposure gate.
 * `MAL_total` is unchanged by an override's existence."
 *
 * There is therefore NO column here naming a window, a grant, a window instance, a
 * reservation, a `per_action_max` or a `MAL` term, and no foreign key into
 * `window_registry`, `window_balance`, `authority_grant` or `exposure_reservation`.
 * `monetary_exposure_cap` is a CEILING ON THE OVERRIDE'S OWN CONSUMPTION and is bounded by
 * `51 §3.6`'s $50.00 — it cannot be written upward into anything.
 * `override-cannot-widen-ceilings.test.ts` asserts that as a schema, a type and a source
 * property, so a compromised owner-action handler has no field to turn a mirror override
 * into a budget override.
 */
CREATE TABLE degraded_mode_override (
  company_id             TEXT          NOT NULL REFERENCES company(company_id),
  override_id            TEXT          NOT NULL,

  requested_at           TIMESTAMPTZ   NOT NULL,
  requested_by           TEXT          NOT NULL,
  granted_at             TIMESTAMPTZ,
  granted_by             TEXT,

  -- `30 §5.7.2` item 9: "a registered OWNER-tier principal that is not `granted_by`".
  second_approver        TEXT,
  second_approved_at     TIMESTAMPTZ,

  -- "explicit enumeration from the action catalogue"
  effect_classes         TEXT[]        NOT NULL,
  -- "⊆ { COMPENSABLE, REVERSIBLE }"
  recoverability_classes TEXT[]        NOT NULL,
  -- "⊆ { 3, 4 } — see the scope rule"
  precedence_rows        INTEGER[]     NOT NULL,

  starts_at              TIMESTAMPTZ   NOT NULL,
  expires_at             TIMESTAMPTZ   NOT NULL,

  effect_count_cap       BIGINT        NOT NULL,
  effects_dispatched     BIGINT        NOT NULL DEFAULT 0,
  monetary_exposure_cap  NUMERIC(18,2) NOT NULL,
  monetary_dispatched    NUMERIC(18,2) NOT NULL DEFAULT 0.00,

  reason                 TEXT          NOT NULL,
  -- `30 §5.7.2`: "NOT NULL FK — the open incident it responds to".
  incident_ref           BIGINT        NOT NULL REFERENCES incident(incident_id),

  status                 TEXT          NOT NULL,

  PRIMARY KEY (company_id, override_id),

  FOREIGN KEY (company_id, requested_by)   REFERENCES principal(company_id, principal_id),
  FOREIGN KEY (company_id, granted_by)     REFERENCES principal(company_id, principal_id),
  FOREIGN KEY (company_id, second_approver) REFERENCES principal(company_id, principal_id),

  CONSTRAINT override_status_declared CHECK (status IN (
    'REQUESTED', 'ACTIVE', 'EXHAUSTED', 'EXPIRED', 'REVOKED')),

  -- ------------------------------------------------------------------------------
  -- `I63` LEG (a) — THE PER-OVERRIDE BOUND, AS DATABASE CHECKS.
  --
  -- Registry `I63`: "DB (CHECK on the per-override counters + trigger on the rolling
  -- aggregate, evaluated in the granting and the dispatching transaction)".
  -- ------------------------------------------------------------------------------

  -- `30 §5.7.2`'s SCOPE RULE, and it is the structural one: "`recoverability_classes[]`
  -- therefore excludes `IRRECOVERABLE` STRUCTURALLY AT MVP, NOT BY POLICY: there is no
  -- grant path that admits it."
  CONSTRAINT override_recoverability_classes_bounded
    CHECK (recoverability_classes <@ ARRAY['COMPENSABLE', 'REVERSIBLE']::TEXT[]
           AND cardinality(recoverability_classes) > 0),
  -- "An override may restore precedence rows 3 and 4 only. It may NEVER restore row 1
  -- (IRRECOVERABLE) or row 2 (above-floor, not clock-bearing)."
  CONSTRAINT override_precedence_rows_bounded
    CHECK (precedence_rows <@ ARRAY[3, 4]::INTEGER[]
           AND cardinality(precedence_rows) > 0),
  CONSTRAINT override_effect_classes_nonempty
    CHECK (cardinality(effect_classes) > 0),

  -- "`expires_at` − `starts_at` ≤ `max_override_duration`" — 24 hours.
  CONSTRAINT override_duration_bounded
    CHECK (expires_at > starts_at
           AND expires_at - starts_at <= INTERVAL '24 hours'),
  -- `51 §3.6`: `max_override_effect_count` 5, `max_override_monetary_exposure` $50.00.
  CONSTRAINT override_effect_count_cap_bounded
    CHECK (effect_count_cap > 0 AND effect_count_cap <= 5),
  CONSTRAINT override_monetary_cap_bounded
    CHECK (monetary_exposure_cap >= 0.00 AND monetary_exposure_cap <= 50.00),
  -- "reaching either cap moves the override to `EXHAUSTED` immediately" — so the counters
  -- can reach the cap and never pass it.
  CONSTRAINT override_effects_within_cap
    CHECK (effects_dispatched >= 0 AND effects_dispatched <= effect_count_cap),
  CONSTRAINT override_monetary_within_cap
    CHECK (monetary_dispatched >= 0.00 AND monetary_dispatched <= monetary_exposure_cap),

  -- A grant is a complete act or it is not a grant.
  CONSTRAINT override_grant_is_complete
    CHECK ((granted_at IS NULL) = (granted_by IS NULL)),
  CONSTRAINT override_second_approval_is_complete
    CHECK ((second_approved_at IS NULL) = (second_approver IS NULL)),
  -- `30 §5.7.2` item 9: the second approver "is not `granted_by`".
  CONSTRAINT override_second_approver_is_distinct
    CHECK (second_approver IS NULL OR second_approver <> granted_by),
  CONSTRAINT override_active_is_granted
    CHECK (status = 'REQUESTED' OR granted_by IS NOT NULL)
);

CREATE INDEX degraded_mode_override_by_start
  ON degraded_mode_override (company_id, starts_at);

/*
 * ---------------------------------------------------------------------------------
 * `I63` LEG (b) — THE AGGREGATE BOUND. THE LOAD-BEARING ONE.
 *
 * Registry `I63(b)`, verbatim: "Over any rolling 30-day window per company, the count,
 * cumulative hours, cumulative effects and cumulative monetary exposure of ALL
 * `DegradedModeOverride` RECORDS are each within the limits declared in `51 §3.6`."
 *
 * `51 §3.6`'s own worked composition is what this must reproduce: "Three overrides is the
 * count cap; 3 × 24 h = 72 h, exactly the hours cap; 3 × 5 = 15 effects, cut to 8 by the
 * aggregate; 3 × $50.00 = $150.00, cut to $100.00 by the aggregate. THE AGGREGATE LEGS
 * BIND BEFORE THE PER-OVERRIDE LEGS ON BOTH CONSUMABLE QUANTITIES."
 *
 * WHICH QUANTITY BINDS IN WHICH TRANSACTION. Count and hours are fixed at grant, so they
 * bind in the granting transaction. Effects and monetary are `51 §3.6`'s "consumable
 * quantities" and are the DISPATCHED counters, so they bind in the dispatching
 * transaction. `I63`'s enforcement column names both transactions and one trigger covers
 * them, because it fires on INSERT and on UPDATE.
 *
 * "ANY ROLLING 30-DAY WINDOW", IMPLEMENTED LITERALLY RATHER THAN AS ONE WINDOW.
 * A single look-back from the new row would miss a violating window that opens at an
 * earlier override — which is exactly the "expire and recreate" evasion `30 §5.7.2` item
 * 10 names. So every candidate window is checked: for a finite set of records the maximal
 * windows are those beginning at a record's own `starts_at`, and checking all of them
 * checks all windows. `tests/support/overrideAggregateOracle.ts` computes the same
 * quantity by a SECOND IMPLEMENTATION written from `51 §3.6`, which `VC-A2f` requires
 * verbatim: "against an aggregate computed by a second implementation from `51 §3.6`".
 *
 * "ALL RECORDS" INCLUDES `REVOKED` AND `EXPIRED` ONES. The registry says "all", and the
 * fail-closed reading of a consumption budget is that spending it and then revoking the
 * instrument does not refund it. `S1H-owner-clarifications.md S1H-C3` records that
 * reading.
 * ---------------------------------------------------------------------------------
 */
CREATE FUNCTION degraded_mode_override_aggregate_bound() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_limits   RECORD;
  v_start    TIMESTAMPTZ;
  v_count    BIGINT;
  v_hours    INTERVAL;
  v_effects  BIGINT;
  v_monetary NUMERIC(18,2);
BEGIN
  SELECT * INTO v_limits FROM degraded_mode_override_limits();

  -- Every maximal candidate window begins at some record's own `starts_at`.
  FOR v_start IN
    SELECT DISTINCT starts_at FROM degraded_mode_override
     WHERE company_id = NEW.company_id
    ORDER BY 1
  LOOP
    SELECT count(*),
           COALESCE(sum(expires_at - starts_at), INTERVAL '0'),
           COALESCE(sum(effects_dispatched), 0),
           COALESCE(sum(monetary_dispatched), 0.00)
      INTO v_count, v_hours, v_effects, v_monetary
      FROM degraded_mode_override
     WHERE company_id = NEW.company_id
       AND starts_at >= v_start
       AND starts_at <  v_start + v_limits.composition_window;

    IF v_count > v_limits.max_override_count THEN
      RAISE EXCEPTION 'I63_COMPOSITION_COUNT'
        USING ERRCODE = 'ACS63',
              DETAIL  = format('%s overrides in the 30-day window from %s; the limit is %s '
                               '(51 §3.6 max_override_count)',
                               v_count, v_start, v_limits.max_override_count);
    END IF;
    IF v_hours > v_limits.max_cumulative_override_hours THEN
      RAISE EXCEPTION 'I63_COMPOSITION_HOURS'
        USING ERRCODE = 'ACS63',
              DETAIL  = format('%s of override duration in the 30-day window from %s; the '
                               'limit is %s (51 §3.6 max_cumulative_override_hours)',
                               v_hours, v_start, v_limits.max_cumulative_override_hours);
    END IF;
    IF v_effects > v_limits.max_cumulative_override_effects THEN
      RAISE EXCEPTION 'I63_COMPOSITION_EFFECTS'
        USING ERRCODE = 'ACS63',
              DETAIL  = format('%s cumulative override effects in the 30-day window from '
                               '%s; the limit is %s (51 §3.6 '
                               'max_cumulative_override_effects)',
                               v_effects, v_start,
                               v_limits.max_cumulative_override_effects);
    END IF;
    IF v_monetary > v_limits.max_cumulative_override_monetary THEN
      RAISE EXCEPTION 'I63_COMPOSITION_MONETARY'
        USING ERRCODE = 'ACS63',
              DETAIL  = format('%s cumulative override exposure in the 30-day window from '
                               '%s; the limit is %s (51 §3.6 '
                               'max_cumulative_override_monetary)',
                               v_monetary, v_start,
                               v_limits.max_cumulative_override_monetary);
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- AFTER, not BEFORE: the aggregate must include the row being written, and a BEFORE
-- trigger on INSERT cannot see it. The transaction rolls back on the exception either way.
CREATE CONSTRAINT TRIGGER degraded_mode_override_aggregate
  AFTER INSERT OR UPDATE ON degraded_mode_override
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION degraded_mode_override_aggregate_bound();

/*
 * `30 §5.7.2` item 9 — THE SECOND-APPROVER RULE, verbatim:
 *
 *   "The FIRST override inside a rolling 30-day window requires the owner alone. EVERY
 *    SUBSEQUENT OVERRIDE INSIDE THAT WINDOW REQUIRES A DISTINCT SECOND APPROVER — a
 *    registered OWNER-tier principal that is not `granted_by`."
 *
 * `51 §3.6`: `second_approver_required_from` = "the 2nd override inside a rolling 30-day
 * window".
 *
 * THREE DISTINCTNESS TESTS, because two of them are the attack:
 *
 *   1. `second_approver <> granted_by` — the table CHECK above.
 *   2. Both must be `kind = 'OWNER'` and `status = 'ACTIVE'`, so an AI_ROLE, an ADAPTER, a
 *      KERNEL_SERVICE or an AUDIT_REVIEWER cannot approve. `30 §5.7.2`: "a registered
 *      OWNER-tier principal".
 *   3. Their `principal_key.public_key` values must DIFFER. A principal row is a display
 *      identity; the key is the credential. Two rows sharing one key are one credential
 *      under two names, which is `§20`'s "same credential identity under another display
 *      name" and is refused here rather than in the application.
 *
 * `51 §3.6`'s honest consequence is preserved rather than engineered around: "at MVP
 * exactly one OWNER-tier principal is registered, so overrides 2 and 3 are STRUCTURALLY
 * UNAVAILABLE until a second approver is registered".
 */
CREATE FUNCTION degraded_mode_override_second_approver() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_limits    RECORD;
  v_ordinal   BIGINT;
  v_granter   RECORD;
  v_second    RECORD;
  v_key_count BIGINT;
BEGIN
  -- The rule governs GRANTED overrides. A REQUESTED row has not obtained anything.
  IF NEW.status = 'REQUESTED' THEN RETURN NEW; END IF;

  SELECT * INTO v_limits FROM degraded_mode_override_limits();

  -- Which override this is inside the rolling window that ENDS at its own start: the
  -- count of records whose `starts_at` lies in `(NEW.starts_at − 30 days, NEW.starts_at]`.
  SELECT count(*) INTO v_ordinal
    FROM degraded_mode_override
   WHERE company_id = NEW.company_id
     AND starts_at >  NEW.starts_at - v_limits.composition_window
     AND starts_at <= NEW.starts_at;

  IF v_ordinal >= v_limits.second_approver_required_from
     AND NEW.second_approver IS NULL THEN
    RAISE EXCEPTION 'I63_SECOND_APPROVER_REQUIRED'
      USING ERRCODE = 'ACS63',
            DETAIL  = format('override %s is number %s inside the rolling 30-day window '
                             'and 51 §3.6 requires a distinct second approver from the %s',
                             NEW.override_id, v_ordinal,
                             v_limits.second_approver_required_from);
  END IF;

  SELECT kind, status INTO v_granter FROM principal
   WHERE company_id = NEW.company_id AND principal_id = NEW.granted_by;
  IF v_granter.kind <> 'OWNER' OR v_granter.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'OVERRIDE_GRANTER_NOT_OWNER'
      USING ERRCODE = 'ACS63',
            DETAIL  = format('granted_by=%s is kind=%s status=%s; 30 §5.7.2 requires an '
                             'ACTIVE OWNER-tier principal',
                             NEW.granted_by, v_granter.kind, v_granter.status);
  END IF;

  IF NEW.second_approver IS NOT NULL THEN
    SELECT kind, status INTO v_second FROM principal
     WHERE company_id = NEW.company_id AND principal_id = NEW.second_approver;
    IF v_second.kind <> 'OWNER' OR v_second.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'OVERRIDE_SECOND_APPROVER_NOT_OWNER'
        USING ERRCODE = 'ACS63',
              DETAIL  = format('second_approver=%s is kind=%s status=%s',
                               NEW.second_approver, v_second.kind, v_second.status);
    END IF;

    -- Distinct CREDENTIAL, not merely a distinct row.
    SELECT count(DISTINCT public_key) INTO v_key_count FROM principal_key
     WHERE company_id = NEW.company_id
       AND principal_id IN (NEW.granted_by, NEW.second_approver);
    IF v_key_count <> 2 THEN
      RAISE EXCEPTION 'OVERRIDE_SECOND_APPROVER_SHARES_CREDENTIAL'
        USING ERRCODE = 'ACS63',
              DETAIL  = format('granted_by=%s and second_approver=%s resolve to %s '
                               'distinct registered keys; a second approver must be a '
                               'distinct credential, not a distinct display name',
                               NEW.granted_by, NEW.second_approver, v_key_count);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER degraded_mode_override_approvers
  AFTER INSERT OR UPDATE ON degraded_mode_override
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION degraded_mode_override_second_approver();

/*
 * `30 §5.7.2` item 3: "reaching either cap moves the override to `EXHAUSTED` immediately".
 *
 * A generated status was considered and rejected for the reason registry `I23` gives
 * against one: "v1.3 corrects v1.1's *generated status*, WHICH CANNOT BE
 * TRANSITION-CHECKED". So the status is a real column and this trigger enforces the
 * derivation on the way in, which leaves the transition set checkable.
 */
CREATE FUNCTION degraded_mode_override_exhaustion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'ACTIVE'
     AND (NEW.effects_dispatched >= NEW.effect_count_cap
          OR NEW.monetary_dispatched >= NEW.monetary_exposure_cap) THEN
    NEW.status := 'EXHAUSTED';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER degraded_mode_override_exhausts
  BEFORE INSERT OR UPDATE ON degraded_mode_override
  FOR EACH ROW EXECUTE FUNCTION degraded_mode_override_exhaustion();

/*
 * The counters never decrease and the scope never widens after the grant.
 *
 * Without this, `30 §5.7.2`'s caps would be a ceiling on a number the holder could reset —
 * which is the shape `I51`'s `reservation_no_increase` trigger exists to refuse on the
 * money path, applied here to the override's consumption.
 */
CREATE FUNCTION degraded_mode_override_monotonic() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.effects_dispatched < OLD.effects_dispatched
     OR NEW.monetary_dispatched < OLD.monetary_dispatched THEN
    RAISE EXCEPTION 'OVERRIDE_CONSUMPTION_DECREASED'
      USING ERRCODE = 'ACS63',
            DETAIL  = 'an override''s consumed counters are monotonic (30 §5.7.2 item 3)';
  END IF;
  IF ROW(NEW.company_id, NEW.override_id, NEW.effect_classes, NEW.recoverability_classes,
         NEW.precedence_rows, NEW.starts_at, NEW.expires_at, NEW.effect_count_cap,
         NEW.monetary_exposure_cap, NEW.incident_ref, NEW.requested_at, NEW.requested_by)
     IS DISTINCT FROM
     ROW(OLD.company_id, OLD.override_id, OLD.effect_classes, OLD.recoverability_classes,
         OLD.precedence_rows, OLD.starts_at, OLD.expires_at, OLD.effect_count_cap,
         OLD.monetary_exposure_cap, OLD.incident_ref, OLD.requested_at, OLD.requested_by)
  THEN
    RAISE EXCEPTION 'OVERRIDE_SCOPE_IMMUTABLE'
      USING ERRCODE = 'ACS63',
            DETAIL  = 'an override''s scope, time box and caps are fixed at creation; '
                      'widening them after the grant is a new override (51 §3.6, I63)';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER degraded_mode_override_scope_fixed
  BEFORE UPDATE ON degraded_mode_override
  FOR EACH ROW EXECUTE FUNCTION degraded_mode_override_monotonic();

CREATE FUNCTION degraded_mode_override_no_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'APPEND_ONLY_TABLE_degraded_mode_override'
    USING ERRCODE = 'ACS33',
          DETAIL  = 'deleting an override would remove it from I63''s rolling aggregate, '
                    'which is the composition evasion 30 §5.7.2 item 10 bounds';
END;
$$;

CREATE TRIGGER degraded_mode_override_undeletable
  BEFORE DELETE ON degraded_mode_override
  FOR EACH ROW EXECUTE FUNCTION degraded_mode_override_no_delete();


-- =================================================================================
-- PART 7 — THE JOURNAL EMITTERS
--
-- `30 §5.2`'s allocator and lock order, reused: `journal_counter(company_id)` taken
-- `FOR UPDATE`, the sequence derived inside that lock, the row inserted, the counter
-- advanced. None of these functions computes a chain value — the ACCEPTED
-- `effect_journal_chain` trigger from 0007 still owns `prev_hash` and `row_hash`, and
-- supplying either from here would raise `I17D_CALLER_SUPPLIED_CHAIN`.
--
-- Written as database functions rather than as TypeScript inserts for the reason
-- `emit_journal_attestation` was: the allocation and the lock are one indivisible act, and
-- an application that took the counter in one statement and inserted in another would make
-- `30 §5.2`'s "serialises all journal writes per company" an application convention.
-- =================================================================================

/*
 * The allocator, factored out because three emitters need it.
 *
 * `emit_journal_attestation` (0008) is DELIBERATELY NOT REWRITTEN TO USE IT. It is accepted
 * S1G code whose behaviour `vc-a1-transport-completeness.test.ts` pins; refactoring it here
 * would put an accepted, tested function's body inside an S1H change for no behavioural
 * gain. The two derive the sequence identically — `max(journal_seq) + 1` under the counter
 * lock — and `mirror-journal-rows.test.ts` asserts the two agree by interleaving an
 * attestation with a mirror row and checking the sequence is gap-free across both.
 */
CREATE FUNCTION journal_allocate_seq(p_company_id TEXT) RETURNS BIGINT
LANGUAGE plpgsql AS $fn$
DECLARE
  v_seq BIGINT;
BEGIN
  PERFORM 1 FROM journal_counter WHERE company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOURNAL_COUNTER_ABSENT'
      USING ERRCODE = 'ACS30', DETAIL = format('company=%s', p_company_id);
  END IF;

  SELECT COALESCE(max(journal_seq), 0) + 1 INTO v_seq
    FROM effect_journal WHERE company_id = p_company_id;

  UPDATE journal_counter SET next_seq = v_seq + 1 WHERE company_id = p_company_id;
  RETURN v_seq;
END;
$fn$;

/* `30 §5.7`'s `AUDIT_MIRROR_DEGRADED` row — the declaration itself. `I17f(b)`'s operand. */
CREATE FUNCTION emit_mirror_declaration(
  p_company_id      TEXT,
  p_declaration_id  TEXT,
  p_event           TEXT,
  p_observed_reason TEXT,
  p_occurred_at     TIMESTAMPTZ
) RETURNS BIGINT
LANGUAGE plpgsql AS $fn$
DECLARE
  v_seq BIGINT;
BEGIN
  v_seq := journal_allocate_seq(p_company_id);
  INSERT INTO effect_journal (
    company_id, journal_seq, journal_row_kind,
    mirror_declaration_id, mirror_declaration_event, mirror_observed_reason, occurred_at
  ) VALUES (
    p_company_id, v_seq, 'AUDIT_MIRROR_DEGRADED',
    p_declaration_id, p_event, p_observed_reason, p_occurred_at
  );
  RETURN v_seq;
END;
$fn$;

/* `30 §5.7.1`: "`signal_id` is recorded in the journal on consumption." */
CREATE FUNCTION emit_mirror_corroboration_consumed(
  p_company_id     TEXT,
  p_signal_id      TEXT,
  p_interval_start TIMESTAMPTZ,
  p_observed_at    TIMESTAMPTZ,
  p_expires_at     TIMESTAMPTZ,
  p_reason         TEXT,
  p_occurred_at    TIMESTAMPTZ
) RETURNS BIGINT
LANGUAGE plpgsql AS $fn$
DECLARE
  v_seq BIGINT;
BEGIN
  v_seq := journal_allocate_seq(p_company_id);
  INSERT INTO effect_journal (
    company_id, journal_seq, journal_row_kind,
    corroboration_signal_id, corroboration_interval_start, corroboration_observed_at,
    corroboration_expires_at, corroboration_reason, occurred_at
  ) VALUES (
    p_company_id, v_seq, 'MIRROR_CORROBORATION_CONSUMED',
    p_signal_id, p_interval_start, p_observed_at, p_expires_at, p_reason, p_occurred_at
  );
  RETURN v_seq;
END;
$fn$;

/*
 * `30 §5.7.2` item 7: "Creation, grant, second approval, each cap decrement, exhaustion,
 * expiry and revocation are journaled, **each as its own row**."
 *
 * THE CAP-DECREMENT EVENT IS NAMED `ALLOWANCE_TAKEN`, NOT `CLAIMED`. `25 §7` layer 4's
 * outbox owns the `CLAIMED` literal — `I36`'s at-most-once EXCLUSIVE CLAIM on an external
 * effect — and `local-authorisation-boundary.test.ts` forbids that literal anywhere in
 * `src/` until the outbox exists. What this event records is `§18`'s "pre-dispatch override
 * allowance", taken against a counter. NOTHING IS CLAIMED EXTERNALLY. `30 §5.7.2` names the
 * obligation and not the identifier, which `S1H-owner-clarifications.md S1H-C9` records.
 */
CREATE FUNCTION emit_degraded_mode_override_event(
  p_company_id  TEXT,
  p_override_id TEXT,
  p_event       TEXT,
  p_actor       TEXT,
  p_occurred_at TIMESTAMPTZ
) RETURNS BIGINT
LANGUAGE plpgsql AS $fn$
DECLARE
  v_seq BIGINT;
BEGIN
  v_seq := journal_allocate_seq(p_company_id);
  INSERT INTO effect_journal (
    company_id, journal_seq, journal_row_kind,
    override_id, override_event, override_actor, occurred_at
  ) VALUES (
    p_company_id, v_seq, 'DEGRADED_MODE_OVERRIDE_EVENT',
    p_override_id, p_event, p_actor, p_occurred_at
  );
  RETURN v_seq;
END;
$fn$;
