# S1P — operator procedure for a real Twilio SendGrid non-production validation run

Baseline `d897833`. Branch `feature/s1o-provider-selection-audit-boundary`.
**Operating Spine v1.3, package issue v1.3.7 — UNCHANGED.**

---

## 0. READ THIS FIRST

> **NO STEP BELOW HAS BEEN PERFORMED.** No SendGrid account exists, no credential has been
> provisioned, and no provider request of any kind has been made from any machine in this
> slice. This document is the procedure, not a record that it was followed.

> **THE RUN CANNOT REACH A PROVIDER TODAY, AND THE REASON IS NAMED.** Stage 2 of the preflight
> requires a MATERIAL-BOUND credential identity, and both binding mechanisms are declared and
> UNPROVISIONED (S1P-C6). A file-backed credential resolves `SYNTHETIC_TEST_IDENTITY` and fails
> `INTEGRATION_IDENTITY_NOT_MATERIAL_BOUND` / `AUDIT_IDENTITY_NOT_MATERIAL_BOUND` — by design,
> and in preference to a fake binding.

---

## 1. What the harness does, in order, and where it stops

```
  STAGE 1 — NO CREDENTIAL IS TOUCHED
    read the trusted non-secret configuration (ACOS_S1P_CONFIG)
    load the verified control-artifact bundle
    SELECT the two signed class-5 records BY the configured credential identities
    read the four operator acknowledgements from the environment
    evaluateStage1(...)  ->  any failure: write offline evidence, exit 1. NOTHING ELSE RUNS.

  STAGE 2 — ONE-SHOT CREDENTIAL PROCESSES, ONE CREDENTIAL EACH
    fork probeMain.ts  role=IDENTITY plane=INTEGRATION  -> non-secret identity facts
    fork probeMain.ts  role=IDENTITY plane=AUDIT        -> non-secret identity facts
    evaluateStage2(...) ->  any failure: write evidence, exit 1.

  STAGE 3 — CAPABILITY PROBES (each in its OWN one-shot process)
    role=SEND_PROBE  plane=AUDIT        36 §13: the audit key attempts a send; REFUSAL required
    role=READ_PROBE  plane=AUDIT        Email Activity read; SUCCESS required
    role=READ_PROBE  plane=INTEGRATION  §8.7's inverse direction; provider REFUSAL expected

  STAGE 4 — THE SIX-SCENARIO KILL-POINT DRIVER
    requires a deployment CONTROL-PLANE COMPOSITION, which this repository does not ship
```

**The CLI stops at stage 1 on this repository**, and one of the gates it stops on is
`CONTROL_PLANE_COMPOSITION_UNAVAILABLE`. The driver itself is written, compiled and fully
exercised offline (`tests/sendgrid/scenario-driver.test.ts`); what is missing is a live
composition root, and inventing one would be validating a composition no deployment uses.

---

## 2. Provisioning the account — the operator's work, before anything below

1. A **dedicated non-production SendGrid account or subuser**. Not a production account, not a
   production subuser, and not an account that also sends customer mail.
2. A verified **sending identity** on it (single-sender verification or an authenticated
   domain). Record its address.
3. An **owner-controlled sink mailbox** whose address contains `acos-nonprod-sink`. A
   sub-address tag is the intended shape: `you+acos-nonprod-sink@your-domain.test`.
   *Both the configuration parser and the validation seeder REFUSE a sink without the marker.*
4. Two API keys, **scoped and separate**:
   * the SEND key — `mail.send` only, and **no** `email_activity.read`;
   * the AUDIT key — `email_activity.read` only, and **no** `mail.send`.
5. The **Email Activity history entitlement** on the account. S1O recorded that it is a paid
   add-on on some plans; without it the audit read cannot answer and every scenario is
   UNRESOLVED.
6. **Do NOT enable sandbox mode anywhere.** S1O's capability record: a sandbox send generates no
   Email Activity event, so the mode that makes a request safe is the mode that removes the
   evidence `I36` reads. The adapter emits `sandbox_mode: false` as a literal and refuses any
   input asking for `true`.

---

## 3. The credential-binding mechanism — **THE BLOCKER**

Before a live run can pass stage 2, one of these must be built behind its declared branch in
BOTH `validation/sendgrid/integration/secretSource.ts` and
`validation/sendgrid/audit/secretSource.ts`:

| Mechanism | What it must establish |
| --- | --- |
| `SECRET_MANAGER_VERSION` | the manager returns the material AND its immutable version identity in ONE answer, so the identity is of the exact bytes returned |
| `PROVIDER_KEY_ID_BINDING` | a mechanism that can say the provider key id belongs to the exact material returned |

**Do not implement the second by adding a broad SendGrid administrative credential to enumerate
keys.** `§3.3` forbids it and no accepted architecture permits it.

Until one exists, the honest state is UNPROVISIONED and the live run refuses.

---

## 4. The two secret documents — outside the repository

Each is a file on the deployment host, at a path only the operator chooses. **Nothing in this
repository names one**, `.gitignore` carries patterns for the case where an operator points a
locator inside the working tree anyway, and no fixture writes a real key.

`ACOS_S1P_INTEGRATION_LOCATOR` names:

```json
{
  "adapterId": "sendgrid_email",
  "sourceKind": "SECRET_MANAGER_VERSION",
  "...": "the mechanism's own operands"
}
```

`ACOS_S1P_AUDIT_LOCATOR` names a **DIFFERENT FILE** with `"providerId": "twilio_sendgrid"`.
`createAuditReaderRegistry` refuses `READER_LOCATOR_SHARED_WITH_INTEGRATION` if the two paths
collide, so pointing both planes at one document is refused at composition.

**`identityProvenance` IS NOT A FIELD OF EITHER DOCUMENT.** Correction 3: the provenance is
assigned by the mechanism that resolved the material, and a document claiming one is ignored.

---

## 5. The trusted non-secret configuration

`ACOS_S1P_CONFIG` names a file holding exactly five fields and **no secret**:

```json
{
  "environmentLabel": "acos-s1p-nonprod",
  "senderAddress": "validation@your-nonprod-domain.test",
  "sinkAddress": "you+acos-nonprod-sink@your-domain.test",
  "integrationCredentialId": "<the EXACT signed class-5 credential_id for the send key>",
  "auditCredentialId": "<the EXACT signed class-5 credential_id for the audit key>"
}
```

The two identities **select** the signed class-5 records — correction 6: the harness never
scans for "whichever record mentions this adapter". A configuration naming an identity the
signed artifact does not carry refuses at stage 1; a configuration naming the WRONG credential
fails the stage-2 binding comparison rather than silently authorising it.

---

## 6. The four acknowledgements

Each is a long sentence in the environment. A boolean would be `true`, which a shell sets for a
dozen unrelated reasons; these can only have been typed after reading what they mean.

| Variable | Token | What the operator is stating |
| --- | --- | --- |
| `ACOS_S1P_NON_PRODUCTION_ACKNOWLEDGEMENT` | `THIS_IS_A_DEDICATED_NON_PRODUCTION_SENDGRID_IDENTITY_WITH_AN_OWNER_CONTROLLED_SINK_AND_NO_CUSTOMER_RECIPIENT` | **correction 7.** A dedicated non-production sending identity, an owner-controlled sink, and no customer or production recipient. A parseable configuration document is NOT this statement |
| `ACOS_S1P_EMAIL_ACTIVITY_ENTITLEMENT_CONFIRMED` | `EMAIL_ACTIVITY_HISTORY_ENTITLEMENT_CONFIRMED` | the entitlement was confirmed against the account |
| `ACOS_S1P_LIVE_ACKNOWLEDGEMENT` | `I_AUTHORISE_A_REAL_NON_PRODUCTION_SENDGRID_SEND` | a real provider send is authorised |
| `ACOS_S1P_DUPLICATE_CONTROL_ACKNOWLEDGEMENT` | `I_AUTHORISE_AN_INTENTIONAL_DUPLICATE_SEND_TO_MY_OWN_SINK` | **`§11`'s SECOND opt-in.** Only when the duplicate negative control is wanted. Setting the variable to ANY other value REQUESTS the control and REFUSES it |

---

## 7. Running it

```bash
npm run validate:sendgrid
```

Exit codes: `1` a gate refused; `2` every gate passed and no provider call was made; `0` is not
reachable today.

Evidence lands in `artifacts/s1p-validation/<run-id>.json`, is `.gitignore`d, and is sanitized
by construction — `renderEvidenceBundle` THROWS rather than redacting if a secret shape reaches
it.

**Read the `credentialsTouched` field first.** `false` means stage 1 refused and no deployment
document was read by any process.

**And read `productionStatement`.** Correction 8: it is DERIVED from run state. An offline run's
statement says what did NOT happen and makes no claim that any environment, sender or sink was
exercised.

---

## 8. What a completed live run would still not establish

* **not** exactly-once delivery, distributed exactly-once, or provider idempotency
  (`KILL_POINT_CONCLUSION_LIMITS`);
* **not** `I17b` — a local evidence digest anchors nothing outside this repository;
* **not** `I8`'s empirical leg from a known-correlation query alone. The inverse sweep
  (`inverseSweep.ts`) reads PERIOD-BOUNDED with no tag, and it has never been run against a real
  account;
* **not** that scope conformance holds in future. A provider key is mutable at the provider with
  no ACOS-observable event; the probes measure a moment.

---

## 9. If anything is uncertain

Do not send. `§6`: "If any prerequisite is uncertain, do not send." A gate the harness could not
evaluate arrives as a failure, so uncertainty and refusal are the same path — and that is the
behaviour to preserve rather than to work around.
