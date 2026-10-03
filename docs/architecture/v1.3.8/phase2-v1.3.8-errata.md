# Phase 2 — v1.3.8 errata

**ACOS Operating Spine v1.3. Package issue v1.3.8. Issued 2026-10-03.**

**One finding, `S1P-W1`, found during S1P provisioning preparation and ruled by the owner — and four narrow architecture defects in the first v1.3.8 candidate, `S1P-W2`–`S1P-W5`, found by independent review and corrected in §7.** One new control-artifact class, one new ADR, one new perimeter category, three invariant restatements and thirteen validation cases. **No authority quantity moved. No mechanism entered the authority path. No control-artifact signature is discharged — class 28's is newly owed. NOTHING IS IMPLEMENTED.**

**`docs/architecture/v1.3.7/` is not modified by v1.3.8** and remains on disk as the previous issue, byte for byte.

---

## 1. `S1P-W1` — the selected provider-evidence surface requires a paid feature the owner declines

### The finding

The accepted S1P design obtains provider-side accepted-message evidence by **querying** SendGrid's Email Activity API with an independent `email_activity.read` credential. Every artifact to v1.3.7 assumed that shape: `48 §2` row 13 exempts audit-plane vendor **reads**; `50 §2g` field 2's reserved `audit_plane` sentinel scopes a **read** credential; class 26 specifies the `I8` sweep as a period-bounded **query**.

**SendGrid's Email Activity API requires a paid Additional Email Activity History feature.** The owner declines to purchase it.

That is not a defect in the architecture. It is a **discovered constraint on the selected provider's free surface**, and it invalidates the evidence half of the S1P design while leaving the send half untouched.

### What was NOT acceptable

Three responses were available and two are forbidden by this package's own rules.

1. **Close `I36` on local state.** Forbidden outright. ADR-026 decision item 4 requires the **provider's** count, and `35 §12.3` states why: *"a mock with a naive idempotency implementation passes while the vendor would not"* — and ACOS's own belief about what it sent is a mock of exactly that kind. A validation that proved ACOS believes it sent one message would be worthless.
2. **Treat the unsigned Event Webhook as evidence.** Forbidden. An unauthenticated POST to a public URL is an assertion by whoever sent it, and the audit plane's independence is the one property that makes its observations worth anything.
3. **Authenticate the push.** Adopted.

### The ruling

**Provider evidence has two modes. Exactly one is active per provider. SendGrid S1P selects `SIGNED_PROVIDER_PUSH`.**

`PROVIDER_READ` is **retained in full** — the architecture, the ADRs, the invariant obligations, the implementation — as an inactive supported mechanism for providers where an independent read credential is the right answer. **Nothing was deleted.**

---

## 2. What v1.3.8 changes, section by section

| Artifact | Change | Kind |
|---|---|---|
| `34` | **ADR-027 added** — two provider-evidence modes; `SIGNED_PROVIDER_PUSH` selected for SendGrid S1P; the normative verification order; authentication-is-not-completeness; provider callbacks supply observations, never authority | **new ADR** |
| `48` | **`§8` added** — the INGRESS perimeter, its one enumerated channel, what the receiver may and must not hold, **twelve** required enforcement properties (G12 added by the §7 correction), and a **separate annotation vocabulary**. `§2`'s fourteen outbound rows are **unchanged** | **new section** |
| `50` | **Class 28 added** with **`§2h`'s closed DISCRIMINATED-UNION schema** (three fields for `PROVIDER_READ`, eight for `SIGNED_PROVIDER_PUSH`), the closed verification profile `SENDGRID_EVENT_WEBHOOK_V1`, the canonical key representation, the derived `key_identity`, the mechanically compared `ingress_identity`, and its rotation rule; five rows added to `§2f`'s field-ownership table; one row added to `§6`'s pre-live inventory | **new class** |
| `36` | **`VC-W1`–`VC-W13` added** (`VC-W10`–`VC-W13` by the §7 correction) | **new validation cases** |
| `37` | **`S1P-W` section added** — what the mode switch removes from and adds to the S1P prerequisite set, and the configuration-drift rule | **new section** |
| `phase2-v1.3-invariant-registry.md` | **`I36`, `I20` and `I8` RESTATED** for push evidence. No identifier added, removed or weakened | **restatement** |
| `analysis/consistency-v1.3.py` | **`M1`–`M14` added** with **twenty-four discriminating mutation seeds**, and **`M15`–`M19` added by the §7 correction** with **fifteen more** | **new conditions** |
| `tools/provider-selection/capabilityRecord.ts` | SendGrid's record gains the signed-push facts and the mode selection, with documented facts, architecture decisions and open obligations kept distinct | **record update** |

**Unchanged and explicitly so:** every send-side decision (provider, adapter, action class, method, recoverability, one irrecoverable unit, exact authorised payload binding, sandbox `false`, no blind retry, ADR-026's unknown-outcome semantics, the unique correlation per intended message, the integration credential's `NON_MONETARY_WRITE` risk class, exact Key Vault version binding, the user-assigned managed identity, no control-plane vendor credential); `50 §2g`'s closed seven-field class-5 schema; `48 §2`'s fourteen rows including row 13's read-only exemption; class 26's sweep specification; ADR-024's option-B trigger; every quantity in `51`; `ACOS-JCS-1` and class 20's artifact bytes.

---

## 3. The trust model, stated once

**The verification key is non-secret and authoritative.** Whoever holds the corresponding private key can produce evidence ACOS accepts, so `§1`'s membership test is satisfied in its strongest form: substituting the key changes what ACOS **believes a provider did**.

**It is owned by control-artifact class 28** — not class 5, which owns a credential's capability envelope and whose every other row is an authentication credential ACOS holds and presents; not class 24, which is ACOS's own audit-plane signing key with a different halt scope; not class 26, which specifies a sweep that push mode does not perform. `50 §2h` records the full elimination.

**It is never fetched at runtime from the provider.** A runtime fetch would make the trust root whatever the provider's API returned at that moment, **and would require a provider management credential the audit plane is specifically designed not to hold** — the second reason is the decisive one, because it would reintroduce exactly the credential this mode removes.

**Rotation is a release.** New key octets → new **derived** `key_identity` → class-28 candidate → owner and second-factor signatures → manifest re-sign → pin move → only then is evidence under the new key admissible. **During an uncoordinated mismatch the channel's evidence is UNAVAILABLE, not clean and not zero.**

---

## 4. The evidence model, stated once

**Two deduplication identities, and conflating them is the defect this section exists to prevent.**

| Identity | What it identifies | Used for |
|---|---|---|
| provider **event** identity | one delivery of one event | **ingest deduplication.** The provider may redeliver; a second delivery of the same event identity creates no evidence, increments no count, and is acknowledged successfully once the original durable row is confirmed |
| provider **message** identity | one message the provider accepted | **the accepted count.** For one ACOS correlation, the count is the number of DISTINCT message identities among authenticated accepted-class events carrying it |

**Therefore, normatively:** one event identity delivered twice is **one** event; two event identities bearing one message identity are **one** accepted message; **two distinct message identities under one ACOS correlation are an excess — provider accepted count ≥ 2 — and duplicate-send evidence.**

**The correlation field.** The accepted implementation already emits the ACOS correlation tag in **both** the provider's category list and its custom-argument map, under the key `acos_correlation_tag`. **Under push evidence the custom argument is authoritative**, for two reasons: the provider documents that v3 custom arguments round-trip into Event Webhook data, which is the property push evidence depends on; and a custom argument is a **key/value pair whose key names ACOS explicitly**, where a category is a flat label an account may legitimately use for its own purposes. **The field is not renamed** — `acos_correlation_tag` is the existing key and remains it. The category emission is retained and is not the webhook evidence operand.

**The correlation value carries no personal data, and this is normative.** The provider documents that custom arguments and categories are **not treated as personal data and may be retained long-term**. ACOS therefore never places a recipient address, a sender address, a subject, a body, a customer identifier, an order identifier or any other personal data into provider-visible correlation metadata. **The value is an opaque ACOS correlation identifier and nothing else.**

**Durable ingest precedes acknowledgement.** A 2xx before persistence converts provider evidence into silent loss on the next crash. On an infrastructure failure before commit, a **non-2xx** is returned and the provider's own retry redelivers. On a repeated already-durable event identity, **2xx** is returned and no second semantic event is appended.

**The provider's retry horizon is acknowledged and is not a completeness claim.** The provider retries a FAILED delivery at increasing intervals for a documented period. **Retry horizon and evidence completeness are different claims**, and v1.3.8 does not convert one into the other.

**Malformed authenticated evidence does not become a partial count.** If a signed batch contains an accepted-class event that cannot be normalised to event identity, message identity, timestamp and correlation, **the observation is INCOMPLETE/UNRESOLVED**. An unreadable second event is never allowed to silently vanish while its readable sibling becomes a trusted count of one — which is precisely the count a correctly non-duplicated send produces.

**Replay is handled by identity, not by a fabricated freshness window.** Signature verification, durable uniqueness on the event identity, correlation uniqueness and both timestamps are the mechanism. **No timestamp freshness threshold is invented**, because the provider documents no safe bound: a valid older event with a seen event identity is an idempotent duplicate delivery, and a valid event with a new event identity and a new message identity **is evidence and is not discarded for being late**.

---

## 5. Data minimisation

After successful verification ACOS may persist only: provider id; evidence-channel id; verification-key identity; provider event identity; provider message identity; event type; ACOS correlation tag; provider event timestamp; ACOS received-at time; the authenticated raw-body hash; verification metadata sufficient for later audit; and a batch identity where one is needed.

**It may NOT persist** the raw webhook body, the recipient address, the sender address, the subject or body, provider response text, or arbitrary provider payload. **The raw body exists transiently, for signature verification, and is not retained.** Forensic retention of raw provider payloads would be a separate privacy and retention decision and **is not smuggled into S1P**.

---

## 6. What remains OPEN after v1.3.8

Nothing below is closed by this slice, and the list is deliberately longer than the change:

the real integration credential; its Key Vault secret and exact version; the real class-5 integration record; the owner and second-factor release ceremony; creation of the Event Webhook; capture of the public verification key; the class-28 trust-artifact candidate and its release; public audit-ingress hosting; TLS deployment; a signed test event; the actual live S1P sends; the six real `I36` scenarios; the empirical visibility and completeness characterisation; the `I20` provider comparison; the `I8` provider inverse evidence; `I17b`; class 19's key-migration obligation; and all remaining later S4 and S1Q work.

**`I36`'s verification leg, `I20` and `I8` all remain OPEN. The pre-live gate remains mandatory. No provider validation is complete in this architecture slice.**

---

## 7. Independent-review correction — `S1P-W2` to `S1P-W5`

**The independent reviewer ACCEPTED the v1.3.8 direction** — SendGrid as the S1P send provider, two evidence modes, `SIGNED_PROVIDER_PUSH` for SendGrid S1P, the retained inactive read mode, class 28 as the new signed owner, class 5 credential-only, the separate ingress perimeter, raw-body-before-parse, `sg_event_id` deduplication, distinct `sg_message_id` counting, the immediate `I36` excess FAIL, absence-based PASS `UNRESOLVED`, the conservative `I20` and `I8` incompleteness rules and the twenty-four webhook seeds — **and named four narrow defects. None of the accepted decisions is reopened by this correction.**

| Id | Defect in the first candidate | Correction | Where |
|---|---|---|---|
| **`S1P-W2`** | `50 §2h` declared ONE universal eight-field record for both modes, so a `PROVIDER_READ` record had to carry a verification key, an algorithm, a key identity, accepted event classes and an ingress identity with **no honest meaning** | **Class 28 is a CLOSED DISCRIMINATED UNION over `evidence_mode`.** Common: `provider`, `evidence_mode`, `accepted_count_operand`. **`PROVIDER_READ`: exactly those three.** **`SIGNED_PROVIDER_PUSH`: exactly eight** — the three plus `verification_key`, `verification_profile`, `key_identity`, `accepted_event_classes`, `ingress_identity`. The parser rejects missing fields, extra fields, a push field on a read record and a missing push field on a push record. **No nulls, empties, sentinels or dummy values** | `50 §2h`, `§2f`, `§6`, row 28; ADR-027 5a; `VC-W10`; `M15` |
| **`S1P-W3`** | Field 4 said only `ECDSA`, and field 3 said "exact bytes in a declared encoding" while **declaring no encoding** | **`verification_algorithm` is replaced by `verification_profile`**, closed identifier **`SENDGRID_EVENT_WEBHOOK_V1`**, expanding to P1–P10: the two exact header names, each exactly once; the timestamp's exact octets with no conversion; `timestamp_octets ‖ raw_body_octets`; SHA-256; strict standard Base64; one DER `ECDSA-Sig-Value (r, s)`; ECDSA on P-256; malformed input refused; no negotiation, no request-selected algorithm, no fallback verifier. **`verification_key` is the exact provider-returned `public_key` string** — standard Base64 of a DER X.509 `SubjectPublicKeyInfo` — parsed one way only and **never by trying alternate encodings** | `50 §2h`; ADR-027 decision 4 step 5 and 5a; `48 §8` G5, G6; `VC-W11`, `VC-W12`; `M16`, `M17` |
| **`S1P-W4`** | `key_identity` was a free "stable non-secret identity", so one signed record could carry key B under identity A | **`key_identity = lowercase_hex(SHA-256(verification_key_der_octets))`**, over exactly the DER octets the verifier consumes; **recomputed by the artifact verifier with refusal on disagreement; never typed; never the webhook ID, a friendly name, the ingress URL or an account id.** Rotation becomes objectively testable: new key octets ⇒ new derived identity ⇒ new candidate octets ⇒ new manifest hash ⇒ owner and second-factor signatures ⇒ pin move ⇒ only then admissible | `50 §2h` and its rotation rule; ADR-027 5a; `37` S1P-W step 5; `VC-W12`; `M18` |
| **`S1P-W5`** | `ingress_identity` was "the stable non-secret identity of the ACOS ingress" — a label with no runtime comparison | **`ingress_identity` is the canonical public HTTPS URL `https://<host><fixed-path>`** — lowercase DNS host, no port, userinfo, query, fragment, wildcard or arbitrary route. **The receiver does not start unless its deployment launch echo equals it, and refuses, before reading the body, every request whose target differs.** The echo can stop the receiver; it can never redirect it. No forwarded header is authority | `50 §2h`; `48 §8` G1 and **G12 (new)**; ADR-027 decision 4 step 1 and 5a; `37` S1P-W step 2; `VC-W13`; `M19` |

### The provider facts this correction rests on, and the one the prose does not state

**Documented in SendGrid's *Getting Started with the Event Webhook Security Features*:** the headers `X-Twilio-Email-Event-Webhook-Signature` and `X-Twilio-Email-Event-Webhook-Timestamp`; a SHA-256 hash of *timestamp + payload* over **raw bytes**; ECDSA; Base64 decoding of the signature; ASN.1 unmarshalling into `(r, s)`. **Documented in *Get Signed Event Webhook's Public Key*:** the key arrives as the string member `public_key`. **Established by SendGrid's official helpers** (`sendgrid-go`, `sendgrid-java`, `sendgrid-python`, each `helpers/eventwebhook`): that string is **standard Base64 of a DER X.509 `SubjectPublicKeyInfo`** — Go decodes it with `base64.StdEncoding` and `x509.ParsePKIXPublicKey`, Java with `Base64.getDecoder` and `X509EncodedKeySpec`, Python by PEM-armouring it as `PUBLIC KEY`, which is the same representation. **Three wrappers, one representation.**

**Not stated in the prose: the curve.** The helpers' shared published test-fixture key decodes to `id-ecPublicKey` with `namedCurve prime256v1`, and the profile pins P-256 on that basis. **This is recorded as a residual provider fact, not hidden**: if a captured account key ever fails the P-256 check, the class-28 candidate **fails artifact verification before signing** and a revised profile needs a new release. It can cause a refusal; it cannot cause evidence to be accepted under an unintended curve. **No `PROVIDER FACT UNRESOLVED` blocks the canonical stored form**, because the provider's own helpers establish it.

**Unchanged by this correction:** every item in the reviewer's accepted list above; class 5 and `§2g`; class 26; ADR-024; class 28's membership of the pre-live dual-signed set; no runtime key fetch; rotation by release; `PERIMETER_INGRESS` distinct from outbound authorisation. **`docs/architecture/v1.3.7/` remains byte-identical. NOTHING IS IMPLEMENTED.**
