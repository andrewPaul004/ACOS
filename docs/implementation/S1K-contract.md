# S1K — Contract

**Pre-live control-artifact signing and the runtime integrity gate.**

**Baseline `ad8a78e` (S1J ACCEPTED). Branch `feature/s1k-control-artifact-integrity`.
Package issue `v1.3.5`, unmodified.**

**NO REAL HTTP. NO REAL ADAPTER. NO VENDOR CREDENTIAL. NO PROVIDER SANDBOX.**

---

## 0. What S1K was asked to build

The mandate's `§2`:

> owner-approved artifact → canonical artifact identity → cryptographic signature →
> trusted owner public-key verification → runtime integrity validation → fail-closed
> pre-execution gate

with the end-state:

> **NO EXTERNAL-EFFECT CLAIM / MOCK DISPATCH COMPOSITION MAY PROCEED WHEN A REQUIRED
> CONTROL ARTIFACT IS MISSING, MODIFIED, UNSIGNED OR SIGNED BY AN UNTRUSTED OWNER KEY.**

over control-artifact classes 3, 17, 20, 27 and the Cedar policy artifact (class 2 / `O4`).

---

## 1. Verdict

**PARTIAL.**

**No production code changed. `src/` and `tests/` at HEAD are byte-identical to `ad8a78e`.**

S1K returns PARTIAL under the mandate's own tripwires — `§5` (signature envelope),
`§16` (continuous `I19`), `§40` (manifest recursion) and `§41` (root of trust), each of
which directs `RETURN PARTIAL` rather than a constructed answer — and it adds four
implementation-discovered omissions the architecture's own residual register does not
carry.

**The architecture package is unchanged. The architecture gate remains 64/64.**

---

## 2. What v1.3.5 DOES declare

Read in full before the omissions, because the omissions are only meaningful against it.

| # | Declaration | Source |
|---|---|---|
| D1 | Control artifacts are **owner-signed** and hash-verified against a manifest | ADR-025 |
| D2 | The manifest row is `{class, artifact_id, version, content_hash, signed_at, signature}` | `50 §3` |
| D3 | The hash is over **canonicalised content**, "not the file bytes" | `50 §3` property 1 |
| D4 | The **audit plane recomputes every hash independently** from its own copy | `50 §3` property 2 |
| D5 | **Halt scope is per class.** Classes 2, 3, 17, 20 and 27 all declare **"All effects"** | `50 §2`, `50 §3` property 4 |
| D6 | On mismatch: halt the class's halt scope, raise a **CRITICAL** incident, **journal the mismatch**; an `I19` failure is a **security** incident specifically | `50 §3`, `30 §6.1`, `30 §7` |
| D7 | Classes 1, 2, 3, 5, 15, 16, 17 and **19–27 require a second factor** | `50 §4` |
| D8 | Twenty-seven rows, twenty-five signed classes, one prohibition | `50 §2` |
| D9 | `I19` — "Every control artifact's content hash matches the owner-signed manifest for the deployed version", enforcement **CI + RUNTIME + SCHED** | invariant registry `I19` |
| D10 | The **manifest with owner-signed hashes across all classes, and `I19`, are sequenced at S4** | `37 §2` |
| D11 | The owner is the **root of trust**; owner-credential compromise is **out of architectural scope** | `49 §3.9`, `50 §5` |
| D12 | **Ed25519** is declared for exactly one signer: the **audit plane's** key, generated on and never leaving the audit-plane host, published as class 24 | `30 §5.7.1`, `50 §2` class 24 |

**And v1.3.5 states, in six places, that the mechanism does not exist:**

> "**No production owner-signing mechanism and no runtime `I19` verification exist.**"
> — `50`'s change record, `30 §5.1a`, `51 §3.7`, `51 §3.8`, `phase2-v1.3.3-errata.md` and `phase2-v1.3.5-errata.md` preambles

and `phase2-v1.3.5-errata.md §7` registers, as of the accepted baseline:

| Item | Status |
|---|---|
| Class 20 signature | **OWED, and enlarged a third time** |
| Class 17 signature | **OWED, enlarged by `51 §2.3`** |
| Class 3 signature | **OWED from v1.3.3** |
| Class 27 signature | **OWED from v1.3.3** |
| Runtime `I19` | **OPEN. No production owner-signing mechanism exists** |
| `O4` | **OPEN** |
| Production key management | **OPEN** |

---

## 3. Why S1K stops: ten blocking omissions

Each is stated as the mandate requires — with the exact wording that fails, and what a
closing declaration would have to say. **Six are the mandate's own declared tripwires.
Four are new and were found by reading the implementation against the manifest.**

Full statements in `S1K-owner-clarifications.md`. In summary:

| # | Omission | Mandate tripwire | New? |
|---|---|---|---|
| `S1K-C1` | The owner signature's **algorithm** is undeclared | `§5`, `§30` | — |
| `S1K-C2` | The **signing message** is undeclared | `§5`, `§6`, `§29` | — |
| `S1K-C3` | The **owner verification key has no declared provenance** — the root of trust is circular | **`§7`, `§41`** | — |
| `S1K-C4` | `I19 (continuous)` has **no enforceable runtime semantics or cadence** | **`§16`** | — |
| `S1K-C5` | "**canonicalised content**" names no canonicalisation for control artifacts, and is circular for class 20 | `§5` | — |
| `S1K-C6` | The artifacts' **content boundaries are undeclared**, and two class pairs co-reside in one module | `§4`, `§5` | **NEW** |
| `S1K-C7` | **Class 17's content is per-company runtime database rows**, and its declared table is wider than the deployed catalogue | `§4` | **NEW** |
| `S1K-C8` | **Class 20 has no artifact to sign** — it exists as three conforming implementations and as prose | `§4`, `§12` | **NEW** |
| `S1K-C9` | The **manifest's own integrity is undeclared**; per-row signatures do not protect the row set | **`§40`** | — |
| `S1K-C10` | The **second factor** is required on every artifact in this mandate and has no declared mechanism or verifier-visible evidence | `§5`, `§24` | **NEW** |

**`S1K-C3` alone is dispositive.** `§41` of the mandate:

> If v1.3.5 fails to define the root of trust sufficiently to avoid circular verification:
> **RETURN PARTIAL.** … **Do not invent a chain-of-trust model.**

---

## 4. What S1K deliberately did NOT do

Each of these was available and each would have been an invention:

- **Did not** choose Ed25519 for the owner signature by analogy with class 24. Class 24 is
  the **audit plane's** key under a **different signer** with an explicitly different trust
  story; `50 §2` puts its public half in the manifest precisely because the owner signature
  is the root *above* it. Borrowing its algorithm downward is not a reading, it is a choice.
- **Did not** compile in, configure, or database-bind an owner public key. That is the
  chain-of-trust model `§41` prohibits inventing.
- **Did not** define a signing message over `50 §3`'s row fields. The fields are present;
  the statement that the signature covers them, in an order, under a framing, with a
  domain separator, is not.
- **Did not** pick an `I19` cadence. `§16`: "Do not invent a polling interval."
- **Did not** define class 3's, 17's, 20's or 27's canonical content bytes. A signature over
  a boundary the architecture did not draw certifies a set the architecture did not define,
  and would move every `content_hash` again when the real boundary is declared.
- **Did not** write `docs/architecture/v1.3.6/`. `§44`: v1.3.5 already declares the
  obligation, and the repository's precedent is that the implementation *reports* a
  normative omission and an architecture pass closes it — which is exactly how `MIE-01`,
  `SER-01`, `OBX-04` and `OBX-05` were closed between S1J's PARTIAL and S1J's PASS.
- **Did not** build a hash-only integrity gate and call it `I19`. `§22` forbids the
  downgrade, and a hash comparison against a manifest with no declared trust root is
  theatre rather than a control.

---

## 5. What remains true and unchanged

- Every S1A–S1J property holds. No accepted control was disarmed.
- `src/` contains no network client, no vendor SDK, no credential and no real adapter.
- The pre-live gate recorded at S1I and carried at S1J **remains mandatory and remains
  unsatisfied**:

  > No later slice may enable a real external effect until the owner/control-artifact
  > signing and integrity sequencing has been re-evaluated against the then-current
  > architecture.

  **S1K is that re-evaluation. Its finding is that the architecture cannot yet be
  implemented against, and the gate therefore stays shut.**
