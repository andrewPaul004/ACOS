# S1L — Result

**Pre-live control-artifact release and deployment ceremony.**
**Baseline `f37c032`. Branch `feature/s1l-control-artifact-release`. Package issue `v1.3.6`,
unmodified.**

---

## 1. Verdict

**PASS.**

Every one of `§53`'s twenty-nine criteria is met. Two of them were met by a route the mandate
did not anticipate and one was met more narrowly than its heading suggests; all three are
stated plainly below and in `S1L-owner-clarifications.md` rather than smoothed over.

**`ACTUAL OWNER PRODUCTION CEREMONY: NOT PERFORMED.`** No production owner key was created,
held or used. What is proved is the MECHANISM and a complete dry run under TEST-ONLY keys.

---

## 2. What was built

S1K proved `signed package + trusted roots + trusted pin -> verified bundle -> authority`.
S1L proves the other direction, end to end, through the real tool and the real verifiers:

```
release input declaration (no private key)
  -> deterministic unsigned candidate + deterministic review report
  -> PRIMARY owner artifact approval          (one key, one operation)
  -> SECOND_FACTOR independent approval       (one key, one operation) -> manifest_id exists
  -> PRIMARY manifest countersignature        (one key, one operation) -> release complete
  -> public deployment trust values
  -> control-plane bootstrap  +  audit-plane bootstrap, separately
  -> one active manifest identity, independently obtained twice
  -> restart / redeploy / rollback
  -> STOP
```

---

## 3. The three things a reader should not skim past

**(a) `manifest_id` cannot exist before both approvals, and the mandate's phrasing assumed it
could.** `50 §3d`'s CORE carries both per-entry signatures; `50 §3e` hashes the CORE. So the
manifest identity is a function of both signatures. S1L therefore carries a separate,
explicitly non-normative **review identity** — `candidate_id`, under its own domain separator
— for the two custodians to agree on, and the ceremony has THREE operations because exactly
one custodian must act twice. Neither fact is a design preference; both are forced by `50`.

**(b) Class 19's KEY migration is still open. Its ability to WIDEN authority is closed.**
`50 §3i` declares the key migration future work and defines no mechanics, and `§13` forbids
inventing it. What `§13` does state as the preferred safety property was implemented:
constructor membership is now decided by the verified class-19 artifact bytes. All four of
`§12`'s attacks are proved, against production and against the unwrapped S1B arrangement.

**(c) The readiness gate performs `50 §3f` occasion 1 in its own process.** Found by running
the CLI by hand: `§39` asks the gate to report "Cedar verified", `50 §2e`'s O4 rule makes that
a question about the engine, and the loader's `policy_version` runs through `ACOS-JCS-1`,
which `50 §3f` binds to the ACTIVE bundle. Inside vitest a bundle is always active, so the
library tests passed while the CLI failed. The gate now bootstraps when nothing is active and
verifies without publishing when something is — and a test asserts it never displaces a bundle
a host is running on.

---

## 4. Release candidate

| | |
|---|---|
| command | `npx tsx tools/control-release/cli.ts build --input … --out …` (also `npm run release:control`) |
| private key required | **NO.** The two PUBLIC keys are required, because `50 §3d`'s core carries their key ids |
| deterministic | **YES.** No clock, host name, process id, random value, temporary path or working directory reaches an identity |
| artifact set | `50 §6`'s CLOSED six: classes 2, 3, 19, 20, 24, 27 |
| refusals | missing member, duplicate class, unknown class, retired class 17, duplicate package file name, a path in a file name, an artifact whose own bytes declare a different id or version, one key in both root slots |
| candidate identity | `candidate_id = SHA-256` over `ACOS-CAS-SIG-V1` framing under `ACOS-CONTROL-RELEASE-CANDIDATE-V1` |
| repeat-build equality | **byte-identical** — candidate document, every package file, and (after signing) `manifest.json` |

Reproducibility is proved from two separate temporary trees with different absolute paths,
standing in for two clean checkouts. Ed25519 is deterministic, so the equality survives
signing.

**Cross-assembler agreement.** The S1K one-shot signer and the S1L three-step ceremony produce
the **same `manifest_id`** over the same artifacts, epoch and keys. They share `50 §3b`'s
framing oracle and nothing else; the entry ordering, header, core layout and signature slots
are assembled independently.

---

## 5. Primary approval

| | |
|---|---|
| implementation | `tools/control-release/ceremony.ts`, `approvePrimaryArtifacts` — ONE signer parameter |
| key source | an EXPLICIT operator-supplied path. No default, no search path, no home-directory lookup, no environment variable |
| candidate identity | re-derived from the package bytes on every step; the approval records the identity it approved |
| can the signer mutate the candidate? | **NO.** Package files and `candidate.json` are byte-identical before and after; the step writes only into `approvals/` |
| wrong key | refused — the signer's PUBLIC `key_id` must equal the candidate's `expected_primary_key_id` |

---

## 6. Second-factor approval

| | |
|---|---|
| implementation | `approveSecondFactorAndManifest` — ONE signer parameter |
| separate operation | **YES.** A separate invocation, on a separate release hand-off |
| same candidate identity | re-derived independently, and the primary's approval is checked to be FOR that identity |
| distinct key | required: an approval under the primary's key is refused outright |
| one-key shortcut possible? | **NO command offers one.** No function under `tools/` takes two signers; asserted over the exported arities and over a source scan |

A second custodian who silently changes anything produces a core the primary cannot reproduce,
and `countersignPrimaryManifest` refuses with `RELEASE_MANIFEST_IDENTITY_DISAGREES`.

---

## 7. The private-key boundary

| | |
|---|---|
| production runtime access | **NONE.** Nothing under `src/` imports anything under `tools/` |
| release output contains private material? | **NO.** Every byte of a completed release is scanned for PEM headers, the test seeds and key-shaped strings |
| repository contains production private material? | **NO** |
| test keys | the S1K TEST-ONLY seeds, printed in full in test support, plus per-run keys generated into a scratch directory outside the repository for the manual CLI run |
| network signing service | **NONE.** No transport of any kind, and no key-management product named anywhere in `tools/` |
| secure-deletion claim | **NONE MADE.** A normal filesystem cannot provide one |

---

## 8. The signed package

```
release-r1/
  package/                      <- the DEPLOYABLE artifact package, flat
    class-02.policy-set.json          class-19.effect-constructors.json
    class-03.action-catalogue.json    class-20.acos-jcs-1.spec.v1.txt
    class-24.audit-signing-key.json   class-27.degraded-mode-config.json
    manifest.json                     <- 50 §3d's closed document
  candidate.json                      <- the reviewed, unsigned identity
  approvals/primary-artifacts.json
  approvals/second-factor.json
  approvals/primary-manifest.json
  release-review.txt                  <- deterministic; NOT signed authority
  deployment.json                     <- PUBLIC trust values only
  release-metadata.json               <- NOT_AUTHORITATIVE
```

Twelve artifact signatures plus two manifest signatures, all verified independently by
`acos-control-release verify` against EXTERNALLY SUPPLIED public keys. The manifest's declared
key ids are checked AGAINST those keys and never used to select them.

**Observed in the manual run:** class 20 carries
`7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33` at 13479 bytes — the digest
and size `50 §2b` froze — and the class-2 review prints `policy_version`
`47c2849b41bd0bdf433e75d7cf75b45f3133d93183c8fd447606ce1017c30ff6`, the accepted current
value, computed by the tool's own independent transcription.

---

## 9. Deployment trust

`deployment.json` carries exactly the three values `50 §3e` pins, all public, under each
plane's own variable names — `ACOS_*` for the control plane and `ACOS_AUDIT_*` for the audit
plane. The values are equal; the PROVENANCE is not, which is the whole point of `50 §3`
property 2. The artifact root is left as a placeholder, because it is a LOCATION and not a
trust anchor.

No private material appears, and the document says so in a field a reader cannot miss.

---

## 10. Control / audit deployment dry run

| | |
|---|---|
| control result | READY on the expected manifest identity, via the real `50 §3f` occasion 1 |
| audit result | verified independently, by the separately authored audit-plane verifier |
| manifest equality | two independently obtained identities, equal |
| representative reads | class 3 (`refund.create` COMPENSABLE, `fulfilment.reship` 1 irrecoverable unit), class 27 (15m / 30m / 2000 minor units / 5m), class 20 (`ACOS-JCS-1`, 13479 bytes), Cedar (loaded from the verified bundle) |
| cross-plane obligations | class-20 content hash equal; `corroboration_signal_max_age` equal |
| wrong-pin result | **REFUSED** `MANIFEST_IDENTITY_NOT_PINNED`, never READY; the correct pin then succeeds |
| corrupt-package result | **REFUSED** — incomplete copy, corrupted artifact, missing Cedar artifact, wrong primary key, wrong second key, one key in both slots, revived class 17; each with its own code, none reaching READY |
| failed reload | the OLD release stays active: **PROCESS READY ON OLD RELEASE**, explicitly not "new release activated" |
| partial-rollout result | control R2 + audit R1: each plane verified its own pinned package, `PLANES_ON_DIFFERENT_RELEASES`, `NOT_READY` |

The manual CLI run reproduced the coherent case (READY), the partial rollout
(`PLANES_ON_DIFFERENT_RELEASES`, exit 1) and the swapped-key verification refusal.

---

## 11. Class 19

| | |
|---|---|
| current legacy mechanism | `ConstructorVersionResolver` takes its verifying key as a constructor argument, exactly as S1B built it and as `50 §3i` describes |
| can a caller-selected key widen authority? | **NO.** Membership is decided by the verified class-19 artifact bytes; the key can now only cause a refusal |
| attack A — attacker key + attacker-signed version B | **REFUSED** `CONSTRUCTOR_RECORD_NOT_MANIFESTED`, before any signature check. The unwrapped S1B arrangement ADMITS it |
| attack B — a key that does not verify the manifested record | tuple admitted, `resolve` FAILS CLOSED, **nothing substituted** |
| attack C — a correctly signed record for an unmanifested constructor | **REFUSED.** A manifested record the deployment did not supply is also refused |
| attack D — a legitimate new owner-approved class-19 release | the new version is admitted after normal publication, and the old one no longer is. Authority follows the signed bytes |
| migration performed? | **NO — and deliberately not.** `50 §3i` defines no mechanics and `§13` forbids inventing them |
| migration status | **OPEN**, carried as hardening debt, exactly as `37 §2` classifies it |
| pre-live blocker? | **NO.** `37 §2` lists it as a follow-on, and the widening capability `§12` was written to find is closed |

A structural rule now backs the claim: `new ConstructorVersionResolver(` appears in exactly
ONE production module — the admission gate — pinned against a hand-authored allow-list, so a
later slice cannot reach the raw constructor by accident.

**Noted honestly:** the verified class-19 artifact declares `acos.constructor.refund.create`
while the S1B registry declares `ctor.refund.create`. They differ, consistent with class 19
having no production authority consumer at v1.3.6.

---

## 12. Release review — fields covered

| Class | Shown |
|---|---|
| **3** | all ten `50 §2a` per-class fields for every action class — `recoverability`, `value_direction`, `carries_vendor_monetary_field`, `cost_component_free`, `rate_based`, `irrecoverable_units`, `settlement_tolerance`, `adapter`, `method` — plus the **derived external-dispatch setting** (`50 §2f`), plus the four catalogue-level records |
| **27** | `50 §2c`'s exactly four quantities, at their current values, plus anything present beyond the closed four |
| **20** | version, digest, byte count, whether a `0x0D` byte is present, trailing-LF, and the "proves no implementation conforms" limit |
| **Cedar** | the signed `content_hash` AND `policy_version`, printed separately and labelled, plus the schema digest and a per-policy-file inventory |
| **19** | every constructor record the artifact declares |
| **24** | the published key id — public by definition |

The report is deterministic, is written beside the release rather than inside it, and deleting
it changes no identity.

---

## 13. Release diff — examples detected

From the manual R1 → R2 run, which changed one adapter and one threshold:

```
ADAPTER_CHANGED              refund.create.adapter            mock_processor -> internal_only
EXTERNAL_DISPATCH_CHANGED    refund.create.externalDispatch   EXTERNAL_DISPATCH -> INTERNAL_ONLY
DEGRADED_THRESHOLD_CHANGED   audit_unreachable_full_halt_threshold   PT30M -> PT6H
ARTIFACT_CONTENT_HASH_CHANGED  class 3 / class 27
MANIFEST_EPOCH_CHANGED       1 -> 2
```

Also covered by tests: recoverability, irrecoverable units, an added or removed action class,
a Cedar policy change with its moved `policy_version`, an `ACOS-JCS-1` change including line
endings alone, and a constructor-record change.

**The tool never says whether a change is safe.** It has no severity column and no exit code
that means approval.

---

## 14. Rollback

| | |
|---|---|
| implicit rollback | **DOES NOT EXIST.** No highest-epoch rule, no "accept any signed manifest", no fallback |
| copying R1's package back without changing the pin | **REFUSED**, and R2 stays active |
| explicit operator rollback | changing the trusted pin to R1's identity and deploying R1's package **activates R1** |
| pin behaviour | the pin decides. `manifest_epoch` is lineage and legibility only |
| audit plane | does **not** follow automatically — the gate reports the rollback as incomplete until the audit plane's pin moves too |

v1.3.6 declares no prohibition on backwards epoch movement under an explicit pin, and none was
invented.

---

## 15. Pre-live readiness

| | |
|---|---|
| local integrity status | control bundle verified, audit bundle independently verified, required set complete, class 17 absent, Cedar loadable, both declared cross-plane obligations equal |
| control manifest | obtained by the control plane's own occasion-1 ceremony |
| audit manifest | obtained by the audit plane's own verifier, from its own variables |
| result | **`READY_FOR_PROVIDER_SANDBOX_CONFIGURATION`** |

That is the only readiness claim the gate can make. The two broader launch claims `§40`
forbids appear nowhere in the tooling; the test holds them and asserts their absence.

---

## 16. Actual production ceremony

| | |
|---|---|
| real production owner keys created? | **NO** |
| real primary owner approval performed? | **NO** |
| real second-factor approval performed? | **NO** |
| real production manifest deployed? | **NO** |

Every key used anywhere in this slice is test-only, and every release produced is labelled
`TEST_ONLY` and lives in a temporary directory. **Nothing here is evidence that a human owner
created, possesses, separated or backed up a production private key.**

---

## 17. Vulnerable controls

| # | Attack | Vulnerable implementation | Production / tooling | Discriminates? |
|---|---|---|---|---|
| 1 | non-deterministic release candidate | `unsafeNonDeterministicCandidateId` | `buildReleaseCandidate` | **YES** |
| 2 | signer silently modifies candidate | `unsafeSignerRederivesFromSources` | `approvePrimaryArtifacts` | **YES** |
| 3 | one operation holds both signing keys | `unsafeSignBothInOneOperation` | the three-step ceremony | **YES** |
| 4 | second signer signs a different manifest ID | `unsafeSecondSignerSignsDifferentCore` | `countersignPrimaryManifest` | **YES** |
| 5 | private key copied into release output | `unsafeWritePrivateKeyIntoRelease` | the ceremony writes none | **YES** |
| 6 | highest signed epoch automatically selected | `unsafeSelectHighestEpoch` | the deployment pin | **YES** |
| 7 | old package activated without matching pin | `unsafeActivateWithoutPin` | `verifyControlArtifactBundle` | **YES** |
| 8 | partial rollout reported jointly ready | `unsafeJointReadiness` | `evaluatePreliveReadiness` | **YES** |
| 9 | deployment checker trusts control for audit | `unsafeAuditVerdictFromControl` | `verifyAuditPlaneControlArtifacts` | **YES** |
| 10 | class-19 caller key admits unmanifested constructor | `unsafeCallerKeyConstructorResolver` | `admitConstructorVersionRecords` | **YES** |
| 11 | review omits an authority-changing class-3 field | `unsafeReleaseReviewOmittingAdapter` | `renderReleaseReview` | **YES** |
| 12 | diff misses a degraded-threshold change | `unsafeDiffIgnoringDegradedConfiguration` | `compareReleases` | **YES** |
| 13 | runtime signing tool imported into production | `UNSAFE_RUNTIME_SIGNER_IMPORT_SAMPLE` + `importsReleaseTooling` | the import-graph boundary | **YES** |
| 14 | test-signed artifact mislabelled as production | `unsafeUnlabelledDeploymentDocument` | `deploymentTrustDocument` | **YES** |

Control 3 deserves its note: the one-shot package **verifies, and must** — two distinct keys
really did sign it. What the defect destroys is the only thing the second factor was for, so
what discriminates is the evidence, not the cryptography: the real ceremony leaves three
approval records under two distinct key ids and the defect leaves none.

Control 14 deserves its note too: the label is legibility. The DECISIVE separation is that
test keys derive different `key_id`s, which move `50 §3d`'s core and therefore `manifest_id`,
so a test-signed package can never satisfy a deployment pinned to a production manifest.

---

## 18. Verification

**Run on the final tree, with no other verify process running.**

| | |
|---|---|
| architecture gate | **89 PASS / 0 FAIL** |
| architecture seeds | **58 run, 58 discriminate, 0 fail to discriminate** |
| `git diff f37c032 -- docs/architecture/` | **empty** |
| `npm run verify` | **exit 0** |
| typecheck | green (`tsc --noEmit`) |
| lint | green (`eslint . --max-warnings 0`) |
| test files | **164** (accepted baseline 156; **+8**) |
| tests | **2361** (accepted baseline 2222; **+139**) |
| passed | **2361** |
| failed | **0** |
| skipped | **0** |
| focused S1L | **8 files, 139 tests, all green** |
| offline signing tests | ceremony, key input, role and key-id binding — `tests/release/ceremony.test.ts` |
| deterministic-build tests | `tests/release/candidate-determinism.test.ts` |
| rollout tests | `tests/release/deployment-dry-run.test.ts` |
| class-19 tests | `tests/release/class19-admission.test.ts` |
| vulnerable controls | **14 / 14 discriminate** |

**Baseline confirmed before any file was added:** `f37c032`, clean worktree, gate 89/0, seeds
58/58, `npm run verify` exit 0 at 156 files / 2222 tests / 2222 passed / 0 failed / 0 skipped.

---

## 19. Scope

| | |
|---|---|
| real HTTP | **NO** |
| provider credentials | **NO** |
| provider call | **NO** |
| provider SDK | **NO** |
| reconciliation | **NO** |
| network signing service | **NO** |
| architecture modified | **NO** |

---

## 20. Remaining obligations

| Obligation | Status |
|---|---|
| **actual owner production ceremony** | **NOT PERFORMED.** Outside the repository. Production needs three things this repository cannot supply: the two root public keys, the expected manifest identity, and a package signed by keys a human owner actually holds |
| **class-19 key migration** (`50 §3i`) | **OPEN**, follow-on, not a pre-live blocker. The widening capability is closed; the key is still caller-supplied and can now only refuse |
| **residual 12** — 22 older C/E conditions without discriminating seeds | **CARRIED FORWARD, UNCHANGED.** 58 of 89 conditions have seeds and all 58 discriminate. It is **not** true that all 89 are mutation-covered, and S1L did not spend scope on it |
| **residual 13** — test-database teardown | **REMAINS REPAIRED.** `47ae8e0`'s fix is in the baseline and the full suite is green on it |
| **`I17b`** external anchoring | **OPEN, S3.** Not a dependency of S1K or S1L |
| **real-provider `I36`** | **OPEN.** No sandbox, no adapter |
| **`I20`** provider-side comparison | **OPEN** |
| **`I8`** sweep | **OPEN, S4** |
| **provider idempotency / query primitive** | **OPEN** |
| **reconciliation** | **OPEN, S4** |
| **remaining signed classes** (1, 4–16, 18, 21–23, 25, 26) | **OPEN, S4.** They enter the manifest when their consumers do |
| **control-plane incident table** | **OPEN**, exactly as S1K left it. Integrity incidents go to the declared sink; no incident schema was invented as S1L scope creep |
| **human custody separation** | **NOT PROVED, and not provable here.** The repository proves two independent operations, two distinct keys, one candidate identity, and neither able to substitute for the other |
| *(observation, not S1L scope)* two baseline files carry a literal `NUL` byte | `src/kernel/enumeration/refundEnumeration.ts` and `docs/implementation/S1K-implementation-log.md`. Pre-existing, harmless to the build, and left untouched — changing accepted production source is outside this slice |

---

## 21. Recommended next slice

**S1M — provider sandbox enablement**, and only after owner review of this slice.
