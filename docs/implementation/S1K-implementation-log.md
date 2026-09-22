# S1K — Implementation log

**Branch `feature/s1k-control-artifact-integrity`, from `ad8a78e`.**

---

## 1. Baseline evidence

| Step | Result |
|---|---|
| `git rev-parse HEAD` before any edit | `ad8a78ea542ed346ee6e7098f47faf16a84ad48e` — **matches the required `ad8a78e`** |
| `git status --porcelain` before any edit | **empty** (clean) |
| Branch created | `feature/s1k-control-artifact-integrity` at `ad8a78e` |
| Architecture gate | `analysis/consistency-v1.3.py` → **`RESULT: 64 PASS / 0 FAIL`**, exit 0 |
| `npm run verify` | **exit 0 — 147 files, 2057 tests, 2057 passed, 0 failed, 0 skipped**; typecheck green, lint zero warnings |

Both Postgres containers (`acos-s1a-control:55432`, `acos-s1a-audit:55433`) healthy before
the run, so the integration suites ran against real PostgreSQL as the accepted baseline
requires.

---

## 2. Architecture read — what was inspected, in order

The mandate's `§1` requires the current v1.3.5 definitions be read before anything is
designed. Read in full:

| Source | For |
|---|---|
| `50-control-artifact-manifest.md` | the manifest, all 27 rows, `§3`'s mechanism, `§4`'s signer tiers, `§5`'s disclaimers |
| `34` ADR-025 + its v1.2 amendment | the decision, its alternatives and its reconsideration trigger |
| `phase2-v1.3-invariant-registry.md` `I19` | wording, enforcement column, halt semantics, test |
| `49-trusted-computing-base.md` `§2`, `§3.9`, `§3.10`, `§3.11` | the owner as root of trust, the CI/CD and migration principals |
| `30-observability-audit-and-escalation.md` `§5.1a`, `§5.3`, `§5.3a`, `§5.7.1`, `§6` | class 27's operands, `ACOS-JCS-1`, the row-kind orders, class 24's Ed25519 declaration, incident grading |
| `51-limits-fixture.md` `§1`, `§2.1`, `§2.3`, `§3.7`, `§3.8`, `§5.1` | classes 3, 17 and 27's declared values and their control-artifact notes |
| `37-acos-mvp-and-implementation-sequence.md` `§2` | S1's and S4's Build lists; `SEQ-01`, `SEQ-02` |
| `33 §2.5`, `29 §30`, `48 §7`, `23 B9`, `26 §11`, `28 §4`, `36 §13`/`§15` | the second factor, the threat row, the perimeter's own control-artifact note, B9 |
| `phase2-v1.3.2`/`.3`/`.4`/`.5-errata.md` and their verification docs | the four times a signature obligation moved, and `§7`'s residual register |

Implementation read:

| Source | For |
|---|---|
| `src/kernel/policy/policyArtifacts.ts` | S1D's Cedar load, the exact-set diff, `policySetDigest`, and its own record that signing is out of scope |
| `src/kernel/canonicalisation/constructorVersion.ts` | S1B's class-19 Ed25519 verifier and **its caller-supplied public key** |
| `src/kernel/canonicalisation/actionCatalogue.ts` | class 3's and class 17's content, co-resident |
| `src/kernel/mirror/degradedModeThresholds.ts` | class 3's approval floor and class 27's thresholds, co-resident |
| `src/db/migrations/0001__foundation.sql` | `window_registry` — class 17 as runtime rows |
| `src/db/migrations/0005`–`0013`, `src/audit/db/migrations/A0001`–`A0005` | the two PL/pgSQL `ACOS-JCS-1` implementations |
| `src/kernel/canonicalisation/canonicalBytes.ts` | the third `ACOS-JCS-1` implementation, and the `canonicalBytes(kind, …)` domain framing |
| `src/kernel/gateway/*`, `src/kernel/exposure/stepR.ts` | where a pre-claim gate would sit, and where class 17's units are read |

---

## 3. The inventory the mandate's `§4` requires

Produced from `50 §2` and the repository, not from the mandate's list. **Nothing was signed
mechanically because the mandate named it; each row was checked against the current
manifest.**

| Class | Artifact identifier | Current version | Canonical/content bytes | Current content hash | Loader | Runtime consumers | Signature present? | Algorithm declared? | Trusted owner key identity | Would mutation alter authority? |
|---|---|---|---|---|---|---|---|---|---|---|
| **2** (Cedar / `O4`) | `acos.cedarschema` + `policies/*.cedar` | `policy_version` digest, no declared version string | **Declared by the implementation** — `canonicalHash('acos.policy_set.v1', …)`, length-framed over schema then `(id, source)` in sorted id order | `47c2849b41bd0bdf433e75d7cf75b45f3133d93183c8fd447606ce1017c30ff6` | `loadPolicyArtifacts()` | `cedarEngine.ts` → `authorise.ts` step M | **NO** | **NO** | **undeclared** | **YES** — it is every authorisation decision |
| **3** (action catalogue) | none declared | none declared | **not computable — `S1K-C6`** (open prose list; co-resident with class 17 in `actionCatalogue.ts` and with class 27 in `degradedModeThresholds.ts`) | **not computable** | frozen TS literals; no loader | `authorise.ts`, `stepR.ts`, `dispatchPrecedence.ts`, `refundCreate.ts`, `enumerateEffects.ts` | **NO** | **NO** | **undeclared** | **YES** — recoverability, `value_direction`, the outbox scope predicate, the `$20.00` degraded approval floor |
| **17** (named exposure windows) | none declared | none declared | **not computable — `S1K-C7`** (per-company runtime rows in `window_registry`; declared table is 7 classes, deployed catalogue is 4) | **not computable** | DB rows, written at runtime | `ledger.ts`, `stepR.ts`, `boundaryReReservation.ts`, `standingCap.ts` | **NO** | **NO** | **undeclared** | **YES** — every ceiling, and `51 §2.3`'s MIE unit counts |
| **20** (`ACOS-JCS-1`) | `ACOS-JCS-1` (named) | in the name | **no artifact exists — `S1K-C8`** (three conforming implementations + architecture prose) | **not computable** | n/a | both journal chain triggers; `canonicalBytes.ts`; every hash-bearing structure | **NO** | **NO** | **undeclared** | **YES** — it defines what the integrity machinery hashes |
| **27** (degraded-mode thresholds) | none declared | none declared | **not computable — `S1K-C6`(c)** (co-resident with class-3 content in one module) | **not computable** | frozen TS literal | `degradedModeThresholds.ts` → `mirrorStateMachine.ts`, `dispatchPrecedence.ts` | **NO** | **NO** | **undeclared** | **YES** — `PT15M` raises `AUDIT_MIRROR_DEGRADED`; `PT30M` is the FULL-HALT POSTURE operand |
| **19** (constructors) — *not in this mandate, recorded for contrast* | `ConstructorVersionRecord.constructor_id` | `semantic_major` / `non_semantic_minor` | `canonicalBytes('acos.constructor_version_record.v1', …)`, every field but the signature | per-record | `ConstructorVersionResolver` | `registry.ts` → `refundCreate.ts` | **YES — Ed25519, real** | by analogy with `30 §5.3`, **not by an owner declaration** | **caller-supplied argument** — no keystore, no rotation, no revocation | **YES** |
| **24** (audit-plane public key) — *recorded for contrast* | the audit-plane key | — | — | — | `corroborationSignal.ts` | mirror state machine | **n/a — it IS a public key**, trusted because the manifest is owner-signed | **Ed25519, declared** (`30 §5.7.1`) | **the owner's — undeclared** | **YES** |

**Class 19 and class 24 are in the table on purpose.** Class 19 is the repository's only
working control-artifact signature verifier and its trust root is a constructor argument.
Class 24 is the only place v1.3.5 declares an algorithm, and it is a *different* signer whose
trust terminates on the owner key that has no declared provenance. Together they show the
gap is structural rather than a failure to find the right paragraph.

---

## 4. What was attempted, and where each attempt stopped

The mandate's sections were worked in order. Each stopped at a declared tripwire rather than
at a difficulty.

| Mandate section | Attempt | Stopped at |
|---|---|---|
| `§5` signature format | Locate the declared envelope | `50 §3` is a struct, not a signing input — `S1K-C1`, `S1K-C2`. `§5`: "**Do not guess.**" |
| `§6` domain separation | Put the class in the signed message "where architecture requires" | Architecture requires nothing — `S1K-C2` |
| `§7` owner trust root | Resolve `key_id` against a trusted configured/compiled/DB-bound set "according to architecture" | No such declaration; the manifest row has **no `key_id` field** — `S1K-C3`. `§41`: "**Do not invent a chain-of-trust model.**" |
| `§8`/`§9` offline signing | Build the minimal deterministic signing tool | A signing tool needs a signing message (`S1K-C2`) and content bytes (`S1K-C5`, `S1K-C6`) |
| `§10`–`§14` classes 3/17/20/27, Cedar | Compute each artifact's canonical content and sign it | `S1K-C5` through `S1K-C8` — three of the four have no computable content boundary and one has no artifact |
| `§16` runtime `I19` | Implement the declared runtime mechanism | `50 §3` declares the action and not the occasion — `S1K-C4`. `§16`: "**Do not invent a polling interval.**" |
| `§17` `VerifiedControlArtifact` | Construct only after successful hash + signature verification | The constructor's precondition is undefinable while `S1K-C1`–`C3` stand |
| `§18`/`§19` gates | Place the check before the `CLAIM` and before first authoritative use | Placement is the architecture's to declare — `S1K-C4` |
| `§40` manifest | Bind required classes, versions and signature requirement | The manifest's own protection is unclosed — `S1K-C9`. `§40` directs PARTIAL |
| `§41` bootstrap trust | Answer the root-of-trust question | Circular — `S1K-C3`. `§41` directs PARTIAL |

---

## 5. What was refused, and why refusal was the safer act

Five constructions were available and each was rejected as an invention rather than a
reading. They are listed because a reviewer should be able to see the road not taken.

1. **Ed25519 by analogy with class 24.** Rejected: class 24 is the audit plane's key and its
   trust terminates on the owner signature, so borrowing its algorithm downward inverts the
   dependency. (`S1K-C1`)
2. **A compiled-in owner public key.** Rejected: this is the chain-of-trust model `§41`
   prohibits inventing, and it would have made a PARTIAL look like a PASS.
3. **A signing message over `50 §3`'s adjacent row fields.** Rejected: plausible, and still
   an inference. (`S1K-C2`)
4. **Per-class content hashes over the existing `canonicalBytes` framing.** Rejected: the
   primitive is sound, but *which fields of each class it frames* is undeclared, and a
   signature over the wrong boundary certifies a set the architecture did not define and
   moves every `content_hash` again when the real boundary lands. (`S1K-C5`, `S1K-C6`)
5. **A hash-only integrity gate called `I19`.** Rejected: `§22` forbids the downgrade, and a
   hash comparison against a manifest with no declared trust root and no declared row-set
   protection is theatre. (`S1K-C9`)

**A sixth was available and is worth naming: writing `docs/architecture/v1.3.6/`.** Rejected
under `§44`, and consistent with this repository's precedent — S1J returned PARTIAL on
`S1J-C1`/`C2`/`C6`, and a separate architecture pass (`81c2939`) issued v1.3.5's `MIE-01`,
`SER-01`, `OBX-04` and `OBX-05` to close them. The implementation reports; the architecture
declares.

---

## 6. Changes made

| Path | Change |
|---|---|
| `src/**` | **NONE** |
| `tests/**` | **NONE** |
| `docs/architecture/**` | **NONE** |
| `docs/implementation/S1K-contract.md` | new |
| `docs/implementation/S1K-owner-clarifications.md` | new |
| `docs/implementation/S1K-implementation-log.md` | new (this file) |
| `docs/implementation/S1K-test-matrix.md` | new |
| `docs/implementation/S1K-result.md` | new |

`git diff ad8a78e...HEAD -- src tests docs/architecture` is **empty**, which is the
strongest single statement this log can make: **no unsigned fallback was added, no trust
root was invented, no verification was bypassed, and no network or vendor code exists.**
