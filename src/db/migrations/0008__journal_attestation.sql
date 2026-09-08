-- 0008 — `JournalAttestation` as a REAL journal row on the SAME chain and the SAME path.
--
-- S1G. `30 §5.4`, verbatim, and every clause of it is load-bearing:
--
--     JournalAttestation {
--       company_id, max_journal_seq, row_count, head_hash, attested_at
--     }
--
--   - "It is itself a journal row, so it is chained, mirrored and anchored like
--     everything else. An attestation that could be pushed outside the chain would be a
--     second unverified channel."
--   - "Cadence: 5 minutes [...] Emitted whether or not any journal row was produced in
--     the interval — the empty attestation is the entire point."
--   - "k = 3. Three consecutively missed attestations raise `ATTESTATION_STALL`,
--     bounding undetected silence at 15 minutes."
--
-- So this migration adds NO new table. The attestation is a row of `effect_journal`,
-- allocated out of the SAME `journal_counter`, chained by the SAME trigger, and pushed
-- through the SAME replication path. A separate `journal_attestation` table would be the
-- "second unverified channel" the specification names and refuses.
--
-- ---------------------------------------------------------------------------------
-- WHAT CHANGES, AND WHAT IS PROVED NOT TO CHANGE
--
-- `effect_journal` was declared in 0007 for exactly one row kind. Three changes:
--
--   1. `journal_row_kind_declared` admits `JOURNAL_ATTESTATION`.
--   2. The effect-shaped columns become nullable AT THE COLUMN LEVEL and are re-imposed
--      per kind by a CHECK. For `EFFECT_AUTHORISATION` the requirement is IDENTICAL to
--      0007's — same columns, same NOT NULL — plus the new requirement that the
--      attestation columns are absent. Nothing an accepted test asserts is relaxed, and
--      `tests/integration/audit/attestation-row.test.ts` asserts the per-kind CHECK
--      directly: an EFFECT_AUTHORISATION row missing any one of those columns is still
--      refused by the database.
--   3. `effect_journal_canonical_bytes` DISPATCHES ON KIND. The
--      `acos.journal.effect_authorisation.v1` branch is byte-for-byte the function 0007
--      declared — same domain tag, same field order, same `acos_jcs1_*` calls — so every
--      row already chained keeps its hash and the accepted oracle in
--      `journal-sequencing.test.ts` still discriminates.
--
-- `30 §5.3`: "Fixed, declared per row kind, in the specification — never the physical
-- column order." Two kinds, two declared orders, one function that selects between them.
-- ---------------------------------------------------------------------------------

ALTER TABLE effect_journal
  DROP CONSTRAINT journal_row_kind_declared;

ALTER TABLE effect_journal
  ADD CONSTRAINT journal_row_kind_declared
  CHECK (journal_row_kind IN ('EFFECT_AUTHORISATION', 'JOURNAL_ATTESTATION'));

-- The effect-shaped columns. Nullable at the column level, re-imposed per kind below.
ALTER TABLE effect_journal ALTER COLUMN effect_id                       DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN authorisation_id                DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN decision_id                     DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN reservation_id                  DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN idempotency_key                 DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN action_class                    DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN resource_ref                    DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN verdict                         DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN total_exposure                  DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN is_rate_class                   DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN dispatch_payload_hash           DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN constructor_semantic_major      DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN constructor_non_semantic_minor  DROP NOT NULL;
ALTER TABLE effect_journal ALTER COLUMN policy_version                  DROP NOT NULL;

-- `30 §5.4`'s four attestation fields. `attested_at` is `occurred_at`, which every kind
-- already carries — the specification's fifth field is not duplicated into a second
-- column that could disagree with the first.
ALTER TABLE effect_journal
  ADD COLUMN attested_max_journal_seq BIGINT,
  ADD COLUMN attested_row_count       BIGINT,
  ADD COLUMN attested_head_hash       BYTEA;

/*
 * The per-kind shape, as a database constraint rather than as application discipline.
 *
 * The EFFECT_AUTHORISATION arm reproduces 0007's NOT NULL set exactly. It is written out
 * column by column instead of derived, for the same reason `30 §5.3` forbids deriving the
 * hashed field order from the physical columns: a later migration must not be able to
 * change what an accepted row kind requires by moving a column.
 */
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
      ELSE FALSE
    END
  );

/*
 * The declared field order, now per kind.
 *
 * BRANCH 1 — `acos.journal.effect_authorisation.v1` — is 0007's function, unchanged, to
 * the byte. Every field, in the same order, through the same `acos_jcs1_*` helpers. A row
 * chained before this migration recomputes to the same `row_hash` after it.
 *
 * BRANCH 2 — `acos.journal.attestation.v1` — is declared here for the first time. Its
 * field order is: domain tag, company, sequence, kind, the three attested quantities,
 * `attested_at` (the row's `occurred_at`), then `prev_hash` last, exactly as branch 1
 * places it.
 *
 * `attested_head_hash` goes through `acos_jcs1_bytes`. S1G-C1 recorded that under v1.2's
 * NULL rule a one-byte `0x00` `bytea` was indistinguishable from SQL NULL, and noted this
 * field never reaches that input because it is always a 32-byte SHA-256 digest or the 32
 * zero bytes. **v1.3.2 erratum JCS-01 removes the hazard rather than avoiding it**: NULL
 * is the reserved framing word `0xFFFFFFFF` with no payload, so no `bytea` payload of any
 * content can imitate it and the observation above is no longer load-bearing.
 *
 * BRANCH 1 IS STILL 0007's FUNCTION TO THE BYTE. JCS-01 changed the framing helper, not
 * this declaration: the domain tag, the field order and the `acos_jcs1_*` calls are
 * unchanged, so a row with no NULL field recomputes to the same `row_hash` it had at
 * v1.3.1, and a row with a NULL field recomputes to the corrected one.
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

  END;
$fn$;

/*
 * `30 §5.4`'s attestation, emitted inside its OWN control transaction.
 *
 * The lock order is `30 §5.2`'s, minus the balance rows an attestation does not touch:
 * `journal_counter(company_id)` FOR UPDATE, then the insert. Taking the counter is what
 * makes the attestation's `journal_seq` gap-free with respect to every concurrent
 * authorisation, and the `FOR UPDATE` is what stops two attestations racing to the same
 * sequence.
 *
 * `max_journal_seq`, `row_count` and `head_hash` are read INSIDE that lock and therefore
 * describe the prefix that exists at the moment the attestation is allocated — never a
 * prefix that includes the attestation itself, which a receiver recomputing the head from
 * rows it holds could not verify.
 *
 * `row_count` is `count(DISTINCT journal_seq)`, which `30 §5.2` requires verbatim:
 * "Anchored quantities are unaffected by retries."
 *
 * An empty journal attests `max_journal_seq = 0`, `row_count = 0` and the 32 zero bytes —
 * the genesis `prev_hash`. `30 §5.4`: "Emitted whether or not any journal row was
 * produced in the interval — the empty attestation is the entire point."
 *
 * This function is a WRITER on the money-path journal, so it does NOT compute a chain
 * value: the `effect_journal_chain` trigger from 0007 still owns `prev_hash` and
 * `row_hash`, and supplying either from here would raise `I17D_CALLER_SUPPLIED_CHAIN`.
 */
CREATE FUNCTION emit_journal_attestation(p_company_id TEXT, p_attested_at TIMESTAMPTZ)
RETURNS BIGINT
LANGUAGE plpgsql AS $fn$
DECLARE
  v_seq   BIGINT;
  v_max   BIGINT;
  v_count BIGINT;
  v_head  BYTEA;
BEGIN
  PERFORM 1 FROM journal_counter WHERE company_id = p_company_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOURNAL_COUNTER_ABSENT'
      USING ERRCODE = 'ACS30', DETAIL = format('company=%s', p_company_id);
  END IF;

  SELECT COALESCE(max(journal_seq), 0), count(DISTINCT journal_seq)
    INTO v_max, v_count
    FROM effect_journal WHERE company_id = p_company_id;

  IF v_max = 0 THEN
    v_head := decode(repeat('00', 32), 'hex');
  ELSE
    SELECT row_hash INTO v_head
      FROM effect_journal
     WHERE company_id = p_company_id AND journal_seq = v_max;
  END IF;

  v_seq := v_max + 1;

  INSERT INTO effect_journal (
    company_id, journal_seq, journal_row_kind,
    attested_max_journal_seq, attested_row_count, attested_head_hash,
    occurred_at
  ) VALUES (
    p_company_id, v_seq, 'JOURNAL_ATTESTATION',
    v_max, v_count, v_head,
    p_attested_at
  );

  UPDATE journal_counter SET next_seq = v_seq + 1 WHERE company_id = p_company_id;
  RETURN v_seq;
END;
$fn$;
