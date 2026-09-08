# S1G — Result

**VERDICT: PARTIAL.**

Every pass criterion in the S1G mandate is satisfied except one, and that one is
`§35`'s explicit instruction rather than a shortfall in the work: **`ACOS-JCS-1` does not
normatively distinguish a one-byte `0x00` `bytea` value from SQL `NULL`.** The mandate says
to stop that part and return `PARTIAL` rather than invent a representation, so nothing was
invented, the ambiguous input fails closed in all three implementations, and the **generic
`bytes` leg of `VC-A3` is reported PARTIAL**. See `S1G-owner-clarifications.md` **S1G-C1**.

For every representation the two declared journal row kinds actually use, `VC-A3` is
**CLOSED** across two genuinely independent implementations judged against a third
hand-authored oracle.

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

## 3. Invariant status

Stated against the mechanism actually implemented, never beyond it.

| Invariant | Status | Evidence and limit |
|---|---|---|
| **`I17` — transport completeness** | **CLOSED for the transport it names** | Gap-freedom over holdings, consistency with the latest attestation, `row_count` as `count(DISTINCT journal_seq)`. Detected from the audit plane alone with the control database closed. **It is TRANSPORT completeness. It does not establish that the attested maximum is the true control maximum, and the documentation says so everywhere.** |
| **`I17d`** | **CLOSED, audit leg** | Chain values computed by a SECURITY DEFINER function under `acos_audit_owner`; a caller-supplied `chain_seq`/`audit_prev_hash`/`audit_row_hash` raises `I17D_CALLER_SUPPLIED_AUDIT_CHAIN`; direct EXECUTE of the chain function is refused. The control leg was closed at S1F and is not re-claimed. |
| **`I41`** | **CLOSED for the independent-re-chain property** | Both chains verify over the transmitted `ACOS-JCS-1` byte string; the audit side reconstructs from structured fields and refuses the row unless the reconstruction equals the wire (S1G-C7). Neither side re-serialises unchecked. |
| **`VC-A3`** | **CLOSED for every representation the declared row kinds use; PARTIAL on the generic `bytes` leg** | Two independent implementations, both judged against a hand-authored oracle importing nothing from `src/`. S1G-C1. |
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
| Hash trigger | `effect_journal_chain` | `audit_journal_chain`, SECURITY DEFINER, EXECUTE revoked from the writer |
| Authority to rewrite rows | S1F: none beyond `mirrored_at` | **none, for anyone** — UPDATE/DELETE refused by grant to the writer and by trigger even to the owner |

**The separate-PROVIDER leg of `30 §5` is OPEN.** The harness creates two PostgreSQL
instances; it cannot create a separate cloud account or payment method. `58 §9` records that
provisioning as permitted-but-not-performed at this phase. S1G-C8.

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
| `npm run verify` | **green** — typecheck clean, lint clean at `--max-warnings 0` |
| Test files | **84** (baseline 76) |
| Tests | **1171** (baseline 1052) |
| Passed | **1171** |
| Failed | **0** |
| Skipped | **0** |
| `.only` / hidden filtering | none |
| Focused S1G | **8 files, 115 tests** |
| Tests using BOTH PostgreSQL instances | **115 — all of them** |
| Vulnerable / negative controls added | **7** (trusted supplied hash; divergent re-serialising receiver; blanket-`ON CONFLICT` duplicate handling; cross-database "atomicity"; `mirrored_at` as completeness; quota-as-throughput; and `VC-A1d`, which discriminates by staying silent) |
| Accepted tests deleted | **none** |
| Accepted tests weakened | **none** — one file's two tests renamed and widened into six, both original assertion pairs kept verbatim (S1G-C2, S1G-C3) |
| Architecture package modified | **NO** — `git diff 395a13b...HEAD -- docs/architecture/` is empty |

---

## 7. Remaining OPEN / PARTIAL

`I8` (vendor-side truth, and the 2b/4 residual it owns) · `I17b` external anchoring ·
`I17c` SCHED leg · `I17f` and degraded-dispatch · the mirror state machine, the
`MirrorInputStallSignal` and the `DegradedModeOverride` · the dispatch precedence list ·
external dispatch and adapters · the outbox and `I36` · external exactly-once · vendor
idempotency and query · reconciliation and settlement · `I18d` · `VC-C3`'s full execute span ·
`VC-C4` · `R′` and approval resume · `I51` · `I60` · standing-revocation execution · the
reservation reaper and `I32` · `O4` · `I19` · symcc · AI CEO and workers · additional action
constructors · **and the generic nullable-`bytes` canonical representation, S1G-C1.**

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
