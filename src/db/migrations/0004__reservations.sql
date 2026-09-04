-- 0004 — exposure_reservations.
--
-- Architecture source: registry §1.1 I2, I18a, I18b, I18c; §1.2 I31, I51;
-- `26 §2.1` (the exposure block); `26 §2.1.3` (the rate-class field table);
-- `26 §7` step R as restated by v1.3.1 erratum 1.
--
-- S1A builds the row and the constraints that make the rate-class handoff structurally
-- correct. It does NOT build the Effect Canonicaliser, so the exposure block's fields
-- arrive here from test fixtures rather than from a versioned constructor.

CREATE TABLE exposure_reservation (
  reservation_id      TEXT        PRIMARY KEY,
  company_id          TEXT        NOT NULL REFERENCES company(company_id),

  -- I31: "No Reservation row is created for an AuthorizationDecision that already holds
  -- one." Enforced by DB (unique on authorisation_id), per the registry's enforcement
  -- column.
  authorisation_id    TEXT        NOT NULL UNIQUE,

  action_class        TEXT        NOT NULL,
  resource_ref        TEXT        NOT NULL,

  -- `26 §2.1`'s exposure block, the three fields S1A needs.
  --
  -- amount == exposure.total_exposure, exactly, no tolerance (I18b).
  amount              NUMERIC(18,2) NOT NULL,
  -- NULL where the dispatched vendor request carries no monetary field (I18a's null
  -- branch). For a rate class this is always NULL — `26 §2.1.3`: "The dispatched request
  -- carries a rate, not a monetary effect."
  vendor_amount       NUMERIC(18,2),
  -- `phase2-v1.3.1-errata.md §1`, exact correction: forward_integral is "a separate
  -- field that is not a component of total_exposure" and it "enters I3 term 2 rather
  -- than the ordinary reservation".
  forward_integral    NUMERIC(18,2),

  -- Declared per `26 §2.1.3`: a rate-setting action class is a documented
  -- zero-monetary-reservation class. Recording it as a column lets the constraints
  -- below be structural rather than conventional.
  is_rate_class       BOOLEAN     NOT NULL,

  created_at          TIMESTAMPTZ NOT NULL,

  CONSTRAINT reservation_amount_non_negative CHECK (amount >= 0),

  -- I18c: "Where exposure.vendor_amount is non-null, exposure.total_exposure >=
  -- exposure.vendor_amount."
  CONSTRAINT i18c_total_ge_vendor
    CHECK (vendor_amount IS NULL OR amount >= vendor_amount),

  -- `26 §2.1.3`'s rate-class field table, made structural. All three rows of it:
  --   vendor_amount = NULL, total_exposure = 0.00, forward_integral = the whole
  --   economic exposure.
  CONSTRAINT rate_class_zero_reservation
    CHECK (NOT is_rate_class OR (amount = 0.00 AND vendor_amount IS NULL)),

  -- The E1 consistency condition, enforced against data rather than against prose:
  -- "forward_integral is never the ordinary reservation amount."
  --
  -- A rate class carries a non-zero forward_integral and a zero amount. If an
  -- implementation ever placed the forward integral into the reservation amount, the
  -- row would carry amount = forward_integral > 0 with is_rate_class true, and this
  -- constraint refuses it. The negative control in
  -- tests/negative-controls/ demonstrates the refusal.
  CONSTRAINT e1_forward_integral_is_not_the_reservation
    CHECK (NOT is_rate_class
           OR forward_integral IS NULL
           OR (amount = 0.00 AND forward_integral >= 0)),

  CONSTRAINT non_rate_class_carries_no_forward_integral
    CHECK (is_rate_class OR forward_integral IS NULL)
);


-- I51: "no effect is dispatched whose recomputed exposure exceeds its held reservation,
-- and verify mode never increases a reservation amount."
-- Enforcement, per the registry: "DB (trigger reservation_no_increase, refusing any
-- UPDATE where NEW.amount > OLD.amount)".
--
-- Included in S1A because it is two lines and because omitting it would leave the
-- reservation row mutable in a way no later increment would think to check.
CREATE FUNCTION reservation_no_increase() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.amount > OLD.amount THEN
    RAISE EXCEPTION 'I51_RESERVATION_INCREASE_REFUSED'
      USING ERRCODE = 'ACS51',
            DETAIL  = format('attempted %s -> %s on reservation %s',
                             OLD.amount, NEW.amount, OLD.reservation_id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER reservation_no_increase
  BEFORE UPDATE ON exposure_reservation
  FOR EACH ROW EXECUTE FUNCTION reservation_no_increase();


-- Which window instances a reservation reserved against. `26 §7` step R: an effect
-- reserves "against every named window instance the matching grants reference" and
-- fails "if any lacks headroom".
CREATE TABLE reservation_window_instance (
  reservation_id      TEXT NOT NULL REFERENCES exposure_reservation(reservation_id),
  company_id          TEXT NOT NULL,
  window_id           TEXT NOT NULL,
  window_instance_key TEXT NOT NULL,
  amount              NUMERIC(18,2) NOT NULL,
  PRIMARY KEY (reservation_id, window_id, window_instance_key),
  FOREIGN KEY (company_id, window_id, window_instance_key)
    REFERENCES window_balance(company_id, window_id, window_instance_key),
  CONSTRAINT rwi_amount_non_negative CHECK (amount >= 0)
);
