# 29 — Integration Architecture and Security Threat Model

**ACOS Operating Spine v1.3. Version 1.3. Issued 2026-09-03. Supersedes v1.1 (2026-09-02).**
Covers Phase 2 brief Parts 15 and 16. Depends on `22`–`27`.

## v1.3 change record

No change in v1.3. Version line bumped so the package carries one version; `phase2-v1.3-changelog.md §7` records which artifacts were materially edited and which were not.

## v1.1 change record

| Change | Remediation | Section |
|---|---|---|
| **§3 rewritten.** "Short-TTL, audience-bound, action-scoped" is deleted as a description of *vendor* credentials — no such credential exists to issue on the selected platform. The broker issues internal capability tokens; vendor secrets are long-lived, app-scoped and held per adapter in a cloud secret manager. **Adapters are declared TCB members.** | R5, R20 | §3 |
| The **per-class credential-enforceability table** is published. Two of twelve prohibited classes have no credential-level enforcement at all; those classes are non-autonomous. | R5 | §3.2 |
| **I15 is replaced** with a continuous empirical probe. As written it compared ACOS's own scope labels to ACOS's own prohibition list and passed vacuously. | R5 | §3.3 |
| **Observability exporters enter the egress inventory.** Sentry and Langfuse were outbound third-party channels from credential-holding and PII-bearing processes and appeared in no egress table. Langfuse is dropped. | R4 | §4 |
| SR10's corollary restated: platform caps are a detection surface where vendor scopes cannot separate operating from limit-setting authority. | R5 | §6.1 |
| Threat table: #4, #6, #8, #11, #19, #21, #23, #24 updated; three new rows for adapter-mediated authority escalation, control-artifact modification and duplicate irrecoverable sends. | R5, R6, R11, R13 | §7 |
| §9's compromised-CEO walkthrough updated for the four exposure quantities and the two rows the single-invocation test cannot reach. | R8, R15 | §9 |
| §14's residual ranking gains the TCB residual at rank 1. | R4, R5 | §14 |


---

## 1. The standard this document is written to

> **Assume the model can be compromised by hostile context. Then ask: what prevents that compromised model from exceeding authority?**

The evidence for taking this literally rather than defensively:

- **Nasr et al.** (arXiv:2510.09023) broke **12 of 12** published prompt-injection defences with adaptive attackers. Lowest ASR in the table: 71%. Human red-teaming: **100%**.
- **Agent Security Bench** peak ASR **84.30%**, on a benchmark covering e-commerce and finance.
- **Anthropic's own best published figure is 1% ASR** against an internal Best-of-N attacker, with Anthropic's own caveat that this *"still represents meaningful risk. No browser agent is immune to prompt injection."* `07 §1`: at 1% residual, an agent seeing 1,000 untrusted inbound items per month — a trivially small ecommerce inbox — expects ~10 successful hijacks per month. Against an adaptive attacker the planning number is **>70%**.
- **Anthropic blocks Claude for Chrome from financial-services sites by default.** `07 §1`: *"The lab with the best measured injection resistance does not let its own agent near financial sites unattended."*
- **OWASP 2026** keeps Prompt Injection at #1 and raises Excessive Agency to #3, with the framing: *"Stop trying to build a model that cannot be fooled. Build the system around it, so that when the model is fooled, and it will be, nothing important breaks."*

Every control below is therefore evaluated on one question: **does it hold when the model is the attacker?**

---

# Part I — Integration and credential architecture

## 2. Tool tiers

| Tier | Definition | Who may invoke | Credential |
|---|---|---|---|
| **READ** | Retrieves data. No external state change. | Reasoning workers, from a closed per-contract catalogue | None held by the model. The kernel proxies; the adapter holds the credential. |
| **PROPOSE** | Emits a typed `EffectProposal`. **No external effect.** | Reasoning workers with `allowed_action_classes` | None |
| **WRITE** | Performs an external state change. | **Effect Gateway only** | Adapter-held, **long-lived and app-scoped where the vendor issues them that way** (§3) |
| **HIGH-RISK WRITE** | Irrecoverable, high-exposure, or novel-counterparty | Effect Gateway only, after approval | Adapter-held, separately scoped where the vendor's scope model permits, separately audited |

**SR1 in operational form: a reasoning worker has exactly one non-read capability — `propose_intent`.** There is no per-vendor write tool anywhere in a model's tool list, so there is no per-vendor write tool to misconfigure, poison, shadow or bypass. **v1.1: and the model no longer supplies the parameters of the write** — it supplies an action class, a resource reference, a selector index and a reason code, and the kernel constructs the dispatched request (`26 §2`).

**v1.1 correction to this table's fourth column.** v1.0 described adapter credentials as short-TTL and action-scoped. That is not what the stack delivers, and §3 replaces it.

This is worth stating against the specific evidence it neutralises:

| Documented failure | Why it cannot occur here |
|---|---|
| *"Auto-approved tools never reach `canUseTool`"* — a tool approved by an allow rule silently skips the approval callback (`08 §8.2`) | No money tool exists in the model's tool list. The check is not in a callback; it is in a separate process on the other side of a proposal boundary. |
| *"`allowed_tools` does not constrain `bypassPermissions`"* | Same. There is nothing to bypass to. |
| Subagents inherit the parent's permission mode, non-overridably | Subagents are separate work items with their own principals, resolved by the kernel, not inherited from a process. |
| MCP **line jumping** — malicious `tools/list` descriptions reach model context before any tool is invoked or approved (`07 §3`) | Tool descriptions for READ tools are ACOS-authored and hash-pinned; a third-party server's description is not injected into a context that can propose. Per-tool human approval is not used as a control anywhere, per Trail of Bits' finding that it is defeated by construction. |
| MCP scopes cannot encode *"max $200 per ad-budget change"* (`07 §6`) | Numeric envelopes live in the policy engine, not in a scope. |

**READ tools are also constrained.** A read tool that takes an arbitrary URL is an exfiltration channel. Read tools have parameterised, non-URL signatures wherever possible (`get_order(order_id)`, not `http_get(url)`). Free-URL fetching exists in exactly one place: the quarantined ingestion tier, which holds no credentials, no PII, and no `propose_intent`. **v1.1: it does emit one typed structured signal** — `red_class_signal{class, confidence, span_ref}` to Ingress in Z1 (`26 §9.5`), schema-validated and carrying no free text, which is what closes the non-text-borne escalation gap without letting Z4 reach Z3.

## 3. Credentials

**The load-bearing rule** (`07 §5`): *an agent should never hold a credential that can move money by itself.* `07 §12` adds why it is the load-bearing rule: **the credential boundary is the only boundary whose failure probability is not governed by model robustness.** That rule holds, and it is satisfied: no model runtime holds any vendor credential, and no attack in `40` reached one.

### 3.1 What v1.0 described does not exist (R5, CRD-01, CRD-02)

v1.0 described the broker as issuing *"short-TTL, audience-bound, action-scoped tokens, to adapters only, per invocation."* Tested against the platform this architecture selects:

- **Shopify custom-app offline access tokens do not expire.** They last until the app is uninstalled or the secret is revoked, and access scopes are configured **at the app**, not per request. There is no TTL to shorten, no audience to bind, and no action to scope.
- So the broker could not have been issuing the *vendor* credential with the described properties, because no such credential exists to issue. It was issuing either an **internal capability token** describing what the bearer may ask the adapter to do, or the long-lived vendor token itself with a short-lived wrapper around it.
- And an internal action-scoped token constrains the vendor credential **only if the component presenting the vendor credential enforces the constraint.** The presenter is the adapter. The adapter would be enforcing a restriction on itself. That is an audit tag, not a security boundary.

**Two consequences, both adopted.**

> **Adapters are inside the Trusted Computing Base** (`49`). Each presents a vendor credential whose scope exceeds the action classes it serves, and each writes facts the policy engine trusts. There is no design in which they are not — see §3.4.

> **Internal capability tokens do not reduce external vendor credential scope.** They are useful for attribution and for refusing obviously wrong calls early. They are not a scope-narrowing mechanism and v1.1 does not claim they are.

### 3.2 The MVP credential model: option A

`42 §4` gives two designs. **Option A is adopted for the MVP and the broker component is removed** (`45 §3`):

```
Per adapter:
  one long-lived vendor secret, in the platform secret manager
  injected at process start, never shared with another adapter
  per-adapter runtime, filesystem and dependency-tree isolation
  a per-credential revocation switch that REVOKES, not one that stops the loop
  bank-line ingest in its own runtime with its own dependency tree
```

With two adapters and no money, a broker adds a TCB member and delivers nothing. **Option B — the broker as an execution proxy** — is specified in ADR-024 and built at the first money-moving credential or the third adapter, whichever comes first. Its two benefits are real and neither is available under option A: action scoping becomes enforceable **at the point the credential is presented**, and raw vendor responses can be retained outside the adapter, which is what makes provenance stop being self-attested (`24 §6`).

### 3.3 Which categorical prohibitions are actually double-enforced

`26 §6` claims each prohibited class is denied by policy **and** absent from every issuable credential. `42 §5`'s enumeration, published as a maintained table:

| Prohibited class | Credential-level mechanism | Real? |
|---|---|---|
| `payee.create`, `payee.bank_details.modify` | No vendor endpoint exists; no processor payout scope is ever created | **Yes** |
| `payment_method.add` | Shopify `customerPaymentMethod*` mutations exist under customer/payment scopes; enforceable only by omitting a scope the app may need for other reads | **Conditional** |
| `credential.create/rotate/export`, `oauth.scope.modify` | Secret-manager IAM; no adapter holds it | Yes |
| `payment_page_code.write`, `theme.checkout.write` | Omit `write_themes` | Yes |
| `authority.*` | Internal database grants (B9) | Yes |
| `audit.write/close/delete` | Audit instance grant is `INSERT` only | Yes for update and delete; **no** for insert of false rows |
| `platform.spend_cap.raise` (Meta), `platform.budget_limit.raise` (Google) | **None.** One `adwords` scope covers GAQL reads, campaign-budget mutation and `AccountBudgetProposal`; Meta's `ads_management` has no sub-scope for account `spend_cap` | **No** |
| `review.create`, `testimonial.create` | No native endpoint on the selected platform | Yes, contingent on not installing a reviews app with API access |
| `tax.filing.*`, `entity.*`, `contract.execute` | No credential exists | Yes |
| `dispute.representment.submit` | Separable with a Stripe restricted key; not separable from Shopify Payments dispute scopes | **Conditional** |
| `email.send` versus `email.campaign.send` | **None.** One ESP server token does both | **No** |

**Eight of twelve are genuinely double-enforced. Two are conditional. Two have no credential-level enforcement at all** — and **classes with policy-only enforcement are marked non-autonomous** (`26 §9.9` applies this to `email.campaign.send`). One of the two is the layer `35 §7` v1.0 described as holding *"even if the entire control plane misbehaves."*

**I15 is replaced (CRD-07).** As written — *no principal holds a credential scope covering a prohibited action class* — it is not mechanisable, because vendor scopes are coarser than ACOS action classes; implemented literally it compares ACOS's own scope labels to ACOS's own prohibition list and **passes vacuously**. The empirical form: for each prohibited class with a reachable vendor endpoint, a **scheduled probe attempts the operation against a sacrificial resource and asserts vendor-side failure. A succeeding probe is a critical incident.** `36 §7` prescribed this as a one-off test; it becomes continuous.

### 3.4 Why there is no third option

Any design in which no ACOS component holds a credential capable of exceeding a single action requires the **vendor** to issue per-action credentials. No platform in this stack does: Shopify's scopes are app-level; the Google Ads API requires the full `adwords` scope for any GAQL query including a pure read; Meta's `ads_management` covers create/update/pause/delete across campaigns, ad sets and ads; ESP server tokens send anything to anyone. **Stripe restricted keys are the one genuine exception and are worth using for exactly that reason.**

### 3.5 Rules that survive unchanged

| Rule | Source |
|---|---|
| Server-side authorization independent of claimed scopes | `07 §5` |
| Override the MCP fallback that directs clients to request all scopes in `scopes_supported` when the challenge carries none | `07 §6` — *"directly at odds with least privilege"* |
| Credential-holding runtimes must not install dependencies: pinned lockfiles, disabled post-install scripts, allowlisted registries | `07 §10.16`; postmark-mcp clean to v1.0.15, backdoored at v1.0.16; Shai-Hulud 2.0 across ~350 accounts; LiteLLM PyPI 47,000 downloads in a 3-hour compromise window |
| Credential-holding runtimes and dependency-installing runtimes share no filesystem or environment | `07 §12` |
| **Per-adapter** runtime, filesystem and dependency isolation — not merely per-plane (v1.1) | `42 §4`; `43 §6` — settlement independence requires the commerce, processor and bank adapters not to be co-compromised |
| A kill switch that **revokes credentials**, not merely one that stops the loop | `07 §10.6` |
| No credential exists, at any scope, capable of a categorically prohibited action — **verified empirically and continuously, not by label comparison** (v1.1, I15) | EM17, `26 §6`, `42 §5.2` |
| **The build pipeline is a TCB member** (v1.1). v1.0's supply-chain rule protected the *runtime* and said nothing about the pipeline that builds it — and Shai-Hulud 2.0 and the LiteLLM window, both cited below as runtime risks, were **build-time** compromises. CI/CD also runs every check in `36` that constitutes this architecture's evidence, so a green pipeline is the only artifact anyone sees. `49 §3.10`. | `41 §3.10` |

## 4. Egress

Deny-by-default, per-runtime, per-session.

| Runtime | Permitted egress |
|---|---|
| Reasoning worker (Z3) | Model provider endpoint; kernel API. Nothing else. |
| Quarantined ingestion (Z4) | The single fetch target for this item, via an egress proxy; model provider. No kernel API. |
| Adapter (Z2) | **Its own** vendor endpoints, allowlisted per adapter. Not another adapter's. |
| Kernel (Z1) | Database; adapters; audit store; **the external anchoring destination (I17b)**; **the observability exporter, subject to §4.1**. |
| Audit plane | Its own store; **its own read-only vendor endpoints** (R10); the anchoring destination. |

### 4.1 Observability is an egress channel, and v1.0 did not inventory it (R4, SPO-06)

v1.0's table said kernel egress is *"Database; adapters; audit store."* **Sentry was selected in `31 §10` and Langfuse was a nominated secondary view, and neither appeared here.** Sentry exception payloads routinely carry request bodies, headers and environment — from **credential-holding** processes. Langfuse ingests prompts and completions, which for a support worker are **case-scoped PII** with a 72-hour GDPR Art. 33 consequence if the vendor is breached. Either the table was wrong or the selected tooling could not function.

Three changes:

1. **Observability enters the inventory** as a named egress destination with a scrub allowlist **enforced in code before any exporter call** — a positive list of permitted fields, not a denylist of forbidden ones.
2. **No support-worker context is exported to a third-party tracing vendor**, ever.
3. **Langfuse is dropped** until the inventory exists and self-hosting inside the VPC is in place (`45 §3`, ADR-012). It was a secondary view by ADR-012's own framing; the authoritative record is ACOS's own event schema and is unaffected.

**Allowlists rot, and the architecture assumes it.** `07 §3` — every verified exfiltration ran over a permitted channel: EchoLeak through a CSP-allowed Teams proxy; ForcedLeak through a domain the owner let expire, **repurchased for $5**; AgentFlayer through Azure Blob Storage, trusted by name; ShadowLeak inside the provider's own cloud. Therefore:

- Allowlist entries carry an **expiry** and an **ownership-change monitor** as a running job (`07 §10.11`).
- Shared infrastructure (blob stores, CDNs, paste services) is **not** allowlisted by hostname; where unavoidable, it is allowlisted by full path prefix plus a content-type constraint.
- The egress proxy blocks private and link-local ranges including **`169.254.0.0/16`** (cloud metadata), pins DNS, and permits only `http`/`https` — rejecting `javascript:`, `data:`, `file:`, `vbscript:` per the MCP spec's MUSTs. The spec's own advice is followed: *"Avoid implementing IP validation manually"* (`07 §6`).
- **No agent-controlled URL rendering anywhere.** Markdown image URLs were the exfiltration vector in AgentFlayer and EchoLeak.

## 5. MCP posture

`07 §6`'s framing is adopted: **MCP is a good capability transport and is not an authorization system or a durability layer.**

| Use | Verdict |
|---|---|
| READ capabilities from vetted servers | Permitted, hash-pinned, fail-closed on description change |
| WRITE capabilities | **Not used.** Writes go through ACOS adapters behind the Effect Gateway |
| Number of concurrently connected servers | Minimised deliberately — `07 §12`: the count is itself a risk multiplier |
| Conformance | Audited: no token passthrough, per-client consent, exact-match `redirect_uri` (never wildcards), SSRF egress proxy, no wildcard scopes, the "request all supported scopes" fallback overridden |
| Co-location | An untrusted-content server and a money-moving server are never in one session. Since no money-moving MCP server is used at all, this is satisfied trivially. |

`07 §6` also notes three spec revisions in ~14 months, two breaking, with third-party servers lagging by months. MCP is therefore an integration detail behind an adapter interface, not an architectural commitment (`34 ADR-011`).

## 6. Platform-facing agent identity

EM11, implemented in K14.

| Platform | Obligation | Implementation |
|---|---|---|
| **Amazon** (BSA effective 2026-03-04) | Agents must *"clearly identify themselves as automated systems"*, comply with the Agent Policy, and *"cease access if Amazon requests"* | Declared identity on every request; a per-platform kill switch that revokes adapter credentials, not a flag that asks nicely. **The Agent Policy's operative text is UNRESOLVED** (`17 §5.1`) — it is not served to unauthenticated readers. Any Amazon integration is blocked on obtaining it. |
| **Shopify** | Published agent profile at an HTTPS URL declaring UCP version and capabilities; trust tiers gate checkout completion | The published capability declaration is **generated from the action catalogue**, so it cannot drift from what ACOS can actually do. Trust-tier downgrade raises an incident. |
| **Etsy** | API Terms (2026-08-18) bar API use for *"analytics, machine learning, training artificial intelligence models"* **and** bar *"automated systems or browser extensions"* accessing Etsy data | Both routes closed for intelligence. Operating a shop under Seller App access is a different activity. Enforced as an adapter-level capability restriction, not a guideline. |
| **Google Ads** | AI-labelling policy from July 2026: visible overlays for campaigns targeting the EU, India and New York | Disclosure is a policy-controlled artifact in K14, applied by the Utterance Gate. **v1.1: the API requires the full `adwords` scope for any GAQL query including a pure read, and account-level spending limits are mutated through `AccountBudgetProposal` under that same scope** — so SR10's corollary is unsatisfiable here and the cap is a detection surface (§3.3, I33). |
| **EU** | AI Act Art. 50(1) — customer-facing systems must disclose they are AI | Same. `17 §5.5` corrects the over-broad Phase 1 reading of Art. 50(4). |

---

# Part II — Threat model

## 7. Threat table

Residual is **after** the ACOS control is correctly deployed, under an adaptive attacker.

| # | Threat | Primary ACOS control | Why it holds under a compromised model | Residual |
|---|---|---|---|---|
| 1 | **Direct prompt injection → unauthorised tool call** | Single write tool; policy engine re-derives legality from state it fetches | The model can propose anything; the gate reads none of its prose and none of its asserted facts | **LOW for money.** Bounded by `MAL` |
| 2 | **Indirect prompt injection** (scraped pages, reviews, supplier catalogues, files) | Quarantine (Z4): no credentials, no PII, no propose, no free egress; per-item disposable context; CLAIM grade output | A hijacked ingestion context has nothing to do and nothing to reach | **LOW for authority.** See #20 for the residual that matters |
| 3 | **Malicious documents** | Same quarantine. Parsing context holds no tools | AgentFlayer weaponised an uploaded doc into Drive exfiltration; the equivalent context here has no Drive and no egress | LOW |
| 4 | **Credential exfiltration** | No credential in any model runtime; deny-by-default egress; no agent-controlled URL rendering; allowlist expiry monitoring; **observability scrub allowlist enforced in code (§4.1)** | There is nothing in the *model's* context to exfiltrate. **v1.1: the exception was the exception handler** — Sentry payloads from credential-holding processes were an unenumerated channel | **LOW** from a model runtime; **MODERATE** from a credential-holding runtime until the scrub allowlist is enforced. This is the boundary `07 §12` names as the only one not governed by model robustness |
| 5 | **Tool abuse / excessive agency** | Closed action catalogue; unknown action denied; one write tool | OWASP 2026 raised this to #3; the surface is collapsed to one schema-validated entry point | LOW |
| 6 | **Unauthorised financial action** | Agent holds no money credential; **the kernel constructs the request from authoritative state (`26 §2`)**; deterministic executor re-validates; idempotency; reservation against every named window | Nasr's numbers govern the model, not the gate. **v1.1: and the gate no longer evaluates a figure the model supplied** — which was the largest single defect in v1.0 (MOA-01) | **LOW, bounded by `MAL_total`** |
| 7 | **PII leakage** | Case-scoped context assembly; no bulk customer data in any context; egress deny; no URL rendering | ShadowLeak ran *service-side*, invisible to local defences — which is why the control is "the data is not in the context", not "the egress is watched" | LOW–MODERATE. GDPR Art. 33's 72-hour clock is a kernel object (K10) |
| 8 | **Fraudulent customer requests** | Deterministic refund engine bound to the order record, original instrument, hard caps, rate limits; **address edit and free reshipment count-limited from `MIE_discretionary` with their cost in `MIE_cost`**; **address and recipient fields `IMMUTABLE_AFTER_ORDER`, and recipient resolution uses the address as at order creation** (`24 §8`) | `07 §4.1` names those two as the sharpest tools because they move goods without tripping a monetary cap. **v1.1: and in v1.0 they composed** — an authorised address edit became the precondition for a reship, with the engine never lied to, merely arranged (MOA-09) | LOW for money; MODERATE for goods |
| 9 | **Friendly fraud / refund abuse** | Policy-bounded limits, evidence retention, rate limits, per-customer counters | Merchants estimate 27.1% of returns are abusive; 83.4% of enterprise merchants report friendly fraud rising | **Business-model risk.** Not solvable in architecture |
| 10 | **Supplier fraud / BEC** | **Categorical exclusion.** No credential, no policy path | EM17. IC3 2025: $3.05B, ~$123k average | **NEAR-ZERO by exclusion** |
| 11 | **Compromised external system** | All external systems untrusted; schema-validated inbound; anomaly checks on payee, price, quantity; RECORD grade only from the counterparty's own system | ForcedLeak and EchoLeak both ran through *legitimate* trusted infrastructure | MODERATE |
| 12 | **Malicious URLs / SSRF** | Egress proxy, blocked ranges, DNS pinning, scheme allowlist | Solved pattern; MCP spec's own guidance followed | LOW |
| 13 | **Injection in webpages** | Quarantine (structural); classifier as **telemetry only** | BrowseSafe recall 0.841 (~16% FN); PromptGuard-2 recall 0.213 — a classifier is never a gate here | LOW for authority |
| 14 | **Cross-agent contamination** | **No agent-to-agent channel exists.** Work graph is code-owned; messages are typed kernel objects | Memory poisoning: 100% injection across 2,520 runs; retrieval-layer defences 88.9% ASR. Removing the transport removes the class | **LOW by construction** |
| 15 | **MCP tool poisoning / rug pull / shadowing** | Hash-pinned descriptions, fail-closed on change, minimised server count, **no MCP write path** | postmark-mcp added one BCC line in v1.0.16 | LOW |
| 16 | **MCP line jumping** | Not relied on: per-tool approval is not a control anywhere in ACOS | Trail of Bits: content reaches context before any control is established | N/A |
| 17–18 | **Token passthrough / OAuth confused deputy** | Spec MUSTs implemented and audited | Implementation-error class; conformance is checkable | LOW |
| 19 | **Supply-chain compromise** | Credential runtimes install nothing; lockfiles; no post-install scripts; pinned versions; **per-adapter** separate runtimes | Shai-Hulud 2.0, LiteLLM, postmark-mcp — **all three were build-time compromises, and v1.0's rule protected only the runtime.** CI/CD is now a named TCB member (`49`) | MODERATE, catastrophic if realised |
| **29** | **Adapter compromise escalating into another adapter's authority** (v1.1) | Parser split so grade derives from `(parser_version, transport_identity)` (I26); no OBSERVATION precondition from a single adapter's writes (I27); per-adapter isolation; audit-plane vendor reads detect fabrication by disagreement (I8) | A compromised commerce adapter writing RECORD-grade orders satisfied the `SpendAuthorityCondition` gating advertising budget, unlocking the **ads** adapter without touching the ads credential (REC-01, `24 §10` case 6). An adapter's blast radius is its credential scope **plus every authority whose preconditions its RECORD writes can satisfy** | **MODERATE and not closed.** Adapters are TCB members |
| **30** | **Control-artifact modification** (v1.1) | B9 extended to sixteen artifact classes; owner-signed content-hash manifest (I19); prohibited-commitment grammar run against templates in CI | v1.0's B9 covered six classes and omitted templates, the approved corpus, the grammar, the detectors, promoter rules, `context_spec`s, metric specs, tolerance rules and the adverse-facts thresholds — **every one of which defeats a stated invariant if modified** (REC-05, UTT-02). A single template edit created an unbounded T-U0 commitment surface with nothing noticing | **LOW once the manifest exists**; it did not exist in v1.0 |
| **31** | **Duplicate irrecoverable communication** (v1.1) | ACOS-owned outbox with an at-most-once claim (I36); recoverability-keyed unknown-outcome policy; delivery-event reconciliation; provider-reported count reconciled against reserved units by the audit plane (I20); ESP selection as an EM6 criterion | v1.0 had one unknown-outcome policy for all classes, right for money and wrong for sends in the same way. Gmail bulk-sender status has no expiration and spam rate must stay under 0.1%, so a duplicate storm is a **permanent** domain-reputation event (DUP-01/02/03) | LOW once the outbox exists; the residual is the provider's own at-least-once behaviour |
| 20 | **Competitor poisoning of the decision process** | Provenance, tiering, computed independence, corroboration gates scaled to exposure, `source_first_seen` down-weighting, discovery/evaluation separation in time | **No benchmark. No measured defence.** See §8 | **HIGH — the largest unquantified risk** |
| 21 | **Utterance creates a binding commitment** | Utterance Gate: **T-U0 only at MVP**; per-slot staleness with BLOCK (I35); NFKC + confusable folding against the **rendered** form; rendered-**thread** evaluation (I34); deterministic tier floor the model may only raise; non-text forces T-U2; grammar applied to templates in CI | Moffatt; Cursor. Construction rather than classification, because no FN rate exists for validators. **v1.1: and construction was not sufficient by itself** — `44 §1` produced four ways individually accurate records combine into a misleading statement, and `44 §2.1` produced six commitments that pass the grammar, which is why T-U1 is narrowed to twelve conditions and deferred | **LOW for T-U0. T-U1 unbuilt. The residual moves to T-U2 volume, which is bounded by the owner-attention budget rather than by the utterance gate** |
| 22 | **PCI SAQ A eligibility loss** | Categorical prohibition on payment-page-adjacent code | Eligibility criterion effective 2025-03-31 | **ZERO by exclusion** |
| 23 | **Compromised CEO** | §9 | | Bounded by `MAL_total(detection window)` + `MIE_discretionary` |
| 24 | **Compromised worker** | §10 | | Bounded by that worker's grants |
| 25 | **Malicious webhook payload** | HMAC verify before parse; schema validation; dedupe; **no inference in the webhook path** | A forged payload without a valid HMAC never reaches a parser | LOW |
| 26 | **Replay / duplicate execution** | Three idempotency layers (`25 §7`); deterministic keys | | LOW |
| 27 | **Model-provider compromise or silent behaviour change** | Pinned bindings; eval gate; canary; autonomy demotion on binding change | `08 §9`: no source quantifies cross-version behaviour change | MODERATE — measured internally, not looked up |
| 28 | **Insider / owner-credential compromise** | Not solved by this architecture | Stated rather than papered over. MFA, hardware keys and account hygiene are operational, not architectural | **MODERATE, out of scope** |

## 8. The threat this architecture does not solve

`07 §4.4` and `07 §11.1` are unambiguous, and repeating them here is more useful than a control table:

> A competitor who knows ACOS runs automated niche research can publish plausible false market data, fabricated demand signals, fake supplier listings or manufactured competitive intelligence to steer capital allocation. **There is no benchmark for this attack and no measured defence.** It is *"simultaneously the least-defended and the most ACOS-specific threat in the package, because ACOS's core loop is automated decision-making from public evidence."* And: *"It will not appear in an audit log as an incident. It will appear as a niche that underperformed."*

The controls deployed, with honest efficacy statements:

| Control | Efficacy |
|---|---|
| Provenance on every item (URL, fetch time, content hash, retrieving principal) | Makes post-hoc forensics possible. Prevents nothing. |
| Source tiering with `vendor_interest_flag` | Addresses the *vendor-marketing-laundering* variant (`11 E8`), which is measurable. Does not address a purpose-built poisoning campaign. |
| Independence computed on registrable domain **and** owner entity | Raises cost from "publish one page" to "operate several apparently-unrelated properties". A competent adversary can pay that. |
| `source_first_seen` down-weighting inside a decision window | Catches the naive case where the poison appears after ACOS starts looking. Defeated by patience. |
| Corroboration requirements scaled to exposure | Bounds the loss from any single poisoned decision to that decision's exposure envelope. **This is the only control with a guaranteed effect**, and it is a containment control, not a detection control. |
| Discovery/evaluation separation in time | Prevents one reasoning process from selectively evidencing its own conclusion. Does not detect poison both stages see. |
| Human approval above the exposure threshold | The real backstop, and it depends on the owner's judgement, not the system's. |

**The honest architectural position:** ACOS bounds the *loss* from a poisoned decision and cannot reliably *detect* one. `36 §9` proposes the measurement that does not currently exist anywhere.

## 9. Compromised CEO — worked

**Assume the CEO model is fully controlled by an attacker.**

| Attempt | Outcome |
|---|---|
| Issue a large refund | No refund grant. Denied at `NO_GRANT`. |
| Create a payee, redirect payments | Categorically prohibited; no issuable credential. Denied at `PROHIBITED`, audit-flagged as a high-signal event. |
| Raise its own budget or widen a grant | B9. Owner-only artifacts. |
| Widen a worker's authority | Capability-subset validation: a delegation can only narrow. |
| Spawn maximum tasks to burn budget | Per-pass task cap; objective budget envelopes; queue-level token ceiling below the provider cap. Result: budget exhaustion and an incident, not an outage until the 1st of the month. |
| Exhaust every reachable exposure window | **Succeeds, up to `MAL_total(window)`** — `MAL_monetary` + `MIE_cost` + `Standing`. This is the pre-accepted loss and the honest answer to quality gate 4. v1.0 displayed only the first term. |
| Emit maximum irrecoverable actions | **Succeeds, up to `MIE_discretionary(window)`.** Count-limited per channel, no batching. **Order-driven fulfilment is bounded separately and must not stop when the discretionary counter is exhausted** (I30). |
| Create a standing commitment that outlives detection | **Bounded** (v1.1). A rate-changing authorisation creates a `StandingAuthorization` with mandatory expiry, forward exposure reserved to each window's end, and re-reservation at every boundary; a boundary that cannot be reserved pauses it. v1.0 had no representation for this at all, so one authorised budget change produced spend indefinitely, invisible to MAL. |
| Supply a favourable number to the gate | **Cannot** (v1.1). The kernel enumerates and computes; the model selects (I21). This was the one row v1.0's table could not honestly have contained. |
| Suppress an audit finding | B5. Separate store, separate credentials, mandatory acknowledgement the CEO cannot close. |
| Omit bad news from the briefing | Adverse-facts appendix appended by the audit plane (`27 §5`). Referencing-and-spinning is possible; disappearing is not. |
| Fabricate numbers in the briefing | Validator rejects numerals without resolving metric references. |
| Cancel the audit or the reconcilers | Explicit deny on those task types. |
| Persist an instruction to a future pass | **Partially, and legitimately.** A CEO-authored objective is an instruction to a future pass. It carries provenance, mandatory expiry, owner ratification (I37) and `DECISION_DELEGATED` grade, so it cannot gate a monetary or irrecoverable class (I28). v1.0's flat "cannot" was false. |
| Shape what counts as adverse news | **Cannot** (v1.1). The adverse-facts threshold set is an owner-set control artifact, hash-matched to the signed manifest (I38), not a value derived from CEO-authored objectives. |
| Filter what the owner sees | **Cannot** (v1.1). The audit plane serves its own read endpoint on its own host; the owner client fetches the briefing from the control plane and the appendix from the audit plane and diffs client-side (AUDA-08). v1.0 served both through a control-plane surface. |
| Drift the objective set slowly, each move individually defensible and individually ratified | **Not prevented.** `47 §9.3`: a consistent, calibrated, patient adversary scores *well* on counter-metrics that detect inconsistency. The drift metric in `27 §6` helps and does not solve it. This is one of three open risks that cannot be engineered away. |
| Direct a worker to bypass a gate | One write path; policy evaluates regardless of who asked. |
| Escalate via delegation depth | Depth ≤ 3, signed chain, subset validation. |

**Detection.** Reservation velocity anomaly, `DENY: PROHIBITED` spike, task-creation-rate anomaly, forecast-calibration collapse, escalation-rate anomaly, evidence-citation-pattern shift. All computed by the audit plane from independent inputs.

**Detection latency is therefore a governed quantity**, and the realistic loss is `MAL(detection window)`, not `MAL(month)`. Shortening detection latency is worth more than tightening any individual limit — a point that should shape where effort goes.

## 10. Compromised worker — worked

A worker's blast radius is its own grants, which are narrower than the CEO's by construction.

- A **support reasoner** can propose refunds up to its cap and rate limit, and can attempt utterances. The utterance path is where the real exposure sits, and it is bounded by tier: T-U0 templates cannot be made to say anything not in a template; T-U1 requires grounding coverage; T-U2 requires a human.
- A **research worker** can poison the evidence store with INTERPRETATION-grade material. It cannot create CLAIM items without a fetch record, cannot assert corroboration, and cannot promote a grade. The corroboration gate limits what its output can authorise.
- A **quarantined ingestion worker** can emit false claims about a page it read. This is indistinguishable from the page being false, which is threat #20, and it is handled the same way.
- A **triage worker** can misclassify. The router is deterministic, RED-class detection runs *before* the model, and misclassification produces a wrong queue, not a wrong action.

## 11. Statutory and compliance floor

These hold even if the security problem were solved (`07 §8`).

| Obligation | Architectural form |
|---|---|
| GDPR Art. 22(3) — human-intervention route for solely automated decisions with significant effects | Every adverse automated decision about an identified customer creates an escalation-eligible record with a documented human route. Adverse decisions include refund refusal, account suspension and fraud-based cancellation. |
| GDPR Art. 33 — 72 hours | Kernel clock. A reachable human is a company availability requirement. |
| GDPR Art. 12(3) — one month; CCPA 45 days | Kernel clocks with escalation at 25 and 40 days respectively (`07 §8`). |
| CPPA ADMT — compliance from 2027-01-01 | Decision records already carry the logic, inputs and human route; the gap is disclosure surfaces, tracked as a dated obligation in K14. |
| PCI DSS SAQ A eligibility (2025-03-31) | Categorical prohibition on payment-page-adjacent writes. |
| FTC 30-day rule, 7-working-day refund clock | Kernel clocks on order state. |
| FTC 16 CFR Part 465 | `review.create` categorically prohibited. |
| EU AI Act Art. 50(1) | Disclosure as a policy artifact in K14, applied by the Utterance Gate. |

## 12. Prerequisites from `07 §10`, mapped

`07 §10` lists 23 architecture-independent prerequisites before any meaningful financial authority. Each maps to a component; none is left as an intention.

| Group | Prerequisites | Where |
|---|---|---|
| **A. Authority and money** (1–7) | Deterministic enforcement outside the loop; no money credential in the agent; human-controlled append-only payee allowlist; pre-funded envelopes; idempotent, logged, attributable, capped actions; credential-revoking kill switch; enforcement never in a skippable callback | K3, K4, K5, **the Effect Canonicaliser**, `26 §6`, §3. **v1.1: not the credential broker**, which is removed at MVP (ADR-024) — the row's controls rest on per-adapter secrets, per-adapter isolation, revocation-not-pause, and I15's empirical probe |
| **B. Injection containment** (8–12) | Trifecta decomposed per session; Plan-Then-Execute for anything that can spend; read-only-untrusted separated from write-capable; deny-by-default egress with allowlist expiry monitoring; classifiers as telemetry only | `23 §8`, §13, `23 §7`, §4, #13 |
| **C. State, evidence, supply chain** (13–17) | Provenance on every evidence item; corroboration before spend influence; discovery/evaluation/execution separated; tool-description hash pinning; credential runtimes install nothing; MCP conformance audit | K8, `24 §13`, SR2, §5, §3 |
| **D. Legal, human, observability** (18–23) | Reachable human within 72h; human route for adverse automated decisions; utterances gated like actions; zero payment-page write access; append-only audit outside agent write authority; adaptive red-teaming before any authority increase and on every model upgrade | K10, §11, `26 §9`, `26 §6`, K11, `36 §9` + SR6 |

## 13. Plan-Then-Execute, and where it applies

`07 §5` identifies Plan-Then-Execute as the pattern that matters most for money: fix the set and magnitude of financial actions **before** any untrusted content is read, so injection can corrupt *content* but not *authority*.

In ACOS this is a property of the work item, not a prompt technique. For any task type whose `allowed_action_classes` include a monetary action:

1. The `context_spec` and `allowed_action_classes` are fixed in the contract, before execution.
2. Exposure headroom is bound to the work item at dispatch.
3. Untrusted content enters only as CLAIM-grade structured claims already extracted by a separate quarantined context.
4. The proposal's action class must be in the pre-declared set; anything else is `DENY: UNKNOWN_ACTION`.

So a customer message can change *which* refund reason is selected and *what amount is proposed within the cap*. It cannot change the fact that the only monetary action available is a refund to the original instrument on a verified existing order.

## 14. Residual risk, ranked

**v1.1: the ranking below is reordered, because the top item was absent from v1.0.**

1. **Compromise of a Trusted Computing Base member.** `49` enumerates fourteen, four of which appeared nowhere in v1.0: CI/CD, the migration/DDL principal, the cloud database operator, and the observability vendors. **The residual under a compromised TCB member is not bounded by MAL.** MAL bounds a compromised *model*. A compromised **adapter** is bounded by its vendor credential's full scope plus every authority whose preconditions its RECORD writes can satisfy. A compromised **control plane** is bounded by nothing inside ACOS — the audit store's resistance to retroactive alteration by an `INSERT`-only principal and the limits of the adapters' vendor credentials are the only properties that survive. And because vendor OAuth scopes are coarser than ACOS action classes on every platform examined, **adapters are irreducibly in the TCB and no design removes them** (`42 §4`). The mitigations are per-adapter isolation, the audit plane's independent vendor reads (I8), hourly external anchoring (I17b), and the empirical prohibited-class probe (I15). None of them closes it.
2. **Competitor poisoning of the decision process.** HIGH, unquantified, contained but not detected (§8).
3. **Owner/insider credential compromise.** Out of architectural scope; the owner is the root of trust. **v1.1 addition:** the owner can also be **degraded** without being compromised. `44 §6` establishes that the approval-fatigue path is the failure mode this architecture is most likely to actually experience, and that v1.0 measured it and connected it to no state change. The owner-attention budget (I39) and the approval-quality demotion triggers (`26 §13`) are the response.
4. **Platform identity loss** (Google advertising identity, marketplace account). No spend cap touches it; redundancy is nonexistent for the Google advertising identity (`06 §2.4`). Bounded only by claim discipline, write-velocity limits and model choice — by construction, not by estimation (`11 §4.1`). **v1.1: and ACOS cannot be made incapable of raising the platform cap that would otherwise contain the spend** (§3.3, §6.1), so the cap is a detection surface polled by the audit plane (I33) rather than an independent control.
5. **Supply-chain compromise of a credential-holding runtime *or of the build pipeline*.** Contained by per-adapter runtime separation; catastrophic if realised. All three cited incidents were build-time.
6. **Adapter mapping bug producing a wrong RECORD.** The most dangerous *internal* failure, because policy trusts RECORD grade. Mitigated by parser property tests (I26), by externally-produced reconciliation totals rather than self-recorded fixtures (`36 §7`, VAL-03), and by cross-check invariants (`24 §10`).
7. **The audit plane's inputs cannot be made fully independent** (v1.1). R10's own vendor reads are a large improvement over reading a replica of the audited database. But the audit plane still cannot audit what never touched a vendor, and **its silence remains indistinguishable from correctness.** The residual shrinks; it does not close (`47 §9.2`).
8. **Escalation false negatives on natural adversarial phrasing.** Unmeasured. The non-text-borne rate was 100% and is bounded to T-U2 by construction. Production recall is the operating gate (`26 §9.5`).
9. **Utterance false negatives if T-U1 is ever built.** Unmeasured by anyone; bounded by the twelve conditions in `26 §9.6` and by T-U1 being deferred.
10. **Correlated failure between the operating models and the audit reviewer.** Separate binding is the cheapest available independence and is not a guarantee.
11. **Long-trajectory degradation outside every published evaluation.** `07 §11.2`: no published defence has been validated at ACOS's expected trajectory lengths. Bounded work units are the response, and they are why `25` exists.
