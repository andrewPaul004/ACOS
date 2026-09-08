# ACOS Operating Spine v1.3 — issue v1.3.2

**Phase 2.5 / 2.5a / 2.5b. Architecture issued 2026-09-03; normative errata applied 2026-09-03 (v1.3.1) and 2026-09-07 (v1.3.2).**

**Status: READY FOR S1 IMPLEMENTATION** — `phase2-v1.3-verification.md`, regated by `phase2-v1.3.1-verification.md` and `phase2-v1.3.2-verification.md`.

The application of the fourteen BLOCKING findings from the third independent architecture red team, plus TB-09 and TOS-04, plus two normative errata passes. No fourth adversarial review was required (`redteam3/62 §5`) and none was run. No production code.

**Issue v1.3.1** applies seven normative consistency corrections — the rate-class Step R contradiction, the remediation-ledger arithmetic, TOS-02, TOS-03, the retired `cessation_lag` scalar, and two registry counts. No mechanism was introduced and no authority quantity moved.

**Issue v1.3.2** applies **one** normative correction, **JCS-01**: `ACOS-JCS-1`'s generic NULL rule — a single `0x00` sentinel byte — was **not injective** against a non-null payload whose content is exactly the byte `0x00`, because SQL `NULL` and a one-byte `bytea` value both framed to `00 00 00 01 00`. **A field-level NULL now uses the reserved 32-bit length word `0xFFFFFFFF` and carries no payload; a non-null field uses `uint32_be(payload_length) || payload` with `0 <= payload_length <= 0xFFFFFFFE`. Every non-null payload encoding is unchanged, byte for byte.** This is the one thing either errata pass changed about behaviour, and it changes only bytes: it moves the `row_hash` of NULL-bearing journal rows and it moves control-artifact class 20's `content_hash`. **No mechanism was introduced, no authority quantity moved, no Step ordering changed and no audit cadence changed.**

**The architecture is v1.3 and is unchanged**, so the numbered deliverables still declare `Operating Spine v1.3` in their version lines. `v1.3.1` and `v1.3.2` are package issues. **`docs/architecture/v1.3.1/` is not modified by v1.3.2** and remains on disk as the previous issue.

## Read in this order

1. **`phase2-v1.3-implementation-brief.md`** — the handoff. Which artifacts are normative, the S1 boundary and its non-goals, the seventeen empirical obligations, the ten pass-revocation conditions.
2. `phase2-v1.3-verification.md` — the gate. V1–V16, each able to fail.
2a. `phase2-v1.3.1-errata.md` and `phase2-v1.3.1-verification.md` — the first errata record and its gate. **Read `phase2-v1.3.1-errata.md §1` before implementing step R.**
2b. `phase2-v1.3.2-errata.md` and `phase2-v1.3.2-verification.md` — the second errata record and its gate. **Read `phase2-v1.3.2-errata.md §1` before implementing anything that canonicalises or hashes a journal row.**
3. `phase2-v1.3-changelog.md` — v1.2 → v1.3, including `§8`'s record of this project's own failed audit (TOS-04).
4. `phase2-v1.3-remediation-ledger.md` — fourteen entries, one disposition each, no merges.
5. `phase2-v1.3-invariant-registry.md` — the single authoritative definition of every invariant identifier. **Unchanged by v1.3.2.**
6. `phase2-v1.3-lower-severity-register.md` — the seventeen dispositions for MATERIAL, MINOR and WORDING findings.

## Layout

| Path | Contents |
|---|---|
| `deliverables/` | The architecture, `22`–`38` and `48`–`51`. **`38` is superseded and non-normative.** v1.3.2 edits three sections: `30 §5.3`, `36 §2`'s `VC-A3` case, `50 §2` class 20 |
| `diagrams/` | Mermaid sources |
| `analysis/` | Oracles and self-checks. `consistency-v1.3.py` carries C1–C29, the v1.3.1 conditions E1–E7 and the v1.3.2 conditions F1–F3, and exits non-zero on failure; `recompute-v1.3.py` computes every displayed quantity from the formulae. `consistency-v1.3.1-output.txt` is the retained v1.3.1 run; `consistency-v1.3.2-output.txt` and `consistency-v1.3.2-negative-control-output.txt` are v1.3.2's |
| `redteam3/` | `59`–`62`, unmodified. `62` is the operative gate |
| `redteam2/` | `52`–`58`, unmodified. Superseded by `62` as a gate; retained as findings |
| `*.keep` | v1.2 root documents, retained as history |

**Running the gate.** From `analysis/`, on a system whose default encoding is not UTF-8, set `PYTHONUTF8=1`:

```
PYTHONUTF8=1 python consistency-v1.3.py                          # 25 PASS / 0 FAIL, exit 0
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-bytes    # 24 PASS / 1 FAIL, exit 1
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-sentinel # 22 PASS / 3 FAIL, exit 1
```

The two seeded runs restore v1.2's withdrawn NULL sentinel **in memory only** and must fail. `--seed-old-null-bytes` is the sharper of the two: it leaves the corrected text in place and reverts only SQL `NULL`'s bytes in `30 §5.3`'s worked-example table, so F3 fails on the collision itself.

## The four things worth knowing before reading anything else

**TJ-01 is not prevented, and v1.3 does not claim it is.** A compromised control plane that stays in `NORMAL` and freezes its own attested prefix is undetectable by `I17` and `I17e`. Vendor-touching effects may later be caught by `I8`; suppressed authority and state rows with no vendor counterpart are caught by nothing. Registry `§3` item 9.

**No numerical authority quantity changed, in v1.3, v1.3.1 or v1.3.2.** `MAL_total(month)` at the signature basis is $756.00, as in v1.2, and no owner re-signature of the MAL basis is required. Both errata recomputations reproduce v1.3's output identically. The one correction that would have moved it — TB-08(a)'s overdelivery band — is deliberately scheduled.

**`ACOS-JCS-1` changed in v1.3.2, and a control-artifact signature is owed.** Class 20's `content_hash` moves with JCS-01, so a fresh class-20 owner signature is required before any deployment. Nothing is deployed, so nothing is blocked by this today. **A canonical-format change on an already-deployed chain would additionally require chain-versioning and re-anchor semantics this architecture does not yet declare** — recorded as owed in `phase2-v1.3.2-errata.md §1`, not discharged.

**`I8` proves nothing at S1.** Every S1 action class runs against a mock adapter, so there is no vendor side to enumerate.
