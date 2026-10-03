# ACOS Operating Spine v1.3.2 — Normative Errata

**Phase 2.5b. Issued 2026-09-07. One normative correction to `ACOS-JCS-1`, the journal canonicalisation specification, applied to Operating Spine v1.3.**

This is not an architecture phase, a red-team pass, a redesign or an implementation. **No mechanism was introduced, no authority ceiling was changed, MAL was not changed, no Step ordering was changed, no audit cadence was changed, and the selected architecture (Option A) was not changed.** One defect is recorded below. It was found during S1G implementation, demonstrated in executable form before it was corrected, and it is a genuine injectivity failure in a control artifact rather than wording drift.

**Versioning convention, as v1.3.1 established it.** The numbered deliverables continue to declare `Operating Spine v1.3` in their version lines, because the *architecture* is v1.3 and unchanged. `v1.3.2` names the **issue** of the package. `docs/architecture/v1.3.1/` is not modified by this pass and remains on disk as the previous issue; `docs/architecture/v1.3.2/` is the current one. `phase2-v1.3.1-errata.md` and `phase2-v1.3.1-verification.md` are carried forward unmodified as history.

**One thing this pass does that v1.3.1's did not: it changes a control artifact's signed content.** `ACOS-JCS-1` is control artifact class 20 (`50 §2`). Correcting it changes the bytes two conforming implementations produce for a NULL-bearing row, so it changes class 20's `content_hash` and requires a fresh owner signature before any deployment. `§1`'s *Control-artifact and version effect* states this exactly, and `§1`'s *Deployment* states what a deployed chain would additionally require and why ACOS does not require it today.

---

## Summary

| # | Defect | Behaviour changed | Authority quantities changed |
|---|---|---|---|
| **JCS-01** | `ACOS-JCS-1`'s generic NULL rule — a single `0x00` sentinel byte — is **not injective** against a non-null payload whose content is exactly the byte `0x00`. SQL `NULL` and a one-byte `bytea` value `'\x00'` frame to the identical five bytes `00 00 00 01 00`, so two correct implementations can hash a NULL field and a real one-byte payload to one value | **Yes** — the framed bytes of every NULL field change, and therefore the `row_hash` of every NULL-bearing journal row. Non-null payload bytes are unchanged | **NO CHANGE** |

**Authority quantities, restated and reverified.** `MAL_monetary(month)` = **$300.00**. `Standing(month)` = **$182.40 / $186.00**. `MIE_cost(month)` p95 = **$270.00**. `MAL_total(month)` at the signature basis = **$756.00**. `analysis/recompute-v1.3.py` reproduces the recorded `analysis/recompute-v1.3-output.txt` **line-for-line identically** after this pass. **No owner re-signature of the MAL basis is required.** A fresh **class-20** signature is required, and that is a different signature over a different artifact.

---

## 1. JCS-01 — the `ACOS-JCS-1` NULL framing collision

### Defect

`30 §5.3` declared two rules that interact, and declared both generically — with no type qualifier and no per-column carve-out:

> | Nulls vs empty strings | Single `0x00` sentinel byte for null; an empty string is a zero-length value. |

> | Field framing | Every field prefixed with its **4-byte big-endian byte length**, so no separator can be forged by content. |

Compose them over a `bytea` field:

| Value | Payload under the v1.2 rule | Framed |
|---|---|---|
| SQL `NULL` | the sentinel, one byte `0x00` | `00 00 00 01 00` |
| `bytea` `'\x00'` | the value itself, one byte `0x00` | `00 00 00 01 00` |

**They are the same bytes.** The encoding was therefore not injective over the field types `ACOS-JCS-1` declares, and `30 §5.3`'s own purpose — *"agree only if both canonicalise identically"* — was satisfiable by two implementations that agreed on a value neither could invert.

**Why `text` was accidentally safe and `bytea` was not.** Owner clarification S1B-C8 excludes `U+0000` from ACOS canonical text, and PostgreSQL `text` cannot store one, so no accepted string could imitate the sentinel. There was never an equivalent rule for `bytea`, and `30 §5.3`'s rules are declared over fields, not over column types. **A specification that is injective only for the column types a first implementation happens to use is not injective.**

**How far the defect reached.** The two journal row kinds S1 declares carry `bytea` only in `prev_hash` and `attested_head_hash`, each always NULL or a 32-byte SHA-256 digest, so no row ACOS can currently produce reaches the collision. That is a property of today's row kinds and not of the specification: any future row kind carrying a free-form `bytea`, or any second implementation written against the specification rather than against this code, reaches it immediately. The defect is in the artifact, so it is corrected in the artifact.

**Provenance.** Demonstrated during S1G implementation and recorded as `S1G-owner-clarifications.md` S1G-C1, which reported the generic `bytes` leg of `VC-A3` **PARTIAL** and refused to invent a representation. The owner disposition of S1G-C1 is this erratum.

### Affected files

`deliverables/30-observability-audit-and-escalation.md` `§5.3` · `deliverables/36-architecture-validation-plan.md` `§2` (the `VC-A3` case) · `deliverables/50-control-artifact-manifest.md` `§2` (class 20) · `analysis/consistency-v1.3.py` (conditions F1–F3 and the seeded negative controls)

### Exact correction

**A field-level NULL is carried by the framing word, and the framing word reserves a value for it.**

> **NULL.** A field-level NULL is encoded as exactly `0xFFFFFFFF` as the 4-byte unsigned big-endian length/discriminator word. **It carries no payload bytes.**
>
> **NON-NULL.** A non-null field is encoded as `uint32_be(payload_length) || payload`, where `0 <= payload_length <= 0xFFFFFFFE`. The payload itself continues to use the existing type-specific `ACOS-JCS-1` representation, unchanged.
>
> `0xFFFFFFFF` is therefore **reserved** and can never be a non-null payload length. A payload whose length would reach it is **not representable and the implementation must fail closed** rather than truncate or wrap.

`30 §5.3` now states this, prints the five representations as bytes, states the injectivity consequence, records what v1.2 got wrong, and states explicitly that no non-null payload rule changed.

**The five representations, as `30 §5.3` now prints them:**

| Value | Framed bytes |
|---|---|
| SQL `NULL` | `FF FF FF FF` — reserved word, no payload |
| empty string | `00 00 00 00` |
| empty `bytea` | `00 00 00 00` |
| `bytea` `'\x00'` | `00 00 00 01 00` |
| JSON literal `null` | `00 00 00 04 6E 75 6C 6C` — an ordinary non-null field carrying the RFC 8785 bytes `null` |

An **absent** optional structure member, where a row kind's schema makes absence distinct from a present null, is a field-level NULL. Where the schema makes the field mandatory there is no absent state and none may be invented.

**Why the reserved word rather than an escape, a type tag or a byte exclusion.** Three alternatives were available and each is worse:

* **Excluding the byte `0x00` from every `bytea` payload** would make a general-purpose binary field unable to carry binary. It also pushes the problem one level down: the exclusion has to be restated, and enforced, for every future type.
* **An escape prefix inside the payload** puts a second parser in front of every field and makes the payload rules type-dependent, which is the property that produced this defect.
* **A one-byte type tag per field** changes the bytes of every field, non-null included, and would break every existing encoding for a defect that touches only NULL.

The reserved length word changes **only** the NULL encoding, leaves every non-null payload byte-identical, and makes injectivity structural rather than conditional: the NULL encoding and the set of all non-null encodings are disjoint by construction, so no type's payload rule needs to avoid a byte value in order to stay clear of NULL.

**S1B-C8 is unchanged and remains in force.** The `U+0000` exclusion from canonical text stays exactly as written. It is simply no longer what separates NULL from text; it is now an ordinary Unicode-admissibility rule, and PostgreSQL `text` enforces it structurally in any case. This erratum does not relax it.

### Compatibility

**Every existing non-null payload encoding is unchanged, byte for byte.** Deliberately not touched, and asserted rather than assumed:

| Rule | v1.3.1 | v1.3.2 |
|---|---|---|
| `NUMERIC` per-column declared scale, as a string | unchanged | **unchanged** |
| Unicode form: UTF-8, NFC | unchanged | **unchanged** |
| `U+0000` exclusion from canonical text (S1B-C8) | unchanged | **unchanged** |
| Timestamps: RFC 3339, UTC, 6 fractional digits, `Z` | unchanged | **unchanged** |
| Integers, booleans | unchanged | **unchanged** |
| `bytea` payload: the bytes themselves | unchanged | **unchanged** |
| JSON-valued columns: RFC 8785 | unchanged | **unchanged** |
| Declared field order per row kind | unchanged | **unchanged** |
| Hash function: SHA-256 over the transmitted bytes | unchanged | **unchanged** |
| Row-chain formula and `prev_hash` position | unchanged | **unchanged** |
| **Field-level NULL framing** | `00 00 00 01 00` | **`FF FF FF FF`** |
| **Non-null length word range** | `0 .. 2^32-1`, unbounded in practice | **`0 .. 0xFFFFFFFE`, `0xFFFFFFFF` reserved** |

**What changes hash.** A row **all of whose declared fields are non-null** hashes to exactly the value v1.3.1 produced. A row with **at least one NULL field** hashes to a new value, by five bytes replaced with four per NULL field. Nothing else moves.

### Control-artifact and version effect

`ACOS-JCS-1` is **control artifact class 20** (`50 §2`), *"versioned in its name"*, and `50 §3` hashes each class's canonicalised content into the manifest.

* **The artifact name is unchanged: `ACOS-JCS-1`.** That is an owner decision, taken because the correction repairs the artifact's stated intent rather than replacing it, and because the manifest already carries a per-class content hash that distinguishes the two contents.
* **Class 20's `content_hash` changes**, because its signed content changes. `50 §2` row 20 now records that a fresh owner signature is required before deployment.
* **No second version field is introduced.** There is no persisted `canonical_format_version` in the architecture or in the implementation, and this pass does not create one: the class-20 content hash in the signed manifest is the existing identity mechanism and it is sufficient.
* **No other control-artifact class is normatively affected.** Classes 1–19 and 21–26 are untouched by this pass, and their content is unchanged.

### Deployment

`30 §5.3` already said it: *"A change is a chain break by construction and requires a declared migration with a re-anchor."*

**This erratum does not supply that procedure, and does not claim it can be applied to a live chain.** ACOS is not deployed, there is no live journal, and no anchor has ever been published, so at v1.3.2 the correction is applied to a specification and to pre-production code and nothing has to be migrated. **A future change to the canonical framing of a deployed chain would require deliberate chain-versioning and re-anchor semantics that this architecture does not yet declare**, and that obligation is recorded here rather than discharged.

### Behaviour changed

**Yes, and narrowly: the bytes.** The framed representation of a NULL field changes and every NULL-bearing row's `row_hash` changes with it. No mechanism, no ordering, no cadence, no state machine, no grant, no ceiling and no check changes. `I17`, `I17c`, `I17d`, `I17e`, `I17f`, `I41` and `I8` retain their exact prior meanings; `JournalAttestation`'s cadence stays 5 minutes with k = 3; the dispatch precedence list, the mirror state machine and the anchor medium are untouched.

### Authority quantities changed

**NO CHANGE.**

---

## What this pass deliberately did not do

* **It did not rename the artifact.** `ACOS-JCS-1` keeps its name by owner decision; the class-20 content hash carries the new identity.
* **It did not redesign any non-null encoding.** Strings, NFC, money, integers, timestamps, JSON/RFC 8785, `bytea` payloads, field order, the hash function and the row-chain formula are as v1.3.1 issued them.
* **It did not relax S1B-C8.** `U+0000` remains inadmissible in ACOS canonical text.
* **It did not add a chain-version field, a migration or a re-anchor procedure.** Those are owed only by a deployed chain, and are recorded as owed.
* **It did not touch authority ceilings, MAL, policy, Step ordering, audit cadence, the mirror state machine, dispatch rules, grant semantics or exposure semantics.**
* **It did not run an adversarial review**, and none was required — `redteam3/62 §5` is unchanged and no fourth review is scheduled.
* **It did not modify `docs/architecture/v1.3.1/`.** That package remains byte-identical to its issue.
