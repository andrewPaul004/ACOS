# S1G — Implementation log

**Baseline `395a13b`, worktree clean, `npm run verify` green at 76 files / 1052 tests / 0
skipped before any edit.** Branch `feature/s1g-audit-ingress` created from it.

---

## 1. What was read before anything was written

The current v1.3.1 package, not the remediation history:

* `30 §5` structural independence, `§5.1` ordering and the dispatch precedence list, `§5.2`
  sequence allocation and re-push, `§5.3` `ACOS-JCS-1`, `§5.4` `JournalAttestation`, `§5.5`
  the seven omission cases, `§5.6`/`§5.7`/`§5.7.1`/`§5.7.2` (to learn what must NOT be
  built), `§5.8` the anchor medium, `§5.9` what the chain proves, `§5.10` `I8`'s bound;
* `24 §3` K11 — and specifically its **Inputs** row, which is what makes "no control read"
  a declared property rather than a convention;
* `26 §7`'s step table, which names step X as **the audit write**;
* `36 §2` VC-A1, VC-A1d, VC-A3 and their assertion lists;
* `37` S1's Build and Prove lists, and its "and one thing S1 explicitly does not prove";
* registry `I17`, `I17b`, `I17c`, `I17d`, `I17e`, `I17f`, `I41`, `I8`, and `§3` items 7, 9,
  10;
* `phase2-v1.3.1-errata.md` — nothing S1G-relevant beyond stale counts.

**Three readings decided the shape of the slice, and each is recorded as an owner
clarification:** `chain_seq` is the audit store's arrival counter (S1G-C4), `I17c` splits
across S1 and S6 (S1G-C5), and the audit store must both reconstruct and compare (S1G-C7).

---

## 2. Control plane — `0008__journal_attestation.sql`

`30 §5.4` says the attestation "is itself a journal row, so it is chained, mirrored and
anchored like everything else. An attestation that could be pushed outside the chain would
be a second unverified channel." **So no table was added.**

`effect_journal` gained a second row kind. Three changes, and the third is the one that
needed care:

1. `journal_row_kind_declared` admits `JOURNAL_ATTESTATION`.
2. The effect-shaped columns became nullable at the column level, and a
   `journal_row_shape_per_kind` CHECK re-imposes them **per kind**. The
   `EFFECT_AUTHORISATION` arm reproduces 0007's NOT NULL set column by column — written out
   rather than derived, for the same reason `30 §5.3` forbids deriving the hashed field
   order from the physical columns.
3. `effect_journal_canonical_bytes` now dispatches on kind. **The
   `acos.journal.effect_authorisation.v1` branch is 0007's function to the byte** — same
   domain tag, same field order, same `acos_jcs1_*` calls — so every already-chained row
   keeps its hash and the accepted oracle in `journal-sequencing.test.ts` still
   discriminates. That accepted suite passing unchanged is the evidence.

`emit_journal_attestation` takes `journal_counter(company_id)` `FOR UPDATE` — `30 §5.2`'s
declared lock order minus the balance rows an attestation does not touch — reads
`max(journal_seq)`, `count(DISTINCT journal_seq)` and the head hash **inside that lock**, and
inserts. It supplies no chain value; 0007's trigger still owns `prev_hash` and `row_hash`,
and supplying one would raise `I17D_CALLER_SUPPLIED_CHAIN`.

---

## 3. Audit plane — a second PostgreSQL instance

`src/audit/db/migrations/A0001__audit_store.sql`, applied by `src/audit/db/migrate.ts` to
`ACOS_AUDIT_PG_URL`, with its own `audit_schema_migration` ledger. Two runners, two
directories, two ledgers. The audit runner cannot see the control directory and does not
import `controlUrl`.

**`ACOS-JCS-1`, implemented a second time.** Written from `30 §5.3`, and deliberately built
by a different route wherever the specification admits one — the length prefix is assembled
with `set_byte` rather than `int4send`, money is rendered by a cast to `NUMERIC(18,2)` rather
than by a `to_char` mask, the timestamp is assembled from parts rather than by one format
string. The control functions do not exist on that server, so the independence is structural
rather than a matter of discipline.

**Three roles** (S1G-C6): `acos_audit_owner` owns everything; `acos_audit_replication` is
what the control plane connects as and holds INSERT plus EXECUTE on the ingest entry point
and nothing else; `acos_audit_evaluator` reads holdings and writes findings and has **no
INSERT on holdings**.

**The ingest trigger, in order:** refuse a caller-supplied chain value (`I17d`); charge the
`I17c` quota under `FOR UPDATE`; canonicalise from the STRUCTURED columns; require the result
to equal `transmitted_bytes`; require its `sha256` to equal `claimed_row_hash`; verify the
control chain against the row held at `journal_seq − 1`; advance the audit chain over
ARRIVAL order.

`session_user`, not `CURRENT_USER`, throughout the quota and provenance path. Inside a
SECURITY DEFINER function `CURRENT_USER` is the owner, so the per-principal quota would have
been charged to the wrong principal and `I17c` would have been a fiction. **This was found by
writing the test that reads `received_from` back**, not by reading the code.

---

## 4. Transport

`src/audit/transport/journalRecord.ts` is the wire contract. Three kinds of field, and the
whole design is that the audit store treats them differently: **structured fields** are the
input to canonicalisation; **`transmittedBytes`** is what `30 §5.3` says is hashed;
**`claimedRowHash`** is a claim to compare. Money travels as a **string** — a `number` would
make `25.00` and `25.0` the same value in transit and destroy the hazard `§5.3` exists for.

`src/replication/journalPusher.ts` reads `effect_journal WHERE mirrored_at IS NULL` ordered by
`journal_seq`, taking the transmitted bytes from the control canonicaliser in the same query
(a TypeScript re-serialisation would put a third canonicaliser on the wire). It opens **no
control transaction**. `recordMirroredAt` returns `false` rather than throwing on failure,
which is what makes "advisory" visible to the caller instead of turning an advisory write into
a replication error.

---

## 5. Detection

`src/audit/transportCompleteness.ts` takes an **audit pool** and an instant. There is no
control pool in scope for it to use.

The gap scan runs to `max(held)` and **not past it**, because past it there is nothing to
compare against — `30 §5.4` is explicit that the audit plane has no independent reading of the
true maximum. The tail is the attestation's job, and `I17e`'s three operands are checked
separately: every `journal_seq ≤ max_journal_seq` present, `row_count` agreeing, and the head
hash matching the row THIS STORE verified at the attested maximum.

`ATTESTATION_STALL` fires past `k × cadence` since the newest attestation **received**. A
store that has never received one is not stalled — firing there would raise CRITICAL on every
store from creation, which is the cry-wolf failure `30 §5.4` gives as the reason k is 3.

---

## 6. Four bugs found by tests, and what each one taught

1. **`chr(0)` is itself rejected by PostgreSQL.** The audit text canonicaliser's
   defence-in-depth NUL check was written as `strpos(value, chr(0))`, which fails at
   evaluation with `null character not permitted` — so the function raised on every input.
   Rewritten to check the ENCODED bytes. The check is redundant in PostgreSQL (this is
   S1B-C8's structural half) and is kept so the two implementations agree on the reason.

2. **The first source-independence assertion matched a comment.** `A0001` discusses
   `acos_jcs1_*` at length in its header, which is the point of the header. The assertion
   now strips comments and checks for a CALL — the same technique the accepted suite uses.

3. **A conflicting row must be SELF-CONSISTENT to reach the collision path.** The first
   version of case 8 built one by taking row 2's bytes and relabelling the sequence, which
   the trigger caught as `AUDIT_CANONICAL_MISMATCH` before the uniqueness check ever ran —
   so the concurrency test was passing through the wrong branch and case 8 failed. The
   conflicting row is now rebuilt by the **oracle** for an altered field, so it survives every
   single-row check and fails only the one that compares it to what is held. **A carelessly
   built adversarial fixture tests the wrong refusal.**

4. **`current_setting('port')` is 5432 on both containers.** Docker publishes different host
   ports; inside each namespace the server listens on 5432. The instance-distinctness
   assertion moved to `pg_control_system().system_identifier` — generated by `initdb`, and the
   strongest available statement that these are two clusters — with the published-port
   difference asserted from the two URLs the planes actually connect to.

---

## 7. Accepted tests touched

**One file**, `tests/integration/authority/local-authorisation-boundary.test.ts`. Two tests
renamed and widened into six; **no assertion deleted and none weakened**. `S1G-C2` and
`S1G-C3` give the before/after in full. Every other accepted test passes unchanged.

`eslint.config.js` gained `src/audit/db/migrate.ts` to the existing `no-console` exemption
list, beside `src/db/migrate.ts`. Both are operator-facing CLIs, and the audit one is a
separate runner precisely because it addresses a separate database.

---

## 8. Verification

`npm run verify`: typecheck clean, lint clean at `--max-warnings 0`, **84 files, 1171 tests,
1171 passed, 0 failed, 0 skipped**. Focused S1G run: **8 files, 115 tests**, all using both
PostgreSQL instances.

---

## 9. The owner-resolution pass — what changed after `f79c664`

`S1G-owner-resolution.md` is the disposition record. This section records the mechanics.

### 9.1 The architecture erratum came FIRST, and it is a new package

`docs/architecture/v1.3.1/` is an immutable input and was not edited. **v1.3.2 was
materialised as a new package directory** — a copy of v1.3.1 with three normative sections
corrected, two new root documents and an extended mechanical gate. `diff -rq v1.3.1 v1.3.2`
lists exactly nine differences and no others:

| Path | Why |
|---|---|
| `README.md` | the issue banner, the JCS-01 summary, how to run the gate |
| `deliverables/30-observability-audit-and-escalation.md` | `§5.3` — the correction itself, its worked examples, its injectivity statement, the record of what v1.2 got wrong, and the class-20 identity effect |
| `deliverables/36-architecture-validation-plan.md` | `§2`'s `VC-A3` case — the required distinctions, and the seeded old-rule negative control |
| `deliverables/50-control-artifact-manifest.md` | `§2` class 20 — the rule's name, and the signature consequence |
| `analysis/consistency-v1.3.py` | conditions **F1–F3**, and two in-memory seeding flags |
| `analysis/consistency-v1.3.2-output.txt` | the retained clean run |
| `analysis/consistency-v1.3.2-negative-control-output.txt` | the retained seeded runs, with process exit codes |
| `phase2-v1.3.2-errata.md` | the erratum |
| `phase2-v1.3.2-verification.md` | its gate |

Root `README.md` and `.gitattributes` were updated: `v1.3.2` is now named as the current
authoritative input, and the `-text` rule's comment explains why a repository-authored
package issue is held under it too.

### 9.2 Why `canonicalBytes.ts` had to change as well

The mandate names two production implementations. **There are three.**
`src/kernel/canonicalisation/canonicalBytes.ts` is the S1B TypeScript implementation of the
same `30 §5.3`, and it is what canonicalises decision signatures, lineage hashes, idempotency
keys and semantic option digests. Correcting the two triggers and leaving it would have put
two incompatible NULL representations inside one system — which is exactly what the erratum's
own version discussion forbids. It was corrected with the other two, and it is called out
here rather than buried, because it is the one part of this pass the mandate did not
anticipate.

### 9.3 Four test-side consequences, and none of them was a hard-coded hash

`§10` of the mandate forbids reading new expected hashes out of production output. **No
expected hash was.** The repository holds no hard-coded digest anywhere — searched — because
every expectation is computed from an oracle or from architecture-retained vectors. The four
affected sites were all rule transcriptions:

| Site | What it is | Change |
|---|---|---|
| `tests/support/jcs1Oracle.ts` | the S1G `VC-A3` oracle, a third reading of `30 §5.3` | rewritten from the v1.3.2 text; `frameField` accepts `null`; `frameLength` exported for the boundary arithmetic |
| `tests/integration/authority/journal-sequencing.test.ts` | S1F's **test-local** third reading, deliberately not importing the oracle | its framer emits the reserved word for a NULL field |
| `tests/canonicalisation/canonical-bytes.test.ts` | the two explicit framed-byte expectations for a null text field | `000000016b0000000100` → `000000016bffffffff`, and a new test asserting no payload — including a one-byte `0x00` — can imitate it |
| `tests/canonicalisation/canonical-text-injectivity.test.ts` | S1B.2 finding 4A's assertions | the same byte expectation, and 4A's commentary restated: the `U+0000` exclusion is **retained** and is no longer the injectivity argument |

**Rows unaffected, and rows affected.** A journal row all of whose declared fields are
non-null recomputes to exactly the `row_hash` it had at v1.3.1. A row with at least one NULL
field recomputes to a new value — five bytes replaced with four, per NULL field. In the two
declared row kinds that means: every `EFFECT_AUTHORISATION` row with a null `approval_id`,
`vendor_amount` or `forward_integral`, and **every genesis row**, whose `prev_hash` is NULL.
No fixture carries a recorded expected hash, so no fixture needed a new number.

**No migration and no re-anchor obligation exists**, because ACOS is not deployed and no
anchor has ever been published. The obligation that a future canonical-format change on a
live chain would require deliberate chain-versioning and re-anchor semantics is recorded in
`phase2-v1.3.2-errata.md §1` *Deployment*, not discharged.

### 9.4 One bug the tests found

`countFields` in `vc-a3-cross-implementation.test.ts` walked the framed field boundaries as
`4 + length` for every field. Under the reserved word that computes `4 + 4294967295`, so the
walk fell off the end of the buffer and the field-count assertion failed. **The framing has
to be exactly self-describing, NULLs included**, and the walker now advances four bytes for
the reserved word. It was a test-side defect and it is worth recording, because it is the
same mistake a naive parser of the wire format would make.

### 9.5 Verification after the pass

Architecture: `analysis/consistency-v1.3.py` — **25 conditions, 25 PASS, 0 FAIL**, exit 0.
The seeded negative controls fail as required: `--seed-old-null-bytes` **24 PASS / 1 FAIL**,
`--seed-old-null-sentinel` **22 PASS / 3 FAIL**, both exit 1. `recompute-v1.3.py` reproduces
`recompute-v1.3-output.txt` line-for-line, so no authority quantity moved.

Repository: `npm run verify` **green, exit 0** — typecheck clean, lint clean at
`--max-warnings 0`, **86 files, 1204 tests, 1204 passed, 0 failed, 0 skipped**. No `.only`,
`.skip` or `.todo` anywhere; `vitest.config.ts` includes `tests/**` and `spikes/**` and
filters nothing. Focused S1G: **10 files, 147 tests**, all using both PostgreSQL instances.
