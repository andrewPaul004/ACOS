# S1M — Postmark provider evidence

**Retrieved 2026-09-25 from the provider's own published developer documentation.**
**Branch `feature/s1m-postmark-sandbox`. Baseline `910b246`.**

> **THIS IS EVIDENCE, NOT ARCHITECTURE** (`§39`: "Treat provider responses as evidence, not
> architecture"). `25 §7` declares the EM6 criterion. This file records what one named
> provider's documentation said on one named date, and a provider that changes its API
> changes this file rather than the criterion.

> **NO ACCOUNT EVIDENCE EXISTS.** No Postmark account, server, token or API response was
> available to this slice. Every row below is **documentation** and none is **measurement**.
> `36 §7` requires vendor properties to be measured against a sandbox rather than trusted
> from an annotation, and **S1M measured nothing.**

> **NO SECRET, NO RECIPIENT, NO CUSTOMER DATA** appears in this file or anywhere in this
> slice (`§40`). No server identifier is recorded, because none was obtained and a
> placeholder would read as evidence.

---

## 1. Sandbox server behaviour — `§2`, `§13`, `§35`

| Property | Documented behaviour |
|---|---|
| delivery | messages sent through a sandbox server are not delivered to recipients |
| activity | they are processed by the provider's infrastructure and remain visible through the API |
| webhooks | webhooks fire for sandbox messages |
| server type | fixed at server creation; **a server's type cannot be changed afterwards** |
| volume | sandbox messages count toward the account's monthly sending volume |

Reference: `https://postmarkapp.com/developer/user-guide/sandbox-mode/server-sandbox-mode`

**Consequence for `§13`.** Sandbox delivery is provider-internal and is not inbox delivery.
A recipient value is still required by the API, and it must be a non-customer value — no
customer address, no user mailing list, no imported production contact. S1M sends nothing, so
no recipient value exists anywhere in this slice.

---

## 2. Sandbox proof before send — `§3`, `§35`

| Property | Documented behaviour |
|---|---|
| endpoint | the server endpoint returns the calling token's own server record |
| field | `DeliveryType` |
| values | `Live`, `Sandbox`; defaults to `Live` when unspecified |
| credential | a **server-level** token |

Reference: `https://postmarkapp.com/developer/api/server-api`

**`§35` is satisfiable.** "If Postmark's API exposes server DeliveryType: verify it." It does,
under the same credential that would send. So a future adapter can obtain trusted
provider-side evidence of the classification **before** the first send rather than trusting a
configuration variable — which is `§35`'s own distinction: "Do not silently trust a variable
named sandbox if a Live token can still send."

**One caution for whoever implements the read.** The server record also returns the server's
own API tokens. Any evidence artifact derived from that response must be filtered to the
classification field; the whole response is credential-bearing and must never be stored,
logged or attached to an incident.

---

## 3. The query primitive — `§14`, `§15`, `§16`

| Property | Documented behaviour |
|---|---|
| search endpoint | the outbound message search, up to 10,000 messages per search |
| required parameters | `count` (max 500 per request), `offset` |
| filters | `recipient`, `fromemail`, `tag`, `status`, `fromdate`, `todate`, `subject`, `messagestream` |
| **metadata filter** | a per-metadata-field parameter; **one metadata field per search** |
| detail endpoint | an outbound message detail endpoint, keyed on the provider message id |
| status values | `Queued`, `Sent`, `Processed` |
| retention | 45 days by default; configurable from 7 to 365 |

Reference: `https://postmarkapp.com/developer/api/messages-api`

**This is the primitive that qualifies Postmark under `25 §7`.** The section's disqualifier is
a provider offering "**neither** an idempotency header **nor** a delivery-event webhook **nor**
a queryable message log". Postmark offers the third, filterable on the ACOS correlation tag,
and a message-detail lookup beside it.

**The `§16` question is NOT answered here.** `§16` requires a definition of "provider
accepted" for the I36 oracle. The documented status vocabulary is `Queued`, `Sent`,
`Processed`; the documentation retrieved does not define the state transition semantics
precisely enough to nominate one as the acceptance oracle without measuring it, and `§16`
says to "report the interpretation and STOP if it affects I36 correctness." **It does affect
I36 correctness, and S1M stops.** The interpretation a future slice must validate empirically
is: *a message present in the outbound log under the run's unique correlation metadata,
in any of the three statuses, counts as accepted* — because all three mean the provider took
custody of the submission, and an oracle that counted only the terminal status would
under-count a message that had escaped, which is the wrong direction for a duplicate-prevention
invariant.

---

## 4. Correlation — `§10`

| Property | Documented behaviour |
|---|---|
| field | a per-message metadata object on the send |
| maximum fields | 10 |
| maximum field-name length | 20 characters |
| maximum value length | 80 characters |
| duplicate keys | not allowed, including keys differing only in case |
| surfaced | in the API, in the interface, and in webhook payloads (values as strings) |
| searchable | yes, one metadata field per search |

Reference: `https://postmarkapp.com/support/article/1125-custom-metadata-faq`

**The mapping fits, exactly.**

| ACOS value | Provider limit | Fits |
|---|---:|---|
| key `acos_correlation_tag` — 20 characters | 20 | yes, at the limit |
| a minted tag `acos-corr-<uuid4>` — 46 characters | 80 | yes |

`tests/postmark/capability-record.test.ts` asserts both against the **real** minter in
`src/kernel/outbox/correlationTag.ts`, not against a description of it.

`§10`'s prohibition is structural and already holds: the adapter may not mint a correlation
id, and it cannot — `correlationTag.ts` mints at enqueue, the schema's unique index and state
machine make the value immutable across the claim, and the enqueue API has no parameter a
caller could pass one in.

---

## 5. The send endpoint, and the absence of idempotency — `§11`, `§14`, `§21`, `§32`, `§33`

| Property | Documented behaviour |
|---|---|
| authentication | a server-level token header |
| metadata | a key/value object on the send |
| message stream | defaults to the transactional outbound stream when not supplied |
| success response | a provider message id, a submission timestamp, the recipient, an error code and a message |
| **idempotency** | **none documented.** No idempotency key, header or idempotent-retry contract |

References: `https://postmarkapp.com/developer/api/email-api`,
`https://postmarkapp.com/developer/api/overview`

**`§14` is answered NO for native idempotency, and that is not a problem.** `25 §7`'s rule —
"Where the adapter's API offers no idempotency, the effect class is downgraded" — is satisfied
by the fourth layer the architecture itself added: "Rather than requiring the vendor to supply
a query primitive, ACOS builds one", the outbox claim. The qualifying primitive is the message
log, and the record says so in a field rather than in prose.

**`§11`: the provider message id is evidence only.** It is not an ACOS effect id, not an
outbox identity, not an idempotency key and not a correlation tag, and `I36`'s state machine
means no provider value can make a `CLAIMED` row redispatchable — there is no transition out
of `CLAIMED` for one to trigger.

---

## 6. Error and rate-limit semantics — `§21`, `§22`, `§34`

Documented HTTP responses include `401`, `404`, `413`, `415`, `422`, `429`, `500` and `503`,
with a JSON body carrying an error code and a message.

Reference: `https://postmarkapp.com/developer/api/overview`

**The mapping a future adapter must implement, and its one hard rule.** `25 §7.2`: "**Anything
for which the request MAY have escaped is `OUTCOME_UNKNOWN`**", and the classification "MAY
NOT be made from arbitrary error-message strings."

| Transport / provider observation | ACOS outcome | Why |
|---|---|---|
| a local failure raised **before** the request is opened or sent | `NOT_SENT_CONFIRMED` (`PRE_SEND_FAILURE`) | the adapter's own control flow establishes it |
| DNS failure, connection refused, TLS handshake failure — **before any request byte is written** | `NOT_SENT_CONFIRMED` (`PRE_SEND_FAILURE`) | nothing crossed the transport boundary |
| connect or request timeout **after any request byte is written** | `OUTCOME_UNKNOWN` (`TIMEOUT`) | the request may have escaped |
| socket closed after the request was sent | `OUTCOME_UNKNOWN` (`AMBIGUOUS`) | the request may have been received |
| `500` / `503` after the request was received | `OUTCOME_UNKNOWN` (`AMBIGUOUS`) | receipt is proven; mutation is not disproven |
| `429` | `OUTCOME_UNKNOWN` (`AMBIGUOUS`) | **no documented guarantee of non-mutation**, so `§34`'s conservative branch applies |
| `422` with a field-validation error code | `OUTCOME_UNKNOWN` unless a future slice **measures** that this response guarantees no mutation | `NOT_SENT_BASES`' second member requires "a provider rejection whose **declared adapter contract guarantees** no external mutation occurred", and no such declaration was found in the documentation |
| a 200 response | `ADAPTER_RETURNED` | and, per `25 §5`, still not evidence that the world changed |

**`§22` answered.** The only Postmark failures that qualify as trusted proof that no request
crossed are the ones that fail **before any request byte is written**. A timeout after write,
a socket close after send and a 5xx after receipt are `OUTCOME_UNKNOWN`, and `§21`'s warning —
"A timeout/network loss after request bytes may have escaped" — is the governing rule.

**`§34` answered.** A `429` maps conservatively to `OUTCOME_UNKNOWN`, not to
`NOT_SENT_CONFIRMED`, because no published semantics establish non-mutation. It never causes a
retry of the same claimed effect, because `I36` admits no second dispatch of a `CLAIMED` row
by any path.

---

## 7. Credential scoping — the decisive limitation — `§7`, `§8`, `§27`, `§44`

| Property | Documented behaviour |
|---|---|
| server token | grants sending, sent-message inspection and the bounce API, as one undivided capability |
| tokens per server | up to 3 |
| account token | account-level actions — creating servers, adding sender signatures and domains |
| read-only access | exists as a **web-interface user role** ("view only" server access) and **carries no API token** |

References: `https://postmarkapp.com/support/article/1008-what-are-the-account-and-server-api-tokens`,
`https://postmarkapp.com/developer/api/overview`

**Consequence.** There is no Postmark API credential that can read the outbound message log
and cannot submit a send.

`48 §2` row 13 exempts audit-plane vendor reads from the external-write perimeter on the
ground "**Reads only**", and `48 §3.6` states the compensating control: "read-only,
separately provisioned, and **attempted-write-tested** (`36 §13`)". `36 §13`'s replica-read
test: "assert [...] that its vendor credentials are read-only — **attempt a write against
each and assert vendor-side failure**."

A second Postmark server token would **fail** that test by succeeding at the write.

`48 §3.6`'s stated precedent for a vendor with no read-only scope is Google Ads: "the audit
credential is a **separate login with viewer-level account access** rather than API scope
separation, and that residual is stated rather than engineered away." **That precedent does
not transfer**, because a viewer-level Google Ads login still yields an API credential that
fails a write, and Postmark's viewer role yields no API credential at all. `§15` forbids
provider UI scraping, so the interface role is not a query path.

**So the honest statement is:** a Postmark audit credential can be independently provisioned
and cannot be least-privilege, and an audit plane holding one holds a send-capable credential.
`§44`'s warning is therefore not merely unmet but pointed in the wrong direction — **`I8`'s
Postmark leg is not "unproven", it is not satisfiable in the form `36 §13` requires**, and
that is a vendor-selection finding under `25 §7`'s own logic rather than an engineering gap.

---

## 8. EM6 qualification summary — `§14`

| Capability | Evidence | Qualifies? |
|---|---|---|
| provider query / search | outbound message search, filterable on one metadata field, plus a message-detail endpoint | **YES** — this is the qualifying primitive |
| provider-visible ACOS correlation | metadata, ten fields, 20-char names, 80-char values, searchable and returned in webhooks | **YES** |
| provider-generated message id | returned on send | YES, as evidence only (`§11`) |
| delivery / event data | webhooks fire, including on sandbox servers | available, **not implemented** (`§26`) |
| sandbox status | `DeliveryType` on the server record, immutable after creation | **YES** |
| native idempotency | none documented | **NO** — and not required, `25 §7` |
| audit read credential | no read-only API scope exists | **NO** — §7 above |

**`25 §7`'s EM6 criterion is met for the IRRECOVERABLE class**, on the queryable message log.
**`36 §13`'s audit-credential requirement is not met**, and no configuration clears it.

---

## 9. What a future slice must measure, not read

Everything above is documentation. Before a real dispatch, these must be **measured** against
a real sandbox account and recorded with `basis: MEASURED_AGAINST_ACCOUNT`:

1. that the server endpoint returns `DeliveryType: Sandbox` for the configured token, and that
   the classification read is refused or wrong for a live token;
1. **that the outbound message search works at all on a sandbox server.** The documentation
   states that the API "remains accessible for these messages" but does not say specifically
   that the outbound *search* — as opposed to retrieval — is served for a sandbox server. The
   entire EM6 qualification rests on it, so it is the first thing to exercise;
1. whether a metadata field name containing underscores is accepted and remains filterable.
   The published example is `metadata_color`, a single word, and the ACOS key would produce
   `metadata_acos_correlation_tag`. The prefix is fixed so the form is unambiguous, but the
   allowed character set for field names is not documented;
2. the visibility latency of a just-submitted message in the outbound search — `§42`'s bounded
   observation window cannot be chosen without it, and `§42` forbids translating observation
   delay into another send;
3. which status a sandbox message reaches, and how quickly, so `§16`'s acceptance oracle is
   defined from behaviour rather than from the vocabulary;
4. whether the metadata filter returns a message in every status, or only in some;
5. whether the selected HTTP client retries a POST transparently — `§32`: "**NO HIDDEN
   RETRIES**", and a library that retries a send is prohibited;
6. what a `422` on a malformed send actually does to provider state, before any `422` is ever
   mapped to `NOT_SENT_CONFIRMED`;
7. the retention configured on the actual sandbox server, since 45 days is only the default.
