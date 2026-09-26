# Phase 2 — v1.3.7 verification gate

**The mechanical gate for package issue v1.3.7. Every condition below CAN return FAIL.**

Run from `analysis/`, on a system whose default encoding is not UTF-8 set `PYTHONUTF8=1`:

```
PYTHONUTF8=1 python consistency-v1.3.py                 # 101 PASS / 0 FAIL, exit 0
```

**101 conditions**: C1–C29 (v1.3), E1–E7 (v1.3.1), F1–F3 (v1.3.2), G1–G10 (v1.3.3), H1–H13
(v1.3.4), J1–J16 (v1.3.5), K1–K25 (v1.3.6) and **L1–L12 (v1.3.7)**.

---

## 1. The twelve v1.3.7 conditions, and the seeds that fail each

**A condition that has never failed is indistinguishable from one that cannot.** Every seed
below applies its mutation to the IN-MEMORY corpus only; nothing on disk is touched, and a
seeded run prints which edits it applied before it prints its result.

| Condition | What it asserts | Seeds that must fail it |
|---|---|---|
| **L1** | `MONEY_MOVING` is defined over the CREDENTIAL's provider capability envelope and NOT over the action ACOS intends to call; the nine clauses appear in order; ADR-024 records the same ruling and says S1N's reading was wrong IN KIND | `--seed-risk-from-action` |
| **L2** | A MIXED envelope takes the HIGHEST reachable class; the send-plus-refund case is decided explicitly; the lowest, the average and the intended readings are each denied by name | `--seed-risk-lowest-privilege` |
| **L3** | A MISSING classification FAILS CLOSED; the set is exactly three values and no fourth; no `UNKNOWN` survives anywhere in the section | `--seed-missing-risk-permissive`, `--seed-unknown-risk-value` |
| **L4** | Class 5's content is CLOSED at exactly seven fields with no open tail, printed in order, with fields 5–7 consistency-checked against field 4 and each other | `--seed-unknown-risk-value` |
| **L5** | The classification is SIGNED authority owned by class 5; the five unsigned sources are denied by name; `50 §2f` carries all three fields field-first; ADR-024 states the placement rationale | `--seed-risk-unsigned-runtime`, `--seed-risk-owned-by-class3` |
| **L6** | Class 5 is the field's SINGLE owner and class 3 is NOT widened: class 3 stays at ten-plus-four with no fifteenth entry, and `§2f` states the new rows add no doubly-owned field | `--seed-risk-owned-by-class3` |
| **L7** | A PROVIDER or ACCOUNT response cannot self-declare the risk class; the provider response, the account response and the adapter's self-description are each named among the forbidden sources | `--seed-provider-declares-risk` |
| **L8** | The FIRST `MONEY_MOVING` credential triggers option B as a REFUSAL, not a warning; both `50 §2g` and ADR-024 print the conjunction and the whichever-first rule | `--seed-money-trigger-warns` |
| **L9** | The THIRD-ADAPTER half is UNCHANGED and remains a refusal, declared derivation-free rather than restated in new terms | `--seed-third-adapter-relaxed` |
| **L10** | Option B is still REQUIRED and still UNBUILT, in `50 §2g`, ADR-024 and `37 §2`, with refusal at configuration named as the only available behaviour | `--seed-option-b-implemented` |
| **L11** | Class 5 enters the pre-live set as a dual-signed MANIFEST MEMBER and NOTHING ELSE moves: `50 §6` adds exactly one entry and `37 §2` carries the gate item plus `SEQ-04` | `--seed-class5-not-manifest-member` |
| **L12** | `48 §3.6`'s exemption gains a signed operand WITHOUT weakening `I8` or `36 §13`: the attempted-write test is declared NOT discharged by any signed declaration | `--seed-readonly-declaration-proves` |

### The twelve seeds

```
PYTHONUTF8=1 python consistency-v1.3.py --seed-risk-from-action           # L1 FAILS
PYTHONUTF8=1 python consistency-v1.3.py --seed-risk-lowest-privilege      # L2 FAILS
PYTHONUTF8=1 python consistency-v1.3.py --seed-missing-risk-permissive    # L3 FAILS
PYTHONUTF8=1 python consistency-v1.3.py --seed-unknown-risk-value         # L3, L4 FAIL
PYTHONUTF8=1 python consistency-v1.3.py --seed-risk-unsigned-runtime      # L5 FAILS
PYTHONUTF8=1 python consistency-v1.3.py --seed-risk-owned-by-class3       # L5, L6 FAIL
PYTHONUTF8=1 python consistency-v1.3.py --seed-provider-declares-risk     # L7 FAILS
PYTHONUTF8=1 python consistency-v1.3.py --seed-money-trigger-warns        # L8 FAILS
PYTHONUTF8=1 python consistency-v1.3.py --seed-third-adapter-relaxed      # L9 FAILS
PYTHONUTF8=1 python consistency-v1.3.py --seed-option-b-implemented       # L10 FAILS
PYTHONUTF8=1 python consistency-v1.3.py --seed-class5-not-manifest-member # L11 FAILS
PYTHONUTF8=1 python consistency-v1.3.py --seed-readonly-declaration-proves # L12 FAILS
```

**Each seed models a SPECIFIC unsafe architecture rather than a typo.** `--seed-risk-from-action`
restores S1N's own derivation; `--seed-risk-owned-by-class3` moves the field into the action
catalogue; `--seed-readonly-declaration-proves` lets a signature stand in for a vendor test.
Each is a design somebody could argue for, which is what makes failing it evidence.

---

## 2. The retained seeds

**All 58 v1.3–v1.3.6 seeds are retained and all 58 still discriminate**, verified by running
each against the v1.3.7 corpus and requiring a non-zero FAIL count. The full list is in
`phase2-v1.3.6-verification.md §1` and in the v1.3.6 README's running instructions; nothing
in this pass removes, renames or weakens one.

**Seventy seeds in total after v1.3.7.**

---

## 3. The one amended condition

**K14** previously asserted that all **four** live `50 §6` inventory rows demand both
signatures and manifest membership, and read the heading *"The control-artifact inventory
after v1.3.6"*. v1.3.7 adds a fifth live row and renames the heading, so K14 now asserts
**five** and reads the new heading.

**The count is still asserted rather than left open.** A membership-only check would admit a
row that quietly lost its second signature; the equality is what makes the condition able to
fail, and `--seed-second-signature-optional` still fails it.

**No other v1.3.6 condition is amended, and none is removed.**

---

## 4. What this gate does NOT verify

* **It does not verify any implementation.** `consistency-v1.3.py` reads the architecture
  corpus. Whether `src/` implements `50 §2g` is `npm run verify`'s question, and the
  implementation's own conditions live in
  `tests/controlArtifacts/credential-risk.test.ts` and
  `tests/negative-controls/credential-risk-controls.test.ts`.
* **It does not verify any provider's behaviour.** `§27` of the S1O mandate forbids a
  provider request and none is made. The provider capability record is dated documentation
  evidence, asserted by `tests/provider-selection/provider-selection.test.ts`, and the
  empirical attempted-write test required by `36 §13` remains OPEN.
* **It does not discharge a signature.** Class 5's owner signature is newly owed and is not
  discharged. **No production signing code exists at v1.3.7.**
