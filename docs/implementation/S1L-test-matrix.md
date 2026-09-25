# S1L — Test matrix

**Branch `feature/s1l-control-artifact-release`. Baseline `f37c032`. Package issue `v1.3.6`,
unmodified.**

Every row names the mandate section it discharges and the file that discharges it. Rows
marked **VC** are the fourteen vulnerable controls of `§49`; each one is a real branch that
ACCEPTS what production REFUSES, run against the same fixture.

---

## 1. Determinism and the closed candidate — `tests/release/candidate-determinism.test.ts`

| § | Property |
|---|---|
| §6, §34 | two builds in two separate trees produce one `candidate_id`, byte-identical candidate documents and byte-identical package files |
| §6, §34 | two COMPLETE ceremonies over the same inputs produce the same `manifest_id` and a byte-identical `manifest.json` (Ed25519 is deterministic) |
| §34 | a non-authority operator note moves neither identity and appears nowhere inside the package |
| §6 | the `release_channel` label moves neither identity |
| §49 **VC 1** | a candidate identity carrying a build stamp does not reproduce across machines; the production identity does |
| §7 | a missing required artifact is REFUSED |
| §7 | a class-17 entry is REFUSED, not ignored |
| §7 | a class outside `50 §6`'s six is REFUSED |
| §7 | a duplicate class is REFUSED |
| §21 | two artifacts competing for one package file name are REFUSED — no first-match rule |
| §7 | an artifact whose own bytes declare a different version is REFUSED |
| §7 | a class-20 version other than `ACOS-JCS-1` is REFUSED |
| §3a | one key in both root slots is REFUSED at BUILD time |
| §10 | a CRLF copy of the class-20 specification changes its digest and the candidate identity |
| §33 | a trailing-newline change is a different artifact |
| §10 | the tool copies artifact bytes EXACTLY — a CRLF source stays CRLF in the package |

## 2. The two-custodian ceremony — `tests/release/ceremony.test.ts`

| § | Property |
|---|---|
| §14 | the whole ceremony completes and the release verifies offline, over all six classes |
| §14 | every ceremony entry point takes EXACTLY ONE signer, and no module offers a two-key operation |
| §14, `50 §3d` | `manifest_id` does not exist until both custodians have approved; no `manifest.json` is written before the countersignature |
| §17, §18 | neither approval modifies an artifact byte or `candidate.json`; both name the same candidate; the two signer key ids differ |
| §18 | a package edited between the approvals stops the ceremony (`RELEASE_PACKAGE_DIGEST_MISMATCH`) |
| §17 | a hand-edited `candidate_id` is caught the first time any step opens the file |
| §49 **VC 2** | a signer that re-derives from the SOURCE tree signs an unreviewed edit while reporting the reviewed candidate id; production signs the reviewed package bytes |
| §49 **VC 4** | a second signer that signs a different core produces a different `manifest_id`, and the countersignature REFUSES it (`RELEASE_MANIFEST_IDENTITY_DISAGREES`) |
| §19 | a signer whose `key_id` is not the candidate's expected one is REFUSED |
| `50 §3a` | the PRIMARY key cannot stand in for the SECOND_FACTOR |
| §14 | the second approval refuses to run before the primary's; the countersignature refuses before the second |
| §49 **VC 3** | one operation holding both keys produces a CRYPTOGRAPHICALLY VALID package with NO approval records; the real ceremony leaves three, under two distinct key ids |
| §38 | the repository asserts two operations, two keys, one identity — and NOT human custody |
| §49 **VC 5** | a completed release contains no `PRIVATE KEY`, no seed and no PEM body; the defect writes one and the same scan finds it |
| §33 | a whitespace-only edit changes both identities and the old per-artifact signature |
| §33 | an old manifest signature spliced onto a new core fails offline verification |
| §6 | the S1K ONE-SHOT signer and the S1L THREE-STEP ceremony produce the SAME `manifest_id` over the same artifacts, epoch and keys — two independently assembled cores, one identity |

## 3. Offline release verification — `tests/release/release-verify.test.ts`

| § | Property |
|---|---|
| §20 | a completed release verifies under the externally supplied public keys |
| §20 | the deployed flat COPY verifies the same way, with no release scaffolding beside it |
| `50 §3a` | an attacker public key is REFUSED on the key-id consistency check, before any signature |
| `50 §3a` | one key in both slots is REFUSED |
| §29 | an incompletely copied package → `ARTIFACT_BYTES_UNREADABLE` |
| §29 | one corrupted artifact → `ARTIFACT_CONTENT_HASH_MISMATCH` |
| §29 | a deleted manifest entry → `REQUIRED_ARTIFACT_MISSING` |
| §29 | a resurrected class 17 → `RETIRED_CLASS_PRESENT` |
| `50 §3d` | reordered entries with correct signatures → `MANIFEST_ORDER_INVALID` |
| `50 §3d` | a disagreeing `entry_count` → `MANIFEST_ENTRY_COUNT_MISMATCH` |
| §29 | a missing Cedar artifact → `ARTIFACT_BYTES_UNREADABLE` |
| `50 §3e` row 7 | an artifact edited AND its entry updated still fails, on the manifest signature |

## 4. Review and diff — `tests/release/review-and-diff.test.ts`

| § | Property |
|---|---|
| §31 | the report is deterministic across builds, and deleting it moves no identity |
| §31 | CLASS 3 — all ten `50 §2a` fields, the four catalogue records, and the DERIVED external-dispatch setting |
| §31 | CLASS 27 — `50 §2c`'s four quantities at their current values (`PT15M`, `PT30M`, `20.00`, `PT5M`) |
| §31 | CLASS 20 — version, the frozen digest, 13479 bytes, the `0x0D` check, and the "proves no implementation conforms" limit |
| §11, §31 | CEDAR — `content_hash` and `policy_version` printed SEPARATELY and labelled, both present, and not equal |
| §11 | the tool's INDEPENDENT `policy_version` transcription reproduces the accepted `47c2849b…`, and is length-framed |
| §31 | CLASS 19 — the constructor records the release carries |
| §47 | a `TEST_ONLY` release is banner-labelled; a `PRODUCTION` one is not |
| §31 | before the ceremony the report says the manifest identity is not yet computable |
| §49 **VC 11** | a review omitting `adapter` is byte-identical across an outbox-scope change; production shows it twice |
| §8, §9 | every digest in the report came from the candidate, which came from the bytes |
| §32 | the diff surfaces: recoverability, adapter + derived external dispatch, irrecoverable units, an added/removed action class, a degraded threshold (named, with before/after), a Cedar policy change + moved `policy_version`, an ACOS-JCS-1 change including line endings alone, a constructor-record change |
| §32 | two builds of one input diff to nothing, and the renderer says why that is not a licence to skip a ceremony |
| §32 | the diff never renders a safety verdict |
| §49 **VC 12** | a diff scoped to the policy classes misses the full-halt threshold; production reports it |

## 5. The deployment dry run — `tests/release/deployment-dry-run.test.ts`

| § | Property |
|---|---|
| §24 | the ten declared steps, end to end, through the REAL tool and the REAL verifiers; representative class-3, class-27, class-20 and Cedar reads; both cross-plane obligations equal; the gate READY |
| §25 | R's package under R−1's pin is REFUSED (`MANIFEST_IDENTITY_NOT_PINNED`) and never becomes READY; the correct pin then succeeds |
| §49 **VC 7** | a deployer that never checks the pin activates the OLD package; production refuses on identity |
| §49 **VC 6** | "the highest epoch on disk" selects the big number; production runs what its pin names and the failed candidate never displaces the active bundle |
| §29 | a failed RELOAD leaves the OLD release active — PROCESS READY ON OLD RELEASE, not NEW RELEASE ACTIVATED |
| §29 | wrong primary key / wrong second key / one key both slots / wrong pin — each refuses with its own code and never becomes READY |
| §29 | incomplete package / corrupted artifact / missing Cedar artifact — each refuses with its own code |
| §29 | a resurrected class 17 in a deployed manifest is refused — on the PIN, which moves first, with the entry inserted in declared order so the order check cannot be what refuses it |
| `50 §2d` | and the same class-17 entry inside a correctly pinned package is refused as `RETIRED_CLASS_PRESENT` by the offline verifier — the second leg |
| §23 | a wrong AUDIT key fails the audit plane and leaves the control plane correct; the gate is NOT_READY |
| §23 | a wrong CONTROL pin fails the control plane and leaves the audit plane correct |
| `50 §3` p2 | a tampered AUDIT copy is caught BY THE AUDIT PLANE |
| §49 **VC 9** | an audit verdict copied from the control plane misses a divergence the audit plane exists to find |
| §26, §27 | control on R2 + audit on R1: each verified its own; `PLANES_ON_DIFFERENT_RELEASES`; NOT_READY |
| §49 **VC 8** | the `&&` over two booleans reports joint readiness across two different releases |
| §26 | completing the rollout makes the gate READY |
| §30 | R1's package under R2's pin is REFUSED and R2 stays active |
| §30 | an EXPLICIT pin change to R1 with R1's package activates R1 — and the audit plane does not follow automatically |

## 6. Class 19 — `tests/release/class19-admission.test.ts`

| § | Property |
|---|---|
| §12 | the verified artifact declares exactly one record, at 1.0 |
| §12 | the manifested record, correctly signed, is admitted and resolves |
| §12 **A** | attacker key + attacker-signed version B → `CONSTRUCTOR_RECORD_NOT_MANIFESTED`, before any signature check |
| §49 **VC 10** | the unwrapped S1B arrangement ADMITS version B |
| §12 **B** | a key that does not verify the manifested record: the tuple is admitted, `resolve` FAILS CLOSED, and nothing is substituted |
| §12 **C** | a correctly signed record for an unmanifested constructor → REFUSED; a MISSING manifested record → `MANIFESTED_CONSTRUCTOR_MISSING` |
| §49 **VC 10** | the unwrapped arrangement resolves the intruder |
| §12 **D** | a new owner-approved class-19 RELEASE admits the new version and stops admitting the old one; authority follows the signed bytes |
| §13 | the legacy key argument still exists and is named `legacyRecordVerifyingKey`; the migration is recorded as declared future work |
| §13 | the key can no longer WIDEN authority — three forged shapes all refuse, and the owner-signed record is admitted whichever key is offered |
| §12 | two records for one manifested version are refused |

## 7. Boundaries — `tests/release/release-boundaries.test.ts`

| § | Property |
|---|---|
| §3 | NOTHING under `src/` imports anything under `tools/` or `tests/` |
| §49 **VC 13** | the same scan finds the defect in the sample and in the tooling, and nothing in `src/` |
| §16 | `tools/control-release/` imports NOTHING from `src/` |
| §16 | its independent `50 §6` transcription agrees with the runtime's, class for class, id for id, version for version |
| §39 | the pre-live tool DOES import `src/` (it is a verifier consumer), signs nothing, and does not import the ceremony |
| §4 | no release-tooling module generates a key pair |
| §35, §36 | the only private-key entry points are an explicit file path and a `testOnly`-named seed; no `process.env` anywhere in the release tooling |
| §35 | the CLI exposes `--key-file` and nothing that could carry key bytes |
| §35 | a COMPLETED release directory contains no private material at all |
| §22 | the deployment document carries the two PUBLIC keys, declares it holds no private material, and gives each plane its own block |
| §37 | no transport of any kind, and no key-management vendor named |
| §47 **VC 14** | the real deployment document always declares its channel; the defect drops it; the DECISIVE separation is the key id |
| §47 | no test-signed release is committed anywhere in the tree |
| §38 | three approval records under two distinct key ids, and no claim that two humans were present |

## 8. The pre-live gate — `tests/release/prelive-gate.test.ts`

| § | Property |
|---|---|
| §40 | neither forbidden launch claim appears in the tooling or in a rendered READY result |
| §40 | the status union has exactly the two declared members |
| §39 | both planes' independently obtained manifest identities are reported |
| §23 | a missing AUDIT configuration is not covered for by the control plane |
| `50 §2e` | a signed Cedar bundle that does not load is a finding, not a silent pass |
| `50 §2b` | a divergent audit-plane class-20 copy is caught, on that plane |
| §39 | the CLI exits non-zero when the gate is not satisfied |
| §39 | no network, no vendor, no credential surface in the gate's code |
| §39 | it claims nothing about I36, I20 or I8 |
| §39 | it does NOT displace a bundle the process is already running on |
| §39 | it is read-only: two runs leave both packages byte-identical |

---

## 9. The fourteen vulnerable controls, and where each discriminates

| # | `§49` control | Vulnerable implementation | Production counterpart | Discriminating test |
|---|---|---|---|---|
| 1 | non-deterministic candidate | `unsafeNonDeterministicCandidateId` | `buildReleaseCandidate` | candidate-determinism |
| 2 | signer silently modifies candidate | `unsafeSignerRederivesFromSources` | `approvePrimaryArtifacts` | ceremony |
| 3 | one operation holds both keys | `unsafeSignBothInOneOperation` | the three-step ceremony | ceremony |
| 4 | second signer signs a different manifest | `unsafeSecondSignerSignsDifferentCore` | `countersignPrimaryManifest` | ceremony |
| 5 | private key copied into release output | `unsafeWritePrivateKeyIntoRelease` | the ceremony writes none | ceremony |
| 6 | highest signed epoch selected | `unsafeSelectHighestEpoch` | the deployment pin | deployment-dry-run |
| 7 | old package activated without the pin | `unsafeActivateWithoutPin` | `verifyControlArtifactBundle` | deployment-dry-run |
| 8 | partial rollout reported jointly ready | `unsafeJointReadiness` | `evaluatePreliveReadiness` | deployment-dry-run |
| 9 | audit verdict trusts the control plane | `unsafeAuditVerdictFromControl` | `verifyAuditPlaneControlArtifacts` | deployment-dry-run |
| 10 | caller key admits unmanifested constructor | `unsafeCallerKeyConstructorResolver` | `admitConstructorVersionRecords` | class19-admission |
| 11 | review omits a class-3 authority field | `unsafeReleaseReviewOmittingAdapter` | `renderReleaseReview` | review-and-diff |
| 12 | diff misses a degraded-threshold change | `unsafeDiffIgnoringDegradedConfiguration` | `compareReleases` | review-and-diff |
| 13 | runtime imports the signing tool | `UNSAFE_RUNTIME_SIGNER_IMPORT_SAMPLE` + `importsReleaseTooling` | the import-graph boundary | release-boundaries |
| 14 | test-signed release mislabelled production | `unsafeUnlabelledDeploymentDocument` | `deploymentTrustDocument` | release-boundaries |

All fourteen live in `tests/negative-controls/unsafe-release-ceremony.ts`. Nothing under
`src/` imports that file, and `tests/release/release-boundaries.test.ts` asserts it.
