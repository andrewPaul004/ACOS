-- 0003 — StandingAuthorization, standing_window_exposure, and the TB-04 atomicity
--        repair.
--
-- Architecture source: `24 §3` K5 (the entity and the schema), `24 §3.1` (the state
-- machine T1–T8 and the window-instance scoping rule), registry §1.2 I62.
-- Verification cases: VC-S2 (partial, S1A), VC-S5, VC-S7, VC-S8.

CREATE TABLE standing_authorization (
  standing_authorization_id TEXT        PRIMARY KEY,
  company_id                TEXT        NOT NULL REFERENCES company(company_id),
  action_class              TEXT        NOT NULL,
  resource_ref              TEXT        NOT NULL,
  adapter                   TEXT        NOT NULL,

  rate_amount               NUMERIC(18,2) NOT NULL,
  rate_currency             TEXT          NOT NULL,
  rate_period               TEXT          NOT NULL,

  -- `24 §3.1`: the in-scope interval is [s.created_at, s.expires_at + cessation_grace).
  created_at                TIMESTAMPTZ NOT NULL,
  expires_at                TIMESTAMPTZ NOT NULL,   -- MANDATORY, mirrors grant expiry
  cessation_grace_hours     INTEGER     NOT NULL,   -- 72 h, CONFIGURED (`51 §3.2`)

  revocation_effect_class   TEXT        NOT NULL,
  revocation_authority_id   TEXT        NOT NULL,

  -- `24 §3.1`: "status is therefore a stored column, not a generated one."
  status                    TEXT        NOT NULL,

  -- `I54`: REVOKED requires this. There is no path that sets it in S1A, because the
  -- per-adapter cessation specification is UNDECLARED (TB-07) and `51 §3.2`'s
  -- conservative default is "no REVOKED transition is available at MVP".
  cessation_verified_at     TIMESTAMPTZ,

  CONSTRAINT standing_status_declared
    CHECK (status IN ('LIVE', 'PAUSE_PENDING', 'PAUSED', 'EXPIRED', 'REVOKED')),
  CONSTRAINT standing_rate_positive
    CHECK (rate_amount > 0),
  CONSTRAINT standing_expiry_mandatory
    CHECK (expires_at > created_at),
  -- I54: REVOKED is unreachable without cessation verification.
  CONSTRAINT standing_revoked_requires_cessation
    CHECK (status <> 'REVOKED' OR cessation_verified_at IS NOT NULL)
);


-- `24 §3` K5 / SR-S3 / STD-03. Created by the kernel atomically with the
-- StandingAuthorization (I55), so one cannot exist without the other.
--
-- S1A creates the ROW ONLY. Its dispatch path, `26 §7.1`'s KERNEL_SERVICE branch, and
-- I55's sweep are S1, not S1A. See docs/implementation/S1A-contract.md §8.2.
CREATE TABLE standing_revocation_authority (
  revocation_authority_id   TEXT        PRIMARY KEY,
  company_id                TEXT        NOT NULL REFERENCES company(company_id),
  standing_authorization_id TEXT        NOT NULL UNIQUE,
  action_class_selector     TEXT        NOT NULL,   -- singleton: the revocation_effect_class
  resource_selector         TEXT        NOT NULL,   -- equality on one resource_ref
  per_action_max_monetary   NUMERIC(18,2) NOT NULL,
  expires_at                TIMESTAMPTZ NOT NULL,   -- = grant.expires_at + cessation_grace
  created_by                TEXT        NOT NULL,
  -- `24 §3` K5's printed authority: per_action_max { monetary: 0.00, ... }.
  CONSTRAINT sra_zero_monetary CHECK (per_action_max_monetary = 0.00),
  CONSTRAINT sra_created_by_kernel CHECK (created_by = 'KERNEL')
);

ALTER TABLE standing_authorization
  ADD CONSTRAINT standing_revocation_authority_fk
  FOREIGN KEY (revocation_authority_id)
  REFERENCES standing_revocation_authority(revocation_authority_id)
  DEFERRABLE INITIALLY DEFERRED;


-- ---------------------------------------------------------------------------------
-- standing_window_exposure. `24 §3` K5, printed verbatim in the header of 0002.
-- ---------------------------------------------------------------------------------
--
-- `24 §3` K5 on forward_monetary, verbatim:
--
--   "forward_monetary is a generated column over (standing_cap_monetary,
--    realised_monetary). It is not independently writable, by anyone, including the
--    control plane. Only one primitive changes."
--
-- And on why it is generated per authorisation rather than on the aggregate, verbatim:
--
--   "max(0, ·) does not distribute over sums: max(0, Σcap − Σrealised) is smaller than
--    Σ max(0, cap_i − realised_i) whenever one authorisation has overrun, so an
--    aggregate generated column would silently under-reserve. Generating at the level
--    where the identity is valid and aggregating by trigger keeps the conservative
--    form."

CREATE TABLE standing_window_exposure (
  standing_authorization_id TEXT NOT NULL REFERENCES standing_authorization(standing_authorization_id),
  window_id                 TEXT NOT NULL,
  window_instance_key       TEXT NOT NULL,
  company_id                TEXT NOT NULL,

  standing_cap_monetary     NUMERIC(18,2) NOT NULL,   -- authoritative primitive
  realised_monetary         NUMERIC(18,2) NOT NULL DEFAULT 0,   -- authoritative primitive

  forward_monetary          NUMERIC(18,2)
                              GENERATED ALWAYS AS
                                (GREATEST(0, standing_cap_monetary - realised_monetary)) STORED,

  instance_in_scope         BOOLEAN NOT NULL,   -- §3.1's in-scope rule

  PRIMARY KEY (standing_authorization_id, window_id, window_instance_key),
  FOREIGN KEY (company_id, window_id, window_instance_key)
    REFERENCES window_balance(company_id, window_id, window_instance_key),

  CONSTRAINT swe_primitives_non_negative
    CHECK (standing_cap_monetary >= 0 AND realised_monetary >= 0)
);

CREATE INDEX standing_window_exposure_by_instance
  ON standing_window_exposure (company_id, window_id, window_instance_key)
  INCLUDE (forward_monetary, instance_in_scope);


-- ---------------------------------------------------------------------------------
-- The TB-04 repair: realised and standing move in one statement.
-- ---------------------------------------------------------------------------------
--
-- `24 §3` K5, verbatim:
--
--   "2. The spend reconciler's update is one statement against standing_window_exposure,
--       and a trigger in the same statement recomputes window_balance.standing_monetary
--       as Σ forward_monetary WHERE instance_in_scope and increments
--       window_balance.realised_monetary by the same delta. Both terms move together or
--       neither does."
--
-- And the defect this removes, verbatim:
--
--   "realised-first transiently breached the CHECK and blocked the financial-truth path;
--    standing-first transiently created headroom a concurrent authorisation could
--    consume without touching any lock associated with the standing authorisation. The
--    repair removes the choice."
--
-- This trigger is what makes the choice unavailable. There is no code path — production
-- or otherwise — that can move one without the other, because the only writable
-- primitives are on standing_window_exposure and this trigger fires on every one of
-- them.

CREATE FUNCTION standing_exposure_sync() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  v_company   TEXT;
  v_window    TEXT;
  v_instance  TEXT;
  v_delta     NUMERIC(18,2);
  v_standing  NUMERIC(18,2);
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_company  := OLD.company_id;
    v_window   := OLD.window_id;
    v_instance := OLD.window_instance_key;
    v_delta    := 0;
  ELSE
    v_company  := NEW.company_id;
    v_window   := NEW.window_id;
    v_instance := NEW.window_instance_key;
    v_delta    := NEW.realised_monetary - COALESCE(OLD.realised_monetary, 0);
  END IF;

  -- Σ forward_monetary WHERE instance_in_scope, for this (company, window, instance).
  -- Note this is Σ max(0, cap_i − realised_i), never max(0, Σcap − Σrealised): the
  -- max(0, ·) has already been applied per row by the generated column, and this
  -- statement only sums. The architecture explicitly rejects the other transformation.
  SELECT COALESCE(SUM(forward_monetary), 0)
    INTO v_standing
    FROM standing_window_exposure
   WHERE company_id = v_company
     AND window_id = v_window
     AND window_instance_key = v_instance
     AND instance_in_scope;

  UPDATE window_balance
     SET standing_monetary = v_standing,
         realised_monetary = realised_monetary + v_delta
   WHERE company_id = v_company
     AND window_id = v_window
     AND window_instance_key = v_instance;

  RETURN NULL;
END;
$$;

-- AFTER, per row, on every write to the table. The two window_balance terms therefore
-- move inside the same statement as the standing_window_exposure write. There is no
-- interval, observable by anyone, in which one has moved and the other has not.
CREATE TRIGGER standing_exposure_sync
  AFTER INSERT OR UPDATE OR DELETE ON standing_window_exposure
  FOR EACH ROW EXECUTE FUNCTION standing_exposure_sync();


-- STANDING_OVERDELIVERY. `24 §3` K5: raised "where the excess is attributable to a
-- standing authorisation's vendor overdelivery [...] a distinct incident type,
-- deliberately NOT I3's security path."
--
-- The attributable condition is exactly: this authorisation's realised spend in this
-- instance exceeded the cap ACOS authorised for it.
CREATE FUNCTION standing_overdelivery_detector() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.realised_monetary > NEW.standing_cap_monetary
     AND COALESCE(OLD.realised_monetary, 0) <= NEW.standing_cap_monetary
  THEN
    INSERT INTO incident (company_id, incident_type, incident_path, severity,
                          window_id, window_instance_key, standing_authorization_id, detail)
    VALUES (NEW.company_id, 'STANDING_OVERDELIVERY', 'FINANCIAL_TRUTH', 'CRITICAL',
            NEW.window_id, NEW.window_instance_key, NEW.standing_authorization_id,
            format('vendor delivered %s against an authorised standing_cap of %s',
                   NEW.realised_monetary, NEW.standing_cap_monetary));
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER standing_overdelivery_detector
  AFTER INSERT OR UPDATE ON standing_window_exposure
  FOR EACH ROW EXECUTE FUNCTION standing_overdelivery_detector();


-- ---------------------------------------------------------------------------------
-- I62 — the transition trigger.
-- ---------------------------------------------------------------------------------
--
-- Registry §1.2 I62, verbatim:
--   "Every StandingAuthorization transition is in the declared transition set of
--    24 §3.1 (T1–T8), and REVOKED has no outbound transition."
-- Enforcement, verbatim:
--   "DB (BEFORE UPDATE trigger over (OLD.status, NEW.status) against the declared set)"
--
-- `24 §3.1` corrects v1.2's "any → EXPIRED", because "any literally includes REVOKED: a
-- revoked authorisation would re-enter EXPIRED at expires_at, re-acquiring forward
-- exposure it had already released". The source set for T4–T6 is therefore the explicit
-- {LIVE, PAUSE_PENDING, PAUSED}.

CREATE TABLE standing_transition_set (
  transition_id TEXT PRIMARY KEY,
  from_status   TEXT NOT NULL,
  to_status     TEXT NOT NULL,
  UNIQUE (from_status, to_status)
);

INSERT INTO standing_transition_set (transition_id, from_status, to_status) VALUES
  ('T1', 'LIVE',          'PAUSE_PENDING'),
  ('T2', 'PAUSE_PENDING', 'PAUSED'),
  ('T3', 'PAUSE_PENDING', 'PAUSE_PENDING'),
  ('T4', 'LIVE',          'EXPIRED'),
  ('T5', 'PAUSE_PENDING', 'EXPIRED'),
  ('T6', 'PAUSED',        'EXPIRED'),
  ('T7', 'PAUSED',        'REVOKED'),
  ('T8', 'EXPIRED',       'REVOKED');
-- REVOKED has zero outbound rows. That is the whole of the REVOKED → EXPIRED refusal.

CREATE FUNCTION i62_transition_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.status = 'PAUSE_PENDING'   -- T3 is a self-transition and must be declarable
  THEN
    IF NEW.status = OLD.status AND NEW.status <> 'PAUSE_PENDING' THEN
      RETURN NEW;   -- an update that does not touch status
    END IF;
    IF NOT EXISTS (SELECT 1 FROM standing_transition_set
                    WHERE from_status = OLD.status AND to_status = NEW.status)
    THEN
      RAISE EXCEPTION 'I62_ILLEGAL_TRANSITION'
        USING ERRCODE = 'ACS62',
              DETAIL  = format('%s -> %s is not in the declared transition set T1-T8',
                               OLD.status, NEW.status);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER i62_transition_guard
  BEFORE UPDATE ON standing_authorization
  FOR EACH ROW EXECUTE FUNCTION i62_transition_guard();
