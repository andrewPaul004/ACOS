# S1L — Implementation log

**Branch `feature/s1l-control-artifact-release`, from `f37c032`. Package issue `v1.3.6`,
unmodified throughout.**

This log records the decisions that were not obvious, and the two places where the mandate
and the architecture had to be reconciled rather than simply followed.

---

## 1. The baseline, before anything was written

| Check | Result |
|---|---|
| `git rev-parse HEAD` | `f37c032` |
| worktree | clean |
| v1.3.6 gate | **89 PASS / 0 FAIL** |
| architecture seeds | **58 run, 58 discriminate** |
| baseline `npm run verify` | run once, on its own, before any file was added |

`docs/architecture/v1.3.6/` was not touched at any point, and `git diff f37c032...HEAD --
docs/architecture/` is empty.

---

## 2. THE FIRST RECONCILIATION — `manifest_id` cannot exist before both approvals

The mandate asks, in `§5`, `§17` and `§18`, for a release candidate that carries a manifest
identity both custodians review before either signs.

`50 §3d` makes that literally impossible. The CORE carries, per entry,
`primary_signature` **and** `second_factor_signature`, and `50 §3e` defines
`manifest_id = SHA-256(exact CORE bytes)`. The manifest identity is therefore a FUNCTION OF
BOTH SIGNATURES and does not exist until both exist.

Two consequences were accepted rather than worked around.

**(a) A separate review identity was introduced, and labelled as tooling.**
`candidate_id` is `SHA-256` over a `ACOS-CAS-SIG-V1`-framed structure under its own domain
separator `ACOS-CONTROL-RELEASE-CANDIDATE-V1`, covering the header, the declared entry order
and every artifact's identity and content digest. It is what the two custodians agree about.
It is **not** `manifest_id`, is never a deployment pin, is not signed by itself, and no
runtime reads it. The distinct domain separator means it cannot be presented anywhere a
manifest core is expected.

**(b) The ceremony has three operations, and the count is forced rather than chosen.**
Since neither custodian can sign the manifest first, exactly one of them must act twice. The
order is primary-artifacts → second-factor-artifacts-and-manifest → primary-manifest. No
function anywhere in `tools/` takes two signers, and the test asserts that over the exported
arities and over a source scan for a two-key signature.

---

## 3. THE SECOND RECONCILIATION — class 19, and what `§13` permits

`§12` requires proof that a caller-supplied legacy verification key cannot admit authority
outside the verified class-19 artifact. `§13` permits implementing the follow-on migration
only if `50 §3i` "uniquely specifies" it, and forbids inventing it otherwise.

`50 §3i` says the verification keys "**should therefore become the same externally
provisioned roots**" and immediately calls that "**DECLARED FUTURE WORK**". It defines no
mechanics: not which root verifies a `ConstructorVersionRecord`, not how a record signed under
`ACOS-JCS-1` canonical bytes relates to an `ACOS-CAS-SIG-V1` owner signature, not rotation,
not revocation. `37 §2` lists the migration as a follow-on and **not a pre-live blocker**.

So the key migration was NOT invented. What was implemented is `§13`'s stated preferred
safety property, which needs no key management at all:

> constructor resolution is rooted in the verified class-19 artifact/bundle identity, not in
> an arbitrary runtime verification-key argument.

`src/kernel/canonicalisation/constructorAdmission.ts` decides MEMBERSHIP from the verified
class-19 artifact carried by a `VerifiedControlArtifactBundle` — a capability `50 §3f`
occasion 3 says only verification can produce. The legacy key argument survives and is
renamed `legacyRecordVerifyingKey`. Its scope is now strictly narrower than the artifact's: it
can cause a REFUSAL and can no longer cause an ADMISSION of anything the owner did not sign.

**What this closes:** `§12`'s attacks A and C, which the unwrapped S1B arrangement accepts.
**What it does not close:** `50 §3i`'s key migration, which remains open and is reported as
such.

A detail found while writing the tests and worth recording: the verified class-19 artifact
declares `acos.constructor.refund.create`, while the S1B canonicaliser registry declares
`ctor.refund.create`. The two identifiers differ. That is consistent with class 19 having no
production authority consumer at v1.3.6 — `50 §6` carries the artifact as a manifest member
and `50 §3i` leaves the runtime wiring to a later slice — and it is the reason the boundary
test enumerates `ConstructorVersionResolver`'s construction sites across `src/` against a
one-entry allow-list: a later slice that wires constructor resolution into a kernel path
cannot reach the raw constructor by accident.

---

## 4. Cross-plane coherence — reporting a declared obligation, not inventing a protocol

`§26` asks whether a partial rollout can masquerade as joint readiness, and warns against
inventing a distributed deployment protocol.

v1.3.6 declares cross-plane obligations in terms of CONTENT, not in terms of a rollout
protocol:

* `50 §2b` — the two planes hold a **byte-identical copy** of the class-20 specification;
* `50 §2c`, `50 §2f` — `corroboration_signal_max_age`'s audit-plane copy, where "equality
  across the two planes is a cross-plane obligation";
* `50 §3` property 2 — the audit plane "recomputes every hash from its own copy and compares
  to **the manifest it holds**".

The readiness gate checks both content obligations from each plane's OWN verified bytes, and
reports `PLANES_ON_DIFFERENT_RELEASES` when the two independently obtained manifest identities
differ — because an audit plane holding an older manifest is not recomputing against the
control plane's active release, which is exactly the property property 2 exists to provide.

**No protocol was invented.** The gate is local, read-only, and orchestration-level: it
observes two verifications that already happened separately and never lets one stand in for
the other.

---

## 5. Determinism, and what was deliberately kept out of an identity

The candidate is a pure function of the declared identities, the exact artifact bytes and the
two public keys. Nothing reads the clock, the host name, the process id, a random source, a
temporary path or the git working directory.

Two consequences were tested rather than assumed:

* **Ed25519 is deterministic** (RFC 8032 PureEdDSA), so reproducibility survives signing and
  the whole release — `manifest_id` included — reproduces from the same inputs and keys. Two
  complete ceremonies in two separate trees produce byte-identical `manifest.json` files.
* **Non-authority metadata is in its own file.** `release_channel` and an operator note live
  in `release-metadata.json`, labelled `NOT_AUTHORITATIVE`, and the tests prove that moving
  either changes neither identity and that the note appears nowhere inside the package.

The two PUBLIC keys are also recorded there, so `deployment.json` can be produced without a
private half. Their correctness is checked rather than trusted: their `key_id`s are re-derived
and compared against the signed core's `expected_*_key_id` before any deployment document is
written.

---

## 6. Independence of the offline signer

`tools/control-release/` imports nothing from `src/`. It carries its own transcription of
`50 §6`'s closed inventory rather than importing `requiredSet.ts`, because a shared constant
cannot disagree and two independent transcriptions of one printed table can. The agreement is
asserted in a test — class for class, id for id, version for version — which is the correct
place for it.

It reuses `tools/control-artifacts/framing.ts`, the S1K oracle that was already written from
`50 §3b` and `§3d` and already proved byte-identical to the production encoder over a vector
table. Reusing it keeps ONE independent framing implementation rather than adding a third that
would need its own equivalence proof.

`tools/prelive/` is different on purpose: a readiness checker's job is to run both planes'
real verifiers, so it imports them. It signs nothing, and it does not import the ceremony.

---

## 7. Private-key handling, and the claims deliberately not made

The tool accepts a PKCS#8 Ed25519 private key from an explicitly named path. There is no
default path, no search path, no home-directory lookup, and no environment variable for key
material anywhere in the release tooling. The seed constructor is named
`testOnlySignerFromSeed` and is not wired to any command-line flag.

Parser and filesystem errors are deliberately **not** forwarded: both can quote the material
or the path. The refusal says what is wrong and nothing else.

**No secure-deletion guarantee is made**, because a normal filesystem cannot provide one, and
`§35` is explicit that inventing one is forbidden.

**No key-management product is named anywhere in `tools/`**, and the boundary test asserts
that by scanning for the names rather than by taking a comment's word for it — which is why
the `§37` citation in `signerKey.ts` paraphrases the list instead of reproducing it.

---

## 8. Two new refusal codes on an existing closed union

`src/kernel/controlArtifacts/errors.ts` gained `CONSTRUCTOR_RECORD_NOT_MANIFESTED`,
`MANIFESTED_CONSTRUCTOR_MISSING` and `CONSTRUCTOR_RECORD_DUPLICATED`. The union is closed and
the existing boundary test asserts that every thrown failure's code is a member, so extending
it was the only way to raise a typed integrity failure from the admission gate. No existing
code's meaning changed and nothing was removed.

---

## 9. Two things the manual operator run found that the unit tests had not

The whole ceremony was driven once through the command line, as an operator would, with
TEST-ONLY keys generated into a scratch directory outside the repository. Two facts came out
of it that the library-level tests had hidden.

**(a) The readiness gate has to run occasion 1 in its own process.** `§39` asks the gate to
report "Cedar verified". `50 §2e`'s O4 rule makes that a question about the ENGINE, and the
loader computes `26 §11`'s `policy_version` through `ACOS-JCS-1`, which `50 §3f` binds to the
ACTIVE verified bundle. Inside vitest a bundle is always active — the setup file bootstraps
one — so the tests passed while the CLI reported `CEDAR_BUNDLE_NOT_LOADABLE`. The gate now
performs `50 §3f` occasion 1 when nothing is active, and verifies WITHOUT publishing when
something already is, so it can answer the question a CLI run asks without ever displacing a
bundle a host is running on. `tests/release/prelive-gate.test.ts` asserts the second half.

**(b) The release tooling does not validate values, and that is correct.** An R2 built with
`audit_unreachable_full_halt_threshold` widened to `PT6H` builds, reviews, diffs and signs
without complaint — the diff names the change, with its before and after — and the RUNTIME
then refuses the package outright, because `50 §2c`'s durations are `PT<n>M` or `PT<n>S`. The
tool informs (`§32`) and the kernel decides. The owner sees the change before signing; a
deployment that signed it anyway would fail closed rather than run on it.

---

## 10. What was NOT done

* no provider, no adapter, no HTTP, no credential, no sandbox;
* no release is committed, and no key of any kind is committed;
* no architecture file was edited;
* the control-plane incident table remains open, as S1K left it, and was not turned into S1L
  scope creep;
* residual 12 — the 22 older C/E conditions without discriminating seeds — was not worked on
  and is not claimed closed.
