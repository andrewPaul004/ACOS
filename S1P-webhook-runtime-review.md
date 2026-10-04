# S1P-WR — Signed provider push runtime: independent review package (final narrow correction pass)

**THE FINAL NARROW S1P-WR CORRECTION PASS: three defects found by inspecting the runtime diff, over
the accepted implementation and the accepted first correction pass. NOTHING LIVE.**

No SendGrid API call occurred. No Azure call occurred. No email was sent. No webhook was created.
No API key was created. No real public key was captured. No message was signed by a provider. No
real class-5 or class-28 artifact was created or signed. No deployment pin moved. No public
endpoint was exposed. The live six-scenario run was not performed. **`docs/architecture/v1.3.8/`
(and every prior package) was not modified.** Nothing was committed.

---

## A. Baseline

| | |
|---|---|
| Slice baseline | `01fe4f787f6ab57ec8c2a329c01298a7932162e6` — "S1P-W signed provider webhook architecture v1.3.8" |
| Branch | `feature/s1o-provider-selection-audit-boundary` |
| HEAD at end | `01fe4f787f6ab57ec8c2a329c01298a7932162e6` — **nothing committed** |
| Starting point | the uncommitted, reviewed S1P-WR worktree (runtime + first correction pass) — not reset, stashed, reverted or recreated |
| `git status --short docs/architecture` | **empty** |
| Companion diff | `S1P-webhook-runtime-review.diff`, relative to the ORIGINAL slice baseline above — 42 tracked + 23 untracked = 65 files; 7,036 untracked lines on disk = 7,036 patch-added lines, 0 mismatches; the two review artifacts are excluded |

Files changed by THIS pass: `src/kernel/controlArtifacts/bundle.ts` (one read-only accessor); `validation/sendgrid/harness/{liveComposition, preflight (comment), i20, scenarioDriver, cli}.ts`; tests `tests/sendgrid/class28-cross-plane.test.ts` (**new**), `tests/sendgrid/{cli-push-mode, i20-and-authority-boundary, scenario-driver, signed-push-evidence}.test.ts`, `tests/providerEvidence/ingress-runtime.test.ts`, `tests/support/s1pScenarioFixture.ts`; `docs/implementation/S1P-WR-implementation.md`.

## B. Class-28 cross-plane correction

**Previous check (too weak).** Both `auditPlaneAgreesOnPushChannel` (stage-1 preflight) and `openLiveComposition` accepted the two independently verified copies when the SendGrid channel's `evidence_mode` matched and, under push, `key_identity` matched. Two valid dual-signed class-28 artifacts sharing a key but differing in any other authority-bearing byte passed.

**New check — exact artifact identity.** One rule, `planesAgreeOnClass28(bundle, auditVerification)` in `validation/sendgrid/harness/liveComposition.ts`, now used by BOTH sites (the preflight returns its result; the composition refuses on it before any scenario, send or audit-evidence read, with `AUDIT_PLANE_EVIDENCE_CHANNEL_DISAGREES`). It requires, first and authoritatively:

`verifiedProviderEvidenceTrustContentHash(controlBundle) === auditVerification.providerEvidenceTrustDigest`

then mode equality and, for push, `key_identity` equality as defence in depth only.

**Where each digest comes from — the existing exact-byte machinery, no new hashing:**

* Control plane: `verifiedProviderEvidenceTrustContentHash(bundle)` — a new, narrowest read-only accessor in `src/kernel/controlArtifacts/bundle.ts` returning the class-28 `VerifiedArtifactIdentity.contentHash` that the bundle's verification bound (`verifier.ts` recomputes `SHA-256` over the exact artifact bytes and refuses unless it equals the signed manifest entry, `50 §3c`). It hashes nothing itself.
* Audit plane: `verifyAuditPlaneControlArtifacts(...).providerEvidenceTrustDigest` — `artifactDigests[28]`, the audit plane's own `SHA-256` of the exact bytes it verified.

No parsed object, `JSON.stringify` output, sub-record, version string or second canonicalisation is compared.

**Split-brain tests (`tests/sendgrid/class28-cross-plane.test.ts`, 11; `cli-push-mode.test.ts` +2 through `main`).** Every package is independently built and dual-signed; every split-brain variant keeps the SAME SendGrid key (asserted: both copies report the same `key_identity`, so the old rule would have agreed), and each is refused at BOTH sites, symmetrically:

| Variant (same key) | Result |
|---|---|
| `accepted_event_classes` `['processed']` vs `['delivered','processed']` | refused (unit + through `main`) |
| `ingress_identity` differs | refused (unit + through `main`) |
| another channel's `accepted_count_operand` differs (the push record's operand and `verification_profile` cannot differ under the closed parser, so the artifact is changed elsewhere) | refused |
| another channel added | refused |
| identical parsed content, different exact bytes (JSON indentation) | refused |
| identical bytes, separately built and signed package | **agreed** |
| identical bytes, same package | **agreed** |
| different key | refused, as before |
| READ-mode copy on the audit plane | refused |

A source-level test proves both sites call the shared rule, and that the only `keyIdentity` comparison left in the module sits inside it, after the digest check. Applying the rule in `openLiveComposition` also covers `PROVIDER_READ` (class 28 is one artifact in either mode).

## C. I20 identity correction

* **Operand field.** `I20ScenarioOperand.observedProviderMessageIds`. The type is a union: an exact `providerAcceptedCount: number` is only representable together with `observedProviderMessageIds: readonly string[]`; with `providerAcceptedCount: null` the set may be `null` (nothing trustworthy observed). `observedDistinctAcceptedMessages` (a count) is gone.
* **Runtime population.** `runScenario` builds the provider half through `exactOrObserved(observationAfter)`, which copies `ObservationResult.providerMessageIds` verbatim — never a reconstructed id, an `sg_event_id` or a correlation tag. A scenario the authority refused carries `null`. Point 6 carries the EMPTY set (exact 0, basis 0).
* **Global union rule.** `compareI20` computes `distinctIdentities(...)` — the size of the UNION of every scenario's set. No per-scenario count is summed anywhere (asserted at source level).
* **Lower bound.** `observedDistinctAcceptedMessagesLowerBound = |∪ sets|`, `null` if any scenario has no trustworthy set (the conservative behaviour is preserved). Positive excess exists only when that union exceeds the historical basis.
* **Exact numerator.** When every operand is exact: `|∪ sets|`. An exact count must equal the size of its own set; a disagreement, or a count with no set (only reachable by a cast), yields **UNRESOLVED** with the scenario named in the new `inconsistentScenarios` field — neither figure is chosen.
* **Tests** (`i20-and-authority-boundary.test.ts`): **A** same `M1` under two correlations, basis 1 ⇒ lower bound 1, not EXCEEDS, UNRESOLVED; **B** `M1`,`M2`, basis 1 ⇒ EXCEEDS_BASIS with no completeness; **C** exact fixture `M1`,`M1` ⇒ numerator 1; **D** exact `M1`,`M2` ⇒ numerator 2; **E** count 2 vs `['M1']`, count with `null` set, and `['M1','M1']` with count 2 ⇒ UNRESOLVED; previous live-push cases (4 observed / 0 observed / no set / observed excess / equal bound / fixture) retained on identities. **F** (`scenario-driver.test.ts`, fixture; `signed-push-evidence.test.ts`, live push through a real ingress): the operand equals `row.observation.providerMessageIds` and names a real simulated-account `msg_id`. **G** (`ingress-runtime.test.ts`, real audit store): events `A→M1`, `B→M1`, `C→M2` ⇒ store `i20ProviderOperand` = 2 with ids `{M1, M2}`; the harness over the same observations ⇒ lower bound 2 (the old sum would have said 3).
* **Store/harness agreement.** Both now define `I20` as distinct `sg_message_id` over the correlation set (store: a `Set` across tags; harness: a union of the operands' sets).
* **Evidence bundle.** Unchanged in shape apart from the `inconsistentScenarios` label list; the rendered I20 still reports counts only. No message ids, addresses or payloads are added.

## D. I8 evidence-string correction

* **Finding:** in the reviewed tree the quiet push branch was already a template literal — the second line of that expression began with a backtick (byte-level check of `cli.ts`), and the accepted `cli-push-mode` test asserted the rendered I8 text contains `quiet channel is not a clean one`, which comes only from `sweep.statement`. No literal `${sweep.statement}` was ever emitted. I did not reproduce the defect, and I report that rather than claim a fix.
* **Hardening anyway (no semantic change):** each push branch of `i8Conclusion` is now ONE template literal, so interpolation is unambiguous at a glance; `i8Conclusion` is exported for a direct test.
* **Regression tests** (`cli-push-mode.test.ts`): a quiet push sweep with a known statement ⇒ `NOT DISCHARGED`, `INCOMPLETE, not clean`, the statement present, no `${sweep.statement}` and no `${`; a positive finding ⇒ `**VIOLATED.**` with its statement; a full push run through `main` ⇒ the rendered evidence file contains no `${` at all.
* **Scan:** a TypeScript-AST scan of all 61 `.ts` files the slice touches found **0** string or no-substitution template literals containing `${…}`.

## E. Prior accepted corrections — intact

Mode from verified class 28 only; push with no SendGrid audit credential; supplied audit id/locator refused under push; integration class-5 / Key Vault identity required; audit evidence store required; independent audit-plane verification (now strengthened to exact digest); no Email Activity entitlement, no `/v3/messages`, no audit provider-read process and no capability probes under push; provider permission drift OPEN; push I8 positive finding / quiet period incomplete; kill point 6 live equal counts ⇒ UNRESOLVED with `redispatchOccurred: null`; exact I20 numerator unavailable under live push; receipt-interval SQL bound; read mode retained; Test-Integration classification OPEN. All the tests asserting these pass unchanged except where the I20 operand moved from a count to identities.

**One environmental fix, outside the three defects, reported for review.** On 2026-10-04 every read-mode scenario test began timing out. Cause: `tests/support/s1pScenarioFixture.ts`'s observation window ran from `S1I_NOW − 1 day` (fixed 2026-09-05) to wall-clock `+1 day`; the span grew daily and crossed the audit reader's `MAX_READ_PERIOD_MS` (31 days), so the reader child refused every read `PERIOD_BOUND_INVALID` (diagnosed from the child's captured stderr). The window now runs on the wall clock at both ends (±1 day); the simulated account does not filter by period and `nowMs` is the wall clock, so nothing is lost. No production code changed for this.

## F. Targeted tests

Targeted run (all S1P, all provider-evidence, SendGrid negative controls), one process, real PostgreSQL: **27 files, 555 tests, 555 passed, 0 failed**. New or changed in this pass:

| File | Tests | Covers |
|---|---|---|
| `tests/sendgrid/class28-cross-plane.test.ts` (**new**) | 11 | §B: digest provenance on both planes, identical-bytes agreement (same and separately signed package), five same-key split-brain refusals at both sites, different key, READ copy, shared-rule source check |
| `tests/sendgrid/cli-push-mode.test.ts` | 23 (+5) | two same-key split-brain refusals through `main`; three I8 evidence-text regressions |
| `tests/sendgrid/i20-and-authority-boundary.test.ts` | 23 (+6) | §C A–E and the no-sum source check; prior live-push cases on identities |
| `tests/sendgrid/scenario-driver.test.ts` | 26 (+1) | §C F (fixture) |
| `tests/sendgrid/signed-push-evidence.test.ts` | 16 | §C F (live push through a real ingress) |
| `tests/providerEvidence/ingress-runtime.test.ts` | 46 (+1) | §C G (store/harness agreement) |

## G. Complete suite totals

| Check | Result |
|---|---|
| `npm run typecheck` | clean |
| `npm run lint` (`--max-warnings 0`) | clean |
| Full suite (`vitest`, 10 serial `--shard` runs, one PostgreSQL, JSON reports) | **212 files, 3,218 tests, 3,218 passed, 0 failed, 0 skipped** (previous pass: 211 / 3,194) |
| DB / migrations | the suite's global setup provisions both clusters from EMPTY and migrates both chains (incl. `A0009`); then a fresh provision followed by `npm run db:migrate` → "already up to date" and `npm run db:migrate:audit` → "audit already up to date" |
| `git diff --check` + trailing-whitespace / final-newline scan of every untracked file | clean |

No test process ran concurrently with another against the same schemas. (`npm run verify` as one process exceeds this machine's background-job cap; the identical suite ran as 10 serial shards.)

## H. Perimeter / packaging

| Check | Result |
|---|---|
| `npm run verify:perimeter` | **PASS** — 0 unannotated; 1 ingress listener (`48 §8`); 0 ingress violations |
| `npm run verify:packaging` | **PASS** — every separation obligation, including all 7 ingress-closure obligations |

## I. Architecture gates / mutations

| Gate | Result |
|---|---|
| v1.3.8 `consistency-v1.3.py` | **127 PASS / 0 FAIL**; **116/116** mutation seeds discriminate |
| v1.3.7 `consistency-v1.3.py` | **108 PASS / 0 FAIL**; **77/77** mutation seeds discriminate |
| `git status --short docs/architecture` | **empty** |

## J. Open live obligations

* **Provider permission drift — OPEN EMPIRICAL OBLIGATION** (no probe under push; no entitlement bought; no management credential added).
* **SendGrid Test-Integration classification — OPEN** (nothing guessed; a correlation-less signed event makes its observation INCOMPLETE).
* Real integration credential; its real class-5 record; public ingress hosting and TLS; SendGrid webhook creation; real `public_key` capture and P-256 confirmation; real class-28 candidate and owner + second-factor release; the six live `I36` scenarios; delivery-completeness characterisation; live `I20`; live `I8`; `I17b`.

## K. Statements

* No SendGrid API call occurred. No Azure call occurred. No email was sent.
* No API key was created. No webhook was created. No public endpoint was exposed.
* No real public key was captured; no provider signature was produced.
* No real class-5 or class-28 artifact was created or signed; no deployment pin moved.
* The live six-scenario run was not performed; every test is offline.
* `docs/architecture/v1.3.8/` and every earlier architecture package are untouched.
* Nothing was committed. S1Q not begun.

**Classification: S1P-WR RUNTIME IMPLEMENTATION COMPLETE — LIVE PROVISIONING NOT STARTED.**

Not claimed: S1P complete; I36 empirically passed; SendGrid validated; webhook live; provider completeness established; I20 passed; I8 passed. Paused for independent review.
