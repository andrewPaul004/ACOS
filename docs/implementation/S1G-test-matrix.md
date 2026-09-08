# S1G — Test matrix

**147 tests across 10 files. Every one of them uses BOTH PostgreSQL instances.**

`npm run verify`: **86 files, 1204 tests, 1204 passed, 0 failed, 0 skipped**, exit 0.
S1F baseline `395a13b`: 76 files, 1052 tests. PARTIAL candidate `f79c664`: 84 files,
1171 tests.

**The owner-resolution pass added +2 files and +33 tests**, all of them for architecture
package issue **v1.3.2, erratum JCS-01** and for `S1G-C4`:

| Where | Delta | Why |
|---|---|---|
| `§1` `VC-A3` | 22 → **35** | `§8`'s full NULL / EMPTY / BYTES / TEXT / NUMERIC / JSON / length-boundary matrix, judged against all three implementations |
| `§1a` old-spec vulnerable control | **+9**, new file | `§9`'s mandatory regression proof: v1.2's withdrawn NULL sentinel still collides, and the current rule does not |
| `§8a` arrival-order chain | **+10**, new file | `S1G-C4` / `§13`'s six required proofs, plus the defective arrival-order evaluator as a control |
| `tests/canonicalisation/canonical-bytes.test.ts` | **+1** | no payload — including a one-byte `0x00` — can imitate the reserved NULL word, asserted against the TypeScript implementation |

Four existing test files had a **rule transcription** corrected rather than an assertion
changed; `S1G-implementation-log.md §9.3` lists all four and states which rows change hash.
**No expected hash was read out of production output, and the repository holds no hard-coded
digest anywhere.**

---

## 1. `VC-A3` — cross-implementation `ACOS-JCS-1` (35)

`tests/integration/audit/vc-a3-cross-implementation.test.ts`

Three implementations, and **the oracle is neither production one**:
`tests/support/jcs1Oracle.ts`, hand-written from `30 §5.3`, importing nothing from `src/`.

**Extended by the owner-resolution pass** for architecture package issue **v1.3.2, erratum
JCS-01**: a field-level NULL is the reserved 4-byte word `FF FF FF FF` with no payload, and a
non-null field is `uint32_be(payload_length) || payload` with
`0 <= payload_length <= 0xFFFFFFFE`. Two helpers were added so the NULL rule can be exercised
for a **single `bytea` field directly**, through each production implementation's own
primitives, rather than only through a declared row kind — which is what made S1G-C1's defect
invisible from the row kinds alone.

### The whole row, and `36 §2`'s original hazard list

| Case | Assertion |
|---|---|
| whole `EFFECT_AUTHORISATION` row | control bytes = oracle; audit bytes = oracle; agreement follows |
| whole `JOURNAL_ATTESTATION` row | same, for the second row kind |
| row hash | `sha256` over the transmitted bytes = oracle hash |
| field count | 23 framed fields in each implementation and in the oracle. **The walker now handles the reserved word**, which consumes no payload — a walker that treated it as a length would demand 4GB of payload and fall off the end |
| money scale | one cent moves the bytes; scale > 2 refused by the oracle; `25.0`/`25.00` are one stored value at the declared scale |
| timestamps | exactly six fractional digits, UTC, `Z`; an offset-expressed instant normalises identically on both servers |
| **NULL vs empty string** | **the reserved word `ffffffff` versus the zero-length value `00000000`**, in all three implementations, and distinct in the whole row |
| **NULL money vs `0.00`** | the reserved word versus a real payload, distinct on both servers |
| NFC | the composed and decomposed forms, built from code units and asserted distinct as source values, hash identically on both servers |
| framing | `ab`+`c` ≠ `abc` ≠ `a`+`bc`; a moved field boundary changes the bytes on both |
| declared order | the first framed field is the ROW-KIND DOMAIN TAG, which is not a column of either table |
| row-kind separation | the two kinds cannot collide |
| **vulnerable receiver** | a divergent money rule produces different bytes AND production answers `AUDIT_CANONICAL_MISMATCH` |
| independence | the audit migration calls no `acos_jcs1_`; the control functions do not exist on the audit server, and vice versa; the oracle imports no `src/` |

### `§8`'s NULL / EMPTY / BYTES matrix — cases A–G

| Case | Framed bytes | Judged by |
|---|---|---|
| **A** SQL NULL | `FF FF FF FF` | oracle, control, audit |
| **B** empty text | `00 00 00 00` | oracle, control, audit |
| **C** empty bytes | `00 00 00 00` | oracle, control, audit |
| **D** bytes `00` | `00 00 00 01 00` | oracle, control, audit |
| **E** bytes `0000` | `00 00 00 02 00 00` | oracle, control, audit |
| **F** bytes `FF` | `00 00 00 01 FF` | oracle, control, audit |
| **G** arbitrary binary with an embedded zero | `00 00 00 06 DE 00 AD 00 BE EF` | oracle, control, audit |

| Case | Assertion |
|---|---|
| pairwise distinction | the six `bytea` cases yield **six distinct encodings in each of the three implementations**, and the three produce the identical list |
| **THE DEMONSTRATED COLLISION IS CLOSED** | SQL NULL ≠ `bytea` `'\x00'`, in the oracle, in the control database and in the audit database, each separately — **and the v1.3.1 refusal is asserted GONE**, because a specification gap papered over by a fail-closed guard is still a gap |
| the reserved word is unreachable from a payload | no case's length word is `FF FF FF FF`, and a payload that IS four `0xFF` bytes frames as `00 00 00 04 FF FF FF FF` — the nearest possible near-miss |
| the row kinds' only `bytea` values | a 32-byte digest and NULL, through all three |

### `§8`'s TEXT, NUMERIC and LENGTH-BOUNDARY legs

| Case | Assertion |
|---|---|
| empty string, `"0"`, NULL | three distinct text encodings, in all three implementations |
| **U+0000 still REJECTED** | S1B-C8 is retained and unrelaxed — asserted in the oracle and on the audit server, so the erratum cannot be read as having quietly relaxed it |
| NFC-equivalent text | both forms frame identically in all three |
| numeric | NULL, `0.00`, `-1.00`, `1.00`, `25.00`, `25.01` — **six distinct encodings**, in all three |
| numeric aliasing | `25.0` and `25.00` are one stored value at the declared scale and frame identically; scale 3 is refused |
| **length word at `0`** | `00 00 00 00` |
| **length word at an ordinary length** | `00 00 00 07` |
| **length word at `0xFFFFFFFE`** | `FF FF FF FE` — the maximum representable payload length |
| **length word at `0xFFFFFFFF`** | **REFUSED** — reserved for NULL; refused above it too, and for a negative length. Tested against the framing **primitive**, so no multi-gigabyte fixture is allocated |
| the SQL bound is the SPECIFICATION's | both migrations' code declares `4294967294` and `JCS1_FIELD_TOO_LONG`. The bound is unreachable on PostgreSQL, and an implementation satisfying a normative bound only by accident of its platform has not satisfied it |

### `§8`'s JSON leg, and `S1F-C7`'s carried-forward question

| Case | Assertion |
|---|---|
| **JSON literal `null` vs SQL NULL** | `00 00 00 04 6E 75 6C 6C` — an **ordinary non-null field** — versus the reserved word. Distinct **by construction** rather than by a difference in payload length, which is what the old rule relied on |
| **absent field vs JSON `null`** | an absent optional member is a field-level NULL and frames as the reserved word; `{a:null}` ≠ `{}` |
| **SQL NULL, JSON `null`, `{}`, `[]`, `""`, `0`** | **six distinct encodings**; an empty JSON string is a two-byte payload and not an empty field |
| **no JSON column exists** | asserted against BOTH schemas, so a later migration cannot introduce one silently. There is no production JSON canonicaliser in either database, so this leg is settled by the oracle alone and that limit is stated rather than elided |

---

## 1a. The OLD-SPEC vulnerable control — `§9` (9)

`tests/negative-controls/unsafe-old-null-sentinel.ts` — TEST-ONLY, imports **nothing**
`tests/negative-controls/old-null-sentinel-collision.test.ts`

**The regression proof for erratum JCS-01.** `36 §2`'s VC-A3 case, as v1.3.2 issues it,
requires that a seeded implementation restoring v1.2's one-byte `0x00` NULL sentinel **must
fail** the case.

| Case | Assertion |
|---|---|
| **the withdrawn rule COLLIDES** | SQL NULL and `bytea` `'\x00'` both frame to `00 00 00 01 00`. If they did not, the seeded module would have drifted off v1.2's rule and the proof would prove nothing |
| whole-row indistinguishability | a row carrying a NULL and a row carrying the one-byte value are the **same bytes** under the old rule |
| text was accidentally safe | a one-character NUL string imitates the old sentinel too, and could not arise: S1B-C8 plus PostgreSQL `text`. The current text rule still refuses it |
| the ORACLE separates them | `ffffffff` versus `0000000100` |
| the CONTROL database separates them | the same, from its own primitives |
| the AUDIT database separates them | the same, from its own primitives |
| **the test DISCRIMINATES** | the old NULL bytes are exactly the **new one-byte-value** bytes, and both production implementations agree with the new NULL value and not the old one |
| quarantine | nothing under `src/` names `unsafe-old-null-sentinel`, `unsafeOld` or `OLD_NULL_SENTINEL`, asserted by scanning every file under `src/` |
| whole row, corrected | the two rows that were identical under the old rule are distinct under the new one, in all three implementations |
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

## 8a. The arrival-order chain is SUPPLEMENTAL — `S1G-C4`, `§13` (10)

`tests/integration/audit/arrival-chain-vs-control-completeness.test.ts`

Added by the owner-resolution pass. `chain_seq` is accepted as an **additional, audit-local
append chain** and must not replace or redefine the transported control-journal semantics.
`§13`'s six required proofs are the first six rows.

| # | Case | Assertion |
|---|---|---|
| 1 | receive `journal_seq` 1, 2, 3 in order | `chain_seq` = 1, 2, 3, and the agreement is asserted to be a **coincidence of in-order delivery**, not a property. No gaps reported |
| 2 | a benign retry of 2 **after** 3 | `AUDIT_PUSH_DUPLICATE`; **no fourth arrival link**, and 2 keeps its original `chain_seq`. A retry is not an arrival |
| 3 | 1 then 3, with 2 missing | the row is HELD, not refused, and the arrival chain closes over the gap with two contiguous linked entries |
| 4 | **3 before 2** | holdings read 1, 2, 3 by `journal_seq`; the arrival chain records `1, 3, 2` and links in arrival order; the CONTROL chain still verifies row by row against each row's structured `prev_hash` |
| 5 | the arrival chain **cannot** make a missing `journal_seq` look complete | holdings 1 and 3 give a **perfect** arrival chain, and the evaluator still reports the gap at 2 |
| 5 | **THE DEFECTIVE EVALUATOR** | a reading based on arrival order is written in the test and reports **nothing missing** on the same fixture, so the two disagree — the discrimination this disposition needed |
| 5 | by source | `transportCompleteness.ts` never names `chain_seq`, `audit_prev_hash` or `audit_row_hash`, and does name `journal_seq`, `attested_max_journal_seq` and `claimed_row_hash` |
| 6 | the attestation is compared against the CONTROL head | a truncated tail is caught with the arrival chain intact; `ATTESTATION_INCONSISTENT`'s detail names control-journal quantities and contains no `chain` |
| 6 | the attested head hash | equals the CONTROL row hash at the attested control sequence, and is asserted **not** to be the arrival-chain head. A complete prefix produces no finding |
| 6 | `row_count` is `count(DISTINCT journal_seq)` | an extra arrival of a sequence already held neither fills a gap nor slanders an honest attester — both directions asserted |

---

## 9. What is NOT tested here, because it is not built

Dispatch, the mirror state machine, `MirrorInputStallSignal`, `DegradedModeOverride`,
`DISPATCHED_UNMIRRORED`, `I17f`, `I17b` anchoring, the outbox, `I36`, `I8`'s sweep,
reconciliation, settlement, approval resume and `R′`. `local-authorisation-boundary.test.ts`
asserts each as an absence in `src/`.
