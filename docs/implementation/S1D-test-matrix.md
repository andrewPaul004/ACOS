# S1D — test matrix

**Baseline:** 46 files / 590 tests (`ee9c518`, S1C ACCEPTED)
**After S1D:** 58 files / 756 tests
**Added:** 12 files / 166 tests. **Deleted: none. Skipped: none. Weakened: none.**

---

## 1. What S1D added

| Tests | File | What it proves |
|---:|---|---|
| 7 | `tests/policy/vc-c1-per-action-denial.test.ts` | **VC-C1's denial half.** $26.03 vs a $25.00 cap → `DENY: PER_ACTION`, attributed to the `forbid`; the coarse worker surface; `26 §11` lineage; determinism over 50 repeats and a fresh engine |
| 8 | `tests/policy/per-action-boundary.test.ts` | `36 §3` layer 1 — **below / at / one minor unit above / VC-C1**; exact fixed-point; and **three discriminating pairs** proving the operand is `total_exposure` and not `vendor_amount` |
| 12 | `tests/negative-controls/vendor-amount-policy-binding.test.ts` | **The mandatory vulnerable control, run.** Production denies where the `vendor_amount` binding permits; the two differ in one field and agree elsewhere; they disagree **exactly** across the band the retained fee opens; the unsafe code is quarantined |
| 14 | `tests/policy/cedar-runtime.test.ts` | Real Cedar, at the version `31 §…` names; pinned exactly; a production dependency; **no symcc**; the parser is the real one; forbid-overrides-permit is Cedar's semantics and not ours; no home-grown language; the limit is only in the artifact |
| 23 | `tests/policy/policy-artifacts.test.ts` | **Missing / unexpected / duplicate / malformed / empty** artifacts all halt; the digest moves on any byte; no fallback policy; no runtime editing; the `<= 25.00` duplication is pinned |
| 25 | `tests/policy/fail-closed.test.ts` | Unknown action class · no applicable policy · missing authoritative state (every context operand and every entity, one at a time) · malformed request · Cedar evaluation error (permit **and** forbid) · unregistered forbid · currency |
| 18 | `tests/policy/authority-channel-attacks.test.ts` | A1 unknown intent field · A2 `rationale` (byte-identical requests) · A3 generic context · A5/A11 alternate identity · A6 substituted limit · A12 diagnostics leak · the exact `26 §8` operand set |
| 8 | `tests/policy/policy-type-boundary.test.ts` | A4, A5/A6 and A7 as **compile failures**, on a real `tsc` run, with a positive control and no stray diagnostics |
| 10 | `tests/policy/policy-set-gap-analysis.test.ts` | `36 §3`'s gap analysis: every catalogue class has a declared, executed status; P6 reachability and P1 for the governed class; the three ungoverned classes fail closed twice over |
| 14 | `tests/policy/worker-facing-policy-denial.test.ts` | One field, frozen; no diagnostics, source, entity dump, lineage, version, note or digit; the S1C defect asymmetry preserved; the accepted `.auditNote` rule still holds tree-wide |
| 17 | `tests/policy/source-rules-s1d.test.ts` | Six source rules: no money arithmetic (code **or** Cedar text) · the limit in one place · no generic context and **no window attribute** · no ledger/DB reach and one-way dependency · one seam, no stash · no `rationale`, no `intentHash` |
| 10 | `tests/integration/policy/vc-c1-end-to-end.test.ts` | **Real Postgres → enumeration → C′ under the entity lease → canonicaliser → Cedar → `DENY: PER_ACTION`**; P6 reachable from real rows; `SELECTOR_STALE` still precedes policy; `NO_GRANT` on a wrong role |

---

## 2. Obligation → proof

| Obligation | Source | Proof |
|---|---|---|
| **VC-C1 denial half** | `36 §2`, `37 §3` | `vc-c1-per-action-denial.test.ts`; `vc-c1-end-to-end.test.ts` on real Postgres |
| Boundary at every numeric limit and one past | `36 §3` layer 1 | `per-action-boundary.test.ts` — `$24.99` / `$25.00` / `$25.01` / `$26.03` |
| `<=` and not `<` verified against the architecture | `26 §8`, `26 §11.2` | the `$25.00` case, which discriminates the readings |
| Request construction fails closed, never defaults | `36 §3` layer 2 | `fail-closed.test.ts` — every context operand and every entity dropped in turn |
| Policy-set gap analysis | `36 §3` | `policy-set-gap-analysis.test.ts` |
| **P1** — no path permits above the cap | `26 §11` | the `forbid`, plus the boundary suite; symbolic proof deferred (`22` DP3) |
| **P6** — at least one path reachable | `26 §11` | the under-cap permit, from fixtures and from real rows |
| Mandatory economic-binding negative control | `36 §0`, `46 R1` | `vendor-amount-policy-binding.test.ts` — the defect is **observed** |
| Real Cedar, in-process | ADR-005, `32 §…` | `cedar-runtime.test.ts` |
| Control-artifact integrity, fail-closed | `50 §2` class 2, `50 §3` | `policy-artifacts.test.ts` |
| Coarse worker denial | `26 §7` | `worker-facing-policy-denial.test.ts` |
| `I21` unchanged | registry `§1.2` | the accepted suite, plus three new compile fixtures |
| No S1A/S1B/S1C regression | `phase2-v1.3-implementation-brief.md §7` | the complete 590-test baseline still passes |

---

## 3. Discrimination — how each headline claim can fail

`36 §0`: a test that cannot fail for the reason it names certifies nothing.

| Claim | The defect that would break it, and what catches it |
|---|---|
| "the cap binds `total_exposure`" | Bind `vendor_amount` instead → the vulnerable control **permits** VC-C1 while production denies, and they diverge exactly across the `$23.98`–`$25.00` vendor band |
| "the operand is not `vendor_amount`" | Pair 1 holds vendor fixed at `$23.97` and moves only the fee; the decision **flips**. Pair 2 holds the total fixed and moves vendor; the decision **does not move** |
| "at the limit permits" | A `<` reading denies `$25.00`; that case is asserted directly |
| "real Cedar" | A stub cannot answer `getCedarVersion()`, cannot produce two different Cedar outcomes (`forbid` determining vs. empty reason) over identical operands, and would fail the parser round-trip |
| "the denial is `PER_ACTION`, not merely a denial" | `$26.03` also fails the grant's own conjunct; the determining-policy assertion is what separates the two |
| "no fallback policy" | Every missing / empty / malformed artifact case is loaded from a real staged directory and asserted to throw |
| "`rationale` cannot reach policy" | A hostile rationale carrying `per_action_max=99999.00` and a Cedar `permit(...)` produces a **byte-identical** request |
| "no generic context" | Adding one undeclared attribute is refused by Cedar's own schema check |
| "no runtime mutation gap" | Compile failures on assignment, and a pipeline in which the effect never precedes the decision in caller scope |
| "P6 is not an outage" | The under-cap case permits, from fixtures and from real database rows |
| "the ungoverned classes are not silently permitted" | Each is executed against both barriers |

---

## 4. Independence

`36 §0`: *"Independent validation must not call the same production function twice and call
agreement proof."*

| Judgement | Where the expected value comes from |
|---|---|
| `$25.00` cap | `51 §3.1`, hand-transcribed into `tests/support/policyFixture.ts` as `PER_ACTION_MAX_LITERAL`, which imports nothing from `src/` for that constant |
| `$26.03` total | The accepted S1B oracle (`tests/support/canonicalisationOracle.ts`, no `src/` imports), re-asserted here |
| Boundary sides | Hand-authored per case, not computed from the policy |
| Catalogue status table | Authored in `policy-set-gap-analysis.test.ts` **independently** of `cedarRequest.ts`'s registry, and diffed against it |
| Denial category | Cedar's own `diagnostics.reason`, not a recomputation of the cap |
| Digest movement | Real byte edits to real staged files |

**Tripwire checked:** no assertion in the S1D suite compares a production output against a
value derived from the same production function. The one place that could have crept in —
re-deriving `total_exposure` inside the policy layer to "verify" it — was deliberately not
built; see `S1D-implementation-log.md §4`.

---

## 5. Repetition

| Suite | Runs | Result |
|---|---:|---|
| `tests/policy` + the negative control | 5 | 156/156 each run |
| `tests/integration/policy` | 3 | 10/10 each run |
| VC-C1 evaluation, inside one test | 50 + a fresh engine | identical decision object every time |
| Full `npm run verify` | 1 | 58 files / 756 tests, typecheck and lint clean |

**No test sleeps.** The end-to-end suite uses S1C's injected clock and the entity lease; the
policy path is synchronous by construction (ADR-IMP-003 §4).
