# ACOS Operating Spine v1.3.3 — Verification

**Phase 2.5c. The gate for the v1.3.3 normative errata pass. Every condition can fail, and every condition is demonstrated failing.**

This document gates **only** the v1.3.3 pass. `phase2-v1.3-verification.md` (V1–V16), `phase2-v1.3.1-verification.md` (E1–E7) and `phase2-v1.3.2-verification.md` (F1–F3) remain in force unchanged and are re-run by the same script.

---

## 0. What is being gated

Four defects, one shape: a quantity or a rule that the mechanism needs, that the artifact declaring quantities did not declare. `phase2-v1.3.3-errata.md` records them as **APF-01** (the degraded per-action approval floor), **MLT-01** (the mirror-lag CRITICAL threshold), **FHT-01** (the prolonged audit-unreachability full-halt threshold) and **SWR-01** (`STORE_WRITE_REJECTED`'s derivation).

**The mechanical gate is `analysis/consistency-v1.3.py`, conditions G1–G10.** It exits non-zero on any failure and carries C1–C29, E1–E7, F1–F3 and G1–G10 together — **35 conditions**.

```
cd analysis
PYTHONUTF8=1 python consistency-v1.3.py                              # 35 PASS / 0 FAIL, exit 0
PYTHONUTF8=1 python consistency-v1.3.py --seed-floor-25              # 32 PASS / 3 FAIL, exit 1
PYTHONUTF8=1 python consistency-v1.3.py --seed-vendor-amount         # 33 PASS / 2 FAIL, exit 1
PYTHONUTF8=1 python consistency-v1.3.py --seed-lag-10m               # 34 PASS / 1 FAIL, exit 1
PYTHONUTF8=1 python consistency-v1.3.py --seed-full-halt-15m         # 33 PASS / 2 FAIL, exit 1
PYTHONUTF8=1 python consistency-v1.3.py --seed-quota-as-cause        # 32 PASS / 3 FAIL, exit 1
PYTHONUTF8=1 python consistency-v1.3.py --seed-generic-insert-fail   # 33 PASS / 2 FAIL, exit 1
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-bytes        # 34 PASS / 1 FAIL, exit 1  (v1.3.2, retained)
PYTHONUTF8=1 python consistency-v1.3.py --seed-old-null-sentinel     # 32 PASS / 3 FAIL, exit 1  (v1.3.2, retained)
```

Recorded runs: `analysis/consistency-v1.3.3-output.txt` and the six `analysis/consistency-v1.3.3-negative-control-*-output.txt` files. The two v1.3.2 controls are retained and still fail, so this pass did not silently disarm the previous one.

**Every mutation modifies the corpus IN MEMORY only. Nothing on disk is touched by a seeded run.**

---

## 1. The ten conditions

| # | Condition | Kind |
|---|---|---|
| **G1** | The `$20.00` floor is declared in the **authoritative quantity location** — `51 §3.7` — with its identifier, units, comparison operand, strict boundary semantics, `OWNER DECISION / v1.3.3` provenance and control-artifact effect | required statements, parsed from `51` |
| **G2** | **Every operational reference to the floor resolves to that declared operand**: `30 §5.1a` specifies it, and `30 §5.1` item 4 row 2, `22 §3.1`'s row 2 and `36`'s `VC-A6` each cite `51 §3.7` | cross-reference set |
| **G3** | **No operational passage equates the floor with the `$25.00` `per_action_max`**, and the distinction is stated **positively** in `30 §5.1a` and `51 §3.7` rather than merely not contradicted | denylist over lines + required positives |
| **G4** | The degraded comparison uses **`total_exposure`**; `vendor_amount`, dispatch amounts, model amounts, `rationale` amounts and grant prose are excluded **by name**, and `36`'s fixture forbids a caller-supplied boolean | required statements + denylist |
| **G5** | The mirror-lag threshold is **exactly 15 minutes at every site that states a value**, with its operand, its inclusive boundary printed at timestamp precision, and its inability to create state, fabricate a signal, grant an override or move a limit | required statements + numeric sweep |
| **G6** | The full-halt threshold is **exactly 30 minutes at every site that states a value**, with its single-valued operand, **declared timer start and reset semantics**, inclusive boundary, all-class effect, and the override composition resolved from item 5's two sentences | required statements + numeric sweep |
| **G7** | **`PT30M > PT15M`**, computed from `51 §3.8`'s two declared values rather than asserted, with the prose minutes and the ISO-8601 notation agreeing on each | parsed arithmetic |
| **G8** | **Audit insert-quota saturation remains incident-only**, is named in the exclusion list, and no operational passage makes it a cause of the corroboration signal | required statements + denylist |
| **G9** | `STORE_WRITE_REJECTED` is **audit-owned** and requires an audit-**observed**, authenticated, admissible, canonical, non-colliding, non-duplicate, **in-quota** attempt that then failed at the store write — **all ten conjuncts asserted individually** — with the semantic class named, the concrete mapping closed and unknown errors failing closed | nineteen required statements |
| **G10** | The exclusion list is **parsed** and all **seventeen** declared members are looked up in it — canonical mismatch, row-hash mismatch, chain mismatch, collision, duplicate, credentials, signature, privilege, policy, cancellation, pre-ingress timeout, retryable serialization, deadlock and unknown errors included — and the exclusion is stated as **normative** | parsed list membership |

**G3, G5 and G6 are the sharp ones.** G3 is a denylist over every line of the operational corpus, exempt only where a line explicitly records the conflation as v1.1's defect, so re-introducing the `$25` floor anywhere fails it. G5 and G6 do not merely check that the right value is *present*; they **sweep every operational line that states a numeric threshold for either quantity** and fail if any states a different one, so a single divergent site fails the gate.

---

## 2. The seeded negative controls, and what each proves

| Seed | Mutation | Must fail | Observed |
|---|---|---|---|
| `--seed-floor-25` | the floor declared as `$25.00` and equated with `per_action_max` | G1, G3 | **G1, G2, G3** |
| `--seed-vendor-amount` | the comparison operand switched to `vendor_amount` | G1, G4 | **G1, G4** |
| `--seed-lag-10m` | one site states a 10-minute mirror-lag threshold | G5 | **G5** |
| `--seed-full-halt-15m` | the full halt declared at 15 minutes, collapsing it onto the lag threshold | G6, G7 | **G6, G7** |
| `--seed-quota-as-cause` | quota saturation made a valid `STORE_WRITE_REJECTED` cause and removed from the exclusions | G8, G10 | **G8, G9, G10** |
| `--seed-generic-insert-fail` | the derivation replaced by "any `INSERT` failure → store rejected", opened to unknown errors | G9, G10 | **G9, G10** |

**Every one of G1–G10 is failed by at least one seed.** G1 ← floor-25, vendor-amount · G2 ← floor-25 · G3 ← floor-25 · G4 ← vendor-amount · G5 ← lag-10m · G6 ← full-halt-15m · G7 ← full-halt-15m · G8 ← quota-as-cause · G9 ← quota-as-cause, generic-insert-fail · G10 ← quota-as-cause, generic-insert-fail. **No condition in this pass is unfalsifiable.**

---

## 3. Conditions that are not in the script, and how each was discharged

| # | Condition | How discharged |
|---|---|---|
| **W1** | **`docs/architecture/v1.3.2/` is byte-identical to its issued state.** v1.3.3 is a new directory, not an edit | `git diff --stat` over `docs/architecture/v1.3.2/` reports **zero** changed files, and `git ls-files -s docs/architecture/v1.3.2/` hashes are unchanged. `docs/architecture/v1.3.1/` likewise |
| **W2** | **No authority quantity moved.** | `analysis/recompute-v1.3.py` reproduces the recorded `analysis/recompute-v1.3-output.txt` **line for line identically** after the pass. `MAL_monetary(month)` = $300.00, `MAL_total(month)` at the signature basis = $756.00, `per_action_max` = $25.00, every `51 §3.6` override quantity, `attestation_cadence`, `k`, the anchor interval and the signal `max_age` all unchanged |
| **W3** | **No mechanism was introduced.** | The three quantities are operands of rules `30 §5.1` already declared; `STORE_WRITE_REJECTED` was already an enum member of a contract `30 §5.7.1` already declared. No state, no entity, no table, no Step and no cadence is added by the architecture pass |
| **W4** | **No invariant was weakened, added or renumbered.** | The registry's `§0` records the pass explicitly as adding, removing, restating and weakening **nothing**, and E-conditions E5–E7 (counts and enumerations) still pass unchanged |
| **W5** | **The class-20 signature residual is carried, not discharged.** | `phase2-v1.3.3-errata.md` `§0` states it, `50 §2` class 20's row is unmodified by this pass, and `50`'s v1.3.3 change record repeats that it remains owed |
| **W6** | **Two signatures are newly owed and neither is claimed as discharged.** | Class 3 (`content_hash` moves) and class 27 (new). Recorded in `50`'s change record, in `50 §2` class 3's halt-scope cell, in `51 §3.7` and `§3.8`, and in `30 §5.1a`'s closing paragraph, each of which also states that **no production owner-signing mechanism and no runtime `I19` verification exist** |
| **W7** | **No new control-artifact class duplicates an existing one.** | The approval floor goes to **class 3**, which already enumerated *"approval floor"*, rather than to a new class. Class 27 is new because no existing class has *all effects* as its halt scope for a degraded-mode threshold, and class 25's halt scope — *the grant of a new override* — is the wrong scope; the reason is stated in class 27's own row |
| **W8** | **No scope escape.** | The pass introduces no dispatch, outbox, external claim, adapter, vendor execution, reconciliation, settlement, approval resume, standing-revocation execution, `I36` or AI content. `phase2-v1.3.3-errata.md` `§4` enumerates what was deliberately not done |

---

## 4. The verdict

**PASS.** 35 of 35 mechanical conditions pass, all nine seeded mutations fail with a non-zero exit, W1–W8 are discharged as recorded, and no authority quantity moved.
