# S1P — test matrix

Baseline `d897833`. Branch `feature/s1o-provider-selection-audit-boundary`.
**Every test below runs OFFLINE and makes ZERO provider calls.**

---

## 1. `§19`'s seventeen required discriminations, each to the test that drives it

| # | Required discrimination | Where it is driven |
| --- | --- | --- |
| 1 | launch-config sink substitution cannot change the authorised recipient | CONTROL 9, `tests/negative-controls/sendgrid-review-controls.test.ts`; structural half in `tests/sendgrid/request-mapping.test.ts` ("the mapping input has NO configured address member") |
| 2 | wrong adapter METHOD refuses before the provider boundary | `tests/sendgrid/request-mapping.test.ts` — `PAYLOAD_METHOD_MISMATCH` |
| 3 | wrong ACTION CLASS refuses before the provider boundary | `tests/sendgrid/request-mapping.test.ts` — `PAYLOAD_ADAPTER_MISMATCH`, plus the adapter's own three pre-mark comparisons exercised by the doubles in `tests/sendgrid/scenario-driver.test.ts` |
| 4 | a mutable JSON identity label is NOT sufficient live material binding | `tests/sendgrid/credential-binding.test.ts` — a document CLAIMING `PROVIDER_KEY_ID` resolves `SYNTHETIC_TEST_IDENTITY`, on BOTH planes |
| 5 | integration and audit material never co-reside in the coordinator | `tests/sendgrid/credential-process-isolation.test.ts` — import closure, one-slot allowlist, the CHILD's own reported environment keys, distinct PIDs |
| 6 | a stage-1 preflight failure touches ZERO secret sources | `tests/sendgrid/credential-process-isolation.test.ts` (order + source-position), CONTROL 13 (order trace) |
| 7 | EXACT credential-id selection — no first/last inference | CONTROL 12; `tests/sendgrid/preflight.test.ts` (a real credential that is not the configured one fails the binding) |
| 8 | offline/refused evidence does not say a live environment "was used" | `tests/sendgrid/evidence-and-kill-points.test.ts` — asserted against the FORBIDDEN phrases; CONTROL 14 |
| 9 | a provider 403 read cannot become count zero | CONTROL 10; and in the full composition, `tests/sendgrid/scenario-driver.test.ts` leaves a row with perfect local state UNRESOLVED |
| 10 | a DELAYED second provider activity is detected by stabilisation polling | CONTROL 11 (side by side with the stop-on-first loop); `tests/sendgrid/observation.test.ts` |
| 11 | loss of provider visibility during stabilisation yields UNRESOLVED | `tests/sendgrid/observation.test.ts` — "losing the provider DURING stabilisation" |
| 12 | the duplicate control produces count `>= 2` in deterministic offline simulation | `tests/sendgrid/scenario-driver.test.ts` — the SAME oracle that reported ONE reports `>= 2` |
| 13 | the six-scenario driver executes all canonical points offline through gateway/outbox/recovery | `tests/sendgrid/scenario-driver.test.ts` — five staged scenarios plus the derived re-entry row; the verdict rule itself in `tests/sendgrid/verdict-rule.test.ts` |
| 14 | the driver CONSTRUCTS descriptors rather than direct-calling provider modules | `tests/sendgrid/scenario-driver.test.ts` — import-closure assertion plus the descriptor cases |
| 15 | ordinary production policy still fails closed for `email.send` | `tests/policy/policy-set-gap-analysis.test.ts` (by execution); `tests/sendgrid/i20-and-authority-boundary.test.ts` BARRIER 4 |
| 16 | no ordinary production route reaches the validation-only authority seeder | `tests/sendgrid/i20-and-authority-boundary.test.ts` — four barriers |
| 17 | normal verification performs ZERO provider calls | `tests/sendgrid/prerequisites-and-separation.test.ts` — no test file invokes a provider-reaching function, nothing imports the harness entry point, vitest collects no file under `validation/` |

---

## 2. The S1P suites

| Suite | What it owns |
| --- | --- |
| `tests/sendgrid/request-mapping.test.ts` | the CLOSED payload schema, the encode/decode agreement against the PRODUCTION canonicaliser, the signed-operation transcription against the VERIFIED class-3 record, the sandbox refusal, the deterministic mapping |
| `tests/sendgrid/credential-binding.test.ts` | correction 3, on both planes, including the UNPROVISIONED mechanisms and the pre-correction document shape |
| `tests/sendgrid/credential-process-isolation.test.ts` | correction 5 and the order half of correction 4 |
| `tests/sendgrid/preflight.test.ts` | both stages, every gate individually load-bearing, correction 6's exact selection, correction 7's declaration |
| `tests/sendgrid/observation.test.ts` | the bound, the two phases, the stabilisation refusals, the query and normalisation |
| `tests/sendgrid/scenario-driver.test.ts` | the six canonical points executed end to end, the duplicate discrimination, the 403 composition case, `I20` over a real run |
| `tests/sendgrid/verdict-rule.test.ts` | the verdict rule itself, PURE — including the two cases the composition cannot stage without corrupting the scenario they run in: a provider-observed EXCESS and a provider-observed SHORTFALL |
| `tests/sendgrid/capability-probes.test.ts` | `§12`'s orchestration — which probe runs on which plane with which locator, and every blocking case |
| `tests/sendgrid/i20-and-authority-boundary.test.ts` | the `I20` arithmetic and refusals; the four seeder barriers |
| `tests/sendgrid/inverse-sweep.test.ts` | `I8`'s machinery, period-bounded rather than tag-bounded, and silence-is-not-agreement |
| `tests/sendgrid/evidence-and-kill-points.test.ts` | the kill-point map, the secret-shape refusal, correction 8 |
| `tests/sendgrid/provider-boundary.test.ts` | one origin, no arbitrary URL, no retry, the send-outcome taxonomy, the reader's read-only shape |
| `tests/sendgrid/prerequisites-and-separation.test.ts` | the remaining prerequisites, plane separation, and the zero-provider-call property |
| `tests/negative-controls/sendgrid-controls.test.ts` | controls 1–8 — designs nobody shipped |
| `tests/negative-controls/sendgrid-review-controls.test.ts` | controls 9–14 — **the designs that WERE shipped and were rejected** |

---

## 3. Why the controls are split into two files

Controls 1–8 discriminate implementations a careless author might write. Controls 9–14
discriminate implementations a CAREFUL author wrote, shipped, and defended in comments — the
launch-configured recipient argued to be *safer*, the refused read called an *"HONEST EMPTY"*,
the stop-on-first loop whose own comment admitted it could not see a duplicate.

A suite that only catches the careless version would have passed the rejected slice. The second
file is the one that would have rejected it.

---

## 4. `§10.1` — WHAT THE MATRIX CAN AND CANNOT CONCLUDE, AND WHY TWO ROWS NEVER PASS

The verdict rule separates the two directions of a provider-count disagreement, because the
architecture does:

| Situation | Verdict | Why |
| --- | --- | --- |
| the provider accepted MORE than expected | **FAIL** | an extra message is a POSITIVE observation, and it is the condition `I36` exists to exclude |
| FEWER, and the provider ANSWERED and held fewer | **FAIL** | a measurement, not an absence of one |
| FEWER, and the correlation never became visible | **UNRESOLVED** | `§10.1`: bounded non-observation is not proof of never-sent |
| equal, and a ZERO expectation rests on a non-observation | **UNRESOLVED** | the same rule. Points 1 and 2 |
| equal, every non-zero count positively observed | **PASS** | points 3, 4 and 5 |

**Kill points 1 and 2 therefore cannot reach PASS even on a perfect live run.** That is the
honest ceiling: SendGrid's Email Activity supplies no complete-absence guarantee, and
`KILL_POINT_CONCLUSION_LIMITS` has said so since S1P's first draft. They can still FAIL, which
is what keeps them controls.

Point 3 — the row the whole slice exists for — is unaffected. Its expectation is ONE,
positively observed, and that observation is exactly the discrimination a mock cannot make.

---

## 5. What the offline scenario run really exercises

Not a shape test. Each of the five staged scenarios:

* commits a local authorisation for `email.send`, reserving ONE irrecoverable unit at step R;
* enqueues on the durable outbox and reads back the KERNEL-minted correlation tag;
* dispatches through the unmodified `dispatchAuthorisedEffect` against a REAL PostgreSQL
  backend, with a real dispatch lease and real revalidation;
* crosses a REAL process boundary into a forked `src/integration/runtime/main.ts`;
* is observed through a SECOND forked process, `src/audit/provider/runtime/main.ts`, over the
  accepted read-only audit IPC;
* is recovered through the SAME gateway entry point.

**The ONE double is the transport.** `tests/sendgrid-doubles/` has no `fetch` in its import
closure, and the payload decoder, request mapping, credential sources, activity normalisation
and correction-9 read mapping it uses are the PRODUCTION ones.

---

# Second review — the four blockers, and the suites that discriminate them

| Blocker | Suite | What fails without the fix |
| --- | --- | --- |
| B1 — the CLI could not reach the driver | `tests/sendgrid/cli-orchestration.test.ts` | `main` produces a bundle with six judged rows, a non-null `I20`, a performed `I8` sweep and a run duplicate control. The rejected CLI produced none of them, because `controlPlaneCompositionAvailable` was a literal `false` |
| B1 — availability must be measured | same suite, last case | the default path, with NO seams, reaches the shipped `describeLiveComposition` and refuses with `CONTROL_PLANE_COMPOSITION_UNAVAILABLE` and a named block list |
| B1 — gating order | same suite | a probe finding blocks the matrix and the composition is **never opened**; a stage-1 refusal starts no credential process; a `SYNTHETIC_TEST_IDENTITY` provenance still refuses at stage 2 |
| B1 regression — `bigint` in evidence | same suite | `renderEvidenceBundle` threw `Do not know how to serialize a BigInt` on any bundle carrying a real `I20`. The assertion requires an exact decimal string, never a `number` |
| B1 regression — sweep tag echo | `tests/sendgrid/provider-response-integrity.test.ts` | with no expected tag, every record reported `correlationTag: null` and `I8` read all of them as unaccounted. Four cases: the tags are echoed; an untagged record still reports `null`; two ACOS tags report `null`; a narrowed read is unchanged |
| B2 — malformed 2xx as evidence | `tests/sendgrid/provider-response-integrity.test.ts` | one readable record plus one malformed produced a count of ONE — the same count a non-duplicated send produces. The count is now withheld; the companion case proves the loop still counts two readable records |
| B3 — a complete sweep over a truncated result | `tests/sendgrid/inverse-sweep.test.ts` (16 cases) | a clean verdict requires a page the provider SIGNALLED complete; positive findings survive incompleteness |
| B4 — two polls as a finality guarantee | `tests/sendgrid/live-finality.test.ts` (13 cases) | a duplicate appearing after two stable polls counts TWO; an unestablished bound yields UNRESOLVED; a failed read in the final interval yields UNRESOLVED; the fixture mode is labelled offline |
| B4 — verdict rule | `tests/sendgrid/verdict-rule.test.ts`, `live-finality.test.ts` | the count half and the settling half are driven separately, so neither case passes for the other's reason |

**The three substitutions in the CLI orchestration suite**, named in its own header: the
composition (a real kernel, outbox, gateway and forked runtimes over a doubled transport), the
one-shot credential-probe launcher, and a verified bundle whose class-5 declaration carries the
two validation credential records. The shipped repository carries none of the three, for
reasons `docs/implementation/S1P-release-candidate.md` records. Nothing between them is
substituted: the preflight, the gates, the sequencing and the evidence renderer are the
shipped ones.

---

# Third review — the live `email.send` enumeration constructor

| Requirement | Suite | What fails without the fix |
| --- | --- | --- |
| `§8` 1 — the registry carries the class | `tests/sendgrid/validation-email-constructor.test.ts` | the shipped `S1P_LIVE_CONSTRUCTOR_REGISTRY` resolves a constructor for `email.send`; the second-round registry held `refundCreate` alone |
| `§8` 1 — production is untouched | same suite | `src/kernel/canonicalisation/registry.ts` names no validation module, and `tests/canonicalisation/registry.test.ts` still proves `src/` registers ONE constructor |
| `§8` 1 — one identity everywhere | same suite | the implementation, the registry and the class-19 candidate carry the same `(constructor_id, action_class, 1, 0)` tuple, in the artifact's own grammar |
| `§8` 2 — the block is cleared | same suite | `describeLiveComposition` no longer reports `EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED` for the checked-in tree |
| `§8` 3 — signed authority still blocks | same suite | `CONSTRUCTOR_VERSION_RECORDS_NOT_PROVISIONED` is still reported, so implementing the constructor grants it no authority |
| `§9`, `§11` — the acceptance test | same suite | every remaining block is asserted individually to be an external prerequisite, and supplying three externals clears the measurement entirely |
| `§8` 4 — deterministic enumeration | same suite | two enumerations of unchanged state return one option with the same `option_id`, and the description is empty |
| `§8` 6 — revalidation identity | same suite | `reEnumerate` returns the SAME `option_id` the initial enumeration produced |
| `§8` 7 — changed state fails | same suite | demoting the resource's grade to `OBSERVATION` empties the live set and reports `RESOURCE_NOT_RECORD_GRADE`; an absent resource reports `RESOURCE_ABSENT` and leaks no existence |
| `§3` — record 13 is consistent | same suite | the digest agreement check passes against the VERIFIED class-3 bytes, and two different validation resources still receive DISTINCT option identities |
| `§8` 8 — ordinary traffic fails closed | same suite + `tests/policy/policy-set-gap-analysis.test.ts` | the class is catalogued, the policy set names it nowhere, and the gap is proved by EXECUTION |
| `§8` 9 — no production reach | same suite + `tests/sendgrid/prerequisites-and-separation.test.ts` | no file under `src/` mentions the constructor module, and the control-plane import closure holds nothing from `validation/` |
| `§8` 10 — the matrix still runs | `tests/sendgrid/cli-orchestration.test.ts` | `main` still drives all six canonical rows through the offline provider doubles |
| class-19 candidate bytes | `tests/release/class19-admission.test.ts` | membership is still rooted in the verified bytes, all four `§12` attacks still refuse, and the manifested set is now two records — a happy-path caller must supply BOTH or fail `MANIFESTED_CONSTRUCTOR_MISSING` |

**`§8` item 5 — the live `enumerate` port invokes the real `EffectEnumerator`** is a property
of `validation/sendgrid/harness/liveComposition.ts` rather than of a test double: the port
calls `enumerator.enumerate` under the entity lease and returns `outcome.set.enumerationId`
and `outcome.set.options[0].optionId` unchanged. It synthesises neither value, and the SAME
enumerator instance is handed to `dispatchEnvironmentFor`, so dispatch-time revalidation is
literally the same machinery over the same registry and resolver. The enumeration/revalidation
identity match is driven directly in `validation-email-constructor.test.ts` items 6 and 7.
