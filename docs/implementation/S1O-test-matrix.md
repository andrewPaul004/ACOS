# S1O — test matrix

Every obligation the mandate states, and the assertion that discharges it. **An obligation
with no row is an obligation nobody tested.**

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
