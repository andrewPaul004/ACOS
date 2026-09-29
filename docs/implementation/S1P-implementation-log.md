# S1P — implementation log (independent-review corrections)

Baseline `d897833`. Branch `feature/s1o-provider-selection-audit-boundary`.
**Operating Spine v1.3, package issue v1.3.7 — UNCHANGED. `docs/architecture/` is
byte-identical and the 108-condition verification is 108 PASS / 0 FAIL.**

The independent reviewer classified the previous S1P work

> **S1P PARTIAL — IMPLEMENTATION/VERIFICATION DEFECT**

and issued twenty corrections. This log records, for each one, the DEFECT, the FILES, HOW it
was corrected, and the DISCRIMINATING TEST.

---

## 1 — `email.send`: the honest action class

**DEFECT.** The validation send was disguised as an existing class so that no catalogue member
had to be added, and S1P-C1 was carried as an open recoverability question the owner had
already ruled.

**FILES.** `artifacts/control/class-03.action-catalogue.json`;
`src/kernel/canonicalisation/actionClasses.ts`;
`tests/policy/policy-set-gap-analysis.test.ts`; `tests/controlArtifacts/class-authority.test.ts`;
`tests/canonicalisation/registry.test.ts`; `tests/integration/outbox/outbox-scope.test.ts`;
three fixtures pinning the class-3 artifact version.

**HOW.** `email.send` is added to the signed class-3 catalogue with the owner's values —
`IRRECOVERABLE`, `value_direction NONE`, no vendor monetary field, not cost-component-free, not
rate-based, ONE irrecoverable unit, `settlement_tolerance NONE`, adapter `sendgrid_email`,
method `emailSend`, empty semantic-option-digest field list, `enumeration_max_age_seconds 120`
recorded as an S1P FIXTURE decision. `ACTION_CLASSES` gains the TypeScript name and nothing
else. **Class 2 is untouched** and **class 19 is untouched**; both decisions are argued in
`S1P-owner-clarifications.md` (S1P-C2, S1P-C3).

**DISCRIMINATING TEST.** `tests/policy/policy-set-gap-analysis.test.ts` executes
`UNGOVERNED_FAILS_CLOSED` for the new class at both barriers — no registered policy
construction, no Cedar action — and `tests/sendgrid/i20-and-authority-boundary.test.ts`
BARRIER 4 adds the constructor barrier.

---

## 2 — the provider request is BOUND to the authorised effect

**DEFECT.** The adapter verified the hash of `dispatchPayloadBytes` and then ignored those
bytes: the recipient, the sender and the body came from launch configuration, so one JSON edit
redirected the effect while every hash still verified.

**FILES.** NEW `validation/sendgrid/integration/validationPayload.ts`;
`validation/sendgrid/integration/requestMapping.ts` (rewritten);
`validation/sendgrid/integration/adapter.ts` (rewritten);
NEW `validation/sendgrid/harness/validationAuthority.ts`;
DELETED `validation/sendgrid/integration/nonProductionConfig.ts`.

**HOW.** A CLOSED four-field vendor-parameter schema — `sender_address`, `sink_address`,
`subject`, `body_text` — is written into the canonical dispatch payload by the seeder and
decoded by the adapter from `invocation.dispatchPayloadBytes`. Unknown and missing fields
refuse. `SendGridSendInput` has three members and **none of them is a launch document**, so a
configuration substitution is not ignored — it is inexpressible. The correlation tag remains
kernel metadata on `categories` and `custom_args` only; `sandbox_mode: false` remains a fixed
adapter safety literal.

**DISCRIMINATING TEST.** CONTROL 9 in
`tests/negative-controls/sendgrid-review-controls.test.ts` — one authorised payload, two launch
configurations: the real mapping produces the same recipient twice, the unsafe one follows the
document. Plus `tests/sendgrid/request-mapping.test.ts`, which ENCODES with the production
canonicaliser and DECODES with the transcribed parser.

---

## 3 — credential identity must be MATERIAL-BOUND

**DEFECT.** Both sources read `identityProvenance` out of a mutable JSON document and admitted
a live run whenever it said `PROVIDER_KEY_ID`. A comment claimed a `§8.7` provider read-back
probe established the binding; no such probe exists.

**FILES.** `validation/sendgrid/integration/secretSource.ts`,
`validation/sendgrid/audit/secretSource.ts` (both rewritten).

**HOW.** **Provenance is a property of the MECHANISM, never a field of the document.** A
declared `sourceKind` selects one of three mechanisms; `PROVENANCE_BY_SOURCE_KIND` is what each
is entitled to assign. `FILE_FIXTURE` assigns `SYNTHETIC_TEST_IDENTITY` whatever the file
claims. The two binding mechanisms are declared and **UNPROVISIONED** — they resolve nothing —
because no platform secret manager is selected and no key-id binding exists. The nonexistent
read-back claim is RETRACTED in the file rather than reworded away.

**DISCRIMINATING TEST.** `tests/sendgrid/credential-binding.test.ts` — a document CLAIMING
`PROVIDER_KEY_ID` resolves `SYNTHETIC_TEST_IDENTITY`, on both planes; the two binding
mechanisms resolve `UNAVAILABLE`; the pre-correction document shape resolves nothing.

---

## 4 — two-stage preflight

**DEFECT.** `main()` called `withResolvedCredentials(establishFacts(...))` and evaluated the
gate afterwards, so both deployment documents were read on every invocation — including ones
that were always going to refuse. The comment beside it claimed the opposite.

**FILES.** `validation/sendgrid/harness/preflight.ts` (rewritten),
`validation/sendgrid/harness/cli.ts` (rewritten).

**HOW.** `evaluateStage1` over `Stage1Facts` — the verified bundle, the provider, the configured
credential identities, the signed class-5 records and risk classes, the signed class-3
operation, Option-A's runtime count, the non-production acknowledgement, sender/sink safety, the
entitlement and live acknowledgements, sandbox impossibility and the control-plane composition.
`evaluateStage2` over `Stage2Facts` — credential identity only, from facts a one-shot process
established. `establishStage1Facts` imports no secret source and forks nothing.

**DISCRIMINATING TEST.** CONTROL 13 (order trace) and
`tests/sendgrid/credential-process-isolation.test.ts`'s source-order assertion: the single call
to `establishStage2Facts` sits after the stage-1 guard.

---

## 5 — no process holds both vendor credentials

**DEFECT.** The coordinator resolved BOTH credentials in its own memory.

**FILES.** NEW `probeEnvironment.ts`, `probeResult.ts`, `probeRuntime.ts`, `probeMain.ts`,
`probeClient.ts`; `scopeProbes.ts` (probe shapes moved out, `plane` added);
`preflight.ts` (live-provenance predicates transcribed rather than imported).

**HOW.** A CLOSED seven-key environment with **ONE** locator slot and **ONE** source-module
slot. Four roles: `IDENTITY`, `SEND_PROBE` (audit plane only), `READ_PROBE`,
`DUPLICATE_SEND_PROBE` (integration plane only). One line of sanitized JSON crosses back, from a
type with no member a secret could occupy. The coordinator's import closure contains neither
secret source and neither provider client.

**DISCRIMINATING TEST.** `tests/sendgrid/credential-process-isolation.test.ts` — the closure
assertion, the child's OWN reported environment keys, distinct PIDs, and the reply scanned for
the sentinel.

---

## 6 — exact credential selection

**DEFECT.** The harness scanned every class-5 record and kept whichever matched the adapter
LAST.

**FILES.** NEW `validation/sendgrid/harness/deploymentConfig.ts`; `cli.ts`; `preflight.ts`.

**HOW.** The trusted configuration NAMES the exact expected identity per plane, and the identity
is the KEY into `declaration.credentials`. Stage 2 compares the resolved identity to that SAME
configured identity.

**DISCRIMINATING TEST.** CONTROL 12 — two records for one adapter: the unsafe scan silently
returns the second; the corrected lookup is by the configured name. Plus the stage-2 case where
a REAL, material-bound credential that is simply not the configured one fails
`INTEGRATION_CREDENTIAL_IDENTITY_MISMATCH`.

---

## 7 — explicit non-production declaration

**DEFECT.** `nonProductionDeclared` was `configuration.kind === 'CONFIG'` — a parseable document.

**FILES.** `cli.ts` (`NON_PRODUCTION_ACK_TOKEN`), `preflight.ts` (two separate gates).

**HOW.** A sentence naming all three things `§7` requires, plus a SEPARATE gate for the
environment label so a run cannot state the claim without saying which account it is about.

**DISCRIMINATING TEST.** `tests/sendgrid/preflight.test.ts` — a configuration that PARSES does
not supply the declaration; `true`, `1`, `yes` do not either.

---

## 8 — evidence describes what happened

**DEFECT.** A constant claiming "This run used a dedicated non-production sending identity" was
written into every bundle, including runs that refused before touching anything.

**FILES.** `validation/sendgrid/harness/evidence.ts`, `cli.ts`.

**HOW.** `productionStatementFor` derives the statement from run state. The offline shape states
only what did not happen and names the gate count; the live shape is reachable only when
`liveRunPerformed` is true. `stage1Failures`, `stage2Failures`, `credentialsTouched`,
`providerOperationCount` and `i20` are new bundle members.

**DISCRIMINATING TEST.** CONTROL 14, and
`tests/sendgrid/evidence-and-kill-points.test.ts` — the rendered offline bundle is asserted
against the FORBIDDEN phrases rather than the expected one, because a positive assertion would
pass on a bundle containing both.

---

## 9 — a failed read is not a count of zero

**DEFECT.** Every answered response became `EVIDENCE`; a 403 reported zero records.

**FILES.** NEW `validation/sendgrid/audit/activityRecords.ts` (the pure half, split out);
`validation/sendgrid/audit/providerReadClient.ts`; `validation/sendgrid/audit/reader.ts`.

**HOW.** The client's response type gains `REFUSED_BY_PROVIDER` and `UNREADABLE_RESPONSE`;
only `ANSWERED` may become `EVIDENCE`. The non-evidence members map to `PROVIDER_UNAVAILABLE`,
which `auditProviderReader.ts` already documents as exactly "reached and refused, or not reached
at all" — the NARROWEST EXISTING member, so no wire extension was made. The scope probe keeps
its raw status through its own client.

**DISCRIMINATING TEST.** CONTROL 10, and — in the full composition —
`tests/sendgrid/scenario-driver.test.ts`, where a 403 leaves a row with PERFECT local state
UNRESOLVED rather than passing or failing it.

---

## 10 — the oracle can detect a delayed duplicate

**DEFECT.** The loop returned on the first sighting; its own comment admitted a later second
message would not be seen.

**FILES.** `validation/sendgrid/harness/observation.ts` (rewritten).

**HOW.** DISCOVERY then STABILISATION: after the first sighting the loop requires
`MIN_STABILISATION_OBSERVATIONS` (two, an S1P fixture decision) FURTHER SUCCESSFUL observations,
accumulating distinct provider message ids. A failed read discharges none. An incomplete window
is `STABILISATION_UNRESOLVED` with `providerAcceptedCount: null`; the ids seen are still carried
as a lower bound.

**DISCRIMINATING TEST.** CONTROL 11 — the same delayed-duplicate provider script: the unsafe
loop reports ONE after one read, the corrected loop reports TWO. Plus the stabilisation-loss
case in `tests/sendgrid/observation.test.ts`.

---

## 11 — the six-scenario driver

**DEFECT.** Not implemented. The CLI printed "NOT IMPLEMENTED".

**FILES.** NEW `validation/sendgrid/harness/scenarioDriver.ts`, `validationAuthority.ts`;
NEW `tests/sendgrid-doubles/` (simulated account, adapter, kill-point adapter, reader, two
secret-source re-exports); NEW `tests/support/s1pScenarioFixture.ts`;
`tests/support/outboxFixture.ts` (fixture enumeration for `email.send`).

**HOW.** The driver constructs an `AdapterRuntimeDescriptor` and an `AuditReaderDescriptor` and
takes the launchers as PORTS; it imports neither provider client and neither adapter module.
Every scenario traverses the isolated seeder, step R's reservation, the durable outbox,
`dispatchAuthorisedEffect`, a forked S1N runtime, a forked S1O reader, and a recovery through the
same gateway. Points 1/2/4/5 are `DispatchHooks` members; point 3 is a DIFFERENT ADAPTER MODULE
SPECIFIER; point 6 is DERIVED from the re-entries at 2–5, as the accepted mock matrix does it.

**DISCRIMINATING TEST.** `tests/sendgrid/scenario-driver.test.ts` runs all six offline against a
file-backed simulated account shared by two isolated child processes, and judges every row on
the PROVIDER's count as well as local state.

**FINDING RECORDED RATHER THAN HIDDEN.** Point 3 commits ONE `OUTCOME_UNKNOWN` row in the
separate-process composition where the mock matrix commits none — S1P-C5.

---

## 12 — capability probes are orchestrated

**FILES.** `probeRuntime.ts`, `probeClient.ts`, `scopeProbes.ts`.

**HOW.** Three probe roles, each in its own one-shot process holding one credential. A
provider-unreachable probe is `PROVIDER_UNREACHABLE` and a probe that could not run is
`NOT_RUN`; neither is a pass.

---

## 13 — the duplicate negative control

**FILES.** `scopeProbes.ts` (`sendToProviderSendGridDuplicateProbe`), `probeEnvironment.ts`,
`probeRuntime.ts`.

**HOW.** Exactly TWO calls, written twice rather than looped, behind `§11`'s SECOND
acknowledgement, on the INTEGRATION plane only, to an owner-controlled sink that is refused if
it lacks the marker, under a dedicated correlation. It is a role of the one-shot probe runtime —
not an adapter method and not an IPC operation.

**DISCRIMINATING TEST.** The offline half in `tests/sendgrid/scenario-driver.test.ts`: the SAME
`observeCorrelation` oracle that reported ONE for a scenario reports `>= 2` once a second
delayed message exists.

---

## 14 — `I20`

**FILES.** NEW `validation/sendgrid/harness/i20.ts`; the driver's `reservationUnitsFor` port.

**HOW.** Numerator: the PROVIDER's distinct accepted message ids. Denominator: the sum of
committed `reservation_window_instance.irrecoverable_units` — the immutable historical basis,
never `reserved_irrecoverable`. ONE unmeasured scenario makes the whole comparison UNRESOLVED
with a `null` numerator.

**DISCRIMINATING TEST.** `tests/sendgrid/i20-and-authority-boundary.test.ts`, and the real
comparison over the six-scenario run: 4 accepted against a basis of 5.

---

## 15 — `I8`

**FILES.** NEW `validation/sendgrid/harness/inverseSweep.ts`.

**HOW.** The authoritative definition was located and quoted (`24 §3` K11). The sweep reads
PERIOD-BOUNDED with `correlationTag: null` through the independent audit reader; a record with an
unaccounted tag OR NO tag at all is unaccounted; a failed read concludes nothing.
`observeCorrelation` is explicitly NOT this, and the module says so.

**STATUS: `I8` IS UNCHANGED.** No live evidence exists, so the empirical leg remains open.

---

## 16 — release handling

See `docs/implementation/S1P-release-candidate.md`. **No owner signature was created and no
ceremony was performed.** Class-5 SendGrid records do not exist and a real-provider release
necessarily remains pending provisioning.

---

## 17 — method/action discrimination

**DEFECT.** The adapter ignored `invocation.method` and `invocation.actionClass`.

**HOW.** Three comparisons before the boundary mark — action class, method, recoverability — and
the payload must AGREE with them too. Stage 1 additionally refuses a run whose signed class-3
record does not name this adapter and this method.

**DISCRIMINATING TEST.** `tests/sendgrid/request-mapping.test.ts` — wrong method, wrong adapter,
wrong authorisation, each with its own named refusal.

---

## 18 — the good parts, preserved

Fixed origin and path; no arbitrary URL; no HTTP passthrough; sandbox hard-refused; the boundary
marked before the call; no send retry; 5xx/429 UNKNOWN; no `NOT_SENT_CONFIRMED` from unmeasured
status semantics; an independent read-only audit reader; PRODUCTION perimeter treatment for the
real clients; evidence secret-shape refusal; bounded polling; `I17b` open; the production
ceremony unperformed. `tests/sendgrid/provider-boundary.test.ts` and the perimeter scan both pass
unchanged.

---

# SECOND INDEPENDENT REVIEW — the four remaining blockers

The second reviewer inspected the complete diff rather than the completion report, accepted the
corrected architecture above, and rejected four things. Each is recorded here the way the first
round's twenty are: the defect, the fix, and the test that fails without it.

---

## B1 — the live validation entry point was not wired to the scenario driver

**DEFECT.** `scenarioDriver.ts` was complete and exercised, and **nothing could call it**.
`cli.ts` passed `controlPlaneCompositionAvailable: false` as a LITERAL, wrote a bundle saying
nothing ran, and returned. The six-scenario matrix was unreachable code, and the preflight fact
was an assertion rather than a measurement.

**HOW.**

* `validation/sendgrid/harness/liveComposition.ts` — a validation-only live composition root.
  `openLiveComposition` builds the control plane from the PRODUCTION constructors
  (`EntityLeaseManager`, `EffectEnumerator`, `verifiedConstructorVersionResolver`,
  `Ed25519DecisionSigner`, `PolicyEngine`, `DispatchLeaseManager`,
  `createAdapterRuntimeRegistry`, `createAuditReaderRegistry`) and hands back the
  `ScenarioRuntimeConfig` and `ScenarioPorts` the driver takes. It imports NEITHER plane's
  secret source; it passes locators to registries that fork runtimes.
* `describeLiveComposition` MEASURES availability against ten named blocks — an environment
  variable, files on disk, the VERIFIED catalogue's own entries, and the PRODUCTION constructor
  registry's own membership. `establishStage1Facts` calls it, and
  `controlPlaneCompositionAvailable` is derived from the answer.
* `main` now runs the live sequence: probe findings block the matrix FIRST, composition
  availability blocks it second, then `runAllScenarios`, then `compareI20`, then the `I8`
  inverse sweep through the independent reader, then `§11`'s duplicate control behind its own
  acknowledgement. The evidence bundle and the exit code are derived from what happened.

**WHAT THE MEASUREMENT SAYS TODAY, AND IT IS A LONG "NO".** The block no repository work can
remove is `EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED`: `src/kernel/canonicalisation/constructors/`
holds exactly one constructor, `refundCreate`, and the validation action class has none. The
production `EffectEnumerator` cannot enumerate it and `25 §14.1`'s dispatch revalidation cannot
re-enumerate it. Supplying one is a class-19 artifact and an owner ceremony, which this
correction is forbidden to perform. The offline fixture registers a TEST-ONLY stub for the
class — which is precisely why the offline matrix runs, and precisely why running it proves
machinery rather than provider behaviour.

**DISCRIMINATING TEST.** `tests/sendgrid/cli-orchestration.test.ts`. Every case calls `main`.
The review's own instruction — "Do not satisfy this by testing `scenarioDriver.ts` separately
again" — is met by making the orchestration the subject: three substitutions (composition,
credential-probe launcher, verified bundle), each named in the suite header with why it is
unavoidable offline, and nothing between them substituted. One case drives the default path
with no seams at all and asserts the shipped `describeLiveComposition` measures UNAVAILABLE
with named blocks; another asserts a `SYNTHETIC_TEST_IDENTITY` provenance still refuses at
stage 2, so the probe stub cannot have walked past the material-binding gate.

### Two real defects that only existed because the path was unreachable

**`renderEvidenceBundle` threw on every bundle carrying a real `I20` comparison.**
`irrecoverable_units` is carried as a `bigint` so an exposure figure never passes through a
float, and `JSON.stringify` has no representation for one. Nothing had noticed, because `i20`
was `null` on every run the CLI could produce. Fixed with a replacer that emits a DECIMAL
STRING — not a `number`, because `Number(...)` on a large exposure figure is silently wrong.

**The inverse sweep would have reported `I8` VIOLATED on every account it ever swept.**
`normaliseActivityRecords` echoed a correlation tag only when the provider's own `categories`
carried the EXPECTED one — the guard that stops a narrowed read being a self-fulfilling match.
The expression short-circuited on `expectedCorrelationTag !== null`, so a SWEEP, which by
definition supplies no tag, received `correlationTag: null` for every record, and
`runInverseSweep` reads `null` as UNACCOUNTED. Every message in the account — including the
ones ACOS had just sent and tagged itself — would have been reported as a control violation.
Fixed: with no expected tag the record reports the ACOS correlation tag the provider actually
carried, selected by the KERNEL'S OWN `isCorrelationTag` recogniser; a record carrying none
still reports `null`, and a record carrying two reports `null` rather than resolving an
ambiguous attribution by array order. Four named cases in
`tests/sendgrid/provider-response-integrity.test.ts`, including the non-vacuous inverse.

---

## B2 — a malformed 2xx Email Activity response was treated as evidence

**DEFECT.** The normaliser DROPPED an unreadable record and returned the rest. A provider
answer carrying a real duplicate — one readable record, one malformed — produced a count of
ONE, which is exactly what a correctly non-duplicated send produces. The oracle would have
certified the condition `I36` exists to exclude.

**HOW.** `normaliseActivityRecords` returns a discriminated `VALID` / `MALFORMED` result with a
named reason and the number of entries read before the defect. The FIRST unreadable entry fails
the WHOLE query; nothing is dropped. `providerReadClient` maps `MALFORMED` to
`UNREADABLE_RESPONSE`, which `toProviderReadResult` maps to `PROVIDER_UNAVAILABLE` — so a
malformed 2xx is non-evidence, never a count. `categories` remains OPTIONAL: requiring it would
turn every third-party message in the account into an unreadable query instead of the `I8`
finding it is.

**DISCRIMINATING TEST.** `tests/sendgrid/provider-response-integrity.test.ts` — `§2.4`'s five
controls, ending with the one that matters: two genuinely accepted messages, one returned with
an unusable `msg_id`, driven end to end through the real observation loop. The count is
withheld entirely; the assertion `expect(result.providerAcceptedCount).not.toBe(1)` is the one
the rejected behaviour fails. A companion case proves the loop can still count to two when both
records are readable.

---

## B3 — `I8` claimed a complete inverse sweep over a truncated result

**DEFECT.** The sweep concluded cleanly from "no unaccounted record found" over whatever the
provider happened to return.

**HOW.** `validation/sendgrid/audit/activityCompleteness.ts` records what the ACCEPTED S1O
capability record actually documents: the Email Activity endpoints, eleven filter fields and a
6-requests-per-minute rate limit — and **no** completeness mechanism, **no** cursor and **no**
closed-period semantics. So `SENDGRID_ACTIVITY_COMPLETENESS` is `UNESTABLISHED`. (The header
notes that the "300 entries per page" figure in circulation is Mailgun's, not SendGrid's.)
`runInverseSweep` returns a clean `ALL_PROVIDER_RECORDS_ACCOUNTED` only over a page the provider
SIGNALLED complete; otherwise `SWEEP_INCOMPLETE`, with a named stop reason. **Positive findings
survive any completeness state** — an unaccounted record is one whether or not the rest of the
result was readable — and that asymmetry is the same one the `I36` verdict rule keeps.

**DISCRIMINATING TESTS.** `tests/sendgrid/inverse-sweep.test.ts`, sixteen cases across both
branches, and the end-to-end assertion in `cli-orchestration.test.ts` that the CLI's own `I8`
conclusion says NOT DISCHARGED and never "DISCHARGED FOR THE SWEPT PERIOD".

---

## B4 — two successful polls were treated as a live `I36` finality guarantee

**DEFECT.** `MIN_STABILISATION_OBSERVATIONS = 2` is an S1P FIXTURE decision (S1P-C4). It was
the SOLE condition turning a real provider count into a live no-duplicate conclusion — roughly
twenty seconds of quiet at the published rate, against an endpoint with no documented reporting
lag. A duplicate arriving in the twenty-first second would have met a verdict already `PASS`.

**HOW.**

* `validation/sendgrid/harness/visibilityBound.ts` — three regimes.
  `FIXTURE_DETERMINISTIC` (the simulated account is a file this process owns, so absence is
  determinate), `MEASURED_INTERVAL` (an evidence-backed interval whose `basis` must name the
  accepted source), and `UNESTABLISHED`. `SENDGRID_LIVE_VISIBILITY_BOUND` is `UNESTABLISHED`,
  because no accepted source supplies a lag guarantee and no empirical measurement exists.
  `§4.1` forbids inventing one, and its own instruction for this state is that the live count
  may be observed while a no-duplicate PASS remains UNRESOLVED.
* `observeCorrelation` finishes only when BOTH the owed samples are discharged AND the settling
  interval has elapsed, and reports `settlingIntervalCompleted` either way.
* `§4.2`'s placement: the final observation's interval runs from the RECOVERY — the last
  possible write, and the very action the row exists to test — not from the loop's start.
* `verdictFor` withholds a no-duplicate PASS unless the absence is settled. An EXCESS is still
  a FAIL with no bound at all: seeing a second message needs no guarantee.
* `assertLiveUsable` refuses a live run handed the offline fixture bound, and
  `observationModeLabel` writes the regime into the evidence bundle
  (`observationMode`, `visibilityBoundKind`) so a reviewer cannot mistake a deterministic
  simulation for a provider guarantee.

**DISCRIMINATING TESTS.** `tests/sendgrid/live-finality.test.ts`, thirteen cases covering
`§4.4`'s four: a duplicate appearing after two stable polls but before the bound closes counts
TWO; an unestablished bound reports the count and still yields UNRESOLVED; a provider failure
during the final interval yields UNRESOLVED with the count withheld; the fixture mode settles
and is LABELLED offline. Two further cases assert the shipped SendGrid bound is still
`UNESTABLISHED` and that samples alone can no longer settle a live absence.

---

## What the second round did NOT touch

`§5`'s preservation list, verbatim from the reviewer, is intact: the honest `email.send` action
class and its class-3 record; the payload-bound provider request; the material-bound credential
sources; the two-stage preflight and the credential process isolation; exact credential
selection; the explicit non-production declaration; run-state-derived evidence; failed-read
handling; the stabilisation oracle; the six-scenario driver; the capability probes; `I20`; the
release handling; method/action discrimination. Where a signature changed — `ObservationBound`,
`ObservationResult`, `ScenarioPorts`, `EvidenceBundle`, `establishStage1Facts`, `main` — it
gained members and seams; no rule was relaxed.

---

# THIRD INDEPENDENT REVIEW — the last repository-side blocker

The reviewer accepted the second round's live CLI orchestration, malformed-2xx handling, `I8`
completeness, `I36` visibility/finality, payload authority, credential posture, capability
probes, duplicate control and `I20` machinery, and named ONE remaining blocker.

## The defect

**THE LIVE `email.send` ENUMERATION CONSTRUCTOR DID NOT EXIST.** The live composition built
its registry from `refundCreateConstructor` alone, so `describeLiveComposition` reported
`EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED` on every run and `S1PValidationAuthority`'s `enumerate`
port was an unconditional `throw`.

The second round had recorded that as an owner-ceremony prerequisite. **It was not one.** The
reviewer's statement is exact: *an owner-signed `ConstructorVersionRecord` cannot implement
missing TypeScript code.* Had every external artifact been provisioned and legitimately signed,
the live path would still have been impossible, because a piece of the repository was absent.

## The fix

### `validation/sendgrid/harness/validationEmailConstructor.ts` (new)

The smallest constructor that lets the REAL `EffectEnumerator` enumerate the validation class.

* deterministic — no clock, no random, no model input, no credential, no network;
* ONE option per resolvable validation resource, so the initial enumeration and the `25 §14.1`
  re-enumeration produce the same `option_id` for unchanged state;
* the option describes NOTHING: `optionDescriptionFields` returns an empty candidate set, so
  no sink, subject or body can ride an option description past the `I52` projection;
* `construct` THROWS. `25 §14.1` is explicit that revalidation "constructs no payload" and
  that "the persisted payload remains the exact authorised payload". The closed four-field
  validation payload is `S1PValidationAuthority`'s, and giving a reviewer two payloads to
  choose between would be worse than giving them one and a refusal.

**IT IS NOT A PRODUCTION EMAIL CAPABILITY, AND THE OWNER DIRECTION IS WHY.** It lives under
`validation/`, nothing in `src/` imports it, the only registry that carries it is
`s1pLiveConstructorRegistry()`, there is no customer-recipient path and no general email
option-selection surface. A registered constructor makes a class CANONICALISABLE at `26 §7`
step C2; it grants no authority to execute, and `email.send` remains
`UNGOVERNED_FAILS_CLOSED` with no Cedar permit.

### The state model, and why it is `commerce_order`

A validation class has no business state model. What it needs is a real, MUTABLE,
RECORD-graded row, because `§8` item 7 requires that changed state fail revalidation under the
existing kernel rules — and a resolver that read nothing could never fail. `commerce_order` is
the only resolvable resource row in the schema; `grade` is checked against `24 §2`'s evidence
grades, so a validation resource is made stale by DEMOTING ITS GRADE. One `UPDATE`, no
migration, and the staleness is a real property of authoritative state. The accepted
`tests/support/fixtureEnumerator.ts` resolves the constructor-less classes the same way.

The row carries no customer, order or payment content, and the COMPOSITION materialises it —
not the constructor, whose `resolveResource` is also called at C′ where an insert would be
wrong.

### `§3` — record 13's empty digest field list is CONSISTENT, and no owner decision is required

`50 §2a` record 13 declares `semantic_option_digest_fields: { "email.send": [] }`. Inspecting
the real contract confirms it rather than contradicting it:

`optionDigest.ts`: `option_id = H(action_class ‖ resource_id ‖ semantic_option_digest)`.

The digest is one of THREE preimage components. With an empty field list it is a
domain-separated constant, and `option_id` still separates classes and resources — so two
validation resources still receive distinct option identities, and within one resource there
is exactly one option, so there is nothing to separate. A digest over fields that cannot vary
would add no discrimination.

And sender, sink, subject and body are bound MORE strongly elsewhere: the authority commits
them into the dispatch payload and the authorisation binds `dispatch_payload_hash` over the
canonical bytes — over the exact values, not over a digest of selectable dimensions. Making
them option fields would weaken nothing, add nothing, and create exactly the general email
option-selection surface the owner direction forbids.

The agreement is CHECKED at runtime, in the same shape `constructors/refundCreate.ts` checks
its own: a future class-3 release that declares fields for this class makes the constructor
fail closed rather than mint colliding option ids.

### `§4`, `§5` — the composition

* `PRODUCTION_CONSTRUCTOR_REGISTRY` is renamed `S1P_LIVE_CONSTRUCTOR_REGISTRY` and built from
  `s1pLiveConstructorRegistry()`. The old name would have asserted something false the moment
  a validation-only constructor joined it.
* `describeLiveComposition` measures constructor presence from that real registry, through the
  same `ConstructorRegistry.get` lookup `26 §7` step C2 performs, so the probe and the kernel
  cannot disagree. The block stays in the closed set and still blocks a misconfigured tree;
  the checked-in tree clears it.
* the throwing `enumerate` port is replaced by one that calls the REAL `EffectEnumerator` under
  the entity lease and returns the `enumerationId` and `optionId` IT generated. Neither value
  is synthesised and neither is copied from a fixture. The SAME enumerator instance is handed
  to `dispatchEnvironmentFor`, so dispatch-time revalidation is literally the same machinery.

## `§9` — the external-prerequisite list, reassessed

`class-19 effect constructor implementation` is **no longer** a prerequisite: it is checked-in
code. What remains is signatures, credentials, deployment materials and provider measurements —
and `tests/sendgrid/validation-email-constructor.test.ts` asserts that by enumerating the
blocks a bare composition reports and failing if any of them is a repository-implementation
term.

## `§11`'s acceptance test, answered

*If the owner provisioned and legitimately signed every required external artifact tomorrow,
would this exact source tree run S1P live without another code edit?*

**YES**, and the suite runs the measurement half of it: supplying a control database URL, a
constructor-records locator and a decision-key locator — three externals, no source change —
makes `describeLiveComposition` report AVAILABLE with an empty block list.
