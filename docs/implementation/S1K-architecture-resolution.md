# S1K — Architecture resolution against package issue v1.3.6

**An ARCHITECTURE-ONLY owner-resolution pass. No runtime implementation.**

`S1K-result.md` returned **PARTIAL** against `docs/architecture/v1.3.5/` with ten blocking normative omissions, `S1K-C1`..`S1K-C10`, recorded verbatim in `S1K-owner-clarifications.md`. **This document records their resolution in `docs/architecture/v1.3.6/` and nothing else.** It authorises no code, and none was written.

| | |
|---|---|
| Baseline HEAD | `1cf1816` — the S1K findings checkpoint |
| Accepted implementation baseline | `ad8a78e` |
| Branch | `feature/s1k-control-artifact-integrity` |
| Package before this pass | `docs/architecture/v1.3.5/` — **byte-identical after it** |
| Package after this pass | **`docs/architecture/v1.3.6/`** — ACOS Operating Spine v1.3, package issue v1.3.6 |
| `src/` and `tests/` | **byte-identical to `1cf1816`** |
| Architecture gate | **89 PASS / 0 FAIL** (was 64) |
| Seeds | **54** — 29 retained, all still failing; 25 new, every one discriminating |

---

## 1. The ten dispositions

| Item | The exact issue at v1.3.5 | v1.3.6 resolution | Remaining implementation work |
|---|---|---|---|
| **`S1K-C1`** | The owner signature's **algorithm is undeclared**. `50 §3`'s `signature` is a bare field name; Ed25519 appears once normatively, for the **audit plane's** key (class 24), a different signer whose trust terminates on the owner key | **RESOLVED — Ed25519.** `50 §3a`: RFC 8032 PureEdDSA over Curve25519, 32-byte public key, 64-byte signature, signed directly with no pre-hash and no context string. Covers the primary artifact signature, the second-factor signature, the manifest envelope and the Cedar/O4 signatures. **No custom curve, no RSA alternative, no negotiation in S1**; any other algorithm identifier REFUSED with no fallback branch | Implement the verifier. **It must not select on a presented algorithm identifier**, and a test must prove an alternate-algorithm signature is refused rather than unsupported |
| **`S1K-C2`** | The **signing message is undeclared**. `50 §3` prints a struct: no field set, no order, no framing, no domain separator, so `§29`'s independent oracle had nothing to reproduce | **RESOLVED — `ACOS-CAS-SIG-V1`.** `50 §3b`: `CAS_FIELD(b) = uint32_be(len(b)) ‖ b`, raw-byte payloads, **no NULL representable**, no separators, UTF-8 NFC text, decimal-ASCII integers, raw digest and signature bytes, declared maxima. `M_artifact = domain ‖ signer_role ‖ class ‖ artifact_id ‖ version ‖ content_sha256`, domain `ACOS-CONTROL-ARTIFACT-SIGNATURE-V1` | Implement the encoder **and an independent oracle written from `§3b` alone**. Four substitution attacks must each fail: cross-class, cross-artifact, version, and a `PRIMARY` signature moved into the `SECOND_FACTOR` slot |
| **`S1K-C3`** | **The root of trust is circular.** The only statements about the owner key are blast-radius notes. Nothing says where a running process obtains the public half. The one repository precedent — S1B's class-19 resolver — takes the key **as an argument**, which `§7` of the S1K mandate forbids | **RESOLVED — two externally provisioned Ed25519 public keys.** `50 §3a` and `49 §3.9`: `OWNER_ARTIFACT_ROOT_KEY` and `OWNER_ARTIFACT_SECOND_FACTOR_KEY`, **trusted deployment roots**, never control artifacts, never manifest rows, never discovered from a database, manifest, network, model, caller, API or first observed signature. **TOFU FORBIDDEN.** *A signature does not establish its own verifier.* `key_id = SHA-256(raw public key)`, lowercase hex; the key id is **not** the anchor | Implement loading from deployment trust configuration. **No keystore lookup, no per-request key parameter, no manifest-sourced key**, and a type-level negative proving an authority path cannot accept a caller-supplied key |
| **`S1K-C4`** | **`I19 (continuous)` has no enforceable runtime semantics.** The action is complete, the occasion absent; `SCHED` names a schedule with no period | **RESOLVED — three occasions, no timer.** `50 §3f`: **bootstrap before READY** (eight ordered steps, fail closed before any authority execution); **verification before publication** (atomic, failed candidate never replaces the active bundle); **verified-capability use** (`VerifiedControlArtifactBundle` only). **No polling cadence at any interval**; `SCHED` withdrawn from the registry. *Continuous* = continuity of the capability, not frequency of a check | Implement the bootstrap ceremony and the capability boundary. **A disk change after verification must have no authority effect until an explicit reload**, and a test must prove it |
| **`S1K-C5`** | *"Canonicalised content"* **names no canonicalisation** for control artifacts, and is **circular for class 20**, whose signed content *is* the canonicalisation specification | **RESOLVED — exact bytes.** `50 §3c`: `content_hash = SHA-256(EXACT_ARTIFACT_BYTES)`. Never a parsed object, a reserialised JSON document, a pretty-printed object, a TypeScript literal, a runtime object graph or a row set. v1.3.5's property 1 is **explicitly superseded**, and the cost — a whitespace change is a different artifact — is accepted in the open | Hash bytes, never objects. **A parse-then-reserialise implementation must fail the conformance case**, as `36 §2` VC-K2 requires |
| **`S1K-C6`** | **Content boundaries undeclared.** Class 3's list is open prose with six authority-bearing production fields outside it; class 3/17 co-reside in one frozen literal; class 3/27 are two exports of one module | **RESOLVED — closed schemas, single ownership.** `50 §2a` closes class 3 at ten per-class fields plus four catalogue-level records, numbered 1..14. `50 §2c` closes class 27 at four static quantities. `50 §2e` gives class 2 a concrete bundle. **Both co-residences resolved by ownership rather than by splitting a file.** The closure rule is stated once for the whole inventory, with its edge — `attestation_cadence` and `k` — argued rather than omitted | Assemble the class-3 and class-27 artifacts from the closed schemas and **migrate the production consumers onto the verified bundle.** Until that happens the unsigned literal is still authoritative |
| **`S1K-C7`** | **Class 17's content is per-company runtime database rows.** `window_registry` is keyed `(company_id, window_id)` and written at runtime, inside a deploy-time ceremony. Nothing says who signs a window created after it. A second boundary problem: seven declared action classes against four deployed | **RESOLVED — class 17 RETIRED.** `50 §2d`: per-company window rows are **runtime state**; `irrecoverable_units` moves to **class 3**; **nothing static remains with a runtime consumer**, so **no empty artifact is retained** and the class number is **reserved and deprecated**. The seven-versus-four question dissolves: `51 §2.3` is class-3 content and class 3's artifact is the **deployed** closed catalogue. `50 §3h` names the runtime-integrity controls that govern the rows instead | **None for class 17.** Do not build a class-17 artifact. Do not extend `I19` into row signing |
| **`S1K-C8`** | **Class 20 has no artifact to sign.** `ACOS-JCS-1` exists as three conforming implementations plus architecture prose; `50 §3` property 2 requires the audit plane to recompute the same hash from a **different** implementation, which by construction does not hash alike | **RESOLVED — a concrete artifact.** `50 §2b`: `docs/architecture/v1.3.6/artifacts/acos-jcs-1.spec.v1.txt`, **13479 bytes**, LF only, US-ASCII, `content_hash` **`7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33`** — **recomputed by gate condition K12 on every run.** Both planes hold **byte-identical copies**; property 2 is satisfied rather than restated. **Class 20 signs the specification, never an implementation** | Deploy a byte-identical copy to each plane. **Never hash an implementation's source as class 20.** `36 §2` VC-A3 remains the conformance mechanism, undiminished |
| **`S1K-C9`** | **The manifest's own integrity is undeclared.** Per-row signatures do not protect the row set; the control `50 §5` points at is `I17b`, an **S3** deliverable that does not exist at S1 | **RESOLVED — a dual-signed manifest core with a deployment pin.** `50 §3d`/`§3e`: format version, epoch, both expected key ids, an exact `entry_count`, the exact entries ordered by `(artifact_class, artifact_id, artifact_version)` with each comparison declared; `manifest_id = SHA-256(CORE)`; **`EXPECTED_ACTIVE_MANIFEST_ID` pinned in deployment configuration and checked BEFORE the signatures.** Old, altered, deleted, inserted and reordered sets are each rejected on the pin. **"Highest epoch on disk" is explicitly not rollback protection**, and **S1K does not depend on `I17b`** | Implement the core encoder, the pin check **before** signature verification, and the four must-fail mutations of VC-K2 |
| **`S1K-C10`** | **The second factor is required on every artifact in scope and has no declared mechanism** — not what it is, not how it is evidenced in a row with no field for it, not how a verifier establishes it. A runtime accepting one signature reports an insufficiently authorised artifact **as verified** | **RESOLVED — a second independent Ed25519 approval signature.** `50 §4`: two valid signatures on **every** pre-live artifact **and on the manifest core**, under **distinct public keys with distinct key ids**, with `signer_role` bound inside the signed message. A second signature from the same key **does not satisfy** the requirement; a deployment with one key in both slots **fails closed at bootstrap**. Evidence is structural — both signature fields are inside the signed core. **One valid signature is REFUSED and never reported as verified** | Verify both, prove distinctness at bootstrap, and prove a single-signature artifact is refused rather than accepted-with-a-warning |

**All ten are RESOLVED. The verdict on the architecture resolution pass is PASS.**

**No new normative ambiguity was found while resolving them.** Three questions arose and each is answered in the package rather than deferred: the ownership of `corroboration_signal_max_age`, which had no signed class at all and is now class 27 (`50 §2c`); the standing of `attestation_cadence` and `k`, which the closure rule does not reach and `phase2-v1.3.6-errata.md §6` argues rather than omits; and the relationship of class 19's caller-supplied verification key to the new roots, which `50 §3i` declares as future work rather than silently claiming satisfied.

---

## 2. The sequencing change

`37 §2` previously carried the whole manifest at **S4**. **SEQ-03 pulls forward only the pre-live subset**, printed inside S1's block ahead of the vendor slice:

> **BEFORE THE FIRST REAL EXTERNAL VENDOR CALL, ACOS MUST HAVE** externally rooted owner signature verification; second-factor verification; signed manifest set integrity; a verified class-3 action catalogue; a verified class-20 `ACOS-JCS-1` specification artifact; a verified class-27 degraded-mode configuration; signed Cedar policy / `O4` verification; runtime verified-bundle gating as `I19` requires; and the migration of classes 3 and 27 off duplicated unsigned literals.

**What stayed where it was:** `I17b` external anchoring (S3, and explicitly **not** the bootstrap root of trust); owner-signed hashes for the remaining classes; the later owner briefing; the unrelated S4 audit mechanisms; provider reconciliation; class 19's key migration.

---

## 3. What this pass did NOT do

- **It implemented nothing.** No key, no signature, no manifest, no loader, no verification routine, no `VerifiedControlArtifactBundle`, no artifact consumed by production code, no runtime `I19`, no Cedar signature verification.
- **It enabled no transport.** No adapter, no HTTP client, no vendor SDK, no credential, no sandbox.
- **It changed no authority quantity.** `analysis/recompute-v1.3.py` reproduces its recorded output line for line. Two fields changed **owning class**; no figure moved.
- **It modified no earlier package issue.** `docs/architecture/v1.3.5/` is byte-identical.
- **It touched no production code.** `src/` and `tests/` are byte-identical to `1cf1816`.

---

## 4. Remaining S1K runtime work, after owner acceptance

1. **Deployment trust configuration** — load the two Ed25519 public keys from outside the artifact set; check distinctness; derive both key ids; fail closed on one key in both slots.
2. **`ACOS-CAS-SIG-V1`** — the encoder, plus an **independent oracle** written from `50 §3b` alone, and the four substitution attacks.
3. **Artifact assembly** — build the class-3 and class-27 artifacts from `50 §2a`/`§2c`'s closed schemas, and the class-2 Cedar bundle; deploy the class-20 specification artifact byte-identically to both planes.
4. **Content hashing** — `SHA-256` over exact bytes, with a parse-then-reserialise negative control.
5. **The manifest core** — encoder, deterministic ordering, `manifest_id`, and the pin check **before** signature verification, with the old/deleted/inserted/reordered must-fail set.
6. **Dual-signature verification** — on every artifact and on the core, with a single-signature artifact refused.
7. **Bootstrap** — the eight ordered steps, fail closed before READY, with the declared CRITICAL incident and no fallback and no network fetch.
8. **Publication** — atomic swap, full ceremony on the candidate, failed candidate never activating.
9. **`VerifiedControlArtifactBundle`** — the capability, with raw loaders unreachable from authority code and a type-level negative proving it.
10. **Consumer migration** — the action catalogue, the degraded-mode configuration, the `ACOS-JCS-1` consumers and the Cedar loader all reading the verified bundle, **retiring the duplicated unsigned literals** rather than asserting equality in a test.
11. **`36 §2` VC-K1, VC-K2 and VC-K3** as written.

**Only after all eleven may a real external vendor call be enabled, and enabling one is a separate decision.**

---

## 5. Pre-live gate status, restated plainly

| | |
|---|---|
| Real HTTP allowed? | **NO** |
| Real adapter allowed? | **NO** |
| Production credentials allowed? | **NO** |
| Runtime `I19` implemented? | **NO** |
| Owner signatures implemented? | **NO** |
| Any owner signature in existence, for any class? | **NO** |

**The architecture is now sufficient to implement against. Nothing is implemented, and the gate is unchanged in force.**
