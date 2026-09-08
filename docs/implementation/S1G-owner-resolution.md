# S1G — Owner Resolution

The owner's dispositions on `S1G-C1`…`S1G-C8`, the evidence each was checked against, the
architecture erratum one of them required, and the implementation corrections that erratum
forced.

**Baseline reviewed:** `f79c664` — the S1G PARTIAL candidate.
**Predecessor baseline:** `395a13b` — the accepted S1F candidate.
**Branch:** `feature/s1g-audit-ingress`.
**Baseline regression, verified before any edit:** 84 files / 1171 tests / 1171 passed /
0 failed / 0 skipped, `npm run verify` green.
**Architecture package at the start of this pass:** `docs/architecture/v1.3.1/`.
**Architecture package at the end of this pass:** `docs/architecture/v1.3.2/`. **`v1.3.1`
is not modified**; `v1.3.2` is a new immutable package directory carrying one normative
correction. See `docs/architecture/v1.3.2/phase2-v1.3.2-errata.md`.

**Commits in this pass:**

| Commit | Contents |
|---|---|
| `753efb2` | `docs(arch)`: architecture package issue **v1.3.2**, erratum JCS-01 — the normative correction, its mechanical gate (F1–F3), its two seeded negative controls, and the root `README.md` / `.gitattributes` repointing |
| `46f958b` | `fix(s1g)`: the three production implementations, the independent oracle, the extended `VC-A3` matrix, the old-rule regression control, and `S1G-C4`'s ten arrival-chain proofs |
| this one | `docs(s1g)`: the dispositions, the result, the test matrix and the freeze |

Every disposition below ends in exactly one category:

* **DIRECT ARCHITECTURE REQUIREMENT**
* **OWNER CLARIFICATION — ACCEPTED**
* **IMPLEMENTATION DETAIL — NON-SEMANTIC**
* **DEFERRED PRODUCTION RESIDUAL**
* **DEFECT**
* **OWNER DECISION STILL REQUIRED**

---

## 0. Summary

| Item | Category | Production change |
|---|---|---|
| `S1G-C1` `ACOS-JCS-1` NULL / `bytea` collision | **DEFECT** — resolved by architecture erratum **v1.3.2 JCS-01** | **YES** — three implementations, the oracle, and one new negative control |
| `S1G-C2` the "there is no AUDIT PLANE" assertion narrowed | OWNER CLARIFICATION — ACCEPTED (strictly additive) | none |
| `S1G-C3` the step-X boundary test renamed | IMPLEMENTATION DETAIL — NON-SEMANTIC | none |
| `S1G-C4` `chain_seq` as the arrival counter | OWNER CLARIFICATION — ACCEPTED, **supplemental only** | none; **10 tests added** |
| `S1G-C5` `I17c`'s DB leg built, SCHED leg not | DEFERRED PRODUCTION RESIDUAL — `I17c` remains **PARTIAL** | none |
| `S1G-C6` three audit roles rather than one | IMPLEMENTATION DETAIL — NON-SEMANTIC (stricter than required) | none |
| `S1G-C7` transmitted bytes **and** own reconstruction | OWNER CLARIFICATION — ACCEPTED | none |
| `S1G-C8` separate provider / account | DEFERRED PRODUCTION RESIDUAL — **OPEN**, and not a blocking S1 condition | none |

**One item resolved to DEFECT: `S1G-C1`.** It was a defect in the *architecture*, not in the
candidate: S1G found it, refused to invent a representation, failed the input closed in all
three implementations and reported `VC-A3`'s generic `bytes` leg PARTIAL. This pass supplies
the owner decision, issues it as a normative erratum, and corrects every implementation.

**No item resolved to OWNER DECISION STILL REQUIRED.**

---

## 1. `S1G-C1` — the `ACOS-JCS-1` NULL framing collision

### `DEFECT` — resolved normatively by **architecture package issue v1.3.2, erratum JCS-01**

### The defect, restated exactly

`30 §5.3` declared, generically and with no type qualifier:

> | Nulls vs empty strings | Single `0x00` sentinel byte for null; an empty string is a zero-length value. |
> | Field framing | Every field prefixed with its **4-byte big-endian byte length**, so no separator can be forged by content. |

Compose the two over a `bytea` field:

| Value | Payload under the v1.2 rule | Framed |
|---|---|---|
| SQL `NULL` | the sentinel, one `0x00` byte | `00 00 00 01 00` |
| `bytea` `'\x00'` | the value itself, one `0x00` byte | `00 00 00 01 00` |

**The same bytes.** The encoding was not injective, so two conforming implementations could
hash a NULL field and a real one-byte payload to one value — in a control artifact whose
entire purpose is that two independent chains agree only when both canonicalise identically.

`text` was accidentally safe: owner clarification **S1B-C8** excludes `U+0000` from ACOS
canonical text and PostgreSQL `text` cannot store one. There was no equivalent rule for
`bytea`, and `30 §5.3`'s rules are declared over **fields**, not over column types.

### The owner decision

**Rejecting the byte value `0x00` forever was NOT the selected remedy.** A general-purpose
binary field that cannot carry binary is not a repair, and the exclusion would have to be
restated and enforced for every future type. Neither an escape prefix inside the payload nor
a per-field type tag was selected either: the first makes payload rules type-dependent, which
is the property that produced the defect, and the second changes the bytes of every field
including every non-null one.

> **NULL.** A field-level NULL is encoded as exactly `0xFFFFFFFF` as the 4-byte unsigned
> big-endian length/discriminator word. **It carries no payload bytes.**
>
> **NON-NULL.** `uint32_be(payload_length) || payload`, where
> `0 <= payload_length <= 0xFFFFFFFE`. The payload continues to use the existing
> type-specific `ACOS-JCS-1` representation, unchanged.
>
> `0xFFFFFFFF` is **reserved** and can never be a non-null payload length. A payload whose
> length would reach it is not representable and the implementation must **fail closed**.

### The five representations, and why they cannot collapse

| Value | Framed bytes |
|---|---|
| SQL `NULL` | `FF FF FF FF` — reserved word, no payload |
| empty string | `00 00 00 00` |
| empty `bytea` | `00 00 00 00` |
| `bytea` `'\x00'` | `00 00 00 01 00` |
| JSON literal `null` | `00 00 00 04 6E 75 6C 6C` — an ordinary non-null field |

Injectivity is now **structural rather than conditional**. Every non-null field begins with
its own length word, and no length word can be `0xFFFFFFFF`, so the NULL encoding and the set
of all non-null encodings are disjoint by construction — for every type at once, with no
type's payload rule needing to avoid a byte value in order to stay clear of NULL.

### What the erratum did NOT change

**Every non-null payload encoding is byte-identical to v1.3.1's.** Decimal scale, NFC,
timestamps, integers, booleans, `bytea` payloads, RFC 8785, declared field order, SHA-256
over the transmitted bytes, and the row-chain formula. **S1B-C8 is retained, unchanged and
unrelaxed** — it is simply no longer the injectivity argument it was written as, and
`U+0000` remains inadmissible in ACOS canonical text.

A row with **no** NULL field hashes to exactly the value v1.3.1 produced. A row with **at
least one** NULL field hashes to a new value, five bytes replaced with four per NULL field.

### Production change — THREE implementations, not two

The mandate names two production implementations. There are three, and leaving the third
behind would have put two incompatible NULL representations inside one system:

| Implementation | File | Change |
|---|---|---|
| **Control PostgreSQL** | `src/db/migrations/0007__local_authorisation.sql` | `acos_jcs1_field` is now non-`STRICT` and emits `\xffffffff` for a NULL input; `acos_jcs1_null()` is **deleted**; every type helper returns SQL `NULL` for a NULL input; the `0xFFFFFFFE` bound raises `JCS1_FIELD_TOO_LONG` |
| **Audit PostgreSQL** | `src/audit/db/migrations/A0001__audit_store.sql` | the same rule, **independently derived**: the reserved word is assembled byte by byte with `set_byte`, as the length prefix already was, rather than written as the literal the control plane writes. `audit_jcs1_null()` **deleted**; `audit_jcs1_bytes`'s `JCS1_BYTES_AMBIGUOUS_WITH_NULL_SENTINEL` refusal **deleted**, because the ambiguity it guarded no longer exists; the bound moves from `int4`'s `2147483647` to the specification's `0xFFFFFFFE` |
| **TypeScript kernel** | `src/kernel/canonicalisation/canonicalBytes.ts` | `fieldValueBytes` returns `Buffer \| null`; `canonicalBytes`'s framer emits the reserved word for `null` and refuses an over-long payload. This is the S1B module that canonicalises decision signatures, lineage, idempotency keys and option digests under the same `30 §5.3` |
| **Independent oracle** (test) | `tests/support/jcs1Oracle.ts` | rewritten from the v1.3.2 specification. `frameField` now accepts `null`; `frameLength` is exported so the boundary arithmetic is testable without a 4GB fixture; `jcsBytes`'s refusal is gone. **Imports nothing from `src/`**, asserted |

**The control-side journal chain is still written by the trusted database mechanism.** No row
hash is computed in caller TypeScript as authority; `0008`'s `effect_journal_canonical_bytes`
declaration is unchanged field for field, and only the framing helper it calls moved.

**Independence is preserved.** The audit database still does not contain, import or reach
`acos_jcs1_*`; the control database does not contain `audit_jcs1_*`; the oracle imports
neither. All three are asserted in `vc-a3-cross-implementation.test.ts`.

### The regression proof

`tests/negative-controls/unsafe-old-null-sentinel.ts` retains v1.2's rule as **TEST-ONLY**
code, importing nothing at all, and
`tests/negative-controls/old-null-sentinel-collision.test.ts` shows both halves:

* under the withdrawn rule, SQL NULL and `bytea` `'\x00'` frame to **identical** bytes, and a
  whole row containing one is indistinguishable from a whole row containing the other;
* under the current rule they differ — in the **oracle**, in the **control** database and in
  the **audit** database, each checked separately;
* the old NULL bytes are exactly the *new* one-byte-value bytes, which is what makes the test
  discriminate rather than restate;
* nothing under `src/` reaches the withdrawn rule, asserted by scanning `src/`.

### Version and control-artifact effect

`ACOS-JCS-1` is **control artifact class 20** (`50 §2`), and `50 §3` hashes each class's
canonicalised content into the signed manifest.

* **The artifact name is unchanged: `ACOS-JCS-1`**, by owner decision. The correction repairs
  the artifact's stated intent rather than replacing it.
* **Class 20's `content_hash` changes**, and a fresh class-20 owner signature is owed before
  any deployment. `50 §2` row 20 records that.
* **No second version field was invented.** There is no persisted `canonical_format_version`
  anywhere in the architecture or the implementation — searched, and absent — and this pass
  does not create one. The class-20 content hash in the signed manifest is the existing
  identity mechanism and it is sufficient. `§11` of the mandate forbids an ad-hoc second
  field where the control-artifact mechanism already supplies identity, and it does.
* **No other control-artifact class is normatively affected.**

### Deployment — what is NOT claimed

`30 §5.3` already said a canonicalisation change "is a chain break by construction and
requires a declared migration with a re-anchor". **This correction is NOT claimed to be
applicable to an already deployed live chain.** ACOS is not deployed, there is no live
journal, and no anchor has ever been published, so nothing has to be migrated at v1.3.2. **A
future canonical-format change on a deployed chain would require deliberate chain-versioning
and re-anchor semantics that this architecture does not yet declare.** That obligation is
recorded in `phase2-v1.3.2-errata.md §1` *Deployment* and carried forward in `§11` below.

---

## 2. `S1G-C2` — the "there is no AUDIT PLANE" assertion

### `OWNER CLARIFICATION — ACCEPTED` — test supersession is **strictly additive** in security meaning

The owner accepts the supersession **only** on that condition, and the condition holds.

`tests/integration/authority/local-authorisation-boundary.test.ts` is the **only** accepted
test file S1G modified: `git diff 395a13b...f79c664 --stat -- tests/` shows one changed
accepted file, `+90 / -9`. Every other S1A–S1F test file is byte-identical.

### The exact old → new assertion mapping

| S1F assertion | S1G assertion | Weakened? |
|---|---|---|
| `it('there is no AUDIT PLANE — no push, no attestation, no mirror, no anchor')` — patterns `auditUrl(`, `JournalAttestation`, `mirrorState`, `DegradedModeOverride`, `anchor`, `mirrored_at =`, over all of `src/` except `db/pool.ts` | **split into two tests**, below | **No** |
| — | `it('the AUTHORITY AND MONEY PATH contains no audit-plane code — S1G confined it')` — `auditUrl(`, `JournalAttestation`, **`emitAttestation`**, **`auditIngress`**, **`JournalPusher`**, `mirrored_at =`, over all of `src/` except `db/pool.ts`, `src/audit/` and `src/replication/` | **No** — the same three original patterns, **plus three new ones**, and the exemption is exactly the two directories the slice was authorised to create |
| — | **new:** `it('and the LOCAL AUTHORISATION TRANSACTION still knows nothing about the audit plane')` — `auditUrl`, `audit/`, `replication/`, `mirrored_at`, `audit_journal` forbidden in `localAuthorisation.ts`, the module owning the S1F transaction | **No** — new, and the sharpest form of the property S1F's assertion was protecting |
| — | `it('THE MIRROR STATE MACHINE, THE OVERRIDE AND THE ANCHOR ARE STILL ABSENT')` — `mirrorState`, `DegradedModeOverride`, `anchor`, **`MirrorInputStall`**, **`CORROBORATED_DEGRADED`**, **`UNCORROBORATED_STALL`**, **`DISPATCHED_UNMIRRORED`**, over the **whole** of `src/` with **no exemption at all** | **No** — the same three original patterns held over a **wider** scope than S1F held them, plus four new ones |

**The only narrowing is the named two-directory exemption**, and it applies to exactly three
patterns — `auditUrl(`, `JournalAttestation`, `mirrored_at =` — for exactly the directories
`30 §5.1`'s step X had to be built in. Every deferred-mechanism pattern is held over all of
`src/`, including the new audit plane.

### The substantive S1F boundaries, checked one by one

| Boundary | Where | Status |
|---|---|---|
| no external dispatch | `it('and DISPATCH is still not implemented')`; `DISPATCH_IS_NOT_IMPLEMENTED` | **retained**, and a new assertion added |
| no outbox, no exclusive claim | `it('there is no SETTLEMENT, RECONCILIATION or EXTERNAL CLAIM path')` | **retained verbatim** — unchanged by the diff |
| no adapter, no vendor read | same test, plus `plane-independence.test.ts` asserting no outbound call anywhere under `src/audit/` | **retained and extended** |
| no approval resume / `R′` | `it('there is no APPROVAL RESUME path')` | **retained verbatim** |
| local COMMIT independent of audit | `post-commit-and-crash-matrix.test.ts` — the control transaction commits with the audit store unreachable | **retained and extended** |
| original atomicity assertions still execute | `local-transaction-atomicity.test.ts` is **not in the S1G diff** — byte-identical and running | **retained verbatim** |
| exactly one Cedar decision path | `it('there is exactly ONE Cedar decision path')` | **retained verbatim** |

**No assertion was deleted.** The nine removed lines in the diff are two test titles, five
comment lines, one `expect` message string replaced by an equivalent, and the relocation of
`/mirrored_at\s*=/` between the two pattern lists.

---

## 3. `S1G-C3` — the step-X boundary test's title

### `IMPLEMENTATION DETAIL — NON-SEMANTIC`

Both accepted assertions are unchanged and both still pass:

```ts
expect([...LOCAL_AUTHORISATION_STEPS]).not.toContain('X');
expect([...AUTHORITY_STEPS]).not.toContain('X');
```

Only the title changed, from *"because it is not implemented"* to *"because it is AFTER THE
COMMIT"*. S1G implements step X exactly where `30 §5.1` puts it — after the COMMIT, in a
separate `POST_COMMIT_STEPS` table — so appending `'X'` to either accepted table would have
been a claim that the audit write shares a commit point with the money path, which is the one
thing `30 §5.1` says does not exist. Two tests were added beside it: one asserting the new
table is disjoint from both and that the three concatenate to `26 §7`'s whole sequence, one
asserting dispatch is still unbuilt.

**Production change: none.** No authority quantity, no ordering rule and no trust boundary
moves with a test title.

---

## 4. `S1G-C4` — `chain_seq`, the audit store's arrival counter

### `OWNER CLARIFICATION — ACCEPTED` — an **additional, audit-local append chain**, and nothing more

The owner accepts `chain_seq` **only** as supplemental tamper-evidence over the immutability
and order of what the audit database actually received. It does **not** replace or redefine
the transported control-journal semantics.

**Authoritative for transport integrity and completeness, unchanged:** the control
`journal_seq`; the independently reconstructed `ACOS-JCS-1` row representation; the
independently verified control `prev_hash`; the independently verified control `row_hash`;
and `JournalAttestation`'s declared control head.

### Why arrival order is the only order the audit chain can use

`30 §5.5` case 1 and `36 §2` VC-A1's mid-range omission require the store to hold `1, 2, 4`
and report `3` missing. A store that chained by `journal_seq` could not accept `4` at all, and
a receiver that refused the row would destroy the evidence the gap check exists to read.
`I17b` anchors `{head_hash, chain_seq, row_count}` — three quantities, with `chain_seq` named
separately from `count(DISTINCT journal_seq)` — and `I17d` names `chain_seq` among the values
the writer must not compute.

### `NOT A DEFECT` — verified, not assumed

`src/audit/transportCompleteness.ts` is the module that owns `I17` and `I17e`. **It never
names `chain_seq`, `audit_prev_hash` or `audit_row_hash`**, and that is now asserted from the
source rather than reasoned about. Every operand it reads is a control-journal quantity:
`journal_seq`, `claimed_row_hash`, `attested_max_journal_seq`, `attested_row_count`,
`attested_head_hash`.

### Tests added by this pass — `§13`'s six required proofs

`tests/integration/audit/arrival-chain-vs-control-completeness.test.ts`, 10 tests:

| # | Required proof | Result |
|---|---|---|
| 1 | receive `journal_seq` 1, 2, 3 in order | `chain_seq` = 1, 2, 3, and the agreement is asserted to be a coincidence of in-order delivery |
| 2 | a benign retry of 2 arriving after 3 | `AUDIT_PUSH_DUPLICATE`; **no fourth arrival link**, and 2 keeps its original `chain_seq` |
| 3 | receive 1 then 3, with 2 missing | the row is HELD, and the arrival chain closes over the gap with two contiguous links |
| 4 | receive 3 before 2 | holdings read 1, 2, 3 by `journal_seq`; the arrival chain records `1, 3, 2` and links in arrival order; the CONTROL chain still verifies row by row |
| 5 | the arrival chain cannot make a missing `journal_seq` appear complete | holdings 1 and 3 give a **perfect** arrival chain, and the evaluator still reports the gap at 2. **The defective evaluator — one reading arrival order — is written in the test and reports nothing**, so the two disagree on this exact fixture |
| 6 | the attestation comparison is against control-journal semantics | a truncated tail is caught with the arrival chain intact; the attested head hash is compared to the CONTROL row hash at the attested control sequence and is asserted **not** to be the arrival-chain head; `row_count` is `count(DISTINCT journal_seq)`, so an extra arrival neither fills a gap nor slanders an honest attester |

**Production change: none.** The implementation already had the property; what was missing was
the proof that it does, and a control showing what the alternative would have said.

---

## 5. `S1G-C5` — `I17c`'s DB leg and its SCHED leg

### `DEFERRED PRODUCTION RESIDUAL` — `I17c` remains **PARTIAL**

### The exact wording S1G recorded

> Two artifacts disagree about where `I17c` lands, and both are satisfied by building half:
> `37` **S1** Build, verbatim: *"Separate audit Postgres on a separate account with
> **insert-only grant under quota**, its own trigger-computed chain, and the two-sided
> completeness diff."* Registry `I17c` Enforcement: **`DB (quota) + SCHED`**; Slice column:
> **`S6`**.

### The architecture passages

Registry `I17c`, verbatim: *"Per-principal insert quotas are enforced at the audit database;
saturation is an incident, not a throughput event and not a mode change."* Enforcement
`DB (quota) + SCHED`; Slice **S6**; Verification: *"Flood the audit store from the control
principal and assert an incident rather than a mode change."* And `30 §5.1` item 5:
saturation is *"an incident, not a mode change"*.

### Does it affect behaviour, trust or authority?

**Behaviour: yes, and the built half is the half that binds.** The quota is charged inside the
ingest trigger, and `CHECK (inserted_rows <= max_rows)` makes `inserted_rows > max_rows`
structurally unrepresentable — a saturated quota refuses the write at the database, not in
application logic. **Trust: no change.** The quota exists because AUDA-05 observed that a
control plane holding unquota'd INSERT can fill the audit store and convert the company into
an approval queue; the DB leg closes that. **Authority: no change.**

### Implementation and tests

`audit_insert_quota (principal_name, window_start, max_rows, inserted_rows)` with the CHECK;
charged FOR UPDATE inside the ingest transaction so two concurrent pushes cannot read the same
headroom; saturation raises `AUDIT_QUOTA_SATURATED` as an **incident**. Asserted in
`audit-role-security.test.ts`, including a **quota-as-throughput** vulnerable control — a
reading under which saturation degrades the mode rather than raising an incident.

### Disposition

`37` S1's build text is satisfied in full — *"insert-only grant under quota"* is built. The
**scheduled continuous check** the registry places at **S6** is not built and is not claimed.
**`I17c` is reported PARTIAL, exactly as the candidate reported it, and this pass does not
upgrade it.** `§19` of the mandate is honoured: nothing about `I17c` improves merely because
S1G becomes PASS.

---

## 6. `S1G-C6` — three audit roles rather than the one `30 §5` names

### `IMPLEMENTATION DETAIL — NON-SEMANTIC` — and stricter than required

### The exact wording S1G recorded

> `30 §5` names the control plane's grant ("INSERT and nothing else") and requires the hash
> functions to run "under roles the writing principal cannot execute as" (`I17d`). It does not
> enumerate the audit plane's own roles.

### The architecture passages

`30 §5`: *"Append-only | Enforced at the database layer: the control plane holds INSERT and
nothing else, under a per-principal insert quota (I17c)."* `I17d`: *"Hash and sequence values
are computed by database functions inside each instance, under roles the writing principal
cannot execute as."* Neither passage enumerates the audit plane's internal roles.

### Does it affect behaviour, trust or authority?

**Behaviour: no** — no check, ordering or quantity depends on the role count. **Trust: yes,
and only in the safe direction.** `acos_audit_evaluator` holds SELECT on the holdings and
INSERT on findings, and **no INSERT on holdings**, so a compromised evaluator cannot
manufacture the holdings it then certifies. That is a property the architecture does not
require and does not forbid. **Authority: no change** — no grant, ceiling or window moves.

### Implementation and tests

A0001 creates `acos_audit_owner` (NOLOGIN, owns everything),
`acos_audit_replication` (the control plane's credential — INSERT on `audit_journal`, EXECUTE
on the ingest entry point, nothing else anywhere) and `acos_audit_evaluator`. Asserted in
`audit-role-security.test.ts`: the replication principal cannot UPDATE, DELETE, TRUNCATE,
execute the chain function, or touch `audit_incident`; the evaluator cannot INSERT a holdings
row.

### Disposition

**Accepted as implemented.** If the owner later prefers the evaluator and the owner to be one
principal, the change is a grant and nothing else — recorded here so the choice stays visible
rather than becoming an accident of the first migration.

---

## 7. `S1G-C7` — the transmitted bytes **and** the store's own reconstruction

### `OWNER CLARIFICATION — ACCEPTED`

### The exact wording S1G recorded

> Two requirements pull in different directions and S1G satisfies both:
> `30 §5.3`: *"The transmitted bytes are what is hashed. The audit store re-chains over the
> bytes it received, **not over a re-serialisation of its own parsed columns**."*
> `I17e`, `I41` and `36 §2`'s VC-A3 all require the audit side to canonicalise
> **independently**, or the second chain proves nothing beyond the first.

### The architecture passages

`30 §5.3`, unchanged by v1.3.2: *"The transmitted bytes are what is hashed. The audit store
re-chains over the bytes it received, not over a re-serialisation of its own parsed columns. A
parse-then-reserialise step would reintroduce every hazard above at the receiving end."* And
registry `I41`: *"The local control journal chain and the audit store's independently
recomputed chain both verify, continuously, **over the transmitted `ACOS-JCS-1` canonical byte
string**. Neither side re-serialises from `jsonb`."*

### Does it affect behaviour, trust or authority?

**Behaviour: yes, at ingest.** A divergence between the two canonicalisers becomes a
**refusal** — `AUDIT_CANONICAL_MISMATCH` — rather than a surprise at the next `VC-A3` run.
**Trust: strictly stronger than either requirement alone.** Chaining over the wire bytes alone
would let a control plane whose canonicaliser had diverged push rows the audit store never
checks; reconstructing without comparing would be exactly the silent parse-then-reserialise
`§5.3` forbids. Comparing means `§5.3`'s hazard cannot be reintroduced **silently**, which is
the word that matters in it. **Authority: no change.**

### Implementation and tests

`audit_ingest_journal_row` reconstructs the canonical bytes from the structured columns using
the audit database's **own** implementation and refuses the row unless the reconstruction is
byte-identical to `transmitted_bytes`. Asserted in `ingestion-and-rechaining.test.ts` (fields
altered with the original hash retained; bytes altered with honest fields; a forged
predecessor; a genesis row that does not chain from 32 zero bytes) and in
`vc-a3-cross-implementation.test.ts`'s **divergent re-serialising receiver** control.

**This disposition is unaffected by JCS-01.** The correction changed what the canonical bytes
of a NULL field *are*; it did not change which bytes are hashed, who computes them, or that
the two must be equal.

---

## 8. `S1G-C8` — separate provider and separate account

### `DEFERRED PRODUCTION RESIDUAL` — **OPEN**, and **not** a blocking S1 condition

### The exact wording S1G recorded

> `30 §5` requires *"a distinct database instance on a different provider or, at minimum, a
> separate account with a separate payment method and separate operator credentials"*. The
> harness creates two separate PostgreSQL instances … It cannot create a separate cloud
> account or a separate payment method.

### Is it a blocking S1 PASS requirement?

**No.** `58 §9` — the passage the mandate names — makes provisioning the separate audit
account a **permitted narrow exception**, not a pass condition:

> **A narrow exception is reasonable and should be taken.** … **Provisioning the separate
> audit account and provider** (`33 §7`, `49 §3.2`). It is an S1 provisioning decision, it
> takes calendar time, and SR-A1's third review needs a real second account to reason about.

`62 §5` carries the same item as authorised work, and `62 §11`'s ten pass-revocation
conditions — carried into `phase2-v1.3-implementation-brief.md §7` — contain no
provider/account condition. `37` S1's build text names *"a separate account"* as build scope;
`58 §9` is the gate, and it does not make it blocking. **S1G is therefore not left PARTIAL on
this account.**

### The two claims, recorded separately

**`MECHANISM INDEPENDENCE — PROVEN IN S1`.** Two separate PostgreSQL clusters with different
`pg_control_system().system_identifier` values, different published ports, different
databases, separate migration directories with separate ledger tables, separate roles, and no
transaction spanning both. The control canonicaliser does not exist on the audit server and
the audit canonicaliser does not exist on the control server. The audit evaluator runs with
the control database unreachable. All asserted in `plane-independence.test.ts`.

**`PRODUCTION PROVIDER/ACCOUNT INDEPENDENCE — OPEN`.** The harness cannot create a separate
cloud account, a separate payment method or separate operator credentials, and **no test
pretends otherwise**. `docker-compose.yml` has said since S1A that two local containers are
not that, and `A0001`'s header repeats it. `58 §9` records the provisioning as
permitted-but-not-performed at this phase.

**No cloud-provider distinction is faked anywhere.** Every store-independence assertion is
against what actually exists.

---

## 9. Attestation semantics — unchanged

`§16` of the mandate. The `ACOS-JCS-1` correction moves the attestation row's **bytes**,
because `attested_head_hash` and `prev_hash` are nullable `bytea` and the genesis attestation
carries NULLs. Nothing about its **semantics** moves, and each of these is still asserted:

| Property | Status |
|---|---|
| the attestation is a real journal row | unchanged — `vc-a1-transport-completeness.test.ts` |
| same journal counter | unchanged — a real `journal_seq` from the same counter |
| same chain | unchanged — chains from the previous row's `row_hash` |
| same replication path | unchanged — no privileged side channel exists, asserted |
| 5-minute cadence, k = 3 | unchanged — `30 §5.4`'s declared values, and the 15-minute bound is their product |
| tail truncation against an honest attester detected | unchanged — VC-A1 case B |
| attestation suppression detected | unchanged — VC-A1 case C, presenting as a sequence gap |
| total writer stop detected at the declared bound | unchanged — VC-A1 case D, `ATTESTATION_STALL` at k × cadence |

---

## 10. The adversarial attester — expected silence retained

`§17`. `vc-a1d-adversarial-attester.test.ts` is unchanged by this pass and **still passes by
staying silent**: control has real rows through N, the attacker delivers only through M and
freezes its attested prefix to match, and the audit plane sees a self-consistent frozen
prefix.

**`I17e` DOES NOT DETECT IT, and that remains the expected PASS of the negative control.** The
`ACOS-JCS-1` correction is not an excuse to overclaim transport completeness: it makes the two
chains agree on NULL-bearing rows, which says nothing about rows that never arrive. `I8` owns
this residual where independent vendor truth exists, and registry `§3` item 9 owns the class
of rows with no vendor counterpart, for which no detector exists under any mechanism in this
architecture.

---

## 11. Verification after the pass

### Architecture — `docs/architecture/v1.3.2/analysis/consistency-v1.3.py`

| Run | Result | Exit |
|---|---|---|
| clean | **25 PASS / 0 FAIL** — 22 conditions carried from v1.3.1 with their text unmodified, plus **F1**, **F2**, **F3** | 0 |
| `--seed-old-null-bytes` — only SQL NULL's bytes in `30 §5.3`'s worked-example table revert | **24 PASS / 1 FAIL** — F3 fails on the collision itself: `null=00 00 00 01 00`, `bytes00=00 00 00 01 00`, three distinct encodings from five printed rows | 1 |
| `--seed-old-null-sentinel` — the whole withdrawn rule restored, six edits | **22 PASS / 3 FAIL** — F1, F2 and F3 | 1 |

Both seeded runs are recorded verbatim in
`analysis/consistency-v1.3.2-negative-control-output.txt`, with their process exit codes.
The clean run is `analysis/consistency-v1.3.2-output.txt`.

**Every prior v1.3.1 condition remains PASS**, including `E1` (the rate-class Step R
denylist) and `C4` (every deliverable still declares `Operating Spine v1.3`, because the
architecture is v1.3 and `v1.3.2` is the package issue).

`recompute-v1.3.py`, rerun unmodified, reproduces `recompute-v1.3-output.txt`
**line-for-line**. **No authority quantity moved. No MAL change. No Step-ordering change.**

### Repository — `npm run verify`

| | |
|---|---|
| result | **green, exit 0** |
| typecheck | clean |
| lint | clean at `--max-warnings 0` |
| test files | **86** (candidate 84) |
| tests | **1204** (candidate 1171) |
| passed / failed / skipped | **1204 / 0 / 0** |
| `.only`, `.skip`, `.todo` | **none**, grepped; `vitest.config.ts` includes `tests/**` and `spikes/**` and filters nothing |
| focused S1G | **10 files, 147 tests** |
| tests using BOTH PostgreSQL instances | **147 — all of them** |

Every accepted S1A–S1F test is green. Four of them had a **rule transcription** of `30 §5.3`
corrected — `S1G-implementation-log.md §9.3` lists all four — and none had an assertion
weakened or removed.

---

## 12. Obligations carried forward

1. **The chain-versioning and re-anchor procedure for a canonical-format change on a deployed
   chain.** Owed before any such change is applied to a live journal; not owed at v1.3.2,
   because nothing is deployed and no anchor has been published. `phase2-v1.3.2-errata.md §1`
   *Deployment*.
2. **A fresh class-20 owner signature** over the corrected `ACOS-JCS-1`. `50 §2` row 20.
3. **`I17c`'s SCHED leg** — the scheduled continuous check, registry slice **S6**. `I17c`
   remains PARTIAL.
4. **Production provider / account independence** — `30 §5`'s separate-provider leg. OPEN,
   and not blocking at S1.
5. **The generic JSON leg of `ACOS-JCS-1` in production.** Neither declared row kind carries a
   JSON column, so RFC 8785 is settled by the oracle alone and no SQL-side JCS implementation
   exists in either database. A future row kind carrying JSON needs one in **both**, and
   `VC-A3` needs to cross-implement it.
6. Everything `S1G-result.md §7` already carried, unchanged in disposition.
