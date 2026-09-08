-- 0011 — the effect→case binding, and the claim's evidentiary statutory clock.
--
-- =================================================================================
-- WHAT THIS MIGRATION IS
--
-- `30 §9.2`, v1.3.4 (CSB-01), is the specification. It resolves `S1I-C1`, which S1I
-- reported as a STOP: `30 §5.1` item 4 row 3's operand is keyed on a `case_ref` and
-- v1.3.3 related a `case_ref` to nothing, so the operand was answerable only by a guess.
--
-- `30 §9.2`, the declaration this file enforces, verbatim in its load-bearing parts:
--
--     "**`effect.case_ref : CaseRef | NULL`.**
--      **KERNEL-OWNED. IMMUTABLE. NEVER MODEL-SUPPLIED.**
--      For a case-associated effect, `case_ref` is inherited from the authoritative
--      originating task [...] It MUST NOT come from any of: `ProposedIntent`; [the model's
--      sealed free-text field]; the dispatch payload; a free-text reason; a model
--      classification; a caller-supplied claim-time argument; inference from a customer
--      identifier; inference from a similar order; or an arbitrary resource lookup
--      selected at claim time."
--
-- ONE ITEM OF THAT LIST IS PARAPHRASED IN BRACKETS ABOVE, DELIBERATELY. `26 §2.0`'s field
-- is "NEVER parsed, NEVER interpreted as authority", and the accepted
-- `tests/canonicalisation/source-rules.test.ts` rule 1 permits its NAME in exactly three
-- modules so that a grep for it over `src/` finds only the seal and never a reader. A
-- verbatim quotation here would widen that exemption to a migration, which is a worse
-- outcome than a paraphrase — the unabridged list is in `30 §9.2.1`.
--
-- Registry `I64` and `I65` are the invariants. `I64`'s enforcement column reads "DB
-- (derived on insert from the authoritative task, plus the existing append-only trigger
-- on `effect`)"; `I65`'s reads "DB (evidence FK, company and case agreement, and
-- row-3-only presence)". THIS FILE IS BOTH.
-- =================================================================================
--
-- =================================================================================
-- WHY THE BINDING IS *DERIVED* RATHER THAN *CHECKED*
--
-- `§9.2.1`'s requirement is that the value cannot come from a caller. There are two
-- shapes for that:
--
--   (a) accept a parameter and CHECK it against the authoritative source;
--   (b) accept no parameter at all and DERIVE the value from the authoritative source.
--
-- (a) is a check one code path can skip, and it leaves a parameter on the surface for a
-- later caller to find. (b) leaves nothing to skip: `effect_derive_case_ref` OVERWRITES
-- whatever `NEW.case_ref` holds with the value read from `authority_task`, on every
-- INSERT, unconditionally. A caller that supplies a case is not refused — it is
-- IGNORED, which is the stronger property, because a refusal tells an attacker the field
-- exists and a silent overwrite means there is no field to attack.
--
-- `36 §0`'s rule about single-mechanism properties still applies, and the second
-- mechanism is the one that was already here: `effect` carries `acos_append_only`, so
-- there is no UPDATE path to the column at all. Derivation closes the write; append-only
-- closes the rewrite.
-- =================================================================================

-- ---------------------------------------------------------------------------------
-- PART 1 — `task.case_ref`, the authoritative source.
--
-- `24 §3` K7 owns task records, and v1.3.4 adds to its invariants: "a task carries
-- `task.case_ref` — the statutory or customer case it runs under, or NULL. It is kernel
-- state, set from the authoritative trigger that created the task (an ingress case, an
-- escalation, a `RemedyObligation`'s preserved lineage)."
--
-- NULLABLE, because `§9.2.3` makes the absence of a case a declared ordinary state
-- rather than an error: "An effect not associated with a statutory or customer case has
-- no case binding, and none is invented for it."
--
-- NO FOREIGN KEY TO `statutory_clock`. A case is not a clock. A case may have zero live
-- clocks, several, or clocks that open and close over its life — `§9.2.4` is explicit
-- that the clock state is read at the decision instant and not frozen — so a foreign key
-- from the case binding to a clock would be the post-hoc mutable mapping `§9.2.2`
-- forbids, wearing a constraint's clothing.
-- ---------------------------------------------------------------------------------
ALTER TABLE authority_task
  ADD COLUMN case_ref TEXT;

COMMENT ON COLUMN authority_task.case_ref IS
  'v1.3.4 CSB-01 / 30 §9.2.1. The statutory or customer case this task runs under, or '
  'NULL. Kernel state: 24 §3 K7 forbids a model to set, supply, change or influence it. '
  'Every effect authorised under this task inherits it.';


-- ---------------------------------------------------------------------------------
-- PART 2 — `effect.case_ref`, derived and immutable.
-- ---------------------------------------------------------------------------------
ALTER TABLE effect
  ADD COLUMN case_ref TEXT;

COMMENT ON COLUMN effect.case_ref IS
  'v1.3.4 CSB-01 / 30 §9.2.1. Kernel-owned, immutable, never model-supplied. Derived on '
  'INSERT from authority_task.case_ref via authorisation.task_id and never from a '
  'parameter. 30 §5.1 row 3 reads its statutory clocks by this key.';

/*
 * THE DERIVATION. `30 §9.2.2`'s lifetime rule, enforced.
 *
 * "The binding is established no later than the creation of the authoritative local
 *  effect, in the same transaction that creates it.
 *      `task.case_ref` → kernel canonical/authorisation context → immutable
 *      `effect.case_ref`."
 *
 * A `BEFORE INSERT` trigger IS "in the same transaction that creates it", in the
 * strongest available sense: the value is computed and written as part of the INSERT
 * itself, so there is no instant at which a committed `effect` row exists without its
 * binding and no crash window between the two. `§9.2.2`: "For a case-associated effect,
 * the effect row and its `case_ref` commit together or neither commits."
 *
 * THE LOOKUP PATH IS AUTHORITATIVE AND HAS NO ALTERNATIVE. It is
 *
 *     effect.authorisation_id -> authorisation.task_id -> authority_task.case_ref
 *
 * and nothing else. `authorisation.task_id` is written by the accepted S1F transaction
 * from `26 §7`'s kernel-resolved facts; `authority_task` is `24 §3` K7's kernel state.
 * There is no read of `resource_ref`, of a customer identifier, of another order, of the
 * dispatch payload or of any request field — `§9.2.1` forbids each by name, and the way
 * to not do a thing is to not write it.
 *
 * A LEFT JOIN, DELIBERATELY. `authorisation` carries no foreign key to `authority_task`
 * — `0006` and `0007` as accepted — so a task row may legitimately be absent, and
 * `§9.2.3` says what that means: no binding, NULL, and `clock_bearing = false` without a
 * lookup. An absent task is not an error and must not be one, because making it an error
 * would refuse effects the accepted S1F pipeline commits today.
 */
CREATE FUNCTION effect_derive_case_ref() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_case_ref TEXT;
BEGIN
  SELECT t.case_ref
    INTO v_case_ref
    FROM authorisation a
    LEFT JOIN authority_task t
      ON t.company_id = a.company_id AND t.task_id = a.task_id
   WHERE a.authorisation_id = NEW.authorisation_id;

  -- THE OVERWRITE. Not a comparison, not a refusal: whatever the caller put here is
  -- discarded and the authoritative value takes its place. `30 §9.2.1`: "a `case_ref`
  -- parameter on a claim surface is a defect of the same class as a caller-supplied
  -- `clockBearing` boolean" — so this column is not a parameter, at any layer.
  NEW.case_ref := v_case_ref;
  RETURN NEW;
END;
$$;

CREATE TRIGGER effect_case_ref_derived
  BEFORE INSERT ON effect
  FOR EACH ROW EXECUTE FUNCTION effect_derive_case_ref();

/*
 * IMMUTABILITY IS ALREADY ENFORCED, AND IS RESTATED HERE SO THE REASON IS FINDABLE.
 *
 * `0007` installs `effect_append_only` — `BEFORE UPDATE OR DELETE ON effect` executing
 * `acos_append_only()` — so `effect.case_ref` has no UPDATE path whatever, for any role
 * including the privileged one. `§9.2.2`'s "a post-hoc mutable mapping is forbidden"
 * therefore holds by the table's existing shape rather than by a new rule, and
 * `effect-case-binding.test.ts` attacks it with direct SQL rather than assuming it.
 *
 * THE ATTACK THIS CLOSES, in `§9.2`'s words: "a mapping that can change after
 * authorisation can change which statutory clock applies to an already-authorised
 * effect, which is the row-3 lever restated as a write."
 */

-- The lookup `30 §9.2.4` performs at the decision instant is
-- `(company_id, case_ref)` on the effect side; the clock side already has
-- `statutory_clock_live`.
CREATE INDEX effect_case_ref ON effect (company_id, case_ref)
  WHERE case_ref IS NOT NULL;


-- ---------------------------------------------------------------------------------
-- PART 3 — the claim's evidentiary clock.
--
-- `30 §9.2.5`: "Where row 3 is the reason a dispatch decision resolved permissively, the
-- selected `clock_ref` is persisted as evidence on that decision, so that a later audit
-- can answer: which live statutory obligation justified this? Where row 3 is not the
-- reason, the field is NULL or absent per the declared schema."
-- ---------------------------------------------------------------------------------
ALTER TABLE dispatch_outbox
  ADD COLUMN claim_clock_ref TEXT;

COMMENT ON COLUMN dispatch_outbox.claim_clock_ref IS
  'v1.3.4 CSB-01 / 30 §9.2.5. The deterministically selected live statutory clock that '
  'made row 3 the reason this claim was permitted. NULL unless claim_matched_row = 3. '
  'Selected by the claim, never supplied by a caller.';

/*
 * FOUR DATABASE RULES, one per attack `§23` of the S1I owner-resolution mandate names.
 *
 *   "Database rules should prevent: caller choosing a clock; selected clock belonging to
 *    another company; selected clock belonging to another case; selected clock not live
 *    at the authoritative decision instant."
 *
 * The first is closed by the SERVICE having no parameter for it — there is nothing to
 * choose with — and by rule 4 below, which refuses a clock that does not qualify however
 * it was chosen. The other three are closed here.
 */

-- (1) PRESENCE. Evidence exists exactly when row 3 is the reason, and never otherwise.
--     Written as one biconditional so a violation names the fact that is wrong.
ALTER TABLE dispatch_outbox
  ADD CONSTRAINT dispatch_outbox_clock_evidence_is_row_3
    CHECK ((claim_clock_ref IS NOT NULL) = (claim_matched_row = 3));

-- (2) RESOLUTION AND COMPANY. The cited clock must exist and must belong to THIS
--     company. `statutory_clock`'s primary key is `(company_id, clock_id)`, so the
--     composite foreign key carries both facts at once: a clock reference naming another
--     company's clock has no row to point at.
ALTER TABLE dispatch_outbox
  ADD CONSTRAINT dispatch_outbox_clock_evidence_resolves
    FOREIGN KEY (company_id, claim_clock_ref)
      REFERENCES statutory_clock (company_id, clock_id);

/*
 * (3) and (4) — CASE AGREEMENT AND LIVENESS AT THE DECISION INSTANT.
 *
 * Neither is expressible as a CHECK: a CHECK may not read another table, and the
 * liveness test is a comparison against `claimed_at`, which is a column of the row being
 * written. A `BEFORE INSERT OR UPDATE` trigger is the mechanism, and it reads the
 * clock and the effect under the same transaction that is taking the claim.
 *
 * `§9.2.4`'s qualifying set, restated as a refusal:
 *
 *     the clock's case_ref     = the EFFECT's case_ref   (not the caller's, not a guess)
 *     closed_at IS NULL        and deadline_at > claimed_at
 *     source_record_ref resolves to a RECORD-grade retained artifact  (I56)
 *
 * THE EFFECT'S `case_ref` IS READ FROM THE `effect` TABLE, not from the outbox row and
 * not from an argument. The outbox carries no `case_ref` column, deliberately: a second
 * copy is a second place the binding could disagree with itself, and `30 §9.2.6` keeps
 * the binding off every surface that does not need it.
 */
CREATE FUNCTION dispatch_outbox_clock_evidence_qualifies() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_effect_case TEXT;
  v_clock_case  TEXT;
  v_closed_at   TIMESTAMPTZ;
  v_deadline_at TIMESTAMPTZ;
  v_provenance  TEXT;
BEGIN
  IF NEW.claim_clock_ref IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT e.case_ref INTO v_effect_case
    FROM effect e
   WHERE e.effect_id = NEW.effect_id AND e.company_id = NEW.company_id;

  IF v_effect_case IS NULL THEN
    RAISE EXCEPTION 'CLAIM_CLOCK_EVIDENCE_WITHOUT_CASE_BINDING'
      USING ERRCODE = 'ACS36',
            DETAIL  = format(
              'outbox_id=%s cites clock %s while its effect %s carries no case binding; '
              || 'a case-less effect is never clock-bearing (30 §9.2.3)',
              NEW.outbox_id, NEW.claim_clock_ref, NEW.effect_id);
  END IF;

  SELECT c.case_ref, c.closed_at, c.deadline_at, r.provenance
    INTO v_clock_case, v_closed_at, v_deadline_at, v_provenance
    FROM statutory_clock c
    JOIN retained_source_record r
      ON r.company_id = c.company_id AND r.source_record_id = c.source_record_ref
   WHERE c.company_id = NEW.company_id AND c.clock_id = NEW.claim_clock_ref;

  -- The FK above guarantees the clock row exists; this branch is reachable only if its
  -- `I56` citation does not resolve to a RECORD-grade artifact, which `I56` calls a
  -- critical incident and which `§9.2.4` reads as NOT clock-bearing — fail closed.
  IF v_clock_case IS NULL OR v_provenance IS DISTINCT FROM 'RECORD' THEN
    RAISE EXCEPTION 'CLAIM_CLOCK_EVIDENCE_PROVENANCE'
      USING ERRCODE = 'ACS36',
            DETAIL  = format(
              'clock %s does not currently resolve to a RECORD-grade retained artifact '
              || '(I56, 30 §9.1); a claim may not cite it', NEW.claim_clock_ref);
  END IF;

  -- THE SUBSTITUTION REFUSAL. This is the row-3 lever, closed in the database: a claim
  -- may cite only a clock of the effect's OWN authoritative case.
  IF v_clock_case IS DISTINCT FROM v_effect_case THEN
    RAISE EXCEPTION 'CLAIM_CLOCK_EVIDENCE_CASE_MISMATCH'
      USING ERRCODE = 'ACS36',
            DETAIL  = format(
              'clock %s belongs to case %s and effect %s is bound to case %s; a claim '
              || 'may cite only a clock of its own authoritative case (30 §9.2.4)',
              NEW.claim_clock_ref, v_clock_case, NEW.effect_id, v_effect_case);
  END IF;

  -- LIVE AT THE AUTHORITATIVE DECISION INSTANT, which is `claimed_at` and not `now()`.
  -- `§9.2.4`: "derived at the decision instant from CURRENT authoritative clock state."
  IF v_closed_at IS NOT NULL OR v_deadline_at <= NEW.claimed_at THEN
    RAISE EXCEPTION 'CLAIM_CLOCK_EVIDENCE_NOT_LIVE'
      USING ERRCODE = 'ACS36',
            DETAIL  = format(
              'clock %s was not live at the decision instant %s (closed_at=%s, '
              || 'deadline_at=%s); a deadline that has passed is a breach, not a reason '
              || 'to relax the mirror (30 §5.1 row 3, §9.2.4)',
              NEW.claim_clock_ref, NEW.claimed_at, v_closed_at, v_deadline_at);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER dispatch_outbox_clock_evidence
  BEFORE INSERT OR UPDATE ON dispatch_outbox
  FOR EACH ROW EXECUTE FUNCTION dispatch_outbox_clock_evidence_qualifies();

/*
 * THE STATE MACHINE STILL OWNS THE TRANSITION, AND `claim_clock_ref` JOINS THE CLAIM
 * COLUMNS RATHER THAN THE IDENTITY COLUMNS.
 *
 * `0010`'s `dispatch_outbox_state_machine` refuses any UPDATE that moves an identity or
 * payload column, listed explicitly. `claim_clock_ref` is deliberately NOT added to that
 * list: it is a CLAIM column, written by the one permitted `ENQUEUED → CLAIMED`
 * transition exactly as `claim_matched_row` and `claim_override_id` are, and the trigger
 * already refuses every UPDATE to a `CLAIMED` row, so it is immutable once written for
 * the same reason they are.
 *
 * Trigger firing order is alphabetical within the same event, so
 * `dispatch_outbox_clock_evidence` fires before `dispatch_outbox_transitions` on an
 * UPDATE. Both are `BEFORE` and neither depends on the other's outcome: the evidence
 * trigger validates the NEW row's citation, the state machine validates the transition.
 */


-- ---------------------------------------------------------------------------------
-- PART 3b — row 1 becomes a claimable row, in `NORMAL` only.
--
-- `30 §5.1b`, v1.3.4 (IRN-01), resolving `S1I-C6`: "In `NORMAL`, **dispatch** [...] In
-- `UNCORROBORATED_STALL` and in `CORROBORATED_DEGRADED`, **halt**."
--
-- `0010` wrote `CHECK (claim_matched_row IS NULL OR claim_matched_row IN (3, 4, 5))` and
-- gave its reason: "`30 §5.1` item 4's rows 1 and 2 HALT IN EVERY MIRROR STATE — `22 §3.1`
-- prints Halt/Halt/Halt for both [...] So no claim can ever have been decided by row 1 or
-- row 2." **That was true of v1.3.3 and is no longer true of row 1.** Leaving the CHECK
-- as issued would make the class ADR-026 is titled for unclaimable at the schema level,
-- which is IRN-01 restated one layer down.
--
-- THE REPLACEMENT IS NARROWER THAN A SIMPLE WIDENING. Row 2 stays impossible, and row 1
-- becomes possible ONLY in `NORMAL` — a two-column CHECK, because `claim_mirror_state` is
-- on the same row and the pair is what `§5.1b` actually declares. So the database refuses
-- a row-1 claim recorded in either degraded state, which no code path can produce and
-- which a later edit to the classifier could otherwise introduce silently.
--
-- `36 §0`'s reason for a second mechanism applies exactly here: the claim service already
-- asserts both halves, and a property enforced in one place is a property one edit away
-- from being unenforced.
-- ---------------------------------------------------------------------------------
ALTER TABLE dispatch_outbox
  DROP CONSTRAINT dispatch_outbox_matched_row_is_eligible;

ALTER TABLE dispatch_outbox
  ADD CONSTRAINT dispatch_outbox_matched_row_is_eligible
    CHECK (claim_matched_row IS NULL OR claim_matched_row IN (1, 3, 4, 5)),
  ADD CONSTRAINT dispatch_outbox_row_1_is_normal_only
    CHECK (claim_matched_row IS DISTINCT FROM 1 OR claim_mirror_state = 'NORMAL');

-- The journal's own copy of the same domain, `0010`'s
-- `journal_outbox_matched_row_declared`, for the same reason and with the same pairing.
ALTER TABLE effect_journal
  DROP CONSTRAINT journal_outbox_matched_row_declared;

ALTER TABLE effect_journal
  ADD CONSTRAINT journal_outbox_matched_row_declared
    CHECK (outbox_matched_row IS NULL OR outbox_matched_row IN (1, 3, 4, 5)),
  ADD CONSTRAINT journal_outbox_row_1_is_normal_only
    CHECK (outbox_matched_row IS DISTINCT FROM 1 OR outbox_mirror_state = 'NORMAL');

/*
 * AND ROW 1 CARRIES NO CLOCK EVIDENCE, WHICH PART 3's BICONDITIONAL ALREADY SAYS.
 *
 * `dispatch_outbox_clock_evidence_is_row_3` is
 * `(claim_clock_ref IS NOT NULL) = (claim_matched_row = 3)`, so a row-1 claim carries
 * NULL by the same constraint that requires a row-3 claim to carry a reference. Row 1
 * matches on `recoverability` alone and never on a clock — `30 §9.2.5`'s evidence is for
 * "where row 3 is the reason", and row 1's reason is the class.
 */


-- ---------------------------------------------------------------------------------
-- PART 4 — the journal row gains field 18.
--
-- `30 §5.3a`, v1.3.4 (JCS-02), declares the field order for
-- `acos.journal.outbox_claimed.v1` NORMATIVELY for the first time, and field 18 is
-- `outbox_claim_clock_ref` — "text, NULLABLE. §9.2.5's deterministically selected
-- evidentiary clock. Non-NULL only where the matched row is 3; NULL otherwise."
--
-- `23 §6` B8 is why it is journaled at all: the claim is the last committed local record
-- before an effect could cross the perimeter, and the question `§9.2.5` exists to make
-- answerable — "which live statutory obligation justified this?" — is an AUDIT question,
-- so it must be answerable from the chained record and not only from control-plane state
-- the control plane can rewrite.
--
-- `case_ref` ITSELF IS NOT JOURNALED. `30 §5.3a`: "the clock reference is the fact an
-- audit needs and is the narrower disclosure."
-- ---------------------------------------------------------------------------------
ALTER TABLE effect_journal
  ADD COLUMN outbox_claim_clock_ref TEXT;

ALTER TABLE effect_journal
  ADD CONSTRAINT journal_outbox_clock_ref_is_row_3
    CHECK (outbox_claim_clock_ref IS NULL OR outbox_matched_row = 3);

/*
 * THE CANONICAL BYTES, RE-DECLARED WITH FIELD 18 IN PLACE.
 *
 * `30 §5.3a`'s table is the specification and this function is the CONTROL PLANE's
 * independent transcription of it. `A0006` is the AUDIT plane's, written from the same
 * table and never from this file. `tests/support/jcs1Oracle.ts` is the hand-authored
 * third reading, and `outbox-journal-rows.test.ts` judges both against it — never
 * against each other (`36 §0`).
 *
 * BRANCHES 1 THROUGH 5 ARE `0007`'s, `0008`'s, `0009`'s AND `0010`'s TO THE BYTE, so
 * every row already chained recomputes to the `row_hash` it holds.
 *
 * BRANCH 6 CHANGES. Field 18 is inserted between `override_id` (17) and `occurred_at`
 * (now 19), which moves the `row_hash` of every `OUTBOX_CLAIMED` row. That is admissible
 * for exactly the reason `30 §5.3` gives for the v1.3.2 NULL-framing correction — "at
 * v1.3.2 there is no deployed chain" — and it is still true. A deployed chain would
 * require the declared chain-versioning and re-anchor procedure instead.
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
      -- FIELD 18, new at v1.3.4 (JCS-02 / CSB-01). `30 §5.3a`: the deterministically
      -- selected evidentiary clock, non-NULL only where the matched row is 3. NULL
      -- frames as the reserved `FF FF FF FF` word with no payload (v1.3.2, JCS-01).
      || acos_jcs1_field(acos_jcs1_text (row_in.outbox_claim_clock_ref))
      || acos_jcs1_field(acos_jcs1_ts   (row_in.occurred_at))
      || acos_jcs1_field(acos_jcs1_bytes(row_in.prev_hash))

  END;
$fn$;

/*
 * `emit_outbox_claimed` gains the evidence parameter, in the position `§5.3a` puts the
 * field: after `override_id` and before `occurred_at`. The signature changes, so the
 * function is dropped and recreated rather than replaced — `CREATE OR REPLACE` cannot
 * change a parameter list.
 */
DROP FUNCTION emit_outbox_claimed(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, INTEGER, TEXT, BOOLEAN,
  TEXT, TIMESTAMPTZ);

CREATE FUNCTION emit_outbox_claimed(
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
  p_matched_row           INTEGER,
  p_mirror_state          TEXT,
  p_requires_tag          BOOLEAN,
  p_override_id           TEXT,
  p_claim_clock_ref       TEXT,
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
    outbox_matched_row, outbox_mirror_state, outbox_requires_unmirrored_tag,
    override_id, outbox_claim_clock_ref, occurred_at
  ) VALUES (
    p_company_id, v_seq, 'OUTBOX_CLAIMED',
    p_outbox_id, p_claim_id, p_correlation_tag,
    p_effect_id, p_authorisation_id, p_idempotency_key, p_action_class, p_resource_ref,
    p_dispatch_payload_hash,
    p_matched_row, p_mirror_state, p_requires_tag,
    p_override_id, p_claim_clock_ref, p_occurred_at
  );
  RETURN v_seq;
END;
$fn$;
