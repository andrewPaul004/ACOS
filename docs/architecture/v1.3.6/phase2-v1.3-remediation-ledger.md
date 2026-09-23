# ACOS Operating Spine v1.3 — Remediation Ledger

**Phase 2.5. Issued 2026-09-03. Sole authoritative record of the disposition of every BLOCKING defect raised by the third independent architecture red team.**

Source: `redteam3/60-third-redteam-attack-register.md`. Verdict source: `redteam3/59-third-redteam-verdict.md` (CONDITIONAL PASS — REMEDIATION REQUIRED, 0 FATAL · 14 BLOCKING · 10 MATERIAL · 5 MINOR · 1 WORDING · 10 attacks defeated). Gate source: `redteam3/62-implementation-gate-v2.md`, which is the operative gate and supersedes `58`.

**Fourteen entries. No merges. No silent consolidation.** Every entry terminates in exactly one of `APPLIED`, `APPLIED WITH EXPLICIT RESIDUAL`, `NOT APPLIED — BLOCKING`. TB-09 and TOS-04 are recorded separately in `§5` as required accompanying corrections per `62 §12` item 2 — they are **applied**, not scheduled.

---

## 1. Disposition summary

| Disposition | Count |
|---|---|
| APPLIED | 7 |
| APPLIED WITH EXPLICIT RESIDUAL | 7 |
| **NOT APPLIED — BLOCKING** | **0** |

| Group | Items | Applied | With residual |
|---|---|---|---|
| Mechanism A — audit independent input and degraded-mode corroboration | TA-01 … TA-07 | 2 | 5 |
| Mechanism B — standing exposure cessation and release | TB-01 … TB-06 | 5 | 1 |
| Joint — the determining path | TJ-01 | 0 | 1 |
| **Total** | **14** | **7** | **7** |

**A residual is not a partial application.** Every entry marked `APPLIED WITH EXPLICIT RESIDUAL` applies the specified change in full and additionally records a named property or quantity that architecture reasoning cannot settle, each carrying either an `IMPLEMENTATION_VALIDATION_REQUIRED` marker with a conservative default, or — in three cases in this pass — an honest statement that **no mechanism in this architecture detects the case**, which is a different and more important kind of residual. `62 §11` condition 1's prohibition — *do not answer a BLOCKING finding by weakening the invariant* — is checked entry by entry in `§4` and mechanically in `phase2-v1.3-verification.md` V2.

---

## 2. Mechanism A

### TA-01 — `30 §5.5` case 2's detection bound does not hold against the attester

| Field | Value |
|---|---|
| **Source** | `60 §1` TA-01; construction in `59 §1`; analysis in `61 §A1`, `§A8` |
| **Defect** | `30 §5.5` case 2 claimed *"row written locally, push permanently suppressed → caught by `I17e` → ≤ 15 min."* The suppressing party is the attesting party. A control plane that withholds rows 901–1,000 and attests `max_journal_seq = 900` with the genuine head hash at 900 satisfies both of `I17e`'s legs indefinitely. Case 2 bounds **transport loss**; it does not bound **suppression** at all. `36 §13.1` VC-A1a truncates *out of band*, so the attestation still reports 1,000 and the test passes for a reason it does not exercise. |
| **Affected artifacts** | `30 §5.4`, `30 §5.5`, `30 §5.9`, `30 §7`, `22 §3.1`, `34` ADR-013, `36 §2` VC-A1, `37` S1, registry `I17`, `I17e`, `§3` |
| **Required change** | Split case 2 into 2a and 2b; restate `I17e` as continuity plus attested-prefix consistency; add registry `§3` item 9; add a mandatory adversarial-attester negative control to VC-A1. |
| **Applied change** | `30 §5.4` now states the **three facts** the audit plane actually obtains and states explicitly that the third is *nothing whatsoever about the control journal's true maximum sequence*. `30 §5.5` is **seven cases**: 2a (transport loss / third-party truncation, honest attester, `I17e`, ≤ 15 min) and 2b (suppression by the attester, `I8` only for the vendor-touching subset, **no detector** for the rest). `30 §5.9` and `30 §7` restated. `22 §3.1`'s compensating-controls sentence qualified. |
| **Invariant** | `I17e` restated: *continuity of the attestation channel, and internal consistency and completeness of the latest attested prefix*, with an explicit clause that it **does not** assert the attested maximum equals the true maximum. `I17`'s rule-7 honesty clause extended with the same statement. **Registry `§3` item 9 added** — see the residual. |
| **Test** | **VC-A1d, mandatory negative control**: truncate the push at 900 of 1,000 **and adjust the attestation to the frozen prefix**; assert `I17e`, `I17` and `ATTESTATION_STALL` all **do not fire**. A run in which any fires is a **test failure**. VC-A1a is retained and now discriminates rather than conflates. `62 §10` obligation 13. |
| **Disposition** | **APPLIED WITH EXPLICIT RESIDUAL** |
| **Residual** | *(Registry `§3` item 9, verbatim in force.)* **A compromised control plane can freeze its own attested prefix and remain undetected by `I17` and `I17e` indefinitely.** Vendor-touching effects in the suppressed range may later be detected by `I8` within `sweep_cadence + vendor_reporting_lag`. **Suppressed authority and state rows with no independent vendor counterpart — authorisation decisions, denials, reservations, releases, `PRESUMED_SETTLED` transitions, approvals, resumes, `RemedyObligation`s, state facts, supersessions, escalations, incidents, clock creations, override exercises, `StandingAuthorization` transitions, enumeration reads, `OutOfBandAction` records and the `DISPATCHED_UNMIRRORED` tags themselves — are not detectable by this mechanism or by any other in this architecture.** This is not a measurement pending; it is a stated limit of what a push-mirror plus attestation can establish. |
| **Sections changed** | `30 §5.4`, `§5.5`, `§5.9`, `§7`; `22 §3.1`; `34` ADR-013; `36 §2`; `37` S1; registry `I17`, `I17e`, `§3` |

---

### TA-02 — `I8` has no declared sweep cadence

| Field | Value |
|---|---|
| **Source** | `60 §1` TA-02; `61 §A8` |
| **Defect** | v1.2 relocated the unqualified completeness claim onto `I8` and gave it no bound. `30 §5.5` case 4's bound column read *"Inverse-sweep cadence"* — the name of an undeclared quantity — and `I8`'s enforcement read `SCHED (inverse sweep)` with no interval. Registry rules 5 and 6, violated in the invariant carrying the package's strongest audit claim. |
| **Affected artifacts** | registry `I8`, `30 §5.5`, `30 §5.10` (new), `30 §7`, `51 §3.2`, `50 §2`, `37` S1, `22 §3.1` |
| **Required change** | Declare the cadence as an operand with provenance, per adapter; declare the scheduling owner; state the bound as `sweep_cadence + vendor_reporting_lag` with both operands' provenance; separate the configured quantity from the vendor quantity. |
| **Applied change** | New **`30 §5.10`**. **Configured MVP sweep cadence, per adapter, chosen on the risk/operating-cost trade rather than deferred:** processor, commerce and ESP at **1 hour** — their read surfaces are queryable within seconds, so cadence is the whole bound, and one hour aligns with `I17b`'s anchor interval, since an omission detector slower than the rewrite detector makes the slower bound govern everything; `google_ads` at **6 hours** — reporting is not final on retrieval, so a cadence shorter than the reporting lag consumes quota to buy latency it cannot deliver; **1 hour default** for any newly registered adapter. **Scheduling owner: the audit plane**, on its own host, under its own credentials; the control plane cannot defer, skip or reschedule a sweep and a missed sweep is an audit-plane incident. `51 §3.2` instantiates every value with provenance. `I17f`'s own evaluation interval is declared at **15 minutes** in the same section, closing the smaller instance of this defect that TA-12 recorded. |
| **Invariant** | `I8` gains an operand block under rules 5, 6 and 8. **Detection bound = `I8_sweep_cadence(adapter) + vendor_reporting_lag(adapter)`, and no artifact may print it as a single number.** Every site that read *"inverse-sweep cadence"* now reads the sum. |
| **Test** | `62 §10` obligation 8, amended: measure the real end-to-end detection latency at S3 against a sandbox. `51 §5` carries the row. |
| **Disposition** | **APPLIED WITH EXPLICIT RESIDUAL** |
| **Residual** | `vendor_reporting_lag` is **`UNMEASURED`** for every adapter, `IMPLEMENTATION_VALIDATION_REQUIRED`, measured at S3 alongside — but distinct from — the cessation specification. **So `I8`'s bound has a declared form and an unmeasured magnitude.** And a second, sharper residual: **at S1 all four MVP action classes run against mock adapters, so `I8` proves nothing at S1 by construction**, and cases 2b and 4 have no operative detector at that slice. `37` S1 now says so; v1.2 did not. |
| **Sections changed** | `30 §5.5`, new `§5.10`, `§5`, `§7`; `51 §3.2`; `50 §2` class 26; `37` S1; `22 §3.1`; registry `I8` |

---

### TA-03 — `I8`'s tag-set sentence admits a coverage-narrowing reading

| Field | Value |
|---|---|
| **Source** | `60 §1` TA-03 |
| **Defect** | *"The `DISPATCHED_UNMIRRORED` tag set is a mandatory input to each sweep, so the reconciliation target is a specific set rather than a time period"* admits (i) additive and (ii) scoping. Reading (ii) narrows coverage to a set the audited party populates and is the reading an implementer optimising vendor API calls chooses, because it is cheaper. Composed with TA-04, an untagged effect is outside `I17` and outside `I8` simultaneously. AUDA-01's signature, third occurrence. |
| **Affected artifacts** | registry `I8`, `30 §5.6`, `30 §5.10` (new), `24 §3` K11, `48`, `50 §2` |
| **Required change** | Restate so the tag set is an additional mandatory verification list and never a scope restriction; add a CI or review assertion that the sweep's vendor query is period-bounded. |
| **Applied change** | `30 §5.10` states it as a displayed rule: *"The sweep enumerates the audit plane's own vendor reads exhaustively over the period since the previous sweep… The tag set is an additional mandatory verification list… It is never a restriction of the sweep's scope. The sweep's external query is never restricted to ACOS-provided effect identifiers or tags."* The comparison runs both directions: vendor activity with no journal row is the `I8` violation; a tag-set member with no vendor counterpart is a separate finding on the same path. **CI/review assertion added**: the sweep implementation's vendor query must be period-bounded, and a query parameterised by an ACOS-side identifier set fails review. Bound into `48`'s perimeter and made **control artifact class 26** so the sweep's own coverage cannot be narrowed out of band. |
| **Invariant** | `I8`'s statement carries the additive rule in the invariant text itself, not in a note, and its enforcement column gains `CI (the query is period-bounded, not tag-bounded)`. |
| **Test** | Registry `I8`: construct a case in which the tag set is **empty** and a vendor mutation is still detected. That single case discriminates reading (i) from reading (ii) and no v1.2 case did. |
| **Disposition** | **APPLIED** |
| **Sections changed** | `30 §5.6`, new `§5.10`; `48`; `50 §2` class 26; registry `I8` |

---

### TA-04 — no detector for a dispatch under degradation that carries no tag

| Field | Value |
|---|---|
| **Source** | `60 §1` TA-04; `61 §A9` |
| **Defect** | `I17f(a)` quantifies over **tagged** effects and asserts corroboration. The needed property is the converse — over effects dispatched while degraded, assert the tag. The party required to mark its own unmirrored dispatches is the party that benefits from not marking them, and every candidate detector was walked and saw nothing: `I17` and `I17e` are transport properties and say nothing about a column's value; `I17f(a)` is vacuous over untagged effects; `I17f(b)` concerns the existence of the stall; `I8` catches it only under the additive reading and only for vendor-touching effects. |
| **Affected artifacts** | registry `I17f`, `30 §5.5`, `30 §5.6`, `36 §2` VC-A2, `30 §7` |
| **Required change** | Add the converse property, owned by the audit plane. |
| **Applied change** | **`I17f(c)`**, a third clause on the existing identifier rather than a new one, because `I17f` is already the two-sided corroboration invariant and rule 3 forbids renumbering: *"Every effect whose dispatch timestamp falls inside an audit-plane-published `MIRROR_INPUT_STALL` interval carries `DISPATCHED_UNMIRRORED` on its mirrored row."* Owned by the **audit plane**, which holds both operands — the intervals it published itself and the mirrored effect rows — so rule 7 is satisfied. An untagged dispatch inside a published interval is a **critical incident**. Added as `30 §5.5` **case 7**. `I17f`'s evaluation interval is declared at **15 minutes** (`30 §5.10`), because a detector on `SCHED` with no value bounds nothing. |
| **Invariant** | `I17f` is now three clauses: (a) invariant, (b) **detector** (reclassified — TA-09, applied as a side effect since the row was being restated anyway), (c) invariant. |
| **Test** | **VC-A2c**: dispatch inside a published stall interval with the tag omitted; assert CRITICAL. **Decoy variant**: tagging a *different* effect satisfies (a) for the decoy and still fails (c) for the untagged one. **Negative-scope assertion**: the same untagged dispatch with the row **withheld** must **not** fire (c), and the test records why. `62 §10` obligation 14. |
| **Disposition** | **APPLIED WITH EXPLICIT RESIDUAL** |
| **Residual** | **(c) closes only the case where the audit plane published a stall.** It does not close the `NORMAL`-declared frozen-prefix case, in which the effect row itself is withheld and the audit plane has nothing to evaluate. That is `30 §5.5` case 2b, registry `§3` items 9 and 10, and TJ-01. Stated on the invariant row, in `30 §5.6`, and in the test itself, so the boundary of what (c) closes is asserted rather than assumed. |
| **Sections changed** | `30 §5.5`, `§5.6`, `§5.10`, `§7`; `36 §2`; registry `I17f`, `§3` item 10 |

---

### TA-05 — the owner override escaping `UNCORROBORATED_STALL` is specified nowhere

| Field | Value |
|---|---|
| **Source** | `60 §1` TA-05; `61 §A3`, `§A5`; and TA-15's residual, which is entirely concentrated here |
| **Defect** | SR-A2 made the owner override the **sole** escape from a state the design deliberately made stricter, and the ledger recorded AUD-07 as **closed** by it. Four sites said only that the override is journaled, displays the affected classes and the elapsed clock time, and changes no ceiling. No duration, no count, no monetary cap, no expiry, no second-approver rule, no entity in `24 §3`, no identifier in the registry, no row in `51`, no class in `50`. AUD-07's own words — *"a single act with no declared scope, no expiry and no cap"* — were still true. A5's composition question was therefore not merely unanswered but **unanswerable**, and `59`'s rule makes an unanswerable no better than a yes. |
| **Affected artifacts** | `30 §5.1` item 5, `30 §5.6`, new `30 §5.7.2`, `30 §3` V2, `22 §3.1`, `24 §3` K9, `35 §12.1`, `36 §2`, `36 §6`, `50 §2`, `51 §3.6` (new), registry |
| **Required change** | Specify the override as kernel state with a declared shape; auto-expiry to halt rather than to `NORMAL`; every dispatch tagged and entering `I8`'s list; an invariant bounding composition; values in `51` with provenance; a control-artifact class. |
| **Applied change** | **`30 §5.7.2`** specifies `DegradedModeOverride` as kernel state held in `24 §3` K9: id, company, request/grant/second-approval identities and timestamps, `effect_classes[]`, `recoverability_classes[]`, `precedence_rows[]`, `starts_at`/`expires_at`, `effect_count_cap`/`effects_dispatched`, `monetary_exposure_cap`/`monetary_dispatched`, `reason`, a not-null `incident_ref`, and a five-value status. **Ten semantics declared**, of which four are the load-bearing ones: it restores **precedence rows 3 and 4 only** — rows 1 and 2 are unreachable and `IRRECOVERABLE` has no grant path, so the halt boundary stays where `30 §5.1`'s rationale puts it; **auto-expiry is to the restrictive state, never to `NORMAL`**; **every dispatch carries `DISPATCHED_UNMIRRORED` *and* `override_id` and enters the next `I8` verification list**; and **it changes no ceiling** — it releases a dispatch gate, never an exposure gate, so every effect still reserves and is still bound by `I3`. **`51 §3.6`** declares eight quantities as `DESIGN LIMIT — OWNER SIGNED` non-production MVP values: 24 h / 5 effects / $50.00 per override; 3 overrides / 72 h / 8 effects / $100.00 per rolling 30 days; second approver required from the 2nd override in 30 days. `30 §3` V2 displays active overrides with elapsed statutory-clock time, time remaining, cap consumption and rolling aggregate consumption. **Control artifact class 25.** No model-reachable path requests, grants, approves, extends or reads the caps (`24 §3` K9). |
| **Invariant** | **`I63`**, two legs. **(a) Per override:** no dispatch outside the declared classes, rows, time box or caps. **(b) Aggregate:** over any rolling 30-day window, count, cumulative hours, cumulative effects and cumulative monetary exposure are each within `51 §3.6`. DB-enforced: `CHECK` on the per-override counters plus a trigger on the rolling aggregate, evaluated in both the granting and the dispatching transaction. |
| **Test** | **VC-A2e** — per-override legs each terminating dispatch independently; `IRRECOVERABLE` and rows 1–2 unreachable; expiry to the restrictive state; tag and `override_id`; second approver refused-without; **`MAL_total` unchanged**. **VC-A2f** — composition: repeated maximum-valid overrides across consecutive outages, **rotating action classes and recreating after expiry**, against an aggregate computed by a **second implementation**. `62 §10` obligation 15. |
| **Disposition** | **APPLIED WITH EXPLICIT RESIDUAL** |
| **Residual, and `62 §11` condition 10 is settled here rather than during S1** | The bound is **safe**: every aggregate is strictly below the already-signed ceiling it draws against — $100.00 against `W_MONTH_REFUND`'s $250.00, 8 effects against its count of 10 — and an override changes no ceiling, so no override or sequence can raise realisable loss above the signed `MAL_total`. **The residual is usability, and it is an owner decision rather than an engineering deadlock.** At MVP exactly one OWNER-tier principal is registered, so overrides 2 and 3 are structurally unavailable and **the practically reachable escape is 24 hours, 5 effects and $50.00**. That covers a one-day audit-provider outage. It does not cover the eight-day outage `61 §A3` walks, which therefore ends in a statutory breach **unless the owner registers a second approver principal first**. Registering one is a signed act against control artifact class 25. Recorded rather than resolved by widening the bound, because widening it is the tempting repair `62 §11` condition 1 prohibits. |
| **Sections changed** | `30 §5.1`, `§5.6`, new `§5.7.2`, `§3` V2; `22 §3.1`; `24 §3` K9; `35 §12.1`; `36 §2`, `§6`; `37` S1; `50 §2` class 25; `51 §3.6`; registry `I63` |

---

### TA-06 — the corroboration signal's transport, authentication and freshness are undeclared

| Field | Value |
|---|---|
| **Source** | `60 §1` TA-06; `61 §A3`, `§A5`; replay variant TA-12 |
| **Defect** | The control plane must **read** the audit plane's signal to enter `CORROBORATED_DEGRADED`, and nothing declared which endpoint, over which path, under which credential, whether it is signed, or — the load-bearing one — how fresh it must be. Registry rule 6 applied to a state transition. Three consequences: the corroborated state is close to unreachable in the outage classes that actually occur and nothing said so; a cached signal from a resolved outage could unlock the relaxation; and the only dispatch relaxation in the architecture had an undeclared operand. |
| **Affected artifacts** | new `30 §5.7.1`, `30 §5.6`, `30 §5.7`, `30 §3` V7, `50 §2`, `36 §2`, registry `I17f` |
| **Required change** | Declare the signal as a signed, timestamped artifact served from the audit plane's own read endpoint under its own key, with a `max_age` shorter than `attestation_cadence × k`, fetched over a declared path; make `max_age` an operand of the transition; and **characterise the reachable outage class** rather than leaving the reader to derive that the state is nearly unreachable. |
| **Applied change** | **`30 §5.7.1`** declares `MirrorInputStallSignal` — schema, and then eleven declared properties. **Signer:** the audit plane, Ed25519, key generated on and never leaving the audit-plane host; the control plane holds only the public key, distributed as **control artifact class 24** and hashed into the owner-signed manifest, so a substituted key is an `I19` mismatch rather than a forgeable corroboration. **Endpoint:** `GET /audit/v1/mirror-input-stall`, the audit plane's own read host, the same one that serves V7. **Transport:** HTTPS, pull only, control→audit, read-only bearer credential; **the audit plane accepts no writes on this path**, so the fetch opens no new suppression channel and `62 §11` condition 2 is not engaged. **Issuance:** on the stall condition, **re-issued every 5 minutes while it holds**, fresh `signal_id` each time; none issued when no stall holds. **`max_age` = 5 minutes**, `CONFIGURED`, strictly less than `attestation_cadence × k` = 15 minutes and equal to the re-issuance interval. **Freshness** is evaluated at **every state evaluation**, not only at entry, on the control database clock. **Replay:** consumed `signal_id`s are journaled and cannot re-enter the state machine, and independently `I17f(a)` evaluates every tagged dispatch against the audit plane's own record of published intervals. **Minting and extension** are structurally unavailable — no private key, and rewriting `expires_at` breaks the signature. `30 §5.7` gains the three signals A5 found omitted, including this one, the only signal crossing the trust boundary audit→control. |
| **Invariant** | `I17f` gains `max_age` as a declared operand of the `→ CORROBORATED_DEGRADED` transition under rule 6. |
| **Reachability, characterised rather than implied** | `30 §5.6` tabulates five outage classes and states plainly that **`CORROBORATED_DEGRADED` is NOT reachable when the audit plane is down or when the network path is severed** — the two commonest real outages. It is reachable only where the push path is degraded and the audit read path healthy, or on `I17c` quota saturation, which `30 §5.1` item 5 declares an incident and not a mode change. Rolling issuance buys at most `max_age` of corroborated operation into a partition and **is not a solution to the partition case.** |
| **Test** | **VC-A2d** — broken signature rejected; over-`max_age` rejected at every evaluation; consumed `signal_id` rejected; wrong `company_id` rejected; and **the reachability table asserted directly** by injecting a partition, an audit-plane outage and a push-path-only degradation. |
| **Disposition** | **APPLIED WITH EXPLICIT RESIDUAL** |
| **Residual** | **The availability trade is not disguised and is not closed.** For the common outage the answer is `UNCORROBORATED_STALL`, and the escape is TA-05's override with TA-05's own residual. A signed signal makes corroboration unforgeable; it does not make it available. Stated in `30 §5.6`, `30 §5.7.1` and `22 §3.1`. |
| **Sections changed** | `30 §5.6`, `§5.7`, new `§5.7.1`, `§3` V7; `22 §3.1`; `36 §2`; `50 §2` class 24; registry `I17f` |

---

### TA-07 — `36`'s expected-behaviour and chaos rows state the pre-inversion behaviour

| Field | Value |
|---|---|
| **Source** | `60 §1` TA-07; and `62`'s closing observation that this is AUDA-01's fourth occurrence |
| **Defect** | `36 §6`'s *"Audit mirror unreachable"* row and `36 §14`'s chaos row stated the **pre-inversion** behaviour — clock-bearing COMPENSABLE dispatches while the mirror is unreachable — unqualified, against `30 §5.6`, which suspends it in `UNCORROBORATED_STALL`. `36 §2`'s own VC-A2 stated the inversion correctly, and `36`'s v1.2 change record amended `§2`, `§3.2` and four gates and mentioned neither `§6` nor `§14`. **`36` is the artifact S1's tests are authored from**, so the chaos test as written asserted a dispatch the architecture forbids. |
| **Affected artifacts** | `36 §6`, `36 §14`, `22 §3.1`, `34` ADR-013, `35 §12.1`, `38` |
| **Required change** | Amend both rows to the three-state machine and the state-qualified precedence; add both to the change record; add a mechanical consistency rule that finds superseded unqualified mirror-outage statements. |
| **Applied change** | **`36 §6`**'s row rewritten to state, per state, the behaviour of all five precedence rows, with the corroborated state's reachability constraint and the override as the only escape, and a closing sentence naming what the superseded row said and why a test written from it asserted a prohibited dispatch. **`36 §14`**'s chaos row rewritten: a partition asserts entry to **`UNCORROBORATED_STALL` and not `CORROBORATED_DEGRADED`**, and row 3 **suspends**. **`22 §3.1`**'s split-halt table gains a state column — TA-10, applied as a side effect because the table was being edited and table extraction is exactly how `36 §6` acquired this defect. **`35 §12.1`**'s four-hour walkthrough rewritten to the three states and the specified override. **`34`** ADR-013 gains a v1.3 amendment. **`38`** is marked superseded and excluded from the authoritative set. |
| **Consistency rule** | **`phase2-v1.3-verification.md` V3** is the general mechanical defence — a mechanism stated in more than one normative artifact must be stated identically. **Condition C21** in `analysis/v1.3-consistency-audit.md` is the specific one: every passage describing mirror-outage dispatch behaviour is enumerated and each must carry the state qualifier. C15 asserted the dispatch rule is an ordered first-match list, which it is, and did not assert that every site states the state — which is the defect. |
| **Test** | The corrected `36 §14` chaos row is itself the test. |
| **Disposition** | **APPLIED** |
| **Sections changed** | `36 §6`, `§14`; `22 §3.1`; `34` ADR-013; `35 §12.1`; `38`; `analysis/v1.3-consistency-audit.md` C21 |

---

## 3. Mechanism B

### TB-01 — `24 §3` K5's `window_balance` `CHECK` omits the standing term

| Field | Value |
|---|---|
| **Source** | `60 §3` TB-01; `61 §B4(a)` |
| **Defect** | `24 §3` K5 printed `CHECK (reserved_monetary + presumed_monetary + realised_monetary <= max_monetary)` over a row with **no standing column** and a different primary key, against registry `I3`'s four-term definition. If implemented as printed, term 2 is enforced by nothing and STD-02 reopens with no invariant firing: pause, headroom apparently free, a second authorisation acquires it. Registry rule 2 resolves inconsistent *citation*; it does not repair a schema, and S1 builds the schema from K5. |
| **Affected artifacts** | `24 §3` K5, registry `I3`, `36 §2` VC-L2, `51 §2`, `51 §5` |
| **Required change** | One canonical `window_balance` definition with company scope and every quantity `I3` requires; a consistency condition that every printed `CHECK` expression contains exactly its invariant's operand set. |
| **Applied change** | `24 §3` K5 is declared **the single authoritative schema specification for `window_balance` and for the standing exposure it aggregates, and no other artifact declares either.** The row is keyed `(company_id, window_id, window_instance_key)` and carries **four** terms per ledger — reserved, standing, presumed, realised — plus the three ceilings. The enforcement is the **four-term commitment guard** printed in full; see TB-04 for why it is a guard rather than a bare `CHECK`. `51 §2` cross-refers rather than restating. |
| **Invariant** | `I3` restated with the corrected enforcement column, an instance-scoped statement, and an operand block naming where each of the four terms lives — including that term 1 is `0.00` for rate classes by `26 §2.1.3`, so terms 1 and 2 never describe the same money. |
| **Consistency condition** | **Registry rule 9, new**: *a printed enforcement expression must contain exactly the operand set its invariant statement requires*, compared mechanically. `phase2-v1.3-verification.md` **V4** runs it, and `analysis/v1.3-consistency-audit.md` **C22** is its mechanical form over the whole package. |
| **Test** | VC-L2 extended: the guard rejects the over-commit at the database with the application check disabled, **and the guard's operand set is asserted to be exactly the four terms per ledger**. A guard omitting the standing term must fail. |
| **Disposition** | **APPLIED** |
| **Sections changed** | `24 §3` K5; `51 §2`, `§5`; `36 §2`; registry `I3`, rule 9 |

---

### TB-02 — forward exposure's window-instance scoping is undeclared

| Field | Value |
|---|---|
| **Source** | `60 §3` TB-02; `61 §B1`, `§B2`, `§B5` |
| **Defect** | `I54`'s *"held until the last referenced window closes"* has no referent for a recurring named window with an unbounded series of instances, and `forward_exposure(s, w, t) = max(0, standing_cap − realised_spend)` recomputes the **full** `standing_cap` in every subsequent instance, because realised spend in a fresh instance is zero. With the then-current scalar `cessation_lag` (since retired) unmeasured no `REVOKED` transition exists, so a single paused authorisation exhausts `W_MONTH_ADSPEND` **permanently** and advertising can never restart. Two implementations diverge by *permanent exhaustion versus normal operation*. LIM-02's signature in the mechanism deciding whether the company can advertise at all. |
| **Affected artifacts** | `24 §3.1`, `24 §3` K5, `26 §10.1`, `26 §10.5`, `30 §3` V2, `51 §3.2`, `36 §2`, registry `I3`, `I23`, `I54`, `I55` |
| **Required change** | Declare `forward_exposure = 0` for instances outside the authorisation's economically capable period; declare the re-reservation job's status filter; replace the referentless phrase; add the boundary case to VC-S2. |
| **Applied change** | `24 §3.1` gains a **Window-instance scoping** section. A **window instance** is the concrete calendar period keyed by `window_instance_key`, evaluated in the company timezone on the database clock. The **in-scope interval** is `[s.created_at, s.expires_at + cessation_grace)`. **The rule:** `forward_exposure(s, w, i) = 0` for every instance not intersecting the in-scope interval and for every instance with no `standing_window_exposure` row. **The boundary re-reservation job re-reserves only for `status = LIVE`** — the third red team's recommendation, adopted. `PAUSE_PENDING`, `PAUSED` and `EXPIRED` **retain to the close of every instance they already hold** and acquire no new one. `26 §10.1`'s formula and `Standing(i)` are restated instance-scoped; `26 §10.5` and `51 §3.2` replace *"the last referenced window"* throughout; `30 §3` V2 displays the lapse date per authorisation. |
| **Reconciliation with the non-`LIVE` statuses, as the mission requires** | The property Mechanism B exists for is **preserved exactly**: *within* an instance, pausing returns no headroom and a successor cannot acquire what the predecessor holds — `54 §4.2`'s closure is untouched. What lapses is only the *future* instance a dead authorisation never should have acquired. **The `PAUSE_PENDING` case is the one that costs something and it is stated:** it is the one status with positive reason to believe spend continues, and not re-reserving it means at most one instance of unreserved real spend. Three things bound that — `STANDING_PAUSE_FAILED` is already open at CRITICAL; observed new-instance spend attributes to the **predecessor** by `51 §3.2.2`'s directional rule and raises `STANDING_SPEND_WHILE_PAUSED`; and the spend lands in `realised_monetary` for the new instance, where it consumes headroom through the commitment guard, so a successor cannot both absorb the delivery and obtain full headroom. The alternative — re-reserving `PAUSE_PENDING` indefinitely — reintroduces permanent exhaustion for any pause that never verifies, which is the defect being repaired. |
| **Invariant** | `I3` instance-scoped. `I54`'s conservative default restated with a referent. **`I55` gains an exemption**: an authorisation that is `EXPIRED` and holds zero in-scope instances is exempt from the live-revocation-authority requirement. Without it, `61 §B2` step 7 stands and **a permanent CRITICAL incident is the specified steady state for every standing authorisation ACOS ever creates** — the fix would have survived the repair. |
| **Test** | **VC-S5**, and it is the required test verbatim: pause mid-month; assert January exposure retained and a second January authorisation denied; cross the boundary; **assert February `standing_monetary` is $0.00 and headroom is the full $186.00**; assert a successor **permits**; post a delayed January delivery in February and assert it attributes to the **predecessor** as an exception and is **not** absorbed by the successor; assert the `LIVE`-only rule directly across all five statuses; assert the `I55` exemption in both directions. `62 §10` obligation 5, extended. |
| **Disposition** | **APPLIED** |
| **Sections changed** | `24 §3.1`, `24 §3` K5; `26 §10.1`, `§10.5`; `30 §3` V2; `36 §2`; `51 §3.2`; registry `I3`, `I23`, `I54`, `I55` |

---

### TB-03 — no declared handoff between the rate class's reservation and the standing forward exposure

| Field | Value |
|---|---|
| **Source** | `60 §3` TB-03; `61 §B4(b)` |
| **Defect** | `26 §2.1`'s exposure block carried both `total_exposure` (*"THIS is the reserved quantity"*) and a separate `forward_integral`, with no statement of their relationship. Every literal reading double-counts, and because `W_MONTH_ADSPEND.max_monetary` equals `standing_cap` exactly, **the first `campaign.budget.set` in the company's life denies `WINDOW_EXHAUSTED`**. Two of `I3`'s four terms described the same money. |
| **Affected artifacts** | `26 §2.1`, new `26 §2.1.3`, `26 §8`, `24 §3` K5, `51 §3.2`, `51 §5.1`, `36 §2`, registry `I2`, `I3`, `I18a`–`I18d` |
| **Required change** | Select one coherent model; state `total_exposure` for rate classes unambiguously; satisfy `I2`, `I3`, `I18b`, no double counting, no transient free headroom, and a permitting first authorisation; add a required test. |
| **Applied change** | **Model selected: the rate class is a documented zero-monetary-*reservation* class** — not a zero-exposure exemption, so `I2` is satisfied without a carve-out, on the precedent `26 §7.1` already sets for the `StandingRevocationAuthority`. New **`26 §2.1.3`** declares the field values: `vendor_amount` **NULL** (the dispatched request carries a rate, not a monetary effect, so `I18a`'s null branch applies and `I18c` is vacuous — the same type-correct treatment `fulfilment.reship` already receives); `total_exposure` **`0.00`**, so `I18b` holds exactly; `forward_integral` carries the whole economic quantity into `I3` term 2; and `I18d`'s settlement leg compares against `standing_cap(s, i)`, which `51 §5.1` already declared as `BAND(standing_cap)` and now states the reason for. **The alternative — converting the reservation into standing exposure inside the authorising transaction — was rejected** because it introduces a third reservation-terminal state adjacent to `26 §10.3`'s rule that releasing a reservation must not release exposure, and that adjacency is where the next AUDA-01 comes from. `26 §8`'s worked policy gains the `total_exposure == 0.00` conjunct. |
| **No transient free headroom** | The zero-amount reservation row and the `standing_window_exposure` row are written in **one transaction** under the `window_balance` `FOR UPDATE` lock taken first in the declared order, and the commitment guard evaluates once, after both. There is no interval in which the standing term is absent and the reservation is zero. |
| **`total_exposure` for rate classes, stated unambiguously** | **`0.00`.** The economic exposure is `forward_integral`, carried entirely by `I3` term 2. |
| **Test** | **VC-S7**, required and new: in a clean 31-day January the **first** `campaign.budget.set` at $6.00/day returns **PERMIT** — `$186.00 ≤ $186.00` on the month and `$12.00 ≤ $12.00` on the day — with `reservation.amount == total_exposure == 0.00`, `vendor_amount` NULL, and both rows in one transaction. `26 §2.1.3` carries the specification-level trace. **No existing test serves as a substitute and none asserted this.** `62 §10` obligation 17. |
| **Disposition** | **APPLIED** |
| **Sections changed** | `26 §2.1`, new `§2.1.3`, `§8`; `24 §3` K5; `51 §3.2`, `§5`; `36 §2`; registry `I2`, `I3` |

---

### TB-04 — the realised/standing joint update has no declared atomicity or lock

| Field | Value |
|---|---|
| **Source** | `60 §3` TB-04; `61 §B4(c)`; and TB-08 clauses (b) and (c), applied here as its consequence |
| **Defect** | `forward = cap − realised`, and realised arrives asynchronously, so term 2 is a function of term 4 and the two must move in opposite directions by equal amounts. Nothing declared the atomicity or the lock. **Realised-first** transiently breached the `CHECK`, so **the true spend could not be written** — the financial-truth path blocked by the authority ledger. **Standing-first** transiently created headroom a concurrent authorisation could consume by taking the row in the declared order **without touching the standing authorisation or any lock associated with it**. The interleaving is the ordinary daily case for a live campaign. |
| **Affected artifacts** | `24 §3` K5, `26 §10.1`, `30 §5.2`, `36 §14`, `51 §2`, registry `I3` |
| **Required change** | Make the standing term derived from the authoritative primitives so only one changes, or declare one atomic statement under the same `FOR UPDATE`; and **separate the authority/commitment bound from observed realised financial truth**, so the database never refuses to store real spend. |
| **Applied change, part 1 — atomicity** | **`standing_window_exposure.forward_monetary` is a generated column** over `(standing_cap_monetary, realised_monetary)`, so it is not independently writable by anyone, including the control plane, and **only one primitive changes**. The reconciler's update is **one statement**, and a trigger in the same statement recomputes `window_balance.standing_monetary` as `Σ forward_monetary WHERE instance_in_scope` and increments `window_balance.realised_monetary` by the same delta. **The reconciler takes the same lock order as the authorising transaction** — `window_balance` `FOR UPDATE` ascending `window_id`, then `standing_window_exposure`, then the journal counter — so there is one lock order in the system and both writers of the money row obey it. **Why generated per authorisation and summed rather than generated on the aggregate:** `max(0, ·)` does not distribute over sums, so an aggregate generated column would silently under-reserve whenever one authorisation had overrun. |
| **Applied change, part 2 — financial truth** | The four-term bound is enforced by a **commitment guard** rather than a bare `CHECK`, because a `CHECK` is unconditional and cannot distinguish a commitment from an observation. The guard refuses only an update that **increases** reserved, standing or presumed while the four-term sum would exceed the ceiling. **An update that increases only `realised` is accepted unconditionally**, even above the ceiling, and raises `WINDOW_CEILING_BREACHED` — or **`STANDING_OVERDELIVERY`** where a vendor delivered beyond an authorised rate, **a distinct incident type deliberately not on `I3`'s security path**, because a vendor billing artefact is not evidence that the control model was breached. **No term was dropped from the bound**: a realised increase still shrinks the headroom available to the next commitment, because the guard reads `NEW.realised_monetary`. What changed is which write the bound refuses. |
| **Relationship to TB-08** | TB-08 is MATERIAL and clauses (b) and (c) are **applied here**, because TB-04's remediation mandate requires them and because without (c) an over-ceiling realised figure would raise a security incident for a vendor billing event. **Clause (a) — widening `W_MONTH_ADSPEND.max_monetary` above `standing_cap` by a declared overdelivery band — is scheduled, not applied**, and the reasoning is recorded in `phase2-v1.3-lower-severity-register.md`: with realised out of the refusing path the zero-slack problem is no longer an unrecordability problem, so (a) is genuinely deferrable, **and deferring it is what keeps `MAL_total` unchanged and avoids a re-signature this pass has no other reason to trigger.** |
| **Invariant** | `I3`'s enforcement column, on-violation column and operand block all restated. |
| **Test** | **VC-S8**: assert `forward_monetary` is generated and a direct write fails; assert one statement moves both terms; **targeted interleaving in both orderings with the mandatory `REPEATABLE READ` negative control that must fail**; assert no interleaving exposes headroom acquirable without the `window_balance` lock; and assert the financial-truth path — drive realised above the ceiling, assert the write **succeeds**, the right incident fires, and the next *commitment* is still refused. `62 §10` obligation 16, and `62 §6`'s addition to the spike's kill-point matrix. |
| **Disposition** | **APPLIED** |
| **Sections changed** | `24 §3` K5; `26 §10.1`; `36 §2`, `§14`; `51 §2`; registry `I3` |

---

### TB-05 — `charge.standing_authorization_id`'s provenance is undeclared and not vendor-carried

| Field | Value |
|---|---|
| **Source** | `60 §3` TB-05; `61 §B6` |
| **Defect** | `51 §3.2`'s `reconciler_match_rule` was a six-conjunct predicate, and **no single declared source carries all six** — the identifying conjunct is carried by neither. So the field is ACOS-derived, the derivation was undeclared, and the SR-S2 repair was a self-assertion. Across a window boundary, keying on posting date or on *the authorisation live at posting time* attributes a predecessor's delayed delivery to a successor, with `I22` silent: STD-02's defect reached through the derivation layer. |
| **Affected artifacts** | `51 §3.2`, new `51 §3.2.1`, new `51 §3.2.2`, `24 §3` K5, `24 §3.1`, `36 §2`, registry `I22` |
| **Required change** | Declare the charge record's source and field set per adapter with absent conjuncts marked absent; declare the derivation with a named authoritative timestamp; declare a directional ambiguity rule that never favours a successor; extend the fixture, authored independently of both the rule and the derivation. |
| **Applied change** | **`51 §3.2.1`** declares two charge record kinds with a per-field presence table. `ADS_DELIVERY_LINE` (Google Ads reporting, campaign × day) carries `customer_id`, `campaign.id`, `segments.date`, `metrics.cost_micros` and `campaign_budget.resource_name`, and **lacks** payment instrument, merchant identifier, posting date, per-day invoice identifier and any `standing_authorization_id`. Campaign labels and tracking parameters exist but are **mutable and re-resolve historically**, so relabelling for a successor would retroactively re-attribute the predecessor's spend — **worse than no identifier**, and recorded as unusable. `BILLING_LINE` carries the instrument, merchant identifier, posting date and amount and **lacks `resource_ref` entirely**. **Consequence, stated rather than worked around: `I22` operates on `ADS_DELIVERY_LINE` only**; the card line has no `resource_ref`, can never derive an authorisation id, and is reconciled at the account level by `I4`'s three-way settlement tie. **`51 §3.2.2`** declares `derive_sa_id` as a function, with the **authoritative timestamp named: `segments.date`, the delivery date**, converted from the advertising account timezone to the company timezone on the database clock. **Delivery, not posting, and the reason is directional** — delivery is the event the authorisation authorised; posting is a billing artefact whose timing the vendor controls. The `reconciler_match_rule` is restated with the two absent conjuncts **removed and recorded as removed with the reason**, rather than left as a predicate over fields that do not exist. |
| **Ambiguity policy, exact semantics** | `\|A\| = 1` → that authorisation. `\|A\| = 0` → **UNATTRIBUTED**, an unauthorised charge, `I8`/`I22` incident on the security path. **`\|A\| > 1` → attribute to the EARLIEST by `created_at`; mark the charge `AMBIGUOUS`; RETAIN exposure on EVERY candidate until reconciled; raise `STANDING_ATTRIBUTION_AMBIGUOUS` at CRITICAL.** Both legs are conservative and both are applied together — attributing to the predecessor is the safe direction, and double-holding over-reserves rather than under-reserves. **The directionality rule is absolute: ambiguity is never resolved in favour of the newer or currently-live authorisation.** |
| **Invariant** | `I22` restated with an operand block declaring the derivation, its timestamp, its ambiguity behaviour, and the exclusion of `BILLING_LINE`. |
| **Test** | **VC-S6**: assert delivery-date keying; assert each of the three cardinality branches; and the crafted predecessor/pause/boundary/successor/delayed-spend case **authored independently of both the match rule and the derivation, with both authorships recorded**. v1.2's fixture tested the rule against a wrong derivation and would have passed. Also assert that no implementation predicate reads the three absent fields for `ADS_DELIVERY_LINE`. `62 §10` obligation 10, extended. |
| **Disposition** | **APPLIED WITH EXPLICIT RESIDUAL** |
| **Residual** | **Whether `derive_sa_id` is unambiguous in a real sandbox is not decidable from the specification.** The derivation is declared, the timestamp is named and the tie-break is directional, so the *architecture* defect is closed. Whether Google Ads' reporting surface, in practice, ever yields `\|A\| > 1` at a rate that makes `STANDING_ATTRIBUTION_AMBIGUOUS` operationally unusable is `62 §10` obligation 10 and `62 §11` condition **9** — a named pass-revocation condition, carried forward unchanged. |
| **Sections changed** | `51 §3.2`, new `§3.2.1`, `§3.2.2`; `24 §3` K5, `§3.1`; `36 §2`; registry `I22` |

---

### TB-06 — no invariant asserts the `StandingAuthorization` transition set, and `any → EXPIRED` includes `REVOKED`

| Field | Value |
|---|---|
| **Source** | `60 §3` TB-06; `61 §B1` defects 3 and 4 |
| **Defect** | Two in one place. **(1)** No invariant asserted that transitions lie in the declared set. The `Approval` machine received `I60` for exactly this in the same release, at RES-09's prompting; **the state machine that gates money release received nothing**, so an illegal transition was a prose violation with no detector. **(2)** The fourth transition row read `any → EXPIRED`, and `any` includes `REVOKED` — a revoked authorisation re-enters `EXPIRED` at `expires_at`, **re-acquiring forward exposure it had already released**, while `I55` fires `STANDING_UNREVOCABLE` at CRITICAL because its revocation authority was destroyed. Every pre-expiry revocation produces a guaranteed CRITICAL and an exposure resurrection. |
| **Affected artifacts** | `24 §3.1`, `36 §2` VC-S2, `51 §5`, registry `I23`, `I62` (new), `§2.6`, `§2.7`, `§2.8` |
| **Required change** | Add an invariant asserting the transition set with `REVOKED` having no outbound transition, using the next normalised identifier; DB-enforce transition legality; replace `any → EXPIRED` with a precise source set; test every permitted transition and representative forbidden ones, particularly `REVOKED → EXPIRED`. |
| **Applied change** | `24 §3.1`'s table is rewritten as **T1–T8** with explicit source and target per row, a `REVOKED` row reading *"Terminal. Zero outbound transitions."*, and a separate row for the `LIVE`-only boundary re-reservation. **`any → EXPIRED` is replaced by `{LIVE, PAUSE_PENDING, PAUSED} → EXPIRED` (T4, T5, T6).** |
| **Invariant** | **`I62`** — the next normalised identifier, as the register recommends: *"Every `StandingAuthorization` transition is in the declared transition set of `24 §3.1` (T1–T8), and `REVOKED` has no outbound transition."* DB-enforced by a `BEFORE UPDATE` trigger over `(OLD.status, NEW.status)`, the same shape `I60` has. **`I23`'s enforcement is corrected from `DB (generated status)` to the `I62` trigger plus the expiry sweep** — a generated status cannot be transition-checked, so the two mechanisms were incompatible as printed. Registry `§2.6`, `§2.7` and `§2.8` updated; the DB-enforced enumeration goes from 21 to 23. |
| **Test** | **VC-S2** rewritten: every permitted transition succeeds; representative forbidden transitions are refused **with the application check disabled**; and **`REVOKED → EXPIRED` is called out explicitly and required to fail.** `51 §5`'s standing-lifecycle row carries it. |
| **Disposition** | **APPLIED** |
| **Sections changed** | `24 §3.1`; `36 §2`; `51 §5`; registry `I23`, new `I62`, `§2.6`, `§2.7`, `§2.8` |

---

## 4. Joint

### TJ-01 — external effect escapes the claimed record with no invariant firing

| Field | Value |
|---|---|
| **Source** | `59 §1` (determining finding), `60 §5` TJ-01, `61 §J2` |
| **Defect** | The determining path. A compromised control plane stays in `NORMAL`, freezes its pushed mirror at seq 900 while its journal advances to 1,000, continues emitting honest-looking attestations at the frozen prefix, and dispatches effects that reach vendors. `I17`, `I17e`, `I17f(a)`, `I17f(b)` and `I17b` all pass; `ATTESTATION_STALL` does not fire; no tag exists because the declared state is `NORMAL`. The attacker never declares degradation, so **the entire three-state machine — the mechanism's strongest element — is bypassed rather than attacked.** A composition of TA-01, TA-02, TA-03 and TA-04. |
| **Required change** | Apply TA-01 through TA-04 plus registry `§3` item 9, then walk the path again and state the correct final disposition. |
| **Applied change** | TA-01 through TA-04 are applied above, each independently dispositioned. Registry `§3` item 9 is added. |

**The walk, after remediation. This is not a claim that the path is prevented.**

| Leg | v1.2 | v1.3 |
|---|---|---|
| Control plane stays in `NORMAL` | Possible | **Still possible.** Nothing in this pass gates a control plane's own declaration of health, and nothing can — the audit plane has no independent reading of the control journal, by construction, since R10 removed the replica deliberately |
| Local journal advances, pushed mirror freezes | Undetected | **Still undetected by transport checks** |
| Attestations continue at the frozen prefix | Claimed detectable by case 2 at ≤ 15 min | **Correctly stated as undetectable.** Case 2b; `I17e` restated; registry `§3` item 9 |
| No degraded state, no tags | `I17f(a)` vacuous, no converse check | **`I17f(c)` exists but is also vacuous here** — the audit plane published no stall interval because it is receiving attestations. TA-04's residual says so |
| `I8` as the only detector | Cadence undeclared; scope ambiguous; possibly zero coverage | **Cadence declared per adapter; scope declared additive; bound written as `sweep_cadence + vendor_reporting_lag`** |

**Final disposition, in the four terms `62` asks for.**

- **Authority impact.** **Bounded, and unchanged by the attack.** `I3`'s four-term guard runs in the control database on every commitment throughout, so the exposure ceiling holds: `MAL_total(day)` p95 = $329.50, plus the unbounded tails `26 §10.4` already enumerates. The attacker escapes the *record*, not the *authority*.
- **Transport and audit impact.** **Suppressed internal rows with no vendor counterpart remain undetectable to an independent system, permanently.** That is registry `§3` item 9 and it is the honest statement. It is not a measurement pending at S3; it is a limit of what a push mirror plus an attestation can establish when the audit plane holds no independent read of the control journal.
- **Vendor-touching effect.** **Detected by `I8` within `I8_sweep_cadence(adapter) + vendor_reporting_lag(adapter)`** — after the effect, with the vendor's own record available for recovery. The first operand is now a declared number; the second is measured at S3. **At S1 this leg detects nothing, because every action class runs against a mock adapter.**
- **Recovery.** The control journal holds the rows, locally chained and gap-free, so the two sides can be reconciled once the divergence is known. **But the audit plane cannot establish that a frozen prefix was false until independent evidence appears** — a vendor read, an anchor comparison after resynchronisation, or an owner observation. A journal that later resynchronises produces a mirror that is once again consistent, and consistency after the fact is not evidence that the intervening prefix was true.

| Field | Value |
|---|---|
| **Disposition** | **APPLIED WITH EXPLICIT RESIDUAL** |
| **Residual** | **The path is not prevented and v1.3 does not claim it is.** What changed is that every artifact now describes what actually happens: the bound that does not exist is no longer claimed (TA-01), the detector that does exist has a declared cadence and an unambiguous scope (TA-02, TA-03), the degraded-mode variant of the same defect is closed (TA-04), and the class with no detector at all is written down (registry `§3` item 9). **The implementation gate does not require omniscience; it requires architecture claims to match what can be enforced.** After this pass they do. |
| **Sections changed** | Everything under TA-01 … TA-04, plus registry `§3` items 9, 10 and 11 |

---

## 5. Required accompanying corrections — applied, not scheduled

`62 §12` item 2 requires these to land **with** the fourteen rather than after them.

### TB-09 — superseded standing basis in the `I7` oracle specification and the MVP sequence

**MATERIAL by severity; applied now because `36 §12` is the artifact `I7`'s oracle author reads.** `36 §12` and `37 §5` stated *"`MAL_total(month)` = $600 from a $300 monetary component, $180 standing and $120 irrecoverable cost, with `MAL_total(day)` = $173.50"*, and `37 §5` added `$5,205`. `$180.00` is `30 × $6.00` — the **v1.1 multiplicative basis v1.2 explicitly deviated from**. So the artifact specifying `I7`'s differential oracle named Mechanism B's superseded forward-exposure basis and a `MAL_total` that no longer exists. `54 §2.3` records v1.1's reviewer reproducing a figure *"only by inferring the convention from the printed answer"*, and an oracle specification carrying the superseded figures reproduces that circularity exactly: the S1 oracle author computes $600, disagrees with `51`, and resolves the disagreement by adopting the printed answer.

**Applied.** Both sites corrected to $756.00 / $300.00 / $186.00 / $270.00 / $329.50 / $9,885.00, with the correction and its reason stated inline. The **semantic** search required by the mission — not a search for `$600` but for the superseded *combinations* — was run over the whole package and is recorded as `analysis/v1.3-consistency-audit.md` condition C23; `§6` below lists every hit and its disposition. **`min(UNBOUNDED, $180.00) = $180.00` in `26 §10.1` and `36 §2` VC-L2 is fixture F2's grant sum and is correct; it is not the superseded standing figure and was deliberately not touched.**

### TOS-04 — the v1.2 consistency audit returned two false PASSes

**Recorded rather than overwritten, because `21 §2` item 16's finding is that an unrecorded failure in the audit trail is more decision-relevant than the defect it concealed.** `phase2-v1.3-changelog.md §8` carries the full record. In summary:

| Condition | v1.2 text | Result returned | Truth |
|---|---|---|---|
| **C5** | *"`MAL_total` signature basis stated as $756.00 consistently"* | **PASS** | **False.** `$756.00` appeared in exactly one deliverable; `$600` appeared in two operational passages |
| **C6** | *"`Standing(month)` 31-day stated as $186.00 consistently"* | **PASS** | **False.** Two deliverables stated `$180` as standing |

**What allowed each.** The word *"consistently"*. Both conditions were implemented as *every occurrence of the current figure agrees with every other occurrence of the current figure*, which is satisfied when a figure appears **once** and its predecessor appears twice — the condition never looked for the superseded value at all. The audit's own `§4` item 2 anticipated that the conditions might be the wrong conditions; it did not anticipate that two would be evaluated wrongly against the right question.

**How v1.3 makes the failure class detectable.** C5 and C6 are restated as *"stated identically wherever stated, **and stated nowhere in a superseded form**"*, and the superseded-form leg is implemented as an explicit denylist of prior-version values and semantic combinations rather than as an agreement check over current ones. `analysis/v1.3-consistency-audit.md` C5, C6 and C23 carry it, and `phase2-v1.3-verification.md` **V5** is the gate-level condition. **A denylist is falsifiable in the direction the agreement check was not.**

---

## 6. Findings closed as a side effect of the fourteen

Recorded because a ledger claiming only what it was asked to fix understates the package's state, and because `62 §11` cares about *how* a finding was closed.

| Finding | Severity | Closed by | Note |
|---|---|---|---|
| **TA-09** | MINOR | TA-04's restatement of `I17f` | Leg (b) is reclassified as a **detector**, not an invariant, because its violation raises the incident that is its own second disjunct and it can therefore never appear as a violation. The row says so, so a reader tracking invariant health does not read an always-passing check as evidence |
| **TA-10** | WORDING | TA-07's amendment of `22 §3.1` | The split-halt table gains a state column. Recorded because table extraction without the qualifier is exactly how `36 §6` acquired TA-07 |
| **TB-08 (b), (c)** | MATERIAL (partial) | TB-04's financial-truth mandate | `realised` moved out of the refusing path; `WINDOW_CEILING_BREACHED` and `STANDING_OVERDELIVERY` declared as distinct from `I3`'s security path. **Clause (a), the ceiling overdelivery band, is scheduled** — see the lower-severity register for why |
| **TB-12** | MATERIAL | TB-02 and `I54`'s restatement | The `PAUSE_PENDING → PAUSED` verification read is declared **audit-plane owned**, for consistency with `I54` and because it removes the escalation-suppression lever. Its unavailability strands the authorisation in `PAUSE_PENDING` with exposure retained, which is the correct fail-closed direction and is `61 §J1`'s answer |
| **TOS-01** | MATERIAL | TB-09's semantic search | The pending-approval bound is corrected in `22 §3` and `33 §2.5`, the two sites v1.2 left stating *"$600 / roughly 24 items"* after correcting `26 §12` alone |
| **TB-10** (partial) | MATERIAL | TB-02's declared lapse rule | Two of the three gaps close: the lapse date is now declared and displayed in V2, and the one-way nature of pausing is stated in `26 §10.5`. **The remaining disclosure items are scheduled** |
| **`61 §J1`'s V7 degradation note** | — | TA-06 | An unavailable audit-side value renders as `UNAVAILABLE`, never blank and never as agreement, so a control plane able to induce an audit-plane outage cannot obtain a display in which its own declaration is the only value on screen |

**Everything else is scheduled, not dropped:** `phase2-v1.3-lower-severity-register.md`.

---

## 7. `62 §11` condition 1 compliance — did any remediation weaken an invariant?

Checked entry by entry. The mechanical form is `phase2-v1.3-verification.md` **V2**; this is the argued form for the four repairs `62 §11` condition 1 names specifically as the tempting ones.

| Prohibited repair (`62 §11` condition 1) | v1.3 state | Verdict |
|---|---|---|
| *"Retaining forward exposure in fewer statuses to make TB-02 tractable"* | Retention is unchanged in every status: `PAUSE_PENDING`, `PAUSED` and `EXPIRED` all retain forward exposure **for every window instance they hold**, and a successor still cannot acquire it within the instance. What v1.3 declares is the **scope** of the hold, which v1.2 left with no referent. The property `54 §4.2` closed is untouched; what lapses is a *future* instance a dead authorisation acquired only through a formula with no instance term | **Not weakened — scoped** |
| *"Relaxing `I54` to admit a timed-out verification read"* | `I54` is **strengthened**: the read's owner is now declared as the audit plane for both the `→ PAUSED` and the `→ REVOKED` transitions, and the scalar `cessation_lag` is replaced by a four-field specification that must be **declared before it can be measured**. There is still no timeout-to-permit path anywhere in the mechanism | **Not weakened — strengthened** |
| *"Adding a tolerance to `I18b`"* | `I18b` is untouched and remains an exact equality with no tolerance. TB-03 satisfies it by making both sides `0.00` for rate classes, which is exact | **Not weakened** |
| *"Dropping the standing term from `I3` to make TB-01's `CHECK` simpler"* | The opposite: the standing term is **added** to the printed enforcement, which is the entire content of TB-01's repair, and the guard carries all four terms per ledger with rule 9 comparing them mechanically | **Not weakened — term added** |

**And the one repair that could be misread as a weakening, argued explicitly.** TB-04 moves `realised` out of the *refusing* path. It does **not** remove `realised` from the bound: the commitment guard reads `NEW.realised_monetary`, so a realised increase still consumes the headroom available to the next commitment. What changed is that an **observation** can no longer be refused by an **authority** ledger. The v1.2 behaviour — the database declining to record money the vendor actually took — was not a safety property; it was a defect that made financial truth conditional on compliance, and registry `§3` item 3 already conceded that settled cost may exceed the ceiling without noticing that the enforcement made the excess unrecordable.

**Similarly TB-05's removal of two conjuncts.** They referenced fields the declared source does not contain and were therefore never evaluable. The identifying work moves from an unevaluable equality to a declared derivation with a named timestamp and a directional tie-break, which is checkable and which VC-S6 tests independently of its own author.

---

## 8. Ledger verdict

**Fourteen of fourteen BLOCKING findings are `APPLIED` or `APPLIED WITH EXPLICIT RESIDUAL`. Zero remain `NOT APPLIED — BLOCKING`.** TB-09 and TOS-04 are applied and recorded in `§5`.

**Three of the seven residuals in this pass are of a kind the previous two passes did not produce**: not a quantity awaiting measurement with a conservative default, but a **stated limit on what the mechanism can detect at all** — TA-01's frozen prefix, TA-04's withheld row, and TJ-01's composition of the two. They carry no `IMPLEMENTATION_VALIDATION_REQUIRED` marker because no implementation will resolve them. They are written into registry `§3` as items 9, 10 and 11 so that an artifact's confidence in its own audit machinery is bounded by them at the point of claim.

**This ledger authorises nothing.** The gate decision is `phase2-v1.3-verification.md` and the handoff is `phase2-v1.3-implementation-brief.md`.
