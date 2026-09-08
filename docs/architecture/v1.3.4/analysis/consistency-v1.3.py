#!/usr/bin/env python3
"""
ACOS v1.3 internal consistency pass. Mechanical conditions only.
Every condition below is written so it CAN return FAIL.

C1-C29 are the v1.3 conditions. E1-E7 were added by the v1.3.1 errata pass.
F1-F3 were added by the v1.3.2 errata pass (JCS-01, ACOS-JCS-1 NULL framing).
G1-G10 were added by the v1.3.3 errata pass (APF-01 the degraded per-action
approval floor, MLT-01 and FHT-01 the two degraded-mode timing thresholds,
SWR-01 STORE_WRITE_REJECTED's closed audit-owned derivation).

Run with --seed-old-null-sentinel to reintroduce v1.2's withdrawn one-byte
0x00 NULL sentinel IN MEMORY. F1-F3 must then FAIL. Nothing on disk is touched.
"""
import pathlib, re, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
DELIV = sorted((ROOT/"deliverables").glob("*.md"))
ROOTDOCS = sorted(ROOT.glob("phase2-v1.3-*.md"))
ANALYSIS = sorted((ROOT/"analysis").glob("*.md"))
# Operational corpus: current architecture + current root docs. Excludes redteam2/,
# redteam3/ and the v1.2 .keep files, which are history by construction.
OPERATIONAL = DELIV + ROOTDOCS
ALL = OPERATIONAL + ANALYSIS

def text(ps): return {p: p.read_text() for p in ps}
T = text(ALL)

# ============================================================================
# v1.3.2 NEGATIVE CONTROL (JCS-01).
#
# A consistency condition that has never failed is indistinguishable from one
# that cannot. `--seed-old-null-sentinel` restores v1.2's withdrawn one-byte
# `0x00` NULL sentinel in the IN-MEMORY corpus -- 30 §5.3's two rules, its
# worked-example table and its injectivity statement, plus the 36 and 50
# cross-references -- and F1-F3 must then FAIL.
#
# Nothing on disk is modified. The seeded corpus exists only in this process.
# ============================================================================
SEED_OLD_NULL_SENTINEL = "--seed-old-null-sentinel" in sys.argv
SEED_OLD_NULL_BYTES = "--seed-old-null-bytes" in sys.argv

if SEED_OLD_NULL_SENTINEL:
    _p30 = ROOT / "deliverables/30-observability-audit-and-escalation.md"
    _p36 = ROOT / "deliverables/36-architecture-validation-plan.md"
    _p50 = ROOT / "deliverables/50-control-artifact-manifest.md"
    _seeded = 0

    _t = T[_p30]
    # (a) the NULL rule row, back to v1.2.
    _i = _t.find("| Nulls vs empty strings |")
    _j = _t.find("\n", _i)
    if _i > 0:
        _t = (_t[:_i]
              + "| Nulls vs empty strings | Single `0x00` sentinel byte for null; "
                "an empty string is a zero-length value. |"
              + _t[_j:])
        _seeded += 1
    # (b) the framing row, back to v1.2.
    _i = _t.find("| Field framing |")
    _j = _t.find("\n", _i)
    if _i > 0:
        _t = (_t[:_i]
              + "| Field framing | Every field prefixed with its **4-byte big-endian "
                "byte length**, so no separator can be forged by content. |"
              + _t[_j:])
        _seeded += 1
    # (c) drop the worked-example table, the injectivity statement, the defect
    #     record and the compatibility statement -- everything JCS-01 added.
    _i = _t.find("**The five representations that must never collapse")
    _j = _t.find("`ACOS-JCS-1` is a **control artifact, class 20**")
    if 0 < _i < _j:
        _t = _t[:_i] + _t[_j:]
        _seeded += 1
    # (d) the class-20 identity sentence, back to v1.2.
    _i = _t.find("**The v1.3.2 correction changes class 20's signed content")
    _j = _t.find("`36 §2.6` cross-implements it", _i) if _i > 0 else -1
    if 0 < _i < _j:
        _t = _t[:_i] + _t[_j:]
        _seeded += 1
    T[_p30] = _t

    _t = T[_p36]
    _k = ("**SQL NULL (`FF FF FF FF`) distinct from empty string, from empty `bytea`, "
          "from a one-byte `bytea` payload `0x00`, and from a JSON literal `null`** "
          "(v1.3.2, JCS-01), and a seeded implementation restoring v1.2's one-byte "
          "`0x00` NULL sentinel **must fail this case**")
    if _k in _t:
        T[_p36] = _t.replace(_k, "null sentinel distinct from empty string")
        _seeded += 1

    _t = T[_p50]
    _i = _t.find("| **20** | **Journal canonicalisation specification**")
    _j = _t.find("\n", _i)
    if _i > 0:
        T[_p50] = (_t[:_i]
                   + "| **20** | **Journal canonicalisation specification** (v1.2, SR-A3) "
                     "\u2014 `ACOS-JCS-1`: column order per row kind, decimal scales, "
                     "timestamp format, null sentinel, Unicode form, JSON canonicalisation, "
                     "framing | \u2014 | Owner, second factor | **All effects.** A change "
                     "silently breaks both hash chains and every downstream integrity claim |"
                   + _t[_j:])
        _seeded += 1

    print(f"# SEEDED: v1.2's one-byte 0x00 NULL sentinel restored in memory "
          f"({_seeded}/6 edits applied). F1-F3 MUST FAIL.\n")

if SEED_OLD_NULL_BYTES:
    # The sharper control: the worked-example table SURVIVES, and only SQL NULL's
    # bytes revert to v1.2's framed sentinel. F3 must then fail on the collision
    # itself -- SQL NULL and a one-byte 0x00 bytea printing the same bytes -- which
    # is the exact defect JCS-01 corrects.
    _p30 = ROOT / "deliverables/30-observability-audit-and-escalation.md"
    _old = "| SQL `NULL` | `FF FF FF FF` — the reserved word, **no payload** |"
    _new = "| SQL `NULL` | `00 00 00 01 00` — the one-byte sentinel, framed |"
    _hit = _old in T[_p30]
    if _hit:
        T[_p30] = T[_p30].replace(_old, _new)
    print(f"# SEEDED: v1.2's framed NULL bytes restored in the worked-example table "
          f"({'applied' if _hit else 'NOT APPLIED'}). F3 MUST FAIL on the collision.\n")

# ============================================================================
# v1.3.3 NEGATIVE CONTROLS (APF-01, MLT-01, FHT-01, SWR-01).
#
# A consistency condition that has never failed is indistinguishable from one
# that cannot. Each flag below mutates the IN-MEMORY corpus and at least one of
# G1-G10 must then FAIL. Nothing on disk is modified.
#
#   --seed-floor-25            approval floor declared as $25.00        -> G1, G3, G7-adjacent
#   --seed-vendor-amount       the operand switched to vendor_amount    -> G1, G4
#   --seed-lag-10m             one site states a 10-minute lag threshold-> G5
#   --seed-full-halt-15m       full halt declared at 15 minutes         -> G6, G7
#   --seed-quota-as-cause      quota saturation made a valid cause      -> G8, G10
#   --seed-generic-insert-fail "any INSERT failure" derivation          -> G9, G10
# ============================================================================
SEED_FLOOR_25 = "--seed-floor-25" in sys.argv
SEED_VENDOR_AMOUNT = "--seed-vendor-amount" in sys.argv
SEED_LAG_10M = "--seed-lag-10m" in sys.argv
SEED_FULL_HALT_15M = "--seed-full-halt-15m" in sys.argv
SEED_QUOTA_AS_CAUSE = "--seed-quota-as-cause" in sys.argv
SEED_GENERIC_INSERT_FAIL = "--seed-generic-insert-fail" in sys.argv

_P30 = ROOT / "deliverables/30-observability-audit-and-escalation.md"
_P51 = ROOT / "deliverables/51-limits-fixture.md"

def _seed(path, old, new):
    """Replace in the in-memory corpus. Returns 1 on a hit, 0 otherwise."""
    if old in T[path]:
        T[path] = T[path].replace(old, new)
        return 1
    return 0

if SEED_FLOOR_25:
    n = 0
    # The declaration itself, back to the conflated $25.00 figure.
    n += _seed(_P51, "`degraded_per_action_approval_floor_monetary` | **USD 20.00**",
                     "`degraded_per_action_approval_floor_monetary` | **USD 25.00**")
    n += _seed(_P51, "**strict**: `total_exposure > 20.00` is ABOVE",
                     "**strict**: `total_exposure > 25.00` is ABOVE")
    n += _seed(_P30, "**`degraded_per_action_approval_floor_monetary` = USD 20.00** (`51 §3.7`)",
                     "**`degraded_per_action_approval_floor_monetary` = USD 25.00** — the same "
                     "figure as the $25 per-action approval floor")
    print(f"# SEEDED: the approval floor declared as $25.00, equated with per_action_max "
          f"({n}/3 edits applied). G1 and G3 MUST FAIL.\n")

if SEED_VENDOR_AMOUNT:
    n = 0
    n += _seed(_P51, "| **Comparison operand** | `effect.request.exposure.total_exposure`.",
                     "| **Comparison operand** | `effect.request.exposure.vendor_amount`.")
    n += _seed(_P30, "**The comparison operand is `effect.request.exposure.total_exposure`, "
                     "and nothing else.**",
                     "**The comparison operand is `effect.request.exposure.vendor_amount`.**")
    print(f"# SEEDED: the degraded approval-floor operand switched to vendor_amount "
          f"({n}/2 edits applied). G1 and G4 MUST FAIL.\n")

if SEED_LAG_10M:
    n = _seed(_P30, "Mirror lag at or above `mirror_lag_critical_threshold` "
                    "(**15 minutes**, `51 §3.8`)",
                    "Mirror lag at or above `mirror_lag_critical_threshold` "
                    "(**10 minutes**, `51 §3.8`)")
    print(f"# SEEDED: 30 §5.1 item 5 states a 10-minute mirror-lag threshold "
          f"({'applied' if n else 'NOT APPLIED'}). G5 MUST FAIL on the disagreeing site.\n")

if SEED_FULL_HALT_15M:
    n = 0
    n += _seed(_P51, "`audit_unreachable_full_halt_threshold` | **30 minutes** | `PT30M`",
                     "`audit_unreachable_full_halt_threshold` | **15 minutes** | `PT15M`")
    n += _seed(_P30, "**`audit_unreachable_full_halt_threshold` = 30 minutes (`PT30M`)** "
                     "(`51 §3.8`)",
                     "**`audit_unreachable_full_halt_threshold` = 15 minutes (`PT15M`)** "
                     "(`51 §3.8`)")
    print(f"# SEEDED: the full-halt threshold collapsed onto the 15-minute lag threshold "
          f"({n}/2 edits applied). G6 and G7 MUST FAIL.\n")

if SEED_QUOTA_AS_CAUSE:
    n = 0
    n += _seed(_P30, "**audit insertion quota is available** for the principal in the current "
                     "window;",
                     "audit insertion quota may be saturated, which is itself a valid cause;")
    n += _seed(_P30, "audit insert-quota saturation · malformed payload",
                     "malformed payload")
    n += _seed(_P30, "**AUDIT QUOTA SATURATION REMAINS INCIDENT-ONLY AND MUST NEVER CHANGE "
                     "MIRROR MODE.**",
                     "Audit quota saturation is a store-write availability failure and "
                     "publishes STORE_WRITE_REJECTED.")
    print(f"# SEEDED: audit quota saturation made a valid STORE_WRITE_REJECTED cause "
          f"({n}/3 edits applied). G8 and G10 MUST FAIL.\n")

if SEED_GENERIC_INSERT_FAIL:
    n = 0
    n += _seed(_P30, "if and only if **all ten** of the following hold",
                     "whenever the audit store's INSERT fails for any reason, without "
                     "regard to the following")
    n += _seed(_P30, "**fail-closed for every unknown or unenumerated storage error**",
                     "open-ended, and an unknown storage error maps into the class")
    n += _seed(_P30, "· any unknown or unclassified storage error.",
                     ".")
    print(f"# SEEDED: the generic \"any INSERT failure -> store rejected\" derivation "
          f"({n}/3 edits applied). G9 and G10 MUST FAIL.\n")

# ============================================================================
# v1.3.4 NEGATIVE CONTROLS (IRN-01, CSB-01, OBX-01, OBX-02, JCS-02).
#
# Same rule as every prior pass: a condition that has never failed is
# indistinguishable from one that cannot. Each flag below mutates the IN-MEMORY
# corpus and at least one of H1-H13 must then FAIL. Nothing on disk is modified.
#
#   --seed-model-case-ref      case_ref becomes a ProposedIntent field   -> H1
#   --seed-claim-case-ref      the claim takes a caller case_ref         -> H1, H2
#   --seed-global-clock-search a NULL case_ref searches every clock      -> H3
#   --seed-irrecoverable-halt  row 1 back to Halt in NORMAL              -> H5
#   --seed-irrecoverable-loose row 1 eligible in the degraded states     -> H6, H7
#   --seed-reclaim-timeout     a visibility timeout returns CLAIMED rows -> H10
#   --seed-outbox-irrecoverable-only  outbox restricted to IRRECOVERABLE -> H11
#   --seed-swap-claim-fields   two claim-row fields transposed           -> H12
# ============================================================================
SEED_MODEL_CASE_REF = "--seed-model-case-ref" in sys.argv
SEED_CLAIM_CASE_REF = "--seed-claim-case-ref" in sys.argv
SEED_GLOBAL_CLOCK_SEARCH = "--seed-global-clock-search" in sys.argv
SEED_IRRECOVERABLE_HALT = "--seed-irrecoverable-halt" in sys.argv
SEED_IRRECOVERABLE_LOOSE = "--seed-irrecoverable-loose" in sys.argv
SEED_RECLAIM_TIMEOUT = "--seed-reclaim-timeout" in sys.argv
SEED_OUTBOX_IRRECOVERABLE_ONLY = "--seed-outbox-irrecoverable-only" in sys.argv
SEED_SWAP_CLAIM_FIELDS = "--seed-swap-claim-fields" in sys.argv

_P22 = ROOT / "deliverables/22-architecture-principles.md"
_P25 = ROOT / "deliverables/25-workflow-and-event-architecture.md"

if SEED_MODEL_CASE_REF:
    n = 0
    n += _seed(_P30, "**KERNEL-OWNED. IMMUTABLE. NEVER MODEL-SUPPLIED.**",
                     "Supplied on the `ProposedIntent` by the proposing worker and carried "
                     "through as given.")
    n += _seed(_P30, "**It MUST NOT come from any of:** `ProposedIntent`; `rationale`;",
                     "It is read from: `ProposedIntent`; `rationale`;")
    print(f"# SEEDED: case_ref becomes a model-supplied ProposedIntent field "
          f"({n}/2 edits applied). H1 MUST FAIL.\n")

if SEED_CLAIM_CASE_REF:
    n = 0
    n += _seed(_P30, "a caller-supplied claim-time argument; ", "")
    n += _seed(_P30, "**The effect supplies exactly one thing: its immutable authoritative "
                     "`case_ref`.**",
                     "The caller passes the `case_ref` to evaluate as a claim-time argument.")
    print(f"# SEEDED: the claim surface takes a caller-supplied case_ref "
          f"({n}/2 edits applied). H1 and H2 MUST FAIL.\n")

if SEED_GLOBAL_CLOCK_SEARCH:
    n = _seed(_P30, "**A NULL `case_ref` never means \"search for any clock that fits.\"** "
                    "There is no global clock search, no nearest-case match, no fallback and "
                    "no heuristic.",
                    "A NULL `case_ref` falls back to a search over every live clock of the "
                    "company and matches the nearest case.")
    print(f"# SEEDED: a NULL case_ref performs a global clock search "
          f"({'applied' if n else 'NOT APPLIED'}). H3 MUST FAIL.\n")

if SEED_IRRECOVERABLE_HALT:
    n = 0
    n += _seed(_P22, "| 1 | IRRECOVERABLE | **Dispatch** — subject to every ordinary authority "
                     "requirement (v1.3.4, IRN-01, `30 §5.1b`) | **Halt** | **Halt** |",
                     "| 1 | IRRECOVERABLE | **Halt** | **Halt** | **Halt** |")
    n += _seed(_P30, "> | `NORMAL` | **Dispatch** |",
                     "> | `NORMAL` | **Halt** |")
    n += _seed(_P30, "| `NORMAL` | **DISPATCH_ELIGIBLE**, row 1 | n/a — already eligible |",
                     "| `NORMAL` | **HALT**, row 1 | No |")
    print(f"# SEEDED: row 1 restored to Halt in NORMAL, the v1.3.3 defect "
          f"({n}/3 edits applied). H5 MUST FAIL.\n")

if SEED_IRRECOVERABLE_LOOSE:
    n = 0
    n += _seed(_P22, "| 1 | IRRECOVERABLE | **Dispatch** — subject to every ordinary authority "
                     "requirement (v1.3.4, IRN-01, `30 §5.1b`) | **Halt** | **Halt** |",
                     "| 1 | IRRECOVERABLE | **Dispatch** | **Dispatch** | **Dispatch** |")
    n += _seed(_P30, "> | `UNCORROBORATED_STALL` | **Halt** |\n> | `CORROBORATED_DEGRADED` | **Halt** |",
                     "> | `UNCORROBORATED_STALL` | **Dispatch** |\n> | `CORROBORATED_DEGRADED` | **Dispatch** |")
    n += _seed(_P30, "| `UNCORROBORATED_STALL` | **HALT**, row 1 | **No** |\n"
                     "| `CORROBORATED_DEGRADED` | **HALT**, row 1 | **No** |",
                     "| `UNCORROBORATED_STALL` | **DISPATCH_ELIGIBLE**, row 1 | n/a |\n"
                     "| `CORROBORATED_DEGRADED` | **DISPATCH_ELIGIBLE**, row 1 | n/a |")
    print(f"# SEEDED: row 1 made eligible in the degraded states too "
          f"({n}/3 edits applied). H6 and H7 MUST FAIL.\n")

if SEED_RECLAIM_TIMEOUT:
    n = 0
    n += _seed(_P25, "**`CLAIMED` HAS NO TIMEOUT, NO LEASE, NO EXPIRY AND NO RECLAIM.**",
                     "A `CLAIMED` row carries a visibility timeout and returns to `ENQUEUED` "
                     "when the lease expires.")
    n += _seed(_P25, "no stale-lease reaper, no attempt counter that resets a claim, and no "
                     "elapsed time of any length that returns a `CLAIMED` row to `ENQUEUED`",
                     "a stale-lease reaper returns abandoned claims after the visibility "
                     "timeout elapses")
    print(f"# SEEDED: a visibility timeout reclaims CLAIMED rows "
          f"({n}/2 edits applied). H10 MUST FAIL.\n")

if SEED_OUTBOX_IRRECOVERABLE_ONLY:
    n = 0
    n += _seed(_P25, "**The ACOS dispatch outbox applies to every effect that will cross an "
                     "external-write boundary** (`48`), whatever its recoverability class.",
                     "The ACOS dispatch outbox applies to irrecoverable sends only.")
    n += _seed(_P25, "**The scope predicate is `effect requires external dispatch`.**",
                     "The scope predicate is `effect.recoverability == IRRECOVERABLE`.")
    print(f"# SEEDED: the outbox restricted to IRRECOVERABLE effects "
          f"({n}/2 edits applied). H11 MUST FAIL.\n")

if SEED_SWAP_CLAIM_FIELDS:
    n = _seed(_P30, "| 8 | `effect_id` | text | joins to the `EFFECT_AUTHORISATION` row |\n"
                    "| 9 | `authorisation_id` | text | |",
                    "| 8 | `authorisation_id` | text | |\n"
                    "| 9 | `effect_id` | text | joins to the `EFFECT_AUTHORISATION` row |")
    print(f"# SEEDED: fields 8 and 9 of the claim row transposed "
          f"({'applied' if n else 'NOT APPLIED'}). H12 MUST FAIL.\n")

results = []
def cond(cid, desc, ok, detail=""):
    results.append((cid, desc, "PASS" if ok else "FAIL", detail))

HIST = re.compile(r"T[AB]-\d\d|TJ-01|TOS-\d\d|v1\.0|v1\.1|v1\.2|historical|Historical|superseded|Superseded|retired|Retired|previously|change record|changelog|`43 |`54 |`52 |`47 |`57 |`58 |`59 |`60 |`61 |`62 ", re.M)

def lines_with(pat, corpus=OPERATIONAL, flags=0):
    out=[]
    rx = re.compile(pat, flags)
    for p in corpus:
        for i, ln in enumerate(T[p].splitlines(), 1):
            if rx.search(ln): out.append((p.name, i, ln.strip()))
    return out

def nonhistorical(hits):
    return [h for h in hits if not HIST.search(h[2])]

# C1 — all fourteen blocker ids present exactly once as ledger entries
ledger = T[ROOT/"phase2-v1.3-remediation-ledger.md"]
BLOCKERS = [f"TA-0{i}" for i in range(1,8)] + [f"TB-0{i}" for i in range(1,7)] + ["TJ-01"]
missing = [b for b in BLOCKERS if f"### {b} —" not in ledger]
cond("C1","Fourteen BLOCKING ids each have exactly one ledger entry heading",
     not missing and len(BLOCKERS)==14, f"missing headings: {missing}" if missing else "14/14")

# C2 — no NOT APPLIED
import re as _re
dispos = _re.findall(r"\|\s*\*\*Disposition\*\*\s*\|\s*\*\*([^*]+)\*\*\s*\|", ledger)
bad_d = [d for d in dispos if d.strip() not in ("APPLIED","APPLIED WITH EXPLICIT RESIDUAL")]
cond("C2","Every ledger disposition is APPLIED or APPLIED WITH EXPLICIT RESIDUAL; zero NOT APPLIED",
     len(dispos)==14 and not bad_d,
     f"{len(dispos)} dispositions: {sorted(set(dispos))}")

# C3 — new verification cases present in 36
d36 = T[ROOT/"deliverables/36-architecture-validation-plan.md"]
newvc = ["VC-A1d","VC-A2c","VC-A2d","VC-A2e","VC-A2f","VC-S5","VC-S6","VC-S7","VC-S8"]
absent = [v for v in newvc if v not in d36]
cond("C3","All nine v1.3 verification cases present in 36", not absent, f"absent: {absent}" if absent else "9/9")

# C4 — every deliverable declares v1.3 in its version line
bad=[p.name for p in DELIV if "Operating Spine v1.3" not in T[p].split("\n\n")[1]]
cond("C4","Every numbered deliverable declares v1.3 in its version line", not bad, f"{bad}" if bad else "21/21")

# C5 — MAL_total signature basis: 756.00 stated identically, and NOWHERE in a superseded form
hits600 = nonhistorical(lines_with(r"MAL_total.{0,80}\$600|\$600.{0,80}MAL_total|MAL_total\(month\)\s*=\s*\$600"))
cond("C5","MAL_total signature basis $756.00; no operational passage states $600 as a current MAL_total",
     not hits600, f"{hits600}" if hits600 else "no superseded MAL_total in operational text")

# C6 — Standing(month) 31-day: 186.00; no operational passage states $180 AS STANDING
hits180 = nonhistorical(lines_with(r"\$180(\.00)?\s*standing|standing[^.]{0,20}\$180|\$180 standing"))
cond("C6","Standing(month) 31-day is $186.00; no operational passage states $180 as standing",
     not hits180, f"{hits180}" if hits180 else "no superseded standing basis in operational text")

# C23 — semantic superseded combinations, denylist (TB-09 / TOS-04 repair)
DENY = [
  (r"MAL_total\(day\).{0,20}\$?173\.50", "MAL_total(day) = 173.50"),
  (r"\$5,?205", "30x daily = 5,205"),
  (r"\$120 irrecoverable", "MIE 120 as current"),
  (r"roughly 24 items", "LIM-09 pending-approval bound"),
  (r"cessation_lag`? (is|interval)", "retired scalar cessation_lag used as an operand"),
  (r"the last referenced window", "TB-02 referentless phrase"),
  (r"six omission cases", "pre-TA-01 case count"),
  (r"any → EXPIRED|any \| EXPIRED", "TB-06 any-source transition"),
]
c23fail=[]
for pat, label in DENY:
    h = nonhistorical(lines_with(pat, DELIV))
    if h: c23fail.append((label, h[:3]))
cond("C23","Semantic superseded combinations absent from operational passages",
     not c23fail, f"{c23fail}" if c23fail else f"{len(DENY)} denylist patterns, 0 operational hits")

# C21 — mirror-outage behaviour is state-qualified everywhere it is stated (TA-07)
MIRROR = re.compile(r"mirror (is )?unreachable|Audit mirror unreachable|mirror outage|network partition between (the )?control plane and (the )?audit", re.I)
STATE  = re.compile(r"UNCORROBORATED_STALL|CORROBORATED_DEGRADED|three-state|state-qualified|§5\.6")
unqual=[]
for p in OPERATIONAL:
    for i, ln in enumerate(T[p].splitlines(),1):
        if MIRROR.search(ln) and not STATE.search(ln) and not HIST.search(ln):
            unqual.append((p.name,i,ln.strip()[:120]))
cond("C21","Every operational mirror-outage behaviour statement carries the state qualifier",
     not unqual, f"{unqual}" if unqual else "no unqualified operational statements")

# C22 — printed enforcement expressions contain their invariant's operand set (rule 9 / TB-01)
k5 = T[ROOT/"deliverables/24-company-state-and-evidence-model.md"]
guard = re.search(r"IF \(NEW\.reserved_monetary.*?RAISE 'I3_WINDOW_EXHAUSTED';", k5, re.S)
ops = ["reserved_monetary","standing_monetary","presumed_monetary","realised_monetary"]
g = guard.group(0) if guard else ""
missing_ops = [o for o in ops if o not in g]
cond("C22","The printed I3 commitment guard contains exactly the four declared operands",
     bool(guard) and not missing_ops,
     f"missing {missing_ops}" if missing_ops else "reserved+standing+presumed+realised present")

# C24 — REVOKED has zero outbound transitions wherever the machine is stated
rev_bad=[]
for p in OPERATIONAL:
    for i, ln in enumerate(T[p].splitlines(),1):
        if re.search(r"`?REVOKED`?\s*\|\s*(LIVE|PAUSED|EXPIRED|PAUSE_PENDING)", ln) and not HIST.search(ln):
            rev_bad.append((p.name,i,ln.strip()[:120]))
cond("C24","REVOKED has zero outbound transitions in every operational transition statement",
     not rev_bad, f"{rev_bad}" if rev_bad else "no outbound REVOKED transition found")

# C25 — I8 detection bound never printed as a single number
badbound = nonhistorical(lines_with(r"inverse-sweep cadence|Inverse-sweep cadence", DELIV))
cond("C25","No operational passage states the I8 bound as an undeclared 'inverse-sweep cadence'",
     not badbound, f"{badbound}" if badbound else "all sites read sweep_cadence + vendor_reporting_lag")

# C26 — every new identifier resolves in the registry and is cited in >=2 artifacts
reg = T[ROOT/"phase2-v1.3-invariant-registry.md"]
newids = ["I62","I63"]
bad=[]
for nid in newids:
    if f"**{nid}**" not in reg: bad.append((nid,"absent from registry"))
    cites = sum(1 for p in OPERATIONAL if nid in T[p])
    if cites < 2: bad.append((nid, f"cited in {cites} artifacts"))
cond("C26","New identifiers I62 and I63 resolve in the registry and are cited in >=2 artifacts",
     not bad, f"{bad}" if bad else "both resolve, both multiply cited")

# C27 — no unresolved invariant identifier anywhere
declared = set(re.findall(r"\*\*(I\d+[a-f]?)\*\*", reg))
used = set()
for p in OPERATIONAL: used |= set(re.findall(r"\b(I\d{1,2}[a-f]?)\b", T[p]))
unresolved = sorted(u for u in used if u not in declared and u not in {"I18","I44"})
cond("C27","Every invariant identifier used in an operational artifact resolves in the registry",
     not unresolved, f"unresolved: {unresolved}" if unresolved else f"{len(declared)} declared")

# C28 — DB-enforced enumeration count matches the stated headline
enum = re.search(r"I1 \(FK\).*?\.\n", reg, re.S).group(0)
n = enum.count("·")+1
cond("C28","The §2.8 DB-enforced enumeration contains 25 rows, matching §0 (v1.3.4: 23 -> 25)",
     n==25 and "**25** are database-enforced" in reg, f"enumerated {n}")

# C29 — registry arithmetic 60 + 13 = 73 (v1.3.4: I64, I65, I66 added to the MVP set)
cond("C29","Registry counts are arithmetically consistent (60 + 13 = 73)",
     "**73 identifiers**" in reg and "60 + 13 = 73" in reg.replace("**",""), "")

# ============================================================================
# v1.3.1 ERRATA CONDITIONS (E1–E7). Added by the Phase 2.5a normative errata
# pass. Every one is written so it CAN return FAIL.
# ============================================================================

# An occurrence is HISTORICAL for errata purposes only when the line says so.
# The v1.3 HIST regex above is deliberately looser (it treats any "v1.2" or
# "TB-0x" mention as history) and that looseness is why E1 and E4's defects
# survived the v1.3 pass. E1/E3/E4 use this stricter marker instead.
EXPLICIT_HIST = re.compile(
    r"retired|Retired|superseded|Superseded|historical|Historical|"
    r"replaced|replaces|v1\.2 carried|no longer|then-current|Supersedes|"
    r"at the time of")

def explicit_hits(pat, corpus=OPERATIONAL, flags=0):
    """Lines matching pat that are NOT explicitly marked historical."""
    return [h for h in lines_with(pat, corpus, flags) if not EXPLICIT_HIST.search(h[2])]

d26 = T[ROOT/"deliverables/26-authority-and-policy-model.md"]
d51 = T[ROOT/"deliverables/51-limits-fixture.md"]

# ---------------------------------------------------------------- E1
# Rate-class semantics: total_exposure == ordinary reservation == 0.00, and the
# economic quantity is I3 term 2. No normative passage may say term 1 holds it.
E1_REQUIRED = [
    (d26, "| `exposure.total_exposure` | **`0.00`**",
          "26 §2.1.3 declares total_exposure = 0.00 for rate classes"),
    (d26, "`reservation.amount == total_exposure == 0.00`",
          "26 §2.1.3 declares the exact I18b equality at zero"),
    (d26, "**Ordinary, non-rate class.**",
          "26 §7 step R states the ordinary branch"),
    (d26, "**Rate class.**",
          "26 §7 step R states the rate branch"),
    (d26, "**`forward_integral` is never the ordinary reservation amount.**",
          "26 §7 step R forbids the term-1 reading explicitly"),
    (d26, "context.exposure.total_exposure == 0.00",
          "26 §8 worked policy carries the zero conjunct"),
    (d26, "no normative passage may describe `forward_integral` as the ordinary reservation amount",
          "26 §2.1.3 carries the E1 consistency condition"),
    (d51, "`total_exposure = 0.00`",
          "51 declares campaign.budget.set as zero-monetary-reservation"),
]
e1_missing = [why for body, needle, why in E1_REQUIRED if needle not in body]

E1_DENY = [
    (r"rate-based classes it reserves",        "step R's superseded wording"),
    (r"reserves? `?forward_exposure",          "forward_exposure as the reserved quantity"),
    (r"reserves? (the )?forward integral",     "forward integral as the reserved quantity"),
    (r"reservation is the \*\*forward integral", "reservation identified with the integral"),
    (r"forward integral for rate classes",     "forward integral inside the RESERVE node"),
    (r"reserve[sd]? `?forward_integral",       "forward_integral reserved"),
    (r"forward exposure is reserved to",       "standing exposure described as a reservation"),
]
e1_deny_hits = []
for pat, label in E1_DENY:
    h = explicit_hits(pat)
    if h:
        e1_deny_hits.append((label, h[:3]))

cond("E1", "Rate-class semantics consistent: total_exposure = ordinary reservation = 0.00, "
           "economic exposure in I3 term 2, no term-1 reading anywhere normative",
     not e1_missing and not e1_deny_hits,
     f"missing: {e1_missing}; denylist: {e1_deny_hits}" if (e1_missing or e1_deny_hits)
     else f"8 required statements present; {len(E1_DENY)} denylist patterns, 0 normative hits")

# ---------------------------------------------------------------- E2
# The ledger disposition summary is COMPUTED from the entries, never carried.
entries = re.split(r"^### ((?:TA|TB|TJ)-\d\d) —", ledger, flags=re.M)
per_entry = {}
for i in range(1, len(entries), 2):
    m = re.search(r"\|\s*\*\*Disposition\*\*\s*\|\s*\*\*([^*]+)\*\*\s*\|", entries[i+1])
    if m:
        per_entry[entries[i]] = m.group(1).strip()
import collections as _c
tally = _c.Counter(per_entry.values())
n_applied  = tally.get("APPLIED", 0)
n_residual = tally.get("APPLIED WITH EXPLICIT RESIDUAL", 0)
n_not      = sum(v for k, v in tally.items()
                 if k not in ("APPLIED", "APPLIED WITH EXPLICIT RESIDUAL"))

def printed(label):
    m = re.search(r"^\| " + re.escape(label) + r" \| (\d+) \|$", ledger, re.M)
    return int(m.group(1)) if m else None

printed_applied  = printed("APPLIED")
printed_residual = printed("APPLIED WITH EXPLICIT RESIDUAL")

# per-group breakdown, also computed
grp = {g: _c.Counter(v for k, v in per_entry.items() if k.startswith(g))
       for g in ("TA", "TB", "TJ")}
grp_rows = re.findall(r"^\| (?:Mechanism A|Mechanism B|Joint)[^|]*\|[^|]*\| (\d+) \| (\d+) \|$",
                      ledger, re.M)
grp_expected = [(str(grp[g].get("APPLIED", 0)),
                 str(grp[g].get("APPLIED WITH EXPLICIT RESIDUAL", 0))) for g in ("TA", "TB", "TJ")]

e2_ok = (len(per_entry) == 14
         and (n_applied, n_residual, n_not) == (7, 7, 0)
         and printed_applied == n_applied
         and printed_residual == n_residual
         and grp_rows == grp_expected)
cond("E2", "Ledger disposition summary is computed from the entries and equals 7 / 7 / 0",
     e2_ok,
     f"computed {n_applied} APPLIED / {n_residual} RESIDUAL / {n_not} NOT APPLIED over "
     f"{len(per_entry)} entries; printed {printed_applied} / {printed_residual}; "
     f"groups computed {grp_expected} printed {grp_rows}")

# ---------------------------------------------------------------- E3
# No current normative artifact cites a superseded invariant registry as authority.
SUPERSEDED_REG = r"phase2-v1\.[12]-invariant-registry\.md"
e3_all  = lines_with(SUPERSEDED_REG)
e3_live = [h for h in e3_all if not EXPLICIT_HIST.search(h[2])]
cond("E3", "No operational artifact references a superseded invariant registry as current authority",
     not e3_live,
     f"{len(e3_all)} total references, {len(e3_live)} normative"
     + (f": {e3_live}" if e3_live else " (all remaining are explicitly historical)"))

# ---------------------------------------------------------------- E4
# The scalar cessation_lag is retired as the I54 operand.
e4_all  = lines_with(r"cessation_lag")
e4_live = [h for h in e4_all if not EXPLICIT_HIST.search(h[2])]
e4_spec = ("cessation specification" in T[ROOT/"phase2-v1.3-invariant-registry.md"]
           and "cessation specification" in T[ROOT/"deliverables/51-limits-fixture.md"]
           and "cessation specification" in T[ROOT/"deliverables/24-company-state-and-evidence-model.md"])
e4_default = "no `REVOKED` transition is available" in T[ROOT/"deliverables/24-company-state-and-evidence-model.md"]
cond("E4", "Scalar cessation_lag is not the active I54 operand anywhere normative; "
           "the per-adapter cessation specification is, and the conservative default stands",
     not e4_live and e4_spec and e4_default,
     f"{len(e4_all)} total references, {len(e4_live)} active"
     + (f": {e4_live}" if e4_live else "; specification named in registry, 24 and 51; "
        "no-REVOKED default present"))

# ---------------------------------------------------------------- E5
brief = T[ROOT/"phase2-v1.3-implementation-brief.md"]
sec7 = re.search(r"^## 7\. .*?(?=^## 8\.)", brief, re.M | re.S)
nums = re.findall(r"^(\d+)\. ", sec7.group(0), re.M) if sec7 else []
cond("E5", "Implementation brief §7 contains exactly ten pass-revocation conditions numbered 1–10 once each",
     bool(sec7) and nums == [str(i) for i in range(1, 11)],
     f"found {len(nums)} numbered conditions: {nums}")

# ---------------------------------------------------------------- E6
# Audit-plane ownership count agrees in three places and is computed, not carried.
rows = re.findall(r"^\| \*\*(I\d+[a-f]?)\*\* \|(.*)$", reg, re.M)
audit_owned = set()
for iid, rest in rows:
    cells = [c.strip() for c in rest.split("|")]
    if len(cells) > 1 and "Audit" in cells[1]:
        audit_owned.add(iid)
n_audit = len(audit_owned)
d30 = T[ROOT/"deliverables/30-observability-audit-and-escalation.md"]
subset = re.search(r"I4 \(independent recomputation\).*?\n", d30)
listed = set(re.findall(r"I\d+[a-f]?", subset.group(0))) if subset else set()
reg_states = re.search(r"\*\*(\d+)\*\* rows name the audit plane as owner or co-owner", reg)
d30_states = re.search(r"\*\*Twenty-three of the registry's seventy", d30)
cond("E6", "Audit-plane ownership count agrees: registry §0, registry §1 owner column, and 30 §6.1's list",
     n_audit == 23 and listed == audit_owned
     and reg_states and int(reg_states.group(1)) == n_audit and bool(d30_states),
     f"owner column {n_audit}; 30 §6.1 lists {len(listed)}; registry §0 states "
     f"{reg_states.group(1) if reg_states else '?'}; symmetric difference "
     f"{sorted(listed ^ audit_owned) or 'none'}")

# ---------------------------------------------------------------- E7
e7_head = "### 2.8 The twenty-five database-enforced rows, enumerated" in reg
e7_body = "That is **twenty-five** rows, matching `§0`." in reg
e7_zero = "**25** are database-enforced" in reg
cond("E7", "The DB-enforced row count agrees between registry §0, §2.8's heading and §2.8's body",
     e7_head and e7_body and e7_zero,
     f"heading={e7_head} body={e7_body} §0={e7_zero}")

# ============================================================================
# v1.3.2 ERRATA CONDITIONS (F1-F3). Added by the Phase 2.5b normative errata
# pass, JCS-01: ACOS-JCS-1 NULL framing. Every one is written so it CAN FAIL,
# and --seed-old-null-sentinel demonstrates that it does.
# ============================================================================

d30 = T[ROOT/"deliverables/30-observability-audit-and-escalation.md"]
d36 = T[ROOT/"deliverables/36-architecture-validation-plan.md"]
d50 = T[ROOT/"deliverables/50-control-artifact-manifest.md"]

# A line stating the WITHDRAWN rule is historical only where it says so. The
# v1.3.1 EXPLICIT_HIST markers are extended with the words 30 §5.3 actually
# uses to record what v1.2 got wrong.
JCS_HIST = re.compile(EXPLICIT_HIST.pattern + r"|withdrawn|got wrong|not injective|v1\.2's rule")

def jcs_hits(pat, corpus=OPERATIONAL, flags=0):
    """Lines matching pat that are NOT marked as a record of the withdrawn rule."""
    return [h for h in lines_with(pat, corpus, flags) if not JCS_HIST.search(h[2])]

# ---------------------------------------------------------------- F1
# 30 §5.3 states the corrected NULL framing, and no normative line states the
# withdrawn one-byte sentinel as the rule.
F1_REQUIRED = [
    (d30, "**`0xFFFFFFFF` is RESERVED and means NULL**",
          "30 5.3 reserves the 32-bit NULL word"),
    (d30, "a NULL field is that word alone with no payload",
          "30 5.3 states NULL carries no payload"),
    (d30, "`0 <= payload_length <= 0xFFFFFFFE`",
          "30 5.3 bounds the non-null payload length"),
    (d30, "is not representable and the implementation must fail closed",
          "30 5.3 makes length overflow fail closed"),
    (d30, "disjoint by construction",
          "30 5.3 states the injectivity consequence"),
    (d30, "**No non-null payload rule changed in v1.3.2.**",
          "30 5.3 states the compatibility guarantee"),
    (d30, "changes class 20's signed content and therefore its `content_hash`",
          "30 5.3 records the control-artifact effect"),
]
f1_missing = [why for body, needle, why in F1_REQUIRED if needle not in body]

F1_DENY = [
    (r"sentinel byte for null",                "the withdrawn NULL sentinel stated as the rule"),
    (r"single `?0x00`? sentinel",              "the one-byte sentinel named as current"),
    (r"4-byte big-endian byte length\*\*, so", "the v1.2 framing row without the reserved word"),
]
f1_deny_hits = []
for pat, label in F1_DENY:
    h = jcs_hits(pat, flags=re.I)
    if h:
        f1_deny_hits.append((label, h[:3]))

cond("F1", "ACOS-JCS-1 NULL framing: reserved 0xFFFFFFFF word stated, payload bound stated, "
           "overflow fails closed, injectivity stated, no normative line carries the "
           "withdrawn one-byte sentinel",
     not f1_missing and not f1_deny_hits,
     f"missing: {f1_missing}; denylist: {f1_deny_hits}" if (f1_missing or f1_deny_hits)
     else f"{len(F1_REQUIRED)} required statements present; {len(F1_DENY)} denylist "
          f"patterns, 0 normative hits")

# ---------------------------------------------------------------- F2
# The two artifacts that cite the rule cite the CORRECTED rule. 36's VC-A3 is
# the validation case; 50's row 20 is the control-artifact class.
F2_REQUIRED = [
    (d36, "SQL NULL (`FF FF FF FF`) distinct from empty string",
          "36 VC-A3 requires the corrected NULL distinction"),
    (d36, "restoring v1.2's one-byte `0x00` NULL sentinel **must fail this case**",
          "36 VC-A3 requires the seeded old-rule negative control"),
    (d50, "**NULL framing under the reserved `0xFFFFFFFF` length word**",
          "50 row 20 names the corrected rule"),
    (d50, "changes this class's `content_hash` and requires a fresh owner signature",
          "50 row 20 records the signature consequence"),
]
f2_missing = [why for body, needle, why in F2_REQUIRED if needle not in body]
cond("F2", "The ACOS-JCS-1 cross-references agree with 30 5.3: 36's VC-A3 case and 50's "
           "class-20 row both carry the corrected NULL rule",
     not f2_missing,
     f"missing: {f2_missing}" if f2_missing
     else f"{len(F2_REQUIRED)} required cross-reference statements present")

# ---------------------------------------------------------------- F3
# The worked-example table is PARSED and its byte strings COMPARED. This is the
# condition the defect would have failed: under v1.2, SQL NULL and a one-byte
# 0x00 bytea printed the same bytes.
HEXBYTES = re.compile(r"^[0-9A-F]{2}(?: [0-9A-F]{2})*$")
f3_rows = []
_i = d30.find("| Value | `ACOS-JCS-1` framed bytes |")
if _i > 0:
    for _line in d30[_i:].splitlines()[2:]:
        if not _line.startswith("|"):
            break
        _cells = [c.strip() for c in _line.strip().strip("|").split("|")]
        if len(_cells) != 2:
            break
        _spans = [m.group(1) for m in re.finditer(r"`([^`]+)`", _cells[1])]
        _hexes = [x for x in _spans if HEXBYTES.match(x)]
        if len(_hexes) != 1:
            break
        f3_rows.append((_cells[0], _hexes[0]))

def _row(needle):
    return next((v for k, v in f3_rows if needle in k), None)

f3_null   = _row("SQL `NULL`")
f3_estr   = _row("empty string")
f3_ebytes = _row("empty `bytea`")
f3_zero   = _row("one byte, value zero")
f3_json   = _row("JSON literal `null`")
f3_values = [f3_null, f3_estr, f3_ebytes, f3_zero, f3_json]

f3_ok = (
    len(f3_rows) == 5
    and all(v is not None for v in f3_values)
    # the reserved word, and it belongs to NULL alone
    and f3_null == "FF FF FF FF"
    and [v for v in f3_values if v == "FF FF FF FF"] == ["FF FF FF FF"]
    # the two zero-length values are equal to each other and are length 0
    and f3_estr == f3_ebytes == "00 00 00 00"
    # every distinction the specification declares
    and f3_zero != f3_null
    and f3_zero != f3_estr
    and f3_json != f3_null
    and f3_json != f3_estr
    and f3_json != f3_zero
    # five printed rows, four distinct encodings
    and len({v for v in f3_values if v is not None}) == 4
)
cond("F3", "30 5.3's worked examples are pairwise distinct where the specification "
           "distinguishes them: SQL NULL is FF FF FF FF and nothing else is; empty string "
           "and empty bytea are both length 0; bytea 0x00 and JSON literal null differ "
           "from NULL",
     f3_ok,
     f"parsed {len(f3_rows)} rows: null={f3_null} emptyText={f3_estr} "
     f"emptyBytes={f3_ebytes} bytes00={f3_zero} jsonNull={f3_json}; "
     f"distinct={len({v for v in f3_values if v is not None})}")


# ============================================================================
# v1.3.3 ERRATA CONDITIONS (G1-G10). Added by the Phase 2.5c normative errata
# pass: APF-01 (the per-action approval floor), MLT-01 and FHT-01 (the two
# degraded-mode timing thresholds), SWR-01 (STORE_WRITE_REJECTED's derivation).
#
# Every one is written so it CAN FAIL, and the six --seed-* flags below
# demonstrate that each does. A verification suite that cannot fail these
# mutations is not evidence.
# ============================================================================

d22 = T[ROOT/"deliverables/22-architecture-principles.md"]
d35 = T[ROOT/"deliverables/35-failure-scenario-walkthroughs.md"]

# The authoritative declaration sites. G1 requires the quantity to live HERE and
# G2 requires every operational reference to resolve to it.
G_AUTH_FLOOR = "51 §3.7"
G_AUTH_TIMES = "51 §3.8"

# ---------------------------------------------------------------- G1
# The approval floor is declared, with its value, in the authoritative quantity
# location -- 51, the artifact whose job is declaring quantities.
G1_REQUIRED = [
    (d51, "### 3.7 The degraded-mode per-action approval floor",
          "51 declares an approval-floor section"),
    (d51, "`degraded_per_action_approval_floor_monetary` | **USD 20.00**",
          "51 §3.7's table row carries the identifier and USD 20.00"),
    (d51, "**OWNER DECISION / v1.3.3.**",
          "51 §3.7 records the provenance"),
    (d51, "`effect.request.exposure.total_exposure`",
          "51 §3.7 declares the comparison operand"),
    (d51, "**strict**: `total_exposure > 20.00` is ABOVE",
          "51 §3.7 declares the strict boundary semantics"),
    (d51, "Declaring the value moves class 3's `content_hash`",
          "51 §3.7 records the control-artifact effect"),
]
g1_missing = [why for body, needle, why in G1_REQUIRED if needle not in body]
cond("G1", "The $20.00 degraded per-action approval floor is declared in the authoritative "
           "quantity location (51 §3.7) with its identifier, units, operand, strict boundary "
           "semantics, OWNER DECISION provenance and control-artifact effect",
     not g1_missing,
     f"missing: {g1_missing}" if g1_missing
     else f"{len(G1_REQUIRED)} required statements present in 51 §3.7")

# ---------------------------------------------------------------- G2
# Every operational reference to the floor resolves to the declared operand: the
# specification section exists, and the three citing artifacts cite 51 §3.7.
G2_REQUIRED = [
    (d30, "### 5.1a The three quantities `§5.1` needs, declared",
          "30 §5.1a exists"),
    (d30, "**`degraded_per_action_approval_floor_monetary` = USD 20.00** (`51 §3.7`)",
          "30 §5.1a cites 51 §3.7 for the value"),
    (d30, "`degraded_per_action_approval_floor_monetary`, **$20.00**, `51 §3.7`",
          "30 §5.1 item 4 row 2 names the operand and its declaration site"),
    (d22, "**$20.00**, compared against `total_exposure` (`51 §3.7`, `30 §5.1a`)",
          "22 §3.1's row 2 resolves to the declared operand"),
    (d36, "above the declared `$20.00` approval floor\n(`51 §3.7`)".replace("\n", " "),
          "36's VC-A6 fixture resolves to the declared floor"),
]
g2_missing = [why for body, needle, why in G2_REQUIRED if needle not in body]
cond("G2", "Every operational reference to the degraded approval floor resolves to the declared "
           "operand: 30 §5.1a specifies it, and 30 §5.1 row 2, 22 §3.1 and 36's VC-A6 each cite "
           "51 §3.7",
     not g2_missing,
     f"missing: {g2_missing}" if g2_missing
     else f"{len(G2_REQUIRED)} citing statements present")

# ---------------------------------------------------------------- G3
# No operational passage equates the approval floor with the $25.00 per_action_max.
# The denylist is over LINES, and a line is exempt only where it explicitly
# records the conflation as v1.1's defect.
APF_HIST = re.compile(EXPLICIT_HIST.pattern +
                      r"|conflat|v1\.1 stated|v1\.1 also stated|different quantities|"
                      r"cannot be row 2's operand|would be \*\*empty\*\*|would be empty")
def apf_hits(pat, flags=re.I):
    return [h for h in lines_with(pat, OPERATIONAL, flags) if not APF_HIST.search(h[2])]

G3_DENY = [
    (r"\$25(\.00)?\s+(per-action\s+)?approval floor", "the floor stated as $25"),
    (r"approval floor[^.|]{0,40}\$25",                "the floor equated with $25"),
    (r"approval floor[^.|]{0,60}per_action_max",      "the floor equated with per_action_max"),
]
g3_hits = []
for pat, label in G3_DENY:
    h = apf_hits(pat)
    if h:
        g3_hits.append((label, h[:3]))
# And the distinction must be stated positively, not merely not-contradicted.
g3_positive = (
    "**The `$25.00` per-action Cedar bound is unchanged and is a different gate, evaluated "
    "earlier.**" in d30
    and "**A denied effect never reaches item 4's precedence list at all**" in d30
    and "Not `per_action_max`" in d51
)
cond("G3", "No operational passage equates the degraded approval floor with the $25.00 "
           "per_action_max, and 30 §5.1a plus 51 §3.7 state the distinction positively",
     not g3_hits and g3_positive,
     f"denylist: {g3_hits}; positive={g3_positive}" if (g3_hits or not g3_positive)
     else f"{len(G3_DENY)} denylist patterns, 0 non-historical hits; distinction stated")

# ---------------------------------------------------------------- G4
# The degraded comparison uses total_exposure, and vendor_amount is excluded by name.
g4_operand = "`effect.request.exposure.total_exposure`, and nothing else.**" in d30
g4_excl = ("Not `exposure.vendor_amount`, not a dispatch amount, not a model-supplied amount, "
           "not an amount recovered from a `rationale`, and not a figure appearing in grant "
           "prose." in d30)
g4_fixture = "**The operand is `total_exposure`, derived by trusted code from the effect's own " \
             "exposure and never supplied by a caller as a boolean.**" in d36
g4_deny = [h for h in lines_with(r"approval floor[^.|]{0,80}vendor_amount", OPERATIONAL, re.I)
           if "Not `exposure.vendor_amount`" not in h[2] and "not `vendor_amount`" not in h[2]]
cond("G4", "The degraded approval-floor comparison uses total_exposure; vendor_amount, dispatch "
           "amounts, model amounts, rationale amounts and grant prose are excluded by name, and "
           "36's fixture forbids a caller-supplied boolean",
     g4_operand and g4_excl and g4_fixture and not g4_deny,
     f"operand={g4_operand} exclusions={g4_excl} fixture={g4_fixture} deny={g4_deny[:2]}")

# ---------------------------------------------------------------- G5
# The mirror-lag threshold is exactly 15 minutes EVERYWHERE it is stated, and its
# operand, inclusive boundary and non-authority kind are declared.
G5_REQUIRED = [
    (d51, "### 3.8 Degraded-mode timing thresholds",
          "51 declares a timing-threshold section"),
    (d51, "`mirror_lag_critical_threshold` | **15 minutes** | `PT15M`",
          "51 §3.8's row carries the identifier, 15 minutes and PT15M"),
    (d51, "`mirror_lag >= PT15M` is at or over the threshold. `14:59.999999` under, "
          "`15:00.000000` at, `15:00.000001` over",
          "51 §3.8 declares the inclusive boundary at timestamp precision"),
    (d30, "**`mirror_lag_critical_threshold` = 15 minutes (`PT15M`)** (`51 §3.8`)",
          "30 §5.1a transcribes the value and cites 51 §3.8"),
    (d30, "`mirror_lag >= 15 minutes` **is at or over the threshold**",
          "30 §5.1a states the inclusive semantics normatively"),
    (d30, "It **cannot** create `CORROBORATED_DEGRADED`, **cannot** fabricate or substitute "
          "for a `MirrorInputStallSignal`, **cannot** grant or extend a "
          "`DegradedModeOverride`, and **cannot** move any monetary limit.",
          "30 §5.1a forbids the lag condition from unlocking anything"),
    (d30, "`mirror_lag_critical_threshold` (**15 minutes**, `51 §3.8`)",
          "30 §5.1 item 5 names the threshold and its site"),
    (d35, "`mirror_lag_critical_threshold` (**15 minutes**, `51 §3.8`)",
          "35 §12.1's walkthrough carries the declared value"),
]
g5_missing = [why for body, needle, why in G5_REQUIRED if needle not in body]
# Any operational line stating a NUMERIC mirror-lag threshold must state 15.
g5_wrong = []
for name, ln, txt in lines_with(r"mirror[- _]lag[^.|]{0,80}?(\d+)\s*minute", OPERATIONAL, re.I):
    for m in re.finditer(r"mirror[- _]lag[^.|]{0,80}?(\d+)\s*minute", txt, re.I):
        if m.group(1) != "15":
            g5_wrong.append((name, ln, m.group(0)))
cond("G5", "The mirror-lag CRITICAL threshold is exactly 15 minutes at every site that states a "
           "value, with its operand, inclusive boundary at timestamp precision, and its "
           "inability to create state, fabricate a signal, grant an override or move a limit",
     not g5_missing and not g5_wrong,
     f"missing: {g5_missing}; wrong values: {g5_wrong[:3]}" if (g5_missing or g5_wrong)
     else f"{len(G5_REQUIRED)} required statements present; 0 sites state a value other than 15")

# ---------------------------------------------------------------- G6
# The full-halt threshold is exactly 30 minutes everywhere, with a declared
# operand, declared timer start/reset semantics and an inclusive boundary.
G6_REQUIRED = [
    (d51, "`audit_unreachable_full_halt_threshold` | **30 minutes** | `PT30M`",
          "51 §3.8's row carries the identifier, 30 minutes and PT30M"),
    (d51, "`continuous_unreachability >= PT30M` enters the FULL-HALT POSTURE. "
          "`29:59.999999` outside, `30:00.000000` inside, `30:00.000001` inside",
          "51 §3.8 declares the inclusive boundary at timestamp precision"),
    (d51, "**Timer starts on declaration open; resets only on declaration close.**",
          "51 §3.8 declares the timer's start and reset"),
    (d30, "**`audit_unreachable_full_halt_threshold` = 30 minutes (`PT30M`)** (`51 §3.8`)",
          "30 §5.1a transcribes the value and cites 51 §3.8"),
    (d30, "**The timer STARTS when a declaration opens and RESETS only when one closes.**",
          "30 §5.1a states the timer semantics normatively"),
    (d30, "`continuous_unreachability >= 30 minutes` **enters the FULL-HALT POSTURE**",
          "30 §5.1a states the inclusive entry condition"),
    (d30, "**At most one declaration is open per company**",
          "30 §5.1a states why the interval is single-valued"),
    (d30, "**In the posture, item 4's ordered list is evaluated and then every disposition is "
          "reduced to Halt**",
          "30 §5.1a states the posture's effect on every class"),
    (d30, "**Therefore, in the posture: rows 3 and 4 are restorable by an in-scope override; "
          "rows 1, 2 and 5 are not.**",
          "30 §5.1a resolves the override composition from item 5's two sentences"),
    (d30, "`audit_unreachable_full_halt_threshold` (**30 minutes**, `51 §3.8`)",
          "30 §5.1 item 5 names the threshold and its site"),
    (d35, "`audit_unreachable_full_halt_threshold` (**30 minutes** of continuous open "
          "declaration, `51 §3.8`)",
          "35 §12.1's walkthrough carries the declared value"),
]
g6_missing = [why for body, needle, why in G6_REQUIRED if needle not in body]
g6_wrong = []
for name, ln, txt in lines_with(r"(?:full[- ]halt|full_halt)[^.|]{0,90}?(\d+)\s*minute",
                                OPERATIONAL, re.I):
    for m in re.finditer(r"(?:full[- ]halt|full_halt)[^.|]{0,90}?(\d+)\s*minute", txt, re.I):
        if m.group(1) != "30":
            g6_wrong.append((name, ln, m.group(0)))
cond("G6", "The prolonged audit-unreachability FULL-HALT threshold is exactly 30 minutes at "
           "every site that states a value, with its single-valued operand, declared timer "
           "start/reset semantics, inclusive boundary, all-class effect and the resolved "
           "override composition",
     not g6_missing and not g6_wrong,
     f"missing: {g6_missing}; wrong values: {g6_wrong[:3]}" if (g6_missing or g6_wrong)
     else f"{len(G6_REQUIRED)} required statements present; 0 sites state a value other than 30")

# ---------------------------------------------------------------- G7
# The 30-minute threshold is STRICTLY GREATER than the 15-minute one, computed
# from the two declared values rather than asserted.
def _iso_minutes(body, ident):
    m = re.search(re.escape(ident) + r"` \| \*\*(\d+) minutes\*\* \| `PT(\d+)M`", body)
    if not m:
        return None
    return (int(m.group(1)), int(m.group(2)))
g7_lag = _iso_minutes(d51, "`mirror_lag_critical_threshold")
g7_halt = _iso_minutes(d51, "`audit_unreachable_full_halt_threshold")
g7_ok = (
    g7_lag is not None and g7_halt is not None
    # the prose minutes and the ISO-8601 notation must agree with each other
    and g7_lag[0] == g7_lag[1] and g7_halt[0] == g7_halt[1]
    # and the halt threshold must be strictly the longer of the two
    and g7_halt[0] > g7_lag[0]
    and "**`30 minutes > 15 minutes` is required and is the point.**" in d30
)
cond("G7", "The full-halt threshold is strictly greater than the mirror-lag threshold, computed "
           "from 51 §3.8's two declared values, with prose minutes and ISO-8601 notation "
           "agreeing on each",
     g7_ok,
     f"lag={g7_lag} halt={g7_halt}; strictly greater="
     f"{None if not (g7_lag and g7_halt) else g7_halt[0] > g7_lag[0]}")

# ---------------------------------------------------------------- G8
# Audit quota saturation remains incident-only and cannot change mirror mode.
G8_REQUIRED = [
    (d30, "Audit-store saturation is an incident, not a mode change (I17c).",
          "30 §5.1 item 5 still declares saturation incident-only"),
    (d30, "**AUDIT QUOTA SATURATION REMAINS INCIDENT-ONLY AND MUST NEVER CHANGE MIRROR MODE.**",
          "30 §5.7.1a restates it as the exclusion's own sentence"),
    (d30, "`§5.1` item 5 declares saturation *an incident, not a mode change*",
          "30 §5.6's reachability table still carries the qualifier"),
    (d36, "**audit quota saturation produces an incident and no mode-relaxing signal, and "
          "changes no mirror mode**",
          "36's VC-A2h requires the quota assertion"),
]
g8_missing = [why for body, needle, why in G8_REQUIRED if needle not in body]
# And no operational line may make saturation a cause of the corroboration signal.
g8_deny = [h for h in lines_with(r"saturat[^.|]{0,80}STORE_WRITE_REJECTED|"
                                 r"STORE_WRITE_REJECTED[^.|]{0,80}saturat", OPERATIONAL, re.I)
           if "MUST NOT" not in h[2] and "excluded" not in h[2].lower()
           and "not a mode change" not in h[2]
           and "no mode-relaxing signal" not in h[2]
           and "forbidden" not in h[2].lower()]
cond("G8", "Audit insert-quota saturation remains incident-only, is named in "
           "STORE_WRITE_REJECTED's exclusion list, and no operational passage makes it a cause "
           "of the corroboration signal",
     not g8_missing and not g8_deny,
     f"missing: {g8_missing}; denylist: {g8_deny[:3]}" if (g8_missing or g8_deny)
     else f"{len(G8_REQUIRED)} required statements present; 0 saturation-as-cause hits")

# ---------------------------------------------------------------- G9
# STORE_WRITE_REJECTED requires an audit-OBSERVED, otherwise-valid, in-quota
# attempt. All ten conjuncts must be stated, and the derivation must be
# audit-owned.
G9_REQUIRED = [
    (d30, "### 5.7.1a `STORE_WRITE_REJECTED`, derived",
          "30 §5.7.1a exists"),
    (d30, "**`STORE_WRITE_REJECTED` is an AUDIT-OWNED derivation.**",
          "the derivation is declared audit-owned"),
    (d30, "if and only if **all ten** of the following hold",
          "the predicate is declared closed and conjunctive"),
    (d30, "**actually reached audit ingress**",
          "conjunct 1: the attempt reached ingress"),
    (d30, "**replication identity and authentication succeeded**",
          "conjunct 2: identity and authentication"),
    (d30, "the **structured record is admissible**",
          "conjunct 3: admissibility"),
    (d30, "**`ACOS-JCS-1` reconstruction succeeded**",
          "conjunct 4: canonical reconstruction"),
    (d30, "**transmitted / canonical / row-hash check",
          "conjunct 5: the pre-storage hash checks"),
    (d30, "**not a conflicting sequence collision**",
          "conjunct 6: not a collision"),
    (d30, "**not an exact benign duplicate**",
          "conjunct 7: not a benign duplicate"),
    (d30, "**audit insertion quota is available**",
          "conjunct 8: quota available"),
    (d30, "**attempted the required audit-store write**",
          "conjunct 9: the write was attempted"),
    (d30, "**could not commit because of a STORE-WRITE AVAILABILITY failure**",
          "conjunct 10: a store-write availability failure"),
    (d30, "Conditions 1–8 are the conditions under which the store would otherwise have "
          "**accepted** the row.",
          "the predicate states that 1-8 are the acceptance conditions"),
    (d30, "**`AUDIT_STORE_WRITE_UNAVAILABLE`.**",
          "the semantic failure class is named"),
    (d30, "**The architecture declares the semantic class. The storage implementation declares "
          "which of its concrete failures map into it.**",
          "the architecture/implementation split is declared"),
    (d30, "**closed enumeration**",
          "the concrete mapping must be closed"),
    (d30, "**fail-closed for every unknown or unenumerated storage error**",
          "unknown storage errors fail closed"),
    (d36, "Assert the **positive** control",
          "36's VC-A2h requires the mandatory positive control"),
]
g9_missing = [why for body, needle, why in G9_REQUIRED if needle not in body]
cond("G9", "STORE_WRITE_REJECTED is an audit-owned derivation requiring an audit-observed, "
           "authenticated, admissible, canonical, non-colliding, non-duplicate, in-quota "
           "attempt that then failed at the store write; the semantic class is named, the "
           "concrete mapping is closed and unknown errors fail closed",
     not g9_missing,
     f"missing: {g9_missing}" if g9_missing
     else f"all {len(G9_REQUIRED)} conjuncts and class statements present")

# ---------------------------------------------------------------- G10
# Canonical, hash, chain and security failures are EXCLUDED from the cause. The
# exclusion list is PARSED and each required member is looked up in it.
_i = d30.find("The following **MUST NOT** produce a corroboration-capable "
              "`STORE_WRITE_REJECTED` cause.")
g10_list = ""
if _i > 0:
    _j = d30.find("**Existing security and integrity incidents remain incidents.**", _i)
    if _j > _i:
        g10_list = d30[_i:_j]
G10_MEMBERS = [
    "audit insert-quota saturation",
    "malformed payload",
    "unsupported row kind",
    "`ACOS-JCS-1` canonical mismatch",
    "row-hash mismatch",
    "predecessor / hash-chain mismatch",
    "sequence collision",
    "exact benign duplicate",
    "invalid credentials",
    "invalid signature",
    "insufficient privilege or unauthorised principal",
    "policy rejection",
    "caller cancellation",
    "before audit ingress observed the attempt",
    "serialization failure that is still retryable",
    "deadlock",
    "unknown or unclassified storage error",
]
g10_absent = [m for m in G10_MEMBERS if m not in g10_list]
g10_normative = (
    "**Existing security and integrity incidents remain incidents.**" in d30
    and "the exclusion is normative rather than advisory" in d30
    and "converting a refusal into a relaxation" in d30
)
cond("G10", "The STORE_WRITE_REJECTED exclusion list is present and carries all seventeen "
            "declared members -- canonical mismatch, row-hash mismatch, chain mismatch, "
            "collision, duplicate, credentials, signature, privilege, policy, cancellation, "
            "pre-ingress timeout, retryable serialization, deadlock and unknown errors "
            "included -- and the exclusion is stated as normative",
     bool(g10_list) and not g10_absent and g10_normative,
     f"list parsed={bool(g10_list)}; absent: {g10_absent}; normative={g10_normative}"
     if (not g10_list or g10_absent or not g10_normative)
     else f"{len(G10_MEMBERS)} declared exclusions all present; exclusion is normative")

# ============================================================================
# v1.3.4 ERRATA CONDITIONS (H1-H13). Added by the Phase 2.5d normative errata
# pass (IRN-01, CSB-01, OBX-01/02/03, JCS-02, SEQ-01).
#
#   H1-H4   the effect->case binding and claim-time clock derivation (CSB-01)
#   H5-H9   row 1's state qualification, and its bounds (IRN-01)
#   H10-H11 the outbox state machine and scope (OBX-01, OBX-02)
#   H12     the declared claim-row field order (JCS-02)
#   H13     the S1/S4 sequencing split (SEQ-01)
#
# Every one is written so it CAN return FAIL, and each is demonstrated failing
# by at least one of the eight v1.3.4 seed flags above.
# ============================================================================

d22 = T[ROOT/"deliverables/22-architecture-principles.md"]
d24 = T[ROOT/"deliverables/24-company-state-and-evidence-model.md"]
d25 = T[ROOT/"deliverables/25-workflow-and-event-architecture.md"]
d26 = T[ROOT/"deliverables/26-authority-and-policy-model.md"]
d30 = T[ROOT/"deliverables/30-observability-audit-and-escalation.md"]
d34 = T[ROOT/"deliverables/34-architecture-decision-records.md"]
d36 = T[ROOT/"deliverables/36-architecture-validation-plan.md"]
d37 = T[ROOT/"deliverables/37-acos-mvp-and-implementation-sequence.md"]
d50 = T[ROOT/"deliverables/50-control-artifact-manifest.md"]
reg4 = T[ROOT/"phase2-v1.3-invariant-registry.md"]

def present(hay, needles):
    """Return the needles NOT found. Named so a failure detail lists them."""
    return [n for n in needles if n not in hay]

# ---------------------------------------------------------------- H1
# The binding is kernel-owned and every model-facing source is excluded BY NAME.
# A denylist alone would pass on silence, so the positives are required too.
H1_POSITIVE = [
    "`effect.case_ref : CaseRef | NULL`",
    "**KERNEL-OWNED. IMMUTABLE. NEVER MODEL-SUPPLIED.**",
    "inherited from the authoritative originating task",
    "**It is not a model-facing field.**",
]
# Every forbidden source §9.2.1 must name. If the section stops naming one, the
# artifact has stopped closing that path.
H1_FORBIDDEN_SOURCES = [
    "`ProposedIntent`", "`rationale`", "the dispatch payload", "a free-text reason",
    "a model classification", "a caller-supplied claim-time argument",
    "inference from a customer identifier", "inference from a similar order",
    "an arbitrary resource lookup selected at claim time",
]
h1_sec = d30[d30.find("#### 9.2.1"):d30.find("#### 9.2.2")] if "#### 9.2.1" in d30 else ""
h1_missing = present(d30, H1_POSITIVE) + present(h1_sec, H1_FORBIDDEN_SOURCES)
h1_k7 = "set, supply, change or influence `task.case_ref`" in d24
h1_req = "case_ref             // v1.3.4 (CSB-01)" in d26
h1_inv = "**I64**" in reg4 and "kernel-owned and immutable" in reg4
cond("H1", "The effect->case binding is declared kernel-owned, immutable and never "
           "model-supplied; all nine forbidden sources are excluded by name; K7 forbids a "
           "model to influence it; the AuthorizationRequest carries it as kernel-computed; "
           "and I64 states it",
     not h1_missing and h1_k7 and h1_req and h1_inv,
     f"missing: {h1_missing}; K7={h1_k7}; 26 §2.1={h1_req}; I64={h1_inv}"
     if (h1_missing or not h1_k7 or not h1_req or not h1_inv)
     else f"{len(H1_POSITIVE)} positives and {len(H1_FORBIDDEN_SOURCES)} named exclusions present")

# ---------------------------------------------------------------- H2
# The derivation is claim-time, keyed on the effect's own case_ref, over a LIVE
# clock whose provenance satisfies I56 — and is not a stored or supplied value.
H2_REQUIRED = [
    "**`clock_bearing` is derived at the decision instant from CURRENT authoritative clock state.**",
    "It is never read from an enqueue-time boolean, never persisted as authority, and never accepted as a parameter.",
    "**The effect supplies exactly one thing: its immutable authoritative `case_ref`.**",
    "StatutoryClock.company_id = effect.company_id",
    "AND StatutoryClock.case_ref = effect.case_ref",
    "AND its provenance satisfies I56",
    "**Both directions are live.**",
]
h2_missing = present(d30, H2_REQUIRED)
h2_inv = "**I65**" in reg4 and "No enqueue-time boolean, no persisted `clock_bearing` column and no caller parameter" in reg4
h2_vc = "VC-A6c" in d36
cond("H2", "Claim-time clock-bearing derives from the effect's own immutable case_ref against "
           "a currently live, I56-provenanced statutory clock of the same company and case; no "
           "enqueue-time boolean, persisted column or caller parameter is authority; both "
           "directions are live; I65 and VC-A6c carry it",
     not h2_missing and h2_inv and h2_vc,
     f"missing: {h2_missing}; I65={h2_inv}; VC-A6c={h2_vc}"
     if (h2_missing or not h2_inv or not h2_vc)
     else f"{len(H2_REQUIRED)} required statements present; I65 and VC-A6c present")

# ---------------------------------------------------------------- H3
# The case-less effect. A global search is the failure mode this closes, and the
# denylist runs over the whole operational corpus rather than one section.
h3_pos = present(d30, [
    "**`case_ref = NULL` is a declared, ordinary state.**",
    "**For such an effect `clock_bearing` is `false`**",
    "There is no global clock search, no nearest-case match, no fallback and no heuristic.",
    "Absence of a binding is a determinate `false`, not a query.",
])
H3_DENY = [
    r"search (?:over |across )?(?:every|all) live clock",
    r"nearest[- ]case match",
    r"any clock that (?:happens to )?fit",
]
h3_hits = []
for pat in H3_DENY:
    h3_hits += [h for h in nonhistorical(lines_with(pat, flags=re.I))
                if not any(s in h[2] for s in ("never means", "no nearest-case match",
                                               "never a search for any clock that fits"))]
cond("H3", "A NULL case_ref yields a determinate false without a lookup, and no operational "
           "passage admits a global clock search, a nearest-case match or an any-clock-that-fits "
           "fallback",
     not h3_pos and not h3_hits,
     f"missing: {h3_pos}; fallback hits: {[(h[0], h[1]) for h in h3_hits]}"
     if (h3_pos or h3_hits)
     else f"4 required statements present; {len(H3_DENY)} denylist patterns, 0 non-historical hits")

# ---------------------------------------------------------------- H4
# Deterministic selection, stated as an ordering with a total tie-break, and
# separated from the boolean so the two cannot be conflated.
h4_missing = present(d30, [
    "**earliest authoritative statutory deadline** (`deadline_at` ascending)",
    "**stable `clock_ref` ascending**, as the total tie-break",
    "**The selection does not change the boolean.**",
    "the selected `clock_ref` is persisted as evidence",
    "**The decision selects the clock. A caller never does.**",
])
h4_row3_only = "Where row 3 is not the reason, the field is **NULL or absent**" in d30
h4_evidence_field = "| 18 | `outbox_claim_clock_ref` | text, **NULLABLE** |" in d30
cond("H4", "Where several qualifying live clocks exist the evidentiary clock is selected "
           "deterministically — earliest deadline, tie-broken by ascending clock_ref — the "
           "selection is separated from the boolean, the reference is persisted only where row "
           "3 is the reason, and a caller never chooses it",
     not h4_missing and h4_row3_only and h4_evidence_field,
     f"missing: {h4_missing}; row-3-only={h4_row3_only}; journal field={h4_evidence_field}"
     if (h4_missing or not h4_row3_only or not h4_evidence_field)
     else "5 required statements present; evidence is row-3-only and journaled")

# ---------------------------------------------------------------- H5
# Row 1 in NORMAL. Asserted at BOTH sites that print a state-qualified answer,
# so a single divergent table fails the gate.
# 22 §3.1's row 1, parsed into its three state cells, so each state is asserted
# INDEPENDENTLY and a seed touching one state cannot fail another state's condition.
_m22 = re.search(r"^\| 1 \| IRRECOVERABLE \|(.*)\|\s*$", d22, re.M)
_cells22 = [c.strip() for c in _m22.group(1).split("|")] if _m22 else []
def _cell(i):
    return _cells22[i] if len(_cells22) == 3 else "<22 §3.1 row 1 not parsed>"
h5_22 = _cell(0).startswith("**Dispatch**")
h5_30_row = "In `NORMAL`, **dispatch**" in d30
h5_30_table = "> | `NORMAL` | **Dispatch** |" in d30
h5_30_reach = "| `NORMAL` | **DISPATCH_ELIGIBLE**, row 1 | n/a — already eligible |" in d30
h5_scope = "**`DISPATCH_ELIGIBLE` at row 1 in `NORMAL` is a statement about item 4 and about nothing else.**" in d30
h5_not_exec = "**Nothing about a claim in `NORMAL` asserts execution.**" in d30
cond("H5", "An otherwise-valid IRRECOVERABLE effect is dispatch-eligible in NORMAL at every "
           "site that states a state-qualified answer, the eligibility is scoped to item 4 "
           "alone, and reaching it is stated not to assert execution",
     h5_22 and h5_30_row and h5_30_table and h5_30_reach and h5_scope and h5_not_exec,
     f"22 §3.1 NORMAL cell={_cell(0)!r}; 30 row={h5_30_row}; 30 table={h5_30_table}; 30 reach={h5_30_reach}; "
     f"scoped={h5_scope}; not-execution={h5_not_exec}"
     if not (h5_22 and h5_30_row and h5_30_table and h5_30_reach and h5_scope and h5_not_exec)
     else "both tables and both bounding statements agree on NORMAL")

# ---------------------------------------------------------------- H6
h6_22 = _cell(1) == "**Halt**"
h6_30 = "> | `UNCORROBORATED_STALL` | **Halt** |" in d30
h6_reach = "| `UNCORROBORATED_STALL` | **HALT**, row 1 | **No** |" in d30
h6_row = "In `UNCORROBORATED_STALL` and in `CORROBORATED_DEGRADED`, **halt**" in d30
cond("H6", "IRRECOVERABLE halts in UNCORROBORATED_STALL at every site that states it, and the "
           "22 §3.1 row still carries exactly two Halt cells",
     h6_22 and h6_30 and h6_reach and h6_row,
     f"22 §3.1 UNCORROBORATED cell={_cell(1)!r}; 30 table={h6_30}; 30 reach={h6_reach}; 30 row={h6_row}"
     if not (h6_22 and h6_30 and h6_reach and h6_row) else "all four sites halt")

# ---------------------------------------------------------------- H7
h7_30 = "> | `CORROBORATED_DEGRADED` | **Halt** |" in d30
h7_reach = "| `CORROBORATED_DEGRADED` | **HALT**, row 1 | **No** |" in d30
h7_preserved = ("The invariant the mirror exists for is preserved exactly: the combination row 1 "
                "refuses — *unmirrored* and *unundoable* — still refuses, in both degraded "
                "states, in the posture, and against an owner override.") in d30
# The `36 §6` equality that row 1 breaks must be stated in BOTH artifacts, with the
# ordering explicitly preserved. Stating the correction without stating what it costs is
# how a downstream reader keeps a superseded equality — the shape TA-07 already caught
# once in this same passage.
h7_asnormal = present(d30, [
    "**(a) `36 §6`'s *\"`CORROBORATED_DEGRADED`: as `NORMAL`\"* now holds for rows 2 through 5 and NOT for row 1.**",
    "A corroborated stall is a stall with a witness.",
    "> `NORMAL` ≥ `CORROBORATED_DEGRADED` ≥ `UNCORROBORATED_STALL`",
    "**What v1.3.4 removes is the EQUALITY between `NORMAL` and `CORROBORATED_DEGRADED`, not the ordering**",
]) + present(d36, [
    "`CORROBORATED_DEGRADED`: as `NORMAL` **for rows 2 through 5**",
    "**and row 1 halts, because corroboration proves the stall rather than curing it**",
    "it is never looser than `NORMAL` at any row",
])
# `§5.6`'s inversion gains a second row, and the direction must be stated.
h7_inversion = present(d30, [
    "**(b) `§5.6`'s inversion now has a second row.**",
    "**Now rows 1 and 3 differ**",
    "**This strengthens the inversion; it does not weaken it.**",
])
h7_22 = _cell(2) == "**Halt**"
cond("H7", "IRRECOVERABLE halts in CORROBORATED_DEGRADED at every site that states it; the "
           "degraded invariant is preserved positively; and the two consequences the "
           "correction has elsewhere — 36 §6's as-NORMAL equality and §5.6's inversion "
           "gaining a second row — are both recorded rather than left implicit",
     h7_30 and h7_reach and h7_preserved and h7_22 and not h7_asnormal and not h7_inversion,
     f"30 table={h7_30}; 30 reach={h7_reach}; positive={h7_preserved}; "
     f"22 §3.1 cell={_cell(2)!r}; as-NORMAL exception missing: {h7_asnormal}; "
     f"inversion consequence missing: {h7_inversion}"
     if not (h7_30 and h7_reach and h7_preserved and h7_22 and not h7_asnormal
             and not h7_inversion)
     else "all sites halt; stated positively; the 36 §6 equality and the §5.6 inversion "
          "consequences are both recorded, with the permissiveness ordering preserved")

# ---------------------------------------------------------------- H8
h8 = present(d30, [
    "**In the FULL-HALT POSTURE (`§5.1a`, at or beyond `audit_unreachable_full_halt_threshold`): Halt**",
    "| FULL-HALT POSTURE, any state | **HALT**, row 1 | **No** |",
    "and **not** restorable — the posture restores rows 3 and 4 only",
])
# The v1.3.3 posture rule itself must be untouched: rows 1, 2 and 5 not restorable.
h8_posture = ("**Therefore, in the posture: rows 3 and 4 are restorable by an in-scope override; "
              "rows 1, 2 and 5 are not.**") in d30
cond("H8", "The FULL-HALT POSTURE halts row 1 in every state and does not restore it, and "
           "§5.1a's rows-3-and-4-only composition is unchanged by v1.3.4",
     not h8 and h8_posture,
     f"missing: {h8}; §5.1a composition intact={h8_posture}"
     if (h8 or not h8_posture) else "3 required statements present; §5.1a intact")

# ---------------------------------------------------------------- H9
h9 = present(d30, [
    "**A `DegradedModeOverride` can never unlock row 1**, in any state.",
    "Unreachable by override in either degraded state",
    "`precedence_rows` still cannot hold `1`",
])
# The accepted S1H restriction must still be stated where it was stated before.
h9_scope = ("It may **never** restore row 1 (IRRECOVERABLE) or row 2 (above-floor, not "
            "clock-bearing).") in d30
h9_limits = "`recoverability_classes[]` therefore excludes `IRRECOVERABLE` structurally" in d30
h9_22 = "rows 1 and 2 are unreachable by override" in d22
cond("H9", "An ordinary degraded-mode owner override cannot unlock IRRECOVERABLE in any state; "
           "§5.7.2's scope rule and its structural exclusion of the class are unchanged, and "
           "22 §3.1 still says so",
     not h9 and h9_scope and h9_limits and h9_22,
     f"missing: {h9}; §5.7.2 scope={h9_scope}; structural={h9_limits}; 22={h9_22}"
     if (h9 or not h9_scope or not h9_limits or not h9_22)
     else "3 new statements plus the three unchanged accepted ones")

# ---------------------------------------------------------------- H10
h10 = present(d25, [
    "**Exactly two states: `ENQUEUED` and `CLAIMED`. Exactly one transition: `ENQUEUED → CLAIMED`.",
    "**`CLAIMED` HAS NO TIMEOUT, NO LEASE, NO EXPIRY AND NO RECLAIM.**",
    "no elapsed time of any length that returns a `CLAIMED` row to `ENQUEUED`",
    "**It is never the subject of a retry that re-claims.**",
])
# The reclaim vocabulary must appear ONLY as a refusal. A line introducing one as
# a mechanism is the defect this closes.
H10_DENY = [r"visibility timeout", r"stale[- ]lease reaper", r"claim expir", r"reclaim"]
h10_hits = []
for pat in H10_DENY:
    for h in nonhistorical(lines_with(pat, flags=re.I)):
        neg = ("HAS NO TIMEOUT" in h[2] or "no stale-lease reaper" in h[2]
               or "never the subject of a retry that re-claims" in h[2]
               or "no visibility timeout" in h[2] or "non-reclaimable" in h[2]
               or "no timeout, lease, expiry or reclaim" in h[2]
               or "no timeout, no lease, no expiry, no reclaim" in h[2])
        if not neg:
            h10_hits.append(h)
h10_adr = "**no timeout, lease, expiry or reclaim out of `CLAIMED`**" in d34
cond("H10", "The outbox state machine is ENQUEUED -> CLAIMED with no transition out of CLAIMED, "
            "and no operational passage introduces a visibility timeout, a claim expiry, a "
            "stale-lease reaper or any reclaim as a mechanism",
     not h10 and not h10_hits and h10_adr,
     f"missing: {h10}; reclaim-as-mechanism hits: {[(x[0], x[1]) for x in h10_hits]}; ADR-026={h10_adr}"
     if (h10 or h10_hits or not h10_adr)
     else f"4 required statements; {len(H10_DENY)} denylist patterns, 0 hits outside a refusal")

# ---------------------------------------------------------------- H11
h11 = present(d25, [
    "**The ACOS dispatch outbox applies to every effect that will cross an external-write boundary**",
    "**The scope predicate is `effect requires external dispatch`.**",
    "It is **not** `effect.recoverability == IRRECOVERABLE`",
    "it is **not** every catalogue action unconditionally",
    "**The predicate is derived from the closed action catalogue's execution metadata**",
    "an internal-only kernel effect that crosses no external-write boundary takes no outbox row",
])
# The three narrowly-scoped sites must have been widened, not merely contradicted.
h11_erd = 'EFFECT ||--o| OUTBOX_ROW : "claims (external-write effects, v1.3.4)"' in d24
h11_33 = "the **outbox claim** for every external-write effect" in T[ROOT/"deliverables/33-recommended-architecture.md"]
h11_35 = "3. **Outbox claim** for every external-write effect" in T[ROOT/"deliverables/35-failure-scenario-walkthroughs.md"]
h11_inv = "**I66**" in reg4
cond("H11", "The outbox scope is every external-write effect and only those, derived from the "
            "closed catalogue rather than from recoverability or from a caller; the three "
            "narrowly-scoped sites are widened; and I66 states it",
     not h11 and h11_erd and h11_33 and h11_35 and h11_inv,
     f"missing: {h11}; 24 ERD={h11_erd}; 33 §6={h11_33}; 35 §4={h11_35}; I66={h11_inv}"
     if (h11 or not h11_erd or not h11_33 or not h11_35 or not h11_inv)
     else "6 required statements present; all three narrow sites widened; I66 present")

# ---------------------------------------------------------------- H12
# The declared order is PARSED out of §5.3a and checked field by field against
# an independent transcription held here, so a transposition fails.
H12_ORDER = [
    "'acos.journal.outbox_claimed.v1'", "company_id", "journal_seq", "'OUTBOX_CLAIMED'",
    "outbox_id", "outbox_claim_id", "outbox_correlation_tag", "effect_id",
    "authorisation_id", "idempotency_key", "action_class", "resource_ref",
    "dispatch_payload_hash", "outbox_matched_row", "outbox_mirror_state",
    "outbox_requires_unmirrored_tag", "override_id", "outbox_claim_clock_ref",
    "occurred_at", "prev_hash",
]
h12_sec = d30[d30.find("#### `acos.journal.outbox_claimed.v1`"):d30.find("#### Two obligations")] \
    if "#### `acos.journal.outbox_claimed.v1`" in d30 else ""
h12_parsed = [m[1] for m in re.findall(r"^\| (\d+) \| `?'?([A-Za-z0-9_.]+)'?`? \|", h12_sec, re.M)]
h12_nums = [int(m) for m in re.findall(r"^\| (\d+) \|", h12_sec, re.M)]
h12_order_ok = h12_parsed == [f.strip("'") for f in H12_ORDER]
h12_numbering = h12_nums == list(range(1, len(H12_ORDER) + 1))
h12_declared = "**This section is that specification for the outbox claim row.**" in d30
h12_independence = present(d30, [
    "**The order is normative, not conventional.**",
    "neither may read a shared canonicalisation helper that would make agreement automatic",
    "**The order may not depend on an object's or a map's insertion order** in any implementation",
])
h12_class20 = "the per-row-kind column orders are declared in `30 §5.3a`" in d50
h12_vca3 = "seeded swap of two adjacent fields of `acos.journal.outbox_claimed.v1` fails this case" in d36
cond("H12", "The claim journal row's field order is explicitly declared field by field in the "
            "specification, is numbered 1..20 without gaps, matches an independent transcription "
            "held in this gate, is stated normative with the independence and insertion-order "
            "obligations, and moves control-artifact class 20",
     h12_order_ok and h12_numbering and h12_declared and not h12_independence
     and h12_class20 and h12_vca3,
     f"order match={h12_order_ok} (parsed {len(h12_parsed)} fields); numbering={h12_numbering}; "
     f"declared={h12_declared}; missing obligations: {h12_independence}; class 20={h12_class20}; "
     f"VC-A3={h12_vca3}"
     if not (h12_order_ok and h12_numbering and h12_declared and not h12_independence
             and h12_class20 and h12_vca3)
     else f"{len(h12_parsed)} fields in declared order, 1..{len(h12_parsed)}, normative")

# ---------------------------------------------------------------- H13
# The sequencing split. S1 gets the foundation; every vendor-dependent item is
# named as later, and I36's two legs are attributed to the two slices.
h13_s1 = present(d37, [
    "**S1 — the ACOS-owned durable outbox foundation:**",
    "the ACOS-owned durable outbox schema, with its two-state machine",
    "the immutable authorised payload snapshot",
    "the provider-visible correlation tag, minted locally",
    "deterministic enqueue and enqueue recovery",
    "the **exclusive, non-reclaimable claim**",
    "the crash-before-HTTP proof, against real PostgreSQL",
])
h13_later = present(d37, [
    "**LATER EXECUTION / ADAPTER SLICE — everything that needs a vendor:**",
    "the real adapter and the HTTP or vendor-SDK call",
    "provider idempotency headers and the provider query primitive",
    "the unknown-outcome runtime transition and `PRESUMED_EXECUTED`",
    "MIE consumption at the execution/outcome point",
    "the provider sandbox, delivery-event reconciliation, `VERIFIED` and `NEVER_SENT`",
])
h13_i36 = ("**`I36`'s enforcement leg therefore lands at S1 and its verification leg stays at S4.**"
           in d37)
h13_not_count = "**An outbox row count is not a provider accepted count**" in d37
h13_reg = "**S1 (enforcement), S4 (verification)**" in reg4
# S4 must still own the vendor half rather than having been emptied.
h13_s4 = "**The vendor half of the ACOS-owned outbox**" in d37
cond("H13", "The implementation sequence splits the outbox: S1 builds the durable schema, tag, "
            "recovery and non-reclaimable claim; the real adapter, HTTP, provider "
            "idempotency/query, unknown-outcome transition, sandbox and reconciliation remain "
            "later; and I36's two legs are attributed to the two slices that can run them",
     not h13_s1 and not h13_later and h13_i36 and h13_not_count and h13_reg and h13_s4,
     f"S1 missing: {h13_s1}; later missing: {h13_later}; I36 split={h13_i36}; "
     f"count disclaimer={h13_not_count}; registry={h13_reg}; S4 retains vendor half={h13_s4}"
     if not (not h13_s1 and not h13_later and h13_i36 and h13_not_count and h13_reg and h13_s4)
     else "7 S1 items, 6 later items, I36 split in both 37 and the registry")

print(f"# ACOS v1.3 / v1.3.1 / v1.3.2 / v1.3.3 / v1.3.4 mechanical consistency pass — {len(results)} conditions\n")
w=max(len(c[1]) for c in results)
for cid, desc, res, detail in results:
    print(f"{cid:5s} {res:4s}  {desc}")
    if detail: print(f"          {detail}")
fails=[r for r in results if r[2]=="FAIL"]
print(f"\nRESULT: {len(results)-len(fails)} PASS / {len(fails)} FAIL")
sys.exit(1 if fails else 0)
