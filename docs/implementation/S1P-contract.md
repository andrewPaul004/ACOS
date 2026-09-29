# S1P — contract

**Twilio SendGrid non-production provider validation, after the independent review.**
Baseline `d897833`. Branch `feature/s1o-provider-selection-audit-boundary`.
**Operating Spine v1.3, package issue v1.3.7 — UNCHANGED.**

---

## 1. What S1P delivers, and the line it does not cross

S1P builds the REPOSITORY-SIDE machinery a real `I36` provider validation needs, and takes the
run as far as it truthfully goes.

**IT DOES NOT PERFORM ONE.** No SendGrid account exists, no credential is provisioned, and no
provider request has been made from any machine.

| Deliverable | State |
| --- | --- |
| an HONEST action class for the validation send (`email.send`, IRRECOVERABLE, one MIE unit) | signed class-3 bytes written |
| `authorisation_ref -> dispatch_payload_hash -> the actual provider request` | CLOSED, and the adapter reads the authorised bytes |
| a credential-source contract whose provenance is MECHANISM-assigned | implemented; the two BINDING mechanisms declared and UNPROVISIONED |
| a TWO-STAGE preflight | implemented; stage 1 touches no credential |
| ONE-SHOT credential processes, one credential each | implemented |
| EXACT credential selection by configured identity | implemented |
| capability-probe orchestration | implemented; unrun, because a credential is needed to run one |
| an EXECUTABLE six-scenario kill-point driver | implemented, and EXERCISED OFFLINE end to end |
| the duplicate negative control | implemented, opt-in, and discriminated offline |
| a stable provider-count oracle (discovery + stabilisation) | implemented |
| `I20` local comparison machinery | implemented and proved offline |
| `I8` inverse-sweep machinery | implemented; the empirical leg OPEN |
| evidence derived from run state | implemented |

---

## 2. The perimeter position

`validation/` is a PERIMETER ROOT scanned at **PRODUCTION** scope. `§18`'s `TEST_ONLY`
carve-out is for a *synthetic* provider, and a client that reaches `api.sendgrid.com` is not
one. The scan result:

| Kind | Annotation | Where |
| --- | --- | --- |
| send | `PERIMETER_AUTHORISED(authorisation_ref)` | `integration/adapter.ts`, `integration/providerClient.ts` |
| read | `PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6)` | `audit/providerReadClient.ts`, `audit/reader.ts` |
| capability probe | `PERIMETER_EXEMPT(credential_scope_conformance_probe, 36-13)` | `harness/scopeProbes.ts`, `harness/probeRuntime.ts` |
| duplicate control | `PERIMETER_EXEMPT(duplicate_negative_control, S1P-11)` | `harness/scopeProbes.ts`, `harness/probeRuntime.ts` |

`npm run verify:perimeter` → **PASS**, 0 unannotated sites.

---

## 3. The three planes, and what each may hold

| Process | May hold | May NOT hold |
| --- | --- | --- |
| the validation COORDINATOR (`cli.ts`) | two LOCATORS (paths), the verified bundle, non-secret configuration | **any vendor credential.** Its import closure contains neither secret source and neither provider client |
| an INTEGRATION runtime or one-shot integration probe | the SEND credential | the audit locator, the audit source, the read client |
| an AUDIT runtime or one-shot audit probe | the AUDIT credential | the integration locator, the integration source, the send client |

`buildProbeEnvironment` has ONE locator slot, so no arrangement of arguments puts two
credentials in one process.

---

## 4. What a live run would and would not establish

**WOULD**, once provisioned: that for the scenarios run, no recovery path produced a second
provider-accepted message for an already-`CLAIMED` effect; that the two credentials hold the
capabilities their signed class-5 records declare, at that moment; that `I20`'s bound held over
the validation window.

**WOULD NOT**, ever: exactly-once delivery; distributed exactly-once; provider idempotency;
`I17b`; `I8` from a known-correlation query; future scope conformance.

Both lists are carried INSIDE every evidence bundle (`KILL_POINT_CONCLUSION_LIMITS`,
`I17B_STATUS`) rather than living only here.

---

## 5. What blocks a live run today, named

1. **No account, no credentials.** Operator work.
2. **No material-binding mechanism** — the thing stage 2 needs (S1P-C6). This is the blocker that
   is not merely provisioning: a mechanism has to be selected and built.
3. **No class-5 records** for a real SendGrid credential, which cannot be signed until (2) yields
   real identities.
4. **No deployment control-plane composition root**, which the scenario driver traverses.
   Stage 1 refuses on `CONTROL_PLANE_COMPOSITION_UNAVAILABLE`.

---

## 6. Non-goals, restated

Not S4. Not a production customer-email path. Not a general Cedar grant for `email.send` —
ordinary production treatment remains `UNGOVERNED_FAILS_CLOSED`. Not an owner ceremony. Not a
new architecture package: `docs/architecture/` is byte-identical and its 108-condition
verification is unchanged at 108 PASS / 0 FAIL with all 77 mutation seeds still discriminating.
