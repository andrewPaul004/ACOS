-- 0010 — the ACOS-owned dispatch outbox and the at-most-once exclusive claim.
--
-- =================================================================================
-- WHAT THIS MIGRATION IS, AND WHERE EVERY STRUCTURAL DECISION COMES FROM
--
-- `25 §7`, the fourth idempotency layer, verbatim and in full:
--
--     "| Outbox claim (v1.1) | Effect idempotency key, unique | A second dispatch of the
--      same intended message by any path (I36) |
--
--      One outbox row per intended message, unique on the effect idempotency key,
--      carrying a provider-visible correlation tag (custom header, metadata or tag). The
--      row transitions to `CLAIMED` in a committed transaction **before** the HTTP call,
--      and a `CLAIMED` row is never re-dispatched by any path — including recovery,
--      including a fork, including a manual replay."
--
-- `34` ADR-026 decision items 1 and 2, verbatim:
--
--     "1. ACOS-owned outbox. One row per intended message, unique on the effect
--         idempotency key, carrying a unique correlation tag in a provider-visible field
--         (custom header, metadata, tag).
--      2. At-most-once claim. The row transitions to `CLAIMED` in a committed transaction
--         before the HTTP call. A `CLAIMED` row is never re-dispatched by any path —
--         recovery, workflow fork, or manual replay (I36)."
--
-- Registry `I36`, verbatim, including its enforcement column:
--
--     "| I36 | No outbox row transitions from `CLAIMED` to a second dispatch, by any path.
--       | Control | DB (state machine constraint) | Dispatch refused. A second dispatch is
--       a critical incident. | Kill at each of the six points in `44 §5.2` against the
--       real ESP sandbox and assert exactly one accepted message. | S4 | `46 R13` |"
--
-- THIS FILE IS `I36`'s DECLARED ENFORCEMENT — "DB (state machine constraint)". It is not
-- `I36`'s declared VERIFICATION, which requires a real ESP sandbox and a provider-reported
-- accepted count. S1I builds no transport, so that leg stays OPEN and
-- `docs/implementation/S1I-result.md §11` says so.
--
-- `24 §4`'s ERD names the entity and its cardinality:
--
--     "EFFECT ||--o| OUTBOX_ROW : \"claims (irrecoverable sends)\""
--
-- `o|` — ZERO OR ONE. An effect may exist with no outbox row, which is the cardinality
-- `§26` of the S1I mandate asks about and it answers the question: the outbox row is NOT
-- part of the local authorisation transaction. `30 §5.1` item 3 prints that transaction's
-- write list exhaustively —
--
--     BEGIN
--       SELECT ... FOR UPDATE on window_balance rows, ascending window_id
--       SELECT ... FOR UPDATE on journal_counter(company_id)
--       authorisation row
--       effect row (status = AUTHORISED)
--       reservation row
--       state transition
--       journal row (journal_seq, local prev_hash/row_hash over ACOS-JCS-1 bytes)
--     COMMIT
--       ↓
--     push to audit store (async, retried, quota-bounded, idempotent per §5.2)
--       ↓
--     dispatch, per (4)
--
-- — and no outbox row appears in it. `23 §6` B8 states the same ordering in prose:
-- "dispatch follows the commit, by recoverability class". So the outbox is a POST-COMMIT
-- DERIVATIVE of committed authoritative state, and `src/kernel/outbox/recovery.ts` is the
-- deterministic derivation `§27` of the mandate requires. THE ACCEPTED S1F TRANSACTION IS
-- NOT TOUCHED BY THIS MIGRATION.
-- =================================================================================
--
-- =================================================================================
-- WHAT THIS MIGRATION DOES NOT CONTAIN, AND MUST NOT
--
--   No transport. No adapter. No vendor. No HTTP. No credential. No endpoint column.
--   No `DISPATCHED` state of anything.
--   No poller, no scheduler, no background worker, and no path that moves a row to
--     `CLAIMED` other than the trusted claim service calling the function below.
--   No lease, no visibility timeout, no `claim_expires_at`, and no transition OUT of
--     `CLAIMED` at all — `§19` of the mandate and `25 §7`'s "never re-dispatched by any
--     path" make a returning-to-ready timeout the exact defect this table exists to
--     prevent. `tests/negative-controls/unsafe-reclaimable-outbox.ts` is the vulnerable
--     control and it is TEST-ONLY.
--   No `PRESUMED_EXECUTED`, `VERIFIED` or `NEVER_SENT` outbox status. Those three are
--     declared by `25 §5` on the WORK-ITEM lifecycle and by ADR-026 item 4 on the outcome
--     of a REQUEST THAT WAS MADE; v1.3.3 does not place them in the outbox row's own
--     status domain, and `§22` of the mandate forbids inventing states. They are reached
--     only from provider evidence, which does not exist.
--
-- EVERY NEW JOURNAL COLUMN IS A SCALAR. No JSON, no JSONB and no array reaches a hashed
-- field, so `ACOS-JCS-1`'s RFC-8785 leg is not engaged on either plane and the S1G/S1H
-- position — no production journal row carries a JSON column — is preserved rather than
-- quietly extended. `§42` of the mandate requires a STOP if it were otherwise.
--
-- THE PAYLOAD IS STORED AS `BYTEA`, NOT AS JSON, FOR THE SAME REASON. `§9` of the mandate
-- offers "the exact canonical dispatch payload bytes" as option A, and the bytes are what
-- the accepted `dispatchPayloadCanonicalHash` already commits to. A JSONB column would
-- have required an RFC-8785 implementation in SQL to bind it to the hash; the bytes need
-- only `sha256`, which PostgreSQL has natively, and the binding therefore becomes a
-- DATABASE CHECK rather than an application convention.
-- =================================================================================

-- =================================================================================
-- PART 1 — THE REFERENCE TARGETS THAT MAKE THE BINDING STRUCTURAL
--
-- `§8` of the mandate: "It must not allow a caller to create `outbox(effect_id = X,
-- payload = payload-for-Y)`."
--
-- The mechanism is a COMPOSITE FOREIGN KEY, not a lookup. Every authority-bearing column
-- on the outbox row is a member of a foreign key whose target is the committed row that
-- owns it, so a mismatched tuple has no INSERT at all — there is no code path, trusted or
-- otherwise, that can write one.
--
-- Both indexes below are unique over a SUPERSET of an already-unique column
-- (`effect.effect_id`, `authorisation.authorisation_id`), so neither adds a constraint to
-- the accepted tables: they add a reference TARGET. No accepted row is affected and no
-- accepted insert can begin to fail.
-- =================================================================================

/*
 * The effect's identity tuple.
 *
 * `status` IS A MEMBER, and that is load-bearing. `effect` is append-only (`33 §6`:
 * "Correction is a new row with `supersedes`", and 0007's `effect_append_only` trigger),
 * so an effect's status is fixed at commit for the life of the row. Including it in the
 * key means an `AWAITING_APPROVAL` effect has NO enqueue path — the outbox's own CHECK
 * admits only `AUTHORISED`, so the tuple does not resolve. `26 §12`'s approval resume,
 * verify mode and `R′` are unbuilt, so an effect awaiting approval has no authority to
 * dispatch and must not be able to acquire an outbox row that a later claim could take.
 */
CREATE UNIQUE INDEX effect_outbox_identity
  ON effect (effect_id, company_id, idempotency_key, authorisation_id,
             action_class, recoverability, adapter, resource_ref, status);

/*
 * The authorisation's payload binding.
 *
 * `26 §2.1` on `dispatch_payload_hash`: "binds this request to exactly one dispatch
 * payload." The outbox carries the hash and the bytes; this index is what makes the hash
 * it carries THE COMMITTED AUTHORISED ONE rather than one the enqueuing caller chose.
 */
CREATE UNIQUE INDEX authorisation_payload_binding
  ON authorisation (authorisation_id, dispatch_payload_hash);


-- =================================================================================
-- PART 2 — THE OUTBOX ROW
-- =================================================================================

/*
 * `25 §7`: "One outbox row per intended message, unique on the effect idempotency key."
 *
 * THE PRIMARY KEY IS `(company_id, idempotency_key)`, which is the same choice 0007 made
 * for `effect` and for the same reason `33 §6` gives there: "a duplicate proposal cannot
 * create a second row even if every layer above it fails." Making `outbox_id` the primary
 * key and the idempotency key merely unique would satisfy the words and put the
 * duplicate-prevention property on a secondary index; making the idempotency identity THE
 * key means a second row for one intended effect is not a rejected insert, it is an
 * unrepresentable state.
 *
 * `company_id` is a member because `25 §7`'s key is company-scoped everywhere else in the
 * schema and `33 §6` requires it: "Every table carries `company_id`, non-null, from the
 * first migration."
 */
CREATE TABLE dispatch_outbox (
  -- ---------------------------------------------------------------------------------
  -- IDENTITY. Immutable for the life of the row, enforced by the trigger in PART 4.
  -- ---------------------------------------------------------------------------------
  company_id                    TEXT        NOT NULL REFERENCES company(company_id),
  -- `25 §7`: H(task_id ‖ action_class ‖ resource_id ‖ semantic_param_digest), computed by
  -- the kernel before the transaction that allocates `journal_seq` (`30 §5.2`, SR-A4).
  -- `§43` of the mandate: the semantic effect identity, and NEVER `journal_seq`, a retry
  -- counter, a timestamp, a process id or a retry UUID. This column is a copy OF THE
  -- COMMITTED EFFECT's key, held in place by the composite foreign key below.
  idempotency_key               TEXT        NOT NULL,

  -- A surrogate, so the journal row and the claim can name one row in one column. It is
  -- NOT the key that decides duplication.
  outbox_id                     TEXT        NOT NULL UNIQUE,

  -- ---------------------------------------------------------------------------------
  -- THE BINDING TO THE COMMITTED EFFECT. Every column here is a foreign-key member.
  -- ---------------------------------------------------------------------------------
  effect_id                     TEXT        NOT NULL UNIQUE,
  authorisation_id              TEXT        NOT NULL UNIQUE,
  action_class                  TEXT        NOT NULL,
  -- `26 §5`: "Assigned per action class in the catalogue, not per request, and never by a
  -- model." `§12` of the mandate: the outbox must not let a caller relabel an
  -- IRRECOVERABLE action REVERSIBLE. The value is a foreign-key member, so the only
  -- admissible value is the one the committed effect row holds.
  recoverability                TEXT        NOT NULL,
  adapter                       TEXT        NOT NULL,
  resource_ref                  TEXT        NOT NULL,
  -- Always `AUTHORISED`; see `effect_outbox_identity` above.
  effect_status                 TEXT        NOT NULL,

  -- ---------------------------------------------------------------------------------
  -- THE ASYNCHRONOUS BOUNDARY — `§9` OF THE MANDATE.
  --
  -- The canonical bytes of the `dispatch_payload` the canonicaliser emitted, and the hash
  -- the authorisation committed. `26 §2.1`: emitted together, hashed together. `33 §1`:
  -- "Each [adapter] receives the kernel's `dispatch_payload` verbatim and does not
  -- reinterpret intent into vendor parameters."
  --
  -- A future dispatcher reads THESE BYTES. It does not re-run the constructor, does not
  -- re-read live order state and does not re-canonicalise from the model's opaque
  -- proposal text (`26 §2.0`: "NEVER parsed, NEVER interpreted as authority") — and it
  -- cannot, because no other representation of the payload exists on this row.
  -- ---------------------------------------------------------------------------------
  dispatch_payload_hash         TEXT        NOT NULL,
  payload_canonical_bytes       BYTEA       NOT NULL,

  -- ---------------------------------------------------------------------------------
  -- `25 §7` / ADR-026 item 1: "a unique correlation tag in a provider-visible field".
  --
  -- S1I STORES THE VALUE AND NOTHING ELSE. Which provider field carries it — custom
  -- header, metadata, tag — is per-adapter and `§11` of the mandate forbids inventing a
  -- vendor-specific header here. There is deliberately no `correlation_header_name`
  -- column.
  -- ---------------------------------------------------------------------------------
  correlation_tag               TEXT        NOT NULL,

  -- ---------------------------------------------------------------------------------
  -- STATUS. Two values, and the second is `25 §7`'s own literal.
  --
  -- `ENQUEUED` is an IMPLEMENTATION DECLARATION. v1.3.3 names `CLAIMED` and says the row
  -- "transitions to" it, which requires a prior state, and declares no name for that
  -- state anywhere. `docs/implementation/S1I-owner-clarifications.md S1I-C2` records the
  -- gap and the choice; the STRUCTURE — one pre-claim state, one claimed state, one
  -- transition, no way back — is architecture, and only the identifier is not.
  -- ---------------------------------------------------------------------------------
  status                        TEXT        NOT NULL,
  enqueued_at                   TIMESTAMPTZ NOT NULL,

  -- ---------------------------------------------------------------------------------
  -- THE CLAIM. All NULL while `ENQUEUED`; all set in the one transition; never changed
  -- again, because a `CLAIMED` row admits no UPDATE at all (PART 4).
  -- ---------------------------------------------------------------------------------
  claim_id                      TEXT        UNIQUE,
  claimed_at                    TIMESTAMPTZ,
  -- The claiming worker's identity, for the audit trail. Not an authority operand: no
  -- decision in the claim transaction reads it.
  claimed_by                    TEXT,
  -- Which of `30 §5.1` item 4's five rows made this effect eligible. Recorded so a later
  -- reader can see WHY, which `30 §5.7.2` item 8's display obligation needs.
  claim_matched_row             INTEGER,
  -- `30 §5.6`'s state at the instant of the claim.
  claim_mirror_state            TEXT,
  -- `30 §5.7.2` item 5: "Every dispatch under it is tagged `DISPATCHED_UNMIRRORED` and
  -- carries `override_id`." `36 §6`: in `CORROBORATED_DEGRADED`, "every dispatch tagged".
  --
  -- `§16` OF THE MANDATE: the requirement is preserved IMMUTABLY on the claim so that the
  -- execution slice cannot forget that the dispatch was authorised outside `NORMAL`. It
  -- is NOT a tag on a dispatched effect — nothing is dispatched — and `I17f(a)`/`I17f(c)`
  -- stay OPEN.
  claim_requires_unmirrored_tag BOOLEAN,
  -- `30 §5.7.2` item 5's `override_id`, bound as the specific authority used. `§31` of
  -- the mandate: not `overrideApplied = true`.
  claim_override_id             TEXT,

  PRIMARY KEY (company_id, idempotency_key),

  -- ---------------------------------------------------------------------------------
  -- THE STRUCTURAL BINDINGS
  -- ---------------------------------------------------------------------------------
  FOREIGN KEY (effect_id, company_id, idempotency_key, authorisation_id,
               action_class, recoverability, adapter, resource_ref, effect_status)
    REFERENCES effect (effect_id, company_id, idempotency_key, authorisation_id,
                       action_class, recoverability, adapter, resource_ref, status),
  FOREIGN KEY (authorisation_id, dispatch_payload_hash)
    REFERENCES authorisation (authorisation_id, dispatch_payload_hash),
  FOREIGN KEY (company_id, claim_override_id)
    REFERENCES degraded_mode_override (company_id, override_id),

  -- ---------------------------------------------------------------------------------
  -- THE DECLARED DOMAINS
  -- ---------------------------------------------------------------------------------
  CONSTRAINT dispatch_outbox_status_declared
    CHECK (status IN ('ENQUEUED', 'CLAIMED')),
  -- `26 §12`'s resume is unbuilt, so only a PERMITTED effect may be enqueued.
  CONSTRAINT dispatch_outbox_effect_is_authorised
    CHECK (effect_status = 'AUTHORISED'),
  CONSTRAINT dispatch_outbox_recoverability_declared
    CHECK (recoverability IN ('REVERSIBLE', 'COMPENSABLE', 'IRRECOVERABLE')),

  /*
   * THE PAYLOAD IS BOUND TO THE AUTHORISED HASH BY THE DATABASE.
   *
   * `§9` of the mandate: "hash equals the accepted `dispatch_payload_hash`; hash verified
   * when enqueueing". Verified HERE rather than in the enqueue function, because a check
   * in application code is a check one code path can skip. Composed with the foreign key
   * to `authorisation (authorisation_id, dispatch_payload_hash)` the two together say:
   * the bytes on this row hash to the hash on this row, AND that hash is the one the
   * committed authorisation bound. There is no third possibility.
   *
   * `encode(sha256(...), 'hex')` matches the accepted `hex(dispatchPayloadCanonicalHash())`
   * representation in `src/kernel/canonicalisation/canonicaliser.ts` — lowercase hex of
   * the SHA-256 digest.
   */
  CONSTRAINT dispatch_outbox_payload_binds_hash
    CHECK (dispatch_payload_hash = encode(sha256(payload_canonical_bytes), 'hex')),

  /*
   * THE CLAIM COLUMNS ARE ALL-OR-NOTHING WITH THE STATUS.
   *
   * Written as one biconditional per column rather than as a single `AND`, so a violation
   * names the column that is wrong.
   */
  CONSTRAINT dispatch_outbox_claim_id_iff_claimed
    CHECK ((status = 'CLAIMED') = (claim_id IS NOT NULL)),
  CONSTRAINT dispatch_outbox_claimed_at_iff_claimed
    CHECK ((status = 'CLAIMED') = (claimed_at IS NOT NULL)),
  CONSTRAINT dispatch_outbox_claimed_by_iff_claimed
    CHECK ((status = 'CLAIMED') = (claimed_by IS NOT NULL)),
  CONSTRAINT dispatch_outbox_matched_row_iff_claimed
    CHECK ((status = 'CLAIMED') = (claim_matched_row IS NOT NULL)),
  CONSTRAINT dispatch_outbox_mirror_state_iff_claimed
    CHECK ((status = 'CLAIMED') = (claim_mirror_state IS NOT NULL)),
  CONSTRAINT dispatch_outbox_tag_requirement_iff_claimed
    CHECK ((status = 'CLAIMED') = (claim_requires_unmirrored_tag IS NOT NULL)),
  CONSTRAINT dispatch_outbox_override_only_when_claimed
    CHECK (claim_override_id IS NULL OR status = 'CLAIMED'),

  /*
   * `30 §5.1` item 4's rows 1 and 2 HALT IN EVERY MIRROR STATE — `22 §3.1` prints
   * Halt/Halt/Halt for both across `NORMAL`, `UNCORROBORATED_STALL` and
   * `CORROBORATED_DEGRADED` — and `item 5` makes them unreachable by override: "An
   * override restores precedence rows 3 and 4 only, never rows 1 or 2."
   *
   * So no claim can ever have been decided by row 1 or row 2, and a row recording one is
   * not a claim this system could have produced. The CHECK is a second refusal on top of
   * the claim service's own, for the reason `36 §0` gives about single-mechanism
   * properties.
   */
  CONSTRAINT dispatch_outbox_matched_row_is_eligible
    CHECK (claim_matched_row IS NULL OR claim_matched_row IN (3, 4, 5)),

  CONSTRAINT dispatch_outbox_mirror_state_declared
    CHECK (claim_mirror_state IS NULL OR claim_mirror_state IN
           ('NORMAL', 'UNCORROBORATED_STALL', 'CORROBORATED_DEGRADED')),

  /*
   * `30 §5.7.2` item 5, verbatim: "Every dispatch under it is tagged
   * `DISPATCHED_UNMIRRORED` and carries `override_id`, so the two are distinguishable in
   * the mirror and in `I8`'s verification list."
   *
   * "EVERY", so an override-backed claim that did not carry the tag requirement would be
   * a row this schema must not hold.
   */
  CONSTRAINT dispatch_outbox_override_claim_is_tagged
    CHECK (claim_override_id IS NULL OR claim_requires_unmirrored_tag = TRUE),

  /*
   * `30 §5.1` item 5 / `§5.7.2` scope rule: an override restores rows 3 and 4 only.
   * A row-5 claim under an override is therefore not a state this system produces.
   */
  CONSTRAINT dispatch_outbox_override_restores_rows_3_and_4_only
    CHECK (claim_override_id IS NULL OR claim_matched_row IN (3, 4)),

  CONSTRAINT dispatch_outbox_claim_after_enqueue
    CHECK (claimed_at IS NULL OR claimed_at >= enqueued_at)
);

/*
 * `25 §7` / ADR-026 item 1: the correlation tag is UNIQUE.
 *
 * NOT scoped to the company. The tag's purpose is that a provider's delivery event or
 * query response can be matched back to exactly one intended effect (ADR-026 item 4:
 * "Delivery-event reconciliation ON THE CORRELATION TAG"), and a provider does not know
 * about ACOS companies. A per-company uniqueness would admit two companies holding the
 * same tag and make the future match ambiguous, which is the one thing the tag exists to
 * prevent.
 */
CREATE UNIQUE INDEX dispatch_outbox_correlation_tag_unique
  ON dispatch_outbox (correlation_tag);

/*
 * The eligibility query's index. `WHERE status = 'ENQUEUED'` and nothing else, because
 * `§13` of the mandate makes the QUERY a candidate list and the CLAIM TRANSACTION the
 * decision — there is no stored eligibility to index on, and this migration adds no
 * column a caller could have written one into.
 */
CREATE INDEX dispatch_outbox_enqueued
  ON dispatch_outbox (company_id, enqueued_at)
  WHERE status = 'ENQUEUED';


-- =================================================================================
-- PART 3 — RECOVERY VISIBILITY
--
-- `§27` of the mandate: "local S1F authorisation exists; process crashes before S1I
-- enqueue; restart. Expected: the system can deterministically discover/reconstruct the
-- missing outbox work from durable authoritative state without making a second economic
-- authorisation."
--
-- The discovery half is this view. It is a LEFT JOIN over committed state and holds no
-- state of its own, so there is nothing for a crash to lose: an authorised effect with no
-- outbox row appears here on every restart until one exists.
-- =================================================================================

CREATE VIEW dispatch_outbox_missing AS
  SELECT e.company_id,
         e.effect_id,
         e.idempotency_key,
         e.authorisation_id,
         e.action_class,
         e.recoverability,
         e.adapter,
         e.resource_ref,
         a.dispatch_payload_hash,
         e.created_at
    FROM effect e
    JOIN authorisation a ON a.authorisation_id = e.authorisation_id
    LEFT JOIN dispatch_outbox o ON o.effect_id = e.effect_id
   WHERE e.status = 'AUTHORISED'
     AND o.effect_id IS NULL;


-- =================================================================================
-- PART 4 — THE STATE MACHINE, AS A DATABASE CONSTRAINT
--
-- Registry `I36`'s enforcement column, verbatim: "DB (state machine constraint)".
--
-- The four properties this trigger enforces, and the mandate section each answers:
--
--   §19  A `CLAIMED` row admits NO UPDATE. Not a status change, not a column touch, not a
--        lease reset, not a re-claim by the same worker, not a re-claim by another worker,
--        and not a transition back to `ENQUEUED` after any elapsed time. There is no
--        parameter, no clock and no role that changes this, so "restart does not make it
--        claimable" and "lease timeout does not make it claimable" are not behaviours of
--        the claim service — they are absences in the schema.
--
--   §25  A claimed identity cannot be rebound. Since no UPDATE is admitted at all, a
--        rebinding of the payload, the tag, the effect, the recoverability, the company or
--        the tag requirement has no statement that performs it.
--
--   §22  The only transition is `ENQUEUED` → `CLAIMED`. `ENQUEUED` → `ENQUEUED` is
--        admitted for no column: an enqueued row's identity is as immutable as a claimed
--        row's, and the only legitimate write to an enqueued row is the claim itself.
--
--   §7   DELETE is refused on both statuses. A deleted outbox row is a duplicate waiting
--        to be re-enqueued under the same idempotency key, which is precisely what the
--        primary key exists to prevent.
--
-- WHY A TRIGGER RATHER THAN A CHECK. A CHECK cannot see `OLD`. The property is about the
-- TRANSITION, not about the row, and 0003's `standing_authorization` transition table set
-- the precedent for expressing exactly that in this schema.
-- =================================================================================

CREATE FUNCTION dispatch_outbox_state_machine() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'OUTBOX_ROW_UNDELETABLE'
      USING ERRCODE = 'ACS36',
            DETAIL  = format(
              'DELETE on dispatch_outbox is refused; a deleted row is a re-enqueueable '
              || 'duplicate (25 §7, I36). company=%s idempotency_key=%s',
              OLD.company_id, OLD.idempotency_key);
  END IF;

  -- `25 §7`: "a `CLAIMED` row is never re-dispatched by any path — including recovery,
  -- including a fork, including a manual replay." The strongest form of "any path" this
  -- schema can express: a claimed row is frozen.
  IF OLD.status = 'CLAIMED' THEN
    RAISE EXCEPTION 'OUTBOX_ROW_ALREADY_CLAIMED'
      USING ERRCODE = 'ACS36',
            DETAIL  = format(
              'a CLAIMED outbox row admits no UPDATE (I36, 25 §7). '
              || 'outbox_id=%s claim_id=%s claimed_at=%s',
              OLD.outbox_id, OLD.claim_id, OLD.claimed_at);
  END IF;

  IF NEW.status <> 'CLAIMED' THEN
    RAISE EXCEPTION 'OUTBOX_TRANSITION_UNDECLARED'
      USING ERRCODE = 'ACS36',
            DETAIL  = format(
              'the only declared transition is ENQUEUED -> CLAIMED (25 §7); '
              || 'attempted %s -> %s on outbox_id=%s',
              OLD.status, NEW.status, OLD.outbox_id);
  END IF;

  -- The identity and the payload binding are the same row afterwards. Compared column by
  -- column so the refusal names what moved. `§25` of the mandate lists exactly these.
  IF ROW(NEW.company_id, NEW.idempotency_key, NEW.outbox_id, NEW.effect_id,
         NEW.authorisation_id, NEW.action_class, NEW.recoverability, NEW.adapter,
         NEW.resource_ref, NEW.effect_status, NEW.dispatch_payload_hash,
         NEW.payload_canonical_bytes, NEW.correlation_tag, NEW.enqueued_at)
     IS DISTINCT FROM
     ROW(OLD.company_id, OLD.idempotency_key, OLD.outbox_id, OLD.effect_id,
         OLD.authorisation_id, OLD.action_class, OLD.recoverability, OLD.adapter,
         OLD.resource_ref, OLD.effect_status, OLD.dispatch_payload_hash,
         OLD.payload_canonical_bytes, OLD.correlation_tag, OLD.enqueued_at)
  THEN
    RAISE EXCEPTION 'OUTBOX_IDENTITY_IMMUTABLE'
      USING ERRCODE = 'ACS36',
            DETAIL  = format(
              'the claim transition may set only the claim columns; identity, payload and '
              || 'correlation tag are immutable after enqueue (§25). outbox_id=%s',
              OLD.outbox_id);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER dispatch_outbox_transitions
  BEFORE UPDATE OR DELETE ON dispatch_outbox
  FOR EACH ROW EXECUTE FUNCTION dispatch_outbox_state_machine();


-- =================================================================================
-- PART 5 — THE JOURNAL ROW KIND FOR THE CLAIM
--
-- `23 §6` B8: "Effect ↛ External without journal [...] No effect originating in reasoning
-- can occur that is not recorded."
--
-- The claim is the instant at which ACOS durably commits that this exact effect may leave.
-- It is therefore the last local record before an external effect could exist, and it is
-- journaled on the SAME `effect_journal`, the SAME `journal_counter`, the SAME chain
-- trigger and the SAME replication path — for the reason 0008 and 0009 both gave: a second
-- table would be `30 §5.4`'s "second unverified channel".
--
-- WHAT IS NOT JOURNALED, AND WHY.
--
--   THE ENQUEUE. It moves no authority, creates no reservation, changes no exposure and
--   makes nothing eligible. Its subject — the authorisation, the effect and the payload
--   hash — is already in a committed, chained `EFFECT_AUTHORISATION` row, and the outbox
--   row is itself durable discoverable state. `§42` of the mandate says "Implement only
--   the journal records current S1I scope requires", and v1.3.3 requires none for
--   enqueue.
--
--   A REFUSED CLAIM. `30 §5.7.2`'s override path already establishes the rule that a
--   refusal is not an event — accepted `claimOverrideAllowanceOn` evaluates every bound
--   BEFORE emitting, so a refused allowance journals nothing. A refused claim writes
--   nothing at all: the row stays `ENQUEUED` and remains claimable when the condition
--   that refused it changes, which is `§14`'s reverse case.
--
-- CONTROL-ARTIFACT CONSEQUENCE, DISCLOSED. `50 §2` class 20 is the "Journal
-- canonicalisation specification — `ACOS-JCS-1`: column order per row kind". A NEW ROW
-- KIND ADDS A COLUMN ORDER TO THAT SPECIFICATION AND THEREFORE MOVES CLASS 20's
-- `content_hash`. The class-20 signature was already owed at v1.3.2 and is still owed;
-- this migration extends the same owed obligation rather than creating a new kind of one.
-- `docs/implementation/S1I-result.md §18` carries it forward and NOTHING HERE CLAIMS IT
-- IS SIGNED.
-- =================================================================================

ALTER TABLE effect_journal
  DROP CONSTRAINT journal_row_kind_declared;

ALTER TABLE effect_journal
  ADD CONSTRAINT journal_row_kind_declared
  CHECK (journal_row_kind IN (
    'EFFECT_AUTHORISATION',
    'JOURNAL_ATTESTATION',
    'AUDIT_MIRROR_DEGRADED',
    'MIRROR_CORROBORATION_CONSUMED',
    'DEGRADED_MODE_OVERRIDE_EVENT',
    -- `25 §7`, ADR-026 item 2, `I36`. The at-most-once claim, recorded.
    --
    -- THE NAME IS `OUTBOX_CLAIMED`, NOT `DISPATCHED`. `§41` of the mandate: "Do not blur
    -- CLAIMED with DISPATCHED." The row records that a claim was taken. It records no
    -- request, no response, no provider outcome and no external effect.
    'OUTBOX_CLAIMED'
  ));

ALTER TABLE effect_journal
  ADD COLUMN outbox_id                      TEXT,
  ADD COLUMN outbox_correlation_tag         TEXT,
  ADD COLUMN outbox_claim_id                TEXT,
  ADD COLUMN outbox_matched_row             INTEGER,
  ADD COLUMN outbox_mirror_state            TEXT,
  ADD COLUMN outbox_requires_unmirrored_tag BOOLEAN;

/*
 * The per-kind shape, extended.
 *
 * The five ACCEPTED arms are reproduced clause for clause with the six new columns added
 * as REQUIRED-ABSENT, which is how 0008 extended 0007's arm and how 0009 extended both:
 * an accepted row kind must not silently acquire a permissible new field.
 *
 * `outbox_id` is REQUIRED-ABSENT on `EFFECT_AUTHORISATION` in particular. A journal row
 * that authorised an effect knows nothing about an outbox row that did not exist when it
 * was written, and `30 §5.1` item 3's ordering is what makes that true.
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
         AND outbox_id                      IS NULL
         AND outbox_correlation_tag         IS NULL
         AND outbox_claim_id                IS NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND outbox_requires_unmirrored_tag IS NULL

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
         AND outbox_id                      IS NULL
         AND outbox_correlation_tag         IS NULL
         AND outbox_claim_id                IS NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND outbox_requires_unmirrored_tag IS NULL

      WHEN 'AUDIT_MIRROR_DEGRADED' THEN
             mirror_declaration_id          IS NOT NULL
         AND mirror_declaration_event       IS NOT NULL
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
         AND outbox_id                      IS NULL
         AND outbox_correlation_tag         IS NULL
         AND outbox_claim_id                IS NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND outbox_requires_unmirrored_tag IS NULL

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
         AND outbox_id                      IS NULL
         AND outbox_correlation_tag         IS NULL
         AND outbox_claim_id                IS NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND outbox_requires_unmirrored_tag IS NULL

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
         AND outbox_id                      IS NULL
         AND outbox_correlation_tag         IS NULL
         AND outbox_claim_id                IS NULL
         AND outbox_matched_row             IS NULL
         AND outbox_mirror_state            IS NULL
         AND outbox_requires_unmirrored_tag IS NULL

      /*
       * The claim row.
       *
       * `effect_id`, `authorisation_id` and `idempotency_key` ARE PRESENT, because the
       * claim is about one identified effect and a reader of the audit store must be able
       * to join it to the `EFFECT_AUTHORISATION` row that authorised it without holding
       * the control plane's outbox table.
       *
       * `decision_id`, `reservation_id`, `verdict`, the exposure block, the constructor
       * version and `policy_version` are REQUIRED-ABSENT. Every one of them is a fact
       * about the AUTHORISATION, it is already in the chained row that authorised the
       * effect, and duplicating an authority-bearing value into a second chained row
       * creates a second place it could disagree with itself.
       *
       * `outbox_requires_unmirrored_tag` is NOT NULL, so a claim row cannot omit `§16`'s
       * requirement. `outbox_matched_row` is NOT NULL, so it cannot omit WHY.
       */
      WHEN 'OUTBOX_CLAIMED' THEN
             outbox_id                      IS NOT NULL
         AND outbox_correlation_tag         IS NOT NULL
         AND outbox_claim_id                IS NOT NULL
         AND outbox_matched_row             IS NOT NULL
         AND outbox_mirror_state            IS NOT NULL
         AND outbox_requires_unmirrored_tag IS NOT NULL
         AND effect_id                      IS NOT NULL
         AND authorisation_id               IS NOT NULL
         AND idempotency_key                IS NOT NULL
         AND action_class                   IS NOT NULL
         AND resource_ref                   IS NOT NULL
         AND dispatch_payload_hash          IS NOT NULL
         AND decision_id                    IS NULL
         AND reservation_id                 IS NULL
         AND approval_id                    IS NULL
         AND verdict                        IS NULL
         AND vendor_amount                  IS NULL
         AND total_exposure                 IS NULL
         AND forward_integral               IS NULL
         AND is_rate_class                  IS NULL
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
         -- `30 §5.7.2` item 5: an override-backed claim carries `override_id`. The
         -- override EVENT row is a separate row (item 7, "each as its own row"), so
         -- `override_event` and `override_actor` stay absent here.
         AND override_event                 IS NULL
         AND override_actor                 IS NULL

      ELSE FALSE
    END
  );

-- The claim row's own declared domains, mirroring the outbox table's.
ALTER TABLE effect_journal
  ADD CONSTRAINT journal_outbox_matched_row_declared
    CHECK (outbox_matched_row IS NULL OR outbox_matched_row IN (3, 4, 5)),
  ADD CONSTRAINT journal_outbox_mirror_state_declared
    CHECK (outbox_mirror_state IS NULL OR outbox_mirror_state IN
           ('NORMAL', 'UNCORROBORATED_STALL', 'CORROBORATED_DEGRADED'));

/*
 * The declared field order for `acos.journal.outbox_claimed.v1`.
 *
 * BRANCHES 1 THROUGH 5 ARE 0007's, 0008's AND 0009's TO THE BYTE. Same domain tags, same
 * field orders, same `acos_jcs1_*` calls, so every row already chained recomputes to the
 * `row_hash` it holds and the ACCEPTED `journal-sequencing.test.ts`,
 * `vc-a3-cross-implementation.test.ts` and `mirror-journal-rows.test.ts` oracles still
 * discriminate.
 *
 * BRANCH 6 is declared here for the first time. `30 §5.3` requires the order to be
 * "declared per row kind, in the specification"; the specification for this kind is
 * `docs/implementation/S1I-contract.md §5`, and `S1I-owner-clarifications.md S1I-C4`
 * records that v1.3.3 requires the CLAIM to exist without declaring a byte order for a
 * record of it — so the order is an implementation declaration and not an architecture
 * quotation, exactly as S1H's three kinds were.
 *
 * The audit plane transcribes the same order INDEPENDENTLY in `A0005`, and
 * `outbox-journal-rows.test.ts` judges both against a hand-authored fourth reading in
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
      || acos_jcs1_field(acos_jcs1_ts   (row_in.occurred_at))
      || acos_jcs1_field(acos_jcs1_bytes(row_in.prev_hash))

  END;
$fn$;


-- =================================================================================
-- PART 6 — THE CLAIM EMITTER
--
-- `30 §5.2`'s allocator and lock order, reused through the accepted
-- `journal_allocate_seq` that 0009 factored out. This function computes no chain value —
-- the accepted `effect_journal_chain` trigger still owns `prev_hash` and `row_hash`, and
-- supplying either from here would raise `I17D_CALLER_SUPPLIED_CHAIN`.
--
-- Written as a database function for the reason 0009 gave: the allocation and the lock are
-- one indivisible act, and an application taking the counter in one statement and
-- inserting in another would make `30 §5.2`'s "serialises all journal writes per company"
-- an application convention.
-- =================================================================================

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
    override_id, occurred_at
  ) VALUES (
    p_company_id, v_seq, 'OUTBOX_CLAIMED',
    p_outbox_id, p_claim_id, p_correlation_tag,
    p_effect_id, p_authorisation_id, p_idempotency_key, p_action_class, p_resource_ref,
    p_dispatch_payload_hash,
    p_matched_row, p_mirror_state, p_requires_tag,
    p_override_id, p_occurred_at
  );
  RETURN v_seq;
END;
$fn$;
