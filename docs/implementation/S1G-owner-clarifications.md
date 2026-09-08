# S1G — Owner clarifications

Every point below needs an owner disposition. Each states what was found, what was done,
and what the alternative would have cost.

> **OWNER RESOLUTION — RECORDED.** All eight items have been dispositioned by the owner.
> The dispositions, the evidence each was checked against, the architecture erratum
> `S1G-C1` required and the implementation corrections that erratum forced are in
> [`S1G-owner-resolution.md`](./S1G-owner-resolution.md).
>
> **`S1G-C1` resolved to DEFECT** — a defect in the architecture, not in the candidate.
> It is corrected normatively by **architecture package issue v1.3.2, erratum JCS-01**
> (`docs/architecture/v1.3.2/phase2-v1.3.2-errata.md`), which reframes a field-level NULL
> as the reserved 32-bit length word `0xFFFFFFFF` carrying no payload. **`docs/architecture/v1.3.1/`
> is not modified**; `v1.3.2` is a new immutable package directory. No other item resolved
> to DEFECT and none to OWNER DECISION STILL REQUIRED.
>
> **This document is retained as written.** It records what S1G found and what S1G chose
> NOT to invent, which is the reason the defect reached an owner decision rather than being
> resolved silently in code.

---

## S1G-C1 — `ACOS-JCS-1` has a real, unresolved ambiguity over `bytea`, and it was NOT invented away

**Requested disposition: `ARCHITECTURE AMBIGUITY — VC-A3 GENERIC `bytes` LEG REPORTED
PARTIAL`.**

**OWNER DISPOSITION: `DEFECT` — and it is a defect in the ARCHITECTURE.** The collision below
is a real normative injectivity failure in control artifact class 20, not an ambiguity to be
worked around. Rejecting the byte value `0x00` forever was **not** the selected remedy.
**Architecture package issue v1.3.2, erratum JCS-01** reframes a field-level NULL as the
reserved 4-byte big-endian word `0xFFFFFFFF` carrying **no payload**, with non-null fields as
`uint32_be(payload_length) || payload` and `0 <= payload_length <= 0xFFFFFFFE`. Every
existing non-null payload encoding is unchanged byte for byte; only NULL framing moved, so
only NULL-bearing rows change hash. **All three implementations and the oracle were corrected,
the refusals recorded below were removed because the ambiguity they guarded no longer exists,
and `VC-A3`'s generic `bytes` leg is now CLOSED.** Class 20's `content_hash` moves and a fresh
class-20 owner signature is owed before deployment. `S1G-owner-resolution.md §1`.

**What `30 §5.3` says.** The nulls rule is generic and has no type qualifier:

> Nulls vs empty strings — **Single `0x00` sentinel byte for null; an empty string is a
> zero-length value.**

and the framing rule is:

> Every field prefixed with its **4-byte big-endian byte length**.

**The consequence, stated exactly.** A `bytea` value whose content is exactly the single
byte `0x00` frames as `00 00 00 01 00`. SQL `NULL` frames as `00 00 00 01 00`. **They are
the same bytes, and `30 §5.3` declares no rule that separates them.**

For `text` the gap is already closed — owner clarification **S1B-C8** excludes `U+0000`
from ACOS canonical text, and PostgreSQL `text` cannot store one, so no accepted string can
imitate the sentinel. There is no equivalent clarification for `bytea`.

**What was done, and what was NOT done.**

* **Nothing was invented.** No sentinel, no escape prefix, no length discriminator, no
  type tag. Inventing one would have been a silent extension of a control artifact whose
  identity is versioned in its name (`30 §5.3`: "A change is a chain break by construction
  and requires a declared migration with a re-anchor").
* **The ambiguous input FAILS CLOSED**, identically in all three implementations: the
  control side never receives one, the audit side raises
  `JCS1_BYTES_AMBIGUOUS_WITH_NULL_SENTINEL`, and the independent oracle throws. This
  follows the precedent S1B-C8 set — exclude the input rather than encode around it — but
  it is applied here by the implementation and is NOT claimed as an owner decision.
* **It is unreachable from either declared row kind.** The only `bytea` fields are
  `prev_hash` and `attested_head_hash`, each always NULL or a 32-byte SHA-256 digest.

**The carried-forward JSON question IS resolved, and needed no invention.** `S1F-C7` left
"any generic nullable `bytes` / JSON literal-null integration issue" open. The JSON half is
answered by `30 §5.3` as written: RFC 8785 renders JSON literal `null` as the four bytes
`null`, framed at length 4; SQL NULL is the one-byte sentinel, framed at length 1. Distinct.
Asserted in `vc-a3-cross-implementation.test.ts`. Neither journal row kind carries a JSON
column, so no production row exercises the rule, and that too is asserted against both
schemas so a later migration cannot introduce one silently.

**Consequence for the verdict.** `VC-A3` is CLOSED for every representation the two
declared row kinds actually use. The **generic `bytes` leg is PARTIAL** and needs an owner
ruling before any future row kind carries a free-form `bytea`.

**Cost of the alternative.** Choosing a representation now — say, length-prefixing bytes
inside the value — would make the two implementations agree on something the architecture
does not say, and the disagreement would only surface when a third implementation is written
against the specification rather than against this code.

---

## S1G-C2 — the accepted "there is no AUDIT PLANE" assertion was NARROWED, not deleted

**Requested disposition: `SLICE BOUNDARY MOVED — EXPECTED`.**

**OWNER DISPOSITION: `OWNER CLARIFICATION — ACCEPTED`.** Accepted on the stated condition
and only on it: the supersession is **strictly additive in security meaning**. Verified — one
accepted test file changed in the whole slice, no assertion deleted, no external-dispatch,
outbox or adapter assertion removed, local COMMIT still independent of the audit plane, the
original atomicity assertions byte-identical and still executing, and the only narrowing is a
two-directory exemption for three named patterns. Exact old-to-new mapping in
`S1G-owner-resolution.md §2`. No production change.

`tests/integration/authority/local-authorisation-boundary.test.ts` asserted, as S1F wrote
it:

> `it('there is no AUDIT PLANE — no push, no attestation, no mirror, no anchor')`

That was correct for S1F, which built none. **S1G builds one**, so the literal assertion
cannot survive the slice whose entire purpose is step X.

**What replaced it — three tests where there was one, and no assertion weakened:**

| Was | Now | Weakened? |
|---|---|---|
| no `auditUrl(`, `JournalAttestation`, `mirrored_at =` anywhere in `src/` | the same patterns, plus `emitAttestation`, `auditIngress` and `JournalPusher`, forbidden everywhere in `src/` **except** `src/audit/` and `src/replication/` | **No** — the exempt set is two named directories, and the rule over the rest of `src/` is stricter than before (three more patterns) |
| — | **new:** `localAuthorisation.ts` — the module owning the S1F transaction — may not name `auditUrl`, `audit/`, `replication/`, `mirrored_at` or `audit_journal` | **No** — new, and it is the sharpest form of the property |
| no `mirrorState`, `DegradedModeOverride`, `anchor` in `src/` | the same, plus `MirrorInputStall`, `CORROBORATED_DEGRADED`, `UNCORROBORATED_STALL` and `DISPATCHED_UNMIRRORED`, held over the **whole** of `src/` including the new audit plane | **No** — four more patterns, wider scope |

The property S1F's assertion protected — that the authority path, the money path and the
local transaction contain no audit-plane code — is asserted verbatim and more tightly.

---

## S1G-C3 — the step-X boundary test was RENAMED, and its two assertions kept verbatim

**Requested disposition: `IMPLEMENTATION DETAIL — NON-SEMANTIC`.**

**OWNER DISPOSITION: `IMPLEMENTATION DETAIL — NON-SEMANTIC`.** Both accepted assertions are
unchanged and still pass; only the title moved. `S1G-owner-resolution.md §3`. No production
change.

The accepted test read *"step X … is in NEITHER table, because it is not implemented"*. Its
two assertions were:

```ts
expect([...LOCAL_AUTHORISATION_STEPS]).not.toContain('X');
expect([...AUTHORITY_STEPS]).not.toContain('X');
```

**Both are unchanged and both still pass**, because S1G implements step X exactly where
`30 §5.1` puts it — after the COMMIT, in a separate `POST_COMMIT_STEPS` table. Appending
`'X'` to either accepted table would have been a claim that the audit write shares a commit
point with the money path, which is the one thing `30 §5.1` says does not exist.

Only the test's *title* changed, from "because it is not implemented" to "because it is
AFTER THE COMMIT". Two tests were added beside it: one asserting the new table is disjoint
from both and that the three concatenate to `26 §7`'s whole sequence, one asserting dispatch
is still unbuilt.

---

## S1G-C4 — `chain_seq` is the audit store's ARRIVAL counter, distinct from `journal_seq`

**Requested disposition: `OWNER CLARIFICATION — CONFIRM READING`.**

**OWNER DISPOSITION: `OWNER CLARIFICATION — ACCEPTED` — SUPPLEMENTAL ONLY.** `chain_seq` is
accepted as an **additional, audit-local append chain** protecting the immutability and order
of what the audit database actually received. It does **not** replace or redefine the
transported control-journal semantics: the control `journal_seq`, the independently
reconstructed `ACOS-JCS-1` representation, the independently verified control `prev_hash` and
`row_hash`, and `JournalAttestation`'s declared control head remain authoritative. **Verified
NOT a defect** — `transportCompleteness.ts` never names `chain_seq`, `audit_prev_hash` or
`audit_row_hash`, now asserted from the source. **Ten tests added** covering in-order
receipt, a benign retry of 2 after 3, 1-then-3 with 2 missing, 3 before 2, that the arrival
chain cannot make a missing `journal_seq` look complete (with the defective evaluator written
as a control), and that the attestation comparison is against control-journal semantics.
`S1G-owner-resolution.md §4`. No production change.

`I17b` anchors `{head_hash, chain_seq, count(DISTINCT journal_seq)}` — **three** quantities,
with `chain_seq` named separately from the distinct-sequence count. `I17d` names
"`prev_hash`, `row_hash` and `chain_seq`" as the values the writer must not compute.

S1G reads that as: the audit store keeps **its own** monotonic counter over the order rows
ARRIVED, and chains over that.

**The reading is forced by `30 §5.5` case 1.** The audit store must be able to hold `1, 2, 4`
and report `3` missing (`36 §2` VC-A1's mid-range omission). A store that chained by
`journal_seq` could not accept `4` at all, and a receiver that refused the row would destroy
the evidence the gap check exists to read. So arrival order is the only order the audit
chain can use.

The control chain is still verified — each row's structured `prev_hash` is checked against
the row the store holds at `journal_seq − 1`, and a mismatch is `AUDIT_CHAIN_BREAK`. What
the audit chain adds is tamper-evidence over the store's own holdings, which is `I17d`'s and
`I41`'s subject.

---

## S1G-C5 — `I17c`'s DB leg is built at S1; its SCHEDULED leg is not

**Requested disposition: `SCOPE — CONFIRM SPLIT`.**

**OWNER DISPOSITION: `DEFERRED PRODUCTION RESIDUAL`.** The split is confirmed: `37` S1's
*"insert-only grant under quota"* is built in full and the registry's SCHEDULED leg is S6's.
**`I17c` remains PARTIAL and is not upgraded**, and it does not improve because S1G becomes
PASS. `S1G-owner-resolution.md §5`. No production change.

Two artifacts disagree about where `I17c` lands, and both are satisfied by building half:

* `37` **S1** Build, verbatim: *"Separate audit Postgres on a separate account with
  **insert-only grant under quota**, its own trigger-computed chain, and the two-sided
  completeness diff."*
* Registry `I17c` Enforcement: **`DB (quota) + SCHED`**; Slice column: **`S6`**.

S1G builds the **DB leg** — a per-principal, per-window ledger charged inside the ingest
trigger, with a CHECK constraint that makes `inserted_rows > max_rows` unrepresentable, and
saturation producing an `AUDIT_QUOTA_SATURATED` incident rather than a mode change
(`30 §5.1` item 5). It does **not** build the scheduled continuous check, which is S6's.

**`I17c` is therefore reported PARTIAL.**

---

## S1G-C6 — the audit plane holds THREE roles, not the one `30 §5` names

**Requested disposition: `IMPLEMENTATION DETAIL — STRICTER THAN REQUIRED`.**

**OWNER DISPOSITION: `IMPLEMENTATION DETAIL — NON-SEMANTIC`.** Accepted as implemented,
including the third role. It is stricter than the architecture requires and strictly in the
safe direction: a compromised evaluator cannot manufacture the holdings it then certifies.
Collapsing the evaluator into the owner remains a grant change and nothing else, recorded so
the choice stays visible. `S1G-owner-resolution.md §6`. No production change.

`30 §5` names the control plane's grant ("INSERT and nothing else") and requires the hash
functions to run "under roles the writing principal cannot execute as" (`I17d`). It does not
enumerate the audit plane's own roles.

A0001 creates three: `acos_audit_owner` (NOLOGIN, owns everything),
`acos_audit_replication` (the control plane's credential — INSERT on `audit_journal`, EXECUTE
on the ingest entry point, nothing else anywhere), and `acos_audit_evaluator` (SELECT on
holdings, INSERT on findings, **no INSERT on holdings**).

The third is not required by the architecture and is strictly stronger: it means a
compromised evaluator cannot manufacture the holdings it then certifies. If the owner
prefers the evaluator and the owner to be one principal, the change is a grant.

---

## S1G-C7 — the audit store verifies the transmitted bytes AND its own reconstruction

**Requested disposition: `OWNER CLARIFICATION — CONFIRM READING`.**

**OWNER DISPOSITION: `OWNER CLARIFICATION — ACCEPTED`.** The reading is confirmed: the audit
store chains over the transmitted bytes AND reconstructs from its own structured columns AND
requires the two equal, refusing the row otherwise. Strictly stronger than either requirement
alone, and unaffected by the v1.3.2 correction — JCS-01 changed what a NULL field's canonical
bytes ARE, not which bytes are hashed, who computes them, or that the two must be equal.
`S1G-owner-resolution.md §7`. No production change.

Two requirements pull in different directions and S1G satisfies both:

* `30 §5.3`: *"The transmitted bytes are what is hashed. The audit store re-chains over the
  bytes it received, **not over a re-serialisation of its own parsed columns**. A
  parse-then-reserialise step would reintroduce every hazard above at the receiving end."*
* `I17e`, `I41` and `36 §2`'s VC-A3 all require the audit side to canonicalise
  **independently**, or the second chain proves nothing beyond the first.

S1G's ingest does **both, and requires them equal**: it reconstructs the canonical bytes
from the structured columns using the audit database's own implementation, and refuses the
row unless that reconstruction is byte-identical to `transmitted_bytes`.

**This is strictly stronger than either alone.** Chaining over the wire bytes alone would let
a control plane whose canonicaliser has diverged push rows the audit store never checks.
Reconstructing without comparing would be exactly the silent parse-then-reserialise `§5.3`
forbids. Comparing makes the divergence a refusal at ingest rather than a surprise at the
next `VC-A3` run, and `§5.3`'s hazard cannot be reintroduced because it cannot be silent.

---

## S1G-C8 — the separate-PROVIDER leg of `30 §5` is not satisfiable by the repository harness

**Requested disposition: `ENVIRONMENT LIMIT — REPORTED OPEN`.**

**OWNER DISPOSITION: `DEFERRED PRODUCTION RESIDUAL` — production administrative
independence stays OPEN, and it is **not** a blocking S1 condition.** `58 §9` makes
provisioning the separate audit account a **permitted narrow exception**, not a pass
condition, and `62 §11`'s ten pass-revocation conditions contain no provider/account
condition — so S1G is not left PARTIAL on this account. Recorded as two separate claims:
**`MECHANISM INDEPENDENCE — PROVEN IN S1`** (separate clusters, system identifiers, ports,
databases, migrations, roles; no shared transaction) and **`PRODUCTION PROVIDER/ACCOUNT
INDEPENDENCE — OPEN`**. No cloud-provider distinction is faked anywhere.
`S1G-owner-resolution.md §8`. No production change.

`30 §5` requires *"a distinct database instance on a different provider or, at minimum, a
separate account with a separate payment method and separate operator credentials"*.

The harness creates **two separate PostgreSQL instances** — different clusters, different
system identifiers, different databases, different ports, separate migrations, separate
roles, no shared transaction. It cannot create a separate cloud account or a separate
payment method. `58 §9` already records provisioning the separate audit account as
permitted-but-not-performed at this phase, and `docker-compose.yml` has said since S1A that
two local containers are not that.

**Reported OPEN**, not claimed. Every store-independence assertion in the suite is against
what actually exists.
