# S1K — Test Matrix

**Baseline `653e632`. Package issue `v1.3.6`, unmodified.**

**155 focused tests across seven files under `tests/controlArtifacts/`, plus the four
vulnerable-control modules under `tests/negative-controls/` and the migrated cases in the
accepted suites.**

---

## 0. What this document supersedes

The previous edition listed the PARTIAL pass's findings, which produced no tests. This
edition is the matrix for the runtime slice.

---

## 1. `36 §2`'s three validation conditions

| Condition | Obligation | File |
|---|---|---|
| **VC-K1** | trust root and signature envelope, against an independently written oracle | `framing-and-oracle.test.ts`, `roots-and-manifest.test.ts` |
| **VC-K2** | exact-byte content hashing and manifest set integrity | `roots-and-manifest.test.ts` |
| **VC-K3** | `I19`'s three occasions, and the absence of a timer | `i19-occasions.test.ts` |

---

## 2. VC-K1 — the framing and the roots

| Case | Assertion |
|---|---|
| `CAS_FIELD` hand-computed vector | `"abc"` frames to `00 00 00 03 61 62 63`, computed by hand and not by either encoder |
| production vs oracle, every field kind | byte-for-byte equal over text, integer, digest and signature fields |
| integers | decimal ASCII; `0`, `7`, `4294967294`, `-3`; no leading zeros, no leading plus |
| text | NFC, so `café` and `café` frame identically |
| `U+0000` | excluded from text; fails closed |
| `M_artifact`, both roles | byte-identical to the oracle |
| domain separator | opens with `ACOS-CONTROL-ARTIFACT-SIGNATURE-V1` as literal ASCII |
| **signer role bound** | a `PRIMARY` signature does not verify in the `SECOND_FACTOR` slot |
| **class bound** | a class-3 signature does not verify presented as class 20 |
| **id bound** | artifact A's signature does not verify for artifact B |
| **version bound** | an old version's signature does not validate a new version |
| **content hash bound** | different bytes under one identity do not verify |
| boundary lengths | accepted at 256 / 64 bytes; refused one byte over; never truncated |
| malformed lengths | a 31-byte digest and a 63-byte signature both fail closed |
| `CORE` and `M_manifest` | byte-identical to the oracle; separate manifest domain |
| domain separation | an artifact signature never verifies as a manifest signature |
| **no upward edge** | `casSig.ts` has no `import` statement; no trust-chain module reserialises JSON or imports the canonicaliser |

| Root-trust case | Production | Vulnerable control |
|---|---|---|
| valid package | verifies | — |
| one key in both deployment slots | `TRUST_ROOTS_NOT_DISTINCT`, before any manifest byte | **4** accepts |
| manifest names different key ids | `MANIFEST_KEY_ID_MISMATCH`; or the pin, one step earlier | — |
| attacker package, attacker keys, self-consistent | `MANIFEST_IDENTITY_NOT_PINNED` | **2** accepts (manifest-supplied root) |
| attacker package, no prior trust | `MANIFEST_IDENTITY_NOT_PINNED` | **1** accepts (trust-on-first-use) |

---

## 3. `50 §4` — the second factor

| Case | Result |
|---|---|
| manifest missing a valid `SECOND_FACTOR` signature | `MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID` |
| manifest missing a valid `PRIMARY` signature | `MANIFEST_PRIMARY_SIGNATURE_INVALID` |
| manifest signed twice under the primary key | `MANIFEST_SECOND_FACTOR_SIGNATURE_INVALID` |
| artifact signed twice under the primary key | `ARTIFACT_SECOND_FACTOR_SIGNATURE_INVALID` |
| `PRIMARY` signature transplanted into the second-factor slot | `ARTIFACT_SECOND_FACTOR_SIGNATURE_INVALID` |
| ONE artifact with a bad second factor | the WHOLE bundle refuses |
| ONE artifact with a bad primary signature | the WHOLE bundle refuses |
| **vulnerable control 3** — second factor optional | ACCEPTS what production refuses |

---

## 4. VC-K2 — content hashing and the set

| Byte attack on the class-3 artifact | Result |
|---|---|
| LF → CRLF | digest moves; `ARTIFACT_CONTENT_HASH_MISMATCH` against the signed manifest |
| one added space | same |
| the final newline removed | same |
| a final newline added | same |
| a byte-order mark prepended | same |
| one UTF-8 byte flipped | same |
| **vulnerable control 7** | a semantically-normalised digest CANNOT distinguish a re-indented artifact from the original; the exact-byte digest can |

| Set mutation | Result |
|---|---|
| deleted entry | `MANIFEST_IDENTITY_NOT_PINNED` |
| inserted entry | `MANIFEST_IDENTITY_NOT_PINNED` |
| reordered entries | `MANIFEST_ENTRY_ORDER_INVALID`, and the identity moves too |
| complete valid OLDER manifest | `MANIFEST_IDENTITY_NOT_PINNED` — **on the pin, with no epoch compared** |
| duplicated entry identity | `MANIFEST_DUPLICATE_ENTRY` — a defect, not a tie |
| retired class 17 present | `RETIRED_CLASS_PRESENT` |
| `entry_count` disagrees with the entries | `MANIFEST_ENTRY_COUNT_MISMATCH` |
| unknown field in the manifest document | `MANIFEST_UNKNOWN_FIELD` — refused, not ignored |
| **vulnerable control 8** — no deployment pin | accepts any validly signed manifest |
| **vulnerable control 9** — highest epoch on disk | accepts a rollback the pin rejects |
| **vulnerable control 10** — missing entry ignored | accepts a set with class 27 absent |

---

## 5. VC-K3 — `I19`'s occasions

| Occasion 1 failure | Kernel READY? |
|---|---|
| wrong manifest pin | NO |
| bad primary manifest signature | NO |
| bad second-factor manifest signature | NO |
| missing required artifact | NO |
| stale artifact signatures | NO |
| bad second factor on one artifact | NO |
| one key in both root slots | NO |
| bad content hash on disk | NO |
| **a valid package** | **YES** — the gate is not simply closed |

| Occasion 2 | Result |
|---|---|
| successful reload | publishes a COMPLETE new bundle |
| failed candidate | active bundle unchanged, still complete, still READY |
| **concurrency** | twenty interleaved reads during verification all see the OLD bundle; after publication, the NEW one. No mixed set. |
| **vulnerable control 14** | a per-class publisher leaves class 3 from release B live beside class 27 from release A |
| re-signed catalogue with a different adapter | takes effect only after an explicit reload |

| Occasion 3 | Result |
|---|---|
| the active bundle | is one this module sealed |
| an object cast to the capability type | refused — `NO_ACTIVE_VERIFIED_BUNDLE` |
| `JSON.stringify(bundle)` | throws; the object has no own enumerable property |
| the bundle and its contents | frozen |

| Backing store | Result |
|---|---|
| mutate the class-3 file after verification | authority is UNMOVED (`1n`, not `0n`) |
| **vulnerable control 13** | a re-reading consumer DOES move (`0n`) |
| explicit reload after the mutation | refuses; the pre-tamper bundle stays active |
| no timer | no `setInterval`, `setTimeout`, `setImmediate`, `fs.watch`, `watchFile` or cron anywhere in either plane's trust chain |
| a thousand authority reads | answer from memory; no filesystem access |

---

## 6. Class 3 and class 27 — the authority source

| Case | Production | Unsigned literal |
|---|---|---|
| `fulfilment.reship` irrecoverable units | `1n` (signed) | `0n` — **control 11** |
| `fulfilment.reship` outbox scope | `true` (adapter `mock_commerce`) | `false` (`internal_only`) — **control 11** |
| `fulfilment.reship` recoverability | `IRRECOVERABLE` | `REVERSIBLE` — **control 11** |
| `$100.00` above the degraded floor | `true` ($20.00 floor) | `false` ($500.00 floor) — **control 12** |
| forty minutes of unreachability | FULL-HALT posture | not the posture (8h) — **control 12** |
| re-signed catalogue saying `7` units | reads `7`; the active bundle is unmoved | — |
| re-signed configuration with a `$500.00` floor | reads `$500.00`; the active bundle is unmoved | — |
| mutate the signed class-27 bytes without new signatures | refused | — |
| signed catalogue breaking `51 §2.3`'s coherence rule | refused AT VERIFICATION | — |
| signed configuration whose halt threshold is not the longer | refused AT VERIFICATION | — |
| `actionCatalogue.ts` / `degradedModeThresholds.ts` source | carry NO authority literal | — |

Boundary semantics, each transcribed as `50 §2c` declares it: the floor is STRICT
(`$20.00` is not above it, `$20.01` is); the two timing thresholds are INCLUSIVE
(`899_999` is within, `900_000` is critical; `1_799_999` is not the posture, `1_800_000`
is).

---

## 7. Class 17 — retired, and still retired

| Case | Result |
|---|---|
| a class-17 file in `artifacts/control/` | none exists |
| a class-17 manifest entry | the verified set is exactly `[2, 3, 19, 20, 24, 27]` |
| a manifest reviving class 17 | `RETIRED_CLASS_PRESENT` |
| `window_registry` | remains a migration-created runtime table |
| the trust chain | issues no SQL and holds no pool — `50 §3h` |
| `irrecoverable_units` | class-3 content, `1n` for `fulfilment.reship` |

---

## 8. Class 20 and Cedar / O4

| Case | Result |
|---|---|
| the deployed class-20 file | byte-identical to the architecture's own; 13479 bytes; `7af60fc5…a18f33` |
| `0x0D` in the class-20 artifact | none |
| a CRLF copy | refused, naming the `0x0D` byte |
| the admitted specification identity | `ACOS-JCS-1` at the accepted digest |
| the admission gate | contains no `eval`, `new Function`, `readFileSync` or `require` |
| **vulnerable control 16** | an implementation digest is not, and cannot be, the specification identity |
| valid policy bytes plus two valid signatures | load, and a $10.00 refund is permitted |
| `policy_version` | still `47c2849b…c30ff6` |
| `policy_version` vs the class-2 content hash | different values, both carried |
| one byte appended to the bundle | `ARTIFACT_CONTENT_HASH_MISMATCH` |
| the `$25.00` cap widened inside the bundle | refused before Cedar |
| bytes changed with the signed manifest kept | refused at step 7 |
| class 2 with no second-factor signature | refused |
| an old valid policy artifact under a non-active manifest | refused on the pin |
| **vulnerable control 15** | a digest-only loader accepts an attacker bundle supplying its own digest |
| second production Cedar path | none — exactly one `cedar.isAuthorized(` call site and one `loadPolicyArtifacts` consumer |
| VC-A3 | untouched; the JCS-1 oracle still imports no production canonicaliser |

---

## 9. The audit plane

| Case | Result |
|---|---|
| a valid package | verifies on BOTH planes, independently, to one `manifest_id` |
| `corroboration_signal_max_age` | `PT5M` on both, each from its own verified class-27 copy |
| handed the control plane's configuration | `AUDIT_TRUST_CONFIG_MISSING` — the variables are its own |
| a tampered AUDIT copy | caught by the audit plane; the control plane still verifies |
| a tampered CONTROL copy | caught by the control plane; the audit plane still verifies |
| an unpinned manifest | `AUDIT_MANIFEST_IDENTITY_NOT_PINNED` |
| a missing second-factor manifest signature | refused |
| one key in both of its root slots | refused |
| **vulnerable control 17** | an audit plane that believes a control-plane vouch accepts a package its own bytes contradict |
| its import list | exactly `node:crypto`, `node:fs`, `node:path` |
| references to a control-plane verdict | none |
| `src/audit/**` importing `kernel/controlArtifacts` | none |

---

## 10. Boundaries

| Case | Result |
|---|---|
| private key material under `src/` | none — no `generateKeyPair`, `createPrivateKey`, `PRIVATE KEY`, `pkcs8` |
| signing in the trust chain | none — it only verifies |
| private key material in the deployed artifacts | none |
| `src/` importing `tools/` | none |
| `src/` importing `tests/` | none |
| `tools/` importing `src/` | none |
| test keys | labelled TEST-ONLY; unreachable from production |
| `DispatchEnvironment.controlArtifacts` | REQUIRED, not optional, not nullable |
| the outbox claim | asserts an active verified bundle |
| **vulnerable control 18** | an optional-bundle dispatcher proceeds without one; production cannot express the shape |
| real transport in the gateway | none |
| network or credential surface anywhere in `src/` | none |
| the worker-facing message | ONE fixed sentence, naming no signature, key, hash, manifest, class or Cedar |
| `String(error)` on a failure | leaks nothing; the detail is a separate property |
| `verifyControlArtifactBundle` call sites | exactly one, in `registry.ts` |
| `sealVerifiedBundle` call sites | exactly one, in `verifier.ts` |
| `readDeploymentTrustConfiguration` call sites | exactly one, in `registry.ts` |
| `filesystemArtifactPackage` call sites | exactly one, in `registry.ts` |
| a caller-supplied verification key parameter | none in the trust chain |

---

## 11. The eighteen vulnerable controls

| # | Control | Module | Discriminates |
|---|---|---|---|
| 1 | trust-on-first-use root | `unsafe-control-artifact-verifier.ts` | YES |
| 2 | manifest-supplied owner root | same | YES |
| 3 | single-signature acceptance | same | YES |
| 4 | same key satisfies both roles | same | YES |
| 5 | envelope omits class | same (framing branch) | YES |
| 6 | envelope omits signer role | same (framing branch) | YES |
| 7 | semantic-normalised hashing | same + `unsafeSemanticDigest` | YES |
| 8 | any signed manifest, no pin | same | YES |
| 9 | highest epoch wins | same | YES |
| 10 | missing entry ignored | same | YES |
| 11 | class-3 unsigned literal authoritative | `unsafe-unsigned-authority-literals.ts` | YES |
| 12 | class-27 unsigned literal authoritative | same | YES |
| 13 | backing-file mutation affects authority | `unsafe-bundle-lifecycle.ts` | YES |
| 14 | partial publication on failed reload | same | YES |
| 15 | Cedar digest-only authentication | `unsafe-cedar-and-class20.ts` | YES |
| 16 | class-20 implementation treated as the artifact | same | YES |
| 17 | control plane vouches for audit plane | `unsafe-bundle-lifecycle.ts` | YES |
| 18 | real-effect path works without a verified bundle | same | YES |

Controls 5 and 6 are exercised by the envelope's substitution attacks: an envelope that
omits `artifact_class` accepts a class-3 signature presented for class 20, and one that
omits `signer_role` accepts a `PRIMARY` signature in the `SECOND_FACTOR` slot. Production
refuses both, because `50 §3b` puts both fields inside the signed message.

---

## 12. Migrated accepted cases

| Suite | Change |
|---|---|
| `tests/policy/policy-artifacts.test.ts` | staged DIRECTORIES became staged, RE-SIGNED class-2 bundles; four cases moved layer from policy defect to control-artifact integrity failure, which is the stronger outcome |
| `tests/policy/fail-closed.test.ts` | same, for its three staged policy sets |
| `tests/canonicalisation/catalogue-entry-provenance.test.ts` | asserts the canonicaliser reads `actionCatalogueEntry(intent.actionClass)` and no longer names a literal |
| `tests/integration/exposure/mie-reservation.test.ts`, `outbox-scope`, `window-ref-provenance`, `retained-fee-escape`, `policy-set-gap-analysis` | read the catalogue through the verified bundle |
| `tests/mirror/*`, `tests/integration/mirror/*` | read the thresholds and the signal max age through the verified bundle |
| `tests/support/gatewayFixture.ts` | supplies the required capability |
| `tests/type-negative/catalogue-entry-into-context.ts` | unchanged in intent; sources its row from the verified accessor |
