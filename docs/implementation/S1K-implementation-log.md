# S1K — Implementation Log

**Baseline `653e632`. Branch `feature/s1k-control-artifact-integrity`. Package issue
`v1.3.6`, unmodified.**

---

## 0. What this document supersedes

The previous edition logged the PARTIAL pass, which wrote no production code and returned
ten blocking normative omissions. This edition logs the runtime slice built against the
v1.3.6 declarations that closed them.

---

## 1. Order of work

| # | Step | Evidence |
|---|---|---|
| 1 | Confirmed `HEAD = 653e632`, branch, clean worktree | `git rev-parse HEAD`, `git status --porcelain` empty |
| 2 | Ran the v1.3.6 architecture gate | **89 PASS / 0 FAIL** |
| 3 | Ran all 58 architecture seeds | **58 exit non-zero; 0 fail to discriminate** |
| 4 | Read `50 §2a`–`§2f`, `§3a`–`§3i`, `§6`; `37 §2`'s S1K gate; the invariant registry's `I19`; `36 §2` VC-K1–K3; `phase2-v1.3.6-errata.md` | — |
| 5 | Built the trust chain, bottom up: framing → primitives → trust config → manifest core → required set → verifier → bundle → registry | commit `52d672b` |
| 6 | Assembled the deployed artifact bytes; copied class 20 byte-identically | digest `7af60fc5…a18f33`, 13479 bytes |
| 7 | Built the offline signer as an INDEPENDENT implementation of the framing | `tools/control-artifacts/framing.ts` |
| 8 | Built the audit plane's own verifier, sharing no authority computation | `src/audit/controlArtifacts/auditPlaneVerifier.ts` |
| 9 | Migrated classes 3, 27, 2 and 20's consumers onto the verified bundle | commit `ae25243` |
| 10 | Repaired residual 13's non-idempotent teardown, isolated | commit `47ae8e0` |
| 11 | Wrote the adversarial suite and the eighteen vulnerable controls | commit `999486f` |
| 12 | Re-ran the gate, the seeds and `npm run verify` on the final tree | `S1K-result.md §19` |

---

## 2. The decisions worth recording

### 2.1 The offline signer IS the test oracle

`§9` of the mandate requires an independent hand-authored framing implementation for tests;
`§39` permits an offline signer. **They are one artefact rather than two, deliberately.**

`tools/control-artifacts/framing.ts` is written from `50 §3b` and `§3d` and imports nothing
from `src/`. It signs every fixture the suite uses. So each package the production verifier
ACCEPTS in these tests was produced by an implementation the verifier shares no line of code
with, and a byte-level disagreement between them would surface as a verification failure
across the whole suite rather than as a quiet agreement.

`tests/controlArtifacts/framing-and-oracle.test.ts` additionally compares the two encoders
byte-for-byte over a vector table, including hand-computed vectors that are not derived from
either (`CAS_FIELD("abc") = 00 00 00 03 61 62 63`).

### 2.2 Why the member sets stayed constants and everything else did not

`§17` of the mandate permits constants for "TypeScript enum names; parser machinery;
structural schemas", and forbids them for "independent authority values that can disagree
with the signed artifact".

`ACTION_CLASSES` and `REASON_CODES` moved to a new leaf module
`src/kernel/canonicalisation/actionClasses.ts`. They decide which names can be written down;
they decide no recoverability, no adapter, no unit count, no tolerance and no scope. The
class-3 parser REFUSES an artifact whose membership disagrees with them rather than silently
taking either side.

Everything that decides something — the ten per-class fields and the four catalogue-level
records — is gone from `src/` and comes from the signed artifact.

The separate module also removes a runtime import cycle: `actionCatalogue -> registry ->
verifier -> parser -> actionCatalogue`. ES modules survive that; a cycle on the authority
path is still worth removing rather than reasoning about.

### 2.3 The class-20 binding is an ADMISSION GATE, and nothing more

`50 §3g`: *"After class-20 artifact verification succeeds, the `ACOS-JCS-1` implementations
may be admitted and used for journal canonicalisation."* `50 §3f`: consumers are "bound to
the verified class-20 specification identity".

So `assertJcs1SpecificationAdmitted()` requires an active verified bundle carrying class 20
at `artifact_version = ACOS-JCS-1`, and the gate sits at `canonicalBytes.ts`'s single
structural entry point — `50 §6` names "the TypeScript canonicaliser" as the class-20
runtime consumer, and that module is it.

**It does not interpret the specification text**, and `boundaries.test.ts` asserts the
absence of `eval`, `new Function`, `readFileSync` and `require` in the admission module.
**It compares no hard-coded digest**: the identity checked is the `artifact_version` the
signed manifest bound, and the bundle's existence is what proves the bytes behind it hashed
to the manifest's `content_hash` under two valid signatures. A digest constant there would
be a second authority source for class 20, which `50 §3c` forbids.

The cache is a REFERENCE comparison against the immutable capability, not a cached verdict
about bytes: publication is a single assignment of a new sealed object, so a reload cannot
leave the cache pointing at an admission it did not earn.

### 2.4 `policyArtifacts.ts` lost its filesystem, on purpose

S1D's loader read a directory and computed a digest. `50 §2e`'s O4 rule requires
verification BEFORE admission, and `§25` of the mandate spells out the forbidden shape:
"Do not load unsigned policy and compare digest afterward."

The repair is subtractive. The module no longer imports `node:fs`, has no artifact root, no
directory scan and no overload that takes a path — so the forbidden arrangement is not
something this file can express. `policy_version` is unchanged and still
`47c2849b…c30ff6`, which `tests/policy/policy-artifacts.test.ts` asserts as an acceptance
regression: moving the schema and sources into a signed byte object is not a change to the
policy bytes.

The `.cedar` files remain where a policy is AUTHORED and reviewed.
`tools/control-artifacts/assemblePolicySet.ts` is the one-way release step between authoring
and deployment, and a CI check re-runs it to catch drift. **That check is not an authority
path**: after this slice nothing in `src/` reads the `.cedar` files, and the check exists so
a reviewer editing a policy cannot forget to re-assemble.

### 2.5 The pre-live external-effect gate is TYPE-LEVEL

`50 §3f`: *"external claim and dispatch cannot proceed if the verified bundle is unavailable
or invalid."*

`DispatchEnvironment` gained a REQUIRED `controlArtifacts: VerifiedControlArtifactBundle`.
Not optional, not nullable — an optional field is a field a future composition can omit, and
`§51` of the mandate asks specifically that "a future real-adapter composition must not be
able to bypass this". The capability cannot be manufactured, so a composition that wired a
real adapter into this gateway could not construct an environment without holding one that
verification produced.

It is also the bundle the dispatch path READS its catalogue authority from, so the gate is
the source of the decision rather than a token carried beside it.

`claimForExternalDispatchOn` additionally asserts an active bundle, because the claim is the
irreversible step: `25 §7` puts it "in a committed transaction BEFORE the HTTP call" and
`CLAIMED` has no timeout, lease, expiry or reclaim. It THROWS rather than refusing — a
refusal is a decision about an outbox row, and this is a statement that the kernel is not
READY.

### 2.6 The audit plane is a second implementation, not a second call

`50 §3` property 2: *"A manifest check run only by the control plane is a check the control
plane can pass by lying."*

`src/audit/controlArtifacts/auditPlaneVerifier.ts` imports `node:crypto`, `node:fs` and
`node:path`, and nothing else — asserted element-wise. It re-derives `50 §3b`'s framing and
`§3d`'s core in its own code, reads its own artifact bytes from a directory named by its own
deployment variables, computes its own digests, and has no parameter through which a
control-plane verdict could reach it. `50 §6`'s inventory is transcribed a second time
rather than imported, so a class dropped from one plane's required set is not dropped from
the other's in the same edit.

`tests/controlArtifacts/audit-plane.test.ts` tampers with ONE plane's copy in each
direction and asserts the other plane does not cover for it.

### 2.7 The teardown repair, and why it is a separate commit

Residual 13 reproduced immediately and outside vitest: `DROP SCHEMA public CASCADE` without
`IF EXISTS` throws `3F000` whenever the schema is already absent, and that state is
reachable. Every `reset()` in every subsequent run then fails inside `beforeEach`, which in
the reporter's output is indistinguishable from a product defect.

`§55` of the mandate permits a tiny isolated correction that makes teardown idempotent
rather than changing migration semantics. Commit `47ae8e0` does exactly that and nothing
else: `up()` is untouched, the migration list is untouched, the applied-migrations
bookkeeping is untouched, no SQL in any migration is edited, and nothing under `src/kernel/`
or `src/audit/` reads a schema's existence as an authority operand.

---

## 3. Two corrections made during the work

**A literal `U+0000` byte reached four source files.** A `' '` escape written through
an editing tool was materialised as an actual NUL byte, which made the files read as binary
to `grep` and would have been a needless surprise to a later reader. Behaviour was
unaffected — a NUL in a TypeScript string literal is the same string — and the bytes were
replaced with the escape sequence. `src/kernel/enumeration/refundEnumeration.ts` uses a real
` ` as a map-key separator and is untouched.

**`JSON.stringify` was removed from the whole control-artifact trust chain.** It appeared
only in diagnostic message formatting, which is harmless in itself and makes a structural
rule unassertable: `50 §3b` requires the framing to use "no JSON and no JSON
reserialization", and a rule with exceptions cannot be checked over a directory. A `quoted()`
helper replaced it; `casSig.ts`, which imports nothing at all, quotes inline.

---

## 4. Files added

```
src/kernel/controlArtifacts/     casSig.ts  ed25519.ts  errors.ts  incidents.ts
                                 trustConfig.ts  manifestCore.ts  requiredSet.ts
                                 artifactPackage.ts  artifactParsers.ts
                                 bundle.ts  verifier.ts  registry.ts
src/kernel/canonicalisation/     actionClasses.ts  jcs1Admission.ts
src/audit/controlArtifacts/      auditPlaneVerifier.ts
tools/control-artifacts/         framing.ts  signPackage.ts  assemblePolicySet.ts
artifacts/control/               class-02 … class-27, and the class-20 byte-identical copy
tests/controlArtifacts/          framing-and-oracle  roots-and-manifest  i19-occasions
                                 class-authority  cedar-o4  audit-plane  boundaries
tests/negative-controls/         unsafe-control-artifact-verifier.ts
                                 unsafe-unsigned-authority-literals.ts
                                 unsafe-bundle-lifecycle.ts
                                 unsafe-cedar-and-class20.ts
tests/support/                   controlArtifactFixture.ts  controlArtifactSetup.ts
```

## 5. Files whose AUTHORITY SOURCE changed

```
src/kernel/canonicalisation/actionCatalogue.ts     literals removed; accessors added
src/kernel/canonicalisation/canonicaliser.ts       reads the verified catalogue
src/kernel/canonicalisation/canonicalBytes.ts      class-20 admission gate at its entry
src/kernel/canonicalisation/constructors/refundCreate.ts  verified scope map; digest fields checked
src/kernel/authority/preReservation.ts             reads the verified catalogue
src/kernel/gateway/adapterRegistry.ts              reads the verified catalogue
src/kernel/gateway/dispatchEnvelope.ts             takes the capability explicitly
src/kernel/gateway/effectGateway.ts                requires the capability
src/kernel/outbox/claim.ts                         asserts an active bundle pre-claim
src/kernel/enumeration/enumerationMaxAge.ts        reads the verified catalogue
src/kernel/mirror/degradedModeThresholds.ts        literals removed; accessors added
src/kernel/mirror/mirrorState.ts                   signal max age from the verified config
src/kernel/mirror/dispatchPrecedence.ts            reads the verified thresholds
src/kernel/mirror/corroborationSignal.ts           reads the verified max age
src/kernel/policy/policyArtifacts.ts               loads from the verified class-2 bundle
```
