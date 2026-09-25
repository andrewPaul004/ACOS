# S1L — Contract

**Baseline `f37c032` (the accepted S1K runtime checkpoint). Branch
`feature/s1l-control-artifact-release`. Package issue `v1.3.6`, unmodified.**

**NO REAL HTTP. NO REAL ADAPTER. NO VENDOR CREDENTIAL. NO PROVIDER SANDBOX. NO
RECONCILIATION. NO PRODUCTION PRIVATE SIGNING KEY. NO NETWORK SIGNING SERVICE.**

---

## 1. The direction this slice proves

S1K proved one direction:

```
signed package + trusted deployment roots + trusted manifest pin
  -> verified control bundle -> kernel authority
```

S1L proves the other:

```
authoritative release inputs
  -> deterministic immutable artifact package
  -> PRIMARY owner approval
  -> SECOND_FACTOR independent approval
  -> deterministic dual-signed manifest
  -> immutable release bundle
  -> public deployment trust material
  -> control-plane bootstrap
  -> audit-plane bootstrap
  -> exactly the expected active manifest
  -> restart / redeploy / recovery
  -> STOP
```

**No vendor transport is added, and none is enabled.**

---

## 2. The security boundary, restated

The ACOS runtime remains a **VERIFIER**. `50 §3a`'s custody rule is unchanged and is
structurally enforced:

* nothing under `src/` imports anything under `tools/`;
* `tools/control-release/` imports nothing from `src/` — it is written from v1.3.6 as its
  specification, so the offline signer and the runtime verifier remain separate
  implementations;
* `tools/prelive/` DOES import both planes' verifiers, because a readiness checker's job is to
  run them. It signs nothing, and it does not import the release ceremony.

`tests/release/release-boundaries.test.ts` asserts each of these over the import graph.

---

## 3. What was built

| Component | Path | Role |
|---|---|---|
| closed inventory | `tools/control-release/inventory.ts` | an INDEPENDENT transcription of `50 §6` |
| candidate builder | `tools/control-release/candidate.ts` | deterministic, unsigned, reviewable |
| private-key input | `tools/control-release/signerKey.ts` | one explicit path; no search, no env, no vendor |
| the ceremony | `tools/control-release/ceremony.ts` | three one-key operations |
| offline verifier | `tools/control-release/verifyRelease.ts` | operator pre-flight; never authority |
| artifact decoders | `tools/control-release/decode.ts` | review display only |
| review report | `tools/control-release/review.ts` | deterministic, for a human |
| release diff | `tools/control-release/compare.ts` | reports; never approves |
| command line | `tools/control-release/cli.ts` | `build`/`review`/`approve-*`/`countersign`/`verify`/`compare` |
| readiness gate | `tools/prelive/preliveGate.ts` | local, read-only, two independent verifications |
| class-19 admission | `src/kernel/canonicalisation/constructorAdmission.ts` | membership rooted in the verified artifact |

---

## 4. `candidate_id` — why it exists, and what it is not

`50 §3e` defines `manifest_id = SHA-256(exact CORE bytes)`, and `50 §3d`'s CORE carries both
per-entry signatures. **`manifest_id` therefore cannot exist before both approvals exist**, so
"both custodians approve the same manifest identity before signing" is, read literally,
impossible.

S1L introduces a separate review identity under its own domain separator
`ACOS-CONTROL-RELEASE-CANDIDATE-V1`, computed over the header, the declared entry order and
every artifact's identity and digest.

> **`candidate_id` IS REVIEW TOOLING.** It is not a trust root, it is never
> `EXPECTED_ACTIVE_MANIFEST_ID`, it is not signed by itself, and no runtime reads it. The
> deployment pin remains `50 §3e`'s `manifest_id`.

---

## 5. Determinism

The candidate is a pure function of `(declared identities) × (exact artifact bytes) × (two
public keys)`. No clock, host name, process id, random value, temporary path or working
directory reaches an identity. Ed25519 is deterministic, so the whole release — including
`manifest_id` — reproduces from the same inputs and keys.

`release_channel` and an operator note live in `release-metadata.json`, outside both
identities, and the tests prove moving them changes neither.

---

## 6. Class 19 — the required pre-live audit

`50 §3i` states that `ConstructorVersionResolver` "takes the verifying public key as a
constructor argument" and that "**A CALLER-SUPPLIED VERIFICATION KEY IS NOT A TRUST ROOT**",
and declares the key migration **future work** without defining its mechanics. `37 §2` lists
it as a follow-on and **not a pre-live blocker**.

S1L does not invent the key migration. It implements `§13`'s **preferred safety property**:
constructor MEMBERSHIP is rooted in the verified class-19 artifact bytes carried by a
`VerifiedControlArtifactBundle`. The legacy key argument remains, renamed
`legacyRecordVerifyingKey`, and its scope is now strictly narrower than the artifact's — it
can cause a refusal and can no longer cause an admission of anything the owner did not sign.

All four of `§12`'s attacks are proved, each against the production path and against the
unwrapped S1B arrangement.

---

## 7. Cross-plane coherence — what architecture declares, and what is not invented

v1.3.6 declares two CROSS-PLANE OBLIGATIONS in terms of CONTENT — `50 §2b`'s byte-identical
class-20 copy and `50 §2c`'s `corroboration_signal_max_age` equality — and `50 §3` property 2
requires the audit plane to recompute "from its own copy" and compare "to the manifest it
holds".

The readiness gate checks both declared obligations from each plane's own verified bytes, and
reports `PLANES_ON_DIFFERENT_RELEASES` when the two independently obtained manifest identities
differ, because an audit plane holding an older manifest is not checking the control plane's
active release.

**No distributed deployment protocol is invented.** The gate is local, read-only orchestration
evidence about two verifications that already happened, and it never lets one plane's result
stand in for the other's.

---

## 8. The pre-live gate's single claim

`READY_FOR_PROVIDER_SANDBOX_CONFIGURATION`, and nothing broader. The two wider launch claims
`§40` forbids appear nowhere in the tooling; the test holds them and asserts their absence.

---

## 9. What S1L does not do

* it performs no vendor call and adds no transport;
* it commits no release and no key;
* it does not claim the real owner production ceremony was performed;
* it does not claim human custody separation from an automated test;
* it does not close `I36`, `I20`, `I8`, `I17b`, reconciliation, or the remaining signed
  classes;
* it does not modify `docs/architecture/v1.3.6/`.
