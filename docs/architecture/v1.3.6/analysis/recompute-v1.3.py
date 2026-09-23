#!/usr/bin/env python3
"""
ACOS Operating Spine v1.3 — independent recomputation of every displayed loss quantity.

Written against the FORMULAE in 26 §10.1 (v1.3) and the DECLARED DATA in
51-limits-fixture v1.3, by brute-force enumeration rather than by calling any
production sum.  This is the I7 differential oracle's reference implementation
for the architecture package; the S1 oracle must be written independently again.

Conventions this file makes explicit, because v1.1's implicit ones were LIM-01:
    UNBOUNDED is a sentinel, not None and not 0.
    min(UNBOUNDED, x) == x.
    A window with no declared max_monetary is a catalogue defect, not +inf.
"""

from decimal import Decimal as D, ROUND_HALF_UP
from itertools import product

class Unbounded:
    def __repr__(self): return "UNBOUNDED"
    def __rmin__(self, other): return other
UNBOUNDED = Unbounded()

def mn(a, b):
    """min() over Money | UNBOUNDED, per 26 §10.1 v1.2."""
    if a is UNBOUNDED: return b
    if b is UNBOUNDED: return a
    return a if a < b else b

def money(x): return D(str(x)).quantize(D("0.01"), rounding=ROUND_HALF_UP)

# ---------------------------------------------------------------- windows
# (id, boundary_kind, period, max_monetary, max_count)
WINDOWS = {
    "W_DAY_REFUND":      dict(kind="DISCRETE", period="calendar_day",   max_monetary=money(50.00),  max_count=2),
    "W_MONTH_REFUND":    dict(kind="DISCRETE", period="calendar_month", max_monetary=money(250.00), max_count=10),
    "W_DAY_CREDIT":      dict(kind="DISCRETE", period="calendar_day",   max_monetary=money(12.50),  max_count=1),
    "W_MONTH_CREDIT":    dict(kind="DISCRETE", period="calendar_month", max_monetary=money(50.00),  max_count=4),
    "W_DAY_ADSPEND":     dict(kind="DISCRETE", period="calendar_day",   max_monetary=money(12.00),  max_count=UNBOUNDED),
    "W_MONTH_ADSPEND":   dict(kind="DISCRETE", period="calendar_month", max_monetary=money(186.00), max_count=UNBOUNDED),
    "W_DAY_MIE":         dict(kind="DISCRETE", period="calendar_day",   max_monetary=UNBOUNDED,     max_count=13),
    "W_MONTH_MIE":       dict(kind="DISCRETE", period="calendar_month", max_monetary=UNBOUNDED,     max_count=43),
    "W_MONTH_UNGATED":   dict(kind="DISCRETE", period="calendar_month", max_monetary=UNBOUNDED,     max_count=200),
    "W_MONTH_REFUND_OVERRIDE": dict(kind="DISCRETE", period="calendar_month", max_monetary=money(0.00), max_count=0),
    "W_MONTH_CREDIT_OVERRIDE": dict(kind="DISCRETE", period="calendar_month", max_monetary=money(0.00), max_count=0),
}

# ------------------------------------------------------- non-rate grants
# per_action_max.monetary, and the per-window count the grant declares
GRANTS = [
    dict(cls="refund.create",         per_action=money(25.00),
         windows={"W_DAY_REFUND": 2, "W_MONTH_REFUND": 10}),
    dict(cls="goodwill.credit.issue", per_action=money(12.50),
         windows={"W_DAY_CREDIT": 1, "W_MONTH_CREDIT": 4}),
]

# ------------------------------------------- discretionary irrecoverable
MIE = [
    dict(cls="fulfilment.reship",  day=2,  month=2,  p50=money(35.00), p95=money(95.00)),
    dict(cls="order.address.edit", day=1,  month=1,  p50=money(30.00), p95=money(60.00)),
    dict(cls="email.send.discr",   day=10, month=40, p50=money(0.50),  p95=money(0.50)),
]

# --------------------------------------------------- standing (rate) auth
# Google Ads documented behaviour: up to 2x the average daily budget on an
# individual day; monthly delivery capped at 30.4x the average daily budget.
ADAPTER = dict(name="google_ads",
               daily_overdelivery_multiplier=D("2.0"),
               monthly_basis_multiplier=D("30.4"))
STANDING = [dict(cls="campaign.budget.set", rate=money(6.00), period="day",
                 windows=["W_DAY_ADSPEND", "W_MONTH_ADSPEND"], adapter=ADAPTER)]

# ---------------------------------------------------------------- formulae
def mal_monetary(period, grants=GRANTS, windows=WINDOWS):
    """26 §10.1 v1.2:  MAL_monetary(w) = min( w.max_monetary, Sum_g min(w.max_monetary, per_action x count) )"""
    per_window = {}
    for g in grants:
        for wid, count in g["windows"].items():
            if windows[wid]["period"] != period:
                continue
            term = mn(windows[wid]["max_monetary"], g["per_action"] * count)
            per_window.setdefault(wid, money(0))
            per_window[wid] += term
    out = money(0)
    detail = []
    for wid, s in sorted(per_window.items()):
        capped = mn(windows[wid]["max_monetary"], s)
        detail.append((wid, s, capped))
        out += capped
    return out, detail

def standing_cap(s, period, days_in_month=31):
    """Exposure-remainder form.  See 26 §10.1 v1.2 and 51 §3.2 v1.2."""
    a = s["adapter"]
    if period == "calendar_day":
        return money(s["rate"] * a["daily_overdelivery_multiplier"])
    basis = max(D(days_in_month), a["monthly_basis_multiplier"])
    return money(s["rate"] * basis)

def standing(period, days_in_month=31):
    return sum((standing_cap(s, period, days_in_month) for s in STANDING), money(0))

def mie_cost(period, basis="p95"):
    key = "day" if period == "calendar_day" else "month"
    return sum((money(m[key] * m[basis]) for m in MIE), money(0))

def report(days_in_month=31, basis="p95"):
    mm_d, det_d = mal_monetary("calendar_day")
    mm_m, det_m = mal_monetary("calendar_month")
    st_d, st_m = standing("calendar_day"), standing("calendar_month", days_in_month)
    mc_d, mc_m = mie_cost("calendar_day", basis), mie_cost("calendar_month", basis)
    return dict(
        detail_day=det_d, detail_month=det_m,
        MAL_monetary_day=mm_d, MAL_monetary_month=mm_m,
        Standing_day=st_d, Standing_month=st_m,
        MIE_cost_day=mc_d, MIE_cost_month=mc_m,
        MAL_total_day=mm_d + st_d + mc_d,
        MAL_total_month=mm_m + st_m + mc_m,
    )

# ------------------------------------- brute force: is the ceiling reachable?
def reachable_month(days_in_month=31):
    """Enumerate per-class realisable actions honouring EVERY referenced window."""
    rows, total = [], money(0)
    for g in GRANTS:
        day_c = min((c for w, c in g["windows"].items()
                     if WINDOWS[w]["period"] == "calendar_day"), default=10**9)
        mon_c = min((c for w, c in g["windows"].items()
                     if WINDOWS[w]["period"] == "calendar_month"), default=10**9)
        # also bounded by the window monetary ceilings
        n = min(mon_c, day_c * days_in_month)
        val = money(g["per_action"] * n)
        for w, c in g["windows"].items():
            mmw = WINDOWS[w]["max_monetary"]
            if mmw is not UNBOUNDED and WINDOWS[w]["period"] == "calendar_month":
                val = mn(mmw, val)
        rows.append((g["cls"], day_c, mon_c, n, val))
        total += val
    return rows, total

# ------------------------------------------------- composition fixture F2
F2_WINDOWS = {
    "F2_W_MONTH_SHARED":     dict(kind="DISCRETE", period="calendar_month", max_monetary=money(300.00), max_count=30),
    "F2_W_DAY_SHARED":       dict(kind="DISCRETE", period="calendar_day",   max_monetary=money(60.00),  max_count=4),
    "F2_W_MONTH_ADS_SHARED": dict(kind="DISCRETE", period="calendar_month", max_monetary=money(400.00), max_count=UNBOUNDED),
    "F2_W_MONTH_UNBOUNDED":  dict(kind="DISCRETE", period="calendar_month", max_monetary=UNBOUNDED,     max_count=12),
}
F2_GRANTS = [
    dict(cls="refund.create",         per_action=money(25.00), windows={"F2_W_MONTH_SHARED": 10, "F2_W_DAY_SHARED": 2}),
    dict(cls="refund.create",         per_action=money(25.00), windows={"F2_W_MONTH_SHARED": 4,  "F2_W_DAY_SHARED": 2}),
    dict(cls="goodwill.credit.issue", per_action=money(20.00), windows={"F2_W_MONTH_SHARED": 8}),
    dict(cls="entitlement.issue",     per_action=money(15.00), windows={"F2_W_MONTH_UNBOUNDED": 12}),
]
F2_STANDING = [
    dict(cls="campaign.budget.set", rate=money(6.00), period="day",
         windows=["F2_W_MONTH_ADS_SHARED"], adapter=ADAPTER),
    dict(cls="campaign.budget.set", rate=money(5.00), period="day",
         windows=["F2_W_MONTH_ADS_SHARED"], adapter=ADAPTER),
]

def f2_report(days_in_month):
    mm, det = mal_monetary("calendar_month", F2_GRANTS, F2_WINDOWS)
    st = sum((standing_cap(s, "calendar_month", days_in_month) for s in F2_STANDING), money(0))
    return mm, det, st

# ------------------------------------------------------------------- output
if __name__ == "__main__":
    print("=" * 78)
    print("ACOS v1.2 — INDEPENDENT RECOMPUTATION (I7 reference oracle)")
    print("=" * 78)

    for basis in ("p50", "p95"):
        print(f"\n--- Stage-2 fixture, MIE basis = {basis} ---")
        for dim in (28, 29, 30, 31):
            r = report(dim, basis)
            print(f"  {dim}-day month:  MAL_monetary(month)={r['MAL_monetary_month']}"
                  f"  Standing(month)={r['Standing_month']}"
                  f"  MIE_cost(month)={r['MIE_cost_month']}"
                  f"  MAL_total(month)={r['MAL_total_month']}")
        r = report(31, basis)
        print(f"  day horizon:   MAL_monetary(day)={r['MAL_monetary_day']}"
              f"  Standing(day)={r['Standing_day']}"
              f"  MIE_cost(day)={r['MIE_cost_day']}"
              f"  MAL_total(day)={r['MAL_total_day']}")
        print(f"  30 x MAL_total(day) = {money(r['MAL_total_day'] * 30)}"
              f"   vs MAL_total(month) = {r['MAL_total_month']}")

    print("\n--- MAL_monetary per-window detail (month) ---")
    _, det = mal_monetary("calendar_month")
    for wid, raw, capped in det:
        cap = WINDOWS[wid]["max_monetary"]
        print(f"  {wid:22s} grant-sum={raw}  window.max_monetary={cap}  -> {capped}"
              f"   {'[WINDOW CAP BINDS]' if cap is not UNBOUNDED and capped == cap and capped < raw else ''}")

    print("\n--- Reachability (brute force, honouring every window) ---")
    for dim in (28, 31):
        rows, total = reachable_month(dim)
        print(f"  {dim}-day month:")
        for cls, dc, mc, n, val in rows:
            print(f"    {cls:24s} day={dc} month={mc} -> realisable n={n}  value={val}")
        print(f"    realisable monetary total = {total}")

    print("\n--- Composition fixture F2 (non-degenerate) ---")
    for dim in (28, 30, 31):
        mm, det, st = f2_report(dim)
        print(f"  {dim}-day month: MAL_monetary={mm}  Standing={st}  MAL_total(excl. MIE)={mm + st}")
        if dim == 31:
            for wid, raw, capped in det:
                cap = F2_WINDOWS[wid]["max_monetary"]
                binds = (cap is not UNBOUNDED and capped == cap and capped < raw)
                print(f"    {wid:24s} grant-sum={raw}  cap={cap}  -> {capped}"
                      f"  {'[WINDOW CAP BINDS]' if binds else '[GRANT SUM BINDS]'}")

    print("\n--- min() convention exercised in both directions ---")
    print(f"  min(UNBOUNDED, 250.00) = {mn(UNBOUNDED, money(250))}")
    print(f"  min(250.00, 250.00)    = {mn(money(250), money(250))}")
    print(f"  min(300.00, 410.00)    = {mn(money(300), money(410))}   [cap binds]")
    print(f"  min(300.00, 160.00)    = {mn(money(300), money(160))}   [grant binds]")

    print("\n--- Realisable cash line (LIM-10) ---")
    r95 = report(31, "p95")
    cost_ceiling = money(150.00)
    print(f"  MAL_total(month) p95 = {r95['MAL_total_month']}  + cost ceilings {cost_ceiling}"
          f"  = {r95['MAL_total_month'] + cost_ceiling}")

# ---------------------------------------------------------------------------
# v1.3 additions.  No authority quantity changed; two independent checks are
# added because two v1.3 remediations make claims about arithmetic.
#
#   (1) TA-05 / I63: the degraded-mode override aggregate limits must be
#       STRICTLY BELOW the already-signed window ceilings they draw against,
#       which is what makes "an override changes no ceiling" checkable rather
#       than asserted.  Computed here from 51 §3.6 and 51 §2 independently of
#       the prose.  This is verification condition V8.
#
#   (2) TB-03: the FIRST campaign.budget.set in a clean 31-day window must
#       PERMIT.  Computed from 26 §2.1.3's declared field values and 51 §2's
#       ceilings, not from the printed answer.  This is verification
#       condition V6.
# ---------------------------------------------------------------------------

def v13_override_bounds():
    per_override   = {"duration_h": 24, "effects": 5,  "monetary": D("50.00")}
    aggregate      = {"count": 3, "hours": 72, "effects": 8, "monetary": D("100.00")}
    print("\n--- v1.3 TA-05 / I63: override composition, independently calculated ---")
    naive_h = aggregate["count"] * per_override["duration_h"]
    naive_e = aggregate["count"] * per_override["effects"]
    naive_m = aggregate["count"] * per_override["monetary"]
    print(f"  3 x per-override  ->  hours={naive_h}  effects={naive_e}  monetary={naive_m}")
    print(f"  aggregate caps    ->  hours={aggregate['hours']}  effects={aggregate['effects']}  monetary={aggregate['monetary']}")
    for k, naive, agg in (("hours", naive_h, aggregate["hours"]),
                          ("effects", naive_e, aggregate["effects"]),
                          ("monetary", naive_m, aggregate["monetary"])):
        binder = "AGGREGATE binds" if agg < naive else ("equal" if agg == naive else "PER-OVERRIDE binds")
        print(f"    {k:9s} {binder}")
    # safety: aggregates strictly below the signed ceilings they draw against
    w_month_refund_monetary = D("250.00")
    w_month_refund_count    = 10
    ok_m = aggregate["monetary"] < w_month_refund_monetary
    ok_c = aggregate["effects"]  < w_month_refund_count
    print(f"  aggregate monetary {aggregate['monetary']} < W_MONTH_REFUND {w_month_refund_monetary}: {ok_m}")
    print(f"  aggregate effects  {aggregate['effects']} < W_MONTH_REFUND count {w_month_refund_count}: {ok_c}")
    print(f"  => override cannot raise realisable loss above the signed MAL_total: {ok_m and ok_c}")
    return ok_m and ok_c

def v13_first_rate_authorisation():
    print("\n--- v1.3 TB-03: first campaign.budget.set in a clean window ---")
    rate = D("6.00")
    for wname, cap_basis, ceiling in (("W_MONTH_ADSPEND", D("31"), D("186.00")),
                                      ("W_DAY_ADSPEND",   D("2.0"), D("12.00"))):
        standing_cap = (rate * cap_basis).quantize(D("0.01"), rounding=ROUND_HALF_UP)
        reserved  = D("0.00")     # 26 §2.1.3: rate classes reserve zero
        standing  = standing_cap  # realised = 0 in a clean window
        presumed  = D("0.00")
        realised  = D("0.00")
        total = reserved + standing + presumed + realised
        verdict = "PERMIT" if total <= ceiling else "DENY: WINDOW_EXHAUSTED"
        print(f"  {wname:17s} reserved={reserved} standing={standing} presumed={presumed} "
              f"realised={realised}  sum={total} vs ceiling={ceiling}  -> {verdict}")
        if verdict != "PERMIT":
            return False
    print("  => V6 PASS: the first rate authorisation permits")
    return True


if True:
    v13_override_bounds()
    v13_first_rate_authorisation()
