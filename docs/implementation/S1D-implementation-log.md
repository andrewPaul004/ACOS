# S1D — implementation log

Branch `feature/s1d-cedar-policy`, from `ee9c518` (S1C ACCEPTED).
Architecture package `docs/architecture/v1.3.1/` — **unmodified**, verified by
`git diff ee9c518 -- docs/architecture/` returning empty.

---

## 1. Order of work

1. Confirmed `HEAD == ee9c518` and a clean tree; branched.
2. Read the normative sources before writing code: `26` (§2.1.1, §3, §7, §7.1, §8, §11,
   §11.2, §11.4), `24 §3`, `36 §2`–§4, `37 §2`–§3, `50`, `51 §3.1`, the invariant registry
   (I19, I21, I52, I53, I59, I61) and `phase2-v1.3.1-errata.md`. Then every accepted S1A/S1B/S1C
   contract, result, clarification set and test.
3. Established the baseline: `npm run verify` → 46 files / 590 tests green.
4. Investigated the Cedar binding, installed and smoke-tested it before designing anything —
   see §2.
5. Wrote `S1D-contract.md`, including the attack plan, **before** the production seam.
6. Built the seam, then the suites, then the docs.
7. Ran the gate, repetition suites, and a diff review.

---

## 2. The binding investigation, and what the smoke test decided

Three questions had to be answered by execution, not by documentation, because each would
have changed the design:

| Question | Answer |
|---|---|
| Is there a first-party in-process Cedar for Node? | Yes — `@cedar-policy/cedar-wasm`, published from `cedar-policy/cedar`, Apache-2.0, versioned with the engine. Pinned to `4.11.2`, the patch head of the `4.11` line `31 §…` names. ADR-IMP-003 records the decision. |
| Can Cedar compare exact fixed-point money? | Yes — the `decimal` extension, four places, no float. `money.ts`'s `toDb` renders exactly and losslessly into it. |
| **Can a denial be attributed to a specific policy?** | Yes — `diagnostics.reason` names the determining policies, and named policy ids come from the `staticPolicies` record's keys. **This decided the whole design.** |

That third answer is why the per-action cap is a `forbid` rather than only a `when` conjunct:
with a single `permit` carrying a conjunction, a denial has no determining policy and
`26 §7`'s `DENY: PER_ACTION` terminal would have had to be reconstructed by re-reading the
amount — a second implementation of the cap outside the signed artifact. `26 §11` P1 wants a
`forbid` anyway; the attribution requirement and the property requirement pointed the same
way.

The smoke test also established the fail-closed behaviour the design leans on: an undeclared
context attribute is rejected at parse time (*"record attribute `evil` should not exist
according to the schema"*), and so is an unknown action. **The closed context is Cedar's
enforcement, not ours.**

---

## 3. What was built

### Production — `src/kernel/policy/`

| File | Role |
|---|---|
| `artifacts/acos.cedarschema` | The closure. Declares the context record exactly — and no window attribute |
| `artifacts/policies/acos.refund.create.grant.cedar` | `26 §8`'s worked permit, transcribed |
| `artifacts/policies/acos.refund.create.per_action_max.cedar` | `26 §11` P1 as a `forbid`, carrying `51 §3.1`'s `$25.00` |
| `policyArtifacts.ts` | Deterministic, fail-closed loading; the exact-set diff; `26 §11`'s content-hash `policy_version` |
| `errors.ts` | The two `26 §7` terminals, and the denial/defect split |
| `decision.ts` | `PolicyDecision` and its lineage — named a step-M decision, not an `AuthorizationDecision` |
| `denialCategory.ts` | Determining policy → terminal. A closed registry that reads no amount |
| `cedarRequest.ts` | Deterministic request construction from the canonical effect and nothing else |
| `cedarEngine.ts` | The real Cedar call, with four fail-closed gates |
| `policyEngine.ts` | K3's public surface: one method, one argument |
| `workerFacingPolicyDenial.ts` | The coarse projection |
| `authorise.ts` | C′ and step M in one call, with no gap between them |

### Accepted files touched — six, all additive

| File | Change | Why |
|---|---|---|
| `package.json` | +1 dependency | The Cedar binding |
| `src/kernel/canonicalisation/types.ts` | `+role` on `ResolvedPrincipal` | `26 §3` declares it; `26 §8` reads it. Required, not optional, so it cannot default |
| `tests/support/canonicalisationFixture.ts` | `+principalRole` override | To exercise a wrong role |
| `tests/support/enumerationFixture.ts` | same | same |
| `tests/canonicalisation/i21-type-boundary.test.ts` | +3 entries in the exact-set file list | Three new type-negative fixtures; the harness's discriminating properties are unaffected and the new fixtures' expected codes are owned by a separate file |
| `package-lock.json` | regenerated | — |

**No accepted test was deleted, skipped, weakened or trivialised**, and no accepted assertion
was changed. The single accepted test edit is a widening of a file list with a comment
explaining it.

---

## 4. Four things deliberately NOT built

Each was considered, and each would have been a defect.

**A re-derivation of `total_exposure` inside the policy layer.** Tempting as a defence against
post-canonicalisation mutation: re-add `vendor_amount + Σ cost_components` and refuse a
mismatch. Rejected — it is a second implementation of the constructor's arithmetic living
outside the constructor, exactly the drift `26 §12`'s separation exists to prevent, and
`36 §0`'s tripwire (*"a test that calls the same function twice proves nothing"*) applies to
production code that checks itself the same way. The mutation attack is answered structurally
instead: compile failure, plus a pipeline with no gap.

**Window headroom as a fixture-supplied policy operand.** `26 §8` carries four such terms.
S1D does not implement step R, so any headroom figure would have been a fixture wearing the
costume of an evaluated operand. The schema declares **no window attribute at all** and a
source rule keeps it that way. Recorded as S1D-O1 rather than papered over.

**An `exists` field on `ResolvedResource`.** Nothing in S1 can set it to `false`, so it would
have read as a check and performed none. `resource.exists` is entailed by the record's
presence and the entailment is proven by execution.

**A configurable cap.** The obvious way to make the negative control cheap. It would have
turned the answer to *"can a caller replace the authoritative policy limit?"* from "there is
no position for one" into "there is a position and we validate it". The control is a
duplicated builder in `tests/` instead.

---

## 5. Findings during implementation

**F1 — the accepted `.auditNote` source rule almost had to be widened.**
`tests/canonicalisation/worker-facing-denial.test.ts` fails any file under `src/` containing
`.auditNote`, with two named exemptions. `PolicyEvaluationDefect` written conventionally
(`this.auditNote = auditNote`) would have needed a third. Using TypeScript **parameter
properties** gives the same field with no `.auditNote` occurrence, so the accepted guard is
untouched. Recorded because the alternative — widening an accepted rule for an S1D
convenience — is the kind of erosion the rule exists to prevent.

**F2 — Cedar accepts a bare string where the schema declares `decimal`.**
`{"total_exposure": "26.03"}` is accepted alongside the explicit
`{"__extn":{"fn":"decimal",…}}` form. It is a **parse of the same value**, not a coercion:
both produce byte-identical decisions, and a string that is not a valid decimal is rejected.
Not an authority channel — the builder always emits the explicit form and no caller supplies a
context — but it surprised the author, so it is asserted rather than left to be rediscovered.
`tests/policy/fail-closed.test.ts` carries it as a labelled FINDING.

**F3 — the standalone `Acos::Role` entity is not an operand.**
Dropping it changes no decision, because `26 §3` makes the role a parent edge that Cedar reads
off the principal entity. Dropping the principal, or stripping its parent, does fail closed.
Asserted in all three directions so the asymmetry is documented rather than discovered.

**F4 — a wrong test premise, corrected.** The first draft asserted that a bare string operand
would be *rejected*. It is not (F2). The test was rewritten to assert what is actually true —
a boolean, a record and a number in a decimal position are all rejected — plus F2 as a
labelled finding. Noted here because the original assertion would have passed for years as a
false claim about the boundary if the suite had happened to be written the other way round.

---

## 6. Gate

| Step | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings 0`) | clean |
| `npm run test` | **58 files / 756 tests, all passing** |
| `tests/policy` + negative control, ×5 | 156/156 every run |
| `tests/integration/policy`, ×3 | 10/10 every run |
| `git diff ee9c518 -- docs/architecture/` | empty |

**Pre-existing, not introduced by S1D:** `npm audit` reports one critical advisory against
`vitest < 3.2.6` (GHSA-5xrq-8626-4rwp, arbitrary file read/execute **when the Vitest UI server
is listening**). The pinned `vitest@3.2.4` predates S1D, the UI server is never started by any
script in `package.json`, and bumping a test runner is outside the S1D mandate. Recorded so it
is not mistaken for an S1D regression, and left for a dependency-maintenance slice.
