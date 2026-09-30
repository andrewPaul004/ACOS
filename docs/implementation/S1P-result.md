# S1P — result (after the independent-review corrections)

**Twilio SendGrid non-production provider validation.**
Baseline `d897833` (S1O, corrected in place). Branch
`feature/s1o-provider-selection-audit-boundary`.
**Operating Spine v1.3, package issue v1.3.7 — UNCHANGED by this slice. There is no v1.3.8,
`docs/architecture/` is byte-identical, and its 108-condition verification is unchanged at
108 PASS / 0 FAIL with all 77 mutation seeds still discriminating.**

---

## 0. THE SENTENCES THAT MATTER MOST, AND THEY ARE NOT BURIED

> ## NO REAL SENDGRID PROVIDER VALIDATION WAS PERFORMED.
>
> No SendGrid account exists. No credential was provisioned. **No provider request of any kind
> was made, from any machine, at any point in this slice.**

> ## NO PRODUCTION OWNER CEREMONY WAS PERFORMED AND NO OWNER SIGNATURE WAS CREATED.

> ## `I36`'s VERIFICATION LEG, `I20`'s PROVIDER SIDE AND `I8`'s EMPIRICAL LEG ALL REMAIN OPEN.

**S1P IS NOT ACCEPTED AND NOT COMPLETE.** Acceptance belongs to the independent reviewer.

---

## 1. Classification

> # S1P IMPLEMENTATION COMPLETE — PROVIDER VALIDATION PARTIAL

`§21` permits this classification **only if** all repository-side machinery is genuinely
present and all offline verification is green. Each item, with where it lives:

| `§21` item | State | Where |
| --- | --- | --- |
| honest `email.send` authority representation for validation | **present** | `artifacts/control/class-03.action-catalogue.json`, `actionClasses.ts` |
| payload binding | **present** | `validationPayload.ts`, `requestMapping.ts`, `adapter.ts`, `validationAuthority.ts` |
| real material-bound credential-source contract | **present** (mechanisms declared; the two BINDING ones honestly UNPROVISIONED) | both `secretSource.ts` |
| two-stage preflight | **present** | `preflight.ts`, `cli.ts` |
| credential process isolation | **present** | `probeEnvironment.ts`, `probeRuntime.ts`, `probeMain.ts`, `probeClient.ts` |
| exact credential selection | **present** | `deploymentConfig.ts`, `cli.ts`, `preflight.ts` |
| capability-probe orchestration | **present** | `probeClient.ts`, `probeRuntime.ts`, `scopeProbes.ts` |
| executable six-scenario driver | **present, and EXERCISED OFFLINE END TO END** | `scenarioDriver.ts`, `tests/sendgrid/scenario-driver.test.ts` |
| duplicate negative control | **present**, opt-in, discriminated offline | `scopeProbes.ts`, `probeRuntime.ts`, `scenario-driver.test.ts` |
| stable provider-count oracle | **present** | `observation.ts` |
| `I20` local comparison machinery | **present and proved offline** | `i20.ts` |
| evidence correctness | **present** | `evidence.ts` |

**The provider half is PARTIAL because no account exists** — and, more specifically, because no
credential-binding mechanism has been selected, which is the thing stage 2 needs (S1P-C6).

`§21`: "Do not use 'implementation complete' merely because provider credentials are missing."
The claim here is the narrower one: the repository-side machinery is present and green, and
the provider-side validation has not happened.

---

## 2. What the independent review rejected, and what changed

The reviewer found nine substantive defects. Each is corrected, and each correction is
discriminated by a test that FAILS against the rejected implementation —
`tests/negative-controls/sendgrid-review-controls.test.ts` holds the rejected implementations
verbatim in shape.

| Defect | One-line correction |
| --- | --- |
| the send was disguised as another action class | `email.send`, IRRECOVERABLE, one MIE unit, signed into class 3 |
| the adapter verified the payload hash and then ignored the bytes | a CLOSED four-field schema, decoded from the authorised bytes; the mapping has no configured address to follow |
| a JSON label was treated as a material binding | provenance is assigned by the MECHANISM; the binding mechanisms are UNPROVISIONED and refuse |
| a nonexistent `§8.7` read-back probe was cited as proof | retracted in the file; the live path stays blocked |
| both credentials were resolved before any gate ran | two stages; stage 1 touches nothing |
| one operator process held both vendor credentials | one-shot children, one locator slot each; the coordinator's closure reaches neither source |
| the credential was found by scanning for "the last matching adapter" | the configured identity is the key, and the same key is what stage 2 compares |
| "non-production" was inferred from a parseable document | an explicit operator sentence naming all three claims |
| a constant claimed a live environment had been used | the statement is derived from run state |
| a refused read became a count of zero | only a successful, parsed answer may become `EVIDENCE` |
| the oracle stopped at the first sighting | discovery + stabilisation, with `null` rather than an untrustworthy count |
| the scenario driver was deferred | written, and executed offline through the accepted path |

---

## 3. The chain correction 2 closes, end to end

```
  the isolated S1P validation seeder
     writes sender / sink / subject / body into the CANONICAL dispatch payload
  -> commitLocalAuthorisation binds dispatch_payload_hash to authorisation_ref
  -> the outbox carries the payload BYTES verbatim (25 §7)
  -> the integration host re-hashes them against the authorisation
  -> the adapter PARSES THOSE BYTES and sends exactly what they say
```

**No launch document appears anywhere in that chain.**

| SendGrid field | Class |
| --- | --- |
| `personalizations[0].to[0].email`, `from.email`, `subject`, `content[0].value` | **payload-bound semantic fields** — committed by `dispatch_payload_hash` |
| `categories`, `custom_args` | **kernel correlation metadata** — `25 §7`'s tag, minted at enqueue, altering no business or recipient semantics |
| `mail_settings.sandbox_mode.enable` | **fixed adapter safety field** — the literal `false`; no authority may turn it on |
| the `Authorization` header, the origin, the path | **credential and transport** — resolved per invocation by the runtime's own source; module constants |

---

## 4. Credential identity — the exact state

**There is no real material-bound live source, and the live preflight therefore cannot pass.**

| Mechanism | Provenance it may assign | State |
| --- | --- | --- |
| `FILE_FIXTURE` | `SYNTHETIC_TEST_IDENTITY` | implemented. Live preflight **FAILS CLOSED** on it |
| `SECRET_MANAGER_VERSION` | `DEPLOYMENT_SECRET_VERSION` | declared, **UNPROVISIONED** — resolves nothing |
| `PROVIDER_KEY_ID_BINDING` | `PROVIDER_KEY_ID` | declared, **UNPROVISIONED** — resolves nothing |

A file-backed document is not a binding, whatever it claims about itself, and `§3.2` prefers
that answer to a fake one.

---

## 5. Process isolation

| Process | May hold |
| --- | --- |
| the validation COORDINATOR | **NEITHER credential.** Its import closure contains neither secret source and neither provider client |
| an INTEGRATION runtime / one-shot integration probe | the SEND credential only |
| an AUDIT runtime / one-shot audit probe | the AUDIT credential only |

`buildProbeEnvironment` has ONE locator slot and ONE source-module slot, so no arrangement of
arguments puts two credentials in one process — and the CHILD reports its own environment keys,
which is the only evidence that is not the parent's account of what it passed.

---

## 6. The provider oracle

| Phase | Behaviour |
| --- | --- |
| DISCOVERY | poll until the correlation first becomes visible, or the bound expires |
| STABILISATION | after the first sighting, require **two** FURTHER SUCCESSFUL observations, accumulating DISTINCT provider message ids |
| counting | distinct provider message ids the PROVIDER echoed the tag on. Never a local invocation count |
| a FAILED read | discharges no stabilisation observation and contributes no count |
| an incomplete window | `STABILISATION_UNRESOLVED`, `providerAcceptedCount: null`, ids kept as a LOWER BOUND |
| a delayed duplicate | detected — the same oracle that reports ONE for a scenario reports `>= 2` once a second delayed message exists |

The depth of two is an S1P FIXTURE decision (S1P-C4), clamped so no configuration can restore
stop-on-first.

---

## 7. Invariant status — stated separately, and without rounding

| Invariant | Local leg | Provider leg |
| --- | --- | --- |
| `I36` | **unchanged and already proved** by the accepted mock kill matrix. S1P adds a SECOND local demonstration through the real gateway, real forked runtimes and a simulated transport | **OPEN.** No provider accepted count has ever been measured |
| `I20` | the comparison machinery exists and is proved offline, over the immutable historical reservation basis | **OPEN.** No provider-side numerator exists |
| `I8` | the inverse-sweep machinery exists — period-bounded, not tag-bounded — and is proved offline | **OPEN.** No sweep has been run against a real account. A known-correlation query would not discharge it and the module says so |
| `I17b` | **OPEN, unchanged.** A local evidence digest anchors nothing outside this repository, and `I17B_STATUS` travels inside every bundle |

---

## 8. Verification

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | **clean** |
| `npx eslint . --max-warnings 0` | **clean** |
| `npx vitest run` | **see below** |
| `npm run verify:perimeter` | **PASS** — 16 production call sites, 0 unannotated |
| `npm run prelive:verify` | `NOT_READY` — `TRUST_CONFIG_MISSING` on both planes, **unchanged by S1P** (this environment has no owner root key, and did not before the slice either) |
| `consistency-v1.3.py` | **108 PASS / 0 FAIL**, unchanged |
| all 77 mutation seeds | **77/77 still discriminate** |
| `git diff --check` | **clean** |

Full-suite totals are recorded in `docs/implementation/evidence/S1P-offline-runs.md` §4 and in
the final report accompanying this slice.

---

## 9. What is still owed, and by whom

| Item | Owner |
| --- | --- |
| a dedicated non-production SendGrid account, two scoped keys, a verified sender, an owner sink, the Email Activity entitlement | operator |
| ~~selecting and building a credential-binding mechanism~~ | **DONE.** The owner selected Azure Key Vault immutable secret VERSION binding, and both planes implement it — `validation/sendgrid/{integration,audit}/keyVault.ts`. What remains is the Azure resources and the two secret versions, which are provisioning |
| two signed class-5 records carrying the REAL material-bound identities | owner ceremony, after the above |
| the control-artifact release ceremony over the new class-3 bytes | owner |
| an owner-signed `ConstructorVersionRecord` for the S1P validation constructor | owner ceremony. **The CONSTRUCTOR ITSELF IS NO LONGER OWED** — `validation/sendgrid/harness/validationEmailConstructor.ts` is checked-in code and the class-19 candidate bytes declare its tuple. What is owed is the SIGNATURE `50 §3i` admission checks the record against |
| a control-plane database, and the kernel's decision signing key | deployment. The live composition root exists (`validation/sendgrid/harness/liveComposition.ts`) and names each absence as a measured block rather than assuming one |
| `I36` / `I20` / `I8` provider legs | the live run, once the above exist |

**Nothing on that list was faked, simulated, or reported as done.**

---

## 10. After the SECOND independent review

The reviewer accepted the corrected architecture and named four remaining blockers. All four
are implemented; `docs/implementation/S1P-implementation-log.md` records each with its
discriminating test.

**The classification does not change.** `S1P IMPLEMENTATION COMPLETE — PROVIDER VALIDATION
PARTIAL`. The repository-side work is done and independently reviewable; no real SendGrid call
has been made, no credential has been provisioned, and no owner ceremony has been performed.

What changed in the honesty of the claim:

* the CLI can now EXECUTE the scenario matrix, and a test whose subject is the CLI's own
  orchestration drives all six canonical rows through `main`;
* composition availability is MEASURED against ten named blocks rather than asserted, and the
  measurement on this repository is a specific "no", and after the third round every block
  it names is a signature, a credential or a deployment material rather than missing code;
* a malformed 2xx provider answer is non-evidence, so a malformed duplicate can no longer
  produce the same count as a non-duplicated send;
* `I8` reports its own sweep as INCOMPLETE, because the accepted SendGrid research establishes
  no completeness mechanism;
* a live no-duplicate PASS now requires an evidence-backed visibility bound, and SendGrid has
  none — so that conclusion is `UNRESOLVED` and says why.

Wiring the entry point also surfaced two defects that could not exist while the path was
unreachable: the evidence renderer threw on any bundle carrying a real `I20` comparison, and
the inverse sweep would have reported `I8` VIOLATED on every account it swept, including for
messages ACOS had itself sent and tagged. Both are fixed with named regression tests.

---

## 11. After the THIRD independent review

The reviewer accepted the second round's corrections and named ONE remaining repository-side
blocker: **the live `email.send` enumeration constructor did not exist.** That was recorded
here as an owner-ceremony prerequisite, and it was not one — an owner-signed
`ConstructorVersionRecord` cannot implement missing TypeScript code.

`validation/sendgrid/harness/validationEmailConstructor.ts` is that code.
`docs/implementation/S1P-implementation-log.md` records the design and every discriminating
test; `docs/implementation/S1P-release-candidate.md` §6 records the class-19 CANDIDATE state.

### `§9` — what is no longer an external prerequisite

`class-19 effect constructor implementation` is struck from the list. It is source code, and
it is checked in.

### `§11`'s acceptance test

*If the owner provisioned and legitimately signed every required external artifact tomorrow,
would this exact source tree run S1P live without another code edit?*

**YES.** `tests/sendgrid/validation-email-constructor.test.ts` runs the measurement half:
supplying a control-database URL, a constructor-records locator and a decision-key locator —
three externals, no source change — makes `describeLiveComposition` report AVAILABLE with an
empty block list. Every block a bare composition reports is asserted, individually, to be an
external prerequisite; a future block that is repository implementation fails that test.

### What is still owed, and it is all external

An owner-signed `ConstructorVersionRecord` admitted against the class-19 candidate; the
class-19, class-3 and class-5 release ceremonies; a dedicated non-production SendGrid account
with two scoped credentials whose identities are material-bound; the Email Activity
entitlement; a control-plane database and a `company` row for the configured environment; a
provisioned decision signing key; and an empirical provider visibility/completeness
measurement, without which a live no-duplicate conclusion stays `UNRESOLVED`.

`50 §3i`'s class-19 key-migration obligation also remains open. This slice does not close it
and does not claim to.

---

## 12. The Azure Key Vault credential binding

The owner decision that closed `50 §2g` field 1 is recorded in full in
`docs/implementation/S1P-operator-procedure.md`. In summary: SendGrid material lives in an
Azure Key Vault secret, ACOS fetches an **exact version and never `latest`**, and the signed
class-5 `credential_id` is the full versioned secret id Key Vault returns for that exact
material.

`SECRET_MANAGER_VERSION` is therefore **no longer UNPROVISIONED**. Both sources implement it
independently — the two packages share no module, by owner direction — and each resolves
through its own managed identity, its own vault and its own secret version.
`PROVIDER_KEY_ID_BINDING` remains declared and unprovisioned, and still refuses.

### What the mechanism establishes, and what it does not

It establishes that the identity a runtime presents is the identity of the EXACT bytes Key
Vault returned, in one response. It does **not** establish that the SendGrid key behind those
bytes has the scope its class-5 record claims — that is the capability probes' job, and they
are unchanged.

### The class-5 records are still absent, deliberately

`artifacts/control/class-05.credential-scopes.json` carries no SendGrid records and no
placeholder Key Vault ids. Real full versioned ids do not exist until the secrets are
provisioned, and a fabricated one would make the candidate look more complete while making the
authority false.

### Rotation

A signed class-5 record names one exact versioned secret id. Creating a new Key Vault version
produces a new id, so repointing the locator alone makes the returned identity disagree with
the signed one and the accepted host refuses **before SendGrid**. Authority follows the owner's
signature, never the vault.
