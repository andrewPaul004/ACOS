# ACOS Phase 2.2 — Narrow Independent Second Red Team

**Issued 2026-09-03. Reviewer: second independent architecture red team.**
**Package reviewed:** `acos-phase2-architecture-v1.1.zip`, unmodified. No architecture artifact was altered and no implementation code was written.

---

# CONDITIONAL PASS — REMEDIATION REQUIRED

**0 FATAL · 22 BLOCKING · 21 MATERIAL · 6 MINOR · 3 WORDING · 10 attacks constructed and defeated.**

A third review pass is required, scoped to **two** items: the audit plane's independent input path (SR-A1/SR-A2) and standing-exposure release semantics (SR-S2).

---

## Read in this order

| File | Purpose |
|---|---|
| `52-second-redteam-executive-verdict.md` | The verdict, the two paths that exceed the authority boundary, and why this is not FAIL |
| `58-implementation-gate.md` | The thirteen gate answers. What is and is not authorised, and what revokes the pass |
| `57-second-redteam-remediation.md` | Twenty-two blocking defects with the exact change, invariant, test and third-review flag for each |
| `53-second-redteam-attack-register.md` | Every attack, including the ten that failed. Full detail per finding |
| `54-money-path-verification.md` | Independent recomputation of `51-limits-fixture.md`, plus three realisable-loss traces |
| `55-audit-degraded-mode-verification.md` | R3: ordering, completeness, lag, anchoring, statutory clocks, the split halt |
| `56-counterparty-and-resume-verification.md` | R9 and R17-P4: verify mode, reservation lifecycle, P4/P4a/P7, the hand proof |
| `appendix/recompute.py` | The second implementation used for the `I7` differential check |
| `appendix/recompute-output.txt` | Its output |

---

## Scope

Exactly the five items in `phase2-v1.1-second-redteam-brief.md`: **R1** (Effect Canonicaliser), **R2** (`StandingAuthorization`), **R3** (journal ordering and the split halt), **R8** (the four authorised-loss quantities), **R9 + R17-P4** (kernel-state approvals, verify-mode resume, the rewritten counterparty property).

Nothing else was reviewed. Three out-of-scope findings are recorded in `53 §7`, labelled `OUT_OF_SCOPE`, and the review was not expanded around them.

## The one-paragraph summary

The five re-designs are right in shape and under-specified in the places money and evidence are bounded. Enumerate-then-select is the correct answer to `47 §1`; deny-rather-than-top-up is the correct choice among three; the EM15/EM16 trade is the right trade and IRRECOVERABLE is the right boundary; four authorised-loss quantities are better than one and **`51 §4`'s arithmetic reproduces exactly under independent recomputation**. What does not hold: `I18`'s equality is unsatisfiable for every class carrying a cost component; positional selectors permit silent substitution of a different effect with no invariant firing; `I17` is declared two-sided and owned by a plane that cannot read the other side; degraded mode is entered on the word of the audited party; the halt table has two rows matching one effect with opposite behaviour; window ceilings exist in `I3`'s statement and in no artifact; and the hand proof that is the only evidence for P4 omits two classes the limits fixture actively grants.

**The pattern:** nine of the twenty-two blocking defects are a quantity or threshold the mechanism needs that the artifact declaring quantities does not declare. The registry's own rule 5 — *"an invariant with an unstated threshold is not an invariant"* — is the right standard, and it is violated nine times by the artifacts written to satisfy it.
