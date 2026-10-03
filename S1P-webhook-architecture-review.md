# S1P-W — independent architecture review package (v1.3.8, with the independent-review correction)

**ARCHITECTURE ONLY. NO RUNTIME IMPLEMENTATION AND NO PROVIDER CALL OCCURRED IN THIS SLICE.**

This package supersedes the first v1.3.8 review package. The independent reviewer **accepted** the overall signed-webhook architecture and named four narrow defects — `S1P-W2` class 28 must be a mode-discriminated schema; `S1P-W3` the SendGrid verification profile and key representation must be closed; `S1P-W4` `key_identity` must be material-bound; `S1P-W5` `ingress_identity` must be mechanically enforceable. **All four are corrected inside v1.3.8. No accepted decision is reopened.**

---

## 1. Baseline

| | |
|---|---|
| **Baseline commit at slice start** | `a6643642371607a88e6c531a168bfcad8020c6f7` |
| **HEAD at slice end** | `a6643642371607a88e6c531a168bfcad8020c6f7` — **nothing was committed** |
| **Branch** | `feature/s1o-provider-selection-audit-boundary` |
| **`docs/architecture/v1.3.7/`** | **UNMODIFIED.** `git status` reports no change under that path, and the v1.3.7 gate still returns **108 PASS / 0 FAIL** with **77/77** seeds discriminating |
| **Companion diff** | `S1P-webhook-architecture-review.diff`, regenerated from the same baseline — 1 tracked + 188 untracked = **189 files**; **46,071** untracked lines on disk reconciling exactly against **46,071** patch-added lines, **0** mismatches. Prior review artifacts are excluded |

---

## 2. Architecture files changed

The v1.3.8 package is a **full copy of v1.3.7** with the edits below. The other files in the package are byte-identical carries.

| File | Change (first candidate + **correction**) |
|---|---|
| `v1.3.8/README.md` | issue header, v1.3.8 summary, read-order `2h`, layout note, gate block; **correction: class-28 union, profile, derived key identity, ingress URL; 127 conditions; 116 seeds** |
| `v1.3.8/deliverables/34-architecture-decision-records.md` | **ADR-027**; **correction: decision 4 steps 1 and 5 name `ingress_identity` and the closed profile; new decision 5a (`S1P-W2`–`S1P-W5`); evidence line cites the provider docs and helpers** |
| `v1.3.8/deliverables/36-architecture-validation-plan.md` | `VC-W1`–`VC-W9`; **correction: `VC-W10`–`VC-W13`** |
| `v1.3.8/deliverables/37-acos-mvp-and-implementation-sequence.md` | `S1P-W` section; **correction: provisioning steps 2, 5, 6, 7 capture the exact `public_key` string, derive `key_identity`, bind the webhook URL to `ingress_identity`; stale `§28` reference fixed to `§6`** |
| `v1.3.8/deliverables/48-external-write-perimeter.md` | `§8` INGRESS perimeter; **correction: G1, G5, G6 tied to class 28; new G12; receiver may hold the non-authoritative launch echo** |
| `v1.3.8/deliverables/50-control-artifact-manifest.md` | class 28 row, `§2h`, `§2f` rows, `§6` row; **correction: `§2h` rewritten as a discriminated union with the closed parser; new subsections for the verification profile, the key representation, `key_identity`, `ingress_identity`; rotation rule, row 28, `§2f`, `§6` and change record updated** |
| `v1.3.8/phase2-v1.3-invariant-registry.md` | `I36`, `I20`, `I8` restated — **unchanged by the correction** |
| `v1.3.8/phase2-v1.3.8-errata.md` | finding, ruling, trust and evidence models; **correction: new §7, header and §2 table updated (the stale "M1–M12" fixed to M1–M14)** |
| `v1.3.8/phase2-v1.3.8-verification.md` | **correction: 127 conditions, M15–M19, 15 seeds with the required-defect map, 116-seed full-gate statement** |
| `v1.3.8/analysis/consistency-v1.3.py` | M1–M14 + 24 seeds; `K14` re-pointed; **correction: M15–M19 + 15 seeds** |
| `v1.3.8/analysis/consistency-v1.3.8-*.txt` | **40 recorded runs** — 1 base, 39 negative controls (24 regenerated against 127 conditions, 15 new) |
| `tools/provider-selection/capabilityRecord.ts` | `signedProviderPush`; **correction: generic `signatureAlgorithm: 'ECDSA'` replaced by `verificationProfile`, both header names, `verificationProcedure`, `publicKeyRepresentation`** |

---

## 3. The owner decision (unchanged)

| | Old | New |
|---|---|---|
| **Provider** | `twilio_sendgrid` | **unchanged** |
| **Send side** | every accepted send-side decision | **unchanged** |
| **Provider-evidence mode** | `PROVIDER_READ` | **`SIGNED_PROVIDER_PUSH`** |
| **Evidence surface** | Email Activity API | **Signed Event Webhook** |
| **Audit SendGrid credential** | `email_activity.read` required | **not required** |
| **Paid entitlement** | required | **not required — declined by the owner** |
| **`PROVIDER_READ`** | active | **retained, inactive, supported** |

---

## 4. The corrected class-28 schema — a CLOSED DISCRIMINATED UNION (`S1P-W2`)

**Class 28 remains the provider-evidence configuration / trust class, owns the selected evidence mode, is a pre-live dual-signed manifest member, and exactly one mode is active per provider.**

| | Common | `PROVIDER_READ` | `SIGNED_PROVIDER_PUSH` |
|---|---|---|---|
| 1 `provider` | ✔ | ✔ | ✔ |
| 2 `evidence_mode` (discriminator) | ✔ | `PROVIDER_READ` | `SIGNED_PROVIDER_PUSH` |
| 3 `accepted_count_operand` | ✔ | ✔ | ✔ |
| 4 `verification_key` | | **absent** | ✔ |
| 5 `verification_profile` | | **absent** | ✔ |
| 6 `key_identity` | | **absent** | ✔ |
| 7 `accepted_event_classes` | | **absent** | ✔ |
| 8 `ingress_identity` | | **absent** | ✔ |
| **Total** | | **exactly 3** | **exactly 8** |

**No null, empty string, sentinel key, `"NONE"` profile, empty accepted-event set or dummy ingress identity appears on a read record.** **No fourth read-mode field is needed**: the read credential's identity, envelope and risk class are class 5's, and the sweep is class 26's; the only read-mode authority class 28 owns is the selection and the count operand.

**The parser, closed per variant:** parse `provider`; parse `evidence_mode`; select the exact field set; reject missing; reject extra; **reject any push-only field on `PROVIDER_READ`; reject any missing push field on `SIGNED_PROVIDER_PUSH`.** A rejected record makes the channel UNAVAILABLE and its invariants UNRESOLVED.

---

## 5. The exact SendGrid verification profile — `SENDGRID_EVENT_WEBHOOK_V1` (`S1P-W3`)

Class 28 field 5 is **`verification_profile`**; `verification_algorithm` no longer exists. **A bare `ECDSA` is not a valid value.**

| Step | Rule |
|---|---|
| P1 | signature header **`X-Twilio-Email-Event-Webhook-Signature`**, exactly once, non-empty |
| P2 | timestamp header **`X-Twilio-Email-Event-Webhook-Timestamp`**, exactly once, ASCII decimal digits only (ACOS fail-closed restriction) |
| P3 | `timestamp_octets` = the header value's exact ASCII octets — **no conversion, no re-rendering** |
| P4 | `raw_body_octets` = the exact request body octets, before any parse |
| P5 | **`signed_input = timestamp_octets ‖ raw_body_octets`** — timestamp first, no separator |
| P6 | **SHA-256** over `signed_input` |
| P7 | signature header **strict standard Base64** decoded (RFC 4648 §4, padded, canonical) |
| P8 | decoded octets = **exactly one DER ASN.1 `ECDSA-Sig-Value ::= SEQUENCE { r, s }`**, no trailing octets, `r, s ∈ [1, n−1]`; **no raw `r ‖ s` reading** |
| P9 | key = class-28 `verification_key` under its one canonical representation, a **P-256** key |
| P10 | **ECDSA verification**; anything but verified is not evidence |

**Malformed signature, header or key material is refused, never repaired**; a refusal is non-2xx, nothing persisted, not evidence; a key that does not parse is a class-28 record failure. **No algorithm negotiation, no request-selected algorithm, no fallback verifier.** Signature malleability is harmless because **no identity is derived from signature octets** (dedup is on `sg_event_id` inside the verified payload), so low-S is not required. A changed provider procedure is a **new** profile identifier in a new release.

**Provider basis.** Headers, *timestamp + payload* over raw bytes, SHA-256, ECDSA, Base64 signature, ASN.1 `(r, s)`: SendGrid *Getting Started with the Event Webhook Security Features*. Implemented identically by SendGrid's official `sendgrid-go`, `sendgrid-java` and `sendgrid-python` `helpers/eventwebhook`.

---

## 6. The exact canonical verification-key representation (`S1P-W3`)

**What ACOS stores and the owner signs:** class 28 field 4 `verification_key` **is the exact provider-returned `public_key` string** (`GET /v3/user/webhooks/event/settings/signed/{id}`), byte for byte, US-ASCII. **Not re-armoured, re-wrapped, re-encoded or transformed.**

**What that string is:** **standard Base64 of a DER X.509 `SubjectPublicKeyInfo`**, `id-ecPublicKey`, `namedCurve prime256v1`. The prose docs name no encoding; SendGrid's official helpers all interpret the one string the same way — Go `base64.StdEncoding` + `x509.ParsePKIXPublicKey`; Java `Base64.getDecoder` + `X509EncodedKeySpec`; Python PEM `PUBLIC KEY` armour + `load_pem_public_key`. **Three wrappers, one representation.** Their shared fixture key decodes (offline) to a 91-octet SPKI with OIDs `1.2.840.10045.2.1` / `1.2.840.10045.3.1.7` and an uncompressed point.

**The one parse:** strict canonical standard-Base64 decode → `verification_key_der_octets` → strict DER parse as exactly one SPKI → require `id-ecPublicKey` + `prime256v1` → require a valid P-256 point. **No alternate PEM / raw DER / URL-safe / hex / raw-point / compressed-point interpretation is ever tried.**

**Residual provider fact, stated:** the prose does not name the curve; P-256 rests on the official helpers' fixture. A captured key that is not P-256 **fails artifact verification before signing**. That can cause a refusal, never acceptance. **No `PROVIDER FACT UNRESOLVED` blocks the canonical stored form.**

---

## 7. Deterministic `key_identity` derivation (`S1P-W4`)

```
key_identity = lowercase_hex(SHA-256(verification_key_der_octets))
```

* over **exactly** the DER SPKI octets the verifier parses — not the Base64 string's ASCII, not PEM, not a raw point;
* 64 lowercase hex characters, **no prefix** — the rendering `50 §3d` uses for owner `key_id`;
* same key octets ⇒ same identity; different key octets ⇒ different identity, except by SHA-256 collision;
* **the artifact verifier recomputes it and REJECTS the record on disagreement** — one record can no longer carry key B under identity A;
* **never typed**; never the SendGrid webhook ID (a different, non-class-28 fact), a friendly name, the ingress URL, an account id or any user label.

**Rotation is now objectively testable:** new public-key octets ⇒ new derived `key_identity` ⇒ new class-28 candidate octets ⇒ new `content_hash` and manifest core ⇒ owner + second-factor signatures ⇒ pin moves ⇒ **only then** is evidence under the new key admissible. No operator judgement decides whether the identity changes.

---

## 8. Exact `ingress_identity` semantics (`S1P-W5`)

**Value:** the canonical public HTTPS URL **`https://<host><fixed-path>`** — scheme `https` only; lowercase DNS host (A-label IDN), no trailing dot, no IP literal, no wildcard; **no port**; **no userinfo, query or fragment**; one literal absolute path, no empty / dot segments, no percent-encoding, no trailing `/`, no pattern, no parameter, no arbitrary callback route. Outside the grammar = record failure. Comparisons are **exact octet equality**.

**Mechanical binding — both comparisons can only refuse:**

1. **At start:** the deployment carries the ingress URL as a **non-authoritative launch echo** (the `§2g` construct). The receiver compares it to the class-28 value it verified itself; **on difference it does not start** and the channel is UNAVAILABLE. An unsigned env value can stop the receiver; **it can never substitute, widen or redirect the signed value.**
2. **Per request:** `https://` ‖ lowercase host (from `Host`/`:authority` as delivered by the declared TLS front end; explicit port refused) ‖ exact path **must equal `ingress_identity` exactly, or the request is refused before the body is read.** The platform default hostname, alternate domains, other paths and query strings are refused. **No forwarded header (`X-Forwarded-Proto` etc.) is authority**; HTTPS is guaranteed by the front end's TLS-only configuration (G3) and the grammar.

**Scope, stated honestly:** this is a configuration-scope control, not sender authentication — `Host` is attacker-choosable, which is why it may only refuse. Authentication remains P1–P10. Provider-side equality (the SendGrid webhook URL equals `ingress_identity`) is a capture-time provisioning obligation. Enforced as **`48 §8` G12**.

---

## 9. Invariant delta (unchanged by the correction)

| Invariant | Restatement |
|---|---|
| **`I36`** | push-mode accepted count = **distinct `sg_message_id`** among authenticated accepted-class events carrying the correlation; **excess FAILs immediately**; **absence-based PASS remains `UNRESOLVED`** |
| **`I20`** | numerator = the same distinct-message count; **`UNRESOLVED`** when the channel is incomplete; denominator unchanged |
| **`I8`** | an authenticated accepted-class event the audit plane cannot account for is a **positive finding immediately**; a clean period is **INCOMPLETE**, not clean |

---

## 10. Mutation-seed table

**First candidate — 24 webhook seeds, M1–M14 — unchanged and unweakened** (each now runs 126/1): `--seed-w-no-signature-check`, `--seed-w-reserialize-then-verify`, `--seed-w-parse-before-verify` (M1); `--seed-w-runtime-key-fetch`, `--seed-w-env-key-is-authority`, `--seed-w-rotation-without-release` (M2); `--seed-w-no-event-dedup`, `--seed-w-retry-increments-count` (M3); `--seed-w-count-is-event-count`, `--seed-w-two-messages-not-duplicate` (M4); `--seed-w-malformed-silently-dropped` (M5); `--seed-w-ack-before-durable-commit` (M6); `--seed-w-receiver-holds-send-credential`, `--seed-w-receiver-has-send-client` (M7); `--seed-w-event-authorises-effect` (M8); `--seed-w-i8-ignores-unaccounted`, `--seed-w-clean-period-is-complete` (M9); `--seed-w-zero-events-is-not-sent`, `--seed-w-retry-horizon-is-visibility` (M10); `--seed-w-push-still-needs-activity-read` (M11); `--seed-w-key-is-class5-credential` (M12); `--seed-w-persist-recipient-email`, `--seed-w-correlation-carries-pii` (M13); `--seed-w-test-event-is-live-evidence` (M14).

**Correction — 15 new seeds, M15–M19, one per reviewer-required defect:**

| # | Required defect | Seed | Fails | Run |
|---|---|---|---|---|
| 1 | `PROVIDER_READ` record with a push-only field accepted | `--seed-w-read-accepts-push-field` | M15 | 126/1 |
| 2 | `SIGNED_PROVIDER_PUSH` omits a required push field | `--seed-w-push-omits-field` | M15 | 126/1 |
| 3 | class 28 parsed as one universal eight-field shape | `--seed-w-universal-eight-field-shape` | M15 | 126/1 |
| 4 | generic `ECDSA` accepted instead of the closed profile | `--seed-w-generic-ecdsa-algorithm` | M16 | 126/1 |
| 5 | SHA-256 step removed | `--seed-w-sha256-step-removed` | M16 | 126/1 |
| 6 | timestamp/payload order reversed | `--seed-w-concat-order-reversed` | M16 | 126/1 |
| 7 | signature Base64 decoding replaced | `--seed-w-signature-base64-replaced` | M16 | 126/1 |
| 8 | ASN.1 DER interpretation removed | `--seed-w-der-interpretation-removed` | M16 | 126/1 |
| 9 | request selects the verification algorithm | `--seed-w-request-selects-algorithm` | M16 | 126/1 |
| 10 | runtime tries multiple key encodings | `--seed-w-try-multiple-key-encodings` | M17 | 126/1 |
| 11 | `key_identity` becomes a free label | `--seed-w-key-identity-free-label` | M18 | 126/1 |
| 12 | changed key with unchanged `key_identity` passes | `--seed-w-key-change-identity-unchanged` | M18 | 126/1 |
| 13 | `key_identity` hashed over a representation the verifier does not consume | `--seed-w-key-identity-wrong-representation` | M18 | 126/1 |
| 14 | `ingress_identity` becomes a friendly label | `--seed-w-ingress-identity-friendly-label` | M19 | 126/1 |
| 15 | receiver runs under an ingress other than the signed identity | `--seed-w-receiver-serves-other-ingress` | M19 | 126/1 |

---

## 11. Verification results

| Check | Result |
|---|---|
| v1.3.8 architecture consistency | **127 PASS / 0 FAIL** (C1–C29, E1–E7, F1–F3, G1–G10, H1–H13, J1–J16, K1–K25, L1–L19, **M1–M19**) |
| **full v1.3.8 seed gate** | **116 seeds: 77 inherited + 24 webhook + 15 correction — 116/116 discriminate, 0 non-discriminating**, every seed applying all of its edits |
| 39 webhook + correction seeds individually | each **126 PASS / 1 FAIL**, failing exactly its target condition |
| recorded runs | **40 files** — 1 base, 39 negative controls |
| v1.3.7 gate (immutability check) | **108 PASS / 0 FAIL**, **77/77** seeds discriminate, `git status` clean under `docs/architecture/v1.3.7/` |
| `npx tsc --noEmit` | clean |
| `npx eslint tools/provider-selection --max-warnings 0` | clean |
| `git diff --check`, plus `--check` over each edited untracked file | no whitespace errors |
| network | **No Azure call and no SendGrid API call.** Public SendGrid documentation pages and public helper-library source files on GitHub were **read** to establish provider facts; no account, key or webhook was touched |

**Re-pointed conditions** (first candidate, unchanged): `K14` follows the renamed `§6` heading and asserts six live rows; `L6`'s operand stays byte-identical. **Neither was weakened, and no inherited condition was re-pointed by the correction.**

---

## 12. Unresolved items

**Nothing below is closed by this slice.**

Provisioning: the integration credential and its Key Vault secret/version; the real class-5 record; the release ceremony; creation of the Event Webhook; **capture of the exact `public_key` string and confirmation that it is P-256**; the class-28 `SIGNED_PROVIDER_PUSH` candidate and its release; the canonical `ingress_identity` host and path; public audit-ingress hosting and its TLS front end.

Implementation: the receiver; the closed class-28 parser; `SENDGRID_EVENT_WEBHOOK_V1`; `key_identity` recomputation; the start-time and per-request ingress comparisons; persistence and deduplication; `48 §8` G1–G12; `VC-W1`–`VC-W13`.

Evidence: a signed test event; the live S1P sends; the six `I36` scenarios; the **empirical completeness characterisation — none exists and none is claimed**; the `I20` comparison; `I8` inverse evidence; `I17b`; class 19's key migration; all later S4 and S1Q work.

**`I36`'s verification leg, `I20` and `I8` remain OPEN. The pre-live gate remains mandatory.**

---

## 13. Statement

**No runtime implementation occurred.** No HTTP server, webhook SDK, migration, persistence, adapter change, removal of provider-read code, infrastructure, API key, webhook, real public key, class-5 record, signature or pin change.

**No provider call occurred.** No request was made to SendGrid's API or to Azure.

**`docs/architecture/v1.3.7/` remains untouched.**

**Final classification: S1P-W ARCHITECTURE REVISION COMPLETE — IMPLEMENTATION NOT STARTED.**
