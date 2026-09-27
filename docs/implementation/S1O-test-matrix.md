# S1O — test matrix

Every obligation the mandate states, and the assertion that discharges it. **An obligation
with no row is an obligation nobody tested.**

**`§0` — THE OWNER CORRECTION'S OWN OBLIGATIONS ARE IN `§12` AND `§13`.** They are listed last
because they were added last, not because they matter least: `§12` is the credential-identity
binding, which is the defect the owner review found, and `§13` is the SendGrid sandbox
correction and the test-path/evidence compatibility rule.

---

## 1. `§1`–`§7` — the credential-risk definition and its signed authority

| Obligation | Assertion | File |
|---|---|---|
| The class is closed at three values, no fourth | `CREDENTIAL_RISK_CLASSES` equality; eight rejected values including `UNKNOWN` | `controlArtifacts/credential-risk.test.ts` |
| The nine clauses are transcribed and none is a matcher | length 9; the module contains no `RegExp`, `.test(` or `.match(` | same |
| The module does not merge credential risk with action authority | no import line at all in `credentialRisk.ts` | same |
| Maximum privilege decides a mixed envelope | `highestRiskOf` over four combinations | same |
| An empty set has no highest member | `highestRiskOf([])` is `null`, not `READ_ONLY` | same |
| A self-inconsistent declaration is refused | six inconsistency shapes, each with its own reason | same |
| The parser refuses rather than corrects | unknown field, missing field, out-of-set value, empty permission list, self-inconsistency, duplicate id, unsorted permissions, unsorted records | same |
| An empty credential list is legal | a deployment with no vendor credential parses | same |
| Class 5 is the seventh pre-live required artifact | `REQUIRED_PRE_LIVE_ARTIFACTS` length 7; boundary `50 §2g` | same |
| The deployed bytes are what the verified bundle carries | ids and version equal | same |
| The class is reachable only through a sealed bundle | a forged object raises `NO_ACTIVE_VERIFIED_BUNDLE` | same |
| Class 5 is a dual-signed manifest member | `[2, 3, 5, 19, 20, 24, 27]`; `YES/YES/YES` in `50 §6` | `class-authority.test.ts`, `release/ceremony.test.ts`, gate **L11** |

---

## 2. `§8`, `§9` — the required attack, and its converse

| Obligation | Assertion | File |
|---|---|---|
| `§8` — a credential authorising `email.send` AND `payment.refund` is `MONEY_MOVING` where ACOS intends only the send | `synthetic_esp.mixed_send`: both permissions present, `payment.refund` monetary, class `MONEY_MOVING` | `credential-risk.test.ts` |
| `§8` — the unsafe reading and production DISCRIMINATE | unsafe answers `NON_MONETARY_WRITE` on the intended permission; production refuses `OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL` | `credential-risk-controls.test.ts` CONTROL 2 |
| `§9` — a monetary ACTION does not make a credential monetary | `mock_ads.pause_only` is `NON_MONETARY_WRITE` although `mock_ads` serves `campaign.budget.set`; the registry admits it | `credential-risk.test.ts`, `integration-controls.test.ts` |
| `§9` — one adapter, two credentials, two answers | `pause_only` admitted, `budget_manage` refused, same adapter and same catalogue | `integration-controls.test.ts` |

---

## 3. `§10`–`§12` — the trigger, and S1N's correction

| Obligation | Assertion | File |
|---|---|---|
| `READ_ONLY` → option A eligible | the audit credential is `READ_ONLY` and its reader is admitted | `audit-read-boundary.test.ts` |
| `NON_MONETARY_WRITE` → eligible subject to adapter count | adapters A and B admitted together | `integration-controls.test.ts` CONTROL 12 |
| `MONEY_MOVING` → option A refused | `OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL` on ONE adapter | CONTROL 13 |
| Mixed capability → `MONEY_MOVING` | as `§8` above | CONTROL 2 |
| Missing classification → refused | `CREDENTIAL_NOT_DECLARED`, in both registries | CONTROL 3, `audit-read-boundary.test.ts` |
| Third adapter → refused regardless of credential risk | three NON-money credentials still refuse `OPTION_B_TRIGGER_ADAPTER_COUNT` | CONTROL 12 |
| S1N's field-4 derivation is REPLACED | `derivedCredentialClass` and `movesValueUnderBroadReading` no longer exist; `declaredCredentialRiskClass` is a lookup | `credential-risk-controls.test.ts` CONTROL 1 |
| No architecture widening | class 3 stays at ten-plus-four with no fifteenth entry | gate **L6** |

---

## 4. `§13`–`§17` — the audit provider-read boundary

| Obligation | Assertion | File |
|---|---|---|
| A separate OS process | the reader's PID differs from this process's | `audit-read-boundary.test.ts` |
| A separate credential source | the source type is keyed by PROVIDER and exports a different factory | `auditSecretSource.ts`, `audit-provider-controls.test.ts` CONTROL 6 |
| A separate environment allowlist | eight keys; equality against allowlist ∪ platform; disjointness from the integration plane computed | `audit-read-boundary.test.ts` |
| No control send credential | every integration key absent by name from the reader's own reported environment | same |
| No write capability | fourteen mutation members refused; any member outside the declared three refused | `audit-read-protocol.test.ts`, CONTROL 7 |
| No reliance on a control adapter result | `deriveIndependentFinding` has two parameters and no control operand | CONTROL 8 |
| The audit plane does not import the control trust chain | no `src/audit/` module imports it; the registry is fed by the audit plane's OWN verification | `audit-plane.test.ts`, `auditProviderFixture.ts` |
| The audit reader package imports no integration module | scan over `src/audit/provider/` | `audit-read-boundary.test.ts` |
| Closed read-only IPC, no generic URL | ten request fields asserted against a second copy; fourteen forbidden names absent; no `new URL` anywhere | `audit-read-protocol.test.ts` |
| Unknown operation REFUSED | `UNKNOWN_OPERATION` on `MAIL_SEND` | same |
| No credential crosses IPC | response fields enumerated; an evidence record with an extra field refused; env KEYS only | same |
| Period-bounded, always | five malformed periods refused; the tag narrows rather than replaces | same |
| The leak matrix: seven surfaces | outcome object, IPC bytes, stderr, stdout empty, env keys, log record, refusal object | `audit-credential-leak-matrix.test.ts` |
| The matrix is not vacuous | the sentinel IS found in its own source file | same |
| **The sibling send process cannot read it** | two live processes, two sentinels, disjoint ACOS env keys, neither stderr carries either | same |

---

## 5. `§18`–`§26` — provider selection

| Obligation | Assertion | File |
|---|---|---|
| Current dated review of official documentation | `RETRIEVED_ON` present on every record; every reference under an official developer-documentation path | `provider-selection.test.ts` |
| Not one row is measured | every `basis` is `PUBLISHED_DOCUMENTATION` | same |
| The attempted-write test is declared NOT run | `empiricallyTested: false` on every provider | same |
| No marketing prose, no client | the record imports nothing, constructs no URL, calls no `fetch` | same |
| `§19`'s five capabilities, as a conjunction | closed list; a MISSING row becomes `UNRESOLVED` rather than passing | same, CONTROL 11 |
| SendGrid satisfies all five | no blocking findings; disjoint scopes `["mail.send"]` / `["email_activity.read"]` | same |
| Mailgun is UNRESOLVED, not ABSENT | one blocking finding, status `UNRESOLVED`; `sendCapable` is `null` | same |
| `§23`'s rule: strongest provable fit, tie-break on narrowness | SendGrid selected; a wider-scope twin loses the tie-break | same |
| `§21`'s entitlement caveat recorded | `addOnRequired` true; ≥3 pending items naming the add-on and the attempted-write test | same |
| **Postmark NOT SELECTED, architecture not weakened** | disposition recorded; `architectureWeakened: false`; S1M's dated record untouched and still saying the same thing | same |
| `§29` CONTROL 10 — selected despite a send-capable audit key | unsafe selects; production reports `AUDIT_READ_ONLY_CREDENTIAL` `ABSENT` and selects nothing | same |
| `§29` CONTROL 12 — selected from marketing text | unsafe accepts any reference; production's official-path check rejects it and accepts the real one | same |

---

## 6. `§29` — the twelve vulnerable controls

| # | Attack | Discriminating assertion |
|---|---|---|
| 1 | action-based classification | unsafe `NON_MONETARY` / production `MONEY_MOVING` on `mock_ads.budget_manage`, **and they agree on `refund.create`** so the test is not tautological |
| 2 | mixed-scope misclassified | unsafe `NON_MONETARY_WRITE` on the intended permission / production refuses |
| 3 | missing risk defaults safe | unsafe `NON_MONETARY_WRITE` / production `null` then `CREDENTIAL_NOT_DECLARED` |
| 4 | unsigned runtime config chooses | unsafe honours an env override / production has no third parameter; the descriptor has no risk member |
| 5 | audit credential in the parent process | unsafe leaves it on a heap object here / production's PID differs and no surface carries it |
| 6 | audit credential shared with the send adapter | unsafe's selector returns the SEND secret / production's `resolve()` has arity 0, and a shared locator is refused |
| 7 | audit client exposes a send | unsafe mutates with the audit credential / production refuses the object at composition, before resolving material |
| 8 | audit trusts control-side evidence | unsafe returns `CORROBORATED` on a fabricated control result / production returns `MISSING_PROVIDER_RECORD`; and silence is `READ_INCONCLUSIVE`, not agreement |
| 9 | caller-supplied arbitrary URL | unsafe decodes the destination / production refuses `UNKNOWN_FIELD` |
| 10 | selected despite send-capable audit key | unsafe selects / production blocks |
| 11 | selected without query evidence | unsafe passes on a MISSING row / production synthesises `UNRESOLVED` |
| 12 | selected from marketing text | unsafe accepts any reference / production requires an official documentation path |

---

## 7. `§30` — regression

| Preserved property | Assertion |
|---|---|
| S1N's separate process, PIDs distinct | `process-boundary.test.ts`, unchanged |
| `I24` — every call site carries an authorisation reference | `perimeter-enumeration.test.ts`; 0 production unannotated |
| `I25` — the control plane holds no vendor credential | `source-boundary.test.ts`, `credential-leak-matrix.test.ts`, unchanged |
| Environment allowlists | both planes, asserted as equalities |
| Fresh claim, dispatch lease, no old-CLAIMED replay | `outbox-controls.test.ts`, `gateway-controls.test.ts`, unchanged |
| Per-adapter isolation, revocation | `integration-controls.test.ts`, unchanged |
| Perimeter CI | `verify:perimeter` PASS, now including the two audit read sites |

---

## 8. What no test in this slice asserts

* **That any provider behaves as documented.** `§27` forbids a request and none is made.
* **That the audit credential fails a write AT A PROVIDER.** A synthetic reader refuses a
  write because this repository wrote it to. `36 §13`'s empirical test is OPEN.
* **That option B works.** It is not built.
* **That any signature is discharged.** Class 5's is newly owed.

---

## 12. The owner correction — credential identity binding

**`50 §2g` field 1, and the runtime-use requirement.** Every row below is new.

| Obligation | Assertion | File |
|---|---|---|
| `CREDENTIAL_IDENTITY_MISMATCH` is its OWN closed refusal, on both planes | membership in `REFUSAL_REASONS` and in `PROVIDER_READ_REFUSALS`, each asserted beside the code it is NOT a synonym for | `credential-identity-binding.test.ts`, `audit-credential-identity-binding.test.ts` |
| The refusal-set equalities are amended out loud | seventeen integration reasons, thirteen audit reasons, each an exact list | `source-boundary.test.ts`, `audit-read-protocol.test.ts` |
| The expected identity reaches the child, and is an IDENTITY not material | the constructed environment equals the declared allowlist; the new key carries the credential id; no sentinel appears in the environment | both binding suites |
| The three transcriptions of the provenance set agree | kernel, integration runtime and audit runtime lists compared, **and neither runtime imports the other two** | `source-boundary.test.ts` |
| The kernel and per-plane comparisons agree on every case | five integration cases and four audit cases, including both empty-operand cases | both binding suites |
| **`§12` attack** — signed `NON_MONETARY_WRITE`, resolved `MONEY_MOVING` | production REFUSES `CREDENTIAL_IDENTITY_MISMATCH` **and the adapter never ran** | `credential-identity-binding.test.ts` |
| **`§12` discrimination** | `unsafeHandleWithoutCredentialIdentityBinding` DISPATCHES on the same input and reports the money-moving identity | same, with `unsafe-credential-identity-binding.ts` |
| **`§13` attack** — signed `READ_ONLY`, resolved a send credential | production REFUSES before `readFromProvider` | `audit-credential-identity-binding.test.ts` |
| **`§13` discrimination** | `unsafeHandleWithoutAuditIdentityBinding` READS on the same input and reports the send identity | same |
| The matching pair proceeds, so neither refusal is vacuous | in-process dispatch and read both succeed and report the bound identity | both |
| **A REAL FORKED RUNTIME refuses**, on both planes | the descriptor and locator are untouched and the FILE holds the other credential: integration returns `NOT_SENT_CONFIRMED`, audit returns `NO_EVIDENCE` / `CREDENTIAL_IDENTITY_MISMATCH`, and both PIDs differ from the test's | both |
| The refusal teaches a closed code and neither identity | four-member refusal shape; neither credential id appears in the serialised reply | both |
| **Locator inequality is NOT proof of credential separation** | `unsafeLocatorInequalityProvesSeparation` answers `true` on two locators that name one credential; production's comparison still refuses | `audit-credential-identity-binding.test.ts §3` |
| **Locator equality is NOT proof of credential identity** | `unsafeLocatorComparisonAsIdentityBinding` answers `true`; production refuses the wrong material anyway | same |
| **Both controls are kept** | a SHARED locator still throws `READER_LOCATOR_SHARED_WITH_INTEGRATION`, and the identity check still fires on an exclusively-held locator | same |
| A TEST source declares its provenance | fixtures return `SYNTHETIC_TEST_IDENTITY`, and a source that names nothing resolves `UNAVAILABLE` | fixture sources |

---

## 13. The owner correction — the SendGrid record and the compatibility rule

| Obligation | Assertion | File |
|---|---|---|
| `producesQueryableActivity` is **`false`**, not `null` | equality, plus `basis` and the official Sandbox Mode reference, plus the mechanism text naming both suppressed surfaces | `provider-selection.test.ts §6` |
| The four prohibited uses are NAMED | accepted-count evidence, the `I36` oracle, Email Activity correlation, Event Webhook reconciliation | same |
| What the mode IS for is also recorded | request-shape and credential-scope validation | same |
| The negative is SETTLED, not pending | `SANDBOX_ACTIVITY_EVIDENCE = ABSENT` in `resolvedDocumentedNegatives`, and the old pending item is gone from the list | same |
| Every `§7` account item is carried, none completed | eight markers present; every item still carries `ACCOUNT VALIDATION PENDING` | same |
| SendGrid remains selected on a NON-sandbox path | `isSelectable` true, `evidencePathIncompatibility` null, `sandboxModeEnabled` false, controlled recipient required | `provider-selection.test.ts §7` |
| The path names its provisioning items, including the sink recipient | six markers, plus "No customer recipient and no production" | same |
| The `NON_PRODUCTION_TEST_PATH` finding cites the real path | evidence mentions `sandbox_mode=false` and says sandbox mode is NOT this path | same |
| Mailgun is blocked TWICE, for two different reasons | one blocking finding AND an unresolved evidence path | same |
| **CONTROL 16 discriminates** | the unsafe rule selects a record whose sandbox suppresses evidence **and that record passes the capability conjunction**; production refuses the path | `provider-selection.test.ts §8` |
| A self-contradictory path is caught | sandbox enabled on a provider documented to suppress evidence, claiming evidence anyway | same |
| **CONTROL 17 discriminates** | the unsafe rule reads `null` as pending; production refuses an unresolved evidence path, and answers `false` on the corrected record | same |
| The readiness token says NONPRODUCTION and not SANDBOX | exact token equality, plus `toContain('SENDGRID')` and `not.toContain('SANDBOX')` | `s1m-readiness.test.ts` |
| The token is DERIVED, so it cannot name a stale provider | two derivations asserted | same |
| **No module still EMITS a `_SANDBOX_CREDENTIALS` token** | the three provider-selection modules are read and every match must be the mandate's own `<PROVIDER>` placeholder in prose | same |
| Conjunct 6 can block the token on its own | a suppressing record yields `NOT_READY_TO_PROVISION` with the compatibility reason | same |
| A READY result carries the settled negative AND the pending items | both lists non-empty beside the token | same |
