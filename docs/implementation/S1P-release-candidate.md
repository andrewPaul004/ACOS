# S1P — control-artifact release handling

**`§16` of the S1P correction mandate.** Baseline `d897833`. Branch
`feature/s1o-provider-selection-audit-boundary`.
**Operating Spine v1.3, package issue v1.3.7 — UNCHANGED.**

`§16` requires three things kept apart and stated separately:

> Document separately: repository/pre-live fixture changes; release candidate state; actual
> owner/provider release still pending.

---

## 0. THE TWO SENTENCES THAT MATTER MOST

> ## NO PRODUCTION OWNER SIGNATURE WAS CREATED, AND NO OWNER CEREMONY WAS PERFORMED.
>
> ## NO REAL-PROVIDER RELEASE WAS ACTIVATED. THE CLASS-5 CREDENTIAL IDENTITIES FOR A REAL SENDGRID ACCOUNT DO NOT EXIST.

`§16`: "Do not forge production owner signatures. Do not perform the production owner
ceremony." Neither was done. `tools/control-release/` was not invoked with any private key, and
the only keys this slice touched are the TEST-ONLY roots
(`TEST_ONLY_PRIMARY_SEED`, `TEST_ONLY_SECOND_FACTOR_SEED`) that
`tests/support/controlArtifactFixture.ts` has carried since S1K and that
`tests/controlArtifacts/key-hygiene.test.ts` proves no production module can reach.

---

## 1. REPOSITORY / PRE-LIVE CHANGES — what actually changed on disk

### 1a. `artifacts/control/class-03.action-catalogue.json` — the ONE artifact byte change

| | Before | After |
| --- | --- | --- |
| `artifact_version` | `acos.action_catalogue.2026-09-24` | `acos.action_catalogue.2026-09-28` |
| `action_classes` | 4 records | 5 records — `email.send` added |
| `semantic_option_digest_fields` | 4 keys | 5 keys — `email.send: []` |
| `enumeration_max_age_seconds` | 4 keys | 5 keys — `email.send: 120` |

**WHY EDITING THE SOURCE BYTES IS THE SMALLEST HONEST APPROACH, AND NOT A BYPASS.**

`§16`: "Do not silently hand-edit an 'active signed' package in a way that bypasses the release
machinery. If repository conventions require a new control-artifact release
candidate/package for the class-3 change, use them."

This repository ships **no signed package**. `artifacts/control/` holds the ARTIFACT BYTES; the
signed manifest is produced either by the offline owner ceremony (`tools/control-release/`, for
a deployment) or, in the test suite, by `buildControlArtifactFixture`, which reads those same
bytes and signs them with the test-only roots. `find` over the working tree confirms no
release directory and no `release-input.json` is committed.

So there is no active signed package to hand-edit, and the release machinery is not bypassed:
it has not been run, because running it is the OWNER CEREMONY and `§16` forbids performing one.
What changed is the INPUT the ceremony would consume, and the version string moved so that a
ceremony over the new bytes produces a visibly different artifact version.

**The change is not silent.** It moves the class-3 content hash, and therefore the manifest
identity of any package built over it. Three test fixtures that pin the artifact version string
were updated with it, and every one of them is named in §4 below.

### 1b. Fixture and test-support changes

| File | Change | Why it is pre-live only |
| --- | --- | --- |
| `tests/support/outboxFixture.ts` | registers a fixture enumeration constructor and a signed constructor-version record for `email.send` | TEST-ONLY. `25 §14.1` revalidates the original enumeration identity at dispatch, so a class with no production constructor needs the fixture's enumeration half — exactly as `campaign.pause` and `fulfilment.reship` already do. Production's registry still registers ONE constructor |
| `tests/support/s1pScenarioFixture.ts` | builds a SEPARATE signed package whose class 5 carries two validation credential records | TEST-ONLY, `§16`'s own allowance: "You may use the accepted repository's test/pre-live trust roots and fixture mechanisms for offline discrimination if those mechanisms are already sanctioned." It is signed by the test-only roots, verified through the ACCEPTED verifier, written to its own directory, and used ONLY to construct the two runtime registries |
| `tests/sendgrid-doubles/` | offline adapter, kill-point adapter, reader and secret-source re-exports | TEST-ONLY. No `fetch` in the closure |

**`artifacts/control/class-05.credential-scopes.json` IS UNTOUCHED.**
`tests/sendgrid/prerequisites-and-separation.test.ts` still asserts — and passes — that the
shipped class-5 declaration carries NO SendGrid credential of either kind, which is why
registering a real SendGrid runtime against the shipped bundle refuses
`CREDENTIAL_NOT_DECLARED`.

---

## 2. RELEASE-CANDIDATE STATE

**There is no release candidate, and building one now would be premature.**

A control-artifact release is a package over ALL SEVEN pre-live inventory members, signed by
both custodians. Class 3 is ready for one; **class 5 is not**, and a candidate built today would
have to either omit the SendGrid credentials — producing a package that cannot admit the
runtime it exists for — or invent them, which `§16` forbids by name:

> Do not activate a real-provider release whose class-5 credential identities are fictional.

`§16` also states the sequencing this rests on:

> exact SendGrid credential IDs cannot be signed until real material-bound identities exist;
> therefore a real class-5 provider release necessarily remains pending provisioning.

So the candidate is **blocked on provisioning, not on repository work**, and the class-3 change
travels in whatever release the owner eventually builds over these bytes.

### What a future ceremony will have to do, in order

1. Provision a real non-production SendGrid account, a `mail.send`-scoped send key and an
   `email_activity.read`-scoped audit key.
2. Select a credential-binding mechanism — an immutable secret-manager credential version, or a
   provider key-id binding — and implement it behind the declared branch in both secret sources.
   **Until this exists, stage 2 of the preflight cannot pass** (S1P-C6).
3. Obtain the two MATERIAL-BOUND non-secret credential identities from that mechanism.
4. Write the two class-5 records with those exact identities, in strictly ascending
   `credential_id` order, with `granted_provider_permissions` as the provider spells them.
5. Run `npm run release:control build / review / approve-primary / approve-second / countersign`
   — the offline ceremony, with the two private keys, on a machine the runtime never touches.
6. Pin the resulting manifest identity in the deployment trust configuration and re-run
   `npm run prelive:verify`.

Steps 1 to 3 are the provisioning `§16` says the release necessarily waits on.

---

## 3. ACTUAL OWNER / PROVIDER RELEASE — **STILL PENDING**

| Item | State | Blocked on |
| --- | --- | --- |
| class-3 `email.send` record | bytes written, unsigned | the owner ceremony, which is not S1P's to perform |
| class-5 SendGrid send credential | **does not exist** | account provisioning + a material-bound identity mechanism |
| class-5 SendGrid audit credential | **does not exist** | the same |
| owner ceremony (primary + second factor + countersign) | **NOT PERFORMED** | owner decision |
| deployment trust configuration | not present in this environment | deployment |
| `npm run prelive:verify` | `NOT_READY` — `TRUST_CONFIG_MISSING` on both planes | deployment. **This is unchanged by S1P**: the same two findings were reported before this slice, because no owner root key exists in this environment |

---

## 4. EVERY PLACE THE ARTIFACT VERSION IS PINNED, AND WHY EACH MOVED

The class-3 `artifact_version` is a signed field, so the three fixtures that construct or assert
a package over these bytes name it literally. All three moved together; none of them is an
authority source.

| File | Role |
| --- | --- |
| `tests/support/controlArtifactFixture.ts` | the spec the fixture package is built from |
| `tests/support/releaseCeremonyFixture.ts` | the release-ceremony fixture's input declaration |
| `tests/controlArtifacts/framing-and-oracle.test.ts` | the hand-authored framing oracle |

`tests/release/candidate-determinism.test.ts` also names an artifact version — `9999-01-01` —
and was NOT touched: it is a deliberately impossible value used to prove a comparison detects a
version change, and it never matched the real one.
---

## Second review §6 — the class-3 release state, restated

The second independent review asks for this to be unambiguous in the repository rather than
inferable from it. Four statements, each with what backs it.

### 1. The checked-in class-3 bytes are an S1P RELEASE CANDIDATE, not an active release

`artifacts/control/class-03.action-catalogue.json` carries the `email.send` entry and the
bumped `artifact_version` (`acos.action_catalogue.2026-09-28`). Those bytes are:

* **unsigned by any owner ceremony** — `tools/control-release/` has not been invoked with a
  private key, no `release-input.json` is committed, and no signed manifest over them exists;
* **the candidate input** to whatever release the owner eventually builds;
* **verified only under TEST keys**, by `tests/support/controlArtifactFixture.ts`, which is
  how every other control-artifact test in this repository verifies repository bytes.

### 2. The accepted active S1O deployment package and pin are NOT replaced

Nothing in S1P writes to a deployment package root, and nothing changes
`ACOS_EXPECTED_ACTIVE_MANIFEST_ID`. `50 §3f` occasion 1 continues to resolve whatever the
deployment's own trust configuration names. The S1P harness reads the ACTIVE bundle through
`activeVerifiedControlArtifacts()` and never publishes one.

The one place a *different* bundle is used is `tests/sendgrid/cli-orchestration.test.ts`,
which injects a TEST-ONLY package through the declared `bundle` seam — see §3 below for why
that package has to exist at all.

### 3. A real class-5 release cannot exist before the credential identities are material-bound

`50 §2g` field 1 is the credential's material-bound identity. The two S1P credential source
mechanisms (`validation/sendgrid/integration/secretSource.ts`,
`validation/sendgrid/audit/secretSource.ts`) declare their binding mechanisms and both are
`UNPROVISIONED`: no provider key id and no deployment secret version exists to bind to.

So a class-5 artifact naming `twilio_sendgrid.validation_send` and
`twilio_sendgrid.validation_audit_read` today would be naming identities that no mechanism
can bind. The preflight refuses exactly this, at
`INTEGRATION_IDENTITY_NOT_MATERIAL_BOUND` / `AUDIT_IDENTITY_NOT_MATERIAL_BOUND`, and
`tests/sendgrid/cli-orchestration.test.ts` drives that refusal through the real CLI.

The class-5 records the offline suites use live in `tests/support/s1pScenarioFixture.ts`,
under test keys, and are never written to `artifacts/`.

### 4. The owner signing ceremony has NOT been performed

No primary signature, no second-factor countersignature, no countersigned manifest. The
second review forbids performing one during this correction, and no step of this correction
approaches one. `docs/implementation/S1P-operator-procedure.md` records the ceremony as
provisioning's, in the order it must run.

### What this means for the class-3 change

It travels in whatever control-artifact release the owner eventually builds over these bytes,
together with a class-5 declaration whose identities are by then material-bound. It is
blocked on provisioning, not on repository work — and the repository now states the blockage
in a form a run can report: `describeLiveComposition` names
`EFFECT_CONSTRUCTOR_NOT_IMPLEMENTED` and `CONSTRUCTOR_VERSION_RECORDS_NOT_PROVISIONED`
among its measured blocks.

---

## Third review §6 — the class-19 CANDIDATE state

`artifacts/control/class-19.effect-constructors.json` now carries TWO records: the existing
`acos.constructor.refund.create`, and

```
constructor_id      acos.constructor.email.send.s1p_validation
action_class        email.send
semantic_major      1
non_semantic_minor  0
```

Its `artifact_version` moved from `acos.effect_constructors.2026-09-24` to
`acos.effect_constructors.2026-09-29`, because repository convention bumps a dated artifact
version whenever its bytes change — the same convention the class-3 `email.send` entry
followed.

### These are CANDIDATE bytes, exactly as the class-3 bytes are

Everything §6 of this document says about the class-3 candidate applies verbatim here:

* **no owner ceremony has been performed** over them — no primary signature, no second-factor
  countersignature, no countersigned manifest;
* `tools/control-release/` has not been invoked with any private key, and no
  `release-input.json` is committed;
* the externally pinned ACTIVE manifest is **not** touched, and
  `ACOS_EXPECTED_ACTIVE_MANIFEST_ID` is unchanged;
* the bytes are verified under TEST keys only, by `tests/support/controlArtifactFixture.ts`,
  which is how every control-artifact test in this repository verifies repository bytes;
* `50 §3i`'s class-19 **key-migration obligation remains open**. This slice does not close it,
  does not claim to, and changes nothing about the trust root.

### Why the record had to exist before the ceremony, not after

`50 §3i` admission decides membership on the tuple
`(constructor_id, action_class, semantic_major, non_semantic_minor)` compared against the
VERIFIED class-19 bytes. A signed `ConstructorVersionRecord` whose tuple the artifact does not
declare is **refused** — `CONSTRUCTOR_RECORD_NOT_MANIFESTED`. So the owner cannot sign a record
for the validation constructor until the candidate bytes name it. The candidate is the thing
the future ceremony signs.

### One identity, used everywhere

The constructor id is the same string in six places, and the tests assert the agreement:

| Where | What carries it |
| --- | --- |
| implementation | `validation/sendgrid/harness/validationEmailConstructor.ts` |
| S1P live registry | `s1pLiveConstructorRegistry()` |
| class-19 candidate | `artifacts/control/class-19.effect-constructors.json` |
| future signed record | the tuple a `ConstructorVersionRecord` must carry to be admitted |
| authority lineage | `ConstructorVersionIdentity` on the S1P authorisation |
| tests | `tests/sendgrid/validation-email-constructor.test.ts` |

The grammar is the ARTIFACT's — `acos.constructor.<...>` — deliberately.
`constructors/refundCreate.ts` declares `ctor.refund.create` while the artifact declares
`acos.constructor.refund.create`; `tests/release/class19-admission.test.ts` records that
divergence as a residual of class 19 having had no production authority consumer at v1.3.6.
S1P is the first slice to run a constructor THROUGH that admission, so it does not inherit it.

The `s1p_validation` suffix is load-bearing documentation. A reader of the signed class-19
bytes must not be able to mistake this for a general production email implementation — and it
is not one: `email.send` remains `UNGOVERNED_FAILS_CLOSED` for ordinary traffic, with no Cedar
permit, and `tests/policy/policy-set-gap-analysis.test.ts` proves that by execution.
