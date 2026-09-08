# S1G — Result

**VERDICT: PASS**, after the owner-resolution pass.

**The candidate `f79c664` was PARTIAL, and it was PARTIAL for the right reason.** The one
outstanding criterion was `ACOS-JCS-1`'s failure to distinguish a one-byte `0x00` `bytea`
value from SQL `NULL`. S1G demonstrated the collision, refused to invent a representation,
failed the input closed in all three implementations, and reported the generic `bytes` leg of
`VC-A3` PARTIAL — `S1G-owner-clarifications.md` **S1G-C1**.

**The owner dispositioned it as a DEFECT IN THE ARCHITECTURE and corrected it normatively.**
**Architecture package issue v1.3.2, erratum JCS-01** reframes a field-level NULL as the
reserved 4-byte big-endian word `0xFFFFFFFF` carrying **no payload**, with non-null fields as
`uint32_be(payload_length) || payload` and `0 <= payload_length <= 0xFFFFFFFE`. Every existing
non-null payload encoding is unchanged byte for byte. All three production implementations,
the independent oracle and the test matrix were corrected, and a test-only reconstruction of
the withdrawn rule is retained to prove the correction closes a real defect.

**`VC-A3` is now CLOSED for the full generic representation `ACOS-JCS-1` declares**, not only
for the representations the two declared row kinds happen to use — across two genuinely
independent production implementations judged against a third hand-authored oracle.

Full dispositions for `S1G-C1`…`S1G-C8`: **`S1G-owner-resolution.md`**.

---

## 1. Baseline

| | |
|---|---|
| Required baseline | `395a13b` |
| Actual start | `395a13b`, worktree clean, verified before any edit |
| Baseline regression | 76 files / 1052 tests / 1052 passed / 0 failed / 0 skipped, `npm run verify` green |
| Branch | `feature/s1g-audit-ingress` |
| Implementation commit | `6fc7339` |
| Documentation commit | `33ccfbf` |
| PARTIAL candidate | `f79c664` — 84 files / 1171 tests / 1171 passed / 0 failed / 0 skipped, reverified before the resolution pass began |
| Architecture erratum commit | `753efb2` — package issue **v1.3.2**, erratum JCS-01. `docs/architecture/v1.3.1/` **not modified** |
| Implementation correction commit | `46f958b` — the three production implementations, the oracle, the extended `VC-A3` matrix, the old-rule regression control, and `S1G-C4`'s arrival-chain proofs |
| Final commit | this one — a commit cannot carry its own sha; `git log feature/s1g-audit-ingress` is authoritative |
| Worktree clean at end | yes |

---

## 2. What was built

`26 §7` **step X — the audit write** — implemented where `30 §5.1` puts it: strictly after
the S1F local authorisation COMMIT, across two separate PostgreSQL instances under separate
roles, with no transaction spanning them.

* **Control:** `JOURNAL_ATTESTATION` as a second row kind of `effect_journal` (0008); the
  post-commit pusher over the `mirrored_at IS NULL` backlog; `30 §5.4`'s attestation at
  5 minutes with k = 3.
* **Audit:** a separate instance with its own migrations, its own roles, its own
  `ACOS-JCS-1` implementation, its own hash chain over arrival order, `30 §5.2`'s exact
  re-push contract, `I17c`'s insert quota, and `I17`/`I17e` evaluated from its own holdings.

**No external dispatch. No outbox. No exclusive claim. No adapter. No vendor read. No
mirror state machine. No override. No anchor.**

---

## 2a. What the owner-resolution pass added

**One normative correction, and the tests that close it.** `ACOS-JCS-1`'s field-level NULL
framing (`docs/architecture/v1.3.2/phase2-v1.3.2-errata.md`, erratum JCS-01), applied to:

* **the control canonicaliser** — `acos_jcs1_field` emits the reserved word `\xffffffff` for
  a NULL and enforces the `0xFFFFFFFE` payload bound; `acos_jcs1_null()` is deleted;
* **the audit canonicaliser** — the same rule, independently derived, with the reserved word
  assembled byte by byte; `audit_jcs1_null()` deleted; `audit_jcs1_bytes`'s
  `JCS1_BYTES_AMBIGUOUS_WITH_NULL_SENTINEL` refusal deleted, **because the ambiguity it
  guarded no longer exists**;
* **the TypeScript kernel canonicaliser** (`canonicalBytes.ts`) — a **third** production
  implementation of the same `30 §5.3`, corrected with the other two so `ACOS-JCS-1` does not
  hold two incompatible NULL representations inside one system;
* **the independent oracle** — rewritten from the v1.3.2 specification, still importing
  nothing from `src/`, with the framing primitive exported so the length-word boundary is
  testable without a multi-gigabyte fixture;
* **`tests/negative-controls/unsafe-old-null-sentinel.ts`** — the withdrawn rule, retained as
  TEST-ONLY code importing nothing at all, and shown to still collide.

**And ten tests for `S1G-C4`**, proving the arrival-order audit chain is supplemental and is
not the basis of control completeness — including the defective evaluator that would have
called an incomplete prefix complete.

**Nothing else was built.** No mirror-state machinery, no degraded dispatch, no adapter, no
outbox, no external effect execution, no reconciliation, no AI.

---

## 3. Invariant status

Stated against the mechanism actually implemented, never beyond it.

| Invariant | Status | Evidence and limit |
|---|---|---|
| **`I17` — transport completeness** | **CLOSED for the transport it names** | Gap-freedom over holdings, consistency with the latest attestation, `row_count` as `count(DISTINCT journal_seq)`. Detected from the audit plane alone with the control database closed. **It is TRANSPORT completeness. It does not establish that the attested maximum is the true control maximum, and the documentation says so everywhere.** |
| **`I17d`** | **CLOSED, audit leg** | Chain values computed by a SECURITY DEFINER function under `acos_audit_owner`; a caller-supplied `chain_seq`/`audit_prev_hash`/`audit_row_hash` raises `I17D_CALLER_SUPPLIED_AUDIT_CHAIN`; direct EXECUTE of the chain function is refused. The control leg was closed at S1F and is not re-claimed. |
| **`I41`** | **CLOSED for the independent-re-chain property** | Both chains verify over the transmitted `ACOS-JCS-1` byte string; the audit side reconstructs from structured fields and refuses the row unless the reconstruction equals the wire (S1G-C7). Neither side re-serialises unchecked. |
| **`VC-A3`** | **CLOSED** — for the **full generic representation** `ACOS-JCS-1` declares | Two independent implementations, both judged against a hand-authored oracle importing nothing from `src/`. The generic `bytes` leg is closed by **v1.3.2 erratum JCS-01**: SQL NULL, empty text, empty bytes, `bytea` `00`, `bytea` `0000`, `bytea` `FF`, arbitrary binary with an embedded zero, JSON literal `null`, JSON `{}`/`[]`/`""`/`0`, and an absent optional member are all pairwise distinct where the specification distinguishes them, in all three implementations. The length-word boundary is asserted at `0`, an ordinary length, `0xFFFFFFFE` and a refused `0xFFFFFFFF`. `S1G-owner-resolution.md §1`. |
| **`VC-A1`** | **CLOSED for the honest-transport-loss cases** | Mid-range omission, tail truncation against an honest attester, suppressed attestation, stopped writer. `36 §2`'s four cases, on a controlled clock. |
| **`VC-A1d`** | **CLOSED — and it PASSES BY STAYING SILENT** | The mandatory negative control. A run in which the detector fires is a failure. |
| **`I17e`** | **CLOSED for what its own text claims** | Continuity of the attestation channel plus internal consistency and completeness of the latest attested prefix. Its registry row says it "does NOT assert that `max_journal_seq` equals the true control-journal maximum, and it cannot"; `VC-A1d` proves that limit rather than papering over it. |
| **`I17c`** | **PARTIAL** | DB leg built (`37` S1's "insert-only grant under quota"): per-principal, per-window, charged in the trigger, `inserted_rows > max_rows` structurally unrepresentable, saturation an INCIDENT and not a mode change. The SCHED leg is S6's. S1G-C5. |
| **`I17b`** | **OPEN** | No external anchor. The head, `chain_seq` and `row_count` are computable; that is not an anchor and is not claimed as one. `30 §5.8`'s medium selection and `37` S3 own it. |
| **`I17f`** | **OPEN** | No `DISPATCHED_UNMIRRORED` tag, no published stall interval, no state agreement check. |
| **`I8`** | **OPEN, and proves nothing at S1** | `37` S1, TA-02, verbatim. No vendor credential and no outbound call exists anywhere under `src/audit/`, asserted. |
| **`VC-C3`** | **PARTIAL, unchanged from S1F** | "PARTIAL through local authorisation; external execute/dispatch remains open." **S1G does not extend the entity lease across the asynchronous audit push** — the pusher takes no lease, and the lease-continuity claim is not widened. |

---

## 4. The two stores

| Property | Control | Audit |
|---|---|---|
| DB identity | `acos_control`, its own cluster | `acos_audit`, a **different cluster** — different `pg_control_system().system_identifier`, different published port |
| Connection / role | `ACOS_CONTROL_PG_URL` | three roles: owner (migrations only), `acos_audit_replication` (what the control plane holds — INSERT + EXECUTE on the entry point, nothing else), `acos_audit_evaluator` (SELECT holdings, INSERT findings, **no INSERT on holdings**) |
| Migrations | `src/db/migrations/`, `schema_migration` | `src/audit/db/migrations/`, `audit_schema_migration` — disjoint directories, separate runner |
| Canonicaliser | `acos_jcs1_*`, `effect_journal_canonical_bytes` | `audit_jcs1_*`, `audit_journal_canonical_bytes` — **the control functions do not exist on that server** |
| Canonicaliser, after v1.3.2 | NULL is `\xffffffff`, written as a literal; the length word by `int4send`; the bound by an explicit `length()::BIGINT` check | NULL is `0xFFFFFFFF` **assembled byte by byte** with `set_byte`, as the length word already was. **Still separately authored from the specification**, and still not reachable from the other server |
| Hash trigger | `effect_journal_chain` | `audit_journal_chain`, SECURITY DEFINER, EXECUTE revoked from the writer |
| Authority to rewrite rows | S1F: none beyond `mirrored_at` | **none, for anyone** — UPDATE/DELETE refused by grant to the writer and by trigger even to the owner |

**Two claims, recorded separately — S1G-C8.**

* **`MECHANISM INDEPENDENCE — PROVEN IN S1`.** Two separate PostgreSQL clusters, different
  system identifiers, different ports, different databases, separate migration directories
  with separate ledger tables, separate roles, and no transaction spanning both. Neither
  canonicaliser exists on the other server. The audit evaluator runs with the control
  database unreachable. `plane-independence.test.ts`.
* **`PRODUCTION PROVIDER/ACCOUNT INDEPENDENCE — OPEN`.** The harness cannot create a separate
  cloud account, a separate payment method or separate operator credentials, and **no test
  pretends otherwise**. `58 §9` records that provisioning as permitted-but-not-performed at
  this phase, and it makes it a **permitted narrow exception, not a pass condition** —
  `62 §11`'s ten pass-revocation conditions contain no provider/account condition, so S1G is
  not held PARTIAL on this account.

---

## 5. The adversarial-attester residual — preserved and proven

A compromised control plane that stops pushing at sequence N **and freezes its attested
prefix to match** produces a mirror in which `I17` passes, `I17e` passes and
`ATTESTATION_STALL` does not fire. `vc-a1d-adversarial-attester.test.ts` builds exactly that
state — six real control rows, four delivered, an attestation truthful about the delivered
prefix — and asserts the detector produces **nothing**.

**This is the correct result.** Registry `§3` item 9: rows with no vendor counterpart —
authorisation decisions, denials, reservations, releases, approvals, state facts,
escalations, incidents — *"have no detector at all, under any mechanism in this
architecture."* Rows with a vendor counterpart reach `I8` at S3.

The test also states what the attack costs the attacker: **stopping** trips
`ATTESTATION_STALL` at `k × cadence`, and **advancing the attested head without delivering
the rows underneath it** fires both `AUDIT_COMPLETENESS_GAP` and `ATTESTATION_INCONSISTENT` —
that is `30 §5.5` case 2a, and it IS detected.

---

## 6. Verification

| | |
|---|---|
| `npm run verify` | **green**, exit 0 — typecheck clean, lint clean at `--max-warnings 0` |
| Test files | **86** (candidate 84, S1F baseline 76) |
| Tests | **1204** (candidate 1171, S1F baseline 1052) |
| Passed | **1204** |
| Failed | **0** |
| Skipped | **0** |
| `.only` / `.skip` / `.todo` / hidden filtering | **none** — grepped; `vitest.config.ts` includes `tests/**` and `spikes/**` and filters nothing |
| Focused S1G | **10 files, 147 tests** (candidate: 8 files, 115 tests) |
| Tests using BOTH PostgreSQL instances | **147 — all of them** |
| Vulnerable / negative controls | **9** — the seven the candidate carried (trusted supplied hash; divergent re-serialising receiver; blanket-`ON CONFLICT` duplicate handling; cross-database "atomicity"; `mirrored_at` as completeness; quota-as-throughput; and `VC-A1d`, which discriminates by staying silent) plus **two added by the resolution pass**: v1.2's withdrawn one-byte `0x00` NULL sentinel, and an arrival-order completeness evaluator |
| Accepted tests deleted | **none** |
| Accepted tests weakened | **none** — one file's two tests renamed and widened into six, both original assertion pairs kept verbatim (S1G-C2, S1G-C3) |
| Architecture package modified | **`v1.3.1` NO** — `git diff 395a13b...HEAD -- docs/architecture/v1.3.1/` is empty. **`v1.3.2` issued as a NEW package** carrying erratum JCS-01 |
| Architecture mechanical verification | **25 conditions, 25 PASS, 0 FAIL** (22 carried from v1.3.1 + F1, F2, F3). Seeded negative controls: `--seed-old-null-bytes` **24 PASS / 1 FAIL**; `--seed-old-null-sentinel` **22 PASS / 3 FAIL**; both exit non-zero |
| `recompute-v1.3.py` | reproduces `recompute-v1.3-output.txt` line-for-line. **No authority quantity moved** |

---

## 7. Remaining OPEN / PARTIAL

`I8` (vendor-side truth, and the 2b/4 residual it owns) · `I17b` external anchoring ·
`I17c` SCHED leg · `I17f` and degraded-dispatch · the mirror state machine, the
`MirrorInputStallSignal` and the `DegradedModeOverride` · the dispatch precedence list ·
external dispatch and adapters · the outbox and `I36` · external exactly-once · vendor
idempotency and query · reconciliation and settlement · `I18d` · `VC-C3`'s full execute span ·
`VC-C4` · `R′` and approval resume · `I51` · `I60` · standing-revocation execution · the
reservation reaper and `I32` · `O4` · `I19` · symcc · AI CEO and workers · additional action
constructors.

**`S1G-C1` is CLOSED and is no longer on this list.** Three obligations it leaves behind
are, and each is recorded in `S1G-owner-resolution.md §12`:

* **the chain-versioning and re-anchor procedure** for a canonical-format change on an
  already-deployed chain. Not owed at v1.3.2 — nothing is deployed and no anchor has been
  published — and **owed before any such change is ever applied to a live journal**;
* **a fresh class-20 owner signature** over the corrected `ACOS-JCS-1` (`50 §2` row 20);
* **the JSON leg in production.** Neither declared row kind carries a JSON column, so
  RFC 8785 is settled by the oracle alone and there is no SQL-side JCS implementation in
  either database. A future row kind carrying JSON needs one in **both**, cross-implemented
  by `VC-A3`.

**Production provider / account independence remains OPEN** (`S1G-C8`), and `58 §9` does not
make it a blocking S1 condition.

---

## 8. Recommended next slice

**The three-state mirror machine and the corroboration signal — `30 §5.6`, `§5.7.1`, and
`36 §2`'s `VC-A2` / `VC-A2d`.**

It is the architecture's own next step: `30 §5.1`'s ordering block has one arrow left
("dispatch, per (4)"), and its item 4 cannot be evaluated until the mirror state is a thing
the system computes. `VC-A2`'s Path B fixture — a unilateral degradation declaration must
make the system **stricter** — is the property that makes every later dispatch decision safe,
and it needs exactly what S1G just built: an audit plane whose observations the control plane
cannot forge.

`§5.7.1` records the signing key and read endpoint as separately provisioned, which is the
provisioning work that slice would begin with.

**Not implemented here. Owner review of S1G first.**
