# S1G — Test matrix

**115 tests across 8 new files. Every one of them uses BOTH PostgreSQL instances.**

`npm run verify`: **84 files, 1171 tests, 1171 passed, 0 failed, 0 skipped.**
Baseline `395a13b`: 76 files, 1052 tests. Delta: +8 files, +119 tests (115 new, +4 net in
one modified accepted file — see `S1G-owner-clarifications.md` S1G-C2, S1G-C3).

---

## 1. `VC-A3` — cross-implementation `ACOS-JCS-1` (22)

`tests/integration/audit/vc-a3-cross-implementation.test.ts`

Three implementations, and **the oracle is neither production one**:
`tests/support/jcs1Oracle.ts`, hand-written from `30 §5.3`, importing nothing from `src/`.

| Case | Assertion |
|---|---|
| whole `EFFECT_AUTHORISATION` row | control bytes = oracle; audit bytes = oracle; agreement follows |
| whole `JOURNAL_ATTESTATION` row | same, for the second row kind |
| row hash | `sha256` over the transmitted bytes = oracle hash |
| field count | 23 framed fields in each implementation and in the oracle |
| money scale | one cent moves the bytes; scale > 2 refused by the oracle; `25.0`/`25.00` are one stored value at the declared scale |
| timestamps | exactly six fractional digits, UTC, `Z`; an offset-expressed instant normalises identically on both servers |
| null vs empty string | one-byte sentinel vs zero-length; framed `00000001 00` vs `00000000` |
| null money vs `0.00` | distinct on both servers |
| NFC | `café` and `café` hash identically on both servers |
| framing | `ab`+`c` ≠ `abc` ≠ `a`+`bc`; a moved field boundary changes the bytes on both |
| declared order | the first framed field is the ROW-KIND DOMAIN TAG, which is not a column of either table |
| row-kind separation | the two kinds cannot collide |
| **JSON literal null vs SQL NULL** | `null` (4 bytes) vs sentinel (1 byte). **Resolved by `30 §5.3` as written** |
| **absent field vs JSON null** | `undefined` is the sentinel; `{a:null}` ≠ `{}` |
| **no JSON column exists** | asserted against BOTH schemas, so a later migration cannot introduce one silently |
| **one-byte `0x00` bytea** | **REFUSED by all three.** S1G-C1 — the ambiguity is recorded, not resolved |
| empty bytes vs null bytes | zero-length vs sentinel, distinct |
| **vulnerable receiver** | a divergent money rule produces different bytes AND production answers `AUDIT_CANONICAL_MISMATCH` |
| independence | the audit migration calls no `acos_jcs1_`; the control functions do not exist on the audit server, and vice versa; the oracle imports no `src/` |

---

## 2. Ingestion and independent re-chaining (12)

`tests/integration/audit/ingestion-and-rechaining.test.ts`

| Case | Assertion |
|---|---|
| ordinary push | two rows held; audit `chain_seq` 1,2; genesis `audit_prev_hash` = 32 zero bytes; `audit_row_hash` ≠ control `row_hash` |
| independent recomputation | `sha256(audit_journal_canonical_bytes(a.*)) = claimed_row_hash` for every held row |
| wire fidelity | stored `transmitted_bytes` = what the control plane sent |
| end-to-end | those bytes = the INDEPENDENT ORACLE's |
| **fields altered, original hash retained** | `AUDIT_CANONICAL_MISMATCH`; nothing held; CRITICAL incident |
| **vulnerable receiver** | a store that trusts the supplied hash accepts a $999.99 row carrying a $10.00 row's hash. Production held nothing from the identical input |
| bytes altered, hash consistent | `AUDIT_CANONICAL_MISMATCH` |
| forged predecessor | `AUDIT_CHAIN_BREAK`; the held prefix is untouched |
| forged genesis | `AUDIT_CHAIN_BREAK` |
| sequence identity | `(company_id, journal_seq)` is the primary key |
| **`mirrored_at` is not a column of the audit store** | asserted against `information_schema` |
| gap is HELD not refused | 1, 2, 4 accepted; `chain_seq` 1, 2, 3 — arrival order diverging from `journal_seq` |

---

## 3. Duplicates and collisions — `30 §5.2` (9)

`tests/integration/audit/duplicate-and-collision.test.ts`

Every assertion reads audit ROWS, `chain_seq` and `audit_incident` by direct SQL.

| # | Case | Audit result | Incident | Chain advancement |
|---|---|---|---|---|
| 1 | first push | `ACCEPTED`, one row | none | +1 |
| 2 | exact duplicate | `AUDIT_PUSH_DUPLICATE` | INFO | **none** — head byte-identical |
| 3 | ACK lost, then retry | `AUDIT_PUSH_DUPLICATE` | INFO | none for the retry |
| 4 | `mirrored_at` lost, then retry | `AUDIT_PUSH_DUPLICATE` | INFO | none; timestamp recorded on retry |
| 5 | same seq, changed field | `AUDIT_SEQUENCE_COLLISION` | **CRITICAL** | none; held row byte-identical |
| 6 | same seq, changed hash | `AUDIT_SEQUENCE_COLLISION` | **CRITICAL** | none |
| 7 | 4 concurrent exact duplicates | 1 `ACCEPTED`, 3 `AUDIT_PUSH_DUPLICATE` | INFO only | +1 total |
| 8 | concurrent conflicting | one row; ≥1 `AUDIT_SEQUENCE_COLLISION` | CRITICAL | +1 total; stored row is an unmodified original |
| — | **vulnerable control** | blanket `ON CONFLICT DO NOTHING` returns the SAME answer for cases 2 and 5, and raises nothing | — | discriminates |

The conflicting row is **fully self-consistent** — bytes and hash rebuilt by the oracle for
the altered field — so it exercises the collision path rather than the canonical-mismatch
path. A carelessly built one would not discriminate.

---

## 4. Post-commit ordering, crash matrix, durable backlog (12)

`tests/integration/audit/post-commit-and-crash-matrix.test.ts`

| Boundary | Control state | Audit state | `mirrored_at` | Incident | Recoverable | Authorisation lost? |
|---|---|---|---|---|---|---|
| after COMMIT, before push | 2 journal rows, 2 effects | 0 | null | none | yes — a new pusher finishes | **NO** |
| audit UNREACHABLE (real refused connection) | 2 rows, 2 effects, 2 reservations | 0 | null | none | yes | **NO** |
| audit txn begins then aborts | 2 rows | 0 | null | none | yes, both `ACCEPTED` | **NO** |
| audit COMMITS, ACK lost | 2 rows | 1 | null | none | yes — retry is `AUDIT_PUSH_DUPLICATE`; chain 1,2 not 1,2,3 | **NO** |
| crash before `mirrored_at` | 2 rows | 1 | null | none | yes — `§12`'s full sequence | **NO** |
| `mirrored_at` PERMANENTLY wrong | 2 rows, both marked mirrored | **0** | set | none | backlog empty because the column lied — **and the audit invariant is still evaluable, because it never reads that column** | **NO** |

Plus:

* **ordering** — no audit row exists at the moment the first push begins;
* **the vulnerable control for cross-database atomicity** — a control transaction is opened,
  an audit row is written on the other server, the control transaction is ROLLED BACK. The
  control write vanishes; **the audit write does not.** There is no atom, demonstrated;
* **source rules** — the pusher contains no `BEGIN`, `COMMIT`, `ROLLBACK`, `inTransaction`
  or `PREPARE TRANSACTION`; no module in the slice contains `PREPARE TRANSACTION`,
  `COMMIT PREPARED` or `2PC`;
* **durable backlog** — 4 rows committed, a prefix replicated, the pusher DESTROYED, new
  pools and a new `JournalPusher` built, and the remainder `[3n, 4n]` rediscovered from
  PostgreSQL and finished with no duplicates and no gaps;
* **no second queue** — the backlog names `effect_journal` and `mirrored_at IS NULL`; the
  pusher contains no `outbox`, no `CLAIMED`, no `FOR UPDATE`, no `SKIP LOCKED`.

---

## 5. `VC-A1` — attestation and transport completeness (16)

`tests/integration/audit/vc-a1-transport-completeness.test.ts`. **Controlled clock, no
sleeps.**

**The attestation is a real journal row:**

| Assertion | Evidence |
|---|---|
| real `journal_seq` from the SAME counter | seq 3 after two authorisations; `journal_counter.next_seq` = 4 |
| on the SAME local chain | its `prev_hash` = row 2's `row_hash` |
| declared quantities describe the prefix BEFORE it | `max = 2`, `row_count = 2`, `head = row 2's row_hash`, by direct SQL |
| its own hash | matches the INDEPENDENT ORACLE's `attestationFields` |
| the EMPTY attestation | `max = 0`, `count = 0`, head = 32 zero bytes |
| SAME transport, no side channel | the ordinary pusher moves it; it re-chains on the audit side |
| declared operands | cadence 5 min, k = 3, bound 15 min |
| `emitAttestationIfDue` | due immediately when never attested; not due at +1 min; due at exactly +5 |

**The four transport cases:**

| Case | Setup | Result |
|---|---|---|
| **A — mid-range omission** | receive 1, 2, 4 | `AUDIT_COMPLETENESS_GAP` CRITICAL, `missing: ['3']` |
| A — control | complete prefix | **no finding** |
| **B — tail truncation, honest attester** | journal at 4, attests max = 3, row 3 withheld | `ATTESTATION_INCONSISTENT`; `missingBelowAttestedMax: ['3']`; counts disagree |
| **B — no control read** | same, with **the control pool CLOSED** | still detected |
| B — head hash | an attestation whose head this store's rows cannot produce | `ATTESTATION_INCONSISTENT` |
| **C — suppressed attestation** | attestation at seq 3 withheld, seq 4 delivered | presents as a **sequence gap** at 3 |
| **D — writer stops** | last attestation at T0 | silent at +14 and +15; **fires at +16**, `boundMs` 900000 |
| D — control | a store that never received an attestation | **not stalled** |
| **vulnerable control** | a detector reading `mirrored_at` | reports "0 unmirrored, complete" while the store holds 2 of 3. Production computes from holdings and raises both findings |

---

## 6. `VC-A1d` — the MANDATORY adversarial-attester negative control (10)

`tests/negative-controls/vc-a1d-adversarial-attester.test.ts`

**A run in which the detector fires is a test failure.**

| Assertion | Result |
|---|---|
| the setup is real | control journal has 6 rows; the audit store holds 4; two rows exist that the audit plane will never see |
| `I17` | **does not fire** — the received prefix is gap-free |
| `I17e` | **does not fire** — every operand of the attestation is TRUE about the prefix it describes |
| `ATTESTATION_STALL` | **does not fire** while the attester keeps speaking |
| **the whole detector** | **`findings` is EMPTY.** This is the expected result and it is a PASS |
| re-delivery of the frozen attestation | `AUDIT_PUSH_DUPLICATE`; still silent |
| what the attack costs — silence | stopping DOES trip `ATTESTATION_STALL` at +21 |
| what the attack costs — advancing | attesting max = 6 while withholding 5 and 6 fires **both** `AUDIT_COMPLETENESS_GAP` and `ATTESTATION_INCONSISTENT` — that is `30 §5.5` case 2a, which IS detected |
| the residual is unowned here | the audit store has exactly three tables, all written from the transport or by its own checks; no vendor table, no replica, no control read |
| `I8` proves nothing at S1 | no `shopify`, `stripe`, `inverseSweep`, `vendorRead` or `fetch(` anywhere under `src/audit/` |

---

## 7. Audit role security — `I17d`, `I41`, `I17c`, `30 §5` (26)

`tests/integration/audit/audit-role-security.test.ts`. **Every prohibited operation is
ATTEMPTED as `acos_audit_replication` against real PostgreSQL. No GRANT string is read as
proof.**

| Attempted | PostgreSQL result |
|---|---|
| identity of the connection | `session_user = acos_audit_replication`, `rolsuper = false` |
| `received_from` on an accepted row | `acos_audit_replication`, not the SECURITY DEFINER owner |
| INSERT with caller-supplied `audit_row_hash` | `I17D_CALLER_SUPPLIED_AUDIT_CHAIN` |
| INSERT with caller-supplied `audit_prev_hash` | `I17D_CALLER_SUPPLIED_AUDIT_CHAIN` |
| INSERT with caller-supplied `chain_seq` | `I17D_CALLER_SUPPLIED_AUDIT_CHAIN` |
| `SELECT audit_journal_chain()` | `permission denied for function audit_journal_chain` |
| `SELECT audit_default_insert_quota()` | permission denied |
| `SELECT audit_journal_canonical_bytes(a.*)` | permission denied |
| direct honest INSERT | **accepted and FULLY CHAINED** — the trigger is not bypassed |
| direct INSERT with an altered field | `AUDIT_CANONICAL_MISMATCH` |
| `UPDATE audit_journal` | permission denied for table |
| `DELETE FROM audit_journal` | permission denied for table |
| `TRUNCATE audit_journal` | must be owner / permission denied |
| UPDATE **as the OWNER** | `APPEND_ONLY_TABLE_audit_journal` |
| `ALTER TABLE … DISABLE TRIGGER` | must be owner |
| `CREATE TABLE` in the audit schema | permission denied for schema public |
| `DROP TABLE audit_journal` | must be owner |
| `SELECT * FROM audit_incident` | permission denied for table |
| `INSERT INTO audit_incident` | permission denied for table |
| `DELETE`/`UPDATE audit_incident` | permission denied for table |
| DELETE **as the OWNER** | `APPEND_ONLY_TABLE_audit_incident` |
| evaluator inserting a journal row | permission denied for table `audit_journal` |
| `SELECT`/`UPDATE audit_insert_quota` as replication | permission denied for table |

**`I17c`:**

| Case | Result |
|---|---|
| accepted inserts charge the quota | 2 rows → `inserted_rows = 2`, principal `acos_audit_replication` |
| benign duplicates charge NOTHING | 1 + 5 retries → `inserted_rows = 1`; a retry storm cannot saturate it |
| saturation | `AUDIT_QUOTA_SATURATED`; **INCIDENT recorded**; already-accepted rows survive; the quota is NOT raised; no grant mutated |
| bypass by direct INSERT | `I17C_AUDIT_INSERT_QUOTA_SATURATED` |
| **vulnerable control** | a store treating exhaustion as throughput ends `used > cap` with no incident. Production cannot represent that row — `audit_quota_within_bound` refuses it |

---

## 8. Plane independence — `§20` (8)

`tests/integration/audit/plane-independence.test.ts`

| Assertion | Evidence |
|---|---|
| different CLUSTERS | `pg_control_system().system_identifier` differs; different databases; different published ports |
| disjoint schemas | `effect_journal` absent from the audit server; `audit_journal`, `effect`, `exposure_reservation`, `window_balance` absent from the other; two differently-named migration ledgers |
| disjoint migration directories | `0000__` vs `A0000__`; the audit runner names its own directory and no `controlUrl` |
| **no control read in source** | no file under `src/audit/` names `controlUrl`, `ACOS_CONTROL_PG_URL`, `effect_journal`, `journal_counter`, `window_balance`, `exposure_reservation`, `mirrored_at`, a kernel module, or the control migration runner |
| **one permitted import** | the audit plane imports only `createPool`, `auditUrl`, `Client`, `Pool` from `src/db/pool.ts` |
| **no vendor credential, no outbound call** | no `https://`, `fetch(`, `axios`, `node:http` anywhere under `src/audit/` — `I8` is OPEN |
| cadence by transcription | `cadence × k = bound`; the audit module does not import the replication module |
| **RUNTIME proof** | the evaluator is run **with the control database closed** and still detects both the gap and the attestation inconsistency |

---

## 9. What is NOT tested here, because it is not built

Dispatch, the mirror state machine, `MirrorInputStallSignal`, `DegradedModeOverride`,
`DISPATCHED_UNMIRRORED`, `I17f`, `I17b` anchoring, the outbox, `I36`, `I8`'s sweep,
reconciliation, settlement, approval resume and `R′`. `local-authorisation-boundary.test.ts`
asserts each as an absence in `src/`.
