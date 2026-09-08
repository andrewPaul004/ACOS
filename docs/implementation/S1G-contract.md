# S1G — Contract

**Slice:** audit ingress, independent re-chaining and transport completeness.
**Baseline:** `395a13b` (S1F ACCEPTED).
**Branch:** `feature/s1g-audit-ingress`.
**Architecture:** `docs/architecture/v1.3.1/`, unmodified **by the slice itself**.

> **AMENDED BY THE OWNER-RESOLUTION PASS.** The slice was built against `v1.3.1` and did not
> touch it. The resolution pass then issued **package issue `v1.3.2`** as a new immutable
> directory, carrying one normative correction — erratum **JCS-01**, `ACOS-JCS-1` field-level
> NULL framing — because `S1G-C1` dispositioned to DEFECT. **`docs/architecture/v1.3.1/` is
> still unmodified**; `docs/architecture/v1.3.2/` is now the authoritative input. See
> `S1G-owner-resolution.md §1` and `docs/architecture/v1.3.2/phase2-v1.3.2-errata.md`.

---

## 1. Where the slice begins and ends

S1F ended at **`LOCAL AUTHORISATION COMMITTED`** — `26 §7` steps R through W, one
PostgreSQL transaction, a gap-free `journal_seq` and a local chain over `ACOS-JCS-1`
bytes.

S1G implements **`26 §7` step X — the audit write** — and stops.

`30 §5.1` item 3 prints the ordering, and the slice boundary is the second arrow:

```
BEGIN … COMMIT                       -- durable, locally chained, gap-free      S1F
  ↓
push to audit store                  -- async, retried, quota-bounded, idempotent  S1G
  ↓
dispatch, per (4)                    -- NOT BUILT
```

**There is no external dispatch, no outbox, no exclusive claim, no adapter and no vendor
read in this slice.**

---

## 2. Architecture → implementation → owner → trust boundary → validation

| Architecture item | Implementation | Database owner | Trust boundary | Validation |
|---|---|---|---|---|
| `26 §7` step X — the audit write | `src/replication/journalPusher.ts` + `src/audit/ingress.ts` | control (read) → audit (write) | two instances, two roles, no shared transaction | `post-commit-and-crash-matrix.test.ts` |
| `30 §5.1` item 1 — `mirrored_at`, null until acknowledged | `JournalPusher.recordMirroredAt` | control | advisory only; never a correctness operand | `post-commit-and-crash-matrix.test.ts` cases 4, 6, 7; `plane-independence.test.ts` |
| `30 §5.1` item 2 — the audit store is a replicating verifier | `audit_journal_chain` trigger, A0001 | audit (`acos_audit_owner`) | trigger runs SECURITY DEFINER; the writer cannot execute it | `audit-role-security.test.ts` |
| `30 §5.1` — "cross-database atomicity is not attempted" | no transaction spans the two pools | — | structural | `post-commit-and-crash-matrix.test.ts`, vulnerable control |
| `30 §5.2` — `UNIQUE(company_id, journal_seq)` | `audit_journal` primary key | audit | — | `ingestion-and-rechaining.test.ts` |
| `30 §5.2` — same hash → `AUDIT_PUSH_DUPLICATE` INFO | `audit_ingest_journal_row` | audit | incident written by the definer, not the caller | `duplicate-and-collision.test.ts` cases 2–4, 7 |
| `30 §5.2` — different hash → `AUDIT_SEQUENCE_COLLISION` CRITICAL | `audit_ingest_journal_row` | audit | the held row is never overwritten | `duplicate-and-collision.test.ts` cases 5, 6, 8 |
| `30 §5.2` — `row_count` is `count(DISTINCT journal_seq)` | `emit_journal_attestation`; duplicates charge nothing | both | anchored quantity, retry-proof | `duplicate-and-collision.test.ts`; `vc-a1-transport-completeness.test.ts` |
| `30 §5.3` — `ACOS-JCS-1`, control side | `acos_jcs1_*`, `effect_journal_canonical_bytes` (0007 + 0008) | control | — | `vc-a3-cross-implementation.test.ts` |
| `30 §5.3` — `ACOS-JCS-1`, audit side, INDEPENDENT | `audit_jcs1_*`, `audit_journal_canonical_bytes` (A0001) | audit | control functions absent from the server | `vc-a3-cross-implementation.test.ts` |
| `30 §5.3` — "the transmitted bytes are what is hashed" | `transmitted_bytes` retained; audit construction must EQUAL it | audit | divergence refused at ingest, not at the next VC-A3 run | `vc-a3-cross-implementation.test.ts`; `ingestion-and-rechaining.test.ts` |
| `30 §5.4` — `JournalAttestation` as a journal row | `JOURNAL_ATTESTATION` row kind, 0008; `emit_journal_attestation` | control | same counter, same chain, same transport | `vc-a1-transport-completeness.test.ts` |
| `30 §5.4` — cadence 5 min, k = 3, bound 15 min | `src/replication/attestation.ts` constants | control | values transcribed from `30 §5.4`, not from a remediation document | `vc-a1-transport-completeness.test.ts` |
| `30 §5.5` case 1 — mid-range omission | `evaluateTransportCompleteness` gap scan | audit | audit holdings only | `vc-a1-transport-completeness.test.ts` case A |
| `30 §5.5` case 2a — honest attester, lossy transport | `I17e` prefix + `row_count` + head check | audit | audit holdings only | `vc-a1-transport-completeness.test.ts` case B |
| `30 §5.5` case 2b — the attester freezes its prefix | **NO DETECTOR.** Proven silent | — | residual, owned by `I8` | `vc-a1d-adversarial-attester.test.ts` |
| `30 §5.5` case 3 — the writer stops | `ATTESTATION_STALL` at `k × cadence` | audit | absence observed by the other party | `vc-a1-transport-completeness.test.ts` case D |
| `30 §5.9` — a writer-computed chain proves nothing | `I17D_CALLER_SUPPLIED_AUDIT_CHAIN` | audit | attempted as the replication principal | `audit-role-security.test.ts` |
| `24 §3` K11 — declared inputs contain no control read | `evaluateTransportCompleteness(audit, …)` | audit | source rule + runtime proof with control down | `plane-independence.test.ts` |
| `I17c` — per-principal insert quota | `audit_insert_quota`, charged in the trigger | audit | the bounded principal cannot read or raise it | `audit-role-security.test.ts` |
| `I17d` — hash and sequence computed by DB functions | `audit_journal_chain`, SECURITY DEFINER, EXECUTE revoked | audit | direct invocation refused | `audit-role-security.test.ts` |
| `I41` — both chains verify over the transmitted bytes | control trigger + audit trigger | both | neither re-serialises unchecked | `vc-a3-cross-implementation.test.ts` |
| `30 §5` — "INSERT and nothing else" | grants in A0001 | audit | UPDATE/DELETE/TRUNCATE/DDL attempted and refused | `audit-role-security.test.ts` |
| `24 §3` K11 — findings not closable by the audited party | `audit_incident`, append-only, no grant to replication | audit | SELECT/INSERT/UPDATE/DELETE all refused | `audit-role-security.test.ts` |

---

## 3. Owner clarifications, restated

1. The S1F accepted baseline is `395a13b`.
2. S1G starts **after** the local authorisation COMMIT.
3. **Cross-database atomicity is deliberately not attempted**, and the vulnerable control
   in `post-commit-and-crash-matrix.test.ts` demonstrates why it cannot be claimed.
4. The audit store **independently reconstructs `ACOS-JCS-1`** from structured fields,
   using its own implementation on its own server.
5. **Control-provided hashes are claims, not audit authority.** They are compared. There
   is no code path that writes one into a chain column.
6. **`mirrored_at` is advisory only.** It selects work. It decides nothing. The audit
   plane cannot see it — it is not a column of the audit store.
7. **Exact re-push is benign; a conflicting same-sequence push is security-critical.**
8. **Attestations are real journal rows** on the same counter, the same chain and the same
   transport.
9. **Transport completeness is not real-world completeness.** `I17` is stated as transport
   completeness everywhere in this slice.
10. **The adversarial-attester residual is intentionally preserved and proven** by
    `VC-A1d`, which fails if the detector fires.
11. **The audit plane must not read the control database**, and does not — asserted in
    source and at runtime.
12. **`I8` vendor-side truth remains OPEN**, and proves nothing at S1 (`37` S1, TA-02).
13. **No external dispatch exists.**
14. **No external exactly-once is claimed.**
15. **External anchoring (`I17b`) remains OPEN.** The audit head, `chain_seq` and
    `row_count` are computable; that is not an anchor.
16. **Degraded-mode execution and owner override remain deferred.** No audit-side signal
    artifact is produced either: `30 §5.7.1` records the signing key and endpoint as
    separately provisioned and not part of the S1 build.
17. **Architecture v1.3.1 is unchanged.** No normative conflict was found that required an
    owner disposition; the one ambiguity encountered is recorded as `S1G-C1` and the
    affected leg is reported PARTIAL rather than resolved by invention.

---

## 4. What S1G does NOT do

`src/kernel/authorisation/localSteps.ts` `DISPATCH_IS_NOT_IMPLEMENTED` enumerates it, and
`local-authorisation-boundary.test.ts` asserts each as an absence in `src/`:

* the mirror state machine (`30 §5.6`), `MirrorInputStallSignal` (`§5.7.1`),
  `DegradedModeOverride` (`§5.7.2`);
* the dispatch precedence list (`30 §5.1` item 4) — no classifier, not even a pure one;
* the outbox and `I36`'s exclusive claim (`37` S4);
* dispatch, adapters, vendor idempotency, reconciliation, settlement;
* external anchoring (`I17b`, `30 §5.8`);
* `I8`'s inverse sweep and the audit plane's own vendor credentials (`37` S3);
* `DISPATCHED_UNMIRRORED` tagging and `I17f`;
* approval resume, `R′`, `I51`, `I58`;
* owner briefing, the independent appendix, V6/V7;
* AI CEO and workers, symcc, Cedar owner signing, `I19`.
