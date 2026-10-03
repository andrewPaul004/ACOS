# 52 — Second Red Team Executive Verdict

**ACOS Operating Spine v1.1. Narrow second independent architecture review. Issued 2026-09-03.**
**Scope:** `phase2-v1.1-second-redteam-brief.md` — R1, R2, R3, R8, R9+R17-P4. Nothing else.
**Reviewer:** second independent architecture red team. Did not author v1.1. Did not author `39`–`47`.
**Package reviewed:** `acos-phase2-architecture-v1.1.zip`, unmodified.

---

# CONDITIONAL PASS — REMEDIATION REQUIRED

**0 FATAL · 22 BLOCKING · 24 MATERIAL · 6 MINOR · 4 WORDING · 10 attacks constructed and failed.**

A third review pass **is required**, scoped to two design additions rather than to all twenty-two defects. Those two are named in §4.

This authorises nothing yet. It states that the five re-designs are **right in shape** and that a developer implementing them exactly as written would produce a system that exceeds its declared authority boundary along at least two constructed paths.

---

## 1. The finding that determines the verdict

The brief's final gate asks whether a realistic sequence exists in which the system exceeds its declared authority boundary without a required invariant firing. Two do.

**Path A — headroom laundering through the unresolved-reservation override.** An adversary able to induce vendor timeouts (including the vendor) accumulates ten unresolved `refund.create` reservations against `W_MONTH_REFUND`. `35 §4` holds each reservation; `I32` observes that a majority of headroom is held by reservations past the class SLA and raises `HEADROOM_STARVATION` with **an owner override path that is itself an authorised, journaled effect** (`25 §12`). The owner, facing denied refunds while the FTC 7-working-day clock runs, overrides. Headroom returns. `I3` counts *open reservations + standing forward exposure + realised spend*; a released reservation is not open, and the realised spend of an unresolved effect is not yet realised, **so the exposure leaves both terms**. Ten further refunds authorise. Realisable monthly refund loss is `10 × $25 × k` for `k` overrides. `I7` still passes — it recomputes from the grant registry, which never changed. `MAL_monetary` never increases, so `26 §10`'s re-signature requirement never triggers. The owner answered a liquidity question and raised a loss ceiling.

**Path B — self-declared degraded mode.** `30 §5.1`'s split halt keys behaviour to mirror reachability, and **the audited party is the only party that reports it**. `24 §3` K11's declared inputs give the audit plane the pushed journal rows and its own vendor credentials — R10 deliberately removed the control-database replica — so from the audit side "mirror unreachable" and "control plane declining to push" are the same observation, and `README` already concedes that the audit plane's silence is indistinguishable from correctness. A compromised control plane declares degradation, classifies its compensable effects as clock-bearing (the clock-bearing signal derives from triage classification, not from a RECORD-grade external artifact), and dispatches the whole compensable catalogue with only a local chain behind it — which `22 §3.1` itself identifies as the unauditable case. Prolonged "unreachability" then presents the owner with a total company halt and an override that unlocks IRRECOVERABLE.

Neither path is a race condition or a hypothetical. Both are compositions of mechanisms the package specifies.

## 2. Why this is not FAIL

FAIL requires that one of the five re-designs cannot work as designed. None is in that condition.

- **R1's shape is correct and its most important claim is not yet true.** Enumerate-then-select is the right answer to `47 §1`, and `I21` is a real property where v1.0's was vacuous. But `I18`'s three-way equality — `dispatch_payload.monetary_effect == authorisation.exposure == reservation.amount` — is **ill-typed and either vacuous or false for every class whose exposure carries a cost component** (CAN-01), and cost components are the reason the canonicaliser exists. Splitting `exposure.vendor_amount` from `exposure.total_exposure` repairs it in one edit.
- **R2 governs a rate correctly and has no release semantics.** The entity, the forward integral and mandatory expiry are the right constructions. But the design never states **when standing forward exposure may return to the window** (STD-02), the four rolling-24h windows in `51 §2` have no boundary at which to re-reserve (STD-01), and the expiry that triggers revocation can expire the grant the revocation needs (STD-03).
- **R3's trade-off is the right trade and its completeness invariant is not evaluable by its declared owner** (AUD-01). Dispatching a statutory-clock-bearing compensable effect against a locally chained journal is better than breaching a federal deadline to protect a mirror. I endorse the trade. I do not accept that `I17` is a two-sided diff when only one side is readable from the plane that owns it.
- **R8's four quantities are a genuine improvement over one and the arithmetic is correct.** I recomputed every figure in `51 §4` independently and reproduced it exactly. The defects are semantic: an unstated `min()` convention (LIM-01), window ceilings that exist in `I3`'s statement and in no artifact (LIM-02), and the order-driven irrecoverable channel still excluded and now also **undeclared** (LIM-03).
- **R9's verify mode is the correct choice among three and the hand proof does not cover the catalogue it claims to cover** (RES-02). Deny is right; top-up defeats the ceiling and release-and-retake defeats SR5. But `26 §11.2`'s table omits `goodwill.credit.issue` and `order.address.edit`, both granted in `51 §3`, and the brief is right that until symcc returns this table is doing security work.

Every defect above has a local repair. That is the difference between BLOCKING and FATAL, and I have not inflated one into the other.

## 3. The pattern, because it is the same pattern

`47` found that v1.1's dominant failure mode was a claim outrunning its mechanism. The dominant failure mode of the **remediation** is narrower and more specific: **a quantity or a threshold that the mechanism needs, that the artifact declaring quantities does not declare.**

Nine of the twenty-two BLOCKING findings are of exactly this shape:

| Missing quantity | Needed by | Where it should live |
|---|---|---|
| Window monetary ceilings | `I3`, `MAL_monetary`'s `min()` | `51 §2` |
| `min(absent, x)` convention | `I7`'s differential oracle | `26 §10.1` |
| Per-class `I18` settlement tolerance | `I18`'s settlement leg | action catalogue |
| Order-driven per-order rate limit | `I30`'s counterpart bound | `51 §3.3` |
| Order-driven ratio anomaly threshold | the only order-driven control | `51 §3.3` |
| Standing headroom release condition | `I3` under pause | `24 §3` K5 |
| Overdelivery allowance in forward exposure | boundary re-reservation | `24 §3` K5, `51 §3.2` |
| `reconciler_match_rule` specificity | `I22` | `24 §3` K5 |
| Journal row canonicalisation | `I41` on both sides | `30 §5` |

The registry's own rule 5 — *"An invariant with an unstated threshold is not an invariant"* — is the correct standard and it is violated nine times by the artifacts that were written to satisfy it. `analysis/v1.1-internal-consistency-pass.md`'s closing note anticipated the mechanism ("prefer mechanisms whose numbers are *derived* rather than *stated*") and the remediation did not finish applying it: `51` derives `MAL_total` from grants and declares nothing about windows, which is where `I3` reads.

## 4. What the third pass must cover

Not twenty-two items. Two design additions, because they are the only findings whose repair is a new mechanism rather than a stated value or a corrected sentence:

1. **The audit plane's independent input path** (AUD-01, AUD-02). `I17` needs a side it does not have. The minimum viable construction — a periodic control-plane attestation pushed *as a journal row*, so that its absence is itself a sequence gap, plus audit-side expected-sequence continuity — changes what the audit plane is, and a reviewer should attack it before it is built.
2. **Standing exposure release and boundary semantics** (STD-01, STD-02, STD-04). "When may headroom return?" has no safe answer that does not also make pause-and-reauthorise impossible within a window. Whatever is chosen is a new rule with commercial consequences, and it is the load-bearing half of R2.

The remaining twenty defects are stated values, missing schema fields, corrected sentences and one taxonomy extension. They are remediation-and-verify, not remediation-and-re-review.

## 5. Out-of-scope findings

Three recorded, none expanded, in `53 §7`. The one that changes an in-scope conclusion is that `LIM-03`'s only real control — the fulfilment-to-settled-order ratio — inherits its integrity from `I27`'s processor-settlement corroboration, which is R6 and endorsed. If R6's corroboration is implemented as stated, LIM-03 is a disclosure defect. If it is not, LIM-03 is a loss channel.

## 6. What this verdict means

Implementation of the **non-production architectural MVP** is not authorised by this document. It does not authorise production deployment, real customers, real money, live advertising, supplier commitments, or autonomous business operation.

`58-implementation-gate.md` states what becomes permitted after the remediation in `57`, and what remains prohibited regardless.

**Grade of this verdict: DECISION.** Made on the package as delivered. Reconsideration trigger: any remediation that answers a BLOCKING finding by weakening the invariant rather than by supplying the missing mechanism or value.
