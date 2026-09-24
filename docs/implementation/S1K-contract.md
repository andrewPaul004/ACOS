# S1K — Contract

**Baseline `653e632` (the OWNER-ACCEPTED v1.3.6 architecture checkpoint). Branch
`feature/s1k-control-artifact-integrity`. Package issue `v1.3.6`, unmodified.**

**NO REAL HTTP. NO REAL ADAPTER. NO VENDOR CREDENTIAL. NO PROVIDER SANDBOX. NO
RECONCILIATION. NO PRODUCTION PRIVATE SIGNING KEY.**

---

## 0. What this document supersedes

**The previous edition of this file described the PARTIAL pass** — the pre-live
re-evaluation that found ten blocking normative omissions in v1.3.5 and wrote no production
code. Those ten are `S1K-C1`..`S1K-C10`, they are recorded in
`S1K-owner-clarifications.md`, and **v1.3.6 closed all ten**. This edition describes the
runtime slice that implements the mechanism v1.3.6 declares.

Nothing in the PARTIAL edition's findings is withdrawn. They are discharged.

---

## 1. The invariant this slice exists to enforce

> **NO AUTHORITY-BEARING CONSUMER MAY USE AN UNVERIFIED CONTROL ARTIFACT.**

`50 §3f` states the same property as the reason `I19` can be called continuous without a
timer: *"The invariant is 'continuous' because NO AUTHORITY CONSUMER CAN OBTAIN OR USE AN
UNVERIFIED CONTROL-ARTIFACT BUNDLE, which is a structural property rather than a schedule."*

---

## 2. The trust chain, as built

```
deployment trust configuration
  OWNER_ARTIFACT_ROOT_KEY, OWNER_ARTIFACT_SECOND_FACTOR_KEY, EXPECTED_ACTIVE_MANIFEST_ID
        |                                     src/kernel/controlArtifacts/trustConfig.ts
        v
ACOS-CAS-SIG-V1 framing  +  SHA-256  +  Ed25519
        |                                     casSig.ts (no imports at all), ed25519.ts
        v
manifest core, manifest_id, the deployment pin
        |                                     manifestCore.ts
        v
per-artifact exact-byte hashes and dual signatures
        |                                     verifier.ts
        v
VerifiedControlArtifactBundle  (opaque, immutable, sealed only by verification)
        |                                     bundle.ts, registry.ts
        v
kernel authority mechanisms
   class 3 -> actionCatalogue.ts        class 27 -> degradedModeThresholds.ts, mirrorState.ts
   class 2 -> policyArtifacts.ts        class 20 -> jcs1Admission.ts -> canonicalBytes.ts
```

`50 §3g`: **no edge points upward.** `casSig.ts` has no `import` statement at all;
`ed25519.ts` imports only `node:crypto`; nothing on the bootstrap path reaches
`canonicalBytes.ts`. `tests/controlArtifacts/framing-and-oracle.test.ts` asserts each of
those over the import graph rather than in prose.

---

## 3. What is in scope, and where it lives

| Obligation | Section | Implementation |
|---|---|---|
| The signature envelope | `50 §3b` | `src/kernel/controlArtifacts/casSig.ts` |
| Ed25519 and `SHA-256`, no negotiation | `50 §3a` | `controlArtifacts/ed25519.ts` |
| Deployment trust roots and the pin | `50 §3a`, `§3e` | `controlArtifacts/trustConfig.ts` |
| The manifest core and its identity | `50 §3d`, `§3e` | `controlArtifacts/manifestCore.ts` |
| The closed pre-live set; class 17 refused | `50 §6`, `§2d` | `controlArtifacts/requiredSet.ts` |
| The eight-step bootstrap ceremony | `50 §3f` occasion 1 | `controlArtifacts/verifier.ts` |
| The verified bundle capability | `50 §3f` occasion 3 | `controlArtifacts/bundle.ts` |
| Publication, reload, the READY gate | `50 §3f` occasion 2 | `controlArtifacts/registry.ts` |
| The artifact parsers (closed schemas) | `50 §2a`, `§2c`, `§2e` | `controlArtifacts/artifactParsers.ts` |
| Coarse denial, structured reason codes | `26 §2.2` doctrine | `controlArtifacts/errors.ts` |
| The CRITICAL incident, two occasions | `50 §3f` failure | `controlArtifacts/incidents.ts` |
| Independent audit-plane verification | `50 §3` property 2 | `src/audit/controlArtifacts/auditPlaneVerifier.ts` |
| Class-20 admission binding | `50 §3g` | `src/kernel/canonicalisation/jcs1Admission.ts` |
| The offline signer and assembler | `50 §3a`, mandate `§39` | `tools/control-artifacts/` |

---

## 4. The deployed artifact package

`artifacts/control/` carries the bytes a deployment ships. **The manifest is NOT in this
repository**, because it carries owner signatures and this repository holds no owner key.

| Class | File | Source of the bytes |
|---|---|---|
| 2 | `class-02.policy-set.json` | assembled from `src/kernel/policy/artifacts/` by `tools/control-artifacts/assemblePolicySet.ts` |
| 3 | `class-03.action-catalogue.json` | hand-authored from `26 §5`, `26 §11.2`, `51 §2.3`, `51 §5.1` |
| 19 | `class-19.effect-constructors.json` | the registered `ConstructorVersionRecord` identities |
| 20 | `class-20.acos-jcs-1.spec.v1.txt` | a BYTE-IDENTICAL copy of `docs/architecture/v1.3.6/artifacts/acos-jcs-1.spec.v1.txt` |
| 24 | *(deployment-assembled)* | the audit plane's published public key, which a repository cannot carry |
| 27 | `class-27.degraded-mode-config.json` | hand-authored from `50 §2c`'s four quantities |

`.gitattributes` marks `artifacts/control/**` as `-text`, so git performs NO line-ending
conversion in either direction. `50 §3c` makes a line terminator an identity change, and a
clone on a machine with `core.autocrlf=true` would otherwise invalidate every owner
signature by rewriting files nobody edited.

---

## 5. The implementation-level choices, named as such

**These cannot move authority, and each is recorded here rather than left to be inferred.**

| Choice | Why it is not an authority decision |
|---|---|
| The artifact container is UTF-8 JSON, one file per class | `50 §6` calls classes 2, 3 and 27 "the assembled artifact bytes" and declares no format. `§3c` hashes EXACT BYTES, so whatever a release assembles is what both signatures bind. A different encoding is a different artifact, a different hash and a different `manifest_id`, which the deployment pin rejects. |
| The manifest document is UTF-8 JSON | `50` declares no on-disk container for the manifest either. What is hashed and signed is never the document: it is `§3d`'s fixed framing over the parsed fields, so no property order or whitespace choice can move `manifest_id`. `JSON.parse` runs in `manifestCore.ts`; `JSON.stringify` runs nowhere in the trust chain. |
| `artifact_id` for classes 19 and 24 | `50 §6` prints ids for classes 2, 3, 20 and 27 and names 19 and 24 without printing one. `§3b` binds `artifact_id` inside the signature and `§3d` binds every entry inside the signed core, so whichever identifier a release ceremony signs is the only one the pin admits. |
| `artifact_version` strings for classes 2, 3, 19, 24, 27 | `50 §6` writes "the catalogue's declared version", "the configuration's declared version" and "the bundle's declared version" — a declaration the package makes, which the verifier then cross-checks against the artifact's OWN verified bytes. |
| The deployment transport is process environment | `50 §3a` says the roots are "provisioned OUT OF BAND through the trusted deployment mechanism" and declares no transport. The reader takes a flat string map, has no network, no filesystem, no database and no default key, and has exactly one production call site per plane. |
| The CRITICAL incident is emitted to a sink, defaulting to structured stderr | `50 §3f` requires the incident to be raised and journalled "where the current architecture permits a trusted journal to remain operational". At bootstrap it does not, and `§3f` accepts local startup evidence. No control-plane incident table exists at S1; a deployment installs a sink that journals `RELOAD` incidents. |

---

## 6. What this slice does NOT do

* **No production signing.** No key is generated, held, read or written under `src/`.
  `tools/control-artifacts/` knows the FORMAT and holds no key; it is release and test
  tooling and is not the key ceremony.
* **No real transport.** No `fetch`, no HTTP, no socket, no vendor SDK, no credential.
* **No provider work.** No adapter, no sandbox, no idempotency header, no provider query,
  no reconciliation, no `I8`, no `I20` provider-side proof, no `I36`.
* **No `I17b`.** `37 §2` is explicit that external anchoring stays at S3 and is NOT the
  bootstrap root; `50 §3e`'s pin is what rejects a rollback. Nothing here depends on it.
* **No class-19 key migration.** `50 §3i` declares it follow-on work. Class 19's artifact
  is a verified manifest member; `ConstructorVersionResolver`'s caller-supplied-key
  arrangement is untouched, and nothing here claims its trust root has moved.
* **No symcc, no policy equivalence, no rotation mechanism.** `50 §2e` puts all three
  outside this rule.
* **No conformance claim for class 20.** `50 §2b`: a valid signature pair "DOES NOT PROVE
  THAT ANY IMPLEMENTATION CONFORMS TO IT". VC-A3 is untouched and remains the mechanism.

---

## 7. The architecture is unchanged

`docs/architecture/v1.3.6/` is byte-identical to `653e632`. The gate runs 89 PASS / 0 FAIL
and all 58 seeds discriminate, before and after.

**No new normative contradiction was found.** Every load-bearing detail this slice needed —
the algorithm, the envelope, the roots, the pin, the core, the occasions, the closed
schemas, the class-20 artifact, the class-17 disposition and the second factor — is declared
in v1.3.6, and the four places where the architecture deliberately leaves a choice open are
listed in `§5` above with the argument for why each is inert.
