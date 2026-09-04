-- 0002 — window_balance, and the four-term commitment guard.
--
-- Architecture source: `24 §3` K5, declared there as
--   "the single authoritative schema specification for window_balance and for the
--    standing exposure it aggregates. No other artifact declares either."
--
-- Enforcement basis: `phase2-v1.3-invariant-registry.md §1.2` I3.
-- Verification cases: VC-L2 (`36 §2`), VC-S7, VC-S8.
--
-- The printed K5 schema, reproduced here so the migration can be diffed against it:
--
--   window_balance(
--     company_id, window_id, window_instance_key,                    -- PRIMARY KEY
--     reserved_monetary,      standing_monetary,      presumed_monetary,   realised_monetary,
--     reserved_count,         standing_count,         presumed_count,      realised_count,
--     reserved_irrecoverable,                         presumed_irrecoverable, realised_irrecoverable,
--     max_monetary, max_count, max_irrecoverable_units,              -- from the window registry, 51 §2
--     CHECK (reserved_monetary >= 0 AND standing_monetary >= 0
--        AND presumed_monetary >= 0 AND realised_monetary >= 0)      -- and likewise per ledger
--   )
--
-- Note the irrecoverable ledger has NO standing column in the printed schema. That is
-- not a term dropped from I3: I3's standing term is materialised from
-- standing_window_exposure.forward_monetary, which is monetary, and the count ledger's
-- standing term (standing_count) is declared. The irrecoverable guard is therefore
-- three-operand by the architecture's own schema. Recorded in
-- docs/implementation/S1A-implementation-log.md §3 so it is not read as a TB-01
-- regression.

CREATE TABLE window_balance (
  company_id                  TEXT NOT NULL,
  window_id                   TEXT NOT NULL,
  -- TB-02: the instance is part of the key. `24 §3.1`: "for example
  -- W_MONTH_ADSPEND:2026-01, evaluated in the company timezone on the database clock."
  window_instance_key         TEXT NOT NULL,

  -- Ledger 1 — monetary. I3's four terms.
  reserved_monetary           NUMERIC(18,2) NOT NULL DEFAULT 0,
  standing_monetary           NUMERIC(18,2) NOT NULL DEFAULT 0,
  presumed_monetary           NUMERIC(18,2) NOT NULL DEFAULT 0,
  realised_monetary           NUMERIC(18,2) NOT NULL DEFAULT 0,

  -- Ledger 2 — count.
  reserved_count              BIGINT NOT NULL DEFAULT 0,
  standing_count              BIGINT NOT NULL DEFAULT 0,
  presumed_count              BIGINT NOT NULL DEFAULT 0,
  realised_count              BIGINT NOT NULL DEFAULT 0,

  -- Ledger 3 — irrecoverable units. No standing column, per the printed schema.
  reserved_irrecoverable      BIGINT NOT NULL DEFAULT 0,
  presumed_irrecoverable      BIGINT NOT NULL DEFAULT 0,
  realised_irrecoverable      BIGINT NOT NULL DEFAULT 0,

  -- Ceilings, copied from the window registry (`51 §2`) at instance creation. They are
  -- copied rather than joined so the guard evaluates against NEW.* on one row with no
  -- second lock and no second row to order against.
  max_monetary                NUMERIC(18,2) NOT NULL,
  max_monetary_unbounded      BOOLEAN       NOT NULL,
  max_count                   BIGINT        NOT NULL,
  max_count_unbounded         BOOLEAN       NOT NULL,
  max_irrecoverable_units     BIGINT        NOT NULL,
  max_irrecoverable_unbounded BOOLEAN       NOT NULL,

  PRIMARY KEY (company_id, window_id, window_instance_key),
  FOREIGN KEY (company_id, window_id) REFERENCES window_registry(company_id, window_id),

  -- `24 §3` K5's printed CHECK, per ledger.
  CONSTRAINT window_balance_monetary_non_negative
    CHECK (reserved_monetary >= 0 AND standing_monetary >= 0
       AND presumed_monetary >= 0 AND realised_monetary >= 0),
  CONSTRAINT window_balance_count_non_negative
    CHECK (reserved_count >= 0 AND standing_count >= 0
       AND presumed_count >= 0 AND realised_count >= 0),
  CONSTRAINT window_balance_irrecoverable_non_negative
    CHECK (reserved_irrecoverable >= 0
       AND presumed_irrecoverable >= 0 AND realised_irrecoverable >= 0)
);


-- ---------------------------------------------------------------------------------
-- The commitment guard. This is the enforcement of I3.
-- ---------------------------------------------------------------------------------
--
-- `24 §3` K5, verbatim:
--
--   "The commitment guard is the enforcement of I3, and it carries all four terms
--    (TB-01, TB-04). A bare CHECK cannot express it, because the four-term sum must
--    gate a *commitment* while never refusing an *observation* [...] It is a
--    BEFORE UPDATE trigger on window_balance, per ledger:
--
--      IF (NEW.reserved_monetary  > OLD.reserved_monetary
--       OR NEW.standing_monetary  > OLD.standing_monetary
--       OR NEW.presumed_monetary  > OLD.presumed_monetary)
--         AND (NEW.reserved_monetary + NEW.standing_monetary
--            + NEW.presumed_monetary + NEW.realised_monetary) > NEW.max_monetary
--      THEN RAISE 'I3_WINDOW_EXHAUSTED';"
--
-- And the financial-truth rule the IF predicate implements, verbatim:
--
--   "An update that increases only realised passes the guard unconditionally, even
--    where the resulting four-term sum exceeds max_monetary. [...] The four terms still
--    bound what ACOS may newly commit: a realised increase shrinks the headroom
--    available to the next commitment, because the guard reads NEW.realised_monetary.
--    No term was dropped from the bound; what changed is which write the bound refuses."
--
-- The UNBOUNDED guard clause is NOT a fifth operand of the sum. It decides whether the
-- bound applies at all, per `26 §10.1`'s min(UNBOUNDED, x) = x. VC-L2's operand
-- assertion is written against the summed expression and holds.

CREATE FUNCTION i3_commitment_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  -- Ledger 1 — monetary. Four terms.
  IF (NEW.reserved_monetary  > OLD.reserved_monetary
   OR NEW.standing_monetary  > OLD.standing_monetary
   OR NEW.presumed_monetary  > OLD.presumed_monetary)
     AND NOT NEW.max_monetary_unbounded
     AND (NEW.reserved_monetary + NEW.standing_monetary
        + NEW.presumed_monetary + NEW.realised_monetary) > NEW.max_monetary
  THEN
    RAISE EXCEPTION 'I3_WINDOW_EXHAUSTED'
      USING ERRCODE = 'ACS03',
            DETAIL  = format(
              'ledger=monetary window=%s instance=%s reserved=%s standing=%s presumed=%s realised=%s ceiling=%s',
              NEW.window_id, NEW.window_instance_key,
              NEW.reserved_monetary, NEW.standing_monetary,
              NEW.presumed_monetary, NEW.realised_monetary, NEW.max_monetary);
  END IF;

  -- Ledger 2 — count. Four terms.
  IF (NEW.reserved_count  > OLD.reserved_count
   OR NEW.standing_count  > OLD.standing_count
   OR NEW.presumed_count  > OLD.presumed_count)
     AND NOT NEW.max_count_unbounded
     AND (NEW.reserved_count + NEW.standing_count
        + NEW.presumed_count + NEW.realised_count) > NEW.max_count
  THEN
    RAISE EXCEPTION 'I3_WINDOW_EXHAUSTED'
      USING ERRCODE = 'ACS03',
            DETAIL  = format(
              'ledger=count window=%s instance=%s reserved=%s standing=%s presumed=%s realised=%s ceiling=%s',
              NEW.window_id, NEW.window_instance_key,
              NEW.reserved_count, NEW.standing_count,
              NEW.presumed_count, NEW.realised_count, NEW.max_count);
  END IF;

  -- Ledger 3 — irrecoverable units. Three terms; the printed K5 schema declares no
  -- standing_irrecoverable column. See the header note.
  IF (NEW.reserved_irrecoverable  > OLD.reserved_irrecoverable
   OR NEW.presumed_irrecoverable  > OLD.presumed_irrecoverable)
     AND NOT NEW.max_irrecoverable_unbounded
     AND (NEW.reserved_irrecoverable
        + NEW.presumed_irrecoverable + NEW.realised_irrecoverable) > NEW.max_irrecoverable_units
  THEN
    RAISE EXCEPTION 'I3_WINDOW_EXHAUSTED'
      USING ERRCODE = 'ACS03',
            DETAIL  = format(
              'ledger=irrecoverable window=%s instance=%s reserved=%s presumed=%s realised=%s ceiling=%s',
              NEW.window_id, NEW.window_instance_key,
              NEW.reserved_irrecoverable,
              NEW.presumed_irrecoverable, NEW.realised_irrecoverable, NEW.max_irrecoverable_units);
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER i3_commitment_guard
  BEFORE UPDATE ON window_balance
  FOR EACH ROW EXECUTE FUNCTION i3_commitment_guard();


-- ---------------------------------------------------------------------------------
-- Incidents. `24 §3` K5's financial-truth rule names two, and insists on the
-- classification distinction:
--
--   "Exceeding raises WINDOW_CEILING_BREACHED, and where the excess is attributable to
--    a standing authorisation's vendor overdelivery, STANDING_OVERDELIVERY — a distinct
--    incident type, deliberately NOT I3's security path. A vendor billing artefact is
--    not evidence that the control model was breached."
--
-- `incident_path` exists so that distinction is an asserted column value rather than a
-- convention. VC-S8 asserts STANDING_OVERDELIVERY carries FINANCIAL_TRUTH.
-- ---------------------------------------------------------------------------------

CREATE TABLE incident (
  incident_id         BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  company_id          TEXT        NOT NULL,
  incident_type       TEXT        NOT NULL,
  incident_path       TEXT        NOT NULL,
  severity            TEXT        NOT NULL,
  window_id           TEXT,
  window_instance_key TEXT,
  standing_authorization_id TEXT,
  detail              TEXT        NOT NULL,
  raised_at           TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT incident_path_declared
    CHECK (incident_path IN ('SECURITY', 'FINANCIAL_TRUTH')),
  CONSTRAINT incident_severity_declared
    CHECK (severity IN ('INFO', 'WARNING', 'CRITICAL'))
);


-- Financial truth is always writable, and exceeding the ceiling is an incident rather
-- than a refusal. This is an AFTER trigger: the write has already succeeded by the time
-- it runs, which is the point.
CREATE FUNCTION window_ceiling_breach_detector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.realised_monetary > OLD.realised_monetary
     AND NOT NEW.max_monetary_unbounded
     AND (NEW.reserved_monetary + NEW.standing_monetary
        + NEW.presumed_monetary + NEW.realised_monetary) > NEW.max_monetary
  THEN
    INSERT INTO incident (company_id, incident_type, incident_path, severity,
                          window_id, window_instance_key, detail)
    VALUES (NEW.company_id, 'WINDOW_CEILING_BREACHED', 'FINANCIAL_TRUTH', 'CRITICAL',
            NEW.window_id, NEW.window_instance_key,
            format('four-term sum %s exceeds ceiling %s after a realised increase of %s',
                   NEW.reserved_monetary + NEW.standing_monetary
                     + NEW.presumed_monetary + NEW.realised_monetary,
                   NEW.max_monetary,
                   NEW.realised_monetary - OLD.realised_monetary));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER window_ceiling_breach_detector
  AFTER UPDATE ON window_balance
  FOR EACH ROW EXECUTE FUNCTION window_ceiling_breach_detector();
