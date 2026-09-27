# S1O — result

**Credential-risk definition, the audit-plane provider-read boundary, and provider selection.**
Baseline `e9ec232`. Prior candidate `6890bfb`. Branch
`feature/s1o-provider-selection-audit-boundary`.
**Operating Spine v1.3, package issue v1.3.7 — issued by this slice and CORRECTED IN PLACE
after owner review.**

> **THE OWNER RETURNED THE FIRST S1O CANDIDATE PARTIAL ON TWO FINDINGS**, and this document
> records the corrected slice rather than the candidate:
>
> 1. **the SendGrid Sandbox Mode capability record was factually wrong** — the official
>    documentation states that sandbox requests generate no Event Webhook and no Email
>    Activity events, and the record carried `null` plus an account-validation item;
> 2. **the signed class-5 credential declaration was not structurally bound to the credential
>    material the secret source resolves** — so a signed risk declaration could govern a
>    credential the runtime was not holding.
>
> v1.3.7 was not owner-accepted, so it is corrected in place. **There is no v1.3.8, and
> `docs/architecture/v1.3.6/` remains byte-identical.**

---

## 1. What S1O answers

S1N closed the integration-plane credential boundary and left one question the owner had to
settle. ADR-024 builds the execution proxy *"at the first **money-moving credential** or the
third adapter, whichever comes first"*, and **v1.3.6 did not define `money-moving credential`
as a mechanised predicate anywhere.** S1N derived one from `50 §2a` field 4 and flagged it as
`S1N-C1`.

**The owner ruled that derivation wrong in kind:**

> **MONEY-MOVING IS A PROPERTY OF THE CREDENTIAL'S CAPABILITY ENVELOPE AT THE PROVIDER. IT IS
> NOT A PROPERTY OF THE ACTION ACOS CURRENTLY INTENDS TO CALL.**

`29 §14` is why it is load-bearing, and v1.3.6 already carried it: *"vendor OAuth scopes are
coarser than ACOS action classes on every platform examined."*

**The difference is observable on this repository's own deployed bytes.**
`campaign.budget.set` declares `carries_vendor_monetary_field: false`, so S1N's derivation
called **every** `mock_ads` credential `NON_MONETARY`. v1.3.7 asks what the credential reaches
at the provider, and the deployed class-5 artifact carries two `mock_ads` credentials that
answer differently: `pause_only` is `NON_MONETARY_WRITE` and is admitted; `budget_manage`
reaches `campaign.budget.set`, which is `§2g` clause 9 — *"increase a budget, spend cap,
credit line, or analogous provider-side authority that permits additional spend"* — is
`MONEY_MOVING`, and is refused. **Same adapter, same action catalogue, different answer.**

---

## 2. The four transformations

```
1.  before   ADR-024's trigger operand   —  prose in six deliverables, no mechanism
    after    50 §2g field 6, signed class-5 bytes, read by the registry

2.  before   audit plane ──► (nothing)
    after    audit plane ──► closed read-only boundary ──► dedicated reader runtime ──► provider

3.  before   provider                    —  Postmark, PARTIAL on blocker C
    after    Twilio SendGrid, selected on a documented DISJOINT scope pair
            AND on a test path that can carry I36's evidence

4.  before   the signed record and the resolved material  —  two chains, never compared
    after    signed credential_id == resolved credential identity, checked in the
            credential-holding process, before the provider boundary, on BOTH planes
```

**Transformation 4 is the correction, and it is the load-bearing one.**

---

## 3. The credential risk class

| | |
|---|---|
| enum | `READ_ONLY`, `NON_MONETARY_WRITE`, `MONEY_MOVING`. **Exactly three, no `UNKNOWN`** |
| signed owner | **control-artifact class 5**, `50 §2g` — Owner + second factor, manifest member, the **seventh** pre-live artifact |
| definition | nine clauses over what the credential can do **at the provider**, *without requiring a second independently held credential* |
| mixed capability | **maximum privilege** — "the highest reachable, never the lowest, never the average and **never the intended**" |
| missing | **FAILS CLOSED.** `CREDENTIAL_NOT_DECLARED` in both registries; the lookup returns `null`, never a default |
| self-inconsistent | **REFUSED at parse.** Six shapes, each with its own reason |
| Option-B trigger | fewer than three adapters **AND** every credential other than `MONEY_MOVING`. Whichever occurs first wins |

**The classification is DECLARED, not derived.** `AdapterRuntimeDescriptor` names a
`credentialId` and has **no member a deployment could put a risk class in** — so S1N's
`declaredCredentialClass` and its `CREDENTIAL_CLASS_UNDERSTATED` cross-check are both removed.
A declaration that has to be cross-checked is one somebody can make; the class-5 record is one
the owner signed.

---

## 3a. The credential identity binding (the correction)

**A signed declaration has to be ABOUT something, and the candidate's was not.** Field 1 read
*"a credential identifier, unique within the artifact"*, which a nickname satisfies, and the
two chains never met:

```
signed class-5 `credential_id`  ->  risk class  ->  the registry admits the runtime
`secretLocator`                 ->  material    ->  presented at the provider boundary
```

| | integration plane | audit plane |
|---|---|---|
| the attack | signed `pause_only` = `NON_MONETARY_WRITE`, locator resolves `budget_manage` = `MONEY_MOVING` | signed `audit_read` = `READ_ONLY`, locator resolves a SEND-CAPABLE token |
| what breaks | **ADR-024's option-B trigger never fires** on the credential in hand | **`48 §3.6`'s exemption rests on a declaration about a different credential** |
| what passes anyway | descriptor, catalogue, signed record, authorisation binding, payload hash | signed record, `audit_plane` sentinel, `READ_ONLY` echo, locator disjointness |

| | |
|---|---|
| field 1 | **the stable non-secret identity of the EXACT MATERIAL the runtime may present** — a provider key ID, or an immutable deployment/secret-manager identity. **Never the secret, its hash, or a token prefix** |
| if no such identity exists | **the slice that would configure that provider returns PARTIAL.** A binding that is only a label is not recorded as one |
| secret-source contract | `credentialIdentity` is **MANDATORY and non-null** on both planes, with a declared `identityProvenance` — `PROVIDER_KEY_ID`, `DEPLOYMENT_SECRET_VERSION` or `SYNTHETIC_TEST_IDENTITY` |
| where the comparison happens | **inside the credential-holding child**, because `I25` forbids the parent seeing resolved material |
| what the parent passes | the expected `credential_id` as a **trusted non-secret launch echo**. NOT authority — the signed artifact is, and the parent verified it before forking |
| integration refusal | `CREDENTIAL_IDENTITY_MISMATCH`, guard 7 of 8, **before any adapter code runs** |
| audit refusal | `CREDENTIAL_IDENTITY_MISMATCH`, guard 7 of 8, **before `readFromProvider`** |
| locator controls | **unchanged and still enforced.** A locator says where to look; an identity says what was found |

**LOCATOR SEPARATION DOES NOT IMPLY IDENTITY BINDING, IN EITHER DIRECTION.** Two locators may
resolve one credential, so inequality proves no separation; one locator may be repointed, so
equality proves no identity. Both controls are kept, and
`audit-credential-identity-binding.test.ts §3` asserts both halves on the same fixtures.

**AND THE BINDING IS NOT SCOPE CONFORMANCE.** It proves *"this is credential A"*. It does not
prove *"credential A still holds the provider permissions the signed record declares"* — a
scoped provider key is mutable at the provider with no ACOS-observable event. **Scope drift
remains an empirical provider-side obligation and S1O does not close it.**

---

## 4. The audit provider-read boundary

| | |
|---|---|
| process | a real `child_process.fork`; **PID differs from the control process and from the integration runtime** |
| credential source | `AuditReadSecretSource`, keyed by **PROVIDER**, `resolve()` takes **no argument** |
| environment | an **eight-key** constructed allowlist, **disjoint from the integration plane's by computation** rather than by inspection |
| control send credential | **absent by name** from the reader's own reported environment, along with both database URLs |
| shared secret source | **refused at construction** — a locator the integration plane holds is `READER_LOCATOR_SHARED_WITH_INTEGRATION` |
| write capability | **none, and none expressible.** Fourteen mutation member names refused, plus any member outside the declared three, at composition before material is resolved |
| IPC | three read operations, ten request fields, twelve refusals. **No `url`, `path`, `endpoint`, `host`, `origin`, `method`, `headers`, `body` or `query` member exists**, and nothing in the package constructs a `URL` |
| unknown operation | **REFUSED** |
| period bound | **mandatory on every operation.** A correlation tag narrows a period-bounded read, never replaces it (`48` v1.3 note) |
| independence | `deriveIndependentFinding` takes **two** operands and `AuditExpectation` has **no member a control-plane verdict could occupy** |
| the signed record it acts on | read by the **AUDIT PLANE'S OWN verifier**, from its own copy through its own deployment variables — never from the control plane's bundle |

**The last row is the one an accepted test forced.** The first implementation took a
`VerifiedControlArtifactBundle`, and `audit-plane.test.ts`'s *"no module under `src/audit/`
imports the control plane's trust chain"* failed. The assertion was right: an audit reader
admitted on the control plane's reading of the record that says it is read-only is an audit
plane trusting the plane it audits for its own independence. Recorded as `S1O-C3`.

**And the audit plane keeps only `audit_plane`-scoped records**, so it never learns a send
credential's identity at all. `§13`'s "no control send credential" is a fact about what that
plane can see rather than a check it performs.

---

## 5. Provider selection

| Provider | Send-only | Read-only audit | Query evidence | Correlation | Sandbox | Result |
|---|---|---|---|---|---|---|
| **Twilio SendGrid** | **DOCUMENTED** — `POST /v3/api_keys` takes an explicit `scopes` array; `["mail.send"]` | **DOCUMENTED** — `email_activity.read` is a separate documented scope in a separate group; a key may carry one without the other | **DOCUMENTED** — `GET /v3/messages`, `GET /v3/messages/{msg_id}`, documented query language | **DOCUMENTED** — `categories` and `custom_args`/`unique_args`, both documented Email Activity filter fields | **DOCUMENTED, AND NOT THE `I36` PATH** — `sandbox_mode.enable` validates without delivering **and generates no Event Webhook or Email Activity event**. The `I36` path is a dedicated non-production identity with `sandbox_mode=false` | **SELECTED** |
| Mailgun | DOCUMENTED — Domain Sending Key, `kind: domain` / `role: sending` | **UNRESOLVED** | DOCUMENTED — `GET /v3/{domain}/events` | DOCUMENTED — `o:tag` / `tags` | DOCUMENTED — sandbox domain | **NOT SELECTED — unresolved** |
| Postmark | (S1M) | **ABSENT** | (S1M) | (S1M) | (S1M) | **NOT SELECTED under the current credential model** |

**Mailgun is `UNRESOLVED`, not `ABSENT`, and the difference is load-bearing.** A `basic`
(analyst-level) key is creatable and the RBAC table gives Analyst *Read* on Messages and Logs
— but the table has **no Events row at all**, `GET /v3/{domain}/events` states **no role
requirement**, and `POST /v1/analytics/logs` publishes **no complete filter attribute list and
no retention window**. `§22`: *"Do not infer Events access merely from the word 'Analyst.' If
official endpoint/role mapping cannot establish it: mark Mailgun unresolved."* `ABSENT` would
have made Mailgun a second Postmark; `UNRESOLVED` leaves it measurable by a later slice.

**Postmark is carried forward unchanged and its S1M evidence is untouched.** The reason is
S1M's own: an API credential able to read the required outbound message log is also
send-capable, so `36 §13`'s attempted-write refusal cannot be demonstrated. **`I8` and
`36 §13` were not weakened to accommodate it** — S1O acts on the finding by not selecting the
provider.

**Retrieval date: 2026-09-26. Every row's `basis` is `PUBLISHED_DOCUMENTATION`; not one is
`MEASURED_AGAINST_ACCOUNT`. No provider request of any kind was made.**

### 5a. The sandbox correction, and the compatibility rule it forced

**`SANDBOX_ACTIVITY_EVIDENCE = ABSENT`, from the provider's own documentation.** Twilio
SendGrid's Sandbox Mode page states that the message is never delivered **and that requests
made in sandbox mode generate no events in either the Event Webhook or Email Activity.** The
candidate recorded `producesQueryableActivity: null` and carried the question as an
account-validation item; **the documentation had already settled it**, so the item was one no
account could ever close.

| Sandbox mode IS for | Sandbox mode is NOT for |
|---|---|
| request-shape validation against the real API | real-provider accepted-count evidence |
| credential-scope validation at real enforcement | the `I36` six-kill-point oracle |
| | Email Activity correlation |
| | Event Webhook reconciliation |

**AND FIVE INDEPENDENT CAPABILITY CHECKS WERE NOT ENOUGH.** Each of `§19`'s five terms can be
true of a *different* configuration of one provider, so a provider passed on "it has a sandbox"
plus "it has an activity API" while the sandbox is precisely the mode that suppresses the
activity API. `evidencePathIncompatibility` is the structural check that closes it, over ONE
declared path:

```
real API request -> provider accepts/processes -> provider-side evidence EXISTS
                 -> the INDEPENDENT read-only audit credential can observe it
```

**SendGrid remains selected**, because its `I36`-compatible path exists: a dedicated
non-production sending identity, `sandbox_mode=false`, a narrowly scoped `mail.send` key, a
separate `email_activity.read` audit key, the Email Activity history entitlement, a verified
sender and an **owner-controlled sink recipient**. No customer recipient, no production
message. **Mailgun is now blocked twice over** — the unresolved audit credential, and an
unresolved evidence path.

---

## 6. `48 §3.6` — three obligations, separated by their evidence

v1.3.6 carried them as one clause. v1.3.7 separates them because they have different evidence
and different status, and because collapsing them is how a declaration comes to stand in for a
vendor test:

| Obligation | Evidence | Status |
|---|---|---|
| *separately provisioned* | its own source, its own runtime, its own allowlist | **mechanised** |
| *read-only* | `50 §2g` fields 6 and 7, over signed bytes | **mechanised** |
| *the credential in hand IS the declared one* | the reader compares the signed `credential_id` to what its own source resolved, **before any provider query** | **mechanised by the correction** — and none of the three above implies it |
| *attempted-write-tested* | a write attempted with the audit credential **fails at the PROVIDER** | **NOT DISCHARGED BY ANY SIGNED DECLARATION — OPEN** |
| *the credential's permissions have not drifted* | empirical probes against the configured account | **NOT DISCHARGED BY THE BINDING — OPEN** |

**A SIGNED `READ_ONLY` DECLARATION IS NOT THE ATTEMPTED-WRITE TEST.** The declaration says
what the deployment believes it provisioned; `36 §13` asks the vendor. A synthetic reader
refuses a write because this repository wrote it to, and that proves the ACOS side and nothing
about any vendor.

---

## 7. What did not change

- `src/kernel/gateway/effectGateway.ts` — **not one line**.
- The claim, the outbox, the ledger, the journal, the two hash chains.
- `26`'s authority model. `50 §2g` says so explicitly: *"a `MONEY_MOVING` credential does not
  grant ACOS any authority."*
- Class 3: still **exactly ten per-class fields plus four catalogue-level records**.
- MAL, every grant, every cap, every floor, every threshold. `recompute-v1.3.py` reproduces
  its recorded output.
- `docs/architecture/v1.3.6/` — **`git diff e9ec232 -- docs/architecture/v1.3.6/` is empty.**

---

## 8. Three accepted assertions amended, out loud

`45 §3` warns about accepted boundary assertions changed quietly. None of these was quiet.

1. **`perimeter-enumeration.test.ts`** asserted two perimeter roots. S1O adds
   `tests/audit-plane/` and a new case requiring every `PROVIDER_READ_CLIENT` site to be
   `TEST_ONLY`, `EXEMPT` and annotated `audit_plane_read_only / 48-3-6`, with **zero** send
   clients under the audit plane. `48 §3`: an exemption is a *named, annotated, reviewed*
   hole, and an unenumerated read is unreviewed rather than exempt.
2. **`integration-controls.test.ts` CONTROLS 12–13** asserted S1N's `derivedCredentialClass`
   and `movesValueUnderBroadReading`. **Both functions are removed** — they computed the
   answer the owner ruled wrong in kind — and the controls now assert the signed lookup plus a
   third case proving one adapter's two credentials classify differently.
3. **`deployment-dry-run.test.ts`** spliced a class-17 entry at a **literal index** encoding
   the inventory's length. Class 5 moved it and both cases silently stopped testing the
   deployment pin. The index is now derived from the classes present.

**And one v1.3.6 gate condition was amended: K14**, from four live inventory rows to five,
with the count still asserted as an equality so a row losing its second signature still fails.
Recorded in `phase2-v1.3.7-verification.md §3`.

---

## 9. What remains OPEN

| Obligation | Why it is still open |
|---|---|
| `36 §13` empirical attempted-write test | needs a real SendGrid account; a synthetic reader proves the ACOS side only |
| **Credential scope conformance** | identity binding proves *which* credential; it does not prove the credential's provider permissions still match the signed record. Needs empirical probes against the account |
| `I8` | no vendor side exists to sweep |
| `I20` | `"provider-reported accepted"` needs a real provider read |
| `I36` verification leg | needs a provider's accepted count |
| Class 5's owner signature | no production signing code exists |
| Option B, the execution proxy | the trigger is executable; the proxy is not built |
| The dedicated non-production SendGrid account/subuser | not provisioned. **Sandbox mode is NOT this environment** — the correction settles that |
| The Email Activity history entitlement | `CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING` |
| The two scoped keys, read back from the account | pending: that `mail.send` carries only that, and that the audit key LACKS `mail.send` |
| Whether a normal non-production send is queryable on that account | pending |
| Whether v3 `custom_args` are returned by the `unique_args` filter | pending; `categories` is the unambiguous fallback on both sides |
| The 6 req/min Email Activity rate limit against six-kill-point volume | pending |
| The controlled recipient / verified sender configuration | pending |

**`SANDBOX_ACTIVITY_EVIDENCE = ABSENT` IS NO LONGER ON THIS LIST.** The candidate carried it as
pending; the official documentation settles it, and it is recorded as a resolved negative
instead.

---

## 10. S1M resume readiness

| | |
|---|---|
| integration boundary (S1N) | **green**, unchanged |
| audit read boundary | **green**, synthetic credential, seven leak surfaces clear, sibling isolation proved with two live processes |
| selected provider | **Twilio SendGrid** |
| credential scopes normatively compatible | **yes** — `mail.send` is `NON_MONETARY_WRITE` under `50 §2g`, so one email adapter continues under option A; `email_activity.read` is `READ_ONLY` and earns `48 §3.6`'s exemption's *declaration* half |
| local architecture blocker | **none** |

**`READY_TO_PROVISION_TWILIO_SENDGRID_NONPRODUCTION_TEST_CREDENTIALS`**

**THE TOKEN CHANGED, AND NOT COSMETICALLY.** The candidate emitted
`READY_TO_PROVISION_SENDGRID_SANDBOX_CREDENTIALS`, which names the provider's sandbox mode —
the mode its own documentation says produces no Email Activity and no Event Webhook events.
The token described an environment in which `I36` can observe nothing.

**What the corrected token means:** the repository is **LOCALLY** ready to provision
credentials for a **dedicated non-production SendGrid validation environment**.

**What it does NOT mean:** not sandbox mode; not that provider validation is complete; not
production readiness; not that any credential exists. **Eight account-level items are recorded
and waiting, and one documented negative is carried beside the token so the environment cannot
be misread.**
