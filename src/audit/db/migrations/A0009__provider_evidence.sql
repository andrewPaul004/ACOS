-- A0009 — AUTHENTICATED PROVIDER EVIDENCE. v1.3.8, ADR-027, `48 §8`, `50 §2h` (`S1P-WR`).
--
-- =================================================================================
-- WHAT THIS STORE HOLDS, AND THE ONE THING IT NEVER HOLDS
--
-- `SIGNED_PROVIDER_PUSH` evidence, after the provider's signature verified under the class-28
-- trust root and BEFORE any 2xx is returned (ADR-027 decision 4, step 9 then step 10).
--
-- `phase2-v1.3.8-errata.md §5`, verbatim in substance: after successful verification ACOS may
-- persist only the provider id, the evidence-channel identity, the verification-key identity,
-- the provider event identity, the provider message identity, the event type, the ACOS
-- correlation tag, the provider event timestamp, the ACOS received-at time, the authenticated
-- raw-body hash, verification metadata, and a batch identity. **It may NOT persist** the raw
-- webhook body, the recipient address, the sender address, the subject or body, provider
-- response text, or arbitrary provider payload.
--
-- SO NO COLUMN BELOW CAN HOLD ANY OF THOSE. There is no `body`, no `payload`, no `email`, no
-- `jsonb` and no free-text provider field anywhere in this file. The raw body exists
-- transiently, for signature verification, and only its SHA-256 is kept.
--
-- =================================================================================
-- THREE TABLES
--
--   provider_evidence_observation   one row per AUTHENTICATED POST: COMPLETE or INCOMPLETE,
--                                   with a closed reason code when INCOMPLETE. A receipt, not
--                                   evidence of any message.
--   provider_evidence_event         one row per accepted-class PROVIDER EVENT identity. The
--                                   `I36` / `I20` operand rows. Written ONLY by a COMPLETE
--                                   observation; an INCOMPLETE observation writes no event row,
--                                   so a readable sibling can never become a trusted count.
--   provider_evidence_inconsistency one row when an already-recorded `sg_event_id` is presented
--                                   again under a valid signature with DIFFERENT normalised
--                                   semantic fields. Never an overwrite; surfaced for review.
--
-- `sg_event_id` UNIQUENESS IS ENFORCED HERE, BY THE DATABASE. The ingest path's
-- `ON CONFLICT DO NOTHING` followed by a confirming read is the deduplication; an in-memory
-- set is not one. Two concurrent deliveries of one event identity leave exactly one row.
--
-- APPEND-ONLY. UPDATE, DELETE and TRUNCATE are refused by trigger on all three, as on every
-- other audit holding: evidence that can be edited after acknowledgement is not evidence.
-- =================================================================================

-- ---------------------------------------------------------------------------------
-- THE INGRESS ROLE
--
-- `48 §8`: the receiver may hold "write access to the audit-side provider-evidence store" and
-- nothing else of the store. So `acos_audit_evidence_ingress` gets INSERT and SELECT on these
-- three tables and NOTHING on `audit_journal`, `audit_incident`, the quota ledger or any
-- signal table. SELECT is required because a redelivered event is acknowledged only after the
-- ORIGINAL durable row is confirmed present (ADR-027 decision 4a).
--
-- The evaluator (`acos_audit_evaluator`) gets SELECT — it is the audit plane's own reader, and
-- the provider-evidence observation API reads as it. The control plane's replication role and
-- the signal reader get nothing here.
--
-- The password is a local development value, committed for the reason `A0001` records.
-- ---------------------------------------------------------------------------------

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'acos_audit_evidence_ingress') THEN
    CREATE ROLE acos_audit_evidence_ingress LOGIN PASSWORD 'acos_audit_ingress_dev';
  END IF;
END;
$roles$;

DO $connect$
BEGIN
  EXECUTE format('GRANT CONNECT ON DATABASE %I TO acos_audit_evidence_ingress',
                 current_database());
END;
$connect$;

GRANT USAGE ON SCHEMA public TO acos_audit_evidence_ingress;

SET LOCAL ROLE acos_audit_owner;

-- ---------------------------------------------------------------------------------
-- OBSERVATIONS — one per authenticated POST.
-- ---------------------------------------------------------------------------------

CREATE TABLE provider_evidence_observation (
  observation_id               BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider                     TEXT        NOT NULL,
  -- The class-28 artifact the trust root was read from: its verified content hash and its
  -- declared version. Together with `provider` this is the evidence-channel identity.
  trust_artifact_digest        TEXT        NOT NULL,
  trust_artifact_version       TEXT        NOT NULL,
  key_identity                 TEXT        NOT NULL,
  verification_profile         TEXT        NOT NULL,
  -- The EXACT timestamp header value, as text. Never re-rendered from a number.
  provider_signature_timestamp TEXT        NOT NULL,
  received_at                  TIMESTAMPTZ NOT NULL,
  raw_body_sha256              TEXT        NOT NULL,
  status                       TEXT        NOT NULL,
  incomplete_reason            TEXT,
  -- How many array elements the authenticated body carried, and how many were accepted-class
  -- events. Counts only; nothing about any element's content.
  element_count                INTEGER     NOT NULL,
  accepted_class_event_count   INTEGER     NOT NULL,

  CONSTRAINT provider_evidence_observation_provider_shape
    CHECK (provider ~ '^[a-z0-9][a-z0-9_.-]{0,63}$'),
  CONSTRAINT provider_evidence_observation_digest_shape
    CHECK (trust_artifact_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT provider_evidence_observation_version_present
    CHECK (length(trust_artifact_version) BETWEEN 1 AND 128),
  CONSTRAINT provider_evidence_observation_key_identity_shape
    CHECK (key_identity ~ '^[0-9a-f]{64}$'),
  CONSTRAINT provider_evidence_observation_profile_declared
    CHECK (verification_profile = 'SENDGRID_EVENT_WEBHOOK_V1'),
  CONSTRAINT provider_evidence_observation_timestamp_digits
    CHECK (provider_signature_timestamp ~ '^[0-9]{1,32}$'),
  CONSTRAINT provider_evidence_observation_body_hash_shape
    CHECK (raw_body_sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT provider_evidence_observation_status_declared
    CHECK (status IN ('COMPLETE', 'INCOMPLETE')),
  -- A COMPLETE observation has no reason; an INCOMPLETE one has exactly one closed reason.
  CONSTRAINT provider_evidence_observation_reason_closed
    CHECK (
      (status = 'COMPLETE' AND incomplete_reason IS NULL) OR
      (status = 'INCOMPLETE' AND incomplete_reason IN (
        'BODY_NOT_JSON',
        'BODY_NOT_ARRAY',
        'ELEMENT_NOT_OBJECT',
        'EVENT_TYPE_UNESTABLISHED',
        'ACCEPTED_EVENT_IDENTITY_INVALID',
        'ACCEPTED_EVENT_MESSAGE_IDENTITY_INVALID',
        'ACCEPTED_EVENT_TIMESTAMP_INVALID',
        'ACCEPTED_EVENT_CORRELATION_INVALID',
        'EVENT_IDENTITY_REPEATED_IN_BATCH',
        'EVENT_IDENTITY_INCONSISTENT'
      ))
    ),
  CONSTRAINT provider_evidence_observation_counts_sane
    CHECK (element_count >= 0 AND accepted_class_event_count BETWEEN 0 AND element_count)
);

CREATE INDEX provider_evidence_observation_received
  ON provider_evidence_observation (provider, received_at);

-- ---------------------------------------------------------------------------------
-- ACCEPTED-CLASS EVENTS — the operand rows. One per provider EVENT identity.
-- ---------------------------------------------------------------------------------

CREATE TABLE provider_evidence_event (
  provider                     TEXT        NOT NULL,
  sg_event_id                  TEXT        NOT NULL,
  sg_message_id                TEXT        NOT NULL,
  event_class                  TEXT        NOT NULL,
  acos_correlation_tag         TEXT        NOT NULL,
  -- The provider's own event timestamp, Unix seconds.
  provider_event_timestamp     BIGINT      NOT NULL,
  received_at                  TIMESTAMPTZ NOT NULL,
  key_identity                 TEXT        NOT NULL,
  trust_artifact_digest        TEXT        NOT NULL,
  observation_id               BIGINT      NOT NULL
    REFERENCES provider_evidence_observation (observation_id),

  -- ADR-027 decision 4a: the EVENT identity is the ingest-deduplication operand.
  CONSTRAINT provider_evidence_event_identity_unique PRIMARY KEY (provider, sg_event_id),

  CONSTRAINT provider_evidence_event_identity_shape
    CHECK (sg_event_id ~ '^[!-~]+$' AND length(sg_event_id) <= 256),
  CONSTRAINT provider_evidence_event_message_shape
    CHECK (sg_message_id ~ '^[!-~]+$' AND length(sg_message_id) <= 256),
  CONSTRAINT provider_evidence_event_class_shape
    CHECK (event_class ~ '^[a-z][a-z_]{0,63}$'),
  -- The kernel's own tag shape, transcribed: `acos-corr-` and a UUIDv4. No personal data can
  -- fit here, and a free-text label cannot either.
  CONSTRAINT provider_evidence_event_correlation_shape
    CHECK (acos_correlation_tag ~
      '^acos-corr-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
  CONSTRAINT provider_evidence_event_timestamp_positive
    CHECK (provider_event_timestamp > 0),
  CONSTRAINT provider_evidence_event_key_identity_shape
    CHECK (key_identity ~ '^[0-9a-f]{64}$'),
  CONSTRAINT provider_evidence_event_digest_shape
    CHECK (trust_artifact_digest ~ '^[0-9a-f]{64}$')
);

CREATE INDEX provider_evidence_event_correlation
  ON provider_evidence_event (provider, acos_correlation_tag);
CREATE INDEX provider_evidence_event_received
  ON provider_evidence_event (provider, received_at);

/*
 * AN EVENT ROW MAY ONLY HANG OFF A COMPLETE OBSERVATION.
 *
 * ADR-027 decision 4: "**A valid signature over malformed evidence does not create an
 * accepted-count operand.**" The ingest path never inserts an event row under an INCOMPLETE
 * observation, and this trigger makes that a property of the store rather than of the path.
 */
CREATE FUNCTION provider_evidence_event_requires_complete() RETURNS trigger
LANGUAGE plpgsql AS $fn$
DECLARE
  observed TEXT;
BEGIN
  SELECT status INTO observed
    FROM provider_evidence_observation
   WHERE observation_id = NEW.observation_id;
  IF observed IS DISTINCT FROM 'COMPLETE' THEN
    RAISE EXCEPTION 'provider evidence event % may not reference observation % in status %',
      NEW.sg_event_id, NEW.observation_id, observed
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

CREATE TRIGGER provider_evidence_event_complete_only
  BEFORE INSERT ON provider_evidence_event
  FOR EACH ROW EXECUTE FUNCTION provider_evidence_event_requires_complete();

-- ---------------------------------------------------------------------------------
-- INCONSISTENCIES — one already-recorded event identity, presented again differently.
-- ---------------------------------------------------------------------------------

CREATE TABLE provider_evidence_inconsistency (
  inconsistency_id             BIGINT      GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provider                     TEXT        NOT NULL,
  sg_event_id                  TEXT        NOT NULL,
  -- The correlation the durable row carries, and the one the conflicting delivery carried.
  -- BOTH are tainted: neither may yield a clean exact count while this row exists.
  recorded_correlation_tag     TEXT        NOT NULL,
  presented_correlation_tag    TEXT        NOT NULL,
  observation_id               BIGINT      NOT NULL
    REFERENCES provider_evidence_observation (observation_id),
  detected_at                  TIMESTAMPTZ NOT NULL,

  CONSTRAINT provider_evidence_inconsistency_correlation_shape
    CHECK (
      recorded_correlation_tag ~
        '^acos-corr-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND presented_correlation_tag ~
        '^acos-corr-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    ),
  CONSTRAINT provider_evidence_inconsistency_identity_shape
    CHECK (sg_event_id ~ '^[!-~]+$' AND length(sg_event_id) <= 256)
);

CREATE INDEX provider_evidence_inconsistency_recorded
  ON provider_evidence_inconsistency (provider, recorded_correlation_tag);
CREATE INDEX provider_evidence_inconsistency_presented
  ON provider_evidence_inconsistency (provider, presented_correlation_tag);

-- ---------------------------------------------------------------------------------
-- APPEND-ONLY, on all three.
-- ---------------------------------------------------------------------------------

CREATE FUNCTION provider_evidence_append_only() RETURNS trigger
LANGUAGE plpgsql AS $fn$
BEGIN
  RAISE EXCEPTION 'provider evidence is append-only: % on % is refused', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END;
$fn$;

CREATE TRIGGER provider_evidence_observation_immutable
  BEFORE UPDATE OR DELETE ON provider_evidence_observation
  FOR EACH ROW EXECUTE FUNCTION provider_evidence_append_only();
CREATE TRIGGER provider_evidence_observation_no_truncate
  BEFORE TRUNCATE ON provider_evidence_observation
  FOR EACH STATEMENT EXECUTE FUNCTION provider_evidence_append_only();

CREATE TRIGGER provider_evidence_event_immutable
  BEFORE UPDATE OR DELETE ON provider_evidence_event
  FOR EACH ROW EXECUTE FUNCTION provider_evidence_append_only();
CREATE TRIGGER provider_evidence_event_no_truncate
  BEFORE TRUNCATE ON provider_evidence_event
  FOR EACH STATEMENT EXECUTE FUNCTION provider_evidence_append_only();

CREATE TRIGGER provider_evidence_inconsistency_immutable
  BEFORE UPDATE OR DELETE ON provider_evidence_inconsistency
  FOR EACH ROW EXECUTE FUNCTION provider_evidence_append_only();
CREATE TRIGGER provider_evidence_inconsistency_no_truncate
  BEFORE TRUNCATE ON provider_evidence_inconsistency
  FOR EACH STATEMENT EXECUTE FUNCTION provider_evidence_append_only();

REVOKE ALL ON FUNCTION provider_evidence_append_only() FROM PUBLIC;
REVOKE ALL ON FUNCTION provider_evidence_event_requires_complete() FROM PUBLIC;

-- ---------------------------------------------------------------------------------
-- GRANTS. Nothing is public. The ingress writes and confirms; the evaluator reads.
-- ---------------------------------------------------------------------------------

REVOKE ALL ON provider_evidence_observation   FROM PUBLIC;
REVOKE ALL ON provider_evidence_event         FROM PUBLIC;
REVOKE ALL ON provider_evidence_inconsistency FROM PUBLIC;

GRANT SELECT, INSERT ON provider_evidence_observation   TO acos_audit_evidence_ingress;
GRANT SELECT, INSERT ON provider_evidence_event         TO acos_audit_evidence_ingress;
GRANT SELECT, INSERT ON provider_evidence_inconsistency TO acos_audit_evidence_ingress;

GRANT SELECT ON provider_evidence_observation   TO acos_audit_evaluator;
GRANT SELECT ON provider_evidence_event         TO acos_audit_evaluator;
GRANT SELECT ON provider_evidence_inconsistency TO acos_audit_evaluator;

RESET ROLE;
