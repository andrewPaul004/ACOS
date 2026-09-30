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

---

# OWNER DECISION — Azure Key Vault immutable secret version binding

This closes the credential-binding question `50 §2g` field 1 left open. It is a DEPLOYMENT
MECHANISM decision; no Azure resource is created by the repository, and none exists yet.

## The rule

1. SendGrid credential material is stored as an Azure Key Vault **secret**.
2. ACOS always fetches an **exact version**.
3. ACOS **never** resolves `latest` for a credential used by an accepted signed class-5 record.
4. The signed class-5 `credential_id` is the **full versioned Key Vault secret id** Key Vault
   returns for the exact material:
   `https://<vault>.vault.azure.net/secrets/<secret-name>/<version>`
5. ACOS does not construct authority from a mutable alias.
6. The secret source obtains the material, the name, the version and the full id **from the
   same Key Vault response**.
7. The source returns `credentialIdentity = properties.id`,
   `identityProvenance = DEPLOYMENT_SECRET_VERSION`, `version = properties.version`.
8. The accepted integration and audit hosts independently compare that returned identity
   against the signed class-5 `credential_id`.
9. A mismatch fails closed **before any SendGrid provider boundary**.

## Authentication

`ManagedIdentityCredential` with an **explicitly configured user-assigned managed identity
client id**, and nothing else.

Forbidden in live code, and asserted absent by
`tests/sendgrid/key-vault-binding.test.ts`: `DefaultAzureCredential`, `AzureCliCredential`,
`AzureDeveloperCliCredential`, `EnvironmentCredential`, `ClientSecretCredential`,
`ClientCertificateCredential`, `ChainedTokenCredential`, `UsernamePasswordCredential`,
`InteractiveBrowserCredential`, `DeviceCodeCredential`, and any other fallback chain.

The reason is determinism: the identity that retrieves vendor material must not be able to
become a developer login or another Azure principal, and a credential CHAIN is precisely a
mechanism for silently becoming something else.

The managed-identity client id is **non-secret deployment configuration** and appears in the
locator. **No Azure access token, client secret or certificate is passed by the control
plane** — the credential-holding child obtains its own token through managed identity.

## Packages

| Package | Version | Why |
| --- | --- | --- |
| `@azure/identity` | `4.13.1` | `ManagedIdentityCredential` only |
| `@azure/keyvault-secrets` | `4.11.2` | `SecretClient.getSecret` only |

Pinned exactly, matching this repository's dependency style. **`@azure/identity@4.13.2` and
later require Node ≥22** while `package.json` declares `>=20.11.0`; `4.13.1` is the newest
version that supports Node 20 *and* clears the `uuid` advisory that reaches `@azure/msal-node`
on earlier 4.x releases. No management-plane SDK, no ARM client, no CLI wrapper, no generic
HTTP client and no custom OAuth implementation was added.

## The locator

A CLOSED, non-secret operand set, carried in the deployment document the opaque locator names:

```
sourceKind               SECRET_MANAGER_VERSION
vaultUrl                 https://<vault-name>.vault.azure.net
secretName               <key-vault-object-name>
secretVersion            <32-hex immutable version>   REQUIRED
managedIdentityClientId  <user-assigned identity GUID>
```

No field may carry SendGrid material, an Azure token, an Azure client secret, or an expected
class-5 identity. The parser constructs its result field by field and never spreads the
document, so an `apiKey` added by a confused operator reaches nothing.

**The expected class-5 identity is deliberately absent from the locator.** The locator says
WHERE and WHICH VERSION to resolve; it does not say what identity to CLAIM. The expected
identity reaches the runtime independently through the accepted host machinery, and the
comparison happens there.

## The closed destination

`vaultUrl` is validated to `https://<vault-name>.vault.azure.net` **before** `SecretClient` is
constructed: no HTTP, no credentials in the URL, no port, no query, no fragment, no path, no
arbitrary hostname, no IP literal. Azure Government, China and private-cloud endpoints are
**not** admitted in this S1P slice; adding one is an explicit future extension rather than a
looser pattern.

## The future non-production layout

Nothing below exists yet. These are **deployment inputs**, and no subscription id, tenant id,
vault name, managed-identity id or credential appears in repository defaults.

### Integration plane

* one dedicated SendGrid `mail.send` API key;
* one Azure Key Vault secret holding that key;
* one exact Key Vault secret version;
* one dedicated **user-assigned managed identity** granted read on that secret.

### Audit plane

* a **separate** SendGrid `email_activity.read` API key;
* a **separate** Key Vault secret and source;
* its own exact secret version;
* a **different** user-assigned managed identity granted read on that source.

Use **Azure RBAC** (`Key Vault Secrets User` on the secret scope), not legacy Key Vault access
policies. Grant the narrowest scope that works: the secret, not the vault, where the
deployment permits it.

The two planes stay independent by construction: the integration runtime receives no audit
locator, the audit runtime receives no integration locator, the coordinator holds neither
SendGrid key and no Azure token, and `createAuditReaderRegistry` refuses
`READER_LOCATOR_SHARED_WITH_INTEGRATION` when the two collide.

## Rotation, and why it cannot move authority

A signed class-5 record names ONE exact versioned secret id. Rotation therefore runs:

1. create a **new** Key Vault secret version;
2. capture the **new** full versioned secret id Key Vault returns;
3. create or update the **candidate class-5 record** to name it;
4. perform a **new signed release**;
5. only then deploy the new version to the runtime locator.

If only step 5 happened, the source would resolve the new version honestly — it is a real
exact version — and the accepted host would compare the returned identity against the signed
one and **refuse, before SendGrid**. `tests/sendgrid/key-vault-binding.test.ts` cases 29 and 30
drive exactly that.

**A signed class-5 identity can never silently follow a new Key Vault version.**

## Class 5 is deliberately NOT edited yet

`artifacts/control/class-05.credential-scopes.json` carries **no** SendGrid records and no
placeholder Key Vault ids. Real full versioned ids do not exist until the secrets are
provisioned, and a fake one would make the candidate look more complete while making the
authority false.

The real sequence is:

1. provision the non-production Key Vault resources and the two managed identities;
2. create the two scoped SendGrid keys;
3. write each key into its own vault;
4. **capture the exact returned versioned secret id for each**;
5. use those exact ids as the class-5 `credential_id`s;
6. build the release candidate;
7. owner + second-factor signing;
8. deploy the pins and the locators;
9. run S1P.

Steps 1–8 are provisioning and ceremony. None of them is repository implementation.

---

## Correction — the locator is CLOSED, and the Azure principals must be DISTINCT

The independent reviewer accepted the core binding and named two narrow defects. Both are
fixed, and both were cases where the implementation's *comment* was stronger than its *code*.

### 1. The live locator is closed by REJECTION, not by selective reading

The first implementation called the locator closed while `parseKeyVaultLocator` read the four
operands it wanted and **ignored everything else**. A live document carrying `apiKey`, a
fabricated `credentialIdentity` or an Azure `accessToken` parsed successfully — the forbidden
values reached nothing, but they were tolerated.

**Tolerating a secret is the defect.** An operator who put a key in a locator would get a
working run and no signal; the material would sit in a deployment file nothing audits, and the
next reader of that file would reasonably conclude it belonged there.

The live `SECRET_MANAGER_VERSION` document now accepts an **exact field set** and nothing else:

| Integration | Audit |
| --- | --- |
| `adapterId` | `providerId` |
| `sourceKind` | `sourceKind` |
| `revoked` | `revoked` |
| `vaultUrl` | `vaultUrl` |
| `secretName` | `secretName` |
| `secretVersion` | `secretVersion` |
| `managedIdentityClientId` | `managedIdentityClientId` |

Anything else refuses `LOCATOR_FIELDS_NOT_CLOSED`, and the check runs **first** — before
`ManagedIdentityCredential` is constructed, before `SecretClient` is constructed and before any
Key Vault read. The tests prove that half by asserting the reader factory was never called:
ignoring and rejecting look identical from the outside until you count the constructions.

`revoked` is admitted because `§24`'s revocation switch is a property of the source rather than
of the mechanism — a deployment must be able to turn a live credential off without rewriting
its locator into another shape.

**`FILE_FIXTURE` keeps its own, wider, test-only schema.** Closing the live locator did not
close the fixture one, and the fixture stays honest: its provenance is
`SYNTHETIC_TEST_IDENTITY` whatever its document claims.

### 2. Distinct user-assigned managed identities are a GATE, not a recommendation

The test named *"the two planes use DISTINCT managed identities and DISTINCT vaults"* proved no
such thing: it built two fixture constants with different GUIDs and asserted the constants
differed. A real deployment could have configured **one** managed identity for both planes and
passed every gate.

Each **source** now reports the non-secret Azure principal it is configured to resolve as,
from its **own** closed locator parse, inside its **own** one-shot process. The value travels
on the existing identity-probe reply as `sourcePrincipalIdentity`.

The coordinator still reads **no** locator file, holds **no** SendGrid material and holds
**no** Azure token. A managed-identity client id is a GUID: it names a principal and
authenticates nobody, which is why it may cross the reply when a token may not.

Three stage-2 gates consume it, before the capability probes and before any provider operation:

* `INTEGRATION_SOURCE_PRINCIPAL_UNAVAILABLE`
* `AUDIT_SOURCE_PRINCIPAL_UNAVAILABLE`
* `CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT`

**`FILE_FIXTURE` reports `null`** and must: a file-backed fixture authenticates to no Azure
principal, and reporting a plausible GUID would let an offline mechanism satisfy a gate that
exists to constrain a live Azure configuration.

#### These are two independent controls

| Control | Question it answers |
| --- | --- |
| `CREDENTIALS_NOT_DISTINCT` | **which SendGrid material** each plane resolved |
| `CREDENTIAL_SOURCE_PRINCIPALS_NOT_DISTINCT` | **which Azure principal** was allowed to resolve it |

Neither substitutes for the other. Two planes can hold two genuinely distinct SendGrid keys, in
two genuinely distinct Key Vault secrets, both readable by **one** over-privileged managed
identity: every credential-identity check passes, and the separation `48 §3.6`'s read-only
exemption rests on does not exist. Both directions are driven, each asserting the *other* gate
did not fire.

### What this means for provisioning

The future non-production layout is unchanged, and one line of it is now enforced rather than
advised: the integration plane and the audit plane must be granted **different** user-assigned
managed identities. Configuring one identity for both will refuse at stage 2, before any
capability probe and before any SendGrid operation.
