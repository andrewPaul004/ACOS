# S1O — result

**Credential-risk definition, the audit-plane provider-read boundary, and provider selection.**
Baseline `e9ec232`. Branch `feature/s1o-provider-selection-audit-boundary`.
**Operating Spine v1.3, package issue v1.3.7 — issued by this slice.**

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

## 2. The three transformations

```
1.  before   ADR-024's trigger operand   —  prose in six deliverables, no mechanism
    after    50 §2g field 6, signed class-5 bytes, read by the registry

2.  before   audit plane ──► (nothing)
    after    audit plane ──► closed read-only boundary ──► dedicated reader runtime ──► provider

3.  before   provider                    —  Postmark, PARTIAL on blocker C
    after    Twilio SendGrid, selected on a documented DISJOINT scope pair
```

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
| **Twilio SendGrid** | **DOCUMENTED** — `POST /v3/api_keys` takes an explicit `scopes` array; `["mail.send"]` | **DOCUMENTED** — `email_activity.read` is a separate documented scope in a separate group; a key may carry one without the other | **DOCUMENTED** — `GET /v3/messages`, `GET /v3/messages/{msg_id}`, documented query language | **DOCUMENTED** — `categories` and `custom_args`/`unique_args`, both documented Email Activity filter fields | **DOCUMENTED** — `mail_settings.sandbox_mode.enable`; validated, never delivered | **SELECTED** |
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

---

## 6. `48 §3.6` — three obligations, separated by their evidence

v1.3.6 carried them as one clause. v1.3.7 separates them because they have different evidence
and different status, and because collapsing them is how a declaration comes to stand in for a
vendor test:

| Obligation | Evidence | Status |
|---|---|---|
| *separately provisioned* | its own source, its own runtime, its own allowlist | **mechanised** |
| *read-only* | `50 §2g` fields 6 and 7, over signed bytes | **mechanised** |
| *attempted-write-tested* | a write attempted with the audit credential **fails at the PROVIDER** | **NOT DISCHARGED BY ANY SIGNED DECLARATION — OPEN** |

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
| `I8` | no vendor side exists to sweep |
| `I20` | `"provider-reported accepted"` needs a real provider read |
| `I36` verification leg | needs a provider's accepted count |
| Class 5's owner signature | no production signing code exists |
| Option B, the execution proxy | the trigger is executable; the proxy is not built |
| Whether SendGrid sandbox mode produces a queryable activity record | **the load-bearing account-level unknown** — if it does not, the validation slice needs a dedicated non-production sending identity and a controlled sink recipient rather than sandbox mode |
| The Email Activity history entitlement | `CAPABILITY DOCUMENTED — ACCOUNT VALIDATION PENDING` |
| Whether v3 `custom_args` are returned by the `unique_args` filter | pending; `categories` is the unambiguous fallback on both sides |
| The 6 req/min Email Activity rate limit against six-kill-point volume | pending |

---

## 10. S1M resume readiness

| | |
|---|---|
| integration boundary (S1N) | **green**, unchanged |
| audit read boundary | **green**, synthetic credential, seven leak surfaces clear, sibling isolation proved with two live processes |
| selected provider | **Twilio SendGrid** |
| credential scopes normatively compatible | **yes** — `mail.send` is `NON_MONETARY_WRITE` under `50 §2g`, so one email adapter continues under option A; `email_activity.read` is `READ_ONLY` and earns `48 §3.6`'s exemption's *declaration* half |
| local architecture blocker | **none** |

**`READY_TO_PROVISION_SENDGRID_SANDBOX_CREDENTIALS`**

**This is not a statement that provider validation is complete.** It is a statement that
nothing in this repository now blocks provisioning them, and that five account-level items
are recorded and waiting.
