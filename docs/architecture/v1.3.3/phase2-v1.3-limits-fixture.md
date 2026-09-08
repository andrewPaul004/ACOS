# phase2-v1.3-limits-fixture.md — pointer

**This file is a pointer, not a deliverable.**

The authority limits fixture is a numbered architecture artifact and lives with the others:

> **`deliverables/51-limits-fixture.md`**

Two copies of a fixture that `I7` compares against an independent oracle is exactly the drift hazard the consistency pass exists to catch, so there is only one. The reference oracle and its output are `analysis/recompute-v1.3.py` and `analysis/recompute-v1.3-output.txt`.

---

## What changed in v1.3, and what did not

**No numerical authority quantity changed. No owner re-signature is required.**

| Quantity | v1.2 | v1.3 |
|---|---|---|
| `MAL_monetary(month)` — the signed figure | $300.00 | **$300.00** |
| `Standing(month)` 28/29/30-day | $182.40 | **$182.40** |
| `Standing(month)` 31-day | $186.00 | **$186.00** |
| `MIE_cost(month)` p50 / p95 | $120.00 / $270.00 | **$120.00 / $270.00** |
| `MAL_total(month)` p95 31-day — **signature basis** | $756.00 | **$756.00** |
| `MAL_total(day)` p95 | $329.50 | **$329.50** |
| Realisable cash exposure | $906.00 | **$906.00** |
| Every window ceiling in `51 §2` | — | **unchanged** |

**Three things were added to `51`, none of which is an authority quantity.**

1. **`§3.2` — `I8` sweep cadences per adapter** (TA-02): 1 hour for the processor, commerce and ESP adapters, **6 hours for `google_ads`**, 1 hour default for a new adapter. `CONFIGURED` operational parameters. `vendor_reporting_lag` is declared separately and is `UNMEASURED`. The single scalar `cessation_lag` is retired as an `I54` operand and replaced by a pointer to the four-field cessation specification TB-07 schedules.
2. **`§3.2.1` and `§3.2.2` — charge-record field sets and the `standing_authorization_id` derivation** (TB-05). Declarations about vendor data, not limits.
3. **`§3.6` — the degraded-mode override limit set** (TA-05): 24 h / 5 effects / $50.00 per override; 3 / 72 h / 8 / $100.00 per rolling 30 days; second approver from the 2nd override. **`DESIGN LIMIT — OWNER SIGNED`, non-production MVP test-fixture values, not production policy.**

**Why `§3.6` does not move `MAL_total`, computed rather than asserted.** A `DegradedModeOverride` releases a **dispatch gate**, never an **exposure gate**: every effect dispatched under one still traverses the policy sequence, still reserves, and is still bound by `I3`. And every aggregate limit is **strictly below** the already-signed ceiling it draws against — $100.00 against `W_MONTH_REFUND`'s $250.00, and 8 effects against its count of 10. `analysis/recompute-v1.3-output.txt` computes both inequalities independently; `phase2-v1.3-verification.md` **V8** is the gate condition.

**The one change that would have moved `MAL_total` was deliberately not made.** TB-08(a) — setting `W_MONTH_ADSPEND.max_monetary` above `standing_cap` by a declared overdelivery band — is **authorised loss**, so it recomputes `MAL_total` upward and requires re-signature under `26 §10.3`. It is scheduled `S1 BEFORE IMPLEMENTING RELATED COMPONENT` in `phase2-v1.3-lower-severity-register.md`, and it must land **before production ceilings are seeded on `W_MONTH_ADSPEND`**. Bundling a re-signature into a pass whose central claim is *no authority quantity changed* would have made that claim false and V5 harder to evaluate.
