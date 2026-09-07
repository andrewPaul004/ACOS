-- 0006 — S1E: the authoritative substrate for `26 §7` steps D through N.
--
-- Architecture source:
--   26 §7    — the deterministic, ordered, fail-closed policy evaluation sequence
--   26 §3    — Principals: kind, role, model_binding, delegation_chain, delegation_depth
--   26 §4    — Grants: the owner's authority statements; data, versioned, owner-only (B9)
--   26 §5    — Recoverability, assigned per action class in the catalogue
--   26 §6    — Categorical prohibitions
--   26 §13   — Autonomy levels and the AutonomyLedgerEntry
--   24 §5    — Grades and the promotion rule: grade is DERIVED FROM WRITER IDENTITY
--   24 §6    — Provenance
--   24 §7    — Temporality and staleness: max_age, refresh_source, staleness_policy
--   24 §11   — Evidence objects
--   24 §12   — Source tiering
--   24 §13   — Corroboration and the decision gate
--   24 §15   — Contradiction
--   51 §3.1  — the Stage-2 monetary grant set
--
-- ---------------------------------------------------------------------------------
-- WHAT THIS MIGRATION IS NOT
--
-- It is NOT the effect ledger, NOT the authorisation table, NOT a reservation and NOT an
-- audit plane. `26 §7` step R and everything after it is out of S1E's scope by mandate, so
-- no table here holds a reservation, an authorisation, an effect row or a journal row.
--
-- It is NOT a decision registry, an approval state machine or an escalation queue. Step N
-- can return REQUIRE_APPROVAL, and S1E's terminal for that is a refusal to proceed rather
-- than an approval object, because `26 §12`'s machinery is a later slice.
--
-- ---------------------------------------------------------------------------------
-- EVERY TABLE HERE IS AUTHORITATIVE KERNEL STATE
--
-- `26 §1` Corollary 3: "the request must be built by the ceiling's enforcer, not by its
-- subject." The same sentence governs the operands: no row below is writable by a model,
-- and the two rows whose value a compromised model would most want to choose — a fact's
-- GRADE and a principal's DELEGATION DEPTH — are not writable by anyone. Both are computed
-- by the database from other columns, so an asserted value is rejected by PostgreSQL rather
-- than by application code (`36 §2`: "Attempting to insert an asserted grade must be
-- rejected by the generated column, not by application code").
-- ---------------------------------------------------------------------------------


-- =====================================================================================
-- STEP D — principals, their keys, their sessions and their signed delegation chain
-- =====================================================================================

-- `26 §3`, verbatim: "A principal is not 'an agent.' It is a resolved, attributable
-- identity with a verified chain."
--
-- `delegation_depth` is DELIBERATELY ABSENT as a stored column. `26 §3` rule 3 caps it at
-- 3, and a cap evaluated against a figure its subject stored is the defect `26 §1`
-- Corollary 3 names. It is counted from `delegation_hop` at step D instead.
CREATE TABLE principal (
  company_id     TEXT NOT NULL REFERENCES company(company_id),
  principal_id   TEXT NOT NULL,

  -- `26 §3`, verbatim: "id, kind, // OWNER | KERNEL_SERVICE | AI_ROLE | ADAPTER |
  -- AUDIT_REVIEWER".
  kind           TEXT NOT NULL,

  -- `26 §3`: "role, // e.g. ceo, support_reasoner, market_researcher". `26 §8`'s worked
  -- refund policy opens `permit(principal in Role::"support_reasoner", …)`, so this is the
  -- operand that decides whether any grant applies at all.
  role           TEXT NOT NULL,

  -- `26 §3`: "model_binding, // model id + version + prompt version — null for non-AI".
  -- `26 §13`: the autonomy-ledger key includes it, and "any change to model_binding"
  -- demotes. So it is an authority operand and it is kernel state.
  model_binding  TEXT,

  status         TEXT NOT NULL,

  PRIMARY KEY (company_id, principal_id),

  CONSTRAINT principal_kind_declared
    CHECK (kind IN ('OWNER', 'KERNEL_SERVICE', 'AI_ROLE', 'ADAPTER', 'AUDIT_REVIEWER')),
  CONSTRAINT principal_status_declared
    CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  -- `26 §3`: model_binding is "null for non-AI". An AI_ROLE without one has no autonomy
  -- key, and `26 §13`'s ledger cannot be consulted for it — so it is refused at write time
  -- rather than defaulting at read time.
  CONSTRAINT principal_ai_role_has_model_binding
    CHECK (kind <> 'AI_ROLE' OR model_binding IS NOT NULL),
  CONSTRAINT principal_non_ai_has_no_model_binding
    CHECK (kind = 'AI_ROLE' OR model_binding IS NULL)
);

-- The verification key for a principal's signature over the hops it delegates.
--
-- `26 §3` rule 1, verbatim: "Each hop is signed by the delegating principal's key, held by
-- the kernel, not by the model." The key lives here, in kernel state, for exactly that
-- reason. S1E verifies real Ed25519 signatures and builds no key management, which is the
-- same boundary S1B drew for `ConstructorVersionRecord`.
CREATE TABLE principal_key (
  company_id     TEXT  NOT NULL,
  principal_id   TEXT  NOT NULL,
  -- SPKI DER. Verified with node:crypto; never sent anywhere.
  public_key     BYTEA NOT NULL,

  PRIMARY KEY (company_id, principal_id),
  FOREIGN KEY (company_id, principal_id) REFERENCES principal(company_id, principal_id)
);

-- The runtime session. THIS IS THE ONLY THING A CALLER NAMES.
--
-- `26 §2.1`, on the AuthorizationRequest's principal field, verbatim: "resolved, signed,
-- chain-verified — **stamped by the kernel, never a parameter**."
--
-- Step D takes a session id and resolves the principal FROM THIS TABLE. There is no code
-- path in which a caller supplies a principal id, a role, a kind or a depth, so the
-- spoofing attack has no argument position rather than failing a check.
CREATE TABLE principal_session (
  company_id     TEXT        NOT NULL,
  session_id     TEXT        NOT NULL,
  principal_id   TEXT        NOT NULL,
  issued_at      TIMESTAMPTZ NOT NULL,
  -- Mandatory, for the same reason `26 §4` makes grant expiry mandatory: it caps the blast
  -- radius of a session nobody revoked.
  expires_at     TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (company_id, session_id),
  FOREIGN KEY (company_id, principal_id) REFERENCES principal(company_id, principal_id),

  CONSTRAINT principal_session_expiry_after_issue CHECK (expires_at > issued_at)
);

-- `26 §3`: "delegation_chain[], // signed; each hop names the delegating principal and the
-- granted subset".
--
-- `hop_index` is 1-based and contiguous; step D checks contiguity, because a chain with a
-- missing hop is a chain whose subset intersection skipped a narrowing.
CREATE TABLE delegation_hop (
  company_id               TEXT     NOT NULL,
  principal_id             TEXT     NOT NULL,
  hop_index                INTEGER  NOT NULL,

  -- `26 §3`: "each hop names the delegating principal".
  delegating_principal_id  TEXT     NOT NULL,

  -- `26 §3`: "and the granted subset". `26 §3` rule 2: "a delegate's effective grants are
  -- the intersection of its own role grants and the delegator's held grants. A delegation
  -- can only narrow."
  granted_action_classes   TEXT[]   NOT NULL,

  -- Ed25519 over the hop's canonical bytes, by `delegating_principal_id`'s key.
  signature                BYTEA    NOT NULL,

  PRIMARY KEY (company_id, principal_id, hop_index),
  FOREIGN KEY (company_id, principal_id) REFERENCES principal(company_id, principal_id),
  FOREIGN KEY (company_id, delegating_principal_id)
    REFERENCES principal(company_id, principal_id),

  CONSTRAINT delegation_hop_index_positive CHECK (hop_index >= 1),
  -- A hop conveying nothing is not a narrowing, it is a broken chain.
  CONSTRAINT delegation_hop_grants_something CHECK (cardinality(granted_action_classes) > 0),
  -- A principal cannot delegate to itself; that is a cycle wearing a hop's clothes.
  CONSTRAINT delegation_hop_not_self CHECK (delegating_principal_id <> principal_id)
);

-- The task the proposal is running under. `26 §13`'s autonomy key opens with `task_type`,
-- and `24 §3` K7 owns tasks, so the type is kernel state and not a request field.
CREATE TABLE authority_task (
  company_id    TEXT NOT NULL REFERENCES company(company_id),
  task_id       TEXT NOT NULL,
  task_type     TEXT NOT NULL,
  principal_id  TEXT NOT NULL,

  PRIMARY KEY (company_id, task_id),
  FOREIGN KEY (company_id, principal_id) REFERENCES principal(company_id, principal_id)
);


-- =====================================================================================
-- STEP F — platform status, the kill switch, and the agent profile
-- =====================================================================================

-- `26 §7` step F: "Agent profile / platform status OK? kill switch not set" -> no ->
-- "D5 DENY: PLATFORM_SUSPENDED".
--
-- ONE ROW PER COMPANY, and its ABSENCE is the fail-closed case. There is no default. A
-- company with no row has no authoritative platform status, and `26 §7`'s opening sentence
-- — "Deterministic, ordered, fail-closed" — makes an unknown status a denial rather than a
-- permission.
CREATE TABLE company_platform_status (
  company_id         TEXT        NOT NULL REFERENCES company(company_id),

  status             TEXT        NOT NULL,

  -- `26 §7` step F names it separately from status, so it is a separate column: a kill
  -- switch folded into an enum is a kill switch someone can clear by setting a status.
  kill_switch        BOOLEAN     NOT NULL,

  updated_at         TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (company_id),

  CONSTRAINT company_platform_status_declared
    CHECK (status IN ('OPERATING', 'SUSPENDED', 'TERMINATED'))
);

-- `24 §3` K14 — the Agent Profile Registry. `I14`: "Agent-profile capability declarations
-- match the action catalogue."
--
-- One row per (principal, action class) the profile declares. A class with no row is NOT
-- declared for that principal, and step F denies — the closed default again.
CREATE TABLE agent_profile_capability (
  company_id    TEXT NOT NULL,
  principal_id  TEXT NOT NULL,
  action_class  TEXT NOT NULL,
  status        TEXT NOT NULL,

  PRIMARY KEY (company_id, principal_id, action_class),
  FOREIGN KEY (company_id, principal_id) REFERENCES principal(company_id, principal_id),

  CONSTRAINT agent_profile_capability_status_declared
    CHECK (status IN ('ENABLED', 'SUSPENDED'))
);


-- =====================================================================================
-- STEPS G / H / H′ / H″ — the state store, grade, staleness and contradiction
-- =====================================================================================

-- `24 §5`, verbatim: "The mechanism is a single `grade` attribute whose value is **derived
-- from writer identity and a named promotion rule**, never asserted by the writer (SR3)."
--
-- ---------------------------------------------------------------------------------
-- `grade` IS A GENERATED COLUMN, AND THAT IS THE WHOLE POINT
--
-- Registry `I5`: "No `RECORD` or `OBSERVATION` grade fact has a MODEL-kind writer.
-- Enforcement: DB (generated column). On violation: **Security incident. Structurally
-- impossible.**"
--
-- `36 §2`: "For any row, `grade` is a pure function of `writer_principal_type` and
-- `promoter_rule_id`. **Attempting to insert an asserted grade must be rejected by the
-- generated column, not by application code.**"
--
-- PostgreSQL rejects any INSERT or UPDATE that supplies a value for a generated column, so
-- the attack is refused by the engine. `writer_kind = 'MODEL'` cannot reach RECORD,
-- OBSERVATION, DECISION_OWNER or DECISION_DELEGATED down any path, including a compromised
-- application.
--
-- ---------------------------------------------------------------------------------
-- THE SIX WRITER KINDS ARE `24 §6`'s, EXACTLY
--
-- `24 §6`: "writer_kind // TRANSPORT | PARSER | KERNEL_SERVICE | MODEL | OWNER | PROMOTER".
--
-- `24 §5` additionally names the Metric Layer as OBSERVATION's writer and the Decision
-- Registry as DECISION_*'s writer, and `24 §6`'s enum has no member for either. Rather than
-- invent two enum members the architecture does not declare, both are represented as the
-- KERNEL_SERVICE writers they are (`24 §3` K12 and K9 are kernel capabilities), discriminated
-- by two further columns that are themselves kernel state:
--
--   derivation_spec      set => `24 §5`'s "deterministic derivations over RECORDs", i.e.
--                        OBSERVATION, "with a named spec and lineage"
--   decision_authority   set => `24 §5`'s Decision Registry row, OWNER or DELEGATED
--
-- Recorded as S1E fixture decision S1E-C2 in docs/implementation/S1E-owner-clarifications.md.
CREATE TABLE state_fact (
  company_id            TEXT        NOT NULL REFERENCES company(company_id),
  fact_id               TEXT        NOT NULL,

  -- `24 §15`: a ContradictionLink is created by "same subject+predicate, incompatible
  -- values, overlapping validity". So subject and predicate are the addressing pair.
  subject               TEXT        NOT NULL,
  predicate             TEXT        NOT NULL,
  value                 TEXT        NOT NULL,

  -- --- provenance, `24 §6` --------------------------------------------------------------
  writer_kind           TEXT        NOT NULL,
  writer_principal_id   TEXT,
  -- `24 §5`: "A record's grade may be raised only by a deterministic promoter — a named,
  -- versioned rule". Set only when grade was raised.
  promoter_rule         TEXT,
  -- `24 §5`: OBSERVATION is "Computed, with a named spec and lineage."
  derivation_spec       TEXT,
  -- `24 §5`: the Decision Registry's two rows.
  decision_authority    TEXT,

  -- `I27`: "No `OBSERVATION` used as a policy precondition derives solely from a single
  -- adapter's writes." Two columns, because the invariant is about the CARDINALITY of the
  -- contributing sources and a single free-text provenance string cannot express it.
  source_adapter        TEXT,
  corroborating_source  TEXT,

  -- --- temporality, `24 §7` --------------------------------------------------------------
  observed_at           TIMESTAMPTZ NOT NULL,
  recorded_at           TIMESTAMPTZ NOT NULL,
  -- `24 §7`: "Every fact *type* declares: max_age | Beyond this, reads return the record
  -- flagged STALE" and "staleness_policy | BLOCK (policy denies effects depending on it),
  -- WARN, or IGNORE."
  max_age_seconds       BIGINT      NOT NULL,
  staleness_policy      TEXT        NOT NULL,

  -- --- the derived grade -----------------------------------------------------------------
  grade                 TEXT GENERATED ALWAYS AS (
    CASE
      -- `24 §5`: the promoter emits "a new record at the higher grade". A promoted fact is
      -- RECORD regardless of which kind ran the rule, which is what makes promotion the
      -- ONLY path upward.
      WHEN promoter_rule IS NOT NULL THEN 'RECORD'
      -- `24 §5` v1.1 R6: "grade for vendor-derived facts derives from the parser, not the
      -- adapter." The parser is in the control plane; the transport is not.
      WHEN writer_kind = 'PARSER' THEN 'RECORD'
      -- `24 §5`: "CLAIM | Quarantined ingestion; adapters relaying third-party assertions".
      WHEN writer_kind = 'TRANSPORT' THEN 'CLAIM'
      WHEN writer_kind = 'OWNER' THEN 'RECORD'
      WHEN writer_kind = 'KERNEL_SERVICE' AND decision_authority = 'OWNER'
        THEN 'DECISION_OWNER'
      WHEN writer_kind = 'KERNEL_SERVICE' AND decision_authority = 'DELEGATED'
        THEN 'DECISION_DELEGATED'
      WHEN writer_kind = 'KERNEL_SERVICE' AND derivation_spec IS NOT NULL
        THEN 'OBSERVATION'
      WHEN writer_kind = 'KERNEL_SERVICE' THEN 'RECORD'
      -- `24 §5`: everything a reasoning worker writes unaided. INTERPRETATION is the
      -- highest of the four model-writable grades and none of them may gate.
      WHEN writer_kind = 'MODEL' THEN 'INTERPRETATION'
      -- `24 §5` has no row for a PROMOTER writing without a promoter_rule. It is a
      -- malformed provenance block, and an unrecognised provenance must not resolve to a
      -- gating grade.
      ELSE 'CLAIM'
    END
  ) STORED,

  PRIMARY KEY (company_id, fact_id),

  CONSTRAINT state_fact_writer_kind_declared
    CHECK (writer_kind IN ('TRANSPORT', 'PARSER', 'KERNEL_SERVICE', 'MODEL', 'OWNER', 'PROMOTER')),
  CONSTRAINT state_fact_decision_authority_declared
    CHECK (decision_authority IS NULL OR decision_authority IN ('OWNER', 'DELEGATED')),
  CONSTRAINT state_fact_staleness_policy_declared
    CHECK (staleness_policy IN ('BLOCK', 'WARN', 'IGNORE')),
  CONSTRAINT state_fact_max_age_positive CHECK (max_age_seconds > 0),
  -- A MODEL writer with a decision authority would be the Decision Registry's write
  -- performed by the model itself, which is MOA-10 exactly. Refused at the schema.
  CONSTRAINT state_fact_model_writes_no_decision
    CHECK (writer_kind <> 'MODEL' OR decision_authority IS NULL),
  -- Same for promotion: `24 §5`, "No model-attributed writer can invoke a promoter."
  CONSTRAINT state_fact_model_invokes_no_promoter
    CHECK (writer_kind <> 'MODEL' OR promoter_rule IS NULL)
);

CREATE INDEX state_fact_by_subject_predicate
  ON state_fact (company_id, subject, predicate, recorded_at DESC);

-- `24 §11`: "ContradictionLink { claim_a, claim_b, detected_by_rule }".
-- `24 §15`: "Contradictions are surfaced, not resolved."
-- `I29`: "No authorisation whose precondition set includes a fact participating in an open
-- ContradictionLink." Enforcement POLICY (step H′).
CREATE TABLE contradiction_link (
  company_id       TEXT        NOT NULL REFERENCES company(company_id),
  link_id          TEXT        NOT NULL,
  fact_a_id        TEXT        NOT NULL,
  fact_b_id        TEXT        NOT NULL,
  -- `24 §15`: "created by deterministic rules". The rule is named on the row so the audit
  -- reader never has to ask which one fired.
  detected_by_rule TEXT        NOT NULL,
  status           TEXT        NOT NULL,
  detected_at      TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (company_id, link_id),
  FOREIGN KEY (company_id, fact_a_id) REFERENCES state_fact(company_id, fact_id),
  FOREIGN KEY (company_id, fact_b_id) REFERENCES state_fact(company_id, fact_id),

  CONSTRAINT contradiction_link_status_declared CHECK (status IN ('OPEN', 'RESOLVED')),
  CONSTRAINT contradiction_link_distinct_facts CHECK (fact_a_id <> fact_b_id)
);

CREATE INDEX contradiction_link_open_by_fact_a
  ON contradiction_link (company_id, fact_a_id) WHERE status = 'OPEN';
CREATE INDEX contradiction_link_open_by_fact_b
  ON contradiction_link (company_id, fact_b_id) WHERE status = 'OPEN';

-- Which preconditions an action class requires — step G's fetch list.
--
-- `26 §7` step G, verbatim: "Fetch preconditions from state store — **engine fetches;
-- proposer does not supply**", and property 3: "The engine fetches its own preconditions
-- (step G). This remains true and remains valuable."
--
-- The list is declared per class in kernel state. The proposer has no field in which to
-- name a precondition, supply one, or suppress one.
--
-- `subject_template` is resolved by substituting the RESOURCE the kernel resolved at C′.
-- The only supported token is `{resource_ref}`; there is no expression language, because a
-- precondition selector a model could influence is a precondition a model supplies.
CREATE TABLE action_class_precondition (
  company_id       TEXT    NOT NULL REFERENCES company(company_id),
  action_class     TEXT    NOT NULL,
  precondition_key TEXT    NOT NULL,
  subject_template TEXT    NOT NULL,
  predicate        TEXT    NOT NULL,
  -- The value the precondition must hold for the action to proceed. `26 §4`: conditions are
  -- "predicate over RECORD/OBSERVATION/DECISION_OWNER-grade state"; S1E supports equality
  -- only, and records the restriction rather than implying a richer language exists.
  required_value   TEXT    NOT NULL,

  PRIMARY KEY (company_id, action_class, precondition_key)
);


-- =====================================================================================
-- STEP I / J / K / L — grants
-- =====================================================================================

-- `26 §4`, verbatim: "The owner's authority statements. Grants are data, versioned,
-- owner-only (B9)." Every column below is a field of the printed `Grant` record.
CREATE TABLE authority_grant (
  company_id                  TEXT        NOT NULL REFERENCES company(company_id),
  grant_id                    TEXT        NOT NULL,
  version                     INTEGER     NOT NULL,
  status                      TEXT        NOT NULL,
  created_by                  TEXT        NOT NULL,
  created_at                  TIMESTAMPTZ NOT NULL,
  -- `26 §4`: "expires_at, // expiry is mandatory". NOT NULL, and it is the reason:
  -- "Mandatory expiry is not bureaucracy. It forces periodic re-consent and it caps the
  -- blast radius of a grant the owner forgot about."
  expires_at                  TIMESTAMPTZ NOT NULL,

  -- `26 §4`: "principal_selector { kind?, role?, model_binding? }". NULL means "any", which
  -- is what the printed `?` denotes.
  principal_kind              TEXT,
  principal_role              TEXT,
  principal_model_binding     TEXT,

  -- `26 §4`: "resource_selector { type, predicate }". The predicate language is closed and
  -- kernel-parsed — see `resourceSelector.ts` — because an open predicate language is an
  -- authority channel with a parser attached.
  resource_type               TEXT        NOT NULL,
  resource_predicate          TEXT        NOT NULL,

  -- `26 §4`: "counterparty_selector { novelty_max: EXISTING | ALLOWLISTED }". NULL means the
  -- grant permits no external counterparty at all, which is the closed default and the
  -- correct value for `INBOUND_ORIGINAL_INSTRUMENT` and `INTERNAL_LIABILITY` classes.
  counterparty_novelty_max    TEXT,

  -- `26 §4`: "recoverability_max REVERSIBLE | COMPENSABLE | IRRECOVERABLE". Step J.
  recoverability_max          TEXT        NOT NULL,

  -- `26 §4`: "per_action_max { monetary?, irrecoverable_units? }". The MONETARY half is
  -- recorded here for the audit record and for the multi-grant intersection; the CAP THAT
  -- BINDS AT STEP M IS THE LITERAL IN THE HASH-COMMITTED CEDAR ARTIFACT, not this column.
  -- S1E does not move the per-action bound out of the policy artifact and into a database
  -- row a compromised writer could raise.
  --
  -- THE `irrecoverable_units` HALF IS DELIBERATELY ABSENT — S1E clarification S1E-C5, on the
  -- precedent of S1B.1's removal of `declaredWindows`: "rather than leave a field whose only
  -- plausible reader is the wrong one, the field is gone." Irrecoverable COUNTS bind at
  -- `26 §7` step R, against `W_DAY_MIE` and `W_MONTH_MIE` (`51 §2`, `51 §2.2`), and step R
  -- is out of S1E's scope. A stored irrecoverable ceiling that no gate reads would be an
  -- authority quantity with no enforcer, and `tests/integration/exposure/
  -- irrecoverable-standing-zero.test.ts` is emphatic that every irrecoverable column in the
  -- schema is one of the seven `24 §3` K5 declares.
  per_action_max_monetary     NUMERIC(18,2),

  -- `26 §4`: "standing { required: bool, max_rate?, max_period? }".
  standing_required           BOOLEAN     NOT NULL,

  -- `26 §4`: "evidence_requirements { min_independent_sources, max_tier, max_age_days }".
  -- Step L. All three NULL means the grant declares none.
  evidence_min_sources        INTEGER,
  evidence_max_tier           INTEGER,
  evidence_max_age_days       INTEGER,

  -- `26 §4`: "approval_requirement NONE | TIER_1 | TIER_2 | OWNER".
  approval_requirement        TEXT        NOT NULL,

  -- `26 §4`: "autonomy_key_binding // ties the grant to an autonomy-ledger entry (§13)".
  autonomy_key_binding        TEXT        NOT NULL,

  -- `26 §4`: "gate_class_on_permit GATED | UNGATED_LOGGED".
  gate_class_on_permit        TEXT        NOT NULL,

  PRIMARY KEY (company_id, grant_id),

  CONSTRAINT authority_grant_status_declared
    CHECK (status IN ('ACTIVE', 'REVOKED')),
  CONSTRAINT authority_grant_principal_kind_declared
    CHECK (principal_kind IS NULL
           OR principal_kind IN ('OWNER', 'KERNEL_SERVICE', 'AI_ROLE', 'ADAPTER', 'AUDIT_REVIEWER')),
  CONSTRAINT authority_grant_counterparty_novelty_declared
    CHECK (counterparty_novelty_max IS NULL
           OR counterparty_novelty_max IN ('EXISTING', 'ALLOWLISTED')),
  CONSTRAINT authority_grant_recoverability_declared
    CHECK (recoverability_max IN ('REVERSIBLE', 'COMPENSABLE', 'IRRECOVERABLE')),
  CONSTRAINT authority_grant_approval_declared
    CHECK (approval_requirement IN ('NONE', 'TIER_1', 'TIER_2', 'OWNER')),
  CONSTRAINT authority_grant_gate_class_declared
    CHECK (gate_class_on_permit IN ('GATED', 'UNGATED_LOGGED')),
  -- `24 §13`'s tiers run 1-9.
  CONSTRAINT authority_grant_evidence_tier_range
    CHECK (evidence_max_tier IS NULL OR (evidence_max_tier BETWEEN 1 AND 9)),
  CONSTRAINT authority_grant_evidence_sources_non_negative
    CHECK (evidence_min_sources IS NULL OR evidence_min_sources >= 0),
  CONSTRAINT authority_grant_evidence_age_positive
    CHECK (evidence_max_age_days IS NULL OR evidence_max_age_days > 0),
  CONSTRAINT authority_grant_per_action_monetary_non_negative
    CHECK (per_action_max_monetary IS NULL OR per_action_max_monetary >= 0)
);

-- `26 §4`: "action_class_selector [ ... ]".
CREATE TABLE authority_grant_action_class (
  company_id   TEXT NOT NULL,
  grant_id     TEXT NOT NULL,
  action_class TEXT NOT NULL,

  PRIMARY KEY (company_id, grant_id, action_class),
  FOREIGN KEY (company_id, grant_id) REFERENCES authority_grant(company_id, grant_id)
);

-- `26 §4`: "window_refs [ named_window_id, ... ], // v1.1: REFERENCES named windows; MONTH
-- is mandatory".
--
-- `26 §4`, verbatim: "every grant carries a MONTH window so `MAL_total(month)` is defined.
-- A grant with only a DAY window made `min(g.window_limit(MONTH).max_monetary, …)`
-- undefined". The MONTH requirement is checked at grant-validation time by the resolver,
-- which reads `window_registry.period`; it is not a CHECK here because the period lives on
-- another table.
CREATE TABLE authority_grant_window (
  company_id  TEXT NOT NULL,
  grant_id    TEXT NOT NULL,
  window_id   TEXT NOT NULL,

  PRIMARY KEY (company_id, grant_id, window_id),
  FOREIGN KEY (company_id, grant_id) REFERENCES authority_grant(company_id, grant_id),
  FOREIGN KEY (company_id, window_id) REFERENCES window_registry(company_id, window_id)
);


-- =====================================================================================
-- STEP L — evidence
-- =====================================================================================

-- `24 §11`'s `Source`, and `24 §12`'s numeric tier.
CREATE TABLE evidence_source (
  company_id          TEXT    NOT NULL REFERENCES company(company_id),
  source_id           TEXT    NOT NULL,
  -- `24 §13`: "Two claims corroborate only if their sources differ on registrable domain
  -- *and* on owner entity where determinable".
  registrable_domain  TEXT    NOT NULL,
  owner_entity        TEXT,
  tier                INTEGER NOT NULL,
  -- `24 §12`: "vendor_interest_flag is the specific defence against the failure `11 E8`
  -- targets".
  vendor_interest     BOOLEAN NOT NULL,

  PRIMARY KEY (company_id, source_id),
  CONSTRAINT evidence_source_tier_range CHECK (tier BETWEEN 1 AND 9)
);

-- `24 §11`'s `EvidenceItem`. `24 §14`: "Inaccessible evidence is evidence" — `access_status`
-- is a required field and FAILED items are stored, because coverage is computed from the
-- proportion of slots filled by items with `access_status = OK`.
CREATE TABLE evidence_item (
  company_id        TEXT        NOT NULL,
  evidence_item_id  TEXT        NOT NULL,
  source_id         TEXT        NOT NULL,
  url               TEXT        NOT NULL,
  fetch_at          TIMESTAMPTZ NOT NULL,
  content_hash      TEXT        NOT NULL,
  access_status     TEXT        NOT NULL,
  -- `24 §13`: "neither cites the other as its source". NULL when it cites no other item.
  cites_item_id     TEXT,

  PRIMARY KEY (company_id, evidence_item_id),
  FOREIGN KEY (company_id, source_id) REFERENCES evidence_source(company_id, source_id),

  CONSTRAINT evidence_item_access_status_declared
    CHECK (access_status IN ('OK', 'ROBOTS_BLOCKED', 'AUTH_WALL', 'FORBIDDEN', 'TIMEOUT', 'JS_REQUIRED')),
  CONSTRAINT evidence_item_does_not_cite_itself
    CHECK (cites_item_id IS NULL OR cites_item_id <> evidence_item_id)
);

-- `24 §11`: "EvidenceSet { id, claim_ids[], frozen_hash, frozen_at }".
CREATE TABLE evidence_set (
  company_id       TEXT        NOT NULL REFERENCES company(company_id),
  evidence_set_id  TEXT        NOT NULL,
  frozen_hash      TEXT        NOT NULL,
  frozen_at        TIMESTAMPTZ NOT NULL,

  PRIMARY KEY (company_id, evidence_set_id)
);

CREATE TABLE evidence_set_item (
  company_id       TEXT NOT NULL,
  evidence_set_id  TEXT NOT NULL,
  evidence_item_id TEXT NOT NULL,
  -- `24 §13`: the approval-requiring band needs "≥ 1 at tier ≤ 3" for "the load-bearing
  -- claim", so which item is load-bearing has to be recorded rather than inferred.
  load_bearing     BOOLEAN NOT NULL,

  PRIMARY KEY (company_id, evidence_set_id, evidence_item_id),
  FOREIGN KEY (company_id, evidence_set_id) REFERENCES evidence_set(company_id, evidence_set_id),
  FOREIGN KEY (company_id, evidence_item_id) REFERENCES evidence_item(company_id, evidence_item_id)
);

-- Which frozen evidence set an action derives from.
--
-- `26 §2.1`: "evidence_refs[] // frozen evidence set, when the action derives from
-- research". The binding is KERNEL state keyed on the task, class and resource, so no
-- proposer can point an action at a more convenient evidence set.
CREATE TABLE action_evidence_binding (
  company_id       TEXT NOT NULL,
  task_id          TEXT NOT NULL,
  action_class     TEXT NOT NULL,
  resource_id      TEXT NOT NULL,
  evidence_set_id  TEXT NOT NULL,

  PRIMARY KEY (company_id, task_id, action_class, resource_id),
  FOREIGN KEY (company_id, task_id) REFERENCES authority_task(company_id, task_id),
  FOREIGN KEY (company_id, evidence_set_id) REFERENCES evidence_set(company_id, evidence_set_id)
);


-- =====================================================================================
-- STEP N — the autonomy ledger
-- =====================================================================================

-- `26 §13`'s `AutonomyLedgerEntry`, with the fields step N reads.
--
-- `26 §13`, verbatim: "key: (task_type, action_class, model_binding, resource_class)" —
-- which is exactly this table's primary key, and every one of the four components is
-- kernel-resolved: `task_type` from `authority_task`, `action_class` from the closed
-- catalogue, `model_binding` from `principal`, `resource_class` from the resolved resource.
--
-- `I47`: "No task executes at an autonomy level above its autonomy-ledger entry for its
-- (task_type, action_class, model_binding, resource_class) tuple."
CREATE TABLE autonomy_ledger_entry (
  company_id        TEXT        NOT NULL REFERENCES company(company_id),
  task_type         TEXT        NOT NULL,
  action_class      TEXT        NOT NULL,
  model_binding     TEXT        NOT NULL,
  resource_class    TEXT        NOT NULL,

  level             TEXT        NOT NULL,
  granted_at        TIMESTAMPTZ NOT NULL,

  -- `26 §13`: "Demotion is automatic and immediate on any of: a policy violation; a
  -- RED-class escalation miss; …". Counters, not booleans, because `26 §13`'s promotion
  -- table requires ZERO of each and a boolean cannot distinguish zero from unmeasured.
  observations      BIGINT      NOT NULL,
  policy_violations BIGINT      NOT NULL,
  escalation_misses BIGINT      NOT NULL,

  -- `26 §13`: "by default `probation`, meaning REQUIRE_APPROVAL on every effect until the
  -- eval suite passes and the observation minimum is met."
  probation_until   TIMESTAMPTZ,

  PRIMARY KEY (company_id, task_type, action_class, model_binding, resource_class),

  CONSTRAINT autonomy_ledger_level_declared
    CHECK (level IN ('L0_ADVISORY', 'L1_ASSISTED', 'L2_SUPERVISED', 'L3_OPERATIONAL', 'L4_STRATEGIC')),
  CONSTRAINT autonomy_ledger_counters_non_negative
    CHECK (observations >= 0 AND policy_violations >= 0 AND escalation_misses >= 0)
);
