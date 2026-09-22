# S1K — Result

**VERDICT: PARTIAL.**

**Baseline `ad8a78e` (S1J ACCEPTED). Branch `feature/s1k-control-artifact-integrity`.
Package issue `v1.3.5`, unmodified. Architecture gate 64/64.**

**NO REAL HTTP. NO REAL ADAPTER. NO VENDOR CREDENTIAL. NO PROVIDER SANDBOX. NO
RECONCILIATION.**

---

## 0. The one-paragraph version

S1K is the pre-live re-evaluation that S1I and S1J made mandatory. **Its finding is that the
owner control-artifact signing mechanism cannot be implemented against v1.3.5, because
v1.3.5 declares the obligation and not the mechanism.** The signature has no declared
algorithm and no declared signing message; the trusted owner verification key has no
declared provenance, which makes the root of trust circular; `I19`'s "continuous" has no
declared occasion or cadence; and — newly found by reading the manifest against the
implementation — three of the four named classes have **no computable content boundary**,
one of them has **no artifact at all**, and the second factor that `50 §4` requires on every
artifact in this mandate has no declared mechanism. **No production code was written, and
nothing was invented.** The pre-live gate stays shut.

---

## 1. What "PARTIAL" means here, precisely

The mandate's `§47`:

> **PARTIAL** if the root-of-trust or continuous-`I19` semantics are genuinely unspecified.
> **FAIL** if an unsigned/tampered artifact can influence an authority decision or mock
> dispatch.

Both PARTIAL conditions hold, and the FAIL condition **also holds as a statement about the
system** — an unsigned, tampered class-3, 17, 20 or 27 artifact *can* influence authority
today, exactly as it could at `ad8a78e`. **S1K did not make that worse and did not make it
better.** It is reported as PARTIAL rather than FAIL because the FAIL criterion is about a
control S1K built and failed to make sound; S1K built no control, and the pre-existing
exposure is the accepted, documented state of the baseline
(`phase2-v1.3.5-errata.md §7`: "Runtime `I19` — **OPEN**").

**This distinction is the whole point of the pre-live gate and must not be read past:** the
system is not safe to connect to a provider, and S1K's contribution is to say exactly why in
terms an architecture pass can act on.

---

## 2. Baseline

| | |
|---|---|
| Required HEAD | `ad8a78e` |
| Actual HEAD at start | `ad8a78ea542ed346ee6e7098f47faf16a84ad48e` — **match** |
| Worktree at start | **clean** |
| Branch | `feature/s1k-control-artifact-integrity` |
| Architecture package | `docs/architecture/v1.3.5/`, **unmodified** |
| Architecture gate at baseline | **64 PASS / 0 FAIL** |
| Architecture gate after | **64 PASS / 0 FAIL** |
| Retained seeds | **all 29 re-run; every one still fails its intended conditions, at the exact PASS/FAIL counts `phase2-v1.3.5-verification.md` records** |
| `src/` and `tests/` vs `ad8a78e` | **byte-identical** |

---

## 3. Artifact inventory

`policy_version` is a real computed value. The remaining content hashes are **not computable
at v1.3.5** and the reason is stated rather than a hash being manufactured.

| Class / artifact | Version | Hash | Signature | Signer / key | Runtime consumer |
|---|---|---|---|---|---|
| **2 — Cedar policy set (`O4`)** | none declared; `policy_version` digest stands in | `47c2849b41bd0bdf433e75d7cf75b45f3133d93183c8fd447606ce1017c30ff6` (`canonicalHash('acos.policy_set.v1', …)`, implementation-declared) | **ABSENT** | **undeclared** | `cedarEngine.ts` → `authorise.ts` step M |
| **3 — action catalogue** (incl. the `$20.00` degraded approval floor) | none declared | **not computable — `S1K-C6`** | **ABSENT** | **undeclared** | `authorise.ts`, `stepR.ts`, `dispatchPrecedence.ts`, `refundCreate.ts`, `enumerateEffects.ts` |
| **17 — named exposure windows** (incl. `51 §2.3` MIE units) | none declared | **not computable — `S1K-C7`** (per-company runtime rows) | **ABSENT** | **undeclared** | `ledger.ts`, `stepR.ts`, `boundaryReReservation.ts`, `standingCap.ts` |
| **20 — `ACOS-JCS-1`** | in the name | **no artifact exists — `S1K-C8`** | **ABSENT** | **undeclared** | both journal chain triggers; `canonicalBytes.ts` |
| **27 — degraded-mode thresholds** (`PT15M`, `PT30M`) | none declared | **not computable — `S1K-C6`(c)** | **ABSENT** | **undeclared** | `mirrorStateMachine.ts`, `dispatchPrecedence.ts` |
| *19 — constructors (contrast)* | `semantic_major`/`non_semantic_minor` | per-record over `acos.constructor_version_record.v1` | **PRESENT — real Ed25519** | **caller-supplied `KeyObject` argument; no keystore, no rotation, no revocation** | `registry.ts` → `refundCreate.ts` |
| *24 — audit-plane public key (contrast)* | — | — | n/a (it **is** a public key) | Ed25519 **declared** — but the **audit plane's**, trusted only because the owner signature is the root above it | `corroborationSignal.ts` |

**Cedar / `O4` is listed separately above and is reported separately in `§11`.**

---

## 4. Root of trust

| Question | Answer |
|---|---|
| Trusted key source | **UNDECLARED.** `49 §3.9` and `50 §5` say the owner *is* the root of trust and that owner compromise is out of scope. Neither states how a running process obtains the public half |
| Private key location | **UNDECLARED.** `phase2-v1.3.5-errata.md §7`: "Production key management — **OPEN**" |
| Runtime private key required? | **NO** — and nothing was added that would need one |
| Trust-on-first-use? | **NO** — none was added |
| Circular dependency? | **YES.** The manifest is trusted because it is owner-signed; the owner signature is trusted because the key is the owner's; nothing says which key that is. **This is the mandate's `§41` tripwire and it is why S1K is PARTIAL** |
| Rotation status | **NOT SPECIFIED, AND NOT INVENTED.** `§26` permits rotation only if v1.3.5 defines it; it does not. Reported as future work |

**The mandate's `§41` question, answered directly:**

> What is the ultimate trust root that tells the runtime which artifact hashes/versions/
> signers are trusted?

**At v1.3.5 there is no answer.** `§41` lists the three admissible roots — a compiled/pinned
owner public key, separately provisioned trusted configuration, or a signed root manifest
under a pinned key — and the package declares none of them. Class 24 shows the architecture
knows how to terminate such a chain when a root exists above it; **there is no equivalent for
the owner's own key, and a class-24-shaped answer for it would be the circle itself.**

---

## 5. Signature message

| | |
|---|---|
| Algorithm | **UNDECLARED** (`S1K-C1`). Ed25519 is declared once, for the **audit plane's** key (`30 §5.7.1`, class 24) |
| Domain separator | **UNDECLARED** (`S1K-C2`). *The primitive exists*: `canonicalBytes(kind, …)` emits the kind string as the first length-framed field, so a declared control-artifact kind would be non-substitutable by construction |
| Artifact class | present as a **row field** in `50 §3`; **not declared to be in the signed message** |
| Artifact id | present as a row field; same |
| Version | present as a row field; same |
| Content hash | present as a row field; same — **and `50 §3` property 1's "canonicalised content" names no canonicalisation for control artifacts** (`S1K-C5`) |
| Independent oracle | **not written.** There is no declared framing to reproduce. The pattern is proven in this repository — `tests/support/jcs1Oracle.ts`, `canonicalisationOracle.ts` |
| Cross-class substitution | **not tested.** No production envelope exists to attack |

---

## 6. Runtime `I19`

| | |
|---|---|
| Startup verification | **NOT IMPLEMENTED, AND THE OCCASION IS UNDECLARED** (`S1K-C4`) |
| First-authoritative-use verification | same |
| Pre-claim / pre-dispatch gate | same. `§18` asks whether the gate can run before the irreversible `CLAIM`; `50 §3` does not place it, so S1K did not place it |
| Backing-store tamper | **not addressed.** For class 17 the backing store is a runtime table (`S1K-C7`), which changes the shape of the answer and is itself undeclared |
| Fail-closed behaviour | **not implemented** |
| Incident | `50 §3` and `30` declare it fully — CRITICAL, journaled, a **security** incident — and it is the one leg of `I19` that needs no further declaration |

`50 §3` writes `I19 (continuous):` over a three-line loop and the registry writes
`CI + RUNTIME + SCHED`. That declares the **action** and not the **occasion**, and `§16`
directs `RETURN PARTIAL` on exactly that.

---

## 7. Class 3

| | |
|---|---|
| Signed | **NO** |
| Tamper attacks (`$20.00 → $25.00`; operand `total_exposure` → vendor amount; signature removed; wrong owner; stale bytes) | **not run** — no signature exists to attack, and the class's content boundary is undeclared (`S1K-C6`) |
| S1H regression | **green and unchanged.** `$20` floor boundaries, the strict `>` comparison, `total_exposure` as the operand, VC-A2 inversion — all unmodified |

**Disclosed:** class 3's declared content is an **open prose list** ("incl. …") and six
authority-bearing `ActionCatalogueEntry` fields are of undeclared membership — including
`adapter`, from which `requiresExternalDispatchFor` derives `I66`'s outbox scope predicate.
And class 3's approval floor shares a module with class 27's thresholds.

---

## 8. Class 17

| | |
|---|---|
| Signed | **NO** |
| MIE tamper (IRRECOVERABLE `1 → 0`; non-IRRECOVERABLE `0 → 1`; implicit default; class remap) | **not run** |
| S1J regression | **green and unchanged.** Step-R reservation, the final-unit race, `reserved → presumed`, `NOT_SENT` release, the historical `I20` denominator |

**Disclosed, and new:** class 17's content is **per-company rows in `window_registry`,
written at runtime**, and `50 §3`'s manifest is a deploy-time artifact set with a signing
ceremony. Nothing declares how a runtime row joins it, or who signs a window created after
the ceremony. Separately, `51 §2.3`'s class-17 table declares **seven** action classes while
the deployed catalogue carries **four**, and it is not declared which is the signed content.

**The catalogue's own coherence check still runs** — `actionCatalogue.ts` throws at module
load if any IRRECOVERABLE class declares `< 1` or any REVERSIBLE/COMPENSABLE class declares
`≠ 0`. **That is a conformance assertion, not an integrity control**: it catches an
inconsistent edit and passes a consistent malicious one.

---

## 9. Class 20

| | |
|---|---|
| Signed | **NO** |
| `ACOS-JCS-1` tamper (old NULL sentinel; field swap; removed row kind; framing rule; format identity) | **not run** |
| Field-order attack | **not run against a signature.** It *is* run against the architecture corpus — `--seed-swap-outcome-fields` and `--seed-old-null-sentinel` both still fail, at 63/1 and 59/5 |
| VC-A3 regression | **green and unchanged** |

**Disclosed, and new:** **class 20 has no artifact to sign.** Its content is the
specification, which exists in this repository as three conforming production
implementations — control PL/pgSQL, audit PL/pgSQL, and `canonicalBytes.ts`, which calls
itself "a THIRD production implementation of `30 §5.3`" — and as prose in the architecture
package. `50 §3` property 2 requires the **audit plane to recompute the same hash from its
own copy**, and its copy is a different implementation of the same spec, which does not hash
alike by construction. **This is why the class-20 signature has been owed since v1.3.2, has
been enlarged three times, and has never been dischargeable.**

---

## 10. Class 27

| | |
|---|---|
| Signed | **NO** |
| Threshold tamper (`PT15M → PT60M`; `PT30M → PT5M`; swap; strip; untrusted signer) | **not run** |
| Mirror regression | **green and unchanged.** `PT15M` lag, `PT30M` full halt, the inclusive boundaries, the `PT30M > PT15M` arithmetic assertion |

**Disclosed:** class 27's two quantities and class 3's approval floor are three exports of
one module with two different signed classes and the same "All effects" halt scope, and no
declared boundary between them (`S1K-C6`(c)).

---

## 11. Cedar `O4`

| | |
|---|---|
| Signed artifact | **NO** |
| Digest | **YES, and independently recomputed at every load** — `47c2849b41bd0bdf433e75d7cf75b45f3133d93183c8fd447606ce1017c30ff6`, over a length-framed structure so a policy id renamed into another's text cannot hold the digest still |
| Trusted signer | **none — undeclared** |
| Wrong signer rejected | **not testable** — no verification exists |
| Modified policy | **DETECTED as a digest change, and the exact-set diff fails closed on a missing, unexpected or duplicate artifact.** It is **not** authenticated: an attacker who edits the policy and the code that records the digest is not caught |
| Exactly one Cedar path | **YES — verified.** One `cedar.isAuthorized` call in `src/`, `cedarEngine.ts:79`, and `preReservation.ts` asserts the property structurally |
| **`O4` status** | **OPEN — UNCHANGED FROM S1D.** Not closed, not partially closed |

**`O4` is reported alone, as `§43` requires.** It is not conflated with Cedar policy
correctness (unchanged and green), with symcc (deferred, `45 §3`), with rotation (undeclared)
or with `I19` overall.

**`§22`'s specific warning is honoured by inaction:** Cedar has not "reverted to the S1D
pre-`O4` hash-only state", because it never left it. No signature path was added that could
silently downgrade.

---

## 12. Vulnerable controls

| Attack | Vulnerable | Production | Discriminates? |
|---|---|---|---|
| all twelve of `§39` | **not written** | **does not exist** | **N/A — no control is claimed** |

**Zero vulnerable controls are claimed.** `§39` requires every counted control to
discriminate; a control cannot discriminate against a production mechanism that does not
exist, and writing one against an invented mechanism would manufacture a result that proves
nothing. The full twelve-row specification, each with its precise blocker, is in
`S1K-test-matrix.md §1`.

---

## 13. Pre-live gate

| | |
|---|---|
| Invalid artifact effect on enqueue/claim | **NONE — there is no integrity gate.** This is the accepted baseline's state, unchanged |
| Claim created? | unchanged behaviour: a claim is created when authority permits, with no artifact-integrity precondition |
| Mock adapter called? | unchanged |
| Economic state | unchanged — every S1F/S1J reservation and MIE property holds |
| Real provider allowed? | **NO.** No HTTP, no adapter, no credential, no SDK anywhere under `src/` |

**The gate itself:**

> No later slice may enable a real external effect until the owner/control-artifact signing
> and integrity sequencing has been re-evaluated against the then-current architecture.

**S1K is that re-evaluation, and it does not clear the gate.** The gate remains shut, and the
reason has changed from "not yet built" to **"cannot be built against v1.3.5, for ten stated
reasons."**

---

## 14. `I19` / `O4` status, broken apart exactly

`§42` requires `I19` be split by leg and that no leg be called CLOSED while a normatively
required part is unimplemented.

| `I19` leg | Status | Why |
|---|---|---|
| **Integrity identity / content hash** | **OPEN** | `50 §3`'s "canonicalised content" names no canonicalisation for control artifacts (`S1K-C5`), and three of four classes have no computable content boundary (`S1K-C6`–`C8`). Cedar has an implementation-declared digest; that is one class out of five and it is not the declared mechanism |
| **Owner-signature verification** | **OPEN** | No declared algorithm (`S1K-C1`), no declared signing message (`S1K-C2`), no declared key provenance (`S1K-C3`), no second-factor evidence (`S1K-C10`) |
| **Runtime pre-use verification** | **OPEN** | The occasion is undeclared (`S1K-C4`) |
| **Continuous / live-mutation behaviour** | **OPEN** | "continuous" has no cadence (`S1K-C4`); for class 17 the backing store is a runtime table (`S1K-C7`) |
| **Independent audit-plane recomputation** (`50 §3` property 2) | **OPEN, and blocked beyond the others** | The audit plane's copy of class 20 is a **different implementation of the same specification** and cannot hash alike (`S1K-C8`) |
| **Incident behaviour** | **DECLARED, NOT IMPLEMENTED** | `50 §3` and `30` declare it completely — CRITICAL, journaled, a security incident. It is the only leg needing no further declaration, and there is nothing to raise it from |
| **Manifest / required-class-set integrity** | **OPEN** | Per-row signatures do not protect the row set; `50 §5` defers it to external anchoring, which is `I17b` at **S3** (`S1K-C9`) |
| **Production trust-root provisioning** | **OPEN** | `phase2-v1.3.5-errata.md §7`: "Production key management — OPEN" |

**`I19` overall: OPEN. Not one leg is CLOSED.**

| `O4` | Status |
|---|---|
| Owner signature verification of the active Cedar artifact | **OPEN — UNCHANGED FROM S1D** |

---

## 15. Verification

| | |
|---|---|
| Architecture gate | **64 PASS / 0 FAIL**, exit 0 — before and after |
| Retained seeds | **29 / 29 still fail their intended conditions**, at the counts `phase2-v1.3.5-verification.md` records |
| `npm run verify` | **exit 0** — `typecheck` green, `lint` zero warnings (`--max-warnings 0`), `test` green |
| Test files | **147** |
| Tests | **2057** |
| Passed | **2057** |
| Failed | **0** |
| Skipped | **0** |
| Duration | 3455s, against the two real PostgreSQL instances |
| `.only` | **none** |
| Focused S1K suites | **none — no S1K test was written.** `S1K-test-matrix.md` records the owed set and each member's blocker |
| Signature vector tests | **none** |
| Runtime tamper tests | **none** |
| Vulnerable controls | **none claimed** |

---

## 16. Scope

| | |
|---|---|
| Real HTTP | **NO** |
| Real adapter | **NO** |
| Provider sandbox | **NO** |
| Real credentials | **NO** |
| Reconciliation | **NO** |
| Architecture package edited | **NO** — `git diff ad8a78e...HEAD -- docs/architecture` is empty |
| Production code edited | **NO** — `git diff ad8a78e...HEAD -- src tests` is empty |
| Private signing key committed | **NO** |

---

## 17. Remaining obligations

Carried forward, unchanged unless noted.

| Obligation | Status |
|---|---|
| Real-provider `I36` validation (six kill points against a real ESP sandbox) | **OPEN** |
| Provider adapter / capability measurement | **OPEN** |
| Provider idempotency / query primitive | **OPEN** |
| `I20` provider comparison | **OPEN** |
| `I8` inverse sweep | **OPEN** |
| Delivery reconciliation | **OPEN** |
| Class 3 signature | **OWED** |
| Class 17 signature | **OWED** |
| Class 20 signature | **OWED, and undischargeable until `S1K-C8` is declared** |
| Class 27 signature | **OWED** |
| Runtime `I19`, all legs | **OPEN** |
| `O4` | **OPEN** |
| Production signing-key provisioning | **OPEN** |
| **`S1K-C1` … `S1K-C10` — ten normative omissions** | **NEW, BLOCKING.** Four (`C6`, `C7`, `C8`, `C10`) are not in `phase2-v1.3.5-errata.md §7`'s register |
| `VC-C3` external execute span | **PARTIAL**, carried |
| `mirror_declaration.opened_at` DDL-principal residual | carried, unchanged |
| Two Postgres containers on one machine ≠ separate operator domains | carried, unchanged |

---

## 18. What the next pass needs

Not a slice name — a list, because `§50 §18` asks for a name and the honest answer is that
the name depends on the owner's decision here.

**S1K's ten clarifications are a specification for an architecture pass**, in the same shape
`S1J-C1`/`C2`/`C6` were before v1.3.5's `MIE-01`, `SER-01`, `OBX-04` and `OBX-05` closed
them. The minimum an erratum would have to declare:

1. the owner signature's **algorithm** and wire representation, as the owner's;
2. the **signing message** — fields, order, framing, domain separator;
3. the **trusted owner key's provisioning**, non-circular;
4. `I19`'s **occasion** and, for any scheduled leg, its cadence;
5. a **canonicalisation for control-artifact content**, with class 20 given a
   representation that does not depend on class 20;
6. each class's **closed content field list**, and the split where one module carries two
   classes;
7. how **class 17's per-company runtime rows** participate in a deploy-time manifest, and
   whether the signed table is the declared seven or the deployed four;
8. what **class 20's deployed artifact is**, given three conforming implementations and
   `50 §3` property 2's independent-recomputation requirement;
9. the **manifest's own integrity** and the protection of the required-class set;
10. the **second factor's** mechanism and its verifier-visible evidence, or an explicit
    statement that it is ceremony-only and unverifiable at runtime.

**Until at least 1–5 are declared, no implementation can close `I19` or `O4` without
inventing the chain of trust, and no real external effect may be enabled.**
