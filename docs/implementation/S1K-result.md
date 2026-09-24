# S1K — Result

**VERDICT: PASS.**

**Baseline `653e632` (the OWNER-ACCEPTED v1.3.6 architecture checkpoint). Branch
`feature/s1k-control-artifact-integrity`. Package issue `v1.3.6`, unmodified. Architecture
gate 89/89; all 58 seeds discriminate.**

**NO REAL HTTP. NO REAL ADAPTER. NO VENDOR CREDENTIAL. NO PROVIDER SANDBOX. NO
RECONCILIATION. NO PRODUCTION PRIVATE SIGNING KEY.**

---

## 0. What this document supersedes, and what it does not

**The previous edition of this file recorded `PARTIAL`**, and it was right to. S1K's first
pass found that the owner control-artifact signing mechanism could not be implemented
against v1.3.5 — the signature had no declared algorithm and no declared signing message,
the trusted verification key had no declared provenance, `I19`'s "continuous" had no
declared occasion, three of the four named classes had no computable content boundary, one
had no artifact at all, and the second factor `50 §4` required had no mechanism. It wrote no
production code and invented nothing. Those ten findings are `S1K-C1`..`S1K-C10`.

**v1.3.6 closed all ten by DECLARATION.** This edition records the runtime slice built
against those declarations.

**What is NOT superseded.** The PARTIAL edition's central claim — that the pre-live gate
must stay shut until the mechanism exists — is discharged rather than withdrawn. The gate is
now built, and it is shut by default: a kernel with no verified bundle admits nothing.

---

## 1. Verdict

**PASS**, against the mandate's thirty-three pass criteria. Each is answered in `§21`.

The one criterion that would have forced PARTIAL — "Return PARTIAL if the exact class-20
binding, deployment trust-config boundary, Cedar artifact boundary, or another load-bearing
mechanism is still unspecified" — does not apply. Each of those four is declared in v1.3.6:

| Mechanism | Where v1.3.6 declares it |
|---|---|
| the class-20 runtime binding | `50 §3g`: "After class-20 artifact verification succeeds, the `ACOS-JCS-1` implementations **may be admitted** and used" — an admission gate, plus `50 §3f`'s "bound to the verified class-20 specification identity" |
| the deployment trust-config boundary | `50 §3e` pins three things and `50 §3a` declares the roots "provisioned OUT OF BAND through the trusted deployment mechanism", outside the signed set |
| the Cedar artifact boundary | `50 §2e`: "the Cedar schema file and every `.cedar` policy source file, in one immutable byte object", hashed by `§3c` |
| the second factor | `50 §4` and `§3b`: a second independent Ed25519 approval signature under a distinct key, with the role bound inside the signed message |

**No new normative contradiction was found**, and no architecture file was edited.

---

## 2. Baseline

| | |
|---|---|
| required | `653e632` |
| actual | `653e632` |
| branch | `feature/s1k-control-artifact-integrity` |
| worktree at start | clean |
| architecture package | `docs/architecture/v1.3.6/`, byte-identical (`git diff 653e632 -- docs/architecture/` is empty) |

---

## 3. The trust chain, and the invariant it enforces

> **NO AUTHORITY-BEARING CONSUMER MAY USE AN UNVERIFIED CONTROL ARTIFACT.**

`50 §3f` states the same property as the reason `I19` is continuous without a timer: *"The
invariant is 'continuous' because NO AUTHORITY CONSUMER CAN OBTAIN OR USE AN UNVERIFIED
CONTROL-ARTIFACT BUNDLE, which is a structural property rather than a schedule."*

`S1K-contract.md §2` prints the chain. The load-bearing property is that **no edge points
upward**: `casSig.ts` has no `import` statement at all, `ed25519.ts` imports only
`node:crypto`, and nothing on the bootstrap path reaches `canonicalBytes.ts`. That is
asserted over the import graph, not claimed in prose.

---

## 4. Root trust

| | |
|---|---|
| primary public key source | deployment configuration, `ACOS_OWNER_ARTIFACT_ROOT_KEY`, 32 raw hex-encoded bytes |
| second-factor source | deployment configuration, `ACOS_OWNER_ARTIFACT_SECOND_FACTOR_KEY` |
| manifest pin source | deployment configuration, `ACOS_EXPECTED_ACTIVE_MANIFEST_ID` |
| distinctness | checked over the RAW 32 public-key bytes, and again over the derived key ids |
| TOFU possible? | **NO.** There is no keystore, no cache, no "last good" file, no learned state and no per-request key parameter. The manifest's declared key ids are checked AGAINST the provisioned keys and never used to select one. |
| production private keys present? | **NO.** No `generateKeyPair`, no `createPrivateKey`, no `pkcs8`, no PEM anywhere under `src/`. The trust chain never calls `sign`. |
| rotation | not implemented, as `50 §3a` requires: it is an owner/deployment ceremony, the runtime restarts, and no manifest can keep its own root accepted |

---

## 5. Signature framing

| | |
|---|---|
| artifact domain | `ACOS-CONTROL-ARTIFACT-SIGNATURE-V1` |
| manifest domain | `ACOS-CONTROL-MANIFEST-SIGNATURE-V1` (separate) |
| core leading field | `ACOS-CONTROL-MANIFEST-CORE-V1` |
| exact framing | `CAS_FIELD(b) = uint32_be(len(b)) || b`; raw payloads; NO NULL representable; no separators; UTF-8 NFC text with `U+0000` excluded; decimal-ASCII integers; 32-byte digests; 64-byte signatures; maxima 256 / 64 / `0xFFFFFFFE`, failing closed and never truncating |
| signer-role binding | an explicit field INSIDE the message, `PRIMARY` or `SECOND_FACTOR`; no per-role domain separator, as `50 §3b` requires |
| oracle | `tools/control-artifacts/framing.ts` — written from the specification, imports nothing from `src/`, and is the signer every fixture is produced by |
| substitution attacks | class, id, version, content hash and signer role each fail; boundary lengths accepted at the maximum and refused one byte over |

---

## 6. Manifest verification

| | |
|---|---|
| identity / pin | `manifest_id = SHA-256(CORE)`; checked against `EXPECTED_ACTIVE_MANIFEST_ID` BEFORE any signature |
| entry completeness | `50 §6`'s closed set — classes 2, 3, 19, 20, 24, 27 — every member required, no member optional |
| entry ordering | ascending `(class, id, version)`, ids and versions compared BYTE-WISE over UTF-8 NFC, refused rather than sorted; equal keys are a defect, not a tie |
| primary signature | verified under the provisioned `OWNER_ARTIFACT_ROOT_KEY` |
| second factor | verified under the provisioned `OWNER_ARTIFACT_SECOND_FACTOR_KEY`; one valid signature is REFUSED |
| rollback | a complete, validly dual-signed older manifest is rejected ON THE PIN; **no epoch is compared anywhere in `src/`** |
| deletion / insertion | both move `manifest_id`; both rejected |
| stale signature | the envelope binds `content_sha256`, so a signature over the old digest does not verify over new bytes |
| unknown fields | REFUSED, not ignored — `50 §3d`'s "carries exactly" is a closed enumeration |
| `entry_count` | inside the signed bytes AND diffed against the parsed entries |

---

## 7. The verified bundle

| | |
|---|---|
| creation | only `verifyControlArtifactBundle`, after all eight of `50 §3f`'s steps pass for every required artifact |
| immutability | deep-frozen contents; the capability itself frozen; typed arrays immutable by confinement, since a typed array cannot be `Object.freeze`d |
| publication | ONE assignment in `registry.ts`. JavaScript has no interleaving point inside it, so a reader sees the complete old bundle or the complete new one |
| raw loader confinement | `verifyControlArtifactBundle`, `sealVerifiedBundle`, `readDeploymentTrustConfiguration` and `filesystemArtifactPackage` each have EXACTLY ONE production call site, asserted against a hand-authored list |
| forgery | an object cast to the capability type carries no entry in the private `WeakMap`; every accessor refuses it |
| serialisation | `toJSON` throws and is NON-ENUMERABLE, so the object has no own enumerable property to copy out |
| failed reload | the active bundle is untouched by any statement on the failing path; it remains complete and the kernel remains READY |
| backing-file mutation | NO authority effect — the immutable bundle answers; an explicit reload then detects and refuses the tampering |

---

## 8. Class 3

| | |
|---|---|
| artifact | `artifacts/control/class-03.action-catalogue.json`, `acos.control.action_catalogue` |
| exact authority source | the VERIFIED artifact bytes, parsed into a frozen representation after verification |
| hard-coded authority remaining? | **NONE.** `ACTION_CATALOGUE` and `REASON_CODE_SCOPES` no longer exist; `actionCatalogue.ts` carries no `recoverability:`, `valueDirection:`, `adapter:`, `irrecoverableUnits:` or `settlementTolerance:` |
| what remains a constant | `ACTION_CLASSES` and `REASON_CODES` — MEMBER SETS and TypeScript types, which `§17` of the mandate permits and which decide nothing. The parser REFUSES an artifact whose membership disagrees rather than taking either side |
| consumer migration | `canonicaliser.ts`, `preReservation.ts`, `stepR.ts` (through `irrecoverableUnitsFor`), `enqueue.ts` (through `requiresExternalDispatchFor`), `adapterRegistry.ts`, `dispatchEnvelope.ts`, `refundCreate.ts`, `enumerationMaxAge.ts` |
| coherence rule | `51 §2.3`'s IRRECOVERABLE-is-1 rule moved from module load over a literal to VERIFICATION over the signed bytes; an incoherent signed catalogue fails the bootstrap ceremony |
| tamper result | a re-signed catalogue saying `7` units reads `7`; the unsigned literal saying `0` is never consulted; a mutated file with stale signatures is refused |

---

## 9. Class 17

| | |
|---|---|
| manifest entry | NONE. The verified set is exactly `[2, 3, 19, 20, 24, 27]`, and a manifest carrying class 17 is refused `RETIRED_CLASS_PRESENT` |
| artifact file | none exists, and none was created — `50 §2d`: "No empty or signature-only artifact is retained to preserve numbering" |
| runtime windows | `window_registry` remains a migration-created runtime table; a window created for a company tomorrow needs no ceremony |
| regression | the trust chain issues NO SQL and holds no pool, so `I19` has not begun to authenticate runtime rows — `50 §3h` |
| `irrecoverable_units` | class-3 content, `1n` for `fulfilment.reship`, exactly as `50 §2d`'s split table declares |

---

## 10. Class 20

| | |
|---|---|
| artifact | `artifacts/control/class-20.acos-jcs-1.spec.v1.txt` — a BYTE-IDENTICAL copy of the architecture's own file |
| verified digest | `7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33`, 13479 bytes, no `0x0D` byte |
| runtime binding | `50 §3g`'s ADMISSION GATE: `canonicalBytes.ts` — the TypeScript `ACOS-JCS-1` implementation `50 §6` names as the class-20 consumer — refuses until an active verified bundle carries class 20 at `artifact_version = ACOS-JCS-1` |
| does it interpret the text? | **NO.** No `eval`, no `new Function`, no file read, no `require` in the admission module |
| does it compare a hard-coded digest? | **NO.** The identity checked is the one the SIGNED MANIFEST bound; a digest constant in `src/` would be a second authority source, which `50 §3c` forbids. The accepted digest lives in test support as an acceptance fixture |
| control implementation | the control-plane PL/pgSQL chain, untouched |
| audit implementation | the audit-plane PL/pgSQL chain, untouched |
| VC-A3 | untouched and still green; the independent JCS-1 oracle still imports no production canonicaliser |
| signing proves conformance? | **NO** — `50 §2b`, asserted in the admission module's own text and by the vulnerable control that hashes an implementation instead |

---

## 11. Class 27

| | |
|---|---|
| artifact | `artifacts/control/class-27.degraded-mode-config.json`, `acos.control.degraded_mode_config` |
| the four quantities | `PT15M`, `PT30M`, `USD 20.00`, `PT5M` — transcribed from `50 §2c`, values unchanged |
| consumers | `dispatchPrecedence.ts` (approval floor, full-halt posture), `mirrorStateMachine.ts` (mirror lag), `mirrorState.ts` and `corroborationSignal.ts` (signal max age) |
| duplicate unsigned threshold authority remaining? | **NONE.** `DEGRADED_PER_ACTION_APPROVAL_FLOOR`, `DEGRADED_MODE_TIMING` and `SIGNAL_MAX_AGE_MS` no longer exist |
| boundary semantics | the floor STRICT, the two thresholds INCLUSIVE, each as declared and each asserted at the boundary and one unit either side |
| coherence | the halt threshold being the LONGER of the two is checked arithmetically over the VERIFIED values, at verification |
| tamper result | a re-signed configuration with a `$500.00` floor reads `$500.00`; the unsigned literal saying `$500.00` is never consulted; a mutated file with stale signatures is refused |

---

## 12. Cedar / O4

| | |
|---|---|
| artifact | `artifacts/control/class-02.policy-set.json` — the schema plus every `.cedar` source, in one immutable byte object |
| `policy_version` | `47c2849b41bd0bdf433e75d7cf75b45f3133d93183c8fd447606ce1017c30ff6`, unchanged, and asserted as an acceptance regression |
| class-2 `content_hash` | `SHA-256` over the bundle's exact bytes, carried by the manifest entry — a DIFFERENT value from `policy_version`, and both are required |
| dual signatures | required; a bundle with one is refused |
| verification before load | `policyArtifacts.ts` no longer imports `node:fs`, has no artifact root and no path overload, so "load then compare a digest" is not expressible |
| second production Cedar path | none — exactly one `cedar.isAuthorized(` call site and one `loadPolicyArtifacts` consumer |
| **O4's exact status** | its **OWNER-SIGNING / LOAD-INTEGRITY** leg is CLOSED for the pre-live gate: owner-authenticated Cedar bytes → verified bundle → verified pre-load gating → the sole production Cedar path. **Nothing else about O4 moves.** Cedar SEMANTIC correctness, the symcc gate, policy equivalence and policy rotation are untouched and remain open where they were (`50 §2e`: "It says nothing about Cedar semantic correctness. It is not the symcc proof gate, not a policy-equivalence check, and not a policy-rotation mechanism.") |

---

## 13. I19 — leg by leg

| Leg | Status | Evidence |
|---|---|---|
| root trust bootstrap | **CLOSED** | two externally provisioned Ed25519 roots, distinctness over raw bytes, TOFU unreachable rather than unused; vulnerable controls 1, 2 and 4 discriminate |
| manifest integrity | **CLOSED** | dual-signed core, `manifest_id = SHA-256(CORE)`, the deployment pin checked first, order and count normative; the four set mutations rejected; controls 8, 9, 10 discriminate |
| artifact signatures | **CLOSED** | both signatures on every required artifact, under distinct roots, with the role inside the message; controls 3, 5, 6 discriminate |
| exact-byte integrity | **CLOSED** | `SHA-256` over exact bytes, six byte attacks each move the digest; control 7 discriminates |
| bootstrap | **CLOSED** | eight failure modes each leave the kernel not READY, with no degraded subset and no effect admitted; a valid package DOES become READY |
| reload | **CLOSED** | full ceremony before publication, atomic single-assignment publication, failed candidate never replaces the active bundle; real concurrent interleaving shows no mixed set; control 14 discriminates |
| verified-use confinement | **CLOSED** | the opaque capability is the only surface; raw loaders have one call site each; the bundle cannot be forged or serialised |
| audit independence | **CLOSED for the pre-live set** | the audit plane verifies its own copies from its own configuration with its own framing and digests; a tampered one-plane copy is caught by that plane alone; control 17 discriminates |
| incident behaviour | **CLOSED as declared** | the CRITICAL incident carries its occasion; `BOOTSTRAP` is local evidence only and journalling is explicitly not permitted there; `RELOAD` is journallable. No journal chain is fabricated under an unverified specification |
| **no polling cadence** | **CONFIRMED ABSENT** | no `setInterval`, `setTimeout`, `setImmediate`, `fs.watch`, `watchFile` or cron anywhere in either plane's trust chain |

**Not claimed, and deliberately:** external anchoring / `I17b` (an S3 deliverable, and
`37 §2` is explicit it is NOT the bootstrap root), the historical non-repudiation leg, the
remaining signed classes whose consumers arrive at S4, and class 19's key migration
(`50 §3i`, declared follow-on).

---

## 14. Second factor

| | |
|---|---|
| distinct key | required over the RAW 32 public-key bytes AND the derived key ids; a deployment configuring one key twice never becomes READY |
| single signature | REFUSED, on the manifest and on every artifact, and never reported as verified |
| role swap | a `PRIMARY` signature in the `SECOND_FACTOR` slot does not verify, because the role is inside the signed bytes |
| same-key attack | an artifact or manifest signed twice under the primary key is refused even when the deployment configuration is correct |
| one artifact, bad second factor | refuses the WHOLE bundle |
| manifest bad second factor, artifacts valid | refuses the WHOLE bundle |

---

## 15. Audit plane

| | |
|---|---|
| trust roots | ITS OWN deployment variables (`ACOS_AUDIT_*`); handed the control plane's configuration it finds nothing |
| own bytes | its own package directory, its own copies |
| own hash | its own `SHA-256`, over its own re-derived framing |
| control-plane vouching possible? | **NO.** It imports exactly `node:crypto`, `node:fs`, `node:path`; it references no bundle, no capability, no verified flag, and has no parameter through which one could arrive. `50 §6`'s inventory is transcribed a second time rather than shared |
| result | both planes verify the same package to the same `manifest_id`, independently; a tampered copy on either plane is caught by that plane and not covered for by the other |
| the one declared duplication | `corroboration_signal_max_age` — `PT5M` on both, each from its own verified class-27 copy, which is what makes equality a cross-plane FACT rather than a value passed between them |

---

## 16. Tamper matrix

| Attack | Vulnerable | Production | Discriminates? |
|---|---|---|---|
| attacker package, attacker keys, self-consistent | accepts (TOFU) | `MANIFEST_IDENTITY_NOT_PINNED` | YES |
| manifest names its own verification keys | accepts | pin, then `MANIFEST_KEY_ID_MISMATCH` | YES |
| second factor absent | accepts | REFUSED | YES |
| one key in both root slots | accepts | `TRUST_ROOTS_NOT_DISTINCT` | YES |
| envelope omits `artifact_class` | accepts a class-3 signature for class 20 | REFUSED | YES |
| envelope omits `signer_role` | accepts a role transplant | REFUSED | YES |
| artifact re-indented (same semantics) | same digest under a normalised hash | `ARTIFACT_CONTENT_HASH_MISMATCH` | YES |
| any validly signed manifest, no pin | accepts | `MANIFEST_IDENTITY_NOT_PINNED` | YES |
| rollback by highest epoch on disk | accepts the older set | pin rejects; no epoch compared | YES |
| required entry missing | ignored | `REQUIRED_ARTIFACT_MISSING` | YES |
| class-3 unsigned literal | `0n` units, `internal_only`, REVERSIBLE | `1n`, `mock_commerce`, IRRECOVERABLE | YES |
| class-27 unsigned literal | `$500.00` floor, 8h halt | `$20.00`, 30m | YES |
| backing file mutated after verify | re-reads and moves | immutable bundle answers | YES |
| failed reload | partial publication leaves a mixed set | nothing published | YES |
| Cedar digest supplied alongside the bytes | loads an attacker policy set | no such surface exists | YES |
| class 20 as an implementation digest | a digest that moves on refactor | the specification identity, bound by the manifest | YES |
| control plane vouches for the audit plane | accepts a package its own bytes contradict | the audit plane hashes its own | YES |
| dispatch with an optional bundle | proceeds | the field is required and the capability unforgeable | YES |
| LF→CRLF, added space, newline added/removed, BOM, one byte flipped | — | each moves the digest and fails the stale signature | YES |
| deleted / inserted / reordered entry | — | each rejected | YES |
| duplicated entry identity | — | `MANIFEST_DUPLICATE_ENTRY` | YES |
| retired class 17 revived | — | `RETIRED_CLASS_PRESENT` | YES |
| unknown manifest field | — | `MANIFEST_UNKNOWN_FIELD` | YES |

---

## 17. Pre-live gate

| | |
|---|---|
| real external effect possible without a verified bundle? | **NO.** `DispatchEnvironment.controlArtifacts` is a REQUIRED `VerifiedControlArtifactBundle`, not optional and not nullable, and the capability cannot be manufactured. The outbox claim additionally asserts an active bundle before the irreversible step |
| mock path | unchanged: the mock adapter, the fresh-claim capability, the invocation attestation and the outcome transaction all behave exactly as S1J accepted them |
| real HTTP present? | **NO** — no `node:http`, `node:https`, `node:net`, `node:tls`, `fetch`, `axios` or `undici` anywhere under `src/` |
| real credentials present? | **NO** |

---

## 18. Ongoing residuals

| # | Residual | Status |
|---|---|---|
| **12** | 22 older C/E conditions lack discriminating seeds | **CARRIED FORWARD, UNCHANGED.** 58 of the 89 conditions have seeds and all 58 discriminate. **It is NOT true that all 89 conditions are mutation-covered**, and S1K did not spend scope closing the gap. No condition this slice touched is among the 22 |
| **13** | non-idempotent test-database teardown | **REPAIRED**, in an isolated commit (`47ae8e0`), by `DROP SCHEMA IF EXISTS`. No production authority semantics change; `up()`, the migration list and the applied-migrations bookkeeping are untouched |
| — | `I17b` external anchoring | **OPEN, S3.** Not a dependency of S1K and must not become one |
| — | real-provider `I36` | **OPEN.** No sandbox, no adapter |
| — | `I20` provider-side comparison | **OPEN.** The ACOS-side denominator is unchanged |
| — | `I8` sweep | **OPEN, S4** |
| — | provider idempotency headers and the provider query primitive | **OPEN** |
| — | reconciliation | **OPEN, S4** |
| — | class 19's migration onto the same roots | **OPEN**, `50 §3i`, declared follow-on. The class-19 artifact is a verified manifest member; `ConstructorVersionResolver` still takes its key as an argument, and nothing here claims otherwise |
| — | owner key provisioning and the release ceremony | **OUTSIDE THE REPOSITORY.** No key exists here, and `tools/control-artifacts/` knows the format rather than holding a key. Production needs three things this repository cannot supply: the two root public keys, the expected manifest identity, and a signed artifact package |
| — | the remaining signed classes (1, 4–16, 18, 21–23, 25, 26) | **OPEN, S4.** `50 §6`: they enter the manifest when their consumers do |
| — | the control-plane incident table | **OPEN.** `50 §3f`'s CRITICAL incident is emitted to a sink, defaulting to structured stderr; a deployment installs one that journals `RELOAD` incidents. No control-plane incident table exists at S1 and none was invented |

---

## 19. Verification

**Run on the final tree, `67d5502`, with no other verify process running.**

| | |
|---|---|
| architecture gate | **89 PASS / 0 FAIL** |
| architecture seeds | **58 run, 58 exit non-zero, 0 fail to discriminate** |
| `docs/architecture/` diff against `653e632` | **empty** |
| `npm run verify` | **exit 0** |
| typecheck | **green** (`tsc --noEmit`) |
| lint | **green** (`eslint . --max-warnings 0`) |
| test files | **156** (accepted baseline 147; +9 new) |
| tests | **2222** (accepted baseline 2057; +165) |
| passed | **2222** |
| failed | **0** |
| skipped | **0** |
| duration | 8320s |

**Focused S1K tests — 166 across nine files:**

| File | Tests |
|---|---|
| `tests/controlArtifacts/roots-and-manifest.test.ts` | 32 |
| `tests/controlArtifacts/boundaries.test.ts` | 25 |
| `tests/controlArtifacts/i19-occasions.test.ts` | 24 |
| `tests/controlArtifacts/class-authority.test.ts` | 22 |
| `tests/controlArtifacts/framing-and-oracle.test.ts` | 21 |
| `tests/controlArtifacts/cedar-o4.test.ts` | 17 |
| `tests/controlArtifacts/audit-plane.test.ts` | 14 |
| `tests/controlArtifacts/signature-is-not-conformance.test.ts` | 8 |
| `tests/policy/policy-set-bundle-assembly.test.ts` | 3 |

**By kind:**

| Kind | Count |
|---|---|
| cryptographic vector and framing-oracle tests | 21 |
| tamper and adversarial tests (manifest, bytes, signatures, Cedar, class 20) | 79 |
| reload, publication and concurrency tests | 24 |
| control-plane / audit-plane independence tests | 14 |
| source-boundary and confinement tests | 25 |
| **vulnerable controls, all discriminating** | **18** |

**Accepted suites whose assertions were updated rather than relaxed:** four boundary
allow-lists (`mie-units-type-boundary`, `mirror-lag-critical`,
`no-real-transport-boundary`, `no-transport-boundary`), each of which exists so that a new
dependency FAILS rather than slips past a pattern. Each gained exactly one entry, named for
the declaration that requires it, and two of the four were STRENGTHENED in the same edit —
the gateway now asserts the verifier, the trust configuration, the artifact package and the
registry are each ABSENT from it, and `classifyMirrorLag`'s one-required-operand arity was
preserved by making the bundle a default parameter rather than an optional one.

**Residual 13's repair was validated before the final run**: `tests/negative-controls`
(14 files, 118 tests) passed end to end, which it could not do beforehand.

---

## 20. Scope

| | |
|---|---|
| production private signing key | **NO** |
| real adapter | **NO** |
| real HTTP | **NO** |
| provider sandbox | **NO** |
| reconciliation | **NO** |

---

## 21. The mandate's pass criteria, answered

| # | Criterion | Answer |
|---|---|---|
| 1 | starts from `653e632` | YES |
| 2 | uses unchanged v1.3.6 | YES — `git diff 653e632 -- docs/architecture/` is empty |
| 3 | externally rooted PRIMARY key enforced | YES |
| 4 | externally rooted SECOND_FACTOR key enforced | YES |
| 5 | keys are distinct | YES — over raw bytes and key ids |
| 6 | TOFU impossible | YES — no keystore, no cache, no per-request key |
| 7 | manifest active pin enforced | YES — before the signatures |
| 8 | manifest core dual signatures verified | YES |
| 9 | complete manifest set verified | YES — `50 §6`'s six classes, none optional |
| 10 | exact artifact bytes hashed | YES — no parse, no reserialise, no normalisation |
| 11 | each required artifact dual-signed | YES |
| 12 | cross-class/version/role substitution fails | YES |
| 13 | class 3 authority from the verified artifact | YES — the literal is gone |
| 14 | class 27 authority from the verified artifact | YES — the literals are gone |
| 15 | class 17 remains retired | YES |
| 16 | class 20 signs the specification, not an implementation | YES |
| 17 | class-20 runtime binding matches v1.3.6 | YES — `50 §3g`'s admission gate |
| 18 | VC-A3 remains separate and green | YES |
| 19 | Cedar policy authenticated before load | YES — the loader has no filesystem |
| 20 | no authority consumer can obtain raw/unverified artifacts | YES — one call site each, capability-only access |
| 21 | bootstrap fails closed | YES — eight failure modes, none reaches READY |
| 22 | verified bundle publication is atomic | YES — one assignment |
| 23 | failed reload cannot replace the current bundle | YES |
| 24 | backing-file mutation has no authority effect before reload | YES |
| 25 | explicit reload detects tampering | YES |
| 26 | worker/model cannot choose roots, manifest or artifacts | YES |
| 27 | audit-plane independence satisfies v1.3.6 | YES — own configuration, bytes, framing and digests |
| 28 | the pre-live external-effect path depends on verified authority | YES — required capability, plus a pre-claim assertion |
| 29 | no real HTTP or vendor work exists | YES |
| 30 | architecture gate remains 89/89 | YES |
| 31 | all 58 seeds still discriminate | YES |
| 32 | `npm run verify` green | YES — 156 files, 2222 tests, 0 failed, 0 skipped, exit 0 |
| 33 | no new architecture ambiguity is hidden | YES — the four open choices are named in `S1K-contract.md §5` with the argument for why each is inert |
