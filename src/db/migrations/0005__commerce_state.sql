-- 0005 — S1C: authoritative RECORD-grade commerce state, and the enumeration record.
--
-- Architecture source:
--   24 §3 K4  — the canonicaliser "fetches the authoritative state itself, under the
--               existing entity advisory lock (25 §14)" and "enumerates the permissible
--               effects for (action_class, resource) — for a refund, the refundable line
--               items and the remaining maximum per item"
--   26 §8     — "The refund enumeration is two-dimensional over (line, parent_transaction)
--               with content-addressed option_ids"
--   26 §2.0.1 — enumerate_effects; resource_ref "must resolve to a RECORD-grade entity
--               inside the task's context_spec scope"
--   26 §2.2   — refund.create's semantic_option_digest:
--               line_id · parent_transaction_id · amount · instrument · reason_code_scope
--
-- S1C scope. This is the MINIMUM authoritative commerce state needed to enumerate refund
-- options. It is NOT a commerce model, NOT a Shopify or Stripe schema, and NOT a claim
-- that these are the columns a real integration needs. It is the state the architecture's
-- own refund enumeration reads, and nothing else.
--
-- ---------------------------------------------------------------------------------
-- NO VENDOR, AND NO ECONOMIC RULE
--
-- There is no fee schedule here, no rate and no formula. S1B owner clarification S1B-C3a,
-- verbatim: "ACOS does not know a fee schedule at S1B. It knows a fee AMOUNT, supplied by
-- the kernel from an authoritative record, together with the reference of the record it
-- came from."  `commerce_refund_retained_fee` IS that record. S1C makes it real; it does
-- not invent the rule that would populate it in production.
--
-- Recorded as S1C implementation fixture S1C-C1 and S1C-C2.
-- ---------------------------------------------------------------------------------

-- The resource. `26 §2.0.1`: a resource_ref resolves to a RECORD-grade entity or the
-- enumeration returns nothing.
CREATE TABLE commerce_order (
  company_id        TEXT NOT NULL REFERENCES company(company_id),
  order_id          TEXT NOT NULL,

  -- The model-facing name, e.g. 'order:ORD-123'. The kernel resolves resource_ref -> the
  -- row; `26 §2.1` requires the resource to be "resolved from resource_ref".
  resource_ref      TEXT NOT NULL,

  -- `24 §2`'s evidence grades. `26 §8`: "resource.grade == 'RECORD'".
  grade             TEXT NOT NULL,

  -- `26 §2.1`: "the single ledger currency". Carried on the order so a cross-currency
  -- order is representable and refuses rather than being silently reinterpreted.
  currency          TEXT NOT NULL,

  -- `26 §2.1`: "NEW | RETURNING | null — the payer of the original transaction, NOT a
  -- counterparty". `26 §1` Corollary 1 is emphatic that conflating the two is the error.
  customer_novelty  TEXT NOT NULL,

  PRIMARY KEY (company_id, order_id),

  -- resource_ref must name exactly one order, or "resolve from resource_ref" is ambiguous.
  CONSTRAINT commerce_order_resource_ref_unique UNIQUE (company_id, resource_ref),

  CONSTRAINT commerce_order_grade_declared
    CHECK (grade IN ('RECORD', 'OBSERVATION', 'CLAIM', 'DECISION_DELEGATED')),
  CONSTRAINT commerce_order_customer_novelty_declared
    CHECK (customer_novelty IN ('NEW', 'RETURNING'))
);

-- Dimension 1 of the two-dimensional enumeration: the refundable line items.
CREATE TABLE commerce_order_line (
  company_id           TEXT NOT NULL,
  order_id             TEXT NOT NULL,
  line_id              TEXT NOT NULL,

  -- `24 §3` K4: "the refundable line items and the remaining maximum per item".
  --
  -- This is CURRENT POLICY STATE, not effect identity: `26 §8` reads
  -- context.selected_option.line_refundable_remaining, and S1B.2 finding 2 keeps it OUT of
  -- semantic_option_digest deliberately. A concurrent partial refund moves it, which is
  -- exactly the CAN-03 mutation VC-C3 injects.
  refundable_remaining NUMERIC(18,2) NOT NULL,

  PRIMARY KEY (company_id, order_id, line_id),
  FOREIGN KEY (company_id, order_id) REFERENCES commerce_order(company_id, order_id),

  CONSTRAINT commerce_order_line_refundable_non_negative
    CHECK (refundable_remaining >= 0)
);

-- Dimension 2: the parent transactions a refund may be issued against.
--
-- `26 §8`, verbatim: "instrument is enumerated, not asserted (SR-R3, RES-10, CAN-07). The
-- refund enumeration is two-dimensional over (line, parent_transaction) with
-- content-addressed option_ids, so this line tests an enumerated property."
CREATE TABLE commerce_parent_transaction (
  company_id             TEXT NOT NULL,
  order_id               TEXT NOT NULL,
  parent_transaction_id  TEXT NOT NULL,

  -- `26 §8`'s policy operand `context.selected_option.instrument == "original"`, and a
  -- member of refund.create's semantic_option_digest (`26 §2.2`).
  instrument             TEXT NOT NULL,

  -- The remaining refundable amount ON THE TRANSACTION, which bounds any refund issued
  -- against it independently of the line's own remaining balance.
  refundable_remaining   NUMERIC(18,2) NOT NULL,

  PRIMARY KEY (company_id, order_id, parent_transaction_id),
  FOREIGN KEY (company_id, order_id) REFERENCES commerce_order(company_id, order_id),

  CONSTRAINT commerce_parent_transaction_refundable_non_negative
    CHECK (refundable_remaining >= 0)
);

-- The authoritative retained processing fee — S1B-C3a made real, and NOTHING MORE.
--
-- `51 §5.1`, verbatim: "Settled cost is fully determined pre-dispatch: refund amount plus
-- the processor's published retained fee."
--
-- An AMOUNT and the reference of the record it was read from. Not a rate, not a
-- percentage, not a rounding rule. `26 §2.1.1`: "a developer resolving the contradiction
-- by driving cost_components to zero silently restores the v1.0 defect R1 exists to
-- close" — so a (line, parent_transaction) pair with no fee record is NOT enumerable at
-- all, rather than enumerable with a zero fee.
CREATE TABLE commerce_refund_retained_fee (
  company_id            TEXT NOT NULL,
  order_id              TEXT NOT NULL,
  line_id               TEXT NOT NULL,
  parent_transaction_id TEXT NOT NULL,

  amount                NUMERIC(18,2) NOT NULL,
  currency              TEXT NOT NULL,
  -- Recorded onto the emitted CostComponent.sourceRef, so the audit trail names the record
  -- rather than a formula. That is the whole point of S1B-C3a.
  source_ref            TEXT NOT NULL,

  PRIMARY KEY (company_id, order_id, line_id, parent_transaction_id),
  FOREIGN KEY (company_id, order_id, line_id)
    REFERENCES commerce_order_line(company_id, order_id, line_id),
  FOREIGN KEY (company_id, order_id, parent_transaction_id)
    REFERENCES commerce_parent_transaction(company_id, order_id, parent_transaction_id),

  CONSTRAINT commerce_refund_retained_fee_non_negative CHECK (amount >= 0)
);

-- ---------------------------------------------------------------------------------
-- The enumeration record — the STALENESS AND LINEAGE SUBSTRATE.
--
-- THIS IS NOT THE VC-C2 READ JOURNAL, and S1C does not claim it is.
--
-- `36 §2` VC-C2 requires enumeration to be "journaled with journal_row_kind = READ" — a
-- row that "takes a journal_seq, it chains, it mirrors". None of that is here: no
-- journal_seq, no chain hash, no audit mirror, no quota. Building a table with those
-- columns and none of that machinery would be worse than not building it, because a later
-- reader would take the columns for the property.
--
-- What this table IS: the kernel's own record of the enumerations it computed, so that
-- step C′ can resolve `enumeration_ref.computed_at` from KERNEL STATE rather than from
-- anything the model supplied. `26 §2.0.1` requires computed_at to exist "for the class's
-- max_age check at C′", and a computed_at the proposer could influence would make the
-- staleness check evaluate a figure its subject chose — `26 §1` Corollary 3, exactly.
--
-- The journal row, the sequence, the chain, the mirror and the quota belong to the
-- journal/control slice. `S1C-result.md` reports VC-C2 journaling/quota as OPEN.
-- ---------------------------------------------------------------------------------
CREATE TABLE enumeration_record (
  company_id           TEXT        NOT NULL REFERENCES company(company_id),

  -- Opaque to the model. Content-addressed; the preimage is S1C fixture decision S1C-C6.
  enumeration_id       TEXT        NOT NULL,

  -- The binding fields. An enumeration computed for one (task, principal, class, resource)
  -- may not be paired at C′ with a selector for another — otherwise the enumeration_id
  -- half of the content address carries no information and the pair is only as strong as
  -- the option_id alone.
  task_id              TEXT        NOT NULL,
  principal_id         TEXT        NOT NULL,
  action_class         TEXT        NOT NULL,
  resource_ref         TEXT        NOT NULL,
  resource_id          TEXT        NOT NULL,

  -- `26 §2.0.1`: "computed_at — for the class's max_age check at C′".
  computed_at          TIMESTAMPTZ NOT NULL,

  -- `26 §2.0.1`: "constructor_version — the constructor that produced this set".
  -- `I61`: recorded in every lineage position.
  constructor_id       TEXT        NOT NULL,
  constructor_semantic_major  INTEGER NOT NULL,
  constructor_non_semantic_minor INTEGER NOT NULL,
  constructor_record_hash     TEXT NOT NULL,

  -- The ordered options this enumeration RETURNED TO THE MODEL: `[{option_id, description}]`.
  --
  -- Both halves, deliberately. `26 §2.1` requires the AuthorizationRequest to record "the
  -- enumerated option whose option_id the selector names, **with its full description**",
  -- and "the enumerated option" means the one the model actually read — not one re-derived
  -- at C′ from whatever the task's context_spec says by then. Storing the projected
  -- description is what makes that a comparison against the model's own read rather than
  -- against a recomputation that shares every input with itself.
  --
  -- It is also I53's "re-derivable from the journaled enumeration" evidence, held here
  -- until the real journal row exists to hold it.
  options              JSONB       NOT NULL,

  PRIMARY KEY (company_id, enumeration_id),

  CONSTRAINT enumeration_record_versions_non_negative
    CHECK (constructor_semantic_major >= 0 AND constructor_non_semantic_minor >= 0)
);

CREATE INDEX enumeration_record_by_resource
  ON enumeration_record (company_id, action_class, resource_id, computed_at DESC);
