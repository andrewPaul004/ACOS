# ACOS Operating Spine v1.3 — issue v1.3.1

**Phase 2.5 / 2.5a. Architecture issued 2026-09-03; normative errata applied 2026-09-03.**

**Status: READY FOR S1 IMPLEMENTATION** — `phase2-v1.3-verification.md`, regated by `phase2-v1.3.1-verification.md`.

The application of the fourteen BLOCKING findings from the third independent architecture red team, plus TB-09 and TOS-04, plus a verification-only consistency pass. No fourth adversarial review was required (`redteam3/62 §5`) and none was run. No production code.

**Issue v1.3.1** applies seven normative consistency corrections — the rate-class Step R contradiction, the remediation-ledger arithmetic, TOS-02, TOS-03, the retired `cessation_lag` scalar, and two registry counts. **The architecture is unchanged, no mechanism was introduced, and no authority quantity moved**, so the numbered deliverables still declare `Operating Spine v1.3` in their version lines. `v1.3.1` is the package issue.

## Read in this order

1. **`phase2-v1.3-implementation-brief.md`** — the handoff. Which artifacts are normative, the S1 boundary and its non-goals, the seventeen empirical obligations, the ten pass-revocation conditions.
2. `phase2-v1.3-verification.md` — the gate. V1–V16, each able to fail.
2a. `phase2-v1.3.1-errata.md` and `phase2-v1.3.1-verification.md` — the errata record and its gate. **Read `phase2-v1.3.1-errata.md §1` before implementing step R.**
3. `phase2-v1.3-changelog.md` — v1.2 → v1.3, including `§8`'s record of this project's own failed audit (TOS-04).
4. `phase2-v1.3-remediation-ledger.md` — fourteen entries, one disposition each, no merges.
5. `phase2-v1.3-invariant-registry.md` — the single authoritative definition of every invariant identifier.
6. `phase2-v1.3-lower-severity-register.md` — the seventeen dispositions for MATERIAL, MINOR and WORDING findings.

## Layout

| Path | Contents |
|---|---|
| `deliverables/` | The architecture, `22`–`38` and `48`–`51`. **`38` is superseded and non-normative** |
| `diagrams/` | Mermaid sources |
| `analysis/` | Oracles and self-checks. `consistency-v1.3.py` carries C1–C29 and the v1.3.1 conditions E1–E7 and exits non-zero on failure; `recompute-v1.3.py` computes every displayed quantity from the formulae. `consistency-v1.3.1-output.txt` is the retained v1.3.1 run |
| `redteam3/` | `59`–`62`, unmodified. `62` is the operative gate |
| `redteam2/` | `52`–`58`, unmodified. Superseded by `62` as a gate; retained as findings |
| `*.keep` | v1.2 root documents, retained as history |

## The three things worth knowing before reading anything else

**TJ-01 is not prevented, and v1.3 does not claim it is.** A compromised control plane that stays in `NORMAL` and freezes its own attested prefix is undetectable by `I17` and `I17e`. Vendor-touching effects may later be caught by `I8`; suppressed authority and state rows with no vendor counterpart are caught by nothing. Registry `§3` item 9.

**No numerical authority quantity changed, in v1.3 or in v1.3.1.** `MAL_total(month)` at the signature basis is $756.00, as in v1.2, and no owner re-signature is required. v1.3.1's recomputation is byte-identical to v1.3's. The one correction that would have moved it — TB-08(a)'s overdelivery band — is deliberately scheduled.

**`I8` proves nothing at S1.** Every S1 action class runs against a mock adapter, so there is no vendor side to enumerate.
