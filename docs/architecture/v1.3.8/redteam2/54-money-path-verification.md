# 54 — Money Path Verification

**ACOS Operating Spine v1.1. Second red team. Issued 2026-09-03.**
Covers the Effect Canonicaliser (R1), `StandingAuthorization` (R2), `MAL`/`MIE` (R8) and reservation/approval behaviour (R9's money half). Findings are registered in `53`; this document carries the verification work.

---

## 1. Method

Three passes, in this order, because the third is the only one that answers the brief's real question.

1. **Recompute** every figure in `51 §4` from `26 §10.1`'s formulae and `51 §3`'s grant data, by an implementation written before reading `51 §4`'s totals. Source in `appendix/recompute.py`.
2. **Vary the conventions** the formulae leave unstated, and record which figures move.
3. **Trace realisable loss** through the reservation lifecycle rather than through the grant registry, because `MAL_total` is a function of grants and loss is a function of the ledger.

---

## 2. Independent recomputation of `51 §4`

### 2.1 Result under the fixture's own implicit conventions

| Quantity | `51` prints | I recompute | Agreement |
|---|---|---|---|
| `MAL_monetary(day)` | $62.50 | $62.50 | ✅ |
| `MAL_monetary(month)` | $300.00 | $300.00 | ✅ |
| `Standing(day)` | $6.00 | $6.00 | ✅ (see §2.3) |
| `Standing(month)` | $180.00 | $180.00 | ✅ (30-day basis only — §2.4) |
| `MIE_cost(day)` | $105.00 | $105.00 | ✅ |
| `MIE_cost(month)` | $120.00 | $120.00 | ✅ |
| `MAL_total(day)` | $173.50 | $173.50 | ✅ |
| `MAL_total(month)` | $600.00 | $600.00 | ✅ |
| `30 × MAL_total(day)` | $5,205.00 | $5,205.00 | ✅ |
| Stage-1 `MAL_total(month)` | $10.00 | $10.00 | ✅ |

**The printed arithmetic is correct.** Every term reproduces. This is worth stating plainly, because it is the cheapest high-value check in the brief and `51` passes it.

### 2.2 The composition claim in `51 §4.2` holds

Brute-force per class over a 30-day month, taking `min(month_count, day_count × 30)`:

| Class | Day | Month | Realisable actions | Realisable value |
|---|---|---|---|---|
| `refund.create` | 2 | 10 | `min(10, 60) = 10` | $250.00 |
| `goodwill.credit.issue` | 1 | 4 | `min(4, 30) = 4` | $50.00 |
| `fulfilment.reship` (discr.) | 2 | 2 | `min(2, 60) = 2` | $70.00 |
| `order.address.edit` | 1 | 1 | `min(1, 30) = 1` | $30.00 |
| `email.send` (discr.) | 10 | 40 | `min(40, 300) = 40` | $20.00 |

The MONTH window binds in every class. **`$5,205` is not reachable through the fixture's declared non-rate and discretionary grants, and `51 §4.2`'s stated reason is the correct one.** Attack F-09 in `53 §6` is recorded as defeated.

### 2.3 Where the arithmetic is correct and the semantics are not: `min()` over an absent cap

`MAL_monetary` evaluates `min(g.window(w).max_monetary, per_action × count)`. `51 §2` declares **nine windows and not one monetary cap**, so every term takes the min against an absent operand. Under three conventions:

| Convention | `MAL_monetary(day)` | `MAL_monetary(month)` |
|---|---|---|
| absent = +∞ (what `51 §4` uses) | $62.50 | $300.00 |
| absent = 0 | $0.00 | $0.00 |
| absent = undefined, strict | undefined | undefined |

`I7`'s oracle is a second implementation. Mine agrees with `51` **only because I inferred the convention from `51 §4`'s printed result** — which is exactly the circularity `36 §0` exists to prevent. A genuinely blind second implementation had a one-in-three chance of displaying a $0.00 ceiling against $300.00 of realisable authority, and `I7` would have reported disagreement without indicating which side was right. Registered as **LIM-01**.

### 2.4 `Standing(month)` is computed against the rate period, not the window

`26 §10.1` says `forward_exposure_to_window_end(w)`. `W_MONTH_ADSPEND` is a **calendar month** (`51 §2`). The rate period is 30 days (`51 §3.2`).

| Days in the calendar month | Correct `Standing(month)` | `51` prints |
|---|---|---|
| 28 | $168.00 | $180.00 |
| 29 | $174.00 | $180.00 |
| 30 | $180.00 | $180.00 |
| **31** | **$186.00** | $180.00 |
| Google's 30.4 basis | $182.40 | $180.00 |

`MAL_total(month)` is therefore $606.00 in a 31-day month, not $600.00. Registered as **STD-06**. The magnitude is 1%; the significance is that `I7` will either fail in CI in January or pass by reproducing the basis error, which is the failure mode the differential oracle was built to exclude.

`Standing(day) = $6.00` does not follow from `W_DAY_ADSPEND`'s declared semantics at all, because a rolling 24-hour window has no end to integrate to. Registered as **STD-01**.

### 2.5 What the fixture cannot exercise

`I7`'s oracle is *"brute-force enumeration of grant combinations"*. Enumerating the interacting combinations in `51 §3`:

| Interaction `46 R8` names | Present in `51`? |
|---|---|
| Two grants of the same class on one window | No |
| Two grants of different classes on one window with a binding window cap | No (no window carries a cap) |
| Two live standing authorisations on one window | No (one rate grant) |
| A window monetary cap binding below `per_action × count` | No |
| A calendar-month boundary that is not 30 days | No |

Six of nine windows have exactly one referencing grant. The oracle is sound and the fixture is degenerate with respect to every construction that produced v1.0's three MAL defects. Registered as **LIM-07**.

---

## 3. The Effect Canonicaliser as an economic oracle

### 3.1 `I18` cannot hold as stated

The single most consequential money-path finding. `I18` asserts `dispatch_payload.monetary_effect == authorisation.exposure == reservation.amount`, and `26 §2.1` defines exposure to **include** `cost_components[]` — retained processing fee, freight, COGS, compensator cost. For a $25.00 refund with a $1.03 retained fee:

| Reading | Consequence |
|---|---|
| `monetary_effect = $26.03` | Not the dispatched amount; the vendor request says $25.00. The equality compares a kernel figure to a copy of itself — vacuous |
| `monetary_effect = $25.00` | `≠ exposure`. **`I18` is violated by every correctly constructed refund** |

For `fulfilment.reship` the vendor request contains no money field at all, so the first term has no referent. Registered as **CAN-01**, with the field split as remediation. This must be resolved before the S1 fixture table is written, because the fixture table is `51 §5`'s oracle for `I18` and it cannot be written against an unsatisfiable equality.

### 3.2 Constructed: `reserved < settled loss` with every pre-dispatch invariant passing

The brief asks for this specifically. Three constructions, in descending confidence:

| # | Construction | Pre-dispatch | At settlement | Preventable pre-dispatch? |
|---|---|---|---|---|
| 1 | **FX spread.** €23 line refund on a USD ledger. Exposure at a RECORD mid rate; the processor converts at settlement with a 1.5% spread | `I18` passes — all three internal figures agree | `settled > reserved` by the spread, on every FX effect, systematically | **No.** Only by grossing up per corridor (CAN-06) |
| 2 | **International reship.** `unit_cost_estimate` $35.00; actual COGS plus expedited freight $95.00 | Passes; `MIE_cost` is `[ESTIMATE]`-graded by design | 170% divergence, reported as a critical incident on an estimate | **No.** Only by reserving a p95 band (LIM-06) |
| 3 | **Retained tax across a closed filing period.** $25.00 line refund returns ~$2.00 of collected tax that `tax.filing.*`'s prohibition prevents reclaiming | Passes if the constructor's "tax treatment" row is a placeholder, which it is | $2.00 unrecoverable, unmodelled | **Yes**, with a stated rule (CAN-11) |

**What this means for autonomy.** Constructions 1 and 2 are not constructor bugs; they are classes of effect whose settled cost is not a function of pre-dispatch state. The honest conclusion is not that the canonicaliser is broken but that **`I18`'s settlement leg cannot be a boolean equality for such classes**, and a class whose settled cost has no computable upper bound is not autonomy-eligible under `26 §2.2`'s own disqualifier. The package's per-class tolerance is the right mechanism and it has no declared value anywhere (CAN-08), which the registry's own rule 5 forbids.

### 3.3 Can the model learn hidden state from the enumeration?

Yes, at `O(log n)` proposals per resource, by binary-searching the selector index against `DENY: SELECTOR_INVALID` (CAN-05). `26 §7` anticipates the channel and bounds it by scoping enumerations to the `context_spec` — a mechanism the package does not define, because **the enumeration's transport to the model is not specified at all** (CAN-02). That is the more serious half: enumerate-then-select requires the model to see the enumeration, and no capability returns it.

### 3.4 Is `I18`'s equality checkable before settlement?

Its construction side is checkable at authorisation, per class and per enumerated option, against a hand-computed fixture. Its **settlement side is not checkable at MVP** — the registry's §3 item 5 says so, and `51 §5`'s last row says the only unforgeable test is the bank line, weeks later. For a Stage-2 test the consequence is concrete: a constructor that omits a cost component passes every S1 gate, passes the S3 synthetic settlement fixture if the fixture shares the omission, and is discovered in Stage 2 at real cost. The mitigation available now is that the S3 synthetic bank statement must be authored **from the processor's published fee schedule**, not from ACOS's computed exposure — an independent-oracle requirement `36 §0` states for adapter mapping and does not state for the settlement fixture.

---

## 4. Realisable loss traced through the ledger

`MAL_total` is a function of the grant registry. Loss is a function of the reservation ledger. Three paths where they diverge.

### 4.1 Path A — headroom laundering through the `I32` override (LIM-04)

| Step | Mechanism | `I3` terms after the step |
|---|---|---|
| 1 | Adversary induces vendor timeouts on ten refunds. `25 §12` concedes an adversary able to do this includes the vendor | open: $250 · standing: $180 · realised: 0 |
| 2 | `35 §4`: reservations **remain held** on `OUTCOME_UNKNOWN`. Correct | unchanged |
| 3 | `I32` fires `HEADROOM_STARVATION` past `[ESTIMATE: 50%]` | unchanged |
| 4 | Owner exercises the override — *"itself an authorised, journaled effect"* (`25 §12`) — because refunds are denying while the FTC clock runs | open: **0** · standing: $180 · realised: **0, because unresolved spend is not realised** |
| 5 | Ten further refunds authorise | open: $250 |
| 6 | Repeat per override | `10 × $25 × k` |

**No invariant fires.** `I7` recomputes from an unchanged grant registry. `I3` is satisfied at every instant. `I2`, `I31`, `I42` hold. `MAL_monetary` does not increase, so `26 §10`'s re-signature never triggers and the displayed $300/$600 never moves.

The override is legitimate in intent and mislabelled in effect: `25 §12` frames it as an availability remedy, and the owner is not shown a `MAL_total` delta even though `30 §10` item 3 requires exposure and the MAL delta on every approval bundle. **Remediation: released-but-unresolved exposure must remain a term in `I3` until settlement resolves it, and any headroom beyond that comes from a separate named override window that enters `MAL_total`.**

### 4.2 Path B — standing headroom returned before verified cessation (STD-02)

Traced in `53 §2` STD-02. The five states the brief asks to follow:

| State | Value after a pause dispatch whose outcome is unknown |
|---|---|
| Reservation | Released if status → `PAUSED` on dispatch. **Unspecified** |
| `StandingAuthorization` | `PAUSED`, per `24 §3` K5's enum with no transition rule |
| External provider | **Still serving.** Platform spend reporting lags hours |
| Audit | The pause effect is journaled; cessation is not verified |
| `MAL_total` | Falls by the released forward exposure |
| Owner visibility | V2 shows the authorisation as `PAUSED` — i.e. shows it as contained |

Headroom is available for a second `campaign.budget.set`, whose `reconciler_match_rule` then absorbs the first authorisation's continuing charges, so `I22` does not fire either. **This is the v1.0 defect R2 was created to close, reached through the pause path.** The brief asks when headroom may return; the answer must be *on verified external cessation*, and the design does not say it.

### 4.3 Path C — order-driven irrecoverable cost (LIM-03)

Not a laundering path — a disclosure gap with a magnitude. Using only the fixture's own numbers: `W_MONTH_UNGATED` permits 200 ungated actions and the fixture's reship unit cost is $35.00, so the order-driven channel's order of magnitude is `200 × $35 = $7,000` against a displayed `MAL_total(month)` of $600.00, in a class `33 §9` says dominates POD by volume, whose three controls have no declared values and which appears in neither six-item exclusion list.

The honest bound is that the loss requires either duplicate fulfilment (stopped by a per-order rate limit that has no value) or fabricated orders (stopped by `I27`'s settlement corroboration, which is R6). So this is a **disclosure and declaration defect with a loss-channel tail**, not a demonstrated breach — and it is the same defect class R8 was created to close, in the half R8 exempted.

---

## 5. Reservation and approval behaviour on the money path

| Property | Verdict | Finding |
|---|---|---|
| Reservation atomic with authorisation | **Sound.** One transaction, `26 §7` step R, `30 §5.1` item 3 | — |
| Reserve before approval bounds the monetary queue | **Sound in mechanism, wrong in arithmetic.** The bound is the class's count window (10), not `MAL_total / per_action` (24) | LIM-09 |
| Verify mode never re-reserves or tops up | **Sound.** R′ asserts; `I31`'s unique constraint blocks a second row | F-07 |
| Deny on recomputed exposure exceeding the reservation | **Correct choice, no invariant.** `I31` is cited for it and states something else | RES-04 |
| Behaviour when the reservation is absent rather than insufficient | **Undefined**, and guaranteed to occur for OWNER tier | RES-01 |
| `Σ reserved ≤ ceiling` under concurrency | **Achievable**, but the registry names an enforcement primitive that cannot express a sum bound | LIM-05 |
| `I3`'s `window ceiling` operand | **Does not exist** in any artifact | LIM-02 |

**On the brief's question — is deny the right behaviour?** Yes. Top-up defeats the ceiling by definition; release-and-retake loses the slot to a concurrent proposal, which is the race SR5 exists to close and which `25 §12` correctly identifies. Deny is the only choice that preserves both properties. The defect is not the choice; it is that the choice has no invariant and no defined next state (RES-05).

---

## 6. Answers to the brief's money-path questions

| Question | Answer |
|---|---|
| Is any field of a dispatched request still model-originated? | **No.** `I21` is a real property where v1.0's was vacuous. The residual is that `resource_ref` selects the resource and therefore the amount within `per_action_max` (F-01), which should be stated |
| Can the enumeration leak? | **Yes**, at `O(log n)` per resource (CAN-05). And its transport is unspecified (CAN-02) |
| Is `I18` checkable before settlement? | Construction side yes; settlement side no, and for FX and ESTIMATE classes it cannot be a boolean at all |
| Does the construction test's fixture actually differ from the production constructor? | **The oracle is independent; the fixture is degenerate** (LIM-07). And the S3 synthetic settlement fixture must be authored from the processor's fee schedule, which `36 §0` does not currently require |
| Is `pause` reliable enough to be the containment mechanism? | **No, as specified.** It is a governed effect that can deny on an expired grant (STD-03), can fail without a defined status transition (STD-02), and its trigger fires spuriously under documented platform overdelivery (STD-04) |
| Correct behaviour when a boundary re-reservation fails *and* the pause is halted? | The authorisation must enter `PAUSE_PENDING` **retaining its forward exposure**, and the halt must not release it. `campaign.pause` is REVERSIBLE and zero-exposure, so `30 §5.1` dispatches it during mirror degradation — the one place the split halt helps unambiguously (STD-08) |
| Does mandatory expiry create more risk than it removes? | **No.** Re-consent at 30-day intervals is a visible bounded cost. STD-04's spurious pauses are the real risk and they are a calibration defect, not an expiry defect |
| Is `MAL_total` the right thing to display given one term is an estimate? | **Yes, with a band.** Display `MIE_cost` at p50 and p95 and `MAL_total` against p95 (LIM-06), plus `MAL_total + cost ceilings` as the realisable-cash line (LIM-10) |
| Should cost gate irrecoverable actions, not only count? | **Yes, partially.** Recommendation: an irrecoverable action's `MIE_cost` contribution should also debit the class's monetary window, so a $35 reship consumes $35 of money headroom as well as one count. Count remains as an additional cap for the non-monetary harms (domain reputation, disclosure) that money cannot express. This keeps EM3's two currencies and removes the channel where $70/month of loss touches no monetary ceiling |
| Does `51`'s arithmetic hold? | **Yes.** And four of its semantics do not: `min()` (LIM-01), window ceilings (LIM-02), the 30-day standing basis (STD-06), and rolling-window forward exposure (STD-01) |
