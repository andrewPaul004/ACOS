# S1P — offline run evidence

Baseline `d897833`. Branch `feature/s1o-provider-selection-audit-boundary`.

> ## NOTHING IN THIS FILE IS PROVIDER EVIDENCE.
>
> Every run recorded here is OFFLINE. No SendGrid account exists, no credential was
> provisioned, and no request was made to `api.sendgrid.com` from any machine.

---

## 1. `npm run validate:sendgrid` on this repository

The harness stops at **stage 1**, writes a bundle, prints every gate and exits non-zero.

**IT REFUSES ON FIFTEEN GATES, AND TWO OF THEM ARE ABOUT THIS ENVIRONMENT RATHER THAN ABOUT
THE REPOSITORY.** The distinction matters and is stated rather than glossed:

> This machine has no deployment trust configuration, so `50 §3f`'s bootstrap fails
> `TRUST_CONFIG_MISSING` and **no verified bundle exists**. With no bundle there is no signed
> class-3 catalogue to read, so `ADAPTER_NOT_IN_SIGNED_CATALOGUE` and
> `SIGNED_CLASS_3_OPERATION_MISMATCH` fire for want of a BUNDLE, not for want of a RECORD.
>
> Under a bootstrapped bundle — which is what every test worker has, and what a deployment
> would have — **neither fires**, because the signed class-3 catalogue now names
> `sendgrid_email` for `email.send` with method `emailSend`.
> `tests/sendgrid/preflight.test.ts` asserts exactly that, positively and negatively, and it
> is the visible consequence of correction 1.

The measured run:

```
credential sources touched by this run: NO
PREFLIGHT REFUSED — 15 gate(s):
  stage 1 (no credential touched): 15
  stage 2 (credential identity): 0
NO PROVIDER CALL WAS MADE.
```

| Gate | What it means here |
| --- | --- |
| `CONTROL_ARTIFACT_BUNDLE_UNAVAILABLE` | this environment has no owner root key. **`50 §3f` fails closed and the harness reports it rather than proceeding** |
| `ADAPTER_NOT_IN_SIGNED_CATALOGUE` | consequence of the above — no bundle to read a catalogue from |
| `SIGNED_CLASS_3_OPERATION_MISMATCH` | the same |
| `DEPLOYMENT_CONFIGURATION_UNREADABLE` | no `ACOS_S1P_CONFIG` document exists |
| `NON_PRODUCTION_NOT_ACKNOWLEDGED` | the operator sentence was not supplied |
| `NON_PRODUCTION_ENVIRONMENT_LABEL_ABSENT` | no configuration, so no label |
| `INTEGRATION_CREDENTIAL_ID_NOT_CONFIGURED` | correction 6: nothing NAMES the expected identity |
| `AUDIT_CREDENTIAL_ID_NOT_CONFIGURED` | the same, for the audit plane |
| `INTEGRATION_CLASS_5_RECORD_ABSENT` | no signed record can be selected without an identity |
| `AUDIT_CLASS_5_RECORD_ABSENT` | the same |
| `SENDER_IDENTITY_ABSENT` | no configuration |
| `SINK_ABSENT_OR_NOT_OWNER_CONTROLLED` | no configuration |
| `EMAIL_ACTIVITY_ENTITLEMENT_UNCONFIRMED` | the operator token was not supplied |
| `LIVE_RUN_NOT_OPTED_IN` | the operator token was not supplied |
| `CONTROL_PLANE_COMPOSITION_UNAVAILABLE` | this repository ships no deployment composition root |

**`stage 2 (credential identity): 0` IS NOT A PASS.** It is zero because stage 2 never ran —
correction 4's whole point — and the bundle's `credentialsTouched: false` is the field that
says so rather than leaving a reader to infer it from an empty list.

The bundle records:

* `credentialsTouched: false` — **stage 1 refused, so no deployment document was read by any
  process and no one-shot credential child was started**;
* `stage2Failures: []` — not because stage 2 passed, but because it never ran;
* `liveRunPerformed: false`, `providerOperationCount: 0`, `probes: []`, `killPoints: []`,
  `i20: null`;
* a `productionStatement` DERIVED from that state, which names the gate count and makes **no**
  claim that any environment, sender or sink was exercised.

---

## 2. The offline six-scenario kill-point run

`tests/sendgrid/scenario-driver.test.ts`, against a file-backed simulated account shared by two
isolated forked child processes. Judged on the PROVIDER's own count as well as local state.

| Point | Trigger | Outbox | Outcome rows | Provider count | After recovery | Recovery | Verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 — before claim COMMIT | `afterClaimLock` | `ENQUEUED` | 0 | 0 | 1 | `OUTCOME_RESOLVED` | **UNRESOLVED** |
| 2 — after claim COMMIT, before invocation | `afterClaimCommit` | `CLAIMED` | 0 | 0 | 0 | `CLAIM_REFUSED:ALREADY_CLAIMED` | **UNRESOLVED** |
| 3 — after ACCEPTED, before outcome known | integration child exits | `CLAIMED` | **1** | 1 | 1 | `CLAIM_REFUSED:ALREADY_CLAIMED` | PASS |
| 4 — after RETURNED, before outcome COMMIT | `beforeOutcomeCommit` | `CLAIMED` | 0 | 1 | 1 | `CLAIM_REFUSED:ALREADY_CLAIMED` | PASS |
| 5 — after outcome COMMIT | `afterOutcomeCommit` | `CLAIMED` | 1 | 1 | 1 | `CLAIM_REFUSED:ALREADY_CLAIMED` | PASS |
| 6 — re-entry at every point | DERIVED from 2–5 | — | — | — | unchanged | `CLAIM_REFUSED:ALREADY_CLAIMED` | PASS |

**NO ROW FAILS.**

**POINTS 1 AND 2 ARE `UNRESOLVED`, AND THAT IS THE HONEST CEILING RATHER THAN A DEFECT.**

`§10.1`: "bounded non-observation is not automatically proof of never-sent unless the accepted
provider-reporting evidence actually supplies a complete absence guarantee." Email Activity
supplies none, and both rows carry a provider-side expectation of ZERO that only a
non-observation can meet. Every LOCAL expectation on both rows was met exactly.

**They can still FAIL**, which is what keeps them controls: a zero-expectation row that showed an
accepted message is caught by the count comparison. What they cannot do is certify a negative.

The derived point-6 row PASSES because its property is checkable in its FAILING direction — an
INCREASE across the recovery would be a positive observation, so a non-observation cannot
conceal one.

**Point 3's ONE outcome row is the finding, and it is recorded rather than smoothed.** The mock
matrix expects zero because its kill is an in-process throw; in the separate-process
composition the control plane OUTLIVES the dead integration child and commits `§41`'s
`OUTCOME_UNKNOWN`. The canonical expectation is untouched and the difference is carried in a
separately named field. See S1P-C5.

`I20` over that run: **4 provider-accepted irrecoverable effects against an immutable historical
reservation basis of 5 units → `WITHIN_BASIS`.** Five scenarios each reserved one unit; point 2
legitimately never sent, which is `35 §12.3`'s stated cost and is why `I20` is a bound rather
than an equality.

---

## 3. The discriminations that would have caught the rejected design

| Rejected design | What the offline run shows |
| --- | --- |
| recipient from launch configuration | one authorised payload, two configurations, same recipient — and the unsafe twin follows the document |
| a 403 read reported as count 0 | a row with PERFECT local state is `UNRESOLVED`, not PASS and not FAIL |
| stop-on-first observation | the same oracle that reports ONE for a scenario reports `>= 2` once a delayed duplicate exists |
| provenance read from a JSON document | a document CLAIMING `PROVIDER_KEY_ID` resolves `SYNTHETIC_TEST_IDENTITY` |
| credentials resolved before the gate | the order trace, and the single call site inside the stage-1 guard |
| a static production statement | the offline bundle contains none of the live-claim phrases |

---

## 4. Verification commands, and what each answered

| Command | Result |
| --- | --- |
| `npx tsc --noEmit` | clean |
| `npx eslint . --max-warnings 0` | clean |
| `npx vitest run` | see `S1P-result.md` §Verification |
| `npm run verify:perimeter` | **PASS** — 16 production call sites, 0 unannotated |
| `npm run prelive:verify` | `NOT_READY` — `TRUST_CONFIG_MISSING` on both planes. **Unchanged by S1P**: no owner root key exists in this environment, and the same two findings were reported before this slice |
| `docs/architecture/v1.3.7/analysis/consistency-v1.3.py` | **108 PASS / 0 FAIL**, unchanged |
| the same script with each of its 77 mutation seeds | **77/77 still discriminate** — every seed fails at least one condition |
| `git diff --check` | clean |

---

## 5. What none of this establishes

It does not establish that a provider would behave as the simulated account does. `35 §12.3` is
explicit: "a mock with a naive idempotency implementation passes while the vendor would not."
The simulated account deliberately implements NO idempotency — it mints a new message id for
every send — so the offline run can show that the ORACLE would see a duplicate. It cannot show
what SendGrid would do.

**`I36`'s verification leg, `I20`'s provider side and `I8`'s empirical leg all remain OPEN.**

---

## 6. The SECOND correction round's verification, as run

| Check | Command | Result |
| --- | --- | --- |
| type check | `npx tsc --noEmit` | clean |
| lint | `npx eslint . --max-warnings 0` | clean |
| full suite | `npx vitest run` | **202 files, 2888 tests, 0 failures** |
| perimeter | `npm run verify:perimeter` | **PASS** |
| architecture consistency | `docs/architecture/v1.3.7/analysis/consistency-v1.3.py` | **108 PASS / 0 FAIL** |
| mutation seeds | every `--seed-*` flag the script declares | **77/77 still discriminate** |
| whitespace | `git diff --check` | no errors |

The first correction round finished at 199 files / 2842 tests. The second adds three suites —
`tests/sendgrid/provider-response-integrity.test.ts`,
`tests/sendgrid/live-finality.test.ts` and `tests/sendgrid/cli-orchestration.test.ts` — for
**+3 files and +46 tests**. Nothing was removed, and no existing assertion was weakened; where
a signature changed, the affected suites were updated out loud and are listed in
`docs/implementation/S1P-implementation-log.md`.

### The run the CLI now performs offline

`tests/sendgrid/cli-orchestration.test.ts` drives `main` itself. A fully-configured offline run
produces an evidence bundle carrying six JUDGED kill-point rows, a non-null `I20` comparison, a
performed `I8` inverse sweep that reports itself INCOMPLETE, an `observationMode` naming the
offline fixture regime, and — behind its second acknowledgement — a duplicate negative control
in which the SAME oracle reports a count of two.

**It remains offline evidence.** `§4.4`'s labelling requirement is why the bundle says so in
its own words rather than leaving a reader to infer it, and `assertLiveUsable` refuses a live
run handed the bound that made it deterministic.
