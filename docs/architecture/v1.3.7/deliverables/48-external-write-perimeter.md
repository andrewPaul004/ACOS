# 48 — The External-Write Perimeter

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. New in v1.1.**
Created in response to R4. Governed by ADR-023. Enforced by I24 and I25.

## v1.3 change record

The `I8` period-bounded query rule and the override dispatch tag bind here (TA-03, TA-05). Full disposition in `phase2-v1.3-remediation-ledger.md`.

> **v1.3 note (TA-03, TA-05).** Two additions bind on this artifact. The audit plane's `I8` inverse-sweep reads are **period-bounded and never parameterised by an ACOS-side identifier or tag set** — a CI/review assertion, control artifact class 26 (`30 §5.10`). And every dispatch made under a `DegradedModeOverride` carries both `DISPATCHED_UNMIRRORED` and `override_id` at the perimeter, and enters the next `I8` verification list (`30 §5.7.2`).


**This is a maintained artifact, not a snapshot.** It is reviewed quarterly alongside the policy-set diff `30 §6.4` already requires, and updated whenever an adapter, a reconciler or an exporter is added. `46`'s closing section is explicit about why it must be maintained rather than completed: *"a perimeter is a standing obligation, not a gate that is passed once"* — the first adversarial review found six paths the architecture's author did not name, and the next reviewer will find more.

---

## 1. Why this artifact exists

`33 §1` v1.0 opened its five-sentence summary with *"Every external state change passes through one deterministic chokepoint, the Effect Gateway."* `42 §1` enumerated every component in the architecture capable of originating an outbound HTTP request and found **fourteen**, of which **six could write to an external system with no authorisation row and no journal entry.**

**None of the six is reachable from a model-bearing runtime**, which is why `47` classified this as a wording defect rather than a fatal one. But two consequences were real:

- **EM9's exact-countability claim depended on the strong version.** *"The governed quantity is ungated agent actions per month"* is only countable if every external write carries an authorisation row. Six paths did not.
- **`36 §7`'s contract test asserted the strong version and could not have detected the violation.** It tested that adapter *methods* are reachable only through the gateway. Four of the six paths are not adapter methods.

The distinction the architecture needs:

> ***"The only permitted path"* is a policy. *"The only capable path"* is an architecture.**

v1.0 established the first and claimed the second. The CI check in §4 is what converts one into the other, and it is the only mechanism that survives this enumeration being incomplete — an unannotated vendor-call site fails the build whether or not anyone has thought about it.

---

## 2. The enumeration

Fourteen rows. The `authorisation_ref` column is the load-bearing one: **`REQUIRED` means the call site must carry a resolvable authorisation reference; `EXEMPT` means it carries an annotated `PERIMETER_EXEMPT(reason, ticket)` and appears in §3's justification table.**

| # | Component | Plane | External write? | Model-reachable? | v1.0 status | v1.1 `authorisation_ref` |
|---|---|---|---|---|---|---|
| 1 | Commerce adapter (Shopify Admin GraphQL) | Integration (Z2) | Yes | No | Authorised | **REQUIRED** |
| 2 | Communications adapter (ESP) | Integration (Z2) | Yes | No | Authorised | **REQUIRED** |
| 3 | Payment-processor adapter (Stripe test mode) | Integration (Z2) | Yes | No | *Did not exist* | **REQUIRED** |
| 4 | Advertising adapter (mock at MVP) | Integration (Z2) | Yes | No | Authorised | **REQUIRED** |
| 5 | Finance **ingest** adapter (provider cost APIs, payout, bank line) | Integration (Z2) | Reads only | No | **Ambiguous — placed in two planes** | **EXEMPT** (read-only; §3.5) |
| 6 | **Webhook subscription watchdog** | Kernel (Z1) | **Yes** | No | **Unauthorised** | **REQUIRED** — now a governed effect class (§5.1) |
| 7 | **Reconciler resolution / re-POST** | Kernel (Z1) | **Yes** | No | **Unauthorised** | **REQUIRED** — now a governed effect class (§5.2) |
| 8 | **Credential refresh / token rotation** | Integration (Z2) | **Yes** (vendor-side state change) | No | **Unauthorised** | **EXEMPT** (§3.1) |
| 9 | **Framework-managed OAuth and webhook registration** (`shopify-app-js`) | Integration (Z2) | **Yes** | No | **Unauthorised** | **EXEMPT** (§3.2) |
| 10 | **Migration / DDL principal** | Out of plane | No external write, but **can alter the audit schema** | No | **Unnamed** | **EXEMPT** (§3.3) — and a named TCB member (`49`) |
| 11 | **Observability exporter (Sentry)** | Cross-cutting | **Yes** (data egress) | No | **Absent from every egress table** | **EXEMPT** (§3.4) |
| 12 | Observability exporter (Langfuse) | Cross-cutting | Yes | No | Absent from every egress table | **REMOVED** (`31 §10`) |
| 13 | **Audit plane vendor reads** | Audit | Reads only | No | *Did not exist* | **EXEMPT** (read-only; §3.6) — **v1.3.7: the exemption's operand is `50 §2g` fields 6 and 7, and the `36 §13` attempted-write test remains separately owed** |
| 14 | **External anchoring writer** | Audit | **Yes** | No | *Cadence unspecified* | **EXEMPT** (§3.7) |
| 15 | Egress proxy (research worker fetches) | Sandbox | Reads only, allowlisted, budgeted | **Yes** | Authorised as read | **EXEMPT** (read-only, deferred with the research worker) |

**Four rows are `REQUIRED` and were unauthorised in v1.0 (6, 7) or did not exist (3).** Six rows carry annotated exemptions. Two rows are new because v1.1 added capabilities. One row is removed.

**And note row 5.** v1.0 placed the finance capability in the control plane (`33 §2.1`) and in the integration plane (`28 §3`) simultaneously, while `23 §3` said the control plane holds only its own database credential. All three could not be true. The split — ingest holds credentials and computes nothing, computation holds no credential and is CI-checked for the absence of both a model client and a credential loader (I25) — is what resolves it.

---

## 3. The exemptions, each justified

An exemption is not a hole. It is a **named, annotated, reviewed** hole, and the difference is that a reviewer can find it.

### 3.1 Credential refresh (row 8)

**What it does.** Exchanges a refresh token for an access token, or rotates a secret. This mutates vendor-side state.

**Why exempt.** It is a precondition of every authorised effect, so requiring an authorisation for it is circular: the authorisation could not be dispatched without the credential the refresh produces.

**Compensating controls.** Runs in the adapter's own runtime with no other capability. Its own rate limit. Every refresh is journaled as a `credential.refresh` **record** (not an effect), and the audit plane raises a finding on refresh-rate anomalies — an attacker using refresh as a liveness oracle produces a visible pattern. `credential.create`, `credential.rotate` and `credential.export` remain **categorically prohibited** for every AI principal (`26 §6`), and refresh is not any of them.

**Residual.** A compromised adapter can keep its own credential alive indefinitely. This is subsumed by the adapter being a TCB member (`49`), not additional to it.

### 3.2 Framework-managed OAuth and webhook registration (row 9)

**What it does.** `shopify-app-js` performs OAuth exchange and, in some configurations, webhook registration as part of app lifecycle rather than as an ACOS-initiated effect.

**Why exempt.** It runs at installation and configuration time under an owner-authenticated flow, not during operation.

**Compensating controls.** `callbackUrl` comes from **configuration, never from a parameter** — the single most important control here, because a parameterised callback is a redirection primitive. Framework-managed registration is **disabled where the framework permits it**, and `webhook.subscription.assert`/`.delete` (row 6, §5.1) is the governed replacement. The perimeter CI check treats the framework's HTTP client as a vendor client and requires the annotation.

**Residual.** A framework upgrade could reintroduce an unannotated call. The CI check is what catches it, which is the point of annotating at the call site rather than maintaining a list.

### 3.3 Migration / DDL principal (row 10)

**What it does.** Applies schema changes to the control database and, in v1.0's unstated design, to the audit database.

**Why exempt.** It performs no external write.

**Why it is on this list anyway.** `41 §3.4` names it and v1.0 did not: **a principal that can `ALTER` the audit schema can remove the constraints that make the audit store append-only**, which is EM16 defeated at the layer beneath the grant. The perimeter's purpose is enumerating what can reach past the gateway, and this reaches past everything.

**Compensating controls.** Named as a TCB member. **Audit-schema DDL is an owner-authenticated action recorded as a decision** (`33 §2.5`). The audit instance is on a separate account with separate operator credentials (`31 §2`). Hourly external anchoring (I17b) bounds retroactive alteration to one hour — **this is the only control that survives a compromised DDL principal**, which is why the cadence is stated rather than left as "periodic".

### 3.4 Observability exporter (row 11)

**What it does.** Sends exception payloads to Sentry from processes including credential-holding ones.

**Why exempt.** It is not an effect on the business; it is telemetry egress.

**Why v1.0 was wrong to omit it.** `29 §4` claimed kernel egress is *"Database; adapters; audit store."* Sentry payloads routinely carry request bodies, headers and environment. Either the table was wrong or the selected tooling could not function. And Langfuse's payload — prompt/completion pairs — is **case-scoped PII** for a support worker, with a 72-hour GDPR Art. 33 consequence if the vendor is breached.

**Compensating controls.** A **positive scrub allowlist of permitted fields, enforced in code before any exporter call** — not a denylist of forbidden ones. **No support-worker context is exported to a third-party tracing vendor, ever.** Langfuse is removed until self-hosting inside the VPC is in place.

**Residual.** The allowlist is code, and code has bugs. The mitigation is that the allowlist is a control artifact under B9 (`50`), so it cannot be widened without an owner signature.

### 3.5 Finance ingest (row 5) and 3.6 audit plane vendor reads (row 13)

**Why exempt.** Read-only. Neither mutates external state.

**Compensating controls.** Row 5's org-scoped model-provider admin credential is enumerated in §6 rather than assumed benign — it plausibly covers `credential.*` and spend-limit configuration, both prohibited classes — and is subject to I15's empirical probe. Row 13's credentials are **read-only, separately provisioned, and attempted-write-tested** (`36 §13`). Where a vendor offers no read-only scope (Google Ads), the audit credential is a **separate login with viewer-level account access** rather than API scope separation, and that residual is stated rather than engineered away.

**v1.3.7 — ROW 13'S EXEMPTION NOW HAS A SIGNED OPERAND (`S1N-C1`).** *"Read-only"* was a prose
property of an audit-plane vendor credential and named no artifact that declared it, so the
exemption rested on an assertion nothing verified. **`50 §2g` field 7,
`external_mutation_capable`, is that operand, and `50 §2g` field 6's `credential_risk_class`
must be `READ_ONLY` for a credential to earn this row's exemption.** Both are class-5 content:
signed, dual-signed, and manifest members.

**THE THREE OBLIGATIONS ARE NOW DISTINGUISHED RATHER THAN CONFLATED, because they have
different evidence.**

| Obligation | Evidence | Status at v1.3.7 |
|---|---|---|
| *separately provisioned* | the audit credential resolves from its own source, in its own runtime, and no control-plane or integration-send process can reach it | **mechanised** — the audit-plane provider-read runtime and its own secret source |
| *read-only* | `50 §2g` fields 6 and 7 over signed bytes | **mechanised** — and a declaration that disagrees with its own permission list is REFUSED at verification |
| *attempted-write-tested* | an attempted write with the audit credential **fails at the PROVIDER** (`36 §13`) | **NOT DISCHARGED BY ANY SIGNED DECLARATION.** It is an EMPIRICAL obligation and it stays open until a configured provider account refuses a real attempted write |

**A SIGNED `READ_ONLY` DECLARATION IS NOT THE ATTEMPTED-WRITE TEST AND MUST NOT BE REPORTED AS
ONE.** The declaration says what the deployment believes it provisioned; `36 §13` asks the
vendor. A provider whose only credential able to read the required evidence is also able to
send **cannot earn this exemption by declaring `READ_ONLY`**, because the declaration would be
false and the vendor would prove it false. That is a **provider-selection** finding, and
`50 §2g`'s consistency check is deliberately unable to rescue it.

### 3.7 External anchoring writer (row 14)

**What it does.** Writes `{head_hash, chain_seq, row_count}` hourly to a medium the database operator cannot rewrite, and delivers a copy to the owner.

**Why exempt.** Requiring an authorisation for the mechanism that makes authorisations verifiable is circular, and the anchor must be written even when effects are halted.

**Compensating controls.** Write-only, append-only, one destination from configuration. A **missing anchor is itself an incident** — this is the one exempt path whose *silence* is monitored rather than only its activity, because an attacker's first move against anchoring is to stop it.

---

## 4. Enforcement

Four mechanisms. The first two are the ones that matter.

1. **One vendor-HTTP client per adapter.** No ad-hoc HTTP construction anywhere in the codebase. A single audited client type per adapter, and the linter forbids raw HTTP libraries outside it.
2. **Every vendor-call site carries `authorisation_ref` or `PERIMETER_EXEMPT(reason, ticket)`.** **CI fails the build on an unannotated site** (I24). This is the mechanism that survives the enumeration being incomplete.
3. **A runtime assertion refuses an adapter invocation carrying neither.** Defence in depth against a call path CI did not see — a dynamically dispatched framework callback, for instance.
4. **No control-plane process holds a vendor credential** (I25), CI-checked on the dependency tree and the injected environment. This is what makes the plane boundary mean something: a control-plane component that acquires a vendor call site fails the build twice.

**v1.2: two additions to the annotation contract.**

5. **`KERNEL_SERVICE` call sites carry an `authorisation_ref`, not an exemption** (SR-S3). The standing-pause path dispatches through the gateway under a `StandingRevocationAuthority`, so it is an authorised effect with a journal row and an audit write, and `26 §7.1` enumerates exactly which policy steps it skips. **It must not be annotated `PERIMETER_EXEMPT`** — a kernel-originated vendor write with no authorisation reference is precisely the shape the perimeter exists to make impossible, and the fact that the kernel rather than a model originated it is not a justification.

6. **`enumerate_effects` reads are journaled, not exempt** (SR-C2). Enumeration issues vendor-adjacent reads to construct its option set. These are reads, so they do not cross the *write* perimeter, but they are journaled with `journal_row_kind = READ` under the same rate limiting as any other capability, because an unbounded read capability is a probing oracle even when it moves no money.

**Why network policy is not on this list.** `42 §1.3`: every unauthorised path in §2 runs from a process that legitimately requires egress **to the same vendor host, over the same port, with the same credential, to the same endpoint** as an authorised path. **Network policy separates planes. It cannot separate purposes within a plane.** It remains valuable for the plane boundaries and is not the perimeter control.

---

## 5. The two paths that became governed effect classes

### 5.1 `webhook.subscription.assert` / `webhook.subscription.delete`

**Why it must be governed.** A webhook subscription determines what ACOS believes about the outside world. Deleting one makes the company blind in a way that no invariant detected in v1.0, and creating one with an attacker-chosen `callbackUrl` is a redirection primitive.

**Design.** REVERSIBLE class. `callbackUrl` is computed by the canonicaliser from configuration and is **not a field of any intent or any parameter** (I21). The watchdog's assertion is dispatched through the gateway like any other effect, so it carries an authorisation row and a journal entry, and `webhook.subscription.delete` requires the higher approval tier because its consequence is blindness rather than action.

### 5.2 Reconciler resolution

**Why it must be governed.** `25 §8.3`'s reconciler resolves an `OUTCOME_UNKNOWN` effect by querying or re-POSTing. **A re-POST is an external write** — and in v1.0 it carried no authorisation row, so the one path in the architecture that deliberately re-sends a money-moving request was the path with no authorisation.

**Design.** The re-POST is dispatched through the gateway **under the original authorisation and the original idempotency key**, and is **refused if the reservation has been released or has expired** — `RESERVATION_ABSENT`, `26 §12.1`. **v1.2 (C5b):** v1.1 cited `I31` here, which states only that no second reservation row is created and says nothing about an absent one; the correct citations are `I51` for non-increase and the `RESERVATION_ABSENT` denial for absence. The reconciler cannot create a new authorisation, and it cannot top up a reservation. `25 §8.3`'s inverse sweep moves to the audit plane (I8) so that the component looking for unjournaled effects is not the component that can create them.

---

## 6. Credential inventory at the perimeter

Cross-referenced with `29 §3.3`'s enforceability table and `49`'s TCB membership.

| Credential | Held by | Scope reality | Prohibited classes it can reach |
|---|---|---|---|
| Shopify custom-app offline token | Commerce adapter | **Never expires**; scopes set at the app, not per request | `payment_method.add` conditionally (via `customerPaymentMethod*`); `theme.checkout.write` avoidable by omitting `write_themes` |
| Stripe restricted key | Processor adapter | **Genuinely scope-separable** — the one real exception in this stack | `dispute.representment.submit` separable |
| ESP server token | Communications adapter | Sends anything to anyone | **`email.campaign.send` is indistinguishable from `email.send`** — no credential-level enforcement, so the campaign class is non-autonomous |
| Google Ads OAuth (`adwords`) | Advertising adapter | Full scope required for **any GAQL read**; mutates campaign budgets **and** `AccountBudgetProposal` | **`platform.budget_limit.raise` — no credential-level enforcement.** SR10's corollary is unsatisfiable here |
| Meta `ads_management` | Advertising adapter | No sub-scope for account `spend_cap` | **`platform.spend_cap.raise` — none** |
| Model-provider org-admin key | Finance ingest | Includes API-key and workspace management | **Plausibly `credential.*` and spend-limit configuration.** Replaced with a purpose-scoped key where the provider offers one; otherwise the residual is stated and probed (I15) |
| Secret-manager IAM | Deployment only | Not held by any adapter | `credential.create/rotate/export` — genuinely enforced |
| Audit-instance grant | Control plane | `INSERT` only, under quota | `audit.update/delete` enforced; **`audit.insert` of false rows is not** |
| Audit-plane read credentials | Audit plane | Read-only, attempted-write-tested | — |

**The honest summary, restated from `29 §3.3`: eight of twelve prohibited classes are genuinely double-enforced, two are conditional, and two have no credential-level enforcement at all.** v1.0's `26 §6` asserted double enforcement for all twelve. The two with none are marked non-autonomous, and I15's continuous probe is what keeps the other ten honest — because a scope model that is checked by comparing ACOS's own labels to ACOS's own prohibition list passes vacuously.

---

## 7. Review obligation

**Quarterly, alongside `30 §6.4`'s policy-set diff.** The review asks four questions:

1. Has any adapter, reconciler, watchdog, exporter or framework upgrade added a vendor-call site since the last review?
2. Has any `PERIMETER_EXEMPT` justification stopped being true?
3. Has any vendor changed its scope model in a way that moves a row in §6 — in either direction?
4. Has the CI check been disabled, weakened, or worked around for any build?

**Question 4 is the one that matters most**, and it is the one a reviewer is least likely to ask. A perimeter enforced by a check that someone turned off for a release is not a perimeter, and CI/CD is a named TCB member for exactly this reason (`49 §3.10`).
