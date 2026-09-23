# ACOS Operating Spine v1.3.6 — Normative Errata

**Phase 2.5f. Issued 2026-09-23. The control-artifact trust architecture, declared. Ten blocking normative omissions resolved, applied to Operating Spine v1.3.**

This is not an architecture phase, a red-team pass, a redesign or an implementation. **No new mechanism was introduced into the authority path, no authority ceiling was changed, MAL was not changed, no Step ordering was changed, no audit cadence was changed, and the selected architecture (Option A) was not changed.** Ten items are recorded below. All ten were found during the S1K pre-live control-artifact integrity re-evaluation, recorded as `S1K-C1`..`S1K-C10` in `docs/implementation/S1K-owner-clarifications.md`, and all ten are normative omissions rather than transcription slips: **v1.3.5 declared the obligation to sign control artifacts and did not declare the mechanism.**

**Versioning convention, as v1.3.1 established it and v1.3.2, v1.3.3, v1.3.4 and v1.3.5 followed it.** The numbered deliverables continue to declare `Operating Spine v1.3` in their version lines, because the *architecture* is v1.3 and unchanged. `v1.3.6` names the **issue** of the package. **`docs/architecture/v1.3.5/` is not modified by this pass** and remains on disk as the previous issue, byte for byte; `v1.3.1` through `v1.3.4` likewise. Every prior errata and verification document is carried forward unmodified as history.

**What this pass changes about control artifacts.** Everything the mechanism needed and nothing it did not. **Two externally provisioned Ed25519 trust roots** replace an undeclared and circular root (`§3`). **`ACOS-CAS-SIG-V1`** is a fixed binary signature envelope independent of `ACOS-JCS-1` (`§2`). **`content_hash` is `SHA-256` over exact artifact bytes** (`§5`). **Class 3** and **class 27** receive closed content schemas; **class 20** receives a concrete artifact for the first time since it was created in v1.2; **class 17 is retired from the deploy-time signed manifest**; **class 2** receives a concrete bundle identity. A **dual-signed manifest core** with a **deployment-pinned identity** closes the row-set recursion. **`I19` receives three verification occasions and no polling cadence.** **The second factor becomes a second, distinct Ed25519 approval signature.**

**What this pass does NOT do.** **It implements nothing.** There is no key, no signature, no manifest, no manifest loader, no verification routine, no `VerifiedControlArtifactBundle`, no artifact file consumed by production code, no runtime `I19` and no Cedar signature verification in this pass. `src/` and `tests/` are byte-identical to the accepted baseline. It enables no real external call: no adapter, no HTTP client, no vendor SDK, no credential and no provider sandbox. **No content hash is manufactured for an artifact that has not yet been assembled**, and the one digest this pass does declare — class 20's — is over a real file in this package and is recomputed by the gate.

---

## Summary

| # | Omission | Behaviour changed | Authority quantities changed |
|---|---|---|---|
| **CAS-01** (`S1K-C1`) | `50 §3`'s manifest row carried a bare `signature` field. **No passage in `22`–`51` declared an algorithm for an owner control-artifact signature.** Ed25519 appeared once, normatively, for the **audit plane's** key (class 24) — a different signer, on a different host, whose trust story works *because* the owner signature sits above it. Reading the owner's algorithm off class 24's inverts the dependency | **Yes — declared.** Ed25519, RFC 8032 PureEdDSA over Curve25519, for the primary artifact signature, the second-factor signature, the manifest envelope and the Cedar/O4 signatures. **No custom curve, no RSA alternative, no negotiation in S1**, and any other algorithm identifier REFUSED | **NO CHANGE** |
| **CAS-02** (`S1K-C2`) | `50 §3` printed a **struct**, not a signing input. Nothing declared what the signature covers, in what order, under what framing, or under what domain separator. The four fields that would prevent cross-class, cross-artifact, version and content substitution were *adjacent* to `signature`, which is an inference and not a declaration | **Yes — declared.** `ACOS-CAS-SIG-V1`: a fixed binary framing, `uint32_be` length prefix, raw-byte payloads, **no NULL representable at all**, binding domain ‖ signer role ‖ class ‖ artifact id ‖ version ‖ content hash. Independent of `ACOS-JCS-1` and of the artifact being signed | **NO CHANGE** |
| **ROT-01** (`S1K-C3`) | **The root of trust was circular.** The manifest was trusted because it was owner-signed; the owner signature was trusted because the key was the owner's; **nothing said how a running process obtains the public half.** `49 §3.9` and `50 §5` said only that owner compromise is out of scope, which is a blast-radius note and not a distribution mechanism | **Yes — declared.** Two externally provisioned Ed25519 public keys, **trusted deployment roots**, never control artifacts, never manifest rows, never discovered from a database, manifest, network, model, caller, API or first observed signature. **TRUST-ON-FIRST-USE IS FORBIDDEN.** *A signature does not establish its own verifier* | **NO CHANGE** |
| **I19-01** (`S1K-C4`) | `I19 (continuous)` declared the **action** completely and the **occasion** not at all. `continuous` over a `for` loop is a shape, not a cadence, and the registry's `SCHED` leg named a schedule with no period | **Yes — declared.** Three occasions: **bootstrap before READY**, **verification before publication**, and **verified-capability use**. **No polling cadence at any interval.** `SCHED` is withdrawn from the registry's enforcement column | **NO CHANGE** |
| **HASH-01** (`S1K-C5`) | *"The hash is over canonicalised content"* named **no canonicalisation** for control artifacts. The package's only canonicalisation, `ACOS-JCS-1`, is scoped to journal rows, and **for class 20 the circularity was total**: class 20's signed content *is* `ACOS-JCS-1` | **Yes — superseded.** `content_hash = SHA-256(EXACT_ARTIFACT_BYTES)`. Never a parsed object, a reserialised JSON document, a pretty-printed object, a TypeScript literal, a runtime object graph or a row set. The cost — a whitespace change is a different artifact — is accepted deliberately | **NO CHANGE** |
| **BND-01** (`S1K-C6`) | Class 3's content was an **open prose list** (`incl. …`), six authority-bearing production fields sat outside it, and two class pairs co-resided in one module each with no declared split. **A content hash cannot be computed over content whose boundary is not declared** | **Yes — closed.** `50 §2a` closes class 3 at ten per-class fields and four catalogue-level records; `50 §2c` closes class 27 at four static quantities; `50 §2e` gives class 2 a concrete bundle. Every authority-bearing field has **exactly one** declared owner | **NO CHANGE.** Two fields change **owner**; no value moves |
| **CAT-01** (`S1K-C7`) | Class 17's content was **per-company `window_registry` rows**, keyed by company, written at runtime — inside a **deploy-time** artifact set carrying `signed_at` and an owner ceremony. Nothing said who signs a window created for a company after the ceremony | **Yes — retired.** Per-company window rows are **runtime state**. `irrecoverable_units` moves to **class 3**. **Class 17 leaves the deploy-time signed manifest**, with no empty artifact retained to preserve numbering; the number is reserved and deprecated | **NO CHANGE** |
| **JCS-04** (`S1K-C8`) | **Class 20 had no artifact to sign.** `ACOS-JCS-1` existed as three conforming implementations plus architecture prose. Signing an implementation signs a conformant instance, not the specification, and `50 §3` property 2 requires the audit plane to recompute the same hash from a **different** implementation, which by construction does not hash alike | **Yes — declared.** `artifacts/acos-jcs-1.spec.v1.txt`, 13479 bytes, `content_hash` `7af60fc5…a18f33` over its exact bytes. **Class 20 signs the SPECIFICATION, never an implementation.** Both planes hold byte-identical **copies**; the implementations stay independently authored | **NO CHANGE** |
| **MAN-01** (`S1K-C9`) | `50 §3` signed **rows**. Per-row signatures authenticate the rows present and **do not protect the row set**: a deleted row removes a requirement, and `50 §5` pointed at external anchoring — `I17b`, an **S3** deliverable — as the control | **Yes — declared.** A **dual-signed MANIFEST CORE** carrying the format version, epoch, both expected key ids, an exact `entry_count` and the exact ordered entries; `manifest_id = SHA-256(CORE)`; and a **deployment-pinned `EXPECTED_ACTIVE_MANIFEST_ID`** checked before the signatures. **S1K does not depend on `I17b`** | **NO CHANGE** |
| **2FA-01** (`S1K-C10`) | `50 §4` required a second factor on **every artifact S1K was asked to sign** and declared **no mechanism** — not what it is, not how its use is evidenced in a row that has no field for it, and not how a verifier establishes it. A runtime accepting one owner signature would have reported an insufficiently authorised artifact **as verified** | **Yes — declared.** A second **independent** Ed25519 approval signature under a **distinct** public key, with `signer_role` bound inside the signed message. Two signatures on every pre-live artifact **and on the manifest core**. One valid signature is **REFUSED** and never reported as verified | **NO CHANGE** |

**Plus one re-sequencing.**

| # | Item | Change |
|---|---|---|
| **SEQ-03** | `37 §2` placed *"`50-control-artifact-manifest.md` with owner-signed hashes across all sixteen classes (I19)"* at **S4**, as one undivided item | **Only the pre-live subset moves to S1** — the trust roots, the envelope, the dual-signed manifest core and its pin, classes 2, 3, 20 and 27, and the runtime verified-bundle gate — because it is a precondition for safely enabling any real external dispatch. **`I17b`, the remaining classes, the later owner briefing, the unrelated S4 audit mechanisms, provider reconciliation and class 19's key migration all stay where they were** |

**Authority quantities, restated and reverified.** `MAL_monetary(month)` = **$300.00**. `Standing(month)` = **$182.40 / $186.00**. `MIE_cost(month)` p95 = **$270.00**. `MAL_total(month)` at the signature basis = **$756.00**. `refund.create`'s `per_action_max` = **$25.00**. `degraded_per_action_approval_floor_monetary` = **$20.00** — *the value is unchanged; only its owning class moves*. `mirror_lag_critical_threshold` = **PT15M**; `audit_unreachable_full_halt_threshold` = **PT30M**. `corroboration_signal_max_age` = **PT5M** — *the value is unchanged; it gains an owning class it did not have*. Every `51 §3.6` override quantity unchanged. Every `51 §2.3` unit count unchanged — *only its owning class moves*. `attestation_cadence` = 5 minutes, `k` = 3, anchor interval = 60 minutes — all unchanged. **`analysis/recompute-v1.3.py` reproduces `analysis/recompute-v1.3-output.txt` line for line after this pass. No owner re-signature of the MAL basis is required.**

---

## 1. CAS-01 — the owner signature's algorithm is declared

### Omission

`50 §3` printed the manifest row as `{class, artifact_id, version, content_hash, signed_at, signature}`. **`signature` was a bare field name.** No passage in the operational corpus declared an algorithm for an *owner* control-artifact signature.

**The near miss, and why it was one.** Ed25519 appeared as a normative signer declaration exactly once, at `30 §5.7.1` / `50 §2` class 24: the audit plane's key, *"generated on and never leaving the audit-plane host"*, whose public half the control plane holds **as a control artifact hashed into the owner-signed manifest**. That construction terminates only because a trusted owner key exists above it. **Reading the owner's algorithm off the audit plane's inverts the dependency.** Requiring the runtime to reject a *"wrong algorithm identifier"* has no content when there is no declared algorithm to be wrong about.

### The declaration

`50 §3a`, "The algorithm". **Ed25519** — RFC 8032 PureEdDSA over Curve25519, a 32-byte public key, a 64-byte signature, signing the message directly with **no pre-hash step and no context string**. The same algorithm covers the primary owner artifact signature, the second-factor approval signature, the signed manifest envelope, and the Cedar/O4 artifact signatures now brought under the mechanism.

**No custom elliptic-curve construction. No RSA alternative. No algorithm negotiation in S1.** A signature presented under any other algorithm identifier, or in any other encoding, is **REFUSED**; there is no fallback path and no *"try the other verifier"* branch. **An implementation that selected a verifier from a presented algorithm identifier would not conform**, which is the concrete shape of the algorithm-confusion attack this closes.

**Distinctness from every other Ed25519 key in the system is stated positively**, because the repository already holds four: the audit-plane signing key (class 24); the `ConstructorVersionRecord` verification key (class 19, `§11`); an OWNER-tier principal's runtime grant-signing key; and adapter or provider credentials. **None of them is an owner control-artifact root.**

---

## 2. CAS-02 — `ACOS-CAS-SIG-V1`, the signature envelope

### Omission

`50 §3` printed a **struct**, not a signing input. Nothing declared that the signature covers `{class, artifact_id, version, content_hash}`, in what order, under what framing, or under what domain separator. The fields that would prevent artifact A's signature being reused for artifact B, a class-3 signature for class 20, an old version for a new one, and one hash bound to the wrong identity were all **present in the row** — which is why this was a specification gap rather than a structural impossibility, and exactly why it could not be closed by inference.

### The declaration

`50 §3b`. A fixed binary framing used **only** to form signature messages for control artifacts and for the manifest.

```
CAS_FIELD(b) = uint32_be(len(b)) || b
```

**Length prefix**: 4 bytes, big-endian, unsigned, on every field. **Payload**: raw bytes; every value is a byte string and there are no typed payloads. **NULL**: *not representable at all* — no reserved word, no sentinel, no absent state. **Separators**: none; fields are concatenated. **Text**: UTF-8 then NFC, `U+0000` excluded. **Integers**: decimal ASCII, no leading zeros, no leading plus — so the only binary integer in the framing is the length prefix. **Digests**: 32 raw bytes, never hex. **Signatures**: 64 raw bytes. **Maximum field length**: `0xFFFFFFFE`, with `artifact_id` at most 256 bytes and `artifact_version` at most 64; a value exceeding its maximum **fails closed** and is never truncated.

```
M_artifact =
    CAS_FIELD("ACOS-CONTROL-ARTIFACT-SIGNATURE-V1")
 || CAS_FIELD(signer_role)                            # "PRIMARY" | "SECOND_FACTOR"
 || CAS_FIELD(artifact_class)
 || CAS_FIELD(artifact_id)
 || CAS_FIELD(artifact_version)
 || CAS_FIELD(content_sha256)
```

Ed25519 signs `M_artifact` directly.

**Independence is declared three ways and is load-bearing for `§8`.** The framing **does not depend on the artifact being signed** — it never parses, inspects, canonicalises or reserialises artifact content, consuming only identity fields and a digest. It **does not depend on `ACOS-JCS-1`** — no rule referenced, imported or required. It **uses no JSON and no JSON reserialization**. The coincidence that both use a four-byte big-endian length prefix is **not a dependency**: `ACOS-CAS-SIG-V1` is completely specified in `§3b`, and a change to `ACOS-JCS-1` does not change it. **The absence of a NULL representation is the clearest demonstration that the two framings are separate specifications rather than one reused.**

**Signer-role separation is by an explicit field inside the message**, normatively, rather than by per-role domain separators; the two mechanisms are not combined. A signature produced as `PRIMARY` therefore **cannot be transplanted into the `SECOND_FACTOR` slot even if the two keys were accidentally identical**. **The distinct-public-key requirement of `§3` is still separately required**; neither alone is sufficient, and `§10` is why.

---

## 3. ROT-01 — the root of trust terminates outside the artifact graph

### Omission

**This was the dispositive one.** The only two statements about the owner key were `49 §3.9` — *"Root of trust. Out of architectural scope, correctly."* — and `50 §5` — *"The owner is the root of trust and a compromised owner credential is out of architectural scope."* **Both are statements about blast radius. Neither is a key-distribution mechanism.** Nothing said where a running ACOS process obtains the public half it verifies against.

**The circle, stated plainly.** The manifest is trusted *because it is owner-signed*. The owner signature is trusted *because the verifying key is the owner's*. Nothing states which key that is.

**Class 24 is the proof the gap was real rather than an oversight of reading.** The architecture *did* close this question for the audit plane's key, by making the public half a control-artifact class hashed into the owner-signed manifest. **There is no class 24 for the owner's own key, and there cannot be one — a class-24-shaped answer for the owner key would be exactly the circle.**

### The declaration

`50 §3a` and `49 §3.9`.

**Two trust roots.** `OWNER_ARTIFACT_ROOT_KEY` verifies the PRIMARY signature and the primary manifest signature. `OWNER_ARTIFACT_SECOND_FACTOR_KEY` verifies the SECOND_FACTOR signature and the second-factor manifest signature.

**Both are TRUSTED DEPLOYMENT ROOTS**, provisioned **out of band** through the trusted deployment mechanism, as deployment trust configuration **outside the signed artifact set**. They are **not** control artifacts, **not** manifest rows, and **not** discovered from a database, from the manifest, from the network, from a model, from a caller, from an API, or from the first signature observed. **TRUST-ON-FIRST-USE IS FORBIDDEN**, with all three of its routes named and denied: remembering the key that first verified, accepting any valid Ed25519 key, and a per-request key parameter.

> **A SIGNATURE DOES NOT ESTABLISH ITS OWN VERIFIER.**

**The manifest may carry key IDs for consistency checking and cannot define which keys are trusted.** `§3d`'s core carries `expected_primary_key_id` and `expected_second_factor_key_id`; they are checked **against** the provisioned keys. **If the manifest names a different key: FAIL CLOSED.** **There is no owner-key artifact signed by itself, and none may be created.**

**Key identifiers.** `key_id = SHA-256(raw_ed25519_public_key_bytes)` over the exact 32 raw bytes — not DER, not SPKI, not PEM, not base64 — in lowercase hex. **The key ID is not the trust anchor by itself; the public-key bytes are.**

**Custody.** Neither private key exists in application source, in this repository, in any database, in any environment available to the runtime, on the runtime filesystem, in the manifest, or in any CI fixture used by production. Production signing is an **offline release ceremony**. **No HSM or vendor is specified**, because specifying one would be an architecture claim about an operational deployment concern.

**Rotation.** Root-key rotation is an **owner/deployment ceremony**: the trust configuration changes explicitly and out of band, and the runtime restarts and re-bootstraps. **An old manifest cannot cause its own trust root to remain accepted**, because trust roots are never read from a manifest. **Online root rotation is DEFERRED**, and there is no *"try every key the manifest offers"* behaviour.

---

## 4. I19-01 — the verification occasions

### Omission

`I19 (continuous)` wrote `continuous` over a three-line `for` loop and the registry wrote `CI + RUNTIME + SCHED`. **That declares the action and not the occasion.** `SCHED` names a scheduled leg with no period, and whether the check sits before the irreversible `CLAIM`, and whether an artifact is verified no later than first authoritative use, were questions the architecture had to answer before an implementation could place it.

### The declaration

`50 §3f`. **`I19` is EVENT- and USE-GATED. It is not periodic-timer security.** No polling cadence is introduced — not 30 seconds, not 60 seconds, not 5 minutes, not any interval. **The invariant is "continuous" because no authority consumer can obtain or use an unverified control-artifact bundle**, which is a structural property rather than a schedule.

**Occasion 1 — BOOTSTRAP, before the kernel becomes READY.** Eight steps in declared order: load the two provisioned root keys; check they differ; compute `manifest_id` and check the pin; verify both manifest signatures; check the core's expected key ids against the provisioned keys; verify the complete manifest set; recompute every required artifact's `SHA-256` over its exact bytes; verify both signatures on every artifact. **On any failure the kernel fails closed before any authority execution** — it does not become READY, does not serve a degraded subset, and does not admit a single effect.

**Occasion 2 — PUBLICATION / RELOAD.** Any reload runs the full ceremony **before becoming active**. **Publication is atomic**, a **failed candidate never replaces the current verified bundle**, and there is **no partial swap and no per-artifact hot reload**.

**Occasion 3 — RUNTIME AUTHORITY USE.** Authority code receives only a **`VerifiedControlArtifactBundle`**, an immutable capability whose existence is proof that occasion 1 or 2 completed for the bytes it carries. **Raw or unverified loaders are not exposed to authority consumers, and no caller and no model may manufacture the capability.** **Re-verifying signatures inside every request is not required**, because the capability already proves it.

**Backing-store changes, stated because this is what "continuous" is usually taken to mean.** The runtime does not reread arbitrary backing bytes per operation; the active bundle is **immutable**. **Files changing on disk after verification have no authority effect until an explicit reload runs the full ceremony.** **There is therefore no security requirement to rehash periodically, and "continuous" means continuity of the capability rather than frequency of a check.**

**The registry is corrected.** `SCHED` is **withdrawn** from `I19`'s enforcement column and replaced by `CI + RUNTIME (BOOTSTRAP + PUBLICATION + VERIFIED-CAPABILITY USE)`.

**Failure semantics are retained unchanged**: fail closed; do not use the candidate; raise the declared CRITICAL security incident; journal it where a trusted journal remains operational; **no silent fallback to an older artifact; no network fetch of a replacement.** Where bootstrap fails before journalling is safely available, **local startup-failure evidence may be the only immediate signal, and that is accepted** — **a journal chain must not be fabricated using unverified `ACOS-JCS-1` rules in order to record the failure of the artifact that declares those rules.**

---

## 5. HASH-01 — exact-byte content hashing

### Omission

`50 §3` property 1: *"The hash is over canonicalised content, not the file bytes."* **The package contains exactly one canonicalisation specification — `ACOS-JCS-1` — and it is scoped to journal rows**: its column-order rule is *"fixed, declared per row kind"*, and no control artifact is a journal row or has a declared row kind. **And for class 20 the circularity was total**: class 20's signed content *is* `ACOS-JCS-1`, so canonicalising it under itself makes the integrity check of the specification depend on the specification under test.

### The declaration

`50 §3c`. **`content_hash = SHA-256(EXACT_ARTIFACT_BYTES)`**, over the exact immutable bytes deployed to the consumer. Any byte difference — a line terminator, a trailing newline, a byte-order mark — changes the digest and therefore the artifact's identity.

**Never hashed:** a parsed semantic object; a reserialised JSON document; a pretty-printed object; a TypeScript object literal or its property order; a runtime object graph; a row set read from a database.

**v1.3.5's property 1 is explicitly SUPERSEDED rather than quietly replaced**, and its cost is accepted in the open: a whitespace change **is** a different artifact and will halt the class's halt scope. That cost is paid deliberately, because the alternative requires a canonicalisation that class 20 cannot have without signing itself under itself.

**A signed control artifact is therefore a concrete immutable byte object** carrying exactly: class, id, version, bytes, `SHA-256` of those bytes, a primary signature and a second-factor signature.

---

## 6. BND-01 — closed content boundaries, and single ownership

### Omission

Three distinct boundary failures, all of which make a content hash uncomputable.

**(a) Class 3's list was open prose.** `50 §2` read *"Action catalogue, **incl.** recoverability class, …"*. The accepted `ActionCatalogueEntry` carries six further fields and **every one is authority-bearing**: `adapter` (from which `I66`'s outbox scope predicate is derived — changing it to `internal_only` removes an effect from the outbox entirely), `method`, `carriesVendorMonetaryField` (`I18a`'s null branch), `costComponentFree` (`I18c`), `rateBased` (`26 §2.1.3`) and `settlementTolerance` (`I18d`). **A signature omitting `adapter` leaves the outbox scope predicate unsigned; a signature including it is a boundary the implementation drew.**

**(b) Class 3's and class 17's content co-resided in one frozen literal.** `51 §2.3` assigned `irrecoverable_units` to class 17; the implementation carries it as a field of each class-3 catalogue entry. **One frozen literal, two signed classes, no declared split** — so hashing the literal would sign class-17 content into class 3's hash and move class 3's digest whenever a unit count changed.

**(c) Class 3's and class 27's content were two exports of one module.** The `$20.00` approval floor (class 3 per `50 §2`) and the two timing thresholds (class 27) sit in one file with **the same halt scope of "All effects"** and no declared boundary.

### The declaration

**`50 §2a` closes class 3** at exactly fourteen entries: ten per-action-class fields — `action_class`, `recoverability`, `value_direction`, `carries_vendor_monetary_field`, `cost_component_free`, `rate_based`, `irrecoverable_units`, `settlement_tolerance`, `adapter`, `method` — and four catalogue-level records: `reason_codes`, `reason_code_scopes`, `semantic_option_digest_fields`, `enumeration_max_age`. **There is no `incl.`, no `etc.` and no open tail**, and the section states the boundary's *other* side as well, so a reader can tell what was excluded and why.

**`50 §2c` closes class 27** at exactly four static quantities: `mirror_lag_critical_threshold` (`PT15M`), `audit_unreachable_full_halt_threshold` (`PT30M`), `degraded_per_action_approval_floor_monetary` (**USD 20.00, moved here from class 3**) and `corroboration_signal_max_age` (`PT5M`, **which previously had no signed owner at all**). **No runtime state is class-27 content** — not the open declaration or its `opened_at`, not the resolved mirror state, not the held corroboration, not an active override.

**`50 §2e` gives class 2 a concrete bundle**: the Cedar schema file plus every `.cedar` policy source file, as one immutable byte object.

**Both co-residences are resolved by ownership rather than by splitting a file.** `irrecoverable_units` is **class 3** content wherever it is stored (`§7`); the approval floor is **class 27** content wherever it is stored. **The two quantities may continue to live where they live; what changes is which signature covers them.**

**The closure rule is stated once, for the whole inventory.** Any field capable of affecting policy authority, economic authority, recoverability, adapter selection, external-write scope, canonicalisation, dispatch precedence, degraded-mode authority or effect construction **must have exactly one declared artifact owner**; none may sit outside all boundaries; **and none may belong ambiguously to two.** The single declared duplication in the package — the audit plane's copy of `corroboration_signal_max_age` — is named as normative in `§2c` rather than left implicit.

**`50 §2f` reads the same closure FIELD FIRST.** `§2a`, `§2c`, `§2d` and `§2e` each close one artifact; `§2f` is the transpose — one row per authority-bearing static field a current production mechanism reads, each naming **exactly one canonical signed owner**, and each recording whether it was ambiguous at v1.3.5. **It adds no field, moves no field and changes no value**: it is the same closure, indexed the other way, so that *"which signed artifact owns this?"* is answerable without reconstructing it from four sections. **`external-dispatch predicate` is the row worth noting** — `I66`'s outbox scope is **DERIVED FROM** `adapter` (class 3, `§2a` field 9) and is not separately stored, so it has one owner rather than none. **Override limits are class 25, not class 27**, and the table prints that rather than leaving the adjacency to be inferred.

**What the rule deliberately does not reach, stated so its edge is visible.** `attestation_cadence` and `k` are `30 §5.4` **detection-latency** parameters. They change how quickly silence is noticed; they are not operands of any of the nine authority kinds above. **They are therefore outside the rule, by the rule's own terms, and not by omission.** Class 27 declares `PT15M` as a literal, so its documented alignment with `attestation_cadence × k` is a rationale rather than a dependency.

---

## 7. CAT-01 — class 17's disposition, and the category error

### Omission

`50 §2` class 17 listed *"named exposure windows — window ids, `boundary_kind`, `max_monetary`, `max_count` …, `max_irrecoverable_units`"*, and `51 §1` says windows are *"company-scoped named objects"*. The deployed representation is `window_registry`: `PRIMARY KEY (company_id, window_id)`, `REFERENCES company(company_id)`. **Rows, keyed by company, written at runtime** — inside a deploy-time artifact set carrying `signed_at` and an owner ceremony ADR-025 describes as one *"the owner must actually perform"*.

**Nothing declared** how a per-company runtime row participates in a build-time manifest, **who signs a window created for a company after the ceremony**, what happens to `I19` in the interval, or whether `artifact_id` is per class, per company or per window. **Making an offline owner ceremony a precondition of onboarding a company is not a reading anyone intended.**

A second, independent boundary problem sat in the same class: `51 §2.3`'s table declares **seven** action classes where the S1 closed catalogue deploys **four**, and it was not declared whether the signed content is the architecture's table or the deployed subset.

### The declaration

`50 §2d`. **PER-COMPANY `window_registry` ROWS ARE NOT DEPLOY-TIME SIGNED CONTROL ARTIFACTS. They are runtime authoritative database state.**

| v1.3.5 class-17 content | v1.3.6 disposition |
|---|---|
| window ids, `boundary_kind`, `period` | **runtime state** — `window_registry` rows |
| `max_monetary`, `max_count` and its sub-ceilings, `max_irrecoverable_units`, and the `UNBOUNDED` flags | **runtime state** — `window_registry` rows |
| `51 §2.3`'s per-action-class `irrecoverable_units` | **class 3**, `§2a` field 7 |

**Nothing static remains with a runtime consumer.** `51 §2`'s window table is a Stage-2 **limits fixture** — the figures an owner would provision — and the runtime reads `window_registry`, never the fixture. **Class 17 is therefore RETIRED from the deploy-time signed manifest, and no empty or signature-only artifact is retained to preserve numbering.** The number is **reserved and deprecated**, never reassigned, and its history stays in `50 §2` so a reader of an older manifest can resolve it.

**The seven-versus-four question dissolves with the retirement rather than being answered.** `51 §2.3`'s table is class-3 content, and class 3's artifact is the **deployed closed catalogue** — which has four members. The architecture's seven-row table remains the Stage-2 fixture it always was.

**Runtime-state integrity is not weakened.** `50 §3h` names the mechanisms that govern it and always did: trusted writer boundaries; PostgreSQL constraints, including the ceiling and commitment guards; economic transaction semantics; the journal and audit mechanisms; and owner/grant authority. **`I19` is not a generic database-row-signing system and is not extended into one.**

---

## 8. JCS-04 — class 20's concrete artifact

### Omission

`50 §2` class 20's signed content is `ACOS-JCS-1` itself. **That specification existed in the repository as three conforming production implementations and no artifact** — the control-plane PL/pgSQL functions, the audit-plane PL/pgSQL functions, and the TypeScript canonicaliser — plus normative prose in `30 §5.3` and `§5.3a`, which lives in the architecture package and not in the deployed system.

`50 §3` verifies *"each deployed control artifact"* by recomputing its content hash. **Class 20 had no deployed artifact.** Signing an implementation signs a **conformant instance**, not the specification, and three instances would need three signatures for one class with one `content_hash`. **`50 §3` property 2 made it sharper still**: the audit plane must recompute the same hash from its own copy, and its copy of class 20 was a *different implementation of the same spec*, which by construction does not hash alike.

**This is why class 20's signature had been owed since v1.3.2 and had been enlarged three times without ever being dischargeable.** Each erratum correctly recorded that the `content_hash` moved; **none declared what the content is.**

### The declaration

`50 §2b`. **The artifact is `artifacts/acos-jcs-1.spec.v1.txt`**, in this package.

| | |
|---|---|
| `artifact_id` | `acos.control.jcs1_specification` |
| `artifact_version` | `ACOS-JCS-1` |
| Size | **13479 bytes** |
| Encoding | US-ASCII, valid UTF-8 NFC. **LF (`0x0A`) exclusively; no `0x0D` byte.** A CRLF copy is a different artifact and fails verification |
| `content_hash` | **`7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33`** |

It carries the complete machine-verifiable specification: version identity, the framing word and its reserved NULL encoding, the injectivity argument, the five representations that must never collapse, the absence rule, every type's payload rule, the collected normalization rules, what is hashed on the wire, the chain link, **both registered row kinds' exact field orders**, the withdrawn `0x00` sentinel, and six numbered conformance obligations.

**The mechanical gate recomputes this digest from the file on every run** and compares it to the declaration in `50 §2`, `50 §2b`, `50 §6` and `30 §5.3a`. **A declaration that drifted from the bytes fails the gate**, which is a property no previous class-20 statement could have.

**`50 §3` property 2 is satisfied rather than restated.** Both planes hold **byte-identical copies of one file**, so both recompute the same digest — which is precisely what could not be true when class 20's content was an implementation.

---

## 9. JCS-04(b) — what a class-20 signature proves, and what it does not

**Stated separately because conflating the two would be the more dangerous error.**

A valid pair of owner signatures over class 20's content hash proves **exactly one thing: this is the owner-approved `ACOS-JCS-1` specification.**

**IT DOES NOT PROVE THAT ANY IMPLEMENTATION CONFORMS TO IT.** Conformance is proved by **cross-implementation byte-identity validation** — `36 §2`'s VC-A3 and `36 §2.6`'s fixture — in which independently authored implementations serialise the same fixture rows and their output bytes are compared. **`I19` does not replace VC-A3, does not weaken it, and discharges none of its obligations**, and `30 §5.3a`, `36 §2` and `50 §2b` each say so.

**Implementation independence survives the shared artifact.** The control-plane PL/pgSQL implementation, the audit-plane PL/pgSQL implementation, the TypeScript implementation and the independent test oracle remain four separately authored artefacts; none is derived from another; and **none of their source code is ever hashed as class 20**. Each may hold a byte-identical copy of the specification.

> **Same specification; independent implementations.**

`36 §0`'s rule — that an agreement two implementations obtain from one source is not a cross-implementation check — is about the **implementations**, not about the specification they are both judged against. **A shared specification is the thing that makes the check meaningful; a shared implementation is what would destroy it.**

---

## 10. MAN-01 — the manifest core, its identity, and the deployment pin

### Omission

`50 §3` signed **rows**. **Per-row signatures authenticate the rows that are present and do not protect the row set.** Deleting a row removes a requirement, and the list of *which classes are required* lived in the same unprotected place; an attacker able to drop class 27's row needed to forge nothing. `50 §5` conceded the stronger case and pointed at **external anchoring** as the control — but external anchoring is `I17b`, an **S3** deliverable, so the control it pointed at **did not exist at S1**. v1.3.5 did not enumerate the manifest among its own rows and declared no signed root manifest. **The recursion was open.**

### The declaration

`50 §3d` and `§3e`.

**The MANIFEST CORE** carries the manifest format version, the manifest epoch, both expected key ids, an **exact `entry_count`**, and the **exact ordered entries**. Each entry carries class, artifact id, artifact version, content hash, primary signature and second-factor signature.

**Entry order** is ascending by `(artifact_class, artifact_id, artifact_version)`, with `artifact_class` compared as an unsigned integer and both strings compared **byte-wise lexicographic over their UTF-8 NFC bytes**, a proper prefix sorting before its extensions. **The order is a property of the bytes, not of any implementation's map iteration, locale or collation**, and two entries equal on all three keys are a **defect** rather than a tie.

**The core's bytes** use the same `ACOS-CAS-SIG-V1` field encoding and no other — **no `ACOS-JCS-1`, no JSON, no parsed-object insertion order**. `entry_count` sits inside the signed bytes *and* the entries follow it, so **a deletion is detectable twice over**.

**THE MANIFEST CORE ITSELF RECEIVES BOTH SIGNATURES**, under the separate domain `ACOS-CONTROL-MANIFEST-SIGNATURE-V1`, binding the format version, the epoch, both expected key ids and the core digest. **The manifest's own two signatures are not inside the bytes being signed.** The per-entry artifact signatures *are* inside the core, deliberately: they are part of the set whose integrity the manifest signature protects.

**`manifest_id = SHA-256(exact CORE bytes)`**, under the fixed framing — **not `ACOS-JCS-1`, not a parsed JSON object's insertion order.**

**The deployment pins three things**: both root public keys, and **`EXPECTED_ACTIVE_MANIFEST_ID`**. **The runtime may verify a manifest only if its computed `manifest_id` equals the pin**, and the pin is checked **before** the signatures — because a signature check on a manifest the deployment did not intend proves only that someone once signed something.

| Attack | Outcome |
|---|---|
| a valid **old** signed manifest | **REJECTED** on the pin |
| a **different** signed artifact set | **REJECTED** |
| a **deleted** entry | **REJECTED** — `entry_count` and the sequence both move `manifest_id` |
| an **inserted** entry | **REJECTED** |
| entries **reordered** | **REJECTED** — the declared order is normative |
| an artifact's **bytes changed** under an unchanged manifest entry | **REJECTED — NOT BY THE PIN.** `manifest_id` is unmoved; `50 §3f`'s bootstrap **step 7** fails on the recomputed content hash |
| bytes changed, entry updated, **old signatures kept** | **REJECTED** — **step 8** fails, because `§3b`'s envelope binds `content_sha256`; the core moved too, so the pin rejects it first |

**THE PIN IS ONE OF TWO LEGS, AND NEITHER IS SUFFICIENT ALONE.** The first five rows are rejected on the **manifest identity**, before any signature is checked; the last two are rejected on the **per-artifact content hash and signatures**, at `50 §3f`'s bootstrap steps 7 and 8. **The pin authenticates the SET and not the bytes; the per-artifact checks authenticate the BYTES and not the set.** Either leg failing fails the whole bootstrap closed.

**No mutable runtime trust state is introduced.** Nothing is remembered between runs and nothing is learned.

> **"THE HIGHEST EPOCH FOUND ON DISK" IS NOT ROLLBACK PROTECTION AND IS NOT USED.** `manifest_epoch` is recorded for lineage and operator legibility; **the pin is what rejects a rollback.**

**And `I17b` stays where it was.** The external anchor may later provide additional historical and non-repudiation protection. **It is not the bootstrap root of trust for S1K, S1K does not depend on it, and `37 §2` says so explicitly** so that a later reader cannot reconstruct the dependency by assuming one was intended.

---

## 11. 2FA-01 — the second factor, and class 19's relationship to the roots

### Omission

`50 §4`: *"Classes 1, 2, 3, 5, 15, 16, 17 and 19–27 require a second factor."* **That is every artifact S1K was asked to sign.** `33 §2.5` repeats it for the act: *"control-artifact manifest signing … requires a second factor."*

**Nothing declared what the second factor is, how its use is evidenced in a manifest row that has no field for it, or how a verifier establishes that a signature was produced under one.** A runtime accepting a single owner signature on a class-3 entry **accepts an artifact the architecture says is insufficiently authorised, and reports it as verified** — which converts an open obligation into a false assurance, the failure mode `47 §5` names for the `I8` sweep and `50 §5` names for a signed artifact that is wrong.

### The declaration

`50 §4`. **The second factor is a second independent Ed25519 approval signature.**

**Every pre-live signed artifact requires two valid signatures**: a **PRIMARY** signature under `OWNER_ARTIFACT_ROOT_KEY` and a **SECOND_FACTOR** signature under `OWNER_ARTIFACT_SECOND_FACTOR_KEY`. Both keys are externally provisioned trust roots; **the public keys and their key ids must be distinct**; the role is bound inside the signed message; and **a second signature from the same key does not satisfy the requirement**, whatever its `signer_role` claims. **A deployment configuring one key in both slots fails closed at bootstrap and never becomes READY.**

**The evidence is structural rather than an attestation field.** Each entry's `primary_signature` and `second_factor_signature` are **inside the signed manifest core**, so the pair is what the manifest signature covers. **The manifest core itself is dual-signed on the same rule.** **An artifact or a manifest presenting one valid signature is REFUSED and is never reported as verified.**

**Class 17 is struck from `50 §4`'s tier list** by the `§7` retirement.

### Class 19, reviewed rather than assumed

**S1B's `ConstructorVersionRecord` verification already performs a real Ed25519 signature check, and it does not satisfy the owner root model. This pass does not claim otherwise and changes no S1B production code.**

`ConstructorVersionResolver` takes the verifying public key **as a constructor argument** and holds no keystore, no rotation and no revocation list — a limitation S1B recorded, and was entitled to, because class 19 was not its subject. **A caller-supplied verification key is not a trust root, and it must not become the general S1K pattern.**

**Class 19 is an owner control artifact** — `50 §2` assigns it Owner plus second factor, and a constructor computes every dispatched amount. **Its verification keys should become the same externally provisioned roots**, and `50 §3i` declares that migration as **future work** rather than a pre-live blocker: class 19's records are verified at registry load against a key the kernel supplies from trusted code, not from a model or a request, so the exposure is bounded differently from the manifest's. **It is not a separate trust domain by design — it is the same domain, reached by a mechanism that predates the root declaration.**

---

## 12. SEQ-03 — the pre-live subset moves to S1

`37 §2` placed the whole control-artifact manifest at **S4**, as one undivided item, and S1's Build list named neither signing nor `I19`. **That was consistent with the omissions above rather than in tension with them**: the mechanism was undeclared because the architecture had not been asked to declare it.

**v1.3.6 pulls forward only the pre-live subset**, and `37 §2` now states, before the vendor slice, that **before the first real external vendor call ACOS must have**: externally rooted owner signature verification; second-factor verification; signed manifest set integrity; a verified class-3 action catalogue; a verified class-20 specification artifact; a verified class-27 degraded configuration; signed Cedar/`O4` verification; runtime verified-bundle gating as `I19` requires; and the migration of classes 3 and 27 off duplicated unsigned literals.

**The argument is the same shape as SEQ-01's and SEQ-02's, one level up.** The catalogue decides what may be dispatched and what it costs in irrecoverable units; the degraded configuration decides whether it may be dispatched at all; the Cedar bundle decides whether it is authorised. **An unsigned literal deciding any of those at the moment a real vendor call becomes possible is the window this gate closes.**

**What did not move**: `I17b`; owner-signed hashes for the remaining classes; the later owner briefing; the unrelated S4 audit mechanisms; provider reconciliation; class 19's key migration. **S4 keeps its own manifest entry for the classes whose consumers arrive there.**

---

## 13. What remains open after this pass

**Stated as residuals, not as closed items.**

| # | Residual | Status |
|---|---|---|
| 1 | **The entire S1K runtime implementation** — keys, signatures, the manifest, the loader, the verification ceremony, the `VerifiedControlArtifactBundle`, the artifact files consumed by production, runtime `I19`, Cedar signature verification | **OPEN.** Nothing is implemented by this pass, by design. `src/` and `tests/` are byte-identical to the accepted baseline |
| 2 | **Every `content_hash` except class 20's** | **NOT COMPUTABLE UNTIL THE ARTIFACTS ARE ASSEMBLED**, and none is manufactured here. Class 20's is real because its artifact is real |
| 3 | **Every owner signature** | **OWED.** No signature exists for any class. The ceremony is offline and has not been performed |
| 4 | **Production key management** — provisioning, storage, ceremony tooling, HSM or equivalent | **OPEN, and deliberately outside architecture.** `§3` declares what the runtime accepts, not how the owner holds a private key |
| 5 | **Online root-key rotation** | **DEFERRED.** Rotation is a deployment ceremony at S1; no runtime rotation mechanism is declared and none is invented |
| 6 | **Class 19's migration onto the owner roots** | **DECLARED FUTURE WORK** (`50 §3i`), not a pre-live blocker, and not silently claimed to be satisfied today |
| 7 | **`I17b` external anchoring** | **S3, unchanged.** It is not the bootstrap root of trust and S1K does not depend on it |
| 8 | **Classes 1, 4–16, 18, 21–23, 25–26 in the manifest** | **S4 or later**, when their consumers arrive. The closure rule of `§6` applies to each of them when they enter |
| 9 | **Cedar semantic correctness** — symcc, policy equivalence, policy rotation | **UNCHANGED and OPEN.** `§2e` brings the policy bundle inside the signature framework and makes no semantic claim |
| 10 | **`I20`, `I36`'s verification leg, the real-provider six-kill-point validation** | **OPEN**, exactly as v1.3.5 left them. This pass moves nothing into or out of them |
| 11 | **`H4`, `H8`, `H9` and `H13` had NO DISCRIMINATING SEED** — found while re-running every seed against the final tree of this pass | **CLOSED IN THIS PASS.** See `§14` |
| 12 | **`C1`–`C29` (fifteen live conditions) and `E1`–`E7` have no discriminating seed** | **OPEN, and newly DISCLOSED rather than newly created.** They have been seed-less since v1.3 and v1.3.1, **and no package has ever claimed otherwise for them**, so this is a disclosure and not a correction. **None is classified non-seedable**: several are computed rather than matched and a harness could exercise them; no pass has authored the controls. **Carried to a later errata pass.** Every condition the v1.3.2–v1.3.6 errata passes introduced — `F1`–`F3`, `G1`–`G10`, `H1`–`H13`, `J1`–`J16`, `K1`–`K25`, sixty-seven in all — is fully seed-covered, and `S1K` depends on none of the open twenty-two |

**And one thing this pass deliberately does not resolve.** `attestation_cadence` and `k` have no signed owning class. `§6` explains why the closure rule does not reach them — they are detection-latency parameters rather than authority operands — and records the reasoning rather than the conclusion alone, so a later pass that disagrees has something to disagree with.

---

## 14. The H-condition seed-coverage correction (verification errata)

**This is a correction to the VERIFICATION RECORD, not to the architecture.** No deliverable, no invariant, no quantity and no mechanism is touched by it.

> **Earlier package READMEs overstated H-condition seed coverage; v1.3.6 discovered and corrected the verification coverage going forward.**

**What was claimed.** `docs/architecture/v1.3.4/README.md` and `docs/architecture/v1.3.5/README.md` each state that every one of `H1`–`H13` is failed by at least one seeded negative control.

**What was true.** v1.3.4 shipped **eight** H seeds between thirteen conditions, and they reach **nine** of them — `H1`, `H2`, `H3`, `H5`, `H6`, `H7`, `H10`, `H11`, `H12`. **`H4`, `H8`, `H9` and `H13` had never been failed by any seed**, in v1.3.4, v1.3.5 or the first issue of v1.3.6. Each was a real condition that reads the corpus and can fail; what none of them had was **a recorded negative control proving a plausible WRONG architecture fails it** — the property every other errata condition carries.

**What was done.** The final v1.3.6 review found it before the freeze. **Four dedicated negative controls were authored and are now part of this package:**

| Seed | Condition it discriminates | Semantic property mutated |
|---|---|---|
| `--seed-caller-selects-clock` | **H4** | the evidentiary clock's deterministic ordering, and the decision's exclusive ownership of the choice (`30 §9.2.5`) |
| `--seed-posture-restores-row1` | **H8** (with **G6**, coupled) | `§5.1a`'s FULL-HALT POSTURE composition — that row 1 halts and is **not** restorable |
| `--seed-override-unlocks-row1` | **H9** | `§5.7.2`'s ordinary override scope, and its structural exclusion of IRRECOVERABLE |
| `--seed-adapter-pulled-into-s1` | **H13** | SEQ-01's S1/S4 split, and `I36`'s two legs landing in the two slices that can run them |

**Every one applies all of its edits, leaves the corpus parsing, deletes no section, corrupts no unrelated syntax and changes no unrelated quantity.** `phase2-v1.3.6-verification.md §1a` records each mutation, why it is the right one, and the single documented coupling.

**HISTORICAL PACKAGES ARE NOT MODIFIED.** `docs/architecture/v1.3.4/` and `docs/architecture/v1.3.5/` are byte-identical after this pass and their inaccurate README statements stand as issued. **The correction is recorded forward, in this package, and no history is rewritten.**
