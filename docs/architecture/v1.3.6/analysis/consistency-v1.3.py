#!/usr/bin/env python3
"""
ACOS v1.3 internal consistency pass. Mechanical conditions only.
Every condition below is written so it CAN return FAIL.

C1-C29 are the v1.3 conditions. E1-E7 were added by the v1.3.1 errata pass.
F1-F3 were added by the v1.3.2 errata pass (JCS-01, ACOS-JCS-1 NULL framing).
K1-K25 were added by the v1.3.6 errata pass (the control-artifact trust
architecture, S1K-C1..S1K-C10).
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

# ============================================================================
# v1.3.5 NEGATIVE CONTROLS (MIE-01, OBX-04, OBX-05, SER-01, JCS-03).
#
# Thirteen seeds. Every one of J1-J16 is failed by at least one of them, and
# each seed models a SPECIFIC unsafe architecture rather than a typo: the
# reservation removed, the unit count handed to a caller, the presumption
# releasing headroom, the presumption realising directly, the adapter-returned
# irrecoverable case left awaiting verification, I20 written against the live
# balance column, confirmed-not-sent conflated with never-sent, a known failure
# requeueing a claimed row, dispatch revalidation removed, the dispatch lease
# made optional, v1.3.4's one-session wording restored with no async protocol,
# a stale gap mutation dispatching, and two adjacent outcome fields swapped.
#
# Nothing on disk is modified by any of them.
# ============================================================================
SEED_NO_MIE_RESERVATION      = "--seed-no-mie-reservation" in sys.argv
SEED_CALLER_MIE_UNITS        = "--seed-caller-mie-units" in sys.argv
SEED_UNKNOWN_RELEASES_MIE    = "--seed-unknown-releases-mie" in sys.argv
SEED_UNKNOWN_TO_REALISED     = "--seed-unknown-to-realised" in sys.argv
SEED_RETURNED_AWAITING_IRR   = "--seed-returned-awaiting-irrecoverable" in sys.argv
SEED_I20_CURRENT_BALANCE     = "--seed-i20-current-balance" in sys.argv
SEED_NOT_SENT_AS_NEVER_SENT  = "--seed-not-sent-as-never-sent" in sys.argv
SEED_KNOWN_FAILURE_REQUEUES  = "--seed-known-failure-requeues" in sys.argv
SEED_NO_DISPATCH_REVALIDATION = "--seed-no-dispatch-revalidation" in sys.argv
SEED_OPTIONAL_DISPATCH_LEASE = "--seed-optional-dispatch-lease" in sys.argv
SEED_OLD_ONE_SESSION         = "--seed-old-one-session" in sys.argv
SEED_GAP_MUTATION_DISPATCHES = "--seed-gap-mutation-dispatches" in sys.argv
SEED_SWAP_OUTCOME_FIELDS     = "--seed-swap-outcome-fields" in sys.argv

_P30 = ROOT / "deliverables/30-observability-audit-and-escalation.md"
_P51 = ROOT / "deliverables/51-limits-fixture.md"

def _seed(path, old, new):
    """Replace in the in-memory corpus. Returns 1 on a hit, 0 otherwise."""
    if old in T[path]:
        T[path] = T[path].replace(old, new)
        return 1
    return 0

_P24 = ROOT / "deliverables/24-company-state-and-evidence-model.md"
_P25 = ROOT / "deliverables/25-workflow-and-event-architecture.md"
_P26 = ROOT / "deliverables/26-authority-and-policy-model.md"
_P36 = ROOT / "deliverables/36-architecture-validation-plan.md"
_P37 = ROOT / "deliverables/37-acos-mvp-and-implementation-sequence.md"
_PREG = ROOT / "phase2-v1.3-invariant-registry.md"

if SEED_NO_MIE_RESERVATION:
    # The reservation is removed from step R and from K5's transition table, so
    # "consume the irrecoverable unit" again names a movement with no subject.
    n = 0
    n += _seed(_P26,
        "**Irrecoverable units (v1.3.5, MIE-01, `25 §10.1`, `24 §3` K5).** Where the action class is IRRECOVERABLE, the same transaction additionally reserves the class's catalogue-declared `irrecoverable_units` into the **third ledger's reserved term** — `reserved_irrecoverable += irrecoverable_units` — against **every applicable MIE window instance the effect's authority and grants reference**",
        "**Irrecoverable units.** Step R reserves no irrecoverable unit; the ledger's reserved term has no contributor")
    n += _seed(_P25,
        "**EVERY AUTHORISED IRRECOVERABLE EXTERNAL EFFECT RESERVES ITS IRRECOVERABLE UNITS BEFORE EXECUTION.**",
        "No irrecoverable unit is reserved at authorisation.")
    n += _seed(_P24,
        "| **RESERVE**, at local authorisation (`26 §7` step R) | `reserved_irrecoverable += irrecoverable_units` | rises |",
        "| RESERVE | not declared | n/a |")
    print("# SEEDED: step R's irrecoverable reservation removed (%d/3). J1 MUST FAIL.\n" % n)

if SEED_CALLER_MIE_UNITS:
    # The unit count becomes a request field, which is the widening the owner forbids.
    n = 0
    n += _seed(_P25,
        "**`irrecoverable_units` IS KERNEL/CATALOGUE-OWNED AND IS NEVER MODEL- OR CALLER-SUPPLIED.**",
        "**`irrecoverable_units` is supplied per request by the calling workflow.**")
    n += _seed(_P51,
        "**THE VALUE IS KERNEL- AND CATALOGUE-OWNED AND IS NEVER MODEL- OR CALLER-SUPPLIED.**",
        "**The value is a per-request parameter the caller provides.**")
    n += _seed(_P51,
        "**A future action class needing a value other than 1 must declare it here, and `NO IMPLICIT DEFAULT MAY WIDEN AUTHORITY.`**",
        "**An undeclared class defaults to 1.**")
    print("# SEEDED: irrecoverable_units made caller-supplied (%d/3). J2 MUST FAIL.\n" % n)

if SEED_UNKNOWN_RELEASES_MIE:
    # The presumption releases the reserved unit instead of moving it, which
    # creates headroom an unknown outcome must never create.
    n = 0
    n += _seed(_P25,
        "| **PRESUME** | `PRESUMED_EXECUTED` is reached (this section, and `§7`'s adapter-returned case) | `reserved -= units`, `presumed += units` | **unchanged** |",
        "| **PRESUME** | `PRESUMED_EXECUTED` is reached | `reserved -= units` | **falls** |")
    n += _seed(_P25,
        "**The sum of the three terms does not fall, so an unknown outcome creates no headroom**",
        "**The reserved unit is released, so the sum falls**")
    n += _seed(_P24,
        "| **PRESUME**, at `PRESUMED_EXECUTED` | `reserved_irrecoverable -= units`, `presumed_irrecoverable += units` | **unchanged** |",
        "| **PRESUME**, at `PRESUMED_EXECUTED` | `reserved_irrecoverable -= units` | falls |")
    n += _seed(_P24,
        "**THE PRESUME MOVEMENT CREATES NO HEADROOM**",
        "**The presume movement frees headroom**")
    print("# SEEDED: the presumption releases the MIE unit (%d/4). J4 MUST FAIL.\n" % n)

if SEED_UNKNOWN_TO_REALISED:
    # The unit moves straight to realised, asserting provider truth nobody has.
    n = 0
    n += _seed(_P25,
        "| **PRESUME** | `PRESUMED_EXECUTED` is reached (this section, and `§7`'s adapter-returned case) | `reserved -= units`, `presumed += units` | **unchanged** |",
        "| **PRESUME** | `PRESUMED_EXECUTED` is reached | `reserved -= units`, `realised += units` | **unchanged** |")
    n += _seed(_P25,
        "The unit does **not** move directly to `realised`, because a presumption is not a realisation and provider truth is unverified.",
        "**The unit moves directly to `realised`.**")
    n += _seed(_P24,
        "| **PRESUME**, at `PRESUMED_EXECUTED` | `reserved_irrecoverable -= units`, `presumed_irrecoverable += units` | **unchanged** |",
        "| **PRESUME**, at `PRESUMED_EXECUTED` | `reserved_irrecoverable -= units`, `realised_irrecoverable += units` | **unchanged** |")
    print("# SEEDED: the presumption realises directly (%d/3). J3 MUST FAIL.\n" % n)

if SEED_RETURNED_AWAITING_IRR:
    # v1.3.4's unqualified rule restored: adapter-returned is awaiting-verification
    # for every class, so an accepted irrecoverable send consumes nothing.
    n = 0
    n += _seed(_P25,
        "| `ADAPTER_RETURNED` | IRRECOVERABLE | **`PRESUMED_EXECUTED`** | `reserved → presumed` (`§10.1`) | **NO** |",
        "| `ADAPTER_RETURNED` | IRRECOVERABLE | `DISPATCHED_AWAITING_VERIFICATION` | hold | **NO** |")
    n += _seed(_P25,
        "**`ADAPTER_RETURNED` FOR AN IRRECOVERABLE EFFECT REACHES `PRESUMED_EXECUTED`, NOT AN AWAITING-VERIFICATION STATE.**",
        "**`ADAPTER_RETURNED` reaches `DISPATCHED_AWAITING_VERIFICATION` for every class.**")
    print("# SEEDED: adapter-returned IRRECOVERABLE left awaiting verification (%d/2). J5 MUST FAIL.\n" % n)

if SEED_I20_CURRENT_BALANCE:
    # I20 written against the live column again, which inverts its direction as
    # presumptions accumulate.
    n = 0
    n += _seed(_P25,
        "**`I20`'s right-hand side is the HISTORICAL AUTHORISATION BASIS, not the current balance term.**",
        "**`I20`'s right-hand side is the current value of `window_balance.reserved_irrecoverable`.**")
    n += _seed(_P24,
        "**The reserved term is not `I20`'s basis.**",
        "**The reserved term is `I20`'s basis.**")
    n += _seed(_PREG,
        "**v1.3.5 (MIE-01): the right-hand side is the IMMUTABLE HISTORICAL AUTHORISATION BASIS",
        "**v1.3.5: the right-hand side is the current `reserved_irrecoverable` column")
    print("# SEEDED: I20 rebased on the live balance column (%d/3). J6 MUST FAIL.\n" % n)

if SEED_NOT_SENT_AS_NEVER_SENT:
    # The immediate trusted-adapter proof is conflated with later provider
    # reconciliation, so one state carries two evidentiary meanings.
    n = 0
    n += _seed(_P25,
        "**The local state is `DISPATCH_NOT_SENT_CONFIRMED`, and it is deliberately NOT `NEVER_SENT`.**",
        "**The local state is `NEVER_SENT`, reusing the provider-reconciliation literal.**")
    n += _seed(_P25,
        "| `NOT_SENT_CONFIRMED` | any | **`DISPATCH_NOT_SENT_CONFIRMED`** | release the current reservation/commitment (`§7.2`) | **NO** |",
        "| `NOT_SENT_CONFIRMED` | any | `NEVER_SENT` | release | **NO** |")
    n += _seed(_P24,
        "**`DISPATCH_NOT_SENT_CONFIRMED`** (v1.3.5, `25 §7.2` — trusted-adapter proof that no external write occurred; terminal and non-reclaimable, and **distinct from the later provider-reconciled `NEVER_SENT`**)",
        "`NEVER_SENT` (v1.3.5 — trusted-adapter proof, reusing the provider literal)")
    print("# SEEDED: confirmed-not-sent conflated with NEVER_SENT (%d/3). J7 MUST FAIL.\n" % n)

if SEED_KNOWN_FAILURE_REQUEUES:
    # v1.1's K4 retry restored without qualification, and the terminal state made
    # requeueable -- the exact contradiction with OBX-01 that S1J-C2 reported.
    n = 0
    n += _seed(_P25,
        "> **ONCE A ROW IS `CLAIMED`, THE SAME OUTBOX IDENTITY IS NEVER RETRIED OR REDISPATCHED, ON ANY OUTCOME.**",
        "> On a known adapter failure the row returns to `ENQUEUED` and a bounded retry re-dispatches the same idempotency key.")
    n += _seed(_P25,
        "> **THE OLD OUTBOX IDENTITY IS TERMINAL AND NON-RECLAIMABLE.** A row in `DISPATCH_NOT_SENT_CONFIRMED` may not return to `ENQUEUED`, may not become `READY`, may not enter a retry state and may not be claimed a second time.",
        "> A row in `DISPATCH_NOT_SENT_CONFIRMED` returns to `ENQUEUED` and may be claimed again.")
    n += _seed(_P24,
        "**On adapter failure, bounded retry with jitter applies to retryable workflow and internal failures that occur BEFORE an external-effect claim, then dead-letter to an Incident; a CLAIMED external-effect identity is never retried or re-dispatched**",
        "On adapter failure, bounded retry with jitter against the same idempotency key, then dead-letter to an Incident.")
    print("# SEEDED: a known failure requeues a claimed row (%d/3). J8 and J9 MUST FAIL.\n" % n)

if SEED_NO_DISPATCH_REVALIDATION:
    # The revalidation gate is deleted, so the persisted authorisation is trusted
    # across an arbitrary gap.
    n = 0
    n += _seed(_P25,
        "**DISPATCH-TIME REVALIDATION IS MANDATORY, AND A CLAIM MAY NOT OCCUR BEFORE IT.**",
        "The dispatch epoch claims directly from the persisted authorisation.")
    n += _seed(_P25,
        "> Under the dispatch lease and **before** the claim, the **originally authorised effect** is revalidated against **current authoritative resource state**",
        "> The persisted eligibility recorded at authorisation is sufficient")
    n += _seed(_P30,
        "**A claim that occurs before revalidation is a defect of this class**",
        "The claim may occur without revalidation")
    print("# SEEDED: dispatch-time revalidation removed (%d/3). J12 and J13 MUST FAIL.\n" % n)

if SEED_OPTIONAL_DISPATCH_LEASE:
    # The second epoch becomes advisory, so a mutation may intervene between
    # revalidation and the external call.
    n = 0
    n += _seed(_P25,
        "> **EPOCH B — THE DISPATCH LEASE.** Before a row transitions from `ENQUEUED` to `CLAIMED`, the **same architecture entity advisory-lock key** for the effect's resource is acquired again.",
        "> **EPOCH B.** A dispatch lease MAY optionally be acquired before the claim.")
    n += _seed(_P25,
        "> and released only afterwards. **No ACOS-authorised entity mutation can intervene between dispatch revalidation and the attempted external effect, or between the external effect and its recorded outcome.**",
        "> and released whenever convenient.")
    print("# SEEDED: the dispatch lease made optional (%d/2). J10 and J14 MUST FAIL.\n" % n)

if SEED_OLD_ONE_SESSION:
    # v1.3.4's single continuous span restored, with the two-epoch protocol and
    # VC-C3(b)'s prohibition removed.
    n = 0
    n += _seed(_P25,
        "| Two work items touching the same entity | Advisory lock on `(company_id, entity_type, entity_id)`, held across **each of the two serialization epochs of `§14.1`**. Second item waits or defers; it does not proceed on stale state. **Superseded in part by `§14.1` (v1.3.5, SER-01): the single continuous propose→authorise→execute span is not achievable across the asynchronous outbox boundary and is replaced by two epochs plus mandatory dispatch-time revalidation.** |",
        "| Two work items touching the same entity | Advisory lock on `(company_id, entity_type, entity_id)` for the duration of the propose→authorise→execute span. Second item waits or defers; it does not proceed on stale state. |")
    n += _seed(_P25,
        "> **EPOCH A — THE AUTHORITY LEASE.**",
        "> **ONE CONTINUOUS LEASE.**")
    n += _seed(_P25,
        "### 14.1 Two serialization epochs, and mandatory dispatch revalidation (v1.3.5, SER-01, S1J-C6)",
        "### 14.1 The single continuous lease (restored)")
    n += _seed(_P36,
        "**The old wording of `25 §14` — one continuous session lease from proposal until an arbitrarily delayed external call — is NOT the guarantee, is not achievable across `25 §7`'s outbox, and is not to be asserted by any implementation.**",
        "**The guarantee is one continuous session lease from proposal until the external call.**")
    print("# SEEDED: v1.3.4's one-session wording restored (%d/4). J10 and J11 MUST FAIL.\n" % n)

if SEED_GAP_MUTATION_DISPATCHES:
    # The gap-mutation attack is declared to dispatch rather than deny, and the
    # discriminating obligation on VC-C3(b) is removed.
    n = 0
    n += _seed(_P25,
        "> **If the originally authorised option or effect is no longer valid, the claim is REFUSED.** Nothing is dispatched and nothing is substituted.",
        "> If the originally authorised option is no longer valid the dispatch proceeds against the persisted payload.")
    n += _seed(_P36,
        "**Assert the claim is REFUSED, assert no adapter invocation occurred, and assert no option was substituted.** An implementation that dispatches from the persisted eligibility **must fail this case**, and an implementation with dispatch-time revalidation removed **must fail it too**.",
        "Assert the dispatch proceeds from the persisted payload.")
    n += _seed(_P26,
        "**refuses the claim** if the original option or effect is no longer valid",
        "dispatches the persisted payload regardless")
    print("# SEEDED: a stale gap mutation dispatches (%d/3). J15 MUST FAIL.\n" % n)

if SEED_SWAP_OUTCOME_FIELDS:
    # Fields 15 and 16 transposed: same type, same framing, adjacent. Every field
    # is still present and the numbering is still 1..20, so a membership check
    # passes and an element-wise comparison does not.
    n = _seed(_P30,
        "| 15 | `dispatch_outcome_kind` | text | the TYPED result the trusted adapter returned (`25 §7.1`) |\n| 16 | `dispatch_effect_status` | text | the local post-dispatch status the policy produced (`25 §7.1`) |",
        "| 15 | `dispatch_effect_status` | text | the local post-dispatch status the policy produced (`25 §7.1`) |\n| 16 | `dispatch_outcome_kind` | text | the TYPED result the trusted adapter returned (`25 §7.1`) |")
    print("# SEEDED: dispatch_outcome fields 15 and 16 transposed (%s). J16 MUST FAIL.\n" % ("applied" if n else "NOT APPLIED"))

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

# ============================================================================
# v1.3.6 NEGATIVE CONTROLS (S1K-C1..S1K-C10).
#
# Twenty-five seeds. Every one of K1-K25 is failed by at least one of them, and
# each models a SPECIFIC unsafe architecture rather than a typo. Every mutation
# is IN MEMORY only; nothing on disk is touched by a seeded run.
# ============================================================================
_P49 = ROOT / "deliverables/49-trusted-computing-base.md"
_P50 = ROOT / "deliverables/50-control-artifact-manifest.md"

SEED_RSA_ARTIFACT_SIGNATURE   = "--seed-rsa-artifact-signature" in sys.argv
SEED_SAME_KEY_BOTH_SLOTS      = "--seed-same-key-both-slots" in sys.argv
SEED_OWNER_KEY_FROM_MANIFEST  = "--seed-owner-key-from-manifest" in sys.argv
SEED_TOFU_ACCEPTED            = "--seed-tofu-accepted" in sys.argv
SEED_ENVELOPE_DROPS_CLASS     = "--seed-envelope-drops-class" in sys.argv
SEED_ENVELOPE_DROPS_VERSION   = "--seed-envelope-drops-version" in sys.argv
SEED_ENVELOPE_USES_JCS1       = "--seed-envelope-uses-jcs1" in sys.argv
SEED_SEMANTIC_RESERIALISATION = "--seed-semantic-reserialisation" in sys.argv
SEED_CLASS3_OPEN_MEMBERSHIP   = "--seed-class3-open-membership" in sys.argv
SEED_MIE_UNITS_STAY_CLASS17   = "--seed-mie-units-stay-class17" in sys.argv
SEED_FLOOR_DUAL_OWNERSHIP     = "--seed-floor-dual-ownership" in sys.argv
SEED_WINDOW_ROWS_SIGNED       = "--seed-window-rows-signed" in sys.argv
SEED_NO_CLASS20_ARTIFACT      = "--seed-no-class20-artifact" in sys.argv
SEED_CLASS20_IS_IMPL          = "--seed-class20-hash-is-implementation" in sys.argv
SEED_SECOND_SIGNATURE_OPT     = "--seed-second-signature-optional" in sys.argv
SEED_MANIFEST_UNSIGNED        = "--seed-manifest-unsigned" in sys.argv
SEED_ROW_DELETION_UNDETECTED  = "--seed-row-deletion-undetected" in sys.argv
SEED_OLD_MANIFEST_ACCEPTED    = "--seed-old-manifest-accepted" in sys.argv
SEED_READY_BEFORE_VERIFY      = "--seed-ready-before-verification" in sys.argv
SEED_PARTIAL_PUBLICATION      = "--seed-partial-publication" in sys.argv
SEED_RAW_CATALOGUE_CONSUMER   = "--seed-raw-catalogue-consumer" in sys.argv
SEED_CEDAR_HASH_ONLY          = "--seed-cedar-hash-only" in sys.argv
SEED_ANCHOR_IS_BOOTSTRAP_ROOT = "--seed-anchor-is-bootstrap-root" in sys.argv
SEED_VENDOR_CALL_BEFORE_GATE  = "--seed-vendor-call-before-gate" in sys.argv
SEED_PULL_FORWARD_S4_AUDIT    = "--seed-pull-forward-s4-audit" in sys.argv


def _k_seed(flag, label, must_fail, edits):
    """Apply an in-memory mutation set and announce it. Nothing on disk moves."""
    if not flag:
        return
    n = 0
    for path, old, new in edits:
        n += _seed(path, old, new)
    print(f"# SEEDED: {label} ({n}/{len(edits)} edits applied). {must_fail} MUST FAIL.\n")


_k_seed(SEED_RSA_ARTIFACT_SIGNATURE, "the owner artifact algorithm switched to RSA-4096/PSS", "K1", [
    (_P50,
     "**OWNER CONTROL-ARTIFACT SIGNATURES USE Ed25519.** The standard primitive, RFC 8032 PureEdDSA over Curve25519: a 32-byte public key, a 64-byte signature, signing the message directly with no pre-hash step and no context string. **There is no custom elliptic-curve construction, no RSA alternative, and NO ALGORITHM NEGOTIATION IN S1.**",
     "**OWNER CONTROL-ARTIFACT SIGNATURES USE RSA-4096 WITH PSS.** RSASSA-PSS over a 4096-bit modulus with SHA-256 and a 32-byte salt. **An Ed25519 signature is also accepted where the signer advertises one, and the verifier selects on the presented algorithm identifier.**"),
])

_k_seed(SEED_SAME_KEY_BOTH_SLOTS, "one owner key configured in both signature slots", "K2", [
    (_P50,
     "**`primary_public_key != second_factor_public_key`**, compared over the raw 32 public-key bytes, and therefore **`primary_key_id != second_factor_key_id`**. A deployment configuring the same key in both slots **fails closed at bootstrap** and never becomes READY. **A second signature produced under the primary key does not satisfy the second-factor requirement**, whatever its `signer_role` claims.",
     "A deployment MAY configure one owner key in both slots; the two roles are distinguished by the `signer_role` field inside the signed message, which is sufficient to keep the two signatures non-transplantable."),
])

_k_seed(SEED_OWNER_KEY_FROM_MANIFEST, "the owner verification keys sourced from the manifest", "K3", [
    (_P50,
     "**Both public keys are TRUSTED DEPLOYMENT ROOTS. They are not control artifacts. They are not manifest rows. They are not discovered from a database, from the manifest, from the network, from a model, from a caller, from an API, or from the first signature observed.**",
     "**Both public keys are published as a control-artifact class and hashed into the owner-signed manifest, exactly as class 24 is**, so a substituted owner key is an `I19` mismatch."),
    (_P50,
     "**The manifest may carry key IDs for consistency checking, but it CANNOT DEFINE WHICH PUBLIC KEYS ARE TRUSTED.**",
     "**The manifest carries the trusted public keys, and the runtime reads them from it at bootstrap.**"),
])

_k_seed(SEED_TOFU_ACCEPTED, "trust-on-first-use admitted at bootstrap", "K4", [
    (_P50,
     "**TRUST-ON-FIRST-USE IS FORBIDDEN.** There is no \"remember the key that first verified\" path, no \"accept any valid Ed25519 key\" path, and no per-request key parameter.",
     "**TRUST-ON-FIRST-USE IS PERMITTED AT BOOTSTRAP.** The first valid Ed25519 key that verifies a manifest signature is remembered and becomes the deployment's trust root for every later run."),
])

_k_seed(SEED_ENVELOPE_DROPS_CLASS, "the artifact class removed from the signed message", "K5", [
    (_P50,
     " || CAS_FIELD(artifact_class)                         # decimal ASCII\n",
     ""),
])

_k_seed(SEED_ENVELOPE_DROPS_VERSION, "the artifact version removed from the signed message", "K5", [
    (_P50,
     " || CAS_FIELD(artifact_version)                       # UTF-8 NFC\n",
     ""),
])

_k_seed(SEED_ENVELOPE_USES_JCS1, "the signature envelope re-based on ACOS-JCS-1", "K6", [
    (_P50,
     "**IT DOES NOT DEPEND ON `ACOS-JCS-1`.** No rule of `ACOS-JCS-1` is referenced, imported or required. **IT USES NO JSON AND NO JSON RESERIALIZATION.**",
     "**The signature message is `ACOS-JCS-1`-canonicalised over the manifest row's fields**, reusing the journal framing and its JSON rule so that the system has exactly one canonicalisation."),
])

_k_seed(SEED_SEMANTIC_RESERIALISATION, "the content hash taken over a reserialised semantic object", "K7", [
    (_P50,
     "content_hash = SHA-256(EXACT_ARTIFACT_BYTES)",
     "content_hash = SHA-256(CANONICALISED_SEMANTIC_OBJECT)"),
    (_P50,
     "**The input is the exact immutable bytes deployed to the consumer.**",
     "**The input is the artifact's parsed semantic object, reserialised to canonical JSON**, so a whitespace change does not move the digest."),
])

_k_seed(SEED_CLASS3_OPEN_MEMBERSHIP, "class 3's membership reopened with prose", "K8", [
    (_P50,
     "| 3 | **Action catalogue** — **v1.3.6: the content is CLOSED by `§2a`'s schema and by nothing else.",
     "| 3 | **Action catalogue**, incl. recoverability class, `value_direction`, the digest field list, enumeration `max_age` and the rest of the execution metadata, etc. — **v1.3.6:"),
])

_k_seed(SEED_MIE_UNITS_STAY_CLASS17, "irrecoverable_units left in class 17", "K9", [
    (_P51,
     "`irrecoverable_units` IS CONTROL ARTIFACT CLASS 3 CONTENT**",
     "**This table remains part of control artifact class 17's signed content**"),
    (_P50,
     "| 7 | `irrecoverable_units` | non-negative integer | **v1.3.6: class 3, not class 17.**",
     "| 7 | *(not class 3 content — the unit count stays in class 17)* | — | **class 17.**"),
])

_k_seed(SEED_FLOOR_DUAL_OWNERSHIP, "the degraded approval floor owned by class 3 AND class 27", "K10", [
    (_P51,
     "**CORRECTED IN v1.3.6 (`S1K-C6`): CLASS 27**",
     "**Class 3** and, since v1.3.6, **also class 27**; both classes' signatures cover the quantity"),
])

_k_seed(SEED_WINDOW_ROWS_SIGNED, "per-company window rows drawn into the signing ceremony", "K11", [
    (_P50,
     "**PER-COMPANY `window_registry` ROWS ARE NOT DEPLOY-TIME SIGNED CONTROL ARTIFACTS.** They are runtime authoritative database state.",
     "**Each per-company `window_registry` row is signed at creation under the owner ceremony and enters the manifest as its own class-17 entry**, so a row written without a ceremony is an `I19` mismatch."),
])

_k_seed(SEED_NO_CLASS20_ARTIFACT, "class 20 left with no deployed artifact to hash", "K12", [
    (_P50,
     "| `content_hash` | **`7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33`** — `SHA-256` over those exact bytes (`§3c`) |",
     "| `content_hash` | **not computable — class 20 has no deployed artifact; the manifest entry binds the specification DOCUMENT's identity and version instead** |"),
])

_k_seed(SEED_CLASS20_IS_IMPL, "class 20's hash taken over one implementation's source", "K13", [
    (_P50,
     "**and none of their source code is ever hashed as class 20.**",
     "and **the TypeScript implementation's source bytes are what carry the class-20 content hash**, since that implementation is the deployed representation of the specification."),
])

_k_seed(SEED_SECOND_SIGNATURE_OPT, "the second-factor signature made optional", "K14", [
    (_P50,
     "**EVERY pre-live signed artifact requires TWO valid signatures**",
     "**A pre-live signed artifact requires a primary owner signature; a second-factor signature is RECOMMENDED and is verified where present**"),
])

_k_seed(SEED_MANIFEST_UNSIGNED, "the manifest core left unsigned", "K15", [
    (_P50,
     "**THE MANIFEST CORE ITSELF RECEIVES BOTH SIGNATURES** — a primary Ed25519 signature and a second-factor Ed25519 signature, under the separate domain `ACOS-CONTROL-MANIFEST-SIGNATURE-V1`.",
     "**The manifest core is not itself signed.** The per-entry signatures are what the deployment relies on, and the manifest is a transport for them."),
])

_k_seed(SEED_ROW_DELETION_UNDETECTED, "the entry count removed, so a deleted row leaves the manifest valid", "K16", [
    (_P50,
     "| `entry_count` | the **exact** number of artifact entries |\n",
     ""),
    (_P50,
     "`entry_count` is inside the signed bytes **and** the entries follow it, so a deletion is detectable twice over: the count disagrees, and the entry sequence differs.",
     "The entries are carried in whatever order the loader produces, and a missing entry simply means the class is not deployed."),
])

_k_seed(SEED_OLD_MANIFEST_ACCEPTED, "a valid old signed manifest accepted on epoch order", "K17, K18", [
    (_P50,
     "**The runtime may verify a manifest only if its computed `manifest_id` equals `EXPECTED_ACTIVE_MANIFEST_ID`.**",
     "**The runtime selects the manifest with the highest `manifest_epoch` found on disk whose two signatures verify.**"),
    (_P50,
     "> **\"THE HIGHEST EPOCH FOUND ON DISK\" IS NOT ROLLBACK PROTECTION AND IS NOT USED.** `manifest_epoch` is recorded for lineage and for operator legibility; **the pin is what rejects a rollback.**",
     "> **The highest epoch found on disk is the active manifest.** `manifest_epoch` is monotonic, so an older manifest cannot displace a newer one."),
])

_k_seed(SEED_READY_BEFORE_VERIFY, "the kernel reaching READY before verification", "K19", [
    (_P50,
     "**Before the kernel becomes READY**, in this order:",
     "**After the kernel becomes READY, on the first authority use**, in this order:"),
    (_P50,
     "**On any failure the kernel FAILS CLOSED BEFORE ANY AUTHORITY EXECUTION.** It does not become READY, it does not serve a degraded subset, and it does not admit a single effect.",
     "On failure the kernel raises a CRITICAL incident and continues to serve the classes it has already admitted."),
])

_k_seed(SEED_PARTIAL_PUBLICATION, "per-artifact hot reload replacing atomic publication", "K20", [
    (_P50,
     "**Publication of a new verified bundle is ATOMIC**, and **a failed candidate bundle NEVER replaces the current verified bundle.** There is no partial swap and no per-artifact hot reload.",
     "Artifacts are reloaded individually and become active as each one verifies; a candidate that fails part-way leaves the artifacts already swapped in place."),
])

_k_seed(SEED_RAW_CATALOGUE_CONSUMER, "an authority consumer reading the catalogue outside the verified bundle", "K21", [
    (_P50,
     "**Raw or unverified artifact loaders are NOT EXPOSED TO AUTHORITY CONSUMERS**, and **no caller and no model may manufacture this capability.**",
     "**Authority code may also read the action catalogue directly from its module export**, and the verified bundle is available to code that prefers it."),
])

_k_seed(SEED_CEDAR_HASH_ONLY, "Cedar admitted on a hash match alone", "K22", [
    (_P50,
     "**A Cedar policy bundle is admitted to the engine only after the verified manifest, its `content_hash`, its primary signature and its second-factor signature have all been checked.** A bundle presented with a matching hash and no valid signature pair is **REFUSED**.",
     "**A Cedar policy bundle is admitted to the engine once its `content_hash` matches the manifest entry**, which is the property the loader already computes."),
])

_k_seed(SEED_ANCHOR_IS_BOOTSTRAP_ROOT, "I17b made the bootstrap root of trust", "K23", [
    (_P37,
     "- **external anchoring / `I17b`** — an **S3** deliverable, and it is **NOT** the bootstrap root of trust for S1K. `50 §3e`'s deployment pin is what rejects a rollback; the anchor may later add historical and non-repudiation protection, and adds none of it here. **S1K does not depend on `I17b` and must not be made to;**",
     "- **external anchoring / `I17b`** — pulled forward into the S1K gate and REQUIRED as the bootstrap root of trust for the manifest, because a pinned digest cannot by itself show that a manifest is the current one;"),
])

_k_seed(SEED_VENDOR_CALL_BEFORE_GATE, "the integrity gate sequenced after the first real vendor call", "K24", [
    (_P37,
     "**BEFORE THE FIRST REAL EXTERNAL VENDOR CALL, ACOS MUST HAVE:**",
     "**AFTER THE FIRST REAL EXTERNAL VENDOR CALL HAS BEEN EXERCISED AGAINST A SANDBOX, ACOS SHOULD HAVE:**"),
])

_k_seed(SEED_PULL_FORWARD_S4_AUDIT, "unrelated S4 work pulled forward with the gate", "K25", [
    (_P37,
     "- **the later owner briefing**, the unrelated S4 audit mechanisms, and **provider reconciliation**;",
     "- *(nothing further — the S1K gate additionally pulls forward the later owner briefing, the S4 audit mechanisms and provider reconciliation, since all three read control artifacts)*;"),
])


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
    (d51, "**CORRECTED IN v1.3.6 (`S1K-C6`): CLASS 27**",
          "51 §3.7 records the control-artifact effect and its v1.3.6 owner"),
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
        _l = h[2].lower()
        neg = ("has no timeout" in _l or "no stale-lease reaper" in _l
               or "never the subject of a retry that re-claims" in _l
               or "no visibility timeout" in _l or "non-reclaimable" in _l
               or "non-reclaimability" in _l
               or "no timeout, lease, expiry or reclaim" in _l
               or "no timeout, no lease, no expiry, no reclaim" in _l
               # v1.3.5 (OBX-05, SER-01). Each of these PROHIBITS a reclaim; a
               # denylist that counted them would be counting the refusal.
               or "changes nothing about reclaim" in _l
               or "no-reclaim, not as recovery" in _l
               or "is not a recovery mechanism" in _l
               or "no restart may acquire a dispatch lease" in _l
               or "makes a claimed row claimable again" in _l)
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
# v1.3.5: a SECOND row kind now sits between this one and "#### Two obligations",
# so the slice must end at that heading or H12 would parse 40 fields.
_h12_end = d30.find("#### `acos.journal.dispatch_outcome.v1`")
if _h12_end < 0: _h12_end = d30.find("#### Two obligations")
h12_sec = d30[d30.find("#### `acos.journal.outbox_claimed.v1`"):_h12_end] \
    if "#### `acos.journal.outbox_claimed.v1`" in d30 else ""
h12_parsed = [m[1] for m in re.findall(r"^\| (\d+) \| `?'?([A-Za-z0-9_.]+)'?`? \|", h12_sec, re.M)]
h12_nums = [int(m) for m in re.findall(r"^\| (\d+) \|", h12_sec, re.M)]
h12_order_ok = h12_parsed == [f.strip("'") for f in H12_ORDER]
h12_numbering = h12_nums == list(range(1, len(H12_ORDER) + 1))
# v1.3.5 (JCS-03): the sentence now names BOTH declared kinds. The claim-row
# half is what H12 gates, and it must still be present verbatim.
h12_declared = "**This section is that specification for the outbox claim row" in d30
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


# ============================================================================
# v1.3.5 — J1-J16. MIE-01, OBX-04, OBX-05, SER-01, JCS-03, SEQ-02.
#
# Five items, all found during the S1J implementation pass. MIE-01 and SER-01
# are architecture defects the implementation reported and refused to route
# around; OBX-04, OBX-05, JCS-03 and SEQ-02 are declarations.
#
# Every condition below can FAIL and every one is demonstrated failing by at
# least one of the thirteen v1.3.5 seeds.
# ============================================================================
d25_5 = T[ROOT/"deliverables/25-workflow-and-event-architecture.md"]
d24_5 = T[ROOT/"deliverables/24-company-state-and-evidence-model.md"]
d26_5 = T[ROOT/"deliverables/26-authority-and-policy-model.md"]
d30_5 = T[ROOT/"deliverables/30-observability-audit-and-escalation.md"]
d34_5 = T[ROOT/"deliverables/34-architecture-decision-records.md"]
d35_5 = T[ROOT/"deliverables/35-failure-scenario-walkthroughs.md"]
d36_5 = T[ROOT/"deliverables/36-architecture-validation-plan.md"]
d37_5 = T[ROOT/"deliverables/37-acos-mvp-and-implementation-sequence.md"]
d50_5 = T[ROOT/"deliverables/50-control-artifact-manifest.md"]
d51_5 = T[ROOT/"deliverables/51-limits-fixture.md"]
reg5 = T[ROOT/"phase2-v1.3-invariant-registry.md"]

# ---------------------------------------------------------------- J1
# The reservation must exist at STEP R, in every applicable window instance,
# and the ledger's RESERVE transition must be printed. A statement that the
# unit is "consumed" without a declared reservation is the v1.3.4 defect.
j1 = present(d25_5, [
    "**EVERY AUTHORISED IRRECOVERABLE EXTERNAL EFFECT RESERVES ITS IRRECOVERABLE UNITS BEFORE EXECUTION.**",
    "reserved_irrecoverable += irrecoverable_units",
    "not the first, not a primary, not the most permissive",
])
j1_stepr = present(d26_5, [
    "the same transaction additionally reserves the class's catalogue-declared `irrecoverable_units` into the **third ledger's reserved term**",
    "against **every applicable MIE window instance the effect's authority and grants reference**",
])
j1_k5 = "| **RESERVE**, at local authorisation (`26 §7` step R) | `reserved_irrecoverable += irrecoverable_units` | rises |" in d24_5
j1_inv = "**I67**" in reg5
cond("J1", "Every authorised IRRECOVERABLE external effect reserves its declared irrecoverable "
           "units at local authorisation, into reserved_irrecoverable, on EVERY applicable MIE "
           "window instance; 26 §7 step R states it; 24 §3 K5 prints the RESERVE transition; I67 "
           "carries it",
     not j1 and not j1_stepr and j1_k5 and j1_inv,
     f"25 §10.1 missing: {j1}; 26 §7 step R missing: {j1_stepr}; K5 RESERVE row={j1_k5}; I67={j1_inv}"
     if (j1 or j1_stepr or not j1_k5 or not j1_inv)
     else "3 statements in 25 §10.1, 2 in 26 §7 step R, the K5 RESERVE row, and I67")

# ---------------------------------------------------------------- J2
# The unit count is catalogue-owned. Both the negative (never model/caller) and
# the positive (declared per class, with the figures) are required, plus the
# no-implicit-default rule -- a denylist alone passes on silence.
j2 = present(d25_5, [
    "**`irrecoverable_units` IS KERNEL/CATALOGUE-OWNED AND IS NEVER MODEL- OR CALLER-SUPPLIED.**",
    "no generic caller parameter for it exists",
])
j2_51 = present(d51_5, [
    "### 2.3 `irrecoverable_units` per action class (v1.3.5, MIE-01, S1J-C1)",
    "**THE VALUE IS KERNEL- AND CATALOGUE-OWNED AND IS NEVER MODEL- OR CALLER-SUPPLIED.**",
    "**There is no generic caller parameter for it, and no request field carries one.**",
    "**A future action class needing a value other than 1 must declare it here, and `NO IMPLICIT DEFAULT MAY WIDEN AUTHORITY.`**",
    "| `fulfilment.reship` | IRRECOVERABLE | **1** |",
    "| `refund.create` | COMPENSABLE | **0** |",
])
# It is a signed control artifact, so a unit count cannot move without a signature.
j2_cls17 = "| 7 | `irrecoverable_units` | non-negative integer | **v1.3.6: class 3, not class 17.**" in d50_5
cond("J2", "irrecoverable_units is declared per action class in the closed catalogue, is 1 for "
           "every IRRECOVERABLE class and 0 otherwise, is never model- or caller-supplied, admits "
           "no implicit default, and is signed control-artifact content",
     not j2 and not j2_51 and j2_cls17,
     f"25 §10.1 missing: {j2}; 51 §2.3 missing: {j2_51}; signed class carries it={j2_cls17}"
     if (j2 or j2_51 or not j2_cls17)
     else "2 statements in 25 §10.1, 6 in 51 §2.3, and class 3 carries it")

# ---------------------------------------------------------------- J3
# Unknown IRRECOVERABLE is PRESUMED_EXECUTED and the movement is reserved ->
# presumed. The "not directly to realised" statement is required POSITIVELY,
# because that is the candidate reading the owner rejected.
j3 = present(d25_5, [
    "| `OUTCOME_UNKNOWN` | IRRECOVERABLE | **`PRESUMED_EXECUTED`** | `reserved → presumed` (`§10.1`) | **NO** |",
    "**`consume the irrecoverable unit` IS THE PRESUME ROW, AND NOTHING ELSE.**",
    "The unit does **not** move directly to `realised`, because a presumption is not a realisation and provider truth is unverified.",
])
j3_presume = "| **PRESUME** | `PRESUMED_EXECUTED` is reached (this section, and `§7`'s adapter-returned case) | `reserved -= units`, `presumed += units` | **unchanged** |" in d25_5
j3_k5 = "| **PRESUME**, at `PRESUMED_EXECUTED` | `reserved_irrecoverable -= units`, `presumed_irrecoverable += units` | **unchanged** |" in d24_5
# I3's term 3 must have ONE producer per ledger, or PRESUMED_SETTLED and
# PRESUMED_EXECUTED become two undeclared writers of one term.
j3_i3 = "`presumed_monetary` is produced by `PRESUMED_SETTLED`" in reg5 and "`presumed_irrecoverable` by `PRESUMED_EXECUTED`" in reg5
cond("J3", "An IRRECOVERABLE effect with an unknown outcome reaches PRESUMED_EXECUTED and the "
           "declared movement is reserved -> presumed, stated positively as NOT reserved -> "
           "realised; 24 §3 K5 prints it; and I3's term 3 has exactly one producer per ledger",
     not j3 and j3_presume and j3_k5 and j3_i3,
     f"missing: {j3}; PRESUME row in 25={j3_presume}; K5 PRESUME row={j3_k5}; I3 producers={j3_i3}"
     if (j3 or not j3_presume or not j3_k5 or not j3_i3)
     else "3 statements, the PRESUME row in both 25 §10.1 and 24 §3 K5, and I3's per-ledger producers")

# ---------------------------------------------------------------- J4
# The sum is UNCHANGED by the presumption. This is the condition that catches a
# release-flavoured consumption, and it is asserted in three artifacts because
# a single sentence is what v1.3.4 lacked.
j4 = present(d25_5, [
    "**The sum of the three terms does not fall, so an unknown outcome creates no headroom**",
    "Unknown outcome must not create new headroom",
])
j4_k5 = present(d24_5, [
    "**THE PRESUME MOVEMENT CREATES NO HEADROOM**",
    "the guard reads all three terms and the sum is unchanged",
])
j4_i3 = "PRESUME and REALISE leave the three-term sum unchanged and therefore create no headroom" in reg5
# And nothing is released on an unknown outcome -- the confirmed-not-sent
# release must not leak into the unknown branch.
j4_hold = "**Nothing is released on `OUTCOME_UNKNOWN`.**" in d25_5
cond("J4", "The reserved -> presumed movement leaves the three-term sum unchanged and creates no "
           "headroom, stated in 25 §10.1, 24 §3 K5 and I3; and nothing is released on an unknown "
           "outcome",
     not j4 and not j4_k5 and j4_i3 and j4_hold,
     f"25 missing: {j4}; K5 missing: {j4_k5}; I3={j4_i3}; nothing-released={j4_hold}"
     if (j4 or j4_k5 or not j4_i3 or not j4_hold)
     else "no-headroom stated in three artifacts; nothing released on unknown")

# ---------------------------------------------------------------- J5
# The adapter-returned IRRECOVERABLE case reaches the SAME presumed state.
# v1.3.4 applied one unqualified rule to all three classes.
j5 = present(d25_5, [
    "| `ADAPTER_RETURNED` | IRRECOVERABLE | **`PRESUMED_EXECUTED`** | `reserved → presumed` (`§10.1`) | **NO** |",
    "**`ADAPTER_RETURNED` FOR AN IRRECOVERABLE EFFECT REACHES `PRESUMED_EXECUTED`, NOT AN AWAITING-VERIFICATION STATE.**",
    "**at least as strong as the unknown case** for duplicate-prevention purposes",
    "The unit moves `reserved → presumed` **exactly once**, on whichever of the two outcomes arrives.",
])
# And the money classes keep the awaiting-verification state, so the split is a
# qualification rather than a wholesale replacement.
j5_money = present(d25_5, [
    "| `ADAPTER_RETURNED` | REVERSIBLE | `DISPATCHED_AWAITING_VERIFICATION` | hold, until settlement/verification | **NO** |",
    "| `ADAPTER_RETURNED` | COMPENSABLE | `DISPATCHED_AWAITING_VERIFICATION` | hold, until later resolution | **NO** |",
])
# An adapter response is still not verification.
j5_notver = "**AN ADAPTER RESPONSE IS NEVER INDEPENDENT VERIFICATION.**" in d25_5
j5_adr = "an `ADAPTER_RETURNED` outcome on an IRRECOVERABLE effect reaches **`PRESUMED_EXECUTED`**" in d34_5
cond("J5", "An ADAPTER_RETURNED outcome on an IRRECOVERABLE effect reaches PRESUMED_EXECUTED and "
           "performs the same movement exactly once, while REVERSIBLE and COMPENSABLE keep the "
           "awaiting-verification state; and an adapter response is still never independent "
           "verification",
     not j5 and not j5_money and j5_notver and j5_adr,
     f"irrecoverable missing: {j5}; money rows missing: {j5_money}; not-verification={j5_notver}; ADR-026={j5_adr}"
     if (j5 or j5_money or not j5_notver or not j5_adr)
     else "the recoverability split printed in full, with the not-verification statement and ADR-026")

# ---------------------------------------------------------------- J6
# I20's denominator is HISTORICAL committed reservation evidence. The condition
# requires the reason as well as the rule, because the reason is what stops a
# later pass rebasing it on the live column again.
j6 = present(d25_5, [
    "**`I20`'s right-hand side is the HISTORICAL AUTHORISATION BASIS, not the current balance term.**",
    "a bound written against the *current* value of that column would tighten as presumptions accumulate — inverting the invariant's own direction",
    "**An ACOS-side count is not a provider-reported count**",
])
j6_reg = present(reg5, [
    "**v1.3.5 (MIE-01): the right-hand side is the IMMUTABLE HISTORICAL AUTHORISATION BASIS",
    "NOT the current value of `window_balance.reserved_irrecoverable`**",
    "not an in-process mock's acceptance count",
])
j6_open = "**The ACOS-side denominator is structurally implemented at S1 (v1.3.5); the provider comparison is OPEN.**" in reg5
j6_37 = "**A MOCK'S ACCEPTANCE COUNT IS NOT A PROVIDER ACCEPTED COUNT.**" in d37_5
cond("J6", "I20's right-hand side is the immutable historical committed-reservation basis rather "
           "than the current reserved_irrecoverable column, with the inversion reason stated; no "
           "ACOS-side or mock quantity may stand in for its left-hand side; and I20 is recorded "
           "OPEN for the provider comparison",
     not j6 and not j6_reg and j6_open and j6_37,
     f"25 missing: {j6}; registry missing: {j6_reg}; OPEN={j6_open}; 37={j6_37}"
     if (j6 or j6_reg or not j6_open or not j6_37)
     else "the historical basis, the inversion reason, the substitution ban, and I20 OPEN")

# ---------------------------------------------------------------- J7
# NOT_SENT_CONFIRMED is a DISTINCT state from NEVER_SENT, with a declared
# evidentiary basis that is not a string, and its own release.
j7 = present(d25_5, [
    "**The local state is `DISPATCH_NOT_SENT_CONFIRMED`, and it is deliberately NOT `NEVER_SENT`.**",
    "**`DISPATCH_NOT_SENT_CONFIRMED` is immediate trusted-adapter proof at the dispatch attempt**",
    "**`NEVER_SENT` is later independent provider reconciliation after a possible or presumed execution**",
    "**THE CLASSIFICATION MAY NOT BE MADE FROM ARBITRARY ERROR-MESSAGE STRINGS.**",
    "**Anything for which the request MAY have escaped is `OUTCOME_UNKNOWN`.**",
    "`reserved_irrecoverable -= units`, **with no presumed and no realised increment**",
    "**No presumed unit is touched**",
])
j7_k4 = "**distinct from the later provider-reconciled `NEVER_SENT`**" in d24_5
j7_inv = "**I69**" in reg5
cond("J7", "NOT_SENT_CONFIRMED is admissible only on positive trusted-adapter proof and never from "
           "an error string, reaches a state DISTINCT from the later provider-reconciled "
           "NEVER_SENT, releases the reservation with no presumed or realised increment, touches "
           "no presumed unit, and anything that may have escaped is OUTCOME_UNKNOWN",
     not j7 and j7_k4 and j7_inv,
     f"25 §7.2 missing: {j7}; 24 K4 distinctness={j7_k4}; I69={j7_inv}"
     if (j7 or not j7_k4 or not j7_inv)
     else "7 statements in 25 §7.1/§7.2, K4's distinctness, and I69")

# ---------------------------------------------------------------- J8
# The terminal state never requeues the SAME claimed row, and a further attempt
# is a new identity. Asserted as the full set of forbidden destinations, so a
# partial prohibition fails.
j8 = present(d25_5, [
    "**THE OLD OUTBOX IDENTITY IS TERMINAL AND NON-RECLAIMABLE.** A row in `DISPATCH_NOT_SENT_CONFIRMED` may not return to `ENQUEUED`, may not become `READY`, may not enter a retry state and may not be claimed a second time.",
    "**IF THE BUSINESS INTENT SHOULD BE ATTEMPTED AGAIN, THAT REQUIRES A NEW PROPOSAL, A NEW AUTHORISATION and a NEW EFFECT/OUTBOX IDENTITY**".replace("IF THE BUSINESS INTENT SHOULD BE ATTEMPTED AGAIN, THAT REQUIRES A NEW PROPOSAL, A NEW AUTHORISATION and a NEW EFFECT/OUTBOX IDENTITY", "If the business intent should be attempted again, that requires a NEW PROPOSAL, A NEW AUTHORISATION and a NEW EFFECT/OUTBOX IDENTITY"),
])
j8_i36 = present(reg5, [
    "**v1.3.5 (OBX-04, OBX-05, SER-01): NO OUTCOME MAKES A CLAIMED ROW CLAIMABLE AGAIN.**",
    "`DISPATCH_NOT_SENT_CONFIRMED` is terminal and non-reclaimable and does not return the row to `ENQUEUED`, `READY` or any retry state",
    "**reacquiring `25 §14.1`'s dispatch lease after a crash is not a recovery mechanism.**",
])
cond("J8", "DISPATCH_NOT_SENT_CONFIRMED is terminal and never returns the same claimed outbox row "
           "to ENQUEUED, READY, a retry state or a second claim; a further attempt is a new "
           "proposal, authorisation and effect/outbox identity; and I36 records that no outcome "
           "makes a claimed row claimable again",
     not j8 and not j8_i36,
     f"25 §7.2 missing: {j8}; I36 missing: {j8_i36}"
     if (j8 or j8_i36)
     else "the terminal-state prohibition, the new-identity rule, and I36's three v1.3.5 clauses")

# ---------------------------------------------------------------- J9
# The generic post-claim FAILED -> retry is PROHIBITED, and K4's own wording is
# corrected rather than merely contradicted elsewhere.
j9 = present(d25_5, [
    "**ONCE A ROW IS `CLAIMED`, THE SAME OUTBOX IDENTITY IS NEVER RETRIED OR REDISPATCHED, ON ANY OUTCOME.**",
    "it applies to retryable workflow and internal failures that occur **before** an external-effect claim, and **a claimed external-effect identity is not retryable.**",
    "**It carries no local outcome policy and reaches no local state**",
])
j9_k4 = present(d24_5, [
    "**On adapter failure, bounded retry with jitter applies to retryable workflow and internal failures that occur BEFORE an external-effect claim, then dead-letter to an Incident; a CLAIMED external-effect identity is never retried or re-dispatched**",
])
j9_adr = "**`24 §3` K4's \"bounded retry against the same idempotency key\" is corrected to no retry after a claim**" in d34_5
# The old unqualified sentence must be GONE from the operational corpus, not
# merely contradicted -- a contradiction is the defect S1J-C2 reported.
_j9_raw = nonhistorical(lines_with(
    r"bounded retry with jitter against the same idempotency key", OPERATIONAL))
# A line that QUOTES the defect in order to correct it is not the defect
# surviving. The distinguishing marker is that the quote is attributed and the
# correction is stated on the same line; an unattributed occurrence is a hit.
j9_old = [h for h in _j9_raw
          if "K4's failure behaviour said" not in h[2]
          and "is corrected to" not in h[2]]
cond("J9", "The generic post-claim ADAPTER_FAILED -> retry is prohibited: 24 §3 K4's wording is "
           "CORRECTED to scope retry to pre-claim workflow failures, ADAPTER_FAILED carries no "
           "local policy and reaches no state, ADR-026 records the correction, and the old "
           "unqualified sentence survives nowhere in the operational corpus",
     not j9 and not j9_k4 and j9_adr and not j9_old,
     f"25 §7.1 missing: {j9}; K4 missing: {j9_k4}; ADR-026={j9_adr}; "
     f"old wording still present: {[(x[0], x[1]) for x in j9_old]}"
     if (j9 or j9_k4 or not j9_adr or j9_old)
     else "K4 corrected, ADAPTER_FAILED policy-free, ADR-026 records it, 0 surviving old sentences")

# ---------------------------------------------------------------- J10
# TWO epochs, declared by name, with the gap declared as an explicit property.
# Both epoch spans are checked, and the "not the same lease" prohibition too.
j10 = present(d25_5, [
    "### 14.1 Two serialization epochs, and mandatory dispatch revalidation (v1.3.5, SER-01, S1J-C6)",
    "> **EPOCH A — THE AUTHORITY LEASE.**",
    "held **continuously, with no release and no reacquisition**",
    "> **EPOCH B — THE DISPATCH LEASE.**",
    "**THE GAP — NO DATABASE SESSION LOCK IS HELD, AND THAT IS AN EXPLICIT ARCHITECTURE PROPERTY RATHER THAN A MISSING LOCK.**",
    "**This is a NEW PostgreSQL session, and it is called the `dispatch lease` — it is NOT the same lease as Epoch A's and no artifact and no implementation may describe it as one.**",
])
# The five gap mechanisms must be named, or "safety derives from" is decoration.
j10_gap = present(d25_5, [
    "the **immutable canonical effect**",
    "the **immutable persisted dispatch payload**, bound to the authorised hash and never rebuilt",
    "**content-addressed option identity**",
    "**non-reclaimable outbox semantics** (OBX-01)",
    "**mandatory fresh dispatch-time revalidation before claim**",
])
j10_inv = "**I70**" in reg5
j10_a = "**Epoch A's authority lease, per `25 §14.1` (v1.3.5, SER-01)" in d24_5
cond("J10", "Two serialization epochs are declared by name -- an authority lease and a DISPATCH "
            "lease, each held continuously with no release or reacquisition inside it -- the "
            "asynchronous gap holds no session lock as an explicit property with its five named "
            "safety mechanisms, the dispatch lease is stated NOT to be the same lease, and I70 "
            "carries it",
     not j10 and not j10_gap and j10_inv and j10_a,
     f"25 §14.1 missing: {j10}; gap mechanisms missing: {j10_gap}; I70={j10_inv}; 24 K4 epoch A={j10_a}"
     if (j10 or j10_gap or not j10_inv or not j10_a)
     else "both epochs named, 5 gap mechanisms, the not-the-same-lease rule, and I70")

# ---------------------------------------------------------------- J11
# The OLD one-session-across-the-gap wording must be SUPERSEDED, and the
# supersession must be explicit rather than left to the reader.
j11_super = present(d25_5, [
    "**Superseded in part by `§14.1` (v1.3.5, SER-01): the single continuous propose→authorise→execute span is not achievable across the asynchronous outbox boundary and is replaced by two epochs plus mandatory dispatch-time revalidation.**",
    "**The superseded requirement.**",
    "**That span is not achievable once `§7`'s outbox separates authorisation from dispatch in time and in process.**",
    "**a session-scoped lock lives in one process's connection**",
    "**No mechanism hands a live session lock across that gap, and a later reacquisition is not the same lease.**",
])
# VC-C3 must say plainly that the old wording is not the guarantee and is not
# to be asserted -- 36 is where an implementation would go looking.
j11_vc = present(d36_5, [
    "**The old wording of `25 §14` — one continuous session lease from proposal until an arbitrarily delayed external call — is NOT the guarantee, is not achievable across `25 §7`'s outbox, and is not to be asserted by any implementation.**",
    "**A newly acquired dispatch lease is not the original lease, and no artifact or implementation may describe it as one.**",
])
# And no operational passage may still print the unqualified span.
J11_DENY = r"for the duration of the propose.{0,3}authorise.{0,3}execute span"
j11_hits = []
for h in nonhistorical(lines_with(J11_DENY, OPERATIONAL)):
    if "Superseded in part by" not in h[2] and "not achievable" not in h[2]:
        j11_hits.append(h)
cond("J11", "v1.3.4's single-continuous-lease wording is explicitly SUPERSEDED with its reason, "
            "VC-C3 states the old wording is not the guarantee and is not to be asserted, a later "
            "reacquisition is stated not to be the same lease, and no operational passage still "
            "prints the unqualified span",
     not j11_super and not j11_vc and not j11_hits,
     f"25 §14.1 missing: {j11_super}; 36 missing: {j11_vc}; "
     f"unqualified span still printed: {[(x[0], x[1]) for x in j11_hits]}"
     if (j11_super or j11_vc or j11_hits)
     else f"supersession stated with its reason; {len(j11_vc) == 0 and 2 or 0} VC-C3 statements; 0 unqualified spans")

# ---------------------------------------------------------------- J12
# Dispatch-time revalidation is MANDATORY, operates on the ORIGINAL identity,
# and constructs no payload. All three are load-bearing and separable.
j12 = present(d25_5, [
    "**DISPATCH-TIME REVALIDATION IS MANDATORY, AND A CLAIM MAY NOT OCCUR BEFORE IT.**",
    "the **originally authorised effect** is revalidated against **current authoritative resource state**",
    "using the original `action_class`, the original resource identity, the original enumeration/option identity and the original constructor/version identity",
    "**equivalent of step C′'s content-addressed non-substitution check**",
    "**THE QUESTION IS ONLY WHETHER THE ORIGINALLY AUTHORISED EFFECT IS STILL A VALID CURRENT EFFECT.**",
    "No new payload is constructed. No different option is substituted.",
    "**The persisted payload remains the exact authorised payload**",
])
j12_i53 = "**v1.3.5 (SER-01): the check is performed AGAIN at the dispatch boundary.**" in reg5
j12_26 = "**The dispatch boundary revalidates the originally authorised effect under Epoch B's dispatch lease BEFORE the claim**" in d26_5
cond("J12", "Dispatch-time revalidation is mandatory, revalidates the ORIGINALLY authorised effect "
            "against current authoritative state using the original identity facts, is the "
            "equivalent of C′'s content-addressed non-substitution check, constructs no payload "
            "and substitutes no option; I53 extends to the dispatch boundary; 26 §7 states it",
     not j12 and j12_i53 and j12_26,
     f"25 §14.1 missing: {j12}; I53={j12_i53}; 26={j12_26}"
     if (j12 or not j12_i53 or not j12_26)
     else "7 statements in 25 §14.1, I53 at the dispatch boundary, and 26 §7's concurrency row")

# ---------------------------------------------------------------- J13
# The ORDERING: revalidation strictly precedes the claim, and a claim without
# it is a declared defect. Checked in 30's ordering block, which is where the
# claim's write order actually lives.
j13 = present(d30_5, [
    "**Item 4 evaluates AFTER `25 §14.1`'s dispatch-time revalidation, and never before it (v1.3.5, SER-01).**",
    "**A claim that occurs before revalidation is a defect of this class**",
    "**a revalidation performed outside the dispatch lease proves nothing**",
])
# The printed block must put the lease and the revalidation ahead of BEGIN.
j13_block = ("acquire the DISPATCH LEASE" in d30_5
             and "dispatch-time revalidation" in d30_5
             and d30_5.find("acquire the DISPATCH LEASE")
                 < d30_5.find("dispatch-time revalidation          -- is the ORIGINALLY AUTHORISED effect still valid")
                 < d30_5.find("SELECT ... FOR UPDATE on the dispatch_outbox row"))
j13_refuse = "**If the originally authorised option or effect is no longer valid, the claim is REFUSED.**" in d25_5
cond("J13", "The claim cannot occur before dispatch revalidation: 30 §5.1's ordering block places "
            "the dispatch lease and the revalidation ahead of the claim's BEGIN, a claim before "
            "revalidation is a declared defect, a revalidation outside the lease proves nothing, "
            "and a stale effect REFUSES the claim",
     not j13 and j13_block and j13_refuse,
     f"30 §5.1 missing: {j13}; printed order correct={j13_block}; refusal={j13_refuse}"
     if (j13 or not j13_block or not j13_refuse)
     else "3 statements, the printed order lease -> revalidation -> claim, and the refusal")

# ---------------------------------------------------------------- J14
# The dispatch lease SPANS revalidation -> claim -> adapter -> outcome, as an
# ordered list of all seven steps, and is released only afterwards.
J14_SPAN = [
    "1. dispatch-time revalidation",
    "2. claim-time authority evaluation (30 §5.1 item 4)",
    "3. CLAIM",
    "4. CLAIM COMMIT",
    "5. adapter invocation",
    "6. local adapter-outcome transaction",
    "7. OUTCOME COMMIT",
]
j14 = present(d25_5, J14_SPAN)
j14_pos = -1
j14_ordered = True
for step in J14_SPAN:
    i = d25_5.find(step)
    if i < 0 or i < j14_pos:
        j14_ordered = False
        break
    j14_pos = i
j14_cont = present(d25_5, [
    "It is held **continuously, with no release and no reacquisition inside the epoch**",
    "and released only afterwards.",
    "**No ACOS-authorised entity mutation can intervene between dispatch revalidation and the attempted external effect, or between the external effect and its recorded outcome.**",
])
j14_vc = ("**session 2 attempting a conflicting entity mutation on the same key must not acquire the lease until session 1's adapter and outcome epoch completes and it releases.**"
          in d36_5)
cond("J14", "The dispatch lease spans all seven steps in order -- revalidation, claim-time "
            "authority, CLAIM, CLAIM COMMIT, adapter, outcome transaction, OUTCOME COMMIT -- held "
            "continuously with no release or reacquisition inside the epoch, and VC-C3(b) "
            "validates the exclusion with a real two-session test",
     not j14 and j14_ordered and not j14_cont and j14_vc,
     f"span steps missing: {j14}; printed in order={j14_ordered}; continuity missing: {j14_cont}; VC-C3(b)={j14_vc}"
     if (j14 or not j14_ordered or j14_cont or not j14_vc)
     else "7 span steps in order, continuity stated, and the two-session exclusion test")

# ---------------------------------------------------------------- J15
# The gap-mutation attack DENIES, and the reservation is left held rather than
# released by an invented rule. Both halves are load-bearing: a pass that
# denied and then invented a release would be a different defect.
j15 = present(d25_5, [
    "**If the originally authorised option or effect is no longer valid, the claim is REFUSED.** Nothing is dispatched and nothing is substituted.",
    "**The economic reservation remains held**",
    "no release semantics are invented at this boundary",
    "The stale reason is recorded internally and the denial returned to any model-facing caller is coarse",
])
j15_vc = present(d36_5, [
    "**a legitimate mutation during the gap makes A invalid**",
    "**Assert the claim is REFUSED, assert no adapter invocation occurred, and assert no option was substituted.**",
    "An implementation that dispatches from the persisted eligibility **must fail this case**, and an implementation with dispatch-time revalidation removed **must fail it too**.",
])
j15_26 = "**refuses the claim** if the original option or effect is no longer valid" in d26_5
# Crash inside epoch B must not become a reclaim path.
j15_crash = present(d25_5, [
    "**no restart may acquire a dispatch lease for the purpose of redispatching that row.**",
    "**Reacquiring the dispatch lease is not a recovery mechanism**",
])
cond("J15", "A stale effect after a legitimate gap mutation REFUSES the claim with nothing "
            "dispatched and nothing substituted, the reservation is left held with no invented "
            "release, the denial is coarse, VC-C3(b) requires the two unsafe implementations to "
            "fail, and a crash inside the dispatch epoch is not a reclaim path",
     not j15 and not j15_vc and j15_26 and not j15_crash,
     f"25 missing: {j15}; VC-C3(b) missing: {j15_vc}; 26={j15_26}; crash missing: {j15_crash}"
     if (j15 or j15_vc or not j15_26 or j15_crash)
     else "refusal, held reservation, coarse denial, two must-fail seeds, and no crash reclaim")

# ---------------------------------------------------------------- J16
# The dispatch-outcome row kind's order is DECLARED, parsed out of §5.3a and
# compared element-wise against an independent transcription held here. A
# transposition of two adjacent same-typed fields must fail.
J16_ORDER = [
    "'acos.journal.dispatch_outcome.v1'", "company_id", "journal_seq", "'DISPATCH_OUTCOME'",
    "outbox_id", "outbox_claim_id", "outbox_correlation_tag", "effect_id",
    "authorisation_id", "idempotency_key", "action_class", "resource_ref",
    "dispatch_payload_hash", "dispatch_adapter", "dispatch_outcome_kind",
    "dispatch_effect_status", "outbox_requires_unmirrored_tag", "override_id",
    "occurred_at", "prev_hash",
]
_j16_start = d30_5.find("#### `acos.journal.dispatch_outcome.v1` (v1.3.5, JCS-03, S1J-C5)")
_j16_end = d30_5.find("#### Two obligations this section creates")
j16_sec = d30_5[_j16_start:_j16_end] if 0 <= _j16_start < _j16_end else ""
j16_parsed = [m[1] for m in re.findall(r"^\| (\d+) \| `?'?([A-Za-z0-9_.]+)'?`? \|", j16_sec, re.M)]
j16_nums = [int(m) for m in re.findall(r"^\| (\d+) \|", j16_sec, re.M)]
j16_order_ok = j16_parsed == [f.strip("'") for f in J16_ORDER]
j16_numbering = j16_nums == list(range(1, len(J16_ORDER) + 1))
j16_declared = "**This section is that specification for the outbox claim row and for the dispatch outcome row (v1.3.5, JCS-03, S1J-C5).**" in d30_5
j16_swap = "**Fields 15 and 16 are adjacent, same-typed and semantically distinct**" in j16_sec
j16_vca3 = "**a seeded swap of fields 15 and 16 of `acos.journal.dispatch_outcome.v1` — `dispatch_outcome_kind` and `dispatch_effect_status`, adjacent and same-typed — fails it too (v1.3.5, JCS-03)**" in d36_5
j16_class20 = "v1.3.5 (JCS-03): `acos.journal.dispatch_outcome.v1`'s order is declared in the same section, moving this class's `content_hash` a THIRD time. The signature is owed and is not discharged" in d50_5
# No MIE quantity may be a field of this row -- the ledger records the movement.
j16_nomie = "**No MIE quantity is a field of this row.**" in j16_sec
cond("J16", "acos.journal.dispatch_outcome.v1's field order is declared field by field in 30 "
            "§5.3a, numbered 1..20 without gaps, matches an independent transcription held in this "
            "gate element-wise, names the adjacent same-typed swap pair, carries no MIE quantity, "
            "is required to fail VC-A3 on a seeded swap, and moves control-artifact class 20 a "
            "third time",
     j16_order_ok and j16_numbering and j16_declared and j16_swap and j16_vca3
     and j16_class20 and j16_nomie,
     f"order match={j16_order_ok} (parsed {len(j16_parsed)} fields: {j16_parsed[:4]}...); "
     f"numbering={j16_numbering}; declared={j16_declared}; swap pair named={j16_swap}; "
     f"VC-A3={j16_vca3}; class 20={j16_class20}; no MIE field={j16_nomie}"
     if not (j16_order_ok and j16_numbering and j16_declared and j16_swap and j16_vca3
             and j16_class20 and j16_nomie)
     else f"{len(j16_parsed)} fields in declared order, 1..{len(j16_parsed)}, normative")


# ============================================================================
# v1.3.6 - K1-K25. The control-artifact trust architecture (S1K-C1..S1K-C10).
#
# Every condition below reads the SEEDED corpus, so each one can fail.
# ============================================================================
import hashlib

d30_6 = T[ROOT/"deliverables/30-observability-audit-and-escalation.md"]
d36_6 = T[ROOT/"deliverables/36-architecture-validation-plan.md"]
d37_6 = T[ROOT/"deliverables/37-acos-mvp-and-implementation-sequence.md"]
d49_6 = T[ROOT/"deliverables/49-trusted-computing-base.md"]
d50_6 = T[ROOT/"deliverables/50-control-artifact-manifest.md"]
d51_6 = T[ROOT/"deliverables/51-limits-fixture.md"]
reg_6 = T[ROOT/"phase2-v1.3-invariant-registry.md"]

JCS1_ARTIFACT = ROOT / "artifacts/acos-jcs-1.spec.v1.txt"
JCS1_DECLARED_DIGEST = "7af60fc564aef296679ae06a34b188d3454ac7ef69f448f7260a3d5d55a18f33"
CEDAR_ACCEPTED_DIGEST = "47c2849b41bd0bdf433e75d7cf75b45f3133d93183c8fd447606ce1017c30ff6"


def _sec(body, start, end):
    """The slice of `body` between two headings, or '' when either is missing."""
    i = body.find(start)
    j = body.find(end, i + 1) if i >= 0 else -1
    return body[i:j] if 0 <= i < j else ""


def _ordered(body, needles):
    """True when every needle appears, each at a strictly later offset than the last."""
    pos = -1
    for n in needles:
        i = body.find(n, pos + 1)
        if i <= pos:
            return False
        pos = i
    return True


def _row(body, prefix):
    """The single line of `body` starting with `prefix`, or ''."""
    for ln in body.splitlines():
        if ln.startswith(prefix):
            return ln
    return ""


# ---------------------------------------------------------------- K1
k1 = present(d50_6, [
    "**OWNER CONTROL-ARTIFACT SIGNATURES USE Ed25519.**",
    "RFC 8032 PureEdDSA over Curve25519",
    "**There is no custom elliptic-curve construction, no RSA alternative, and NO ALGORITHM NEGOTIATION IN S1.**",
    "A signature presented under any other algorithm identifier, or in any other encoding, is **REFUSED**",
])
# The same algorithm covers all four signing surfaces, and no second algorithm is admitted.
k1_all_four = ("The same algorithm is used for the primary owner artifact signature, the second-factor approval "
               "signature, the signed manifest envelope, and the Cedar/O4 artifact signatures") in d50_6
k1_no_rsa = "USE RSA" not in d50_6
cond("K1", "Ed25519 is THE declared owner control-artifact signature algorithm -- RFC 8032 PureEdDSA over "
           "Curve25519, covering the primary artifact signature, the second-factor signature, the manifest "
           "envelope and the Cedar/O4 signatures -- with no custom curve, no RSA alternative, no algorithm "
           "negotiation in S1, and any other algorithm identifier REFUSED",
     not k1 and k1_all_four and k1_no_rsa,
     f"50 missing: {k1}; all four surfaces={k1_all_four}; no RSA declaration={k1_no_rsa}"
     if (k1 or not k1_all_four or not k1_no_rsa)
     else "4 statements, all four signing surfaces, and no competing algorithm")

# ---------------------------------------------------------------- K2
k2 = present(d50_6, [
    "**`primary_public_key != second_factor_public_key`**",
    "**`primary_key_id != second_factor_key_id`**",
    "A deployment configuring the same key in both slots **fails closed at bootstrap** and never becomes READY.",
    "**A second signature produced under the primary key does not satisfy the second-factor requirement**",
    "the public keys and their key IDs **must be distinct**",
])
k2_keyid = "`key_id = SHA-256(raw_ed25519_public_key_bytes)`" in d50_6
k2_anchor = "**The key ID is not the trust anchor by itself; the actual public-key bytes are.**" in d50_6
cond("K2", "The primary and second-factor verification keys MUST be distinct -- distinct raw public-key bytes and "
           "therefore distinct key ids, a deployment configuring one key in both slots fails closed at bootstrap, "
           "and a second signature under the primary key does not satisfy the requirement; key_id is "
           "SHA-256(raw public key) and is not itself the trust anchor",
     not k2 and k2_keyid and k2_anchor,
     f"50 missing: {k2}; key_id rule={k2_keyid}; anchor caveat={k2_anchor}"
     if (k2 or not k2_keyid or not k2_anchor)
     else "5 distinctness statements, the key_id rule, and the anchor caveat")

# ---------------------------------------------------------------- K3
k3 = present(d50_6, [
    "**Both public keys are TRUSTED DEPLOYMENT ROOTS. They are not control artifacts. They are not manifest rows.",
    "**The public keys are provisioned OUT OF BAND through the trusted deployment mechanism**",
    "**The manifest may carry key IDs for consistency checking, but it CANNOT DEFINE WHICH PUBLIC KEYS ARE TRUSTED.**",
    "**If the manifest names a different key: FAIL CLOSED.**",
    "**A SIGNATURE DOES NOT ESTABLISH ITS OWN VERIFIER.**",
    "**There is no owner-key artifact signed by itself, and none may be created.**",
    "**terminates outside ACOS's signed artifact graph**",
])
k3_49 = present(d49_6, [
    "**externally provisioned through the trusted deployment mechanism, outside the signed artifact set**",
    "**The owner verification keys terminate outside ACOS's signed artifact graph**",
])
# Rotation is a ceremony, not a runtime "try every key the manifest offers".
k3_rot = present(d50_6, [
    "**There is NO automatic runtime key rotation, and none is invented here.**",
    "root-key rotation is an **OWNER / DEPLOYMENT CEREMONY**",
    "**an old manifest cannot cause its own trust root to remain accepted**",
    "**Online root rotation is DEFERRED.**",
])
cond("K3", "The two root public keys are EXTERNALLY PROVISIONED deployment roots, never control artifacts, never "
           "manifest rows, never discovered from a database, manifest, network, model, caller or API; the manifest "
           "may carry key ids for checking but cannot define trust and a different key FAILS CLOSED; a signature "
           "does not establish its own verifier; and root rotation is a ceremony, not a runtime key search",
     not k3 and not k3_49 and not k3_rot,
     f"50 missing: {k3}; 49 §3.9 missing: {k3_49}; rotation missing: {k3_rot}"
     if (k3 or k3_49 or k3_rot)
     else "7 statements in 50 §3a, 2 in 49 §3.9, and the 4-part rotation ceremony")

# ---------------------------------------------------------------- K4
k4 = present(d50_6, [
    "**TRUST-ON-FIRST-USE IS FORBIDDEN.**",
    "There is no \"remember the key that first verified\" path, no \"accept any valid Ed25519 key\" path, and no per-request key parameter.",
])
k4_49 = "**TRUST-ON-FIRST-USE IS FORBIDDEN.**" in d49_6
k4_no_tofu = "TRUST-ON-FIRST-USE IS PERMITTED" not in d50_6
cond("K4", "TRUST-ON-FIRST-USE IS FORBIDDEN, stated in 50 §3a and again in 49 §3.9, with the three routes it "
           "would take -- remembering the first verifying key, accepting any valid Ed25519 key, and a per-request "
           "key parameter -- each named and denied, and no passage permitting it",
     not k4 and k4_49 and k4_no_tofu,
     f"50 missing: {k4}; 49={k4_49}; no permitting passage={k4_no_tofu}"
     if (k4 or not k4_49 or not k4_no_tofu)
     else "the prohibition in both artifacts, its three routes denied, and no contrary passage")

# ---------------------------------------------------------------- K5
# ORDER, not membership. A message that carried the right fields in the wrong
# order, or dropped one, would pass a membership check and must fail this.
K5_MESSAGE = [
    'CAS_FIELD("ACOS-CONTROL-ARTIFACT-SIGNATURE-V1")',
    "CAS_FIELD(signer_role)",
    "CAS_FIELD(artifact_class)",
    "CAS_FIELD(artifact_id)",
    "CAS_FIELD(artifact_version)",
    "CAS_FIELD(content_sha256)",
]
k5_sec = _sec(d50_6, "### The artifact signature message", "### Signer-role domain separation")
k5_order = _ordered(k5_sec, K5_MESSAGE)
k5_direct = "**Ed25519 signs `M_artifact` directly.**" in k5_sec
k5_bindings = present(d50_6, [
    "| `artifact_class` | **cross-class substitution**",
    "| `artifact_id` | **cross-artifact substitution**",
    "| `artifact_version` | **version substitution**",
    "| `content_sha256` | **content substitution**",
    "| `signer_role` | **role substitution**",
    "**The signer role is an explicit field INSIDE the framed message**",
    "**A signature produced as `PRIMARY` therefore cannot be transplanted into the `SECOND_FACTOR` slot, even if the two keys were accidentally identical**",
])
cond("K5", "The artifact signature envelope BINDS domain, signer role, class, artifact id, version and content "
           "hash, checked as a PRINTED ORDER rather than as membership, signed by Ed25519 directly; and each "
           "binding's substitution attack is named -- cross-class, cross-artifact, version, content and role",
     k5_order and k5_direct and not k5_bindings,
     f"message order={k5_order} (section {len(k5_sec)} chars); direct sign={k5_direct}; bindings missing: {k5_bindings}"
     if not (k5_order and k5_direct and not k5_bindings)
     else "6 framed fields in printed order, direct Ed25519, and 5 named substitutions")

# ---------------------------------------------------------------- K6
k6 = present(d50_6, [
    "**IT DOES NOT DEPEND ON THE ARTIFACT BEING SIGNED.**",
    "**IT DOES NOT DEPEND ON `ACOS-JCS-1`.** No rule of `ACOS-JCS-1` is referenced, imported or required. **IT USES NO JSON AND NO JSON RESERIALIZATION.**",
    "A change to `ACOS-JCS-1` does not change `ACOS-CAS-SIG-V1`",
    "**The same `ACOS-CAS-SIG-V1` field encoding, and no other. No `ACOS-JCS-1`. No JSON. No parsed-object insertion order.**",
    "**NOT REPRESENTABLE.** There is no reserved word, no sentinel and no absent state.",
])
k6_boot = "**its signature envelope and its manifest verification MUST NOT REQUIRE `ACOS-JCS-1`.**" in d50_6
k6_only = "They use only `SHA-256`, the fixed `ACOS-CAS-SIG-V1` framing, and Ed25519." in d50_6
cond("K6", "The signature framing is INDEPENDENT of ACOS-JCS-1 and of the artifact being signed -- no rule "
           "referenced, no JSON, no reserialization, a NULL that is not representable at all, and a class-20 "
           "bootstrap that uses only SHA-256, the fixed CAS framing and Ed25519",
     not k6 and k6_boot and k6_only,
     f"50 missing: {k6}; class-20 bootstrap rule={k6_boot}; only-three primitives={k6_only}"
     if (k6 or not k6_boot or not k6_only)
     else "5 independence statements, the class-20 bootstrap rule, and the three admitted primitives")

# ---------------------------------------------------------------- K7
k7 = present(d50_6, [
    "content_hash = SHA-256(EXACT_ARTIFACT_BYTES)",
    "**The input is the exact immutable bytes deployed to the consumer.**",
    "**WHAT IS NEVER HASHED:** a parsed semantic object; a reserialised JSON document; a pretty-printed object; a TypeScript object literal or its property order; a runtime object graph; a row set read from a database.",
    "**SUPERSEDED BY `§3c` (v1.3.6, `S1K-C5`).**",
    "**the integrity check of the canonicalisation specification does not depend on the canonicalisation specification.**",
])
k7_single = present(d50_6, [
    "**A signed artifact and a separate hard-coded production literal may not both be authority sources**",
    "**For classes 3 and 27 the signed artifact bytes ARE the deployed authority source.**",
    "**It may not maintain a signed artifact value and a hard-coded production literal as two authority sources with equality asserted only in tests**",
])
cond("K7", "content_hash is SHA-256 over EXACT ARTIFACT BYTES, never a parsed object, a reserialised JSON "
           "document, a pretty-printed object, a TypeScript literal or a row set; v1.3.5's canonicalised-content "
           "property is explicitly SUPERSEDED; and a signed artifact may not co-exist with a hard-coded literal as "
           "a second authority source",
     not k7 and not k7_single,
     f"50 §3c missing: {k7}; single-source missing: {k7_single}"
     if (k7 or k7_single)
     else "5 hashing statements and the 3-part single-source rule")

# ---------------------------------------------------------------- K8
k8_sec = _sec(d50_6, "## 2a. Class 3's CLOSED content schema", "## 2b. Class 20's CONCRETE artifact")
k8_rows = [int(m) for m in re.findall(r"^\| (\d+) \| ", k8_sec, re.M)]
k8_numbering = k8_rows == list(range(1, 15))
k8_closed = present(k8_sec, [
    "The list below is the WHOLE of class 3's signed content.",
    "| 9 | `adapter` |",
    "| 10 | `method` |",
    "| 11 | `reason_codes` |",
    "| 14 | `enumeration_max_age` |",
    "**What is NOT class 3 content, stated so the boundary has two sides.**",
    "**No authority-bearing catalogue field exists outside this boundary, and no field in it belongs to a second class.**",
])
# The class-3 row in §2's table carries NO open-membership language.
k8_row = _row(d50_6, "| 3 | **Action catalogue**")
k8_open = [t for t in ("incl.", "including", "etc.") if t in k8_row]
cond("K8", "Class 3's content is CLOSED -- 50 §2a enumerates ten per-class fields and four catalogue-level "
           "records, numbered 1..14 without gaps, states the boundary's other side, and §2's class-3 row carries "
           "no 'incl.', 'including' or 'etc.' open-membership language",
     k8_numbering and not k8_closed and not k8_open and bool(k8_row),
     f"numbering={k8_numbering} (parsed {k8_rows}); missing: {k8_closed}; open language in the class-3 row: {k8_open}"
     if not (k8_numbering and not k8_closed and not k8_open and k8_row)
     else "14 closed fields numbered 1..14 and a class-3 row with no open tail")

# ---------------------------------------------------------------- K9
k9_50 = present(d50_6, [
    "| 7 | `irrecoverable_units` | non-negative integer | **v1.3.6: class 3, not class 17.**",
    "`51 §2.3`'s per-action-class `irrecoverable_units` moves to **class 3**",
    "| `51 §2.3`'s per-action-class `irrecoverable_units` | **class 3**, `§2a` field 7 |",
])
k9_51 = present(d51_6, [
    "`irrecoverable_units` IS CONTROL ARTIFACT CLASS 3 CONTENT**",
    "**THIS CHANGES ARTIFACT OWNERSHIP AND NOT ONE NUMERIC VALUE**",
    "| `fulfilment.reship` | IRRECOVERABLE | **1** |",
    "| `refund.create` | COMPENSABLE | **0** |",
])
# The v1.3.5 assignment must not survive as a live claim.
k9_old_gone = "**This table is part of control artifact class 17's signed content** (`50 §2`), because a unit count is an authority quantity" not in d51_6
cond("K9", "irrecoverable_units belongs to CLASS 3 -- field 7 of 50 §2a's closed schema, restated in 50 §2d's "
           "split table and corrected in 51 §2.3 -- the change is ownership and not one numeric value, the "
           "figures are unmoved, and v1.3.5's class-17 assignment survives nowhere as a live claim",
     not k9_50 and not k9_51 and k9_old_gone,
     f"50 missing: {k9_50}; 51 §2.3 missing: {k9_51}; old class-17 claim gone={k9_old_gone}"
     if (k9_50 or k9_51 or not k9_old_gone)
     else "3 statements in 50, 4 in 51 §2.3, and the v1.3.5 assignment withdrawn")

# ---------------------------------------------------------------- K10
k10_sec = _sec(d50_6, "## 2c. Class 27's CLOSED content schema", "## 2d. Class 17's disposition")
k10_rows = [int(m) for m in re.findall(r"^\| (\d+) \| `", k10_sec, re.M)]
k10_numbering = k10_rows == [1, 2, 3, 4]
k10 = present(k10_sec, [
    "| 1 | `mirror_lag_critical_threshold` | **15 minutes** (`PT15M`) |",
    "| 2 | `audit_unreachable_full_halt_threshold` | **30 minutes** (`PT30M`) |",
    "| 3 | `degraded_per_action_approval_floor_monetary` | **USD 20.00** |",
    "| 4 | `corroboration_signal_max_age` | **5 minutes** (`PT5M`) |",
    "**NO VALUE CHANGES IN THIS PASS.**",
    "**Row 3 moved from class 3 to class 27, and that is an OWNERSHIP correction, not a value change.**",
    "**Both are corrected here. Its ownership is now unambiguous and is not duplicated in class 3.**",
    "**What is NOT class 27 content.**",
    "**Runtime state is not control configuration**",
])
k10_51 = "**CORRECTED IN v1.3.6 (`S1K-C6`): CLASS 27**" in d51_6
k10_not_class3 = ("`degraded_per_action_approval_floor_monetary` LEAVES this class for class 27"
                  in _row(d50_6, "| 3 | **Action catalogue**"))
k10_named_in_2a = "`degraded_per_action_approval_floor_monetary` — **class 27** (`§2c`)" in d50_6
k10_values = ("`MAL_monetary(month)` remains **$300.00**, `MAL_total(month)` at the signature basis remains "
              "**$756.00**") in k10_sec
cond("K10", "Degraded-mode threshold ownership is UNAMBIGUOUS -- class 27's schema is closed at exactly four "
            "static quantities numbered 1..4, the $20.00 approval floor moves from class 3 to class 27 as an "
            "OWNERSHIP correction with no value change, class 3 no longer claims it in either 50 §2 or 50 §2a, "
            "51 §3.7 records the correction, and no runtime state is class-27 content",
     k10_numbering and not k10 and k10_51 and k10_not_class3 and k10_named_in_2a and k10_values,
     f"numbering={k10_numbering} (parsed {k10_rows}); 50 §2c missing: {k10}; 51 §3.7 corrected={k10_51}; "
     f"class-3 row clean={k10_not_class3}; named in §2a={k10_named_in_2a}; MAL unmoved={k10_values}"
     if not (k10_numbering and not k10 and k10_51 and k10_not_class3 and k10_named_in_2a and k10_values)
     else "4 closed quantities, the ownership correction in both artifacts, and the MAL basis unmoved")

# ---------------------------------------------------------------- K11
k11 = present(d50_6, [
    "**PER-COMPANY `window_registry` ROWS ARE NOT DEPLOY-TIME SIGNED CONTROL ARTIFACTS.** They are runtime authoritative database state.",
    "## 2d. Class 17's disposition: RETIRED (v1.3.6, `S1K-C7`)",
    "**Nothing static remains with a runtime consumer.**",
    "**No empty or signature-only artifact is retained to preserve numbering.**",
    "Class number **17 is reserved and deprecated**",
    "**`I19` IS NOT A GENERIC DATABASE-ROW-SIGNING SYSTEM AND IS NOT EXTENDED INTO ONE.**",
    "**`I19` DOES NOT AUTHENTICATE ORDINARY MUTABLE RUNTIME DATABASE STATE",
])
# The named runtime-integrity controls that replace the signing claim.
k11_controls = present(d50_6, [
    "**trusted writer boundaries**",
    "**PostgreSQL constraints**",
    "**economic transaction semantics**",
    "**journal and audit mechanisms**",
])
k11_inventory = "| ~~**17**~~ |" in d50_6 and "**NO — retired**" in d50_6
cond("K11", "Per-company window_registry rows are RUNTIME STATE and not deploy-time signed content: class 17 is "
            "retired from the manifest with no empty artifact retained, the number is reserved and deprecated, the "
            "inventory records it as a non-member, the four runtime-integrity controls that govern it instead are "
            "named, and I19 is not extended into a database-row-signing system",
     not k11 and not k11_controls and k11_inventory,
     f"50 missing: {k11}; runtime controls missing: {k11_controls}; inventory row={k11_inventory}"
     if (k11 or k11_controls or not k11_inventory)
     else "7 disposition statements, 4 named runtime controls, and the retired inventory row")

# ---------------------------------------------------------------- K12
# The gate RECOMPUTES the artifact's digest. A declaration that drifted from the
# bytes fails here, and so does a declaration that was removed.
k12_exists = JCS1_ARTIFACT.is_file()
k12_bytes = JCS1_ARTIFACT.read_bytes() if k12_exists else b""
k12_digest = hashlib.sha256(k12_bytes).hexdigest() if k12_exists else ""
k12_match = k12_digest == JCS1_DECLARED_DIGEST
k12_size = len(k12_bytes) == 13479
k12_lf = k12_exists and b"\r" not in k12_bytes
k12_decl_50 = d50_6.count(JCS1_DECLARED_DIGEST)
k12_decl_30 = JCS1_DECLARED_DIGEST in d30_6
k12_sec = present(d50_6, [
    "## 2b. Class 20's CONCRETE artifact (v1.3.6, `S1K-C8`)",
    "| Artifact | `artifacts/acos-jcs-1.spec.v1.txt`, in this package |",
    "| `artifact_id` | `acos.control.jcs1_specification` |",
    "| Size | **13479 bytes** |",
    "**LF (`0x0A`) line terminators exclusively; the file contains no `0x0D` byte.**",
])
cond("K12", "Class 20 has a CONCRETE artifact: artifacts/acos-jcs-1.spec.v1.txt exists, is 13479 bytes, contains "
            "no CR byte, and its RECOMPUTED SHA-256 equals the digest declared in 50 §2's class-20 row, 50 §2b, "
            "50 §6 and 30 §5.3a -- a digest that drifted from the bytes, or a declaration removed, fails here",
     k12_exists and k12_match and k12_size and k12_lf and k12_decl_50 >= 3 and k12_decl_30 and not k12_sec,
     f"exists={k12_exists}; size={len(k12_bytes)}; LF-only={k12_lf}; recomputed={k12_digest[:16]}...; "
     f"declared={JCS1_DECLARED_DIGEST[:16]}...; match={k12_match}; declarations in 50={k12_decl_50}; "
     f"in 30={k12_decl_30}; §2b missing: {k12_sec}"
     if not (k12_exists and k12_match and k12_size and k12_lf and k12_decl_50 >= 3 and k12_decl_30 and not k12_sec)
     else f"13479 bytes, LF only, recomputed digest matches, {k12_decl_50} declarations in 50 and 1 in 30")

# ---------------------------------------------------------------- K13
k13_50 = present(d50_6, [
    "**The control plane and the audit plane each hold a BYTE-IDENTICAL COPY of this artifact.** That is not a loss of implementation independence.",
    "**Same specification; independent implementations.**",
    "**and none of their source code is ever hashed as class 20.**",
    "**IT DOES NOT PROVE THAT ANY IMPLEMENTATION CONFORMS TO IT.**",
    "**`I19` does not replace VC-A3, does not weaken it, and does not discharge any of its obligations.**",
])
k13_30 = present(d30_6, [
    "**CLASS 20 SIGNS THE SPECIFICATION, NEVER AN IMPLEMENTATION OF IT**",
    "**no implementation's source code is ever hashed as class 20**",
    "`36 §2`'s VC-A3 remains the conformance mechanism and `I19` does not replace it.**",
])
k13_36 = "`I19` DOES NOT REPLACE VC-A3, does not weaken it, and discharges none of its obligations**" in d36_6
cond("K13", "The four independent ACOS-JCS-1 implementations stay separate from the class-20 specification bytes: "
            "each may hold a byte-identical COPY, no implementation's source is ever hashed as class 20, and a "
            "valid class-20 signature proves the specification is owner-approved and proves NO implementation "
            "conforms -- VC-A3 remains the conformance mechanism in all three artifacts that mention it",
     not k13_50 and not k13_30 and k13_36,
     f"50 §2b missing: {k13_50}; 30 §5.3a missing: {k13_30}; 36 VC-A3={k13_36}"
     if (k13_50 or k13_30 or not k13_36)
     else "5 statements in 50 §2b, 3 in 30 §5.3a, and VC-A3's standing restated in 36")

# ---------------------------------------------------------------- K14
k14 = present(d50_6, [
    "**v1.3.6 — THE SECOND FACTOR IS A SECOND INDEPENDENT Ed25519 APPROVAL SIGNATURE (`S1K-C10`).**",
    "**EVERY pre-live signed artifact requires TWO valid signatures**",
    "**a second signature from the same key DOES NOT satisfy the requirement.**",
    "An artifact or a manifest presenting one valid signature is **REFUSED**, and is never reported as verified.",
    "both inside the signed manifest core",
])
# Every live inventory row demands both signatures; the retired row demands neither.
k14_inv = _sec(d50_6, "## 6. The control-artifact inventory after v1.3.6", "**Also in the manifest at the pre-live gate")
k14_live = [ln for ln in k14_inv.splitlines() if ln.startswith("| **") and ln.count("|") >= 9]
k14_both = all("| **YES** | **YES** | **YES** |" in ln for ln in k14_live) and len(k14_live) == 4
cond("K14", "EVERY in-scope pre-live artifact carries TWO signatures -- a primary owner signature and a distinct "
            "second-factor approval signature, with a single valid signature REFUSED and never reported as "
            "verified -- and all four live inventory rows demand both plus manifest membership",
     not k14 and k14_both,
     f"50 §4 missing: {k14}; live inventory rows={len(k14_live)}, all dual-signed and member={k14_both}"
     if (k14 or not k14_both)
     else f"5 statements in 50 §4 and {len(k14_live)} inventory rows each requiring both signatures")

# ---------------------------------------------------------------- K15
K15_MESSAGE = [
    'CAS_FIELD("ACOS-CONTROL-MANIFEST-SIGNATURE-V1")',
    "CAS_FIELD(signer_role)",
    "CAS_FIELD(manifest_format_version)",
    "CAS_FIELD(manifest_epoch)",
    "CAS_FIELD(expected_primary_key_id)",
    "CAS_FIELD(expected_second_factor_key_id)",
    "CAS_FIELD(manifest_core_sha256)",
]
k15_sec = _sec(d50_6, "### The manifest signatures", "## 3e. Manifest identity")
k15_order = _ordered(k15_sec, K15_MESSAGE)
k15 = present(d50_6, [
    "**THE MANIFEST CORE ITSELF RECEIVES BOTH SIGNATURES**",
    "under the separate domain `ACOS-CONTROL-MANIFEST-SIGNATURE-V1`",
    "**The manifest's own two signatures are NOT inside the bytes being signed.**",
    "**The manifest core itself is dual-signed on the same rule.**",
])
cond("K15", "The MANIFEST CORE itself is dual-signed -- a primary and a second-factor Ed25519 signature under a "
            "SEPARATE domain, over a message that binds the format version, the epoch, both expected key ids and "
            "the core digest in printed order, with the manifest's own two signatures outside the signed bytes",
     k15_order and not k15,
     f"manifest message order={k15_order} (section {len(k15_sec)} chars); missing: {k15}"
     if not (k15_order and not k15)
     else "7 framed fields in printed order and 4 required statements")

# ---------------------------------------------------------------- K16
K16_CORE = [
    'CAS_FIELD("ACOS-CONTROL-MANIFEST-CORE-V1")',
    "CAS_FIELD(manifest_format_version)",
    "CAS_FIELD(manifest_epoch)",
    "CAS_FIELD(expected_primary_key_id)",
    "CAS_FIELD(expected_second_factor_key_id)",
    "CAS_FIELD(entry_count)",
    "CAS_FIELD(artifact_class)",
    "CAS_FIELD(artifact_id)",
    "CAS_FIELD(artifact_version)",
    "CAS_FIELD(content_sha256)",
    "CAS_FIELD(primary_signature)",
    "CAS_FIELD(second_factor_signature)",
]
k16_sec = _sec(d50_6, "### The core's bytes", "### The manifest signatures")
k16_order = _ordered(k16_sec, K16_CORE)
k16 = present(d50_6, [
    "| `entry_count` | the **exact** number of artifact entries |",
    "| `entries` | the exact **ordered** artifact entries |",
    "**Ascending by `(artifact_class, artifact_id, artifact_version)`**",
    "1. `artifact_class` — as an **unsigned integer**, ascending;",
    "2. `artifact_id` — **byte-wise lexicographic** over its UTF-8 NFC bytes, with a proper prefix sorting before its extensions;",
    "3. `artifact_version` — **byte-wise lexicographic** over its UTF-8 NFC bytes, on the same rule.",
    "**The order is a property of the bytes, not of any implementation's map iteration, locale or collation.**",
    "Two entries with all three keys equal are a **defect**",
    "`entry_count` is inside the signed bytes **and** the entries follow it, so a deletion is detectable twice over",
])
cond("K16", "The manifest entry SET and ORDER are deterministic: the core carries an exact entry_count and the "
            "exact ordered entries, sorted ascending by (artifact_class, artifact_id, artifact_version) with each "
            "key's comparison declared, the order is a property of the bytes rather than of map iteration, an "
            "exact tie is a defect, and the core's field sequence is checked in printed order",
     k16_order and not k16,
     f"core byte order={k16_order} (section {len(k16_sec)} chars); missing: {k16}"
     if not (k16_order and not k16)
     else "12 framed core fields in printed order and 9 required statements")

# ---------------------------------------------------------------- K17
k17 = present(d50_6, [
    "manifest_id = SHA-256(exact CORE bytes)",
    "**Not `ACOS-JCS-1`. Not a parsed JSON object's insertion order.**",
    "**THE TRUSTED DEPLOYMENT CONFIGURATION PINS THREE THINGS:**",
    "3. `EXPECTED_ACTIVE_MANIFEST_ID` — the manifest identity this deployment is intended to run.",
    "**The runtime may verify a manifest only if its computed `manifest_id` equals `EXPECTED_ACTIVE_MANIFEST_ID`.**",
    "The pin is checked **before** the signatures",
    "**This introduces no mutable runtime trust state.**",
])
cond("K17", "The deployment PINS the active manifest identity: manifest_id is SHA-256 over the exact core bytes "
            "under the fixed framing and not ACOS-JCS-1, the trusted configuration pins both root keys AND "
            "EXPECTED_ACTIVE_MANIFEST_ID, the pin is checked BEFORE the signatures, and no mutable runtime trust "
            "state is introduced",
     not k17,
     f"missing: {k17}" if k17 else "7 statements in 50 §3e")

# ---------------------------------------------------------------- K18
k18 = present(d50_6, [
    "| a valid **old** signed manifest presented | **REJECTED** — its `manifest_id` differs from the pin |",
    "| a **deleted** entry | **REJECTED** — `entry_count` and the entry sequence both move `manifest_id` |",
    "| an **inserted** entry | **REJECTED** — same |",
    "| entries **reordered** | **REJECTED** — the declared order is normative and the bytes differ |",
    "> **\"THE HIGHEST EPOCH FOUND ON DISK\" IS NOT ROLLBACK PROTECTION AND IS NOT USED.**",
    "**the pin is what rejects a rollback.**",
])
k18_no_epoch_rule = "highest `manifest_epoch` found on disk" not in d50_6
cond("K18", "A valid OLD signed manifest cannot satisfy the active pin -- the rejection table names the old "
            "manifest, the deleted entry, the inserted entry and the reordering, each rejected on the pin -- and "
            "'the highest epoch found on disk' is explicitly NOT rollback protection and is used nowhere",
     not k18 and k18_no_epoch_rule,
     f"missing: {k18}; no highest-epoch selection rule={k18_no_epoch_rule}"
     if (k18 or not k18_no_epoch_rule)
     else "4 rejection rows, the epoch disclaimer, and no epoch-selection rule anywhere")

# ---------------------------------------------------------------- K19
K19_STEPS = [
    "1. load the two root public keys from the deployment trust configuration;",
    "2. check `primary_public_key != second_factor_public_key`;",
    "3. compute `manifest_id` and check it equals `EXPECTED_ACTIVE_MANIFEST_ID`;",
    "4. verify **both** manifest signatures against the two provisioned keys;",
    "5. check `expected_primary_key_id` and `expected_second_factor_key_id` in the core equal the provisioned keys' ids;",
    "6. verify the **complete** manifest set",
    "7. for **every** required artifact: recompute `SHA-256` over its exact bytes and compare to its entry's `content_hash`;",
    "8. for **every** required artifact: verify **both** signatures under `§3b`'s envelope.",
]
k19_sec = _sec(d50_6, "### Occasion 1 — BOOTSTRAP", "### Occasion 2 — PUBLICATION / RELOAD")
k19_order = _ordered(k19_sec, K19_STEPS)
k19_before = "**Before the kernel becomes READY**, in this order:" in k19_sec
k19_closed = ("**On any failure the kernel FAILS CLOSED BEFORE ANY AUTHORITY EXECUTION.** It does not become "
              "READY, it does not serve a degraded subset, and it does not admit a single effect.") in k19_sec
k19_fail = present(d50_6, [
    "- **fail closed**;",
    "- **do not use the candidate artifact**;",
    "- raise the declared **CRITICAL security incident**;",
    "- **do not silently fall back to an older artifact**;",
    "- **do not fetch a replacement from the network**.",
    "**A journal chain must NOT be fabricated using unverified `ACOS-JCS-1` rules**",
])
cond("K19", "BOOTSTRAP verifies BEFORE READY: eight steps in printed order, from loading the provisioned keys "
            "through both signatures on every artifact, with any failure failing closed before any authority "
            "execution -- no degraded subset, no admitted effect -- and the declared incident semantics retained "
            "with no silent fallback, no network fetch and no fabricated journal chain",
     k19_order and k19_before and k19_closed and not k19_fail,
     f"step order={k19_order} (section {len(k19_sec)} chars); before READY={k19_before}; "
     f"fail-closed={k19_closed}; failure semantics missing: {k19_fail}"
     if not (k19_order and k19_before and k19_closed and not k19_fail)
     else "8 bootstrap steps in printed order, fail-closed before READY, and 6 retained failure rules")

# ---------------------------------------------------------------- K20
k20_sec = _sec(d50_6, "### Occasion 2 — PUBLICATION / RELOAD", "### Occasion 3 — RUNTIME AUTHORITY USE")
k20 = present(k20_sec, [
    "**Any artifact or manifest reload is verified COMPLETELY BEFORE BECOMING ACTIVE.**",
    "The full ceremony of occasion 1 runs against the candidate bundle.",
    "**Publication of a new verified bundle is ATOMIC**, and **a failed candidate bundle NEVER replaces the current verified bundle.** There is no partial swap and no per-artifact hot reload.",
])
cond("K20", "RELOAD verifies BEFORE PUBLICATION: the full bootstrap ceremony runs against the candidate, "
            "publication is atomic, a failed candidate never replaces the active bundle, and there is no partial "
            "swap and no per-artifact hot reload",
     not k20 and bool(k20_sec),
     f"50 §3f occasion 2 missing: {k20} (section {len(k20_sec)} chars)"
     if (k20 or not k20_sec) else "3 statements in occasion 2")

# ---------------------------------------------------------------- K21
k21 = present(d50_6, [
    "**`I19` IS EVENT- AND USE-GATED. IT IS NOT PERIODIC-TIMER SECURITY.**",
    "No polling cadence is introduced — not 30 seconds, not 60 seconds, not 5 minutes, not any interval.",
    "NO AUTHORITY CONSUMER CAN OBTAIN OR USE AN UNVERIFIED CONTROL-ARTIFACT BUNDLE**",
    "**Production authority code receives only a `VerifiedControlArtifactBundle`**",
    "**Raw or unverified artifact loaders are NOT EXPOSED TO AUTHORITY CONSUMERS**, and **no caller and no model may manufacture this capability.**",
    "**Re-verifying signatures inside every request is NOT required**",
    "**The runtime does NOT dynamically reread arbitrary backing bytes on each authority operation. The active verified bundle is IMMUTABLE.**",
    "**If files change on disk after verification, they have NO AUTHORITY EFFECT until an explicit reload occurs**",
    "**That is what \"continuous\" means in `I19`: continuity of the capability, not frequency of a check.**",
    "**external claim and dispatch cannot proceed if the verified bundle is unavailable or invalid.**",
])
k21_reg = ("**v1.3.6: CI + RUNTIME (BOOTSTRAP + PUBLICATION + VERIFIED-CAPABILITY USE). `SCHED` IS WITHDRAWN "
           "— `I19` IS EVENT- AND USE-GATED AND REQUIRES NO POLLING CADENCE (`50 §3f`)**") in reg_6
cond("K21", "Authority consumers accept ONLY the verified bundle capability: raw loaders are not exposed, no "
            "caller or model may manufacture it, the active bundle is immutable so a disk change has no authority "
            "effect until an explicit reload, per-request re-verification is not required, external dispatch "
            "cannot proceed without it, and no polling cadence exists -- SCHED is withdrawn from the registry",
     not k21 and k21_reg,
     f"50 §3f missing: {k21}; registry SCHED withdrawn={k21_reg}"
     if (k21 or not k21_reg)
     else "10 statements in 50 §3f and the registry's enforcement column corrected")

# ---------------------------------------------------------------- K22
k22 = present(d50_6, [
    "## 2e. Class 2's concrete artifact, and `policy_version` (v1.3.6, `S1K-C6`)",
    "**A Cedar policy bundle is admitted to the engine only after the verified manifest, its `content_hash`, its primary signature and its second-factor signature have all been checked.**",
    "A bundle presented with a matching hash and no valid signature pair is **REFUSED**.",
    "**`policy_version` is NOT the class-2 content hash, and neither replaces the other.**",
    "It is not the symcc proof gate, not a policy-equivalence check, and not a policy-rotation mechanism.",
    "It says nothing about Cedar **semantic** correctness.",
])
k22_digest = CEDAR_ACCEPTED_DIGEST in d50_6
k22_unchanged = ("**its accepted current value is `" + CEDAR_ACCEPTED_DIGEST +
                 "`, and it remains the accepted current digest unless the actual policy bytes change.**") in d50_6
cond("K22", "The Cedar policy bundle is INSIDE the signed owner-artifact framework: class 2 has a concrete "
            "bundle artifact, admission to the engine requires the verified manifest, the content hash AND both "
            "signatures, a hash-only bundle is REFUSED, the accepted policy_version digest is retained unchanged "
            "and is declared NOT to be the class-2 content hash, and no semantic claim is conflated with it",
     not k22 and k22_digest and k22_unchanged,
     f"missing: {k22}; accepted digest present={k22_digest}; retained-unchanged statement={k22_unchanged}"
     if (k22 or not k22_digest or not k22_unchanged)
     else "6 statements, the accepted digest retained, and the semantic obligations left where they were")

# ---------------------------------------------------------------- K23
k23 = present(d37_6, [
    "- **external anchoring / `I17b`** — an **S3** deliverable, and it is **NOT** the bootstrap root of trust for S1K.",
    "`50 §3e`'s deployment pin is what rejects a rollback; the anchor may later add historical and non-repudiation protection, and adds none of it here.",
    "**S1K does not depend on `I17b` and must not be made to;**",
])
cond("K23", "The external anchor I17b is NOT required for bootstrap: it stays an S3 deliverable, the deployment "
            "pin is what rejects a rollback, the anchor adds only later historical and non-repudiation protection, "
            "and S1K is declared not to depend on it",
     not k23,
     f"37 missing: {k23}" if k23 else "3 statements in 37 §2's S1K gate")

# ---------------------------------------------------------------- K24
K24_ITEMS = [
    "- **externally rooted owner signature verification**",
    "- **second-factor verification**",
    "- **signed manifest set integrity**",
    "- **a verified class-3 action catalogue** (`50 §2a`);",
    "- **a verified class-20 `ACOS-JCS-1` specification artifact** (`50 §2b`);",
    "- **a verified class-27 degraded-mode configuration** (`50 §2c`);",
    "- **signed Cedar policy / `O4` verification** before the engine is constructed (`50 §2e`);",
    "- **runtime verified-bundle gating as `I19` requires**",
    "- **the migration of classes 3 and 27 off duplicated unsigned production literals onto the verified bundle** (`50 §3f`).",
]
k24_gate = _sec(d37_6, "**S1K — THE PRE-LIVE CONTROL-ARTIFACT INTEGRITY GATE",
                "**LATER EXECUTION / ADAPTER SLICE")
k24_items = _ordered(k24_gate, K24_ITEMS)
k24_before = "**BEFORE THE FIRST REAL EXTERNAL VENDOR CALL, ACOS MUST HAVE:**" in k24_gate
# POSITION: the gate is printed inside S1's block, ahead of the vendor slice.
k24_pos = (0 <= d37_6.find("**S1K — THE PRE-LIVE CONTROL-ARTIFACT INTEGRITY GATE")
           < d37_6.find("**LATER EXECUTION / ADAPTER SLICE"))
k24_s4 = "**The pre-live gate is sequenced BEFORE the first real vendor call; the rest of this item is not.**" in d37_6
k24_none = "**NO PRODUCTION SIGNING CODE EXISTS AT v1.3.6.**" in d37_6
cond("K24", "The pre-live gate is SEQUENCED BEFORE the first real vendor call: 37 §2 prints the nine required "
            "items in order inside S1's block, ahead of the vendor slice -- checked by string POSITION, not "
            "membership -- S4's own entry records the same ordering, and the entry states that no production "
            "signing code exists at v1.3.6",
     k24_items and k24_before and k24_pos and k24_s4 and k24_none,
     f"items in order={k24_items} (gate {len(k24_gate)} chars); before-vendor statement={k24_before}; "
     f"printed before the vendor slice={k24_pos}; S4 entry={k24_s4}; no-code disclaimer={k24_none}"
     if not (k24_items and k24_before and k24_pos and k24_s4 and k24_none)
     else "9 gate items in printed order, ahead of the vendor slice, with S4 agreeing")

# ---------------------------------------------------------------- K25
k25 = present(d37_6, [
    "**WHAT DOES NOT MOVE FORWARD, AND STAYS AT S4 OR LATER:**",
    "- **owner-signed hashes across the remaining classes**",
    "- **the later owner briefing**, the unrelated S4 audit mechanisms, and **provider reconciliation**;",
    "- **class 19's migration onto the same externally provisioned roots** (`50 §3i`) — declared future work, not a pre-live blocker.",
    "**`50-control-artifact-manifest.md` with owner-signed hashes across the REMAINING classes** (I19).",
])
k25_19 = present(d50_6, [
    "## 3i. Class 19's relationship to this mechanism (v1.3.6, `S1K-C3`)",
    "**A CALLER-SUPPLIED VERIFICATION KEY IS NOT A TRUST ROOT**, and it must not become the general S1K pattern.",
    "THAT MIGRATION IS DECLARED FUTURE WORK**",
    "**It is not a separate trust domain by design.**",
])
cond("K25", "Unrelated S4 work REMAINS LATER: the remaining signed classes, the later owner briefing, the "
            "unrelated S4 audit mechanisms and provider reconciliation each stay at S4, S4 keeps its own manifest "
            "entry for them, and class 19's migration onto the same roots is declared future work rather than "
            "silently claimed to satisfy the owner root model",
     not k25 and not k25_19,
     f"37 missing: {k25}; 50 §3i missing: {k25_19}"
     if (k25 or k25_19)
     else "4 retained S4 items plus S4's own entry, and class 19 declared as follow-on")



print(f"# ACOS v1.3 / v1.3.1 / v1.3.2 / v1.3.3 / v1.3.4 / v1.3.5 / v1.3.6 mechanical consistency pass — {len(results)} conditions\n")
w=max(len(c[1]) for c in results)
for cid, desc, res, detail in results:
    print(f"{cid:5s} {res:4s}  {desc}")
    if detail: print(f"          {detail}")
fails=[r for r in results if r[2]=="FAIL"]
print(f"\nRESULT: {len(results)-len(fails)} PASS / {len(fails)} FAIL")
sys.exit(1 if fails else 0)
