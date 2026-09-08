# ACOS Operating Spine v1.3 — issue v1.3.4

**Phase 2.5 / 2.5a / 2.5b / 2.5c / 2.5d. Architecture issued 2026-09-03; normative errata applied 2026-09-03 (v1.3.1), 2026-09-07 (v1.3.2) and 2026-09-08 (v1.3.3, v1.3.4).**

**Status: READY FOR S1 IMPLEMENTATION** — `phase2-v1.3-verification.md`, regated by `phase2-v1.3.1-verification.md`, `phase2-v1.3.2-verification.md`, `phase2-v1.3.3-verification.md` and `phase2-v1.3.4-verification.md`.

The application of the fourteen BLOCKING findings from the third independent architecture red team, plus TB-09 and TOS-04, plus two normative errata passes. No fourth adversarial review was required (`redteam3/62 §5`) and none was run. No production code.

**Issue v1.3.1** applies seven normative consistency corrections — the rate-class Step R contradiction, the remediation-ledger arithmetic, TOS-02, TOS-03, the retired `cessation_lag` scalar, and two registry counts. No mechanism was introduced and no authority quantity moved.

**Issue v1.3.2** applies **one** normative correction, **JCS-01**: `ACOS-JCS-1`'s generic NULL rule — a single `0x00` sentinel byte — was **not injective** against a non-null payload whose content is exactly the byte `0x00`, because SQL `NULL` and a one-byte `bytea` value both framed to `00 00 00 01 00`. **A field-level NULL now uses the reserved 32-bit length word `0xFFFFFFFF` and carries no payload; a non-null field uses `uint32_be(payload_length) || payload` with `0 <= payload_length <= 0xFFFFFFFE`. Every non-null payload encoding is unchanged, byte for byte.** This is the one thing either errata pass changed about behaviour, and it changes only bytes: it moves the `row_hash` of NULL-bearing journal rows and it moves control-artifact class 20's `content_hash`. **No mechanism was introduced, no authority quantity moved, no Step ordering changed and no audit cadence changed.**

**Issue v1.3.3** applies **four** normative declarations of the same shape — a quantity or a rule the mechanism needs that the artifact declaring quantities did not declare. **APF-01**: `30 §5.1` item 4 row 2's *per-action approval floor* had no declared value and was stated in prose as the same `$25` figure as `refund.create`'s `per_action_max`, a DENY boundary of a different kind. **`degraded_per_action_approval_floor_monetary` = USD 20.00, compared strictly against `total_exposure`** (`51 §3.7`). **MLT-01 and FHT-01**: item 5's two thresholds had no values, no operands and — for the second — no timer semantics, so the FULL-HALT POSTURE was unimplementable. **`mirror_lag_critical_threshold` = PT15M and `audit_unreachable_full_halt_threshold` = PT30M, both inclusive at the threshold** (`51 §3.8`), with the posture and its override composition specified in `30 §5.1a`. **SWR-01**: `30 §5.7.1`'s `STORE_WRITE_REJECTED` had no derivation and its one candidate reading is forbidden as a mode change; `30 §5.7.1a` gives it a **closed ten-condition audit-owned derivation** over the semantic class `AUDIT_STORE_WRITE_UNAVAILABLE`, with quota saturation and every security or integrity failure excluded **normatively**. **No mechanism was introduced, no invariant changed, no authority quantity moved and MAL is unchanged.** Two control-artifact signatures are newly owed — class 3, whose `content_hash` moves, and the new class 27 — and neither is discharged.

**Issue v1.3.4** resolves **two architecture defects** and makes **five declarations**. **IRN-01**: `22 §3.1` printed `30 §5.1` row 1 as Halt in `NORMAL` too, which — composed with item 5's *"never rows 1 or 2"* and `51 §3.6`'s DATABASE CHECK — made an IRRECOVERABLE effect **permanently undispatchable in every state**, so ADR-026, `25 §7`'s outbox, `25 §5`'s `PRESUMED_EXECUTED` branch, `I20` and `37` S4's autonomous sends all specified mechanisms with no reachable subject. **Row 1 is now state-qualified: dispatch in `NORMAL`, halt in both degraded states, halt under the full-halt posture, unreachable by override in every state.** **CSB-01**: row 3's operand is keyed on `case_ref` and **no artifact related a `case_ref` to an effect** — `I56` closes clock *creation* and says nothing about clock *selection*, so the operand was answerable only by a guess a model could steer. **`30 §9.2` declares `effect.case_ref` — kernel-owned, immutable, inherited from the authoritative task, never model-supplied — with claim-time derivation from current clock state, deterministic evidentiary selection among several live clocks, and persisted evidence.** Three invariants are added (`I64`, `I65`, `I66`). **OBX-01/02/03** declare the outbox's two-state machine with **no reclaim**, its scope as **every external-write effect**, and the claim transaction as `30 §5.7.2`'s dispatching transaction. **JCS-02** declares the per-row-kind field order `30 §5.3` had always required and never given. **SEQ-01** moves the outbox foundation to S1 and leaves the vendor half at S4. **No mechanism was introduced, no authority quantity moved, MAL is unchanged, and no control-artifact signature is discharged** — class 20's obligation is extended and classes 3, 20 and 27 all remain owed.

**The architecture is v1.3 and is unchanged**, so the numbered deliverables still declare `Operating Spine v1.3` in their version lines. `v1.3.1`, `v1.3.2`, `v1.3.3` and `v1.3.4` are package issues. **`docs/architecture/v1.3.1/`, `docs/architecture/v1.3.2/` and `docs/architecture/v1.3.3/` are not modified by v1.3.4** and remain on disk as the previous issues, byte for byte.

## Read in this order

1. **`phase2-v1.3-implementation-brief.md`** — the handoff. Which artifacts are normative, the S1 boundary and its non-goals, the seventeen empirical obligations, the ten pass-revocation conditions.
2. `phase2-v1.3-verification.md` — the gate. V1–V16, each able to fail.
2a. `phase2-v1.3.1-errata.md` and `phase2-v1.3.1-verification.md` — the first errata record and its gate. **Read `phase2-v1.3.1-errata.md §1` before implementing step R.**
2b. `phase2-v1.3.2-errata.md` and `phase2-v1.3.2-verification.md` — the second errata record and its gate. **Read `phase2-v1.3.2-errata.md §1` before implementing anything that canonicalises or hashes a journal row.**
2c. `phase2-v1.3.3-errata.md` and `phase2-v1.3.3-verification.md` — the third errata record and its gate. **Read `phase2-v1.3.3-errata.md` before implementing the dispatch precedence, the degraded-mode thresholds or the corroboration signal's `reason`.**
2d. `phase2-v1.3.4-errata.md` and `phase2-v1.3.4-verification.md` — the fourth errata record and its gate. **Read `phase2-v1.3.4-errata.md` before implementing the effect→case binding, any claim-time clock derivation, the dispatch outbox, or anything that canonicalises the claim journal row.**
3. `phase2-v1.3-changelog.md` — v1.2 → v1.3, including `§8`'s record of this project's own failed audit (TOS-04).
4. `phase2-v1.3-remediation-ledger.md` — fourteen entries, one disposition each, no merges.
5. `phase2-v1.3-invariant-registry.md` — the single authoritative definition of every invariant identifier. **Unchanged by v1.3.2. v1.3.4 adds `I64`, `I65` and `I66` and restates `I36`'s slice and test columns; 73 identifiers, 25 database-enforced.**
6. `phase2-v1.3-lower-severity-register.md` — the seventeen dispositions for MATERIAL, MINOR and WORDING findings.

## Layout

| Path | Contents |
|---|---|
| `deliverables/` | The architecture, `22`–`38` and `48`–`51`. **`38` is superseded and non-normative.** v1.3.2 edited three sections: `30 §5.3`, `36 §2`'s `VC-A3` case, `50 §2` class 20. **v1.3.3 adds `30 §5.1a` and `30 §5.7.1a`, adds `51 §3.7` and `§3.8`, adds `50 §2` class 27, adds `36`'s `VC-A2g` and `VC-A2h`, and edits `30 §5.1` items 4–5, `30 §5.6`'s reachability table, `50 §2` class 3, `22 §3.1`, `35 §12.1` and `36`'s `VC-A6`**. **v1.3.4 adds `30 §5.1b`, `30 §5.3a` and `30 §9.2`, adds `36`'s `VC-A6a`–`VC-A6d`, and edits `30 §5.1` item 4 row 1 with its narrative and rationale, `30 §5.3`'s column-order row, `30 §9.1`, `22 §3.1`, `24 §3` K7 and K10, `24 §4`'s ERD, `25 §7`, `26 §2.1`, `33 §6`, `34` ADR-026, `35 §4`, `36`'s `VC-A3` and `VC-A6`, `37 §2` S1 and S4, and `50 §2` class 20** |
| `diagrams/` | Mermaid sources |
| `analysis/` | Oracles and self-checks. `consistency-v1.3.py` carries C1–C29, the v1.3.1 conditions E1–E7, the v1.3.2 conditions F1–F3, the v1.3.3 conditions G1–G10 and the v1.3.4 conditions H1–H13 — **48 conditions** — and exits non-zero on failure; `recompute-v1.3.py` computes every displayed quantity from the formulae and **reproduces its recorded output line for line after v1.3.4**. Every prior issue's recorded runs and negative controls are retained; `consistency-v1.3.4-output.txt` and eight `consistency-v1.3.4-negative-control-*-output.txt` files are v1.3.4's |
| `redteam3/` | `59`–`62`, unmodified. `62` is the operative gate |
| `redteam2/` | `52`–`58`, unmodified. Superseded by `62` as a gate; retained as findings |
| `*.keep` | v1.2 root documents, retained as history |

**Running the gate.** From `analysis/`, on a system whose default encoding is not UTF-8, set `PYTHONUTF8=1`:

```
PYTHONUTF8=1 python consistency-v1.3.py                                  # 48 PASS / 0 FAIL, exit 0

# v1.3.4 (H1-H13)
PYTHONUTF8=1 python consistency-v1.3.py --seed-model-case-ref            # 47 PASS / 1 FAIL -> H1
PYTHONUTF8=1 python consistency-v1.3.py --seed-claim-case-ref            # 46 PASS / 2 FAIL -> H1, H2
PYTHONUTF8=1 python consistency-v1.3.py --seed-global-clock-search       # 47 PASS / 1 FAIL -> H3
PYTHONUTF8=1 python consistency-v1.3.py --seed-irrecoverable-halt        # 47 PASS / 1 FAIL -> H5
PYTHONUTF8=1 python consistency-v1.3.py --seed-irrecoverable-loose       # 46 PASS / 2 FAIL -> H6, H7
PYTHONUTF8=1 python consistency-v1.3.py --seed-reclaim-timeout           # 47 PASS / 1 FAIL -> H10
PYTHONUTF8=1 python consistency-v1.3.py --seed-outbox-irrecoverable-only # 47 PASS / 1 FAIL -> H11
PYTHONUTF8=1 python consistency-v1.3.py --seed-swap-claim-fields         # 47 PASS / 1 FAIL -> H12

# v1.3.3 and v1.3.2, retained and all still failing
PYTHONUTF8=1 python consistency-v1.3.py --seed-floor-25                  # 45 PASS / 3 FAIL
PYTHONUTF8=1 python consistency-v1.3.py --seed-vendor-amount             # 46 PASS / 2 FAIL
PYTHONUTF8=1 python consistency-v1.3.py --seed-lag-10m                   # 47 PASS / 1 FAIL
PYTHONUTF8=1 python consistency-v1.3.py --seed-full-halt-15m             # 46 PASS / 2 FAIL
PYTHONUTF8=1 python consistency-v1.3.py --seed-quota-as-cause            # 45 PASS / 3 FAIL
PYTHONUTF8=1 python consistency-v1.3.py --seed-generic-insert-fail       # 46 PASS / 2 FAIL
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-bytes            # 47 PASS / 1 FAIL
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-sentinel         # 44 PASS / 4 FAIL
```

**Every one of G1–G10 and H1–H13 is failed by at least one seed**, and every earlier pass's controls still fail, so no pass disarmed a previous one. `phase2-v1.3.4-verification.md §1` maps each v1.3.4 seed to the conditions it breaks — and note the **pair** that carries IRN-01's narrowness: `--seed-irrecoverable-halt` fails **H5 alone** and `--seed-irrecoverable-loose` fails **H6 and H7 alone**, so a correction that moved more than `NORMAL`, or less, fails the gate in a different place.

The two seeded runs restore v1.2's withdrawn NULL sentinel **in memory only** and must fail. `--seed-old-null-bytes` is the sharper of the two: it leaves the corrected text in place and reverts only SQL `NULL`'s bytes in `30 §5.3`'s worked-example table, so F3 fails on the collision itself.

## The five things worth knowing before reading anything else

**TJ-01 is not prevented, and v1.3 does not claim it is.** A compromised control plane that stays in `NORMAL` and freezes its own attested prefix is undetectable by `I17` and `I17e`. Vendor-touching effects may later be caught by `I8`; suppressed authority and state rows with no vendor counterpart are caught by nothing. Registry `§3` item 9.

**No numerical authority quantity changed, in v1.3, v1.3.1 or v1.3.2.** `MAL_total(month)` at the signature basis is $756.00, as in v1.2, and no owner re-signature of the MAL basis is required. Both errata recomputations reproduce v1.3's output identically. The one correction that would have moved it — TB-08(a)'s overdelivery band — is deliberately scheduled.

**`ACOS-JCS-1` changed in v1.3.2, and a control-artifact signature is owed.** Class 20's `content_hash` moves with JCS-01, so a fresh class-20 owner signature is required before any deployment. Nothing is deployed, so nothing is blocked by this today. **A canonical-format change on an already-deployed chain would additionally require chain-versioning and re-anchor semantics this architecture does not yet declare** — recorded as owed in `phase2-v1.3.2-errata.md §1`, not discharged.

**Two more control-artifact signatures are owed after v1.3.3, and the class-20 one is still owed.** Class 3's `content_hash` moves because the approval-floor field finally has a value, and class 27 is new. **No production owner-signing mechanism and no runtime `I19` verification exist in the accepted implementation**, so nothing here claims any of the three is discharged.

**`I8` proves nothing at S1.** Every S1 action class runs against a mock adapter, so there is no vendor side to enumerate.
