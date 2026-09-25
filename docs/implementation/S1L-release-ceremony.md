# S1L — The control-artifact release and deployment ceremony

**Operating Spine v1.3, package issue `v1.3.6`, unmodified.** This document is the
operational procedure for producing and deploying a signed control-artifact release. It
describes what a human owner does; the repository's proof that the MECHANISM works is in
`S1L-result.md` and `S1L-test-matrix.md`.

> **THE REPOSITORY CANNOT PERFORM THIS CEREMONY.** It can prove the format, the tooling and
> the verification. Creating, holding, separating and backing up real owner private keys is
> an act two people take outside this repository, and nothing here is evidence that it
> happened.

---

## 0. What the ceremony produces, and why each part exists

| Output | What it is | Who needs it |
|---|---|---|
| `package/` | the DEPLOYABLE artifact package: the six class artifacts plus `manifest.json` | both planes |
| `candidate.json` | the reviewed, unsigned release identity | both custodians |
| `approvals/` | three approval records, each naming its signer's PUBLIC key id | the audit trail |
| `release-review.txt` | the deterministic human-review report | the approving owner |
| `deployment.json` | the three PUBLIC values `50 §3e` pins | whoever configures the planes |
| `release-metadata.json` | non-authoritative operator metadata | nobody downstream |

`50 §3e` pins exactly three things and they are all public:

1. `OWNER_ARTIFACT_ROOT_KEY` — the primary public key;
2. `OWNER_ARTIFACT_SECOND_FACTOR_KEY` — the second-factor public key;
3. `EXPECTED_ACTIVE_MANIFEST_ID` — the manifest identity this deployment intends to run.

---

## 1. Why the ceremony has THREE operations and not two

`50 §3d`'s manifest CORE carries, per entry, `primary_signature` **and**
`second_factor_signature`, and the manifest signature message binds `manifest_core_sha256`.

So `manifest_id` does not exist until both custodians have signed every artifact. One of the
two must therefore act twice. The order is:

```
  build            (no key)          -> candidate.json + package/ + release-review.txt
  approve-primary  (primary key)     -> approvals/primary-artifacts.json
  approve-second   (second key)      -> approvals/second-factor.json   [manifest_id exists]
  countersign      (primary key)     -> approvals/primary-manifest.json
                                        package/manifest.json
                                        deployment.json
```

**No command takes two private keys, and none exists that would.** The second custodian's
step is a separate invocation on a separate machine with a separate key; the primary's
countersignature confirms that the core assembled from both approvals is the candidate it
reviewed, and refuses otherwise.

---

## 2. Preparing the release input declaration

A declaration names the artifact SOURCES and the two PUBLIC keys. It contains no private
material and is safe to review, diff and archive.

```json
{
  "release_input_version": "ACOS-CONTROL-RELEASE-INPUT-V1",
  "manifest_epoch": "1",
  "release_channel": "PRODUCTION",
  "primary_public_key": "<64 lowercase hex — 32 RAW Ed25519 public-key bytes>",
  "second_factor_public_key": "<64 lowercase hex>",
  "artifacts": [
    {
      "artifact_class": 2,
      "artifact_id": "acos.control.policy_set",
      "artifact_version": "acos.policy_set.2026-09-24",
      "package_file_name": "class-02.policy-set.json",
      "source_path": "sources/class-02.policy-set.json"
    },
    { "artifact_class": 3,  "artifact_id": "acos.control.action_catalogue",     "artifact_version": "…", "package_file_name": "class-03.action-catalogue.json",     "source_path": "sources/class-03.action-catalogue.json" },
    { "artifact_class": 19, "artifact_id": "acos.control.effect_constructors",  "artifact_version": "…", "package_file_name": "class-19.effect-constructors.json",  "source_path": "sources/class-19.effect-constructors.json" },
    { "artifact_class": 20, "artifact_id": "acos.control.jcs1_specification",   "artifact_version": "ACOS-JCS-1", "package_file_name": "class-20.acos-jcs-1.spec.v1.txt", "source_path": "sources/class-20.acos-jcs-1.spec.v1.txt" },
    { "artifact_class": 24, "artifact_id": "acos.control.audit_signing_key",    "artifact_version": "…", "package_file_name": "class-24.audit-signing-key.json",    "source_path": "sources/class-24.audit-signing-key.json" },
    { "artifact_class": 27, "artifact_id": "acos.control.degraded_mode_config", "artifact_version": "…", "package_file_name": "class-27.degraded-mode-config.json", "source_path": "sources/class-27.degraded-mode-config.json" }
  ]
}
```

`source_path` is relative to the declaration file's own directory, so a declaration plus its
sources is a self-contained, relocatable input set. **No absolute path, clock, host name or
process value ever reaches a release identity.**

**The set is CLOSED.** A missing class, a duplicate class, a class outside `50 §6`'s six, a
resurrected class 17, two artifacts competing for one package file name, or an artifact whose
own bytes declare a different version — each is a refusal, not a warning.

**Class 24 is produced by the deployment, not by this repository.** `50 §2` row 24's content
is the audit host's published verifying key. The audit host generates its key pair, publishes
the public half, and the release includes it as an artifact.

---

## 3. Build the candidate — no private key required

```bash
npx tsx tools/control-release/cli.ts build --input ./release-input.json --out ./release-r7
```

This reads the declared sources, enforces the closed set, hashes each artifact's EXACT bytes,
assembles the entries in `50 §3d`'s declared order, computes the candidate identity, writes
the deployable package and renders the review report.

`candidate_id` is a **review identity only**. It is not `manifest_id`, it is never
`EXPECTED_ACTIVE_MANIFEST_ID`, and no runtime reads it. Its job is to let two custodians
confirm they are approving the same thing before either signs.

---

## 4. Review — before any signature exists

```bash
npx tsx tools/control-release/cli.ts review --release ./release-r7
```

The report prints, for every artifact: class, id, version, `SHA-256` and byte length; and it
decodes the authority-relevant content:

* **class 3** — all ten of `50 §2a`'s per-class fields for every action class, PLUS the
  external-dispatch consequence derived from `adapter` (`50 §2f`: `adapter = internal_only`
  removes an effect from the outbox entirely), plus the four catalogue-level records;
* **class 27** — `50 §2c`'s exactly four static quantities, and anything present beyond them;
* **class 20** — the specification's version, digest, byte count, and whether it carries a
  `0x0D` byte (a CRLF copy is a DIFFERENT artifact);
* **class 2** — the signed `content_hash` AND `policy_version`, printed separately and
  labelled, plus the schema digest and a per-policy-file inventory;
* **class 19** — every constructor record the artifact declares;
* **class 24** — the published key id. Public by definition.

To see what moved since the last release:

```bash
npx tsx tools/control-release/cli.ts compare --before ./release-r6 --after ./release-r7
```

**The tools report. They do not approve.** Neither produces a verdict about whether a change
is safe, and neither has an exit code that means "approved".

---

## 5. Primary owner approval

The primary custodian reviews the report, confirms `candidate_id`, and signs:

```bash
npx tsx tools/control-release/cli.ts approve-primary \
  --release ./release-r7 --key-file /media/primary-custodian/owner-primary.pk8
```

* the key is read from the **explicitly named path** and from nowhere else. There is no
  default path, no search path, no home-directory lookup and no environment variable;
* the tool refuses if the supplied key's `key_id` is not the candidate's
  `expected_primary_key_id`. Signing the wrong candidate produces a DIFFERENT release, not a
  repaired one;
* no artifact byte, version, order or identity is changed. `candidate.json` is never
  rewritten after `build`;
* no key material is copied into the release, echoed, logged or persisted.

Hand over the **release directory**. Never the key.

---

## 6. Second-factor approval — a separate custodian, a separate machine

```bash
npx tsx tools/control-release/cli.ts approve-second \
  --release ./release-r7 --key-file /media/second-custodian/owner-second.pk8
```

The second custodian re-derives everything rather than trusting the first: each artifact's
digest is recomputed from the package bytes, `candidate_id` is recomputed from the candidate's
own fields, and the primary's approval is checked to be FOR THAT IDENTITY. The step refuses if

* the package no longer computes the reviewed candidate identity;
* the primary's approval names a different candidate;
* the primary's approval was produced under a key that is not the candidate's expected one;
* **the second-factor key is the same key that produced the primary approval.**

`50 §3a`: *"A second signature produced under the primary key does not satisfy the
second-factor requirement, whatever its `signer_role` claims."*

This step is where `manifest_id` first exists. Record it.

---

## 7. Primary countersignature — and the release completes

```bash
npx tsx tools/control-release/cli.ts countersign \
  --release ./release-r7 --key-file /media/primary-custodian/owner-primary.pk8
```

The primary rebuilds the core from ITS OWN step-5 signatures plus the second custodian's, and
refuses if the result is not the identity the second custodian signed. A second custodian who
silently changed an artifact, a version, an order or a digest produces a core the primary
cannot reproduce, and the ceremony stops.

On success it writes `package/manifest.json` and `deployment.json`.

**From here the release directory is IMMUTABLE.** Any byte change — including whitespace —
requires a new candidate, a new identity, new signatures from both custodians and an explicit
deployment pin update. There is no signature carry-forward for a "semantically equivalent"
release.

---

## 8. Independent verification, before anything is deployed

```bash
npx tsx tools/control-release/cli.ts verify --release ./release-r7 \
  --primary-key <64 hex> --second-factor-key <64 hex>
```

It recomputes every artifact digest from the package bytes, rebuilds the core, recomputes
`manifest_id`, and verifies all fourteen signatures (six artifacts × two, plus the manifest's
two) against the **externally supplied** public keys. The manifest's declared key ids are
checked AGAINST those keys and never used to select them.

> **This does not replace runtime bootstrap verification.** A plane becomes READY only by
> running `50 §3f` occasion 1 itself, against its own pin.

---

## 9. Deployment — each plane through its own trust boundary

`deployment.json` carries the three public values under each plane's own variable names.

**Control plane**

| Variable | Value |
|---|---|
| `ACOS_OWNER_ARTIFACT_ROOT_KEY` | the primary public key, 64 lowercase hex |
| `ACOS_OWNER_ARTIFACT_SECOND_FACTOR_KEY` | the second-factor public key |
| `ACOS_EXPECTED_ACTIVE_MANIFEST_ID` | this release's `manifest_id` |
| `ACOS_CONTROL_ARTIFACT_ROOT` | the control plane's OWN copy of `package/` |

**Audit plane**

| Variable | Value |
|---|---|
| `ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY` | the primary public key |
| `ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY` | the second-factor public key |
| `ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID` | this release's `manifest_id` |
| `ACOS_AUDIT_CONTROL_ARTIFACT_ROOT` | the audit plane's OWN copy of `package/` |

**The values are equal and the PROVENANCE is not.** `50 §3` property 2: *"A manifest check run
only by the control plane is a check the control plane can pass by lying."* The audit plane
must never be configured by reading the control plane's configuration, and the runtime offers
no path for it to do so.

---

## 10. Activation order

1. copy `package/` to **both** planes, each into its own artifact root;
2. set `EXPECTED_ACTIVE_MANIFEST_ID` to the new `manifest_id` on **both** planes'
   configurations, through each plane's own trusted deployment mechanism;
3. restart / reload the control plane; confirm it becomes READY on the new manifest;
4. restart / reload the audit plane; confirm it verifies its own copy;
5. run the readiness gate and confirm both planes report the SAME manifest identity:

   ```bash
   npx tsx tools/prelive/cli.ts
   ```

6. only when the gate reports `READY_FOR_PROVIDER_SANDBOX_CONFIGURATION` may a later slice
   begin provider-sandbox configuration.

**No vendor adapter is enabled by this procedure, and none exists to enable.**

### Mid-rollout is a real state, and the gate names it

If the control plane is on R2 and the audit plane is still on R1, each plane verifies its own
pinned package correctly and the gate reports `PLANES_ON_DIFFERENT_RELEASES` and `NOT_READY`.
That is a finding about coherence, not a claim that either verification failed. Finish the
rollout.

---

## 11. Failed deploys — READY ON THE OLD RELEASE is not ACTIVATED

If a reload fails — a wrong pin, a wrong key, a corrupted or incomplete package, a stale
signature, a revived class 17 — the plane **fails closed on the candidate** and the previously
verified bundle remains active.

> **A process that is READY on the OLD release has NOT activated the new one.** Read
> `activeManifestId()` and compare it to the release you intended. Never report a failed
> reload as a successful deployment.

---

## 12. Rollback

Rollback is **not** "the runtime accepts an older signed manifest". `50 §3e`: *"THE HIGHEST
EPOCH FOUND ON DISK IS NOT ROLLBACK PROTECTION AND IS NOT USED."*

To roll back to R1:

1. deliberately change `EXPECTED_ACTIVE_MANIFEST_ID` to **R1's** `manifest_id` on both planes'
   trusted deployment configurations;
2. deploy **R1's** package to both planes;
3. restart and re-bootstrap;
4. re-run the readiness gate and confirm both planes report R1.

Copying R1's package back without changing the pin is refused, and the running plane keeps
R2. v1.3.6 declares no prohibition on backwards epoch movement under an explicit pin, and none
is invented here: `manifest_epoch` is recorded "for lineage and for operator legibility" and
the PIN is what decides.

---

## 13. Private-key handling

`50 §3a`: *"Production signing is an offline release ceremony."* `50 §3a` deliberately names
**no HSM and no vendor**, and neither does this document or the tooling.

* the tool accepts a PKCS#8 Ed25519 private key from an **explicitly named path**;
* it never searches, never defaults, never reads an environment variable for key material,
  never writes a key into the release, never echoes or logs key bytes, and never persists an
  imported key;
* **it makes no secure-deletion guarantee**, because a normal filesystem cannot provide one;
* the seed-based constructor in `signerKey.ts` is named `testOnlySignerFromSeed`, is not wired
  to any command-line flag, and exists for the test suite.

An operational ceremony should keep each private half on separate owner-controlled media, in
separate custody, and should never bring both into one process or onto one machine. The
tooling cannot enforce that and does not pretend to.

---

## 14. What this ceremony does NOT prove

* that a signed artifact is **correct**. `50 §5`: the manifest proves the deployed artifact is
  the one the owner signed and says nothing about whether signing it was a good idea;
* that any implementation **conforms** to the class-20 specification. That is `36 §2`'s VC-A3
  and `I19` discharges none of it;
* that the Cedar policy set is **semantically** right;
* that **two humans** were involved. The repository proves two independent signing operations
  under two distinct keys over one candidate identity, with neither able to substitute for the
  other. Custody is operational evidence, outside this repository.
