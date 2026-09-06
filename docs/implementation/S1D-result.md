# S1D — result

**S1D: PASS**

| | |
|---|---|
| **Branch** | `feature/s1d-cedar-policy` |
| **Based on** | `ee9c518` — S1C ACCEPTED |
| **Baseline** | 46 files / 590 tests |
| **Final** | **58 files / 756 tests, all passing.** `npm run verify` green: typecheck, lint (`--max-warnings 0`), tests |
| **Architecture package** | `docs/architecture/v1.3.1/` **UNMODIFIED** — `git diff ee9c518 -- docs/architecture/` is empty |
| **Cedar runtime** | `@cedar-policy/cedar-wasm@4.11.2`, in-process, pinned exactly, a production dependency. `cedar.getCedarVersion()` asserted. **`cedar-policy-symcc` not installed** |
| **VC-C1** | **CLOSED.** `$25.00` vendor + `$1.03` retained fee = `$26.03` total → **`DENY: PER_ACTION`**, from fixtures and from real Postgres |
| **Negative control** | **DISCRIMINATES.** The `vendor_amount` binding **permits** VC-C1 while production denies |

---

## 1. The headline

`26 §2.1.1`, verbatim:

> **And the consequence that matters most: no policy cap intended to bound economic loss may
> compare only against `vendor_amount`.** `§8`'s refund policy therefore tests
> `context.exposure.total_exposure <= 25.00`, so a $25.00 line refund carrying a $1.03
> retained fee **denies** `PER_ACTION`.

S1B's `errors.ts` recorded the gap in as many words: *"PER_ACTION is a POLICY denial and no
code path here can produce it. `36 §2` VC-C1's denial half is open until the Cedar slice."*

**It is closed.** A real Cedar engine, linked in-process, evaluating an authoritative `$26.03`
that the S1B canonicaliser computed from authoritative state, against `51 §3.1`'s `$25.00`
bound held as a literal inside an owner-signed control artifact, returning
`DENY: PER_ACTION` attributed to the determining policy — end to end from real database rows.

---

## 2. Self-attack — the sixteen questions

### 1. Is a real Cedar engine evaluating the production decision, or is Cedar merely represented by test/mocking glue?

**Real.** `@cedar-policy/cedar-wasm@4.11.2` — the Cedar project's own WASM build, compiled
from the same Rust crate the project ships, Apache-2.0, on the `4.11` line `31 §…` names.
Asserted by execution rather than by dependency name:

- `cedar.getCedarVersion()` returns `4.11.2`. It is compiled into the WASM module; a stub
  would have to reimplement the engine to answer it.
- The real parser accepts the policy set and **rejects** `permit(principal` and
  `namespace { entity`.
- **Cedar's own semantics produce the attribution.** At `$26.03` the grant's `<= 25.00`
  conjunct fails *and* the `forbid` fires; Cedar returns the `forbid` as determining. Remove
  the `forbid` from the set and the same request denies with an **empty** reason. Two
  different Cedar outcomes over identical operands — only a real evaluator produces that.
- Structurally: exactly two modules import the binding (`cedarEngine.ts`,
  `policyArtifacts.ts`), exactly one calls `isAuthorized`, and there is no `parsePolicy`,
  `evaluatePolicy`, `matchPolicy` or `evaluateRule` anywhere in the tree.
- No dependency whose name contains `symcc` is installed.

`tests/policy/cedar-runtime.test.ts`, 14 tests.

### 2. Can any field originating in `ProposedIntent` directly populate an authoritative monetary operand supplied to Cedar?

**No, and the answer is structural at three depths.**

- **The wire.** Step B rejects any fifth field: `total_exposure`, `exposure`, `amount`,
  `per_action_max` and `context` all deny `MALFORMED` before anything else runs.
- **The type.** `AuthorizationRequest`'s authority-bearing fields are `KernelComputed<T>`; a
  raw `Money` is not assignable to one. `tests/type-negative/model-exposure-into-policy.ts`
  fails to compile at two depths — the money cannot enter an `Exposure`, and a hand-built
  `Exposure` cannot enter a request.
- **The API.** `buildCedarRequest` and `PolicyEngine.evaluate` each take exactly one
  parameter and it is the `CanonicalEffect`. There is no argument position for an amount,
  a limit, a context or an identity. `tests/type-negative/policy-operand-supplied.ts` fails
  with `TS2554`.

Exactly **one** of the four `I21` fields reaches Cedar: `reason_code`. It carries no monetary
meaning — the approved subset it is tested against is a literal inside the signed artifact,
not a request field.

### 3. Does `rationale` reach Cedar in any form other than an opaque lineage commitment outside authority evaluation?

**No. It does not reach Cedar at all, and neither does the commitment.**

Two effects differing only in `rationale` — one benign, one carrying
`per_action_max=99999.00`, an embedded `{"exposure":{"total_exposure":"0.01"}}` and a literal
`permit(principal, action, resource);` — produce **byte-identical** Cedar requests and
identical decisions including lineage. No fragment appears anywhere in the rendered request.

`intentHash`, which *does* commit to `rationale` (S1B-C1), is deliberately **not** a Cedar
context attribute: the two effects have different `intentHash` values and neither appears in
either request. A source rule asserts that no file under `src/kernel/policy/` names
`rationale` or `intentHash` in executable code, and S1D added **no exemption** to the accepted
tree-wide rule in `tests/canonicalisation/source-rules.test.ts`.

And a hostile rationale does not buy its way under the cap: VC-C1 still denies `PER_ACTION`.

### 4. For VC-C1, which exact field causes `$26.03` to be tested against the per-action bound?

`effect.request.exposure.totalExposure` → `context.exposure.total_exposure`. One read, in
`buildRefundCreateCedarRequest`, rendered through `toDb` with no arithmetic.

**Proven, not asserted, by three discriminating pairs:**

| Pair | Held fixed | Moved | Result |
|---|---|---|---|
| 1 | `vendor_amount` at `$23.97` | fee `$1.03` → `$1.04` (total `$25.00` → `$25.01`) | the decision **FLIPS** — so the operand is not `vendor_amount` |
| 2 | `total_exposure` at `$25.00` | vendor `$23.97/$1.03` → `$24.00/$1.00` | the decision **does NOT move** — so `vendor_amount` is not an operand |
| 3 | fee at `$1.03` | vendor `$23.97` → `$25.00` | permit → deny, and the denying case is the one whose **dispatched** amount is exactly at the cap |

`exposure.vendorAmount` is read **nowhere** under `src/kernel/policy/`, and
`acos.cedarschema` declares no attribute it could be written into. Both asserted by source
scan.

### 5. What happens if the implementation is changed to evaluate `$25.00 vendor_amount` instead? Does the negative control actually observe the wrong outcome?

**Yes. It permits.**

`tests/negative-controls/unsafe-vendor-amount-policy.ts` is a full second request builder
differing from production in one expression — `decimalOf(toDb(vendorAmount))` where production
reads `totalExposure`. Everything downstream is production: the same real Cedar engine, the
same loaded artifacts, the same signed policy text, the same `$25.00` limit, the same category
resolution.

On VC-C1: **production denies `PER_ACTION`, the unsafe control PERMITS.**

The control is discriminating in both directions, which is what makes it evidence rather than
a demonstration that two programs differ:

- **agrees** at `$10.00 + $1.03` — both inside the cap, both permit;
- **agrees** at `$40.00 + $1.03` — both outside, both deny `PER_ACTION`;
- **disagrees on every value** in the band the retained fee opens — vendor `$23.98`, `$24.00`,
  `$24.50`, `$24.99`, `$25.00`: production denies each, the unsafe control permits each;
- **agrees again** at `$23.97`, one minor unit below the band.

That band is exactly the money `26 §2.1.1` says a `vendor_amount` cap was leaking.

Production was **not** weakened to build it: nothing was made overridable, no seam opened, no
field made settable. The cost is a duplicated builder in `tests/`, quarantined and asserted to
be unimported by `src/`.

### 6. Are below/equal/above boundary semantics proven?

**Yes**, and the rule was verified against the architecture rather than assumed. `26 §8`:
`total_exposure <= 25.00`. `26 §11.2` row 3: *"Bounded by `total_exposure ≤ $25.00`"*. Two
independent statements, both `<=`.

| `total_exposure` | Result |
|---|---|
| `$24.99` | PERMIT |
| **`$25.00`** | **PERMIT** — the case that discriminates `<=` from `<` |
| `$25.01` | DENY `PER_ACTION` |
| `$26.03` | DENY `PER_ACTION` |

The comparison is exact fixed-point throughout: `money.ts` holds minor units in a bigint,
`toDb` renders at the declared scale, Cedar's `decimal` carries four places. No `number`
exists on the path. `$25.00` and `$25.01` are asserted to differ by exactly `1n` minor unit
and to sit on opposite sides of the decision.

### 7. Can an unknown action class accidentally reach a generic permit path?

**No, and there are two independent barriers.**

- The per-class construction registry is closed with **no generic fallback**. An unregistered
  class is a `NO_POLICY_CONSTRUCTION` defect — not a permit, and not a business denial.
  Asserted for all three ungoverned catalogue classes and for six invented names including
  `'refund.creates'`, `'refund.create '` (trailing space), `'REFUND.CREATE'` and `''`.
- Even reaching Cedar directly, `acos.cedarschema` declares **one** action and Cedar refuses
  the rest (`CEDAR_REQUEST_REJECTED`). Unknown entity types are refused too.

And `36 §3`'s complaint about silence is answered:
`tests/policy/policy-set-gap-analysis.test.ts` carries a status table for every catalogue
class, authored **independently** of the registry it audits and diffed against it, with each
ungoverned class's failure asserted by execution.

### 8. What happens if the Cedar policy or schema is absent, malformed, duplicated, or cannot evaluate?

**Every case halts. There is no fallback policy and no runtime editing.** All twenty-three
cases load a real staged artifact directory from disk:

| Case | Outcome |
|---|---|
| schema absent · policy absent · policy directory absent · directory **empty** | `POLICY_ARTIFACT_INVALID` at load |
| an extra `.cedar` file — **including a permissive `permit(principal, action, resource);`** | refused at load; no engine can be constructed over it |
| a non-policy file, or a subdirectory, in the signed directory | refused |
| a duplicate artifact claiming a loaded id | refused |
| malformed schema · malformed policy · **empty** policy file · comments-only policy file | refused **at load**, not at first evaluation |
| a Cedar evaluation error in a **permit** | `CEDAR_EVALUATION_ERROR` — checked before the decision is read |
| a Cedar evaluation error in a **forbid** | same — this is the dangerous one, since the decision could otherwise be a permit |
| a deployed `forbid` with no registered terminal | `POLICY_ARTIFACT_INVALID`, never a guessed category |

`policyArtifacts.ts` contains no `permit(`, no `forbid(`, no `DEFAULT_POLICY` and no
`fallback`. `PolicyEngine`'s entire surface is `constructor`, `evaluate`, `policyVersion` —
no setter, no reload. The loaded artifacts object is frozen.

The digest is a real content hash: a one-byte comment appended to the schema or to the
`forbid` moves it; a rename is caught by the exact-set diff first.

### 9. Can raw Cedar diagnostics reach a worker?

**No.** `projectPolicyDecisionToWorker` returns a frozen object with exactly one field, built
from `decision.code` alone. Asserted absent from the rendered value: determining policy ids,
policy source (`forbid`, `permit(`, `decimal`), entity types (`Acos::`), the audit note, the
`policy_version`, the `constructor_version`, **and any digit at all**.

The audit note itself contains **no figure**: `26 §7` warns that *"a model that learns
'denied: amount exceeded by $3' has been handed a probing oracle"*, and the safest way not to
leak the near-miss is never to compute it. Asserted directly.

The S1C asymmetry is preserved: `projectedPolicyOutcome` has **no `catch` and no `try`** — a
`PolicyEvaluationDefect` propagates rather than being projected into a routine denial. The
accepted tree-wide `.auditNote` rule still holds after S1D, with **no exemption added** (see
`S1D-implementation-log.md` F1).

### 10. Can a caller supply or replace the authoritative policy limit?

**No — there is no position for one.** The `$25.00` figure lives in the owner-signed Cedar
policy text and **nowhere else in the tree**: a source rule asserts it appears in no
TypeScript file under `src/`, and exactly two `.cedar` artifacts carry it (`26 §8`'s permit
conjunct and `26 §11` P1's `forbid`), at the same figure, with no other decimal literal used
as a cap anywhere in the set.

It is not a request field, not a constructor parameter, not an environment variable and not a
fixture. `PolicyEngine.evaluate` takes one argument; supplying a limit does not compile.
A substituted artifact is refused at load, and if one somehow deployed, its digest is on
**every** decision (`26 §11`).

### 11. Can a caller mix a canonical refund effect with policy state belonging to another company/resource/action?

**No, because there is no separate policy-state parameter to mix.** Every Cedar operand is
read off the one `CanonicalEffect`:

- the **action** is `effect.request.actionClass`;
- the **resource** is `effect.request.resource.resourceId` — the RESOLVED resource, and S1B's
  cohesion check already refuses a request whose intent ref and resolved resource disagree;
- the **principal and its role edge** are `effect.request.principal`;
- every **context** operand is `effect.request.exposure` / `.selectedOption` / `.reasonCode` /
  `.customerNovelty`.

There is no company parameter, no window parameter, no grant parameter and no state parameter.
The attack does not fail a check — it has no expressible form.

### 12. Is the policy decision tied to the canonical effect produced after S1C selector revalidation rather than a separately reconstructed model-facing object?

**Yes, structurally.** `AuthorisationPipeline.authoriseUnderLease` runs S1C's
`canonicaliseUnderLease` and then `PolicyEngine.evaluate` in one call, and the
`CanonicalEffect` **never becomes a caller-visible value between them** — it is returned
*with* the decision, afterwards. A source rule asserts that `authorise.ts` is the only module
calling both, and that it stores the effect nowhere.

The end-to-end suite proves the tie from real state: the selected option carries the live
`line_id` and `parent_transaction_id`, and a concurrently exhausted line still denies
`SELECTOR_STALE` at C′ and never reaches policy — so S1D did not move option resolution.

Runtime mutation of the effect is answered by compile failure
(`tests/type-negative/mutate-canonical-exposure.ts`, `TS2540` on both the field and the block)
plus the absence of a gap. **Honest limit:** TypeScript's `readonly` is compile-time only, so
a caller determined to defeat the type system with `as unknown as` could mutate an effect it
holds. In S1D no caller holds one before the decision. Deep-freezing the canonical effect at
construction is recorded as a hardening item, not claimed.

### 13. Did S1D alter any accepted S1A/S1B/S1C authority quantity or selector semantics?

**No.**

- `vendor_amount = $25.00`, `retained_processing_fee = $1.03`, `total_exposure = $26.03`,
  dispatch amount `$25.00` — unchanged, and re-asserted inside the S1D suite.
- `option_id`'s meaning and composition — untouched. `semantic_option_digest` is still exactly
  `26 §2.2`'s five fields.
- `I21` — unchanged; the accepted suite passes and three compile fixtures were added.
- `I53`, `SELECTOR_STALE`, no-substitution — asserted still holding, ahead of policy, in the
  end-to-end suite.
- The `RegisteredConstructor` exact-set tripwire — **not widened**. Policy hangs off no
  constructor registration.
- No generic `AuthorizationRequest` a model can populate was reintroduced.
- The whole 590-test baseline still passes.

The only production type change is `+role` on `ResolvedPrincipal`, which `26 §3` declares and
`26 §8` reads, added as **required** so it cannot default.

### 14. Did any accepted test have to be weakened?

**No test was deleted, skipped, weakened or converted into a trivial assertion.**

One accepted test file was edited, additively: `tests/canonicalisation/i21-type-boundary.test.ts`
lists the type-negative fixture directory as an exact set, and S1D adds three fixtures to that
directory. The list gained three entries and a comment; **no existing entry, assertion or
expectation changed.** The harness's discriminating properties are intact — the positive
control still compiles clean, and *"no diagnostic appears on an unmarked line"* now covers the
three new files too. Their expected diagnostics are owned by a separate file, so the accepted
test's scope did not grow.

Two accepted **fixture support** files gained an optional `principalRole` override. Neither is
a test.

One near-miss is recorded rather than taken:
`tests/canonicalisation/worker-facing-denial.test.ts` fails any `src/` file containing
`.auditNote`. Writing `PolicyEvaluationDefect` conventionally would have needed a third
exemption; TypeScript parameter properties avoid the occurrence entirely, so the accepted
guard is untouched (`S1D-implementation-log.md` F1).

### 15. Which validation obligations remain OPEN after this slice?

Full detail in `S1D-owner-clarifications.md` §O. In brief:

| # | Open |
|---|---|
| O1 | **`26 §8`'s four window-headroom terms.** `26 §7` puts headroom at step R; ADR-005 and `36 §4` put window aggregation in the ledger, not in policy. The schema declares **no** window attribute, so no fixture can masquerade as one. **A `PERMIT` from S1D is a step-M permit and authorises no dispatch.** |
| O2 | `26 §7` steps D, E, F, G, H, H′, H″, I, J, K, L, N |
| O3 | The other three catalogue classes — deliberately ungoverned; their fail-closed behaviour is asserted |
| O4 | Owner **signing** of the policy artifact. S1D binds the content hash and builds no key management |
| O5 | `I19` as a **continuous** check; S1D fails closed at load |
| O6 | symcc; P2, P3, P4, P4a, P5, P5a, P7, P8. P1 and P6 hold as runtime properties for `refund.create` only |
| O7 | Denial **ordering** within `26 §7` — unassertable while only one step exists |
| O8 | `PrincipalKind` diverges from `26 §3`'s enumeration. **Pre-existing S1B**, not introduced or changed here; no S1D behaviour depends on it |
| O9 | S1C's `26 §2.0.1` / VC-C2 wording tension — carried forward, `NEEDS TEXTUAL RESOLUTION`, **not blocking** (see question 16) |

Also carried forward from S1C, unchanged: VC-C2 journaling and quota, `I52`'s CI spec-review
half, and VC-C3's lock clause once the propose→authorise→execute span exists. **S1D does not
claim that span**, for the same reason S1C did not: the later stages do not exist.

### 16. Did you discover any actual normative architecture conflict?

**No.** Two apparent tensions were examined and both resolve.

**(a) `26 §8`'s window terms versus ADR-005 and `36 §4`.** `26 §8`'s worked policy reads
`exposure.window("W_DAY_REFUND").monetary_headroom`, while ADR-005 says *"numeric aggregation
over time windows lives in the exposure ledger, not in policy"* and `36 §4` item 2 repeats it.
These are consistent: the **ledger aggregates**, and Cedar **compares an already-aggregated
figure supplied as an operand**. `26 §8`'s syntax reads a supplied value; it does not ask
Cedar to sum anything. S1D implements neither half and records the omission as O1. **Not a
conflict.**

**(b) S1C's carried-forward wording issue.** `26 §2.0.1`'s out-of-scope enumeration row says
"denies" while `36 §2` VC-C2 says "returns an empty set rather than a denial that leaks
existence". Owner disposition is `NEEDS TEXTUAL RESOLUTION`.

**It is not blocking to S1D**, so no work was stopped. It concerns enumeration scoping at the
READ, which happens before C′ and therefore before policy. No Cedar policy, no schema
attribute and no denial terminal in S1D depends on which reading is taken; S1C implements both
sides already. Carried forward as an explicit open textual issue, and
`docs/architecture/v1.3.1/` was not edited.

---

## 3. What S1D built

| Component | File |
|---|---|
| the Cedar schema — the closed context | `src/kernel/policy/artifacts/acos.cedarschema` |
| `26 §8`'s worked refund permit | `artifacts/policies/acos.refund.create.grant.cedar` |
| `26 §11` P1 / `51 §3.1`'s cap, as a `forbid` | `artifacts/policies/acos.refund.create.per_action_max.cedar` |
| deterministic fail-closed artifact loading and `26 §11`'s `policy_version` | `policyArtifacts.ts` |
| the `26 §7` terminals, and the denial/defect split | `errors.ts` |
| the step-M decision and its lineage | `decision.ts` |
| determining policy → denial terminal, reading no amount | `denialCategory.ts` |
| Cedar request construction, one argument | `cedarRequest.ts` |
| the real in-process Cedar call, four fail-closed gates | `cedarEngine.ts` |
| K3's public surface | `policyEngine.ts` |
| the coarse worker projection | `workerFacingPolicyDenial.ts` |
| C′ and step M in one call | `authorise.ts` |
| the mandatory vulnerable control | `tests/negative-controls/unsafe-vendor-amount-policy.ts` |
| the binding decision | `docs/implementation/ADR-IMP-003-cedar-binding.md` |

---

## 4. Invariant and property status after S1D

| | Status |
|---|---|
| **P1** (`26 §11`) | **RUNTIME half PROVEN for `refund.create`** — expressed as a `forbid`, so no permit in the set can override it; boundary-tested. Symbolic proof OPEN (`22` DP3) |
| **P6** (`26 §11`) | **PROVEN for `refund.create`** — the under-cap path permits, from fixtures and from real rows |
| **P2, P3, P4, P4a, P5, P5a, P7, P8** | OPEN — the classes and mechanisms they govern are not in S1D |
| **I21** | **HOLDS**, unchanged. Extended by three compile fixtures |
| **I53 / `SELECTOR_STALE`** | **HOLDS**, unchanged, and asserted to still precede policy |
| **I18a / I18c** | **HOLD**, unchanged |
| **I18b / I18d** | OPEN — no reservation, no settlement |
| **I19** | **LOAD-TIME half PROVEN** for the policy set — content hash computed and bound to every decision, fail-closed on mismatch of set, shape or parse. Signature and continuous-recompute halves OPEN |
| **I61** | **HOLDS** — `constructor_version` is on every policy decision |
| **I42** | OPEN — no effect row |

---

## 5. Scope compliance

Not built, not stubbed, not partially wired: **`cedar-policy-symcc` · approvals and resume ·
VC-C4 · OWNER approval workflow · the complete propose→authorise→execute lifecycle · runtime
reservation handoff · `I18b` · `I18d` · the outbox · external-effect claim · `I42` · real
Shopify/Stripe adapters · vendor HTTP · the audit mirror · audit quota · AI CEO · AI workers ·
standing-authorisation lifecycle · additional business action classes.**

The architecture package is unmodified. No S1A, S1B or S1C production check was weakened.

**Do not read S1D as completing:** symcc, approvals, reservations, the outbox, adapters,
audit, or the complete propose→authorise→execute lock span. Those remain future work, and the
lock-span limitation is S1C's, carried forward verbatim: the later stages that would have to
be inside the span do not exist.

---

## STOP

S1D ends here. S1E is not begun.
