-- A0008 — the audit plane's own reading of the v1.3.5 outcome taxonomy.
--
-- =================================================================================
-- WHAT THIS MIGRATION IS
--
-- `A0007` declared this plane's own domains for `dispatch_outcome_kind` and
-- `dispatch_effect_status`, and refused `PRESUMED_EXECUTED` because v1.3.4 left the
-- IRRECOVERABLE unknown branch's MIE consumption undeclared (`S1J-C1`). `25 §7.1` and
-- `25 §10.1` now declare both, and `25 §7.2` adds a fourth outcome kind and a terminal
-- status. This plane's domains widen to match.
--
-- IT IS THIS PLANE'S OWN READING, TAKEN FROM `25 §7.1`'s TABLE, and it is deliberately
-- NOT a copy of `src/db/migrations/0013__irrecoverable_units.sql`. `36 §0`: "agreement
-- two implementations obtain from one source is not a cross-implementation check." The
-- control plane refuses a row it cannot write; this plane refuses a row it is asked to
-- record. Two refusals, written from the artifact, on two databases under two roles.
--
-- THE FIELD ORDER IS UNCHANGED AND NO CANONICAL-BYTES FUNCTION IS REDEFINED HERE.
-- `phase2-v1.3.5-errata.md §5` declares `acos.journal.dispatch_outcome.v1`'s twenty
-- fields with fields 15/16 as the adjacent same-typed pair, which is exactly the order
-- `A0007` PART 2 already transcribes. Every row already chained recomputes to the
-- `row_hash` it holds.
--
-- `ADAPTER_FAILED` REMAINS ABSENT, AND NOW BY DECLARATION RATHER THAN BY OMISSION.
-- `25 §7.1`: "Retained for diagnostics only. **It carries no local outcome policy and
-- reaches no local state.**" `VERIFIED` and `NEVER_SENT` remain absent because
-- `25 §10.1`'s REALISE and never-sent RELEASE rows are reached only from independent
-- provider evidence, which does not exist in this plane either — `I20` and `I36`'s
-- verification leg both remain OPEN.
--
-- NO MIE QUANTITY IS ADDED TO `audit_journal`, AND NONE MAY BE.
-- `phase2-v1.3.5-errata.md §5`: "The outcome row records the state that implies the
-- movement; the ledger records the movement."
-- =================================================================================

ALTER TABLE audit_journal
  DROP CONSTRAINT audit_journal_dispatch_outcome_kind_declared,
  DROP CONSTRAINT audit_journal_dispatch_effect_status_declared;

ALTER TABLE audit_journal
  -- `25 §7.1`'s four-member taxonomy, minus the one member it declares reaches no state.
  ADD CONSTRAINT audit_journal_dispatch_outcome_kind_declared
    CHECK (dispatch_outcome_kind IS NULL
           OR dispatch_outcome_kind IN ('ADAPTER_RETURNED',
                                        'OUTCOME_UNKNOWN',
                                        'NOT_SENT_CONFIRMED')),

  -- `25 §7.1`'s "The declared non-terminal post-dispatch statuses are
  -- `DISPATCHED_AWAITING_VERIFICATION`, `DISPATCHED_OUTCOME_UNKNOWN` and
  -- `PRESUMED_EXECUTED`; the declared terminal one is `DISPATCH_NOT_SENT_CONFIRMED`."
  ADD CONSTRAINT audit_journal_dispatch_effect_status_declared
    CHECK (dispatch_effect_status IS NULL
           OR dispatch_effect_status IN ('DISPATCHED_AWAITING_VERIFICATION',
                                         'DISPATCHED_OUTCOME_UNKNOWN',
                                         'PRESUMED_EXECUTED',
                                         'DISPATCH_NOT_SENT_CONFIRMED')),

  -- THIS PLANE'S OWN READING OF THE C4 MATRIX — `25 §7.1`'s table, transcribed here from
  -- the artifact and not from the control plane's migration.
  --
  -- The audit plane holds no `recoverability` column, so it cannot check the class-keyed
  -- half. What it CAN check is the pairing that is class-independent, and both halves of
  -- it are load-bearing:
  --
  --   `NOT_SENT_CONFIRMED` ⟺ `DISPATCH_NOT_SENT_CONFIRMED`   (`§7.1` row 7, "any" class)
  --   `PRESUMED_EXECUTED`  ⟹ kind ∈ {`ADAPTER_RETURNED`, `OUTCOME_UNKNOWN`}
  --
  -- A pushed row that reached the terminal not-sent state from a kind that is not
  -- `NOT_SENT_CONFIRMED` — or that claims a presumption from a confirmed non-send — is
  -- refused by THIS database, on its own reading, before it is chained.
  ADD CONSTRAINT audit_journal_dispatch_not_sent_is_biconditional
    CHECK (dispatch_outcome_kind IS NULL
           OR ((dispatch_outcome_kind = 'NOT_SENT_CONFIRMED')
               = (dispatch_effect_status = 'DISPATCH_NOT_SENT_CONFIRMED'))),

  ADD CONSTRAINT audit_journal_dispatch_presumed_requires_sent_kind
    CHECK (dispatch_effect_status IS DISTINCT FROM 'PRESUMED_EXECUTED'
           OR dispatch_outcome_kind IN ('ADAPTER_RETURNED', 'OUTCOME_UNKNOWN'));
