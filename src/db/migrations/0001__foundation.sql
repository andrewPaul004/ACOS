-- 0001 — Foundation: companies, the window registry, and the journal counter.
--
-- Architecture source:
--   51 §2   — named windows with declared ceilings
--   26 §10.1 — window.max_monetary : Money | UNBOUNDED, NOT NULLABLE
--   30 §5.2  — journal_counter(company_id PK, next_seq BIGINT)
--
-- S1A scope. This migration seeds NO windows. `51 §2`'s values are a signed
-- NON-PRODUCTION fixture and are inserted by test fixtures only. Seeding a production
-- ceiling on W_MONTH_ADSPEND is blocked by TB-08(a)
-- (`phase2-v1.3-implementation-brief.md §5`).

CREATE TABLE company (
  company_id     TEXT        PRIMARY KEY,
  name           TEXT        NOT NULL,
  -- `24 §3.1`: window instances are "evaluated in the company timezone on the database
  -- clock". The timezone is therefore a property of the company, never of the server.
  timezone       TEXT        NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL
);

-- `51 §2`. Windows are company-scoped named objects; grants reference them.
--
-- `26 §10.1`, on the typing, verbatim:
--   "window.max_monetary : Money | UNBOUNDED, not nullable. min(UNBOUNDED, x) = x.
--    0.00 means the window admits no monetary exposure and every reservation against it
--    denies. null is a schema violation, rejected at catalogue validation."
--
-- UNBOUNDED is a member of the declared type, not an absent value. It is represented
-- here as a per-ledger boolean rather than as NULL, precisely because NULL is forbidden.
-- See docs/implementation/S1A-implementation-log.md §4.
CREATE TABLE window_registry (
  company_id                  TEXT        NOT NULL REFERENCES company(company_id),
  window_id                   TEXT        NOT NULL,
  name                        TEXT        NOT NULL,

  -- `24 §3` K5 / `51 §2.1`. ROLLING is NOT_ADMISSIBLE_AT_MVP: "a continuously-ageing
  -- balance cannot be represented as one CHECK-constrained window_balance row".
  boundary_kind               TEXT        NOT NULL,
  period                      TEXT        NOT NULL,

  max_monetary                NUMERIC(18,2) NOT NULL,
  max_monetary_unbounded      BOOLEAN       NOT NULL,
  max_count                   BIGINT        NOT NULL,
  max_count_unbounded         BOOLEAN       NOT NULL,
  max_irrecoverable_units     BIGINT        NOT NULL,
  max_irrecoverable_unbounded BOOLEAN       NOT NULL,

  PRIMARY KEY (company_id, window_id),

  CONSTRAINT window_boundary_kind_declared
    CHECK (boundary_kind IN ('DISCRETE', 'ROLLING')),
  -- `51 §2.1`, and VC-S1: "a grant or fixture declaring ROLLING fails catalogue
  -- validation with NOT_ADMISSIBLE_AT_MVP".
  CONSTRAINT window_rolling_not_admissible_at_mvp
    CHECK (boundary_kind = 'DISCRETE'),
  CONSTRAINT window_period_declared
    CHECK (period IN ('DAY', 'MONTH', 'BALANCE')),
  CONSTRAINT window_ceilings_non_negative
    CHECK (max_monetary >= 0 AND max_count >= 0 AND max_irrecoverable_units >= 0)
);

-- `30 §5.2`, verbatim: "journal_seq must be gap-free per company, which forbids a
-- sequence. PostgreSQL sequences are non-transactional: nextval outside the transaction
-- leaves permanent gaps on rollback, and a gap is the one signal I17 reads as
-- suppression. The allocator is therefore a row."
--
-- S1A builds the counter row and its position in the lock order. It does NOT build the
-- journal, the local chain, ACOS-JCS-1 or the audit push — those are S1, not S1A.
CREATE TABLE journal_counter (
  company_id TEXT   PRIMARY KEY REFERENCES company(company_id),
  next_seq   BIGINT NOT NULL DEFAULT 1,
  CONSTRAINT journal_counter_monotonic CHECK (next_seq >= 1)
);
