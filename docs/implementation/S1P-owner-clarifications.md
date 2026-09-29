# S1P — owner clarifications and declared fixture decisions

**Twilio SendGrid non-production provider validation, after the independent review.**
Baseline `d897833`. Branch `feature/s1o-provider-selection-audit-boundary`.
**Operating Spine v1.3, package issue v1.3.7 — UNCHANGED by this slice.**

This file records every value S1P had to choose that the accepted architecture does not
supply, and separates the ones the OWNER ruled from the ones the SLICE declared as fixtures.
`§1.3` of the correction mandate requires that separation explicitly: "explicitly record this
as an S1P fixture/owner decision rather than an architecture-derived universal value."

---

## S1P-C1 — `email.send`. **RULED BY THE OWNER, NOT OPEN.**

The rejected slice carried S1P-C1 as an open recoverability question and disguised the
validation send as an existing class. The correction mandate closes it:

> The accepted v1.3.7 architecture already rules: action class `email.send`; recoverability
> `IRRECOVERABLE`; an email send cannot be unsent; the architecture explicitly discusses
> `email.send` at one MIE unit.

### The class-3 record, field by field

| `50 §2a` field | Value | Where it comes from |
| --- | --- | --- |
| 1 `action_class` | `email.send` | Owner ruling, `§1.1` |
| 2 `recoverability` | `IRRECOVERABLE` | Owner ruling — "an email send cannot be unsent" |
| 3 `value_direction` | `NONE` | Owner ruling, `§1.3` |
| 4 `carries_vendor_monetary_field` | `false` | Owner ruling. The v3 Mail Send body carries no money field, so `I18a`'s null branch applies |
| 5 `cost_component_free` | `false` | Owner ruling. A send costs the account something; that cost is a DISCLOSED estimate, not a reservation (`26 §5`) |
| 6 `rate_based` | `false` | Owner ruling |
| 7 `irrecoverable_units` | `1` | Owner ruling, and `51 §2.3`'s coherence rule for every IRRECOVERABLE class. The class-3 parser enforces it over the verified bytes |
| 8 `settlement_tolerance` | `NONE` | Owner ruling |
| 9 `adapter` | `sendgrid_email` | Owner ruling |
| 10 `method` | `emailSend` | Owner ruling |
| record 13 `semantic_option_digest_fields` | `[]` | Empty. The validation effect has no enumerated semantic dimension: the fixture enumerator returns exactly one option per resolvable resource, exactly as it does for the other two constructor-less classes |
| record 14 `enumeration_max_age_seconds` | `120` | **AN S1P FIXTURE DECISION, NOT AN ARCHITECTURE-DERIVED UNIVERSAL.** `§1.3` requires it recorded as one. The value is the existing S1 catalogue convention — every other class carries 120 — and no accepted deliverable states a per-class figure for an email class |

### THE ARCHITECTURE HAD ALREADY DECLARED THE TWO VALUES THAT MATTER MOST

`51 §2.3`'s table has SEVEN rows, and one of them is `email.send`. The accepted
`tests/integration/exposure/mie-reservation.test.ts` has carried the hand-authored
transcription since S1J, with three rows listed in a comment because the closed catalogue did
not contain those classes:

```
  goodwill.credit.issue  COMPENSABLE     0
  order.address.edit     IRRECOVERABLE   1
  email.send             IRRECOVERABLE   1
```

The same file quotes `51 §2.3`'s worked example for this exact class: *"raising
`fulfilment.reship` to 2 would halve the reships the MIE ceiling admits, and lowering
`email.send` to 0 would remove the class from the ceiling entirely."*

**SO S1P DID NOT INVENT A RECOVERABILITY OR A UNIT COUNT.** It added the catalogue member the
architecture already described, with the values the architecture already declared, and
`email.send` has moved from that comment into the hand-authored map — which is now the
transcription that covers it.

The same file's uncatalogued-class case had used `email.send` as its example, for the good
reason that it was named by the architecture and absent from the artifact. It now names
`sms.send` instead, and the change is recorded in the test out loud: the property is unchanged,
and `email.send` is covered by the stronger exhaustive coherence loop instead.

### Coherence rules traced before the values were applied

* `51 §2.3` — "for every IRRECOVERABLE class in the current catalogue the declared value is
  `1`". Satisfied, and enforced by `parseClass3ActionCatalogue` over the verified bytes rather
  than by this document.
* `26 §6`'s prohibited-class table — `email.send` is not a member and matches no wildcard
  (`legal.response.send` is an EXACT entry, not a prefix). `assertProhibitionsDisjointFromCatalogue`
  is the mechanised check and it passes.
* `I66`'s outbox-scope predicate — the class names a real adapter rather than
  `INTERNAL_ONLY_ADAPTER`, so it is an external write and
  `tests/integration/outbox/outbox-scope.test.ts` says so for it.
* `I18a` — `carries_vendor_monetary_field: false` means the dispatch payload carries
  `monetaryEffect: null`, and `parseValidationEmailPayload` REFUSES a payload that carries one.

**No contradiction with an accepted invariant was found.** `§1.3` required a STOP-and-report
if one had been.

---

## S1P-C2 — class 2 is **UNCHANGED**, and the gap declaration is where the status lives

`§1.4`: "If merely adding the action member does NOT require changing class-2 bytes when it is
ungoverned, do not change class 2."

It does not. `artifacts/control/class-02.policy-set.json` declares ONE Cedar action
(`refund.create`) and its schema refuses a request naming any other, so an `email.send` request
cannot be constructed and could not be evaluated if it were. The class-2 bytes are untouched
and `ACCEPTED_POLICY_VERSION` is unmoved.

The STATUS is recorded in `tests/policy/policy-set-gap-analysis.test.ts`'s `DECLARED_STATUS`
table as `UNGOVERNED_FAILS_CLOSED`, and that table is asserted BY EXECUTION: no registered
policy construction, no Cedar action, no registered constructor. `36 §3`'s "silently so" is
removed for this class exactly as it is for the other three.

---

## S1P-C3 — class 19 is **UNCHANGED**, and here is why that is not an omission

`§1.5`: "Do not add a class-19 constructor record merely because the action exists. Add one
only if the actual accepted machinery requires a constructor version for the validation
payload."

It does not. `admitConstructorVersionRecords` and `verifiedConstructorVersionResolver` — the
two functions that consult the signed class-19 artifact — are reached from
`tests/release/class19-admission.test.ts` and from nothing on the local-authorisation commit
path. The accepted S1I/S1J fixtures already authorise `campaign.pause` and `fulfilment.reship`
with fixture constructor-version identities that appear in NO signed class-19 record, and the
S1P validation seeder does the same with
`constructor:email.send:s1p-validation-fixture`.

Adding a production constructor record for a class that has **no production constructor** would
be claiming an authority this slice does not have, and it would put a record in the signed
artifact that no production path can use.

**The still-open class-19 obligation is preserved and restated:** `50 §3i` declares the
migration of the constructor-record verifying key onto the owner roots as DECLARED FUTURE WORK,
and S1P neither closes it nor touches it.

---

## S1P-C4 — the stabilisation depth is **2**, and it is a fixture decision

`observeCorrelation`'s `MIN_STABILISATION_OBSERVATIONS` is TWO further successful observations
after the first sighting.

No accepted deliverable states a stabilisation depth. The reasoning is recorded in the module
and restated here: one further observation is a single sample of a feed that has already proved
it lags; two consecutive agreeing observations, at the published six-per-minute spacing, is the
smallest window in which a late duplicate has more than one chance to appear.

**IT IS AN S1P FIXTURE DECISION.** A real account may show that a different depth is required,
and the figure is a clamped configuration operand rather than a constant, so raising it is a
configuration change and lowering it below two is refused by `clampObservationBound`.

---

## S1P-C5 — kill point 3 reports ONE outcome row in the separate-process composition

**This is a finding from the offline run, and `§9` forbids hiding it.**

`mock-kill-matrix.test.ts` expects ZERO committed outcome rows at point 3: the mock's
`afterAccepted` rejects IN THE CONTROL PROCESS, so `dispatchAuthorisedEffect` throws and the
outcome transaction never opens.

After S1N there are TWO processes. The integration child's death is something the control plane
OBSERVES rather than shares, and `§41` rules what it must then do: "after invocation ambiguity
-> OUTCOME_UNKNOWN". The control plane survives, classifies the dead child honestly, and
COMMITS an `OUTCOME_UNKNOWN` row.

That is better behaviour, not worse — the effect is recorded as ambiguous rather than silently
lost — and it is what the accepted S1N integration client already does for every dead child.

So the canonical expectation is NOT overwritten. `KillPointRow` carries a second, separately
named field, `expectedOutcomeRowsInSeparateProcessComposition`, which is `null` on five rows
and `1` on row 3, and the driver's verdict reads it. A reader of `KILL_POINT_ROWS` sees both
numbers and the reason they differ.

**The row's discriminating property is unchanged:** point 2's provider-side count is 0 and
point 3's is 1, for the same `CLAIMED` status and the same `ALREADY_CLAIMED` recovery. That is
still the thing only a provider read can supply.

---

## S1P-C6 — the two credential-binding mechanisms are DECLARED and UNPROVISIONED

`§3.2`: "Do not select AWS/Azure/GCP/etc. merely to make the test pass unless the repository
already has an accepted platform selection. If no concrete secret manager is selected,
implement the contract and leave the real live source UNPROVISIONED/PARTIAL."

No platform is selected. `§9` of the S1N mandate forbids selecting one and `31 §12`'s
technology table names none. So `CREDENTIAL_SOURCE_KINDS` declares three mechanisms, the
provenance each is ENTITLED to assign is a map rather than a document field, and the two binding
mechanisms resolve **nothing**:

| Mechanism | Provenance it may assign | State |
| --- | --- | --- |
| `FILE_FIXTURE` | `SYNTHETIC_TEST_IDENTITY` | Implemented. Live preflight FAILS CLOSED on it |
| `SECRET_MANAGER_VERSION` | `DEPLOYMENT_SECRET_VERSION` | Declared, **UNPROVISIONED** |
| `PROVIDER_KEY_ID_BINDING` | `PROVIDER_KEY_ID` | Declared, **UNPROVISIONED** |

**This is why a live run cannot pass stage 2 today**, and it is the honest answer rather than a
fake binding.

---

## S1P-C7 — the deployment configuration is a NEW, non-secret document

Correction 6 requires the exact expected credential identity per plane, and correction 7
requires the non-production declaration to be an explicit operator acknowledgement rather than
an inference. Both needed somewhere to live.

`validation/sendgrid/harness/deploymentConfig.ts` reads ONE non-secret document, named by
`ACOS_S1P_CONFIG`, carrying five fields: the environment label, the sender, the sink, and the
two credential identities. It holds no secret and the parsed record is constructed field by
field, so an `apiKey` added to the file by a confused operator reaches nothing.

The non-production DECLARATION is not in that document. It is
`ACOS_S1P_NON_PRODUCTION_ACKNOWLEDGEMENT`, a sentence naming all three things `§7` requires an
operator to state.

---

## What remains an OWNER DECISION and is NOT taken here

* whether a real SendGrid account is provisioned, and by whom;
* which secret-manager or provider-binding mechanism is selected, which is the thing that
  unblocks stage 2;
* the production owner ceremony for any control-artifact release. **It has not been performed
  and no owner signature has been forged.**
