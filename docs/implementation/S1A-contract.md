# S1A Contract — Architecture → Mechanism → Test → Oracle

**Scope: S1A only.** The first S1 increment: the exposure-ledger substrate proof and the durable-execution
spike. Everything downstream of the `window_balance` row — the Effect Canonicaliser, Cedar, the journal
chain, the audit plane — is **out of scope** and is not implemented here.

**Authoritative architecture input:** `docs/architecture/v1.3.1/` (ACOS Operating Spine v1.3, package issue
v1.3.1). Treated as immutable. Every clause below is extracted from it; nothing here is invented from
memory, and where this document paraphrases it names the section it paraphrases.

**Precedence note, recorded per the S1A mandate.** `phase2-v1.3-implementation-brief.md §5` still carries a
stale status sentence describing **TOS-02** and **TOS-03** as outstanding. That sentence is **superseded by
package issue v1.3.1**. The authoritative current status is **TOS-02 — APPLIED in v1.3.1** and **TOS-03 —
APPLIED in v1.3.1**, as recorded in `phase2-v1.3.1-errata.md §3` and `§6`, `phase2-v1.3.1-verification.md §4`
and `§7`, and `phase2-v1.3-lower-severity-register.md`. Neither is an implementation blocker for S1A. The
architecture archive is **not modified** to hide the historical inconsistency.

---

## 0. The oracle discipline this document is written under

`36 §0`, verbatim in force:

> **Independent validation must not call the same production function twice and call agreement proof.**

and

> **Every concurrency test carries a negative control** that must **fail** at a weaker isolation level.
> Without it, a passing concurrency test is indistinguishable from a test that cannot detect the bug
> (VAL-06).

Consequences binding on every row of the table below:

| Rule | S1A implementation |
|---|---|
| No test computes its expected value with the production function | Expected arithmetic is written as literal constants in the test file, derived by hand from `51 §2` / `51 §3.2` / `26 §10.1` and shown in a comment |
| No test mocks PostgreSQL locking | Every test runs against a real PostgreSQL container |
| Two executions of the same code are not independent verification | The `standing_cap` / four-term oracle used in assertions is a **separate hand-authored table**, not a call into `src/kernel/exposure` |
| Concurrency tests need a negative control that actually fails | `tests/negative-controls/` carries a **test-only** unsafe SQL path; the suite asserts the unsafe path reproduces the forbidden interleaving |
| Concurrency is produced by targeted interleaving, not load | Deterministic barriers/latches place transactions at named instruction boundaries. `36 §2`: *"this needs injected delays between `SELECT` and `INSERT`, not throughput."* |

---

## 1. `I3` — the four-term commitment guard

### 1.1 Architecture source

`phase2-v1.3-invariant-registry.md §1.2`, `I3`, statement column, verbatim:

> For every named window **instance** `i`, across each of the three ledgers (monetary, count,
> irrecoverable-units): `Σ open reservations + Σ forward exposure of every StandingAuthorization not in
> status REVOKED and in scope for i + Σ presumed exposure of effects in PRESUMED_SETTLED + realised spend ≤
> w.ceiling` for that ledger. **No commitment is admitted that would breach the bound.** Standing forward
> exposure is defined only against windows whose `boundary_kind` is `DISCRETE`.

Enforcement column, verbatim:

> **DB — `window_balance(company_id, window_id, window_instance_key PK, reserved_*, standing_*, presumed_*,
> realised_*, max_monetary, max_count, max_irrecoverable_units)`, the row taken `SELECT … FOR UPDATE` inside
> the authorising transaction, ascending `window_id`, before the journal counter, with the four-term
> commitment guard printed in `24 §3` K5** + TX at serialisable

On-violation column, verbatim:

> **Security incident** — the control model itself has been breached. All effects reserving against the
> window halt. **A `realised`-only increase driving the sum above the ceiling is NOT this violation:** it is
> recorded unconditionally and raises `WINDOW_CEILING_BREACHED`, or `STANDING_OVERDELIVERY` where a vendor
> delivered beyond an authorised rate (v1.3, TB-04).

Operand declaration, registry `§1.2` continuation row, verbatim in part:

> Term 1 from the reservation ledger; **for rate classes it is `0.00` by `26 §2.1.3`'s zero-monetary-reservation
> model (TB-03), so terms 1 and 2 never describe the same money.** Term 2 from `24 §3` K5's
> `standing_window_exposure` rows, `forward_monetary` a **generated column** over `(standing_cap_monetary,
> realised_monetary)`, summed into `window_balance.standing_monetary` by trigger in the same statement,
> scoped to `in_scope_instances(s)` per `24 §3.1`. Term 3 from `24 §3` K5's `PRESUMED_SETTLED` state. Term 4
> from K6's settled figures. **The printed guard in `24 §3` K5 contains exactly these four operands per
> ledger and nothing else; rule 9 compares them mechanically.**

### 1.2 Implementation mechanism

`24 §3` K5's printed guard, implemented verbatim as a `BEFORE UPDATE` trigger on `window_balance`, per
ledger:

```
IF (NEW.reserved_monetary  > OLD.reserved_monetary
 OR NEW.standing_monetary  > OLD.standing_monetary
 OR NEW.presumed_monetary  > OLD.presumed_monetary)
   AND (NEW.reserved_monetary + NEW.standing_monetary
      + NEW.presumed_monetary + NEW.realised_monetary) > NEW.max_monetary
THEN RAISE 'I3_WINDOW_EXHAUSTED';
```

Three ledgers: monetary, count, irrecoverable-units. The irrecoverable ledger has **no standing term** —
`24 §3` K5's printed `window_balance` schema declares `reserved_irrecoverable, presumed_irrecoverable,
realised_irrecoverable` and **no `standing_irrecoverable` column**. The guard for that ledger is therefore
three-term. **This is not a term being dropped from `I3`**: `I3`'s standing term is defined as the sum of
`standing_window_exposure.forward_monetary`, which is monetary; the count ledger's standing term is
`standing_count`, which the schema does declare. Recorded here because a reader comparing "four terms" to a
three-operand irrecoverable guard would otherwise read it as a `TB-01` regression. See
`S1A-implementation-log.md §3`.

`CHECK (reserved_monetary >= 0 AND standing_monetary >= 0 AND presumed_monetary >= 0 AND realised_monetary
>= 0)`, per ledger, per `24 §3` K5.

File: `src/db/migrations/*__window_balance.sql`, `src/db/sql/i3_commitment_guard.sql`.

### 1.3 Financial truth is always writable

`24 §3` K5, verbatim:

> - An update that **increases only `realised`** passes the guard unconditionally, even where the resulting
>   four-term sum exceeds `max_monetary`.
> - Exceeding raises **`WINDOW_CEILING_BREACHED`**, and where the excess is attributable to a standing
>   authorisation's vendor overdelivery, **`STANDING_OVERDELIVERY`** — a distinct incident type,
>   deliberately **not** `I3`'s security path. A vendor billing artefact is not evidence that the control
>   model was breached.
> - The four terms still bound what ACOS may newly commit: a realised increase shrinks the headroom
>   available to the *next* commitment, because the guard reads `NEW.realised_monetary`. **No term was
>   dropped from the bound; what changed is which write the bound refuses.**

The guard's `IF` predicate is precisely what implements this: a realised-only increase leaves all three
commitment operands unchanged, so the first conjunct is false and the guard does not fire.

### 1.4 Tests, and the independent oracle

| Test | Asserts | Oracle |
|---|---|---|
| `tests/integration/exposure/commitment-guard.test.ts` | The ten S1A-8 combinations (§8 below) | Hand-authored constant table in the test file |
| `tests/integration/exposure/guard-operands.test.ts` (**VC-L2**) | The guard's operand set is **exactly** `I3`'s four terms per ledger | Parses the installed trigger function body out of `pg_proc.prosrc` and asserts operand membership — reads the database, not the TypeScript source |
| `tests/negative-controls/three-term-guard.test.ts` (**VC-L2 negative**) | A guard **omitting the standing term** fails the same fixture | Test-only migration installing a deliberately three-term guard |
| Guard fires at the database, application check disabled | The over-commit is rejected by PostgreSQL | The test writes the `UPDATE` directly with `pg`, bypassing `src/kernel/exposure` entirely |

`36 §2` VC-L2, verbatim in relevant part:

> The commitment guard on `window_balance` rejects the over-commit **at the database**, not in application
> code — assert by attempting the insert with the application check disabled, and **assert the guard's
> operand set is exactly `I3`'s four terms per ledger: reserved + standing + presumed + realised** (v1.3,
> TB-01). A guard omitting the standing term must fail this case.

### 1.5 Status

`IMPLEMENTED — S1A`.

---

## 2. `I18b`, as it affects rate classes

### 2.1 Architecture source

Registry `§1.1`, `I18b`, verbatim:

> For every effect, `reservation.amount == exposure.total_exposure`, exactly, in the single ledger currency.
> **No tolerance.**

`26 §2.1.3`, the rate-class field table, verbatim:

| Field | Value for a rate class | Consequence |
|---|---|---|
| `exposure.vendor_amount` | **NULL** | The dispatched request carries a **rate**, not a monetary effect. `dispatch_payload.monetary_effect IS NULL`, so `I18a`'s null branch applies and `I18c` is vacuous |
| `exposure.total_exposure` | **`0.00`** | This is the reserved quantity. `I18b` holds exactly: `reservation.amount == total_exposure == 0.00` |
| `exposure.forward_integral` | `forward_exposure(s, w_instance, t)` | The whole economic exposure, entering `I3` **term 2** through the `standing_window_exposure` row the authorising transaction creates |
| `I18d` settlement leg | Compares settled spend against **`standing_cap(s, w_instance)`** | `51 §5.1` declares `BAND(standing_cap)` for `campaign.budget.set` |

`26 §2.1.3`'s normative consistency condition (v1.3.1, E1), verbatim:

> For every rate class, **no normative passage may describe `forward_integral` as the ordinary reservation
> amount.** Every normative passage must agree that `reservation.amount == exposure.total_exposure == 0.00`,
> and that the economic exposure is carried by `I3`'s **standing** term through `standing_window_exposure`.

### 2.2 Implementation mechanism

- `exposure_reservations.amount NUMERIC(18,2) NOT NULL` with `CHECK (amount >= 0)`. A rate-class
  authorisation writes a **real row** with `amount = 0.00`. `26 §2.1.3`: *"Not a zero-*exposure* exemption —
  the row exists, so `I2` is satisfied without a carve-out."*
- `exposure_reservations.vendor_amount NUMERIC(18,2) NULL` — NULL for rate classes.
- `exposure_reservations.forward_integral NUMERIC(18,2) NULL` — recorded as a **separate field that is not a
  component of `total_exposure`** (`phase2-v1.3.1-errata.md §1`, exact-correction paragraph). A DB `CHECK`
  enforces that `forward_integral` is never equal to `amount` when `amount = 0` and `forward_integral > 0`
  is present — i.e. the structural statement that the two are different fields carrying different money.
- `authorizeRateClass()` in `src/kernel/exposure/` writes the zero-amount reservation row **and** the
  `standing_window_exposure` rows **in one transaction**, under the `window_balance` lock taken first in the
  declared order (`26 §7` step R, rate branch).

### 2.3 Test and negative oracle

| Test | Asserts |
|---|---|
| `tests/integration/exposure/rate-class-handoff.test.ts` | `reservation.amount = 0`, `total_exposure = 0`, `vendor_amount IS NULL`, `forward_integral = 186.00`; `I18b` equality holds |
| Same file, no-double-count case | `window_balance.reserved_monetary` is `0.00` after the rate authorisation and `standing_monetary` is `186.00` — **not** `186.00` in both |
| `tests/negative-controls/forward-integral-as-reservation.test.ts` | A test-only path writing `forward_integral` into `reservation.amount` reproduces the **TB-03 denial** of the first authorisation, proving the assertion discriminates |

**Oracle:** the arithmetic is `51 §3.2`'s `standing_cap` formula evaluated by hand in the test file, not by
`src/kernel/exposure/standingCap.ts`.

### 2.4 Status

`IMPLEMENTED — S1A`.

---

## 3. `I62`, where needed

### 3.1 Architecture source

Registry `§1.2`, `I62`, verbatim:

> **Every `StandingAuthorization` transition is in the declared transition set of `24 §3.1` (T1–T8), and
> `REVOKED` has no outbound transition.**

Enforcement, verbatim:

> **DB (`BEFORE UPDATE` trigger over `(OLD.status, NEW.status)` against the declared set)** + RUNTIME

`24 §3.1`'s transition table T1–T8 is reproduced in §5.1 below.

### 3.2 Implementation mechanism

`standing_authorization.status` is a **stored** column, not generated (`24 §3.1`: *"`status` is therefore a
**stored** column, not a generated one"*). A `BEFORE UPDATE` trigger checks `(OLD.status, NEW.status)`
against a declared transition table and raises `I62_ILLEGAL_TRANSITION` otherwise. `REVOKED` has zero
outbound rows, so `REVOKED → EXPIRED` fails.

**S1A scope limit.** S1A implements the trigger and the transition set because the window-instance boundary
test (VC-S5) drives the authorisation through `LIVE → PAUSE_PENDING → PAUSED` and needs those transitions to
be legal and the illegal ones to fail. S1A does **not** implement `I54`'s cessation verification, the
`PAUSE_PENDING` retry (TB-11 blocked), the expiry sweep, or the `StandingRevocationAuthority` dispatch path.
`T7`/`T8` are declared in the transition table and are **structurally unreachable** because
`cessation_verified_at` cannot be set — which is the architecture's own conservative default
(`51 §3.2`: *"Cessation specification undeclared → no `REVOKED` transition exists."*).

### 3.3 Test

`tests/integration/exposure/standing-transitions.test.ts`: every T1–T8 attempted; the permitted ones
succeed; `REVOKED → EXPIRED` fails; `REVOKED → anything` fails; the application-level check is **disabled**
for the test so the refusal is demonstrably the trigger.

### 3.4 Status

`PARTIAL — S1A implements the trigger and the transition set. T7/T8 unreachable by design (I54 / TB-07).`

---

## 4. The authoritative K5 schema requirements

### 4.1 Architecture source

`24 §3` K5, verbatim, and declared there as *"the single authoritative schema specification for
`window_balance` and for the standing exposure it aggregates. No other artifact declares either."*

```
-- One row per (company, window, window instance). TB-02: the instance is part of the key.
window_balance(
  company_id, window_id, window_instance_key,                       -- PRIMARY KEY
  reserved_monetary,      standing_monetary,      presumed_monetary,      realised_monetary,
  reserved_count,         standing_count,         presumed_count,         realised_count,
  reserved_irrecoverable,                         presumed_irrecoverable, realised_irrecoverable,
  max_monetary, max_count, max_irrecoverable_units,                 -- from the window registry, 51 §2
  CHECK (reserved_monetary >= 0 AND standing_monetary >= 0
     AND presumed_monetary >= 0 AND realised_monetary >= 0)         -- and likewise per ledger
)

-- One row per (standing authorisation, window, window instance). TB-02, TB-04.
standing_window_exposure(
  standing_authorization_id, window_id, window_instance_key,        -- PRIMARY KEY
  company_id,
  standing_cap_monetary   NUMERIC NOT NULL,                         -- authoritative primitive
  realised_monetary       NUMERIC NOT NULL DEFAULT 0,               -- authoritative primitive
  forward_monetary        GENERATED ALWAYS AS
                            (GREATEST(0, standing_cap_monetary - realised_monetary)) STORED,
  instance_in_scope       BOOLEAN NOT NULL                          -- §3.1's in-scope rule
)
```

### 4.2 Implementation mechanism

Implemented as printed. Field-for-field, with these implementation-level additions that add no semantics:

| Addition | Why | Architecture basis |
|---|---|---|
| `NUMERIC(18,2)` scale on every money column | `30 §5.3` `ACOS-JCS-1`: *"Per-column declared decimal scale"*; a money field's scale is semantic | `30 §5.3` |
| `window_instance_key TEXT NOT NULL` | `24 §3.1`: keyed *"for example `W_MONTH_ADSPEND:2026-01`"* | `24 §3.1` |
| FK `standing_window_exposure → window_balance (company_id, window_id, window_instance_key)` | The trigger maintaining `standing_monetary` needs the balance row to exist | Implied by `24 §3` K5's trigger |
| `max_monetary NUMERIC(18,2) NOT NULL` with an `UNBOUNDED` sentinel | `26 §10.1`: *"`Money | UNBOUNDED`, **not nullable**. `min(UNBOUNDED, x) = x`. … **`null` is a schema violation**"* | `26 §10.1`, `51 §2` |

`UNBOUNDED` is represented as `NULL`-free by a companion boolean per ledger
(`max_monetary_unbounded BOOLEAN NOT NULL DEFAULT false`), because `26 §10.1` forbids `null` and the guard
must evaluate without a three-valued branch. Recorded in `S1A-implementation-log.md §4`.

### 4.3 `forward_monetary` must not be independently writable

`24 §3` K5, verbatim:

> `forward_monetary` is a **generated column** over `(standing_cap_monetary, realised_monetary)`. It is not
> independently writable, by anyone, including the control plane. Only one primitive changes.

And the transformation the architecture **rejects**, verbatim:

> **Why `forward` is generated per authorisation and summed, rather than generated on the aggregate.**
> `max(0, ·)` does not distribute over sums: `max(0, Σcap − Σrealised)` is smaller than
> `Σ max(0, cap_i − realised_i)` whenever one authorisation has overrun, so an aggregate generated column
> would silently under-reserve.

**Test:** `tests/integration/exposure/generated-column.test.ts` asserts a direct `INSERT`/`UPDATE` naming
`forward_monetary` raises `42601`/`428C9` (PostgreSQL: *"cannot insert a non-DEFAULT value into column"*),
and asserts `information_schema.columns.is_generated = 'ALWAYS'`.

**Independent oracle for the non-distribution:** `tests/integration/exposure/max-does-not-distribute.test.ts`
seeds two authorisations, one overrun, and asserts
`Σ max(0, cap_i − realised_i) > max(0, Σcap − Σrealised)` on figures computed by hand in the test.

### 4.4 Status

`IMPLEMENTED — S1A (monetary + count ledgers; irrecoverable ledger as printed, with no standing column).`

---

## 5. Window-instance semantics

### 5.1 Architecture source

`24 §3.1`, *Window-instance scoping of forward exposure (v1.3, TB-02)*, verbatim:

> - A **window instance** is the concrete calendar period of a `DISCRETE` window containing a given instant,
>   keyed by `window_instance_key` — for example `W_MONTH_ADSPEND:2026-01`, evaluated in the company
>   timezone on the database clock.
> - The authorisation's **in-scope interval** is `[s.created_at, s.expires_at + cessation_grace)`.

The rule, verbatim:

> `forward_exposure(s, w, i) = 0` for every instance `i` of `w` whose period does not intersect `s`'s
> in-scope interval, and for every instance for which no `standing_window_exposure` row exists.
>
> A `standing_window_exposure` row exists for `(s, w, i)` if and only if the row was created — at
> authorisation time for the then-current instance, or by the boundary re-reservation job for a later one —
> and `i` intersects the in-scope interval. `instance_in_scope` goes false when the interval ends, and
> `window_balance.standing_monetary` drops the term in the same statement.

The boundary table, verbatim:

| Status at the boundary | Predecessor instance | New instance |
|---|---|---|
| `LIVE` | Closes with the instance | **Row created.** Exposure continues |
| `PAUSE_PENDING` | **Retained to instance close** | **No row.** Headroom returns |
| `PAUSED` | **Retained to instance close** | **No row.** Headroom returns |
| `EXPIRED` | **Retained to instance close** | **No row.** Headroom returns |
| `REVOKED` | Released at T7/T8 | No row |

The state machine T1–T8 (`24 §3.1`):

| # | From | To | Forward exposure (current instance) | New-instance re-reservation |
|---|---|---|---|---|
| T1 | `LIVE` | `PAUSE_PENDING` | Retained | No |
| T2 | `PAUSE_PENDING` | `PAUSED` | Retained | No |
| T3 | `PAUSE_PENDING` | `PAUSE_PENDING` | Retained | No |
| T4 | `LIVE` | `EXPIRED` | Retained | No |
| T5 | `PAUSE_PENDING` | `EXPIRED` | Retained | No |
| T6 | `PAUSED` | `EXPIRED` | Retained | No |
| T7 | `PAUSED` | `REVOKED` | **Released** | No |
| T8 | `EXPIRED` | `REVOKED` | **Released** | No |
| — | `REVOKED` | — | Terminal. Zero outbound | — |
| — | `LIVE` | `LIVE` | — | **Yes** — the only status that acquires a new instance |

`standing_cap`, `51 §3.2` / `26 §10.1`, verbatim:

```
standing_cap(s, w)              = s.rate.amount × periods_basis(w, adapter)
periods_basis(W_DAY,   a)       = a.daily_overdelivery_multiplier
periods_basis(W_MONTH, a)       = max( days_in_window(w), a.monthly_basis_multiplier )
forward_exposure(s, i, t)       = 0                                        if i ∉ in_scope_instances(s)
                                = max( 0, standing_cap(s, w(i)) − realised_spend(s, i, t) )
```

`google_ads.daily_overdelivery_multiplier = 2.0` (`DOCUMENTED`),
`google_ads.monthly_basis_multiplier = 30.4` (`DOCUMENTED`), `cessation_grace = 72 h` (`CONFIGURED`) —
`51 §3.2`.

### 5.2 Implementation mechanism

- `window_instance_key` is computed by `src/kernel/exposure/windowInstance.ts` from
  `(window_id, period, instant, company_timezone)` — `W_MONTH_*:YYYY-MM`, `W_DAY_*:YYYY-MM-DD`.
- `standing_window_exposure.instance_in_scope` is set at row creation from the in-scope interval and
  transitions to false through the same statement that recomputes `window_balance.standing_monetary`.
- The **boundary re-reservation job** (`src/kernel/exposure/boundaryReReservation.ts`) creates rows in the
  new instance for `status = 'LIVE'` **only**. This is the whole of the S1A boundary implementation: no
  pause dispatch, no campaign supersession (TB-13 blocked), no `PAUSE_PENDING` retry (TB-11 blocked).
- **TB-13 compliance:** VC-S5's *"a legitimate successor can acquire February authority"* is exercised with
  a **distinct fixture authorisation**, not with a supersession path. No `SUPERSEDED` status exists and no
  max-over-instance `standing_cap` is implemented.

### 5.3 Test — VC-S5

`36 §2` VC-S5, verbatim:

> `$6.00/day`, 31-day January. Pause on day 3; reach `PAUSED`; `realised = $18.00`, `forward = $168.00`,
> **retained for the January instance** — assert a second January authorisation denies `WINDOW_EXHAUSTED`.
> Cross into February. **Assert the February instance's `standing_monetary` is `$0.00` and its headroom is
> the full `$186.00`**; assert no `standing_window_exposure` row was created for February; assert a
> **successor authorisation permits**. […] Assert the `LIVE`-only re-reservation rule directly: a `LIVE`
> authorisation **does** acquire a February row and a `PAUSE_PENDING`, `PAUSED` or `EXPIRED` one does not.

**Implemented in S1A:** every clause above. **Deferred out of S1A with a named reason:**

| VC-S5 clause | Why deferred |
|---|---|
| Delayed January delivery attributing to the predecessor, `STANDING_SPEND_AFTER_EXPIRY` | Requires `I22` and `51 §3.2.2`'s `derive_sa_id`. That is VC-S6, not the substrate proof. Out of S1A |
| The `I55` exemption assertions | Requires the `StandingRevocationAuthority` and `I55`'s sweep. Out of S1A |

**Oracle:** `$186.00`, `$18.00`, `$168.00`, `$12.00` are literal constants in the test derived by hand:
`6.00 × max(31, 30.4) = 186.00`; `6.00 × 2.0 = 12.00`; `186.00 − 18.00 = 168.00`.

### 5.4 Status

`IMPLEMENTED — S1A, less the two clauses named above.`

---

## 6. Realised / standing atomicity

### 6.1 Architecture source

`24 §3` K5, *Realised and standing move in one statement (v1.3, TB-04)*, verbatim:

> 1. `forward_monetary` is a **generated column** over `(standing_cap_monetary, realised_monetary)`. It is
>    not independently writable, by anyone, including the control plane. Only one primitive changes.
> 2. The spend reconciler's update is **one statement** against `standing_window_exposure`, and a trigger in
>    the same statement recomputes `window_balance.standing_monetary` as `Σ forward_monetary WHERE
>    instance_in_scope` and increments `window_balance.realised_monetary` by the same delta. Both terms move
>    together or neither does.
> 3. **The reconciler takes the same lock order as the authorising transaction** — `window_balance` rows
>    `FOR UPDATE` ascending `window_id`, then `standing_window_exposure`, then the journal counter. There is
>    one lock order in the system and both writers of the money row obey it.
>
> No interleaving exposes headroom, because the aggregate is recomputed under a lock a concurrent
> authorisation must also hold.

And the defect being repaired, verbatim:

> realised-first transiently breached the `CHECK` and blocked the financial-truth path; standing-first
> transiently created headroom a concurrent authorisation could consume without touching any lock associated
> with the standing authorisation.

### 6.2 Implementation mechanism

`src/db/sql/standing_exposure_sync.sql` — an `AFTER UPDATE` trigger on `standing_window_exposure` that, in
the same statement, sets

```
window_balance.standing_monetary = (SELECT COALESCE(SUM(forward_monetary), 0)
                                      FROM standing_window_exposure
                                     WHERE company_id = … AND window_id = …
                                       AND window_instance_key = … AND instance_in_scope)
window_balance.realised_monetary = window_balance.realised_monetary + (NEW.realised_monetary
                                                                     - OLD.realised_monetary)
```

The reconciler entry point `recordRealisedSpend()` acquires the locks through the **single** lock-order
helper (§7) before touching either row.

### 6.3 Test — VC-S8

Covered in §9 below (the concurrency section), because VC-S8 is where the interleavings live.

### 6.4 Status

`IMPLEMENTED — S1A`.

---

## 7. Lock order

### 7.1 Architecture source

`30 §5.2`, verbatim, declared there as *"Lock order, declared once and cited everywhere"*:

> **1. `window_balance` rows, `FOR UPDATE`, ascending `window_id`. 2. `journal_counter(company_id)`, `FOR
> UPDATE`. 3. Everything else.**

with, verbatim:

> The counter is taken **last** because it is the most contended and holding it across the balance checks
> would serialise every company operation behind the slowest one.

`24 §3` K5 extends the same order for the reconciler, verbatim:

> `window_balance` rows `FOR UPDATE` ascending `window_id`, then `standing_window_exposure`, then the
> journal counter. There is one lock order in the system and both writers of the money row obey it.

`26 §7` step R, verbatim: *"taking each `window_balance` row `SELECT … FOR UPDATE` in **ascending
`window_id`** and then the journal counter."*

### 7.2 Reconciled statement of the single order

The two passages are consistent, not in conflict: `30 §5.2`'s *"3. Everything else"* is the slot `24 §3` K5
names `standing_window_exposure` into. The single S1A order is therefore:

1. `window_balance` rows, `FOR UPDATE`, **ascending `window_id`** (then ascending `window_instance_key` for
   determinism where one transaction touches two instances of one window — an implementation tie-break, not
   an architecture claim; recorded in `S1A-implementation-log.md §7`)
2. `standing_window_exposure` rows for those balances, `FOR UPDATE`, ascending
   `(window_id, window_instance_key, standing_authorization_id)`
3. `journal_counter(company_id)`, `FOR UPDATE` — **last**, and **only where the path participates**
4. everything else

### 7.3 Implementation mechanism

**One** reusable helper: `src/kernel/exposure/lockOrder.ts`, exporting `acquireMoneyPathLocks(client, spec)`.
Every money-path code path calls it. No other module issues `SELECT … FOR UPDATE` against `window_balance`,
`standing_window_exposure` or `journal_counter`.

**Enforced, not merely documented:** `tests/integration/exposure/lock-order-sole-path.test.ts` greps `src/`
for `FOR UPDATE` against those three tables and asserts the only occurrence is inside `lockOrder.ts`.

**S1A journal-counter note.** S1A does not build the journal chain. `journal_counter` exists as a table and
is taken last **where the path participates**, so the ordering relationship and the deadlock proof are real;
the chain, `ACOS-JCS-1` and the audit push are S1, not S1A.

### 7.4 Test

| Test | Asserts |
|---|---|
| `lock-order-sole-path.test.ts` | Exactly one lock-acquisition site |
| `lock-order-deadlock.test.ts` (**VC-L2** clause) | N concurrent same-window transactions under the declared order produce **no deadlock** |
| `lock-order-reversed.test.ts` (negative control) | A test-only path acquiring **descending** `window_id` **does** deadlock, proving the deadlock test can observe one |

`36 §2` VC-L2: *"Assert the declared lock order (`window_balance` ascending `window_id`, then
`journal_counter`) produces **no deadlock** under N concurrent same-order refunds."*
Registry `I3` test column: *"deadlock test against the journal counter under reversed acquisition order."*

### 7.5 Status

`IMPLEMENTED — S1A`.

---

## 8. Step R rate-class semantics

### 8.1 Architecture source

`26 §7` step R, as restated by v1.3.1 erratum 1, verbatim:

> **Ordinary, non-rate class.** Reserves `exposure.total_exposure` into the **ordinary reservation term —
> `I3` term 1** — against **every named window instance** the matching grants reference, taking each
> `window_balance` row `SELECT … FOR UPDATE` in **ascending `window_id`** and then the journal counter
> (`30 §5.2`'s declared lock order), and fails if **any** lacks headroom.
>
> **Rate class.** `exposure.total_exposure` is `0.00` (`§2.1.3`), so step R creates a **real zero-amount
> reservation row** — `reservation.amount == exposure.total_exposure == 0.00`, satisfying `I2` without a
> carve-out and `I18b` exactly — and **in the same transaction** creates the `StandingAuthorization`, its
> `StandingRevocationAuthority` (I55) and the `standing_window_exposure` rows whose `forward_monetary`
> enters **`I3` term 2**. **`forward_integral` is never the ordinary reservation amount.** The transaction
> still locks and re-checks **every** referenced window instance in the declared order before committing,
> and denies `WINDOW_EXHAUSTED` if any lacks headroom under the four-term guard.

`26 §2.1.3`, verbatim: *"The zero-amount reservation row and the `standing_window_exposure` row are written
in **one transaction**, under the `window_balance` `FOR UPDATE` lock taken first in the declared order, and
the commitment guard evaluates the four-term sum once, after both. There is no interval in which the
standing term is absent and the reservation is zero."*

### 8.2 Implementation mechanism

`src/kernel/exposure/stepR.ts` with two explicit branches and **no shared verb**, mirroring the corrected
Step R. The rate branch is one transaction: lock → insert zero-amount reservation → insert
`StandingAuthorization` → insert `standing_window_exposure` rows → the sync trigger fires → the commitment
guard evaluates once → commit or `WINDOW_EXHAUSTED`.

**`StandingRevocationAuthority` in S1A.** `I55` requires one to exist atomically with every
`StandingAuthorization`. S1A creates the **row** (it is a two-line insert and omitting it would make the
fixture violate `I55` from the first test), and implements **none** of its dispatch path, `I55`'s sweep, or
`26 §7.1`'s `KERNEL_SERVICE` branch. Recorded as partial.

### 8.3 Test — VC-S7, the mandatory first-authorisation test

`36 §2` VC-S7, verbatim:

> In a clean 31-day January with an empty `W_MONTH_ADSPEND` and `W_DAY_ADSPEND`, assert the **first**
> `campaign.budget.set` at `$6.00/day` returns **PERMIT**. Assert `reservation.amount == total_exposure ==
> 0.00` and that `I18b` holds; assert `vendor_amount IS NULL` and `dispatch_payload.monetary_effect IS
> NULL`; assert the `standing_window_exposure` row and the zero-amount reservation row are written in **one
> transaction** so no interleaving observes standing absent; assert `I3`'s four-term sum is `$186.00 ≤
> $186.00`.

The arithmetic, from `26 §2.1.3`, verbatim:

```
standing_cap(s, W_MONTH_ADSPEND:2026-01) = $6.00 × max(31, 30.4) = $186.00
term 1 reserved  = $0.00      term 2 standing  = $186.00
term 3 presumed  = $0.00      term 4 realised  = $0.00
        Σ = $186.00  ≤  W_MONTH_ADSPEND.max_monetary = $186.00     → PERMIT

standing_cap(s, W_DAY_ADSPEND:2026-01-01) = $6.00 × 2.0 = $12.00
        Σ = $12.00   ≤  W_DAY_ADSPEND.max_monetary  = $12.00       → PERMIT
```

**If this test DENIES, S1A stops.** A denial is TB-03 reintroduced. Limits are not adjusted to make it pass.

**Oracle:** the four constants are written by hand in the test. The `dispatch_payload.monetary_effect IS
NULL` clause is asserted against a **fixture** dispatch payload — S1A does not build the Effect
Canonicaliser, so there is no production constructor to call, which happens to make this the most
independent assertion in the suite.

### 8.4 Status

`IMPLEMENTED — S1A. StandingRevocationAuthority: row only.`

---

## 9. VC-S8 — realised/standing atomicity under targeted interleaving

### 9.1 Architecture source

`36 §2` VC-S8, verbatim:

> Assert `standing_window_exposure.forward_monetary` is a **generated column** and that a direct write to it
> fails. Assert one reconciler statement moves `standing_monetary` and `realised_monetary` together in
> `window_balance`. **Targeted interleaving, both orderings**, of an asynchronous realised-spend update
> against a concurrent authorisation on the same `window_balance` row, **with the mandatory `REPEATABLE
> READ` negative control that must fail**. Assert no interleaving exposes headroom acquirable without the
> `window_balance` lock. **Financial truth:** drive `realised_monetary` above `max_monetary` and assert the
> write **succeeds**, that `WINDOW_CEILING_BREACHED` is raised, that a vendor-attributable excess raises
> `STANDING_OVERDELIVERY` and **not** `I3`'s security path, and that the next *commitment* against the
> window is nonetheless refused.

`36 §2`, the mandatory-negative-control rule, verbatim:

> **Negative control, mandatory** (v1.1, VAL-06): the same targeted-interleaving scenario at `REPEATABLE
> READ` **must fail**. A concurrency test with no negative control cannot be distinguished from a test that
> does not exercise the race. And `§14`'s 10× load on a few hundred effects per month **cannot reproduce
> serialisable write skew at all** — this needs injected delays between `SELECT` and `INSERT`, not
> throughput.

### 9.2 Implementation mechanism

`tests/integration/exposure/harness/barrier.ts` — a deterministic two-party latch. Each participating
transaction runs on its **own** `pg` client (its own backend), and the harness releases each party at a
named instruction boundary:

| Boundary | Meaning |
|---|---|
| `AFTER_READ` | The transaction has read `window_balance` and not yet locked |
| `AFTER_LOCK` | `SELECT … FOR UPDATE` returned |
| `BEFORE_WRITE` | About to `UPDATE` |
| `AFTER_WRITE` | `UPDATE` returned, not yet committed |
| `AFTER_COMMIT` | Committed |

**Ordering A** — reconciler begins while the authorisation is acquiring headroom.
**Ordering B** — authorisation begins while the reconciler is recording realised spend.

Both drive the same fixture: `W_MONTH_ADSPEND:2026-01` at `$186.00`, one `LIVE` authorisation at
`$6.00/day`, a realised-spend observation, and a concurrent second authorisation attempt.

### 9.3 Assertions

| # | Assertion | How it is checked |
|---|---|---|
| 1 | No unauthorised transient headroom | A third read-only client polls `window_balance` at `READ COMMITTED` throughout and asserts `reserved+standing+presumed+realised` **never** dips below the conservative floor |
| 2 | No lost realised update | Final `realised_monetary` equals the hand-summed deltas |
| 3 | No dropped standing update | Final `standing_monetary` equals `Σ max(0, cap_i − realised_i)` computed by hand |
| 4 | No deadlock under the declared order | No `40P01` in either ordering, N iterations |
| 5 | Financial truth correct | Realised figure is what the vendor delivered, exactly |
| 6 | Authority headroom conservative | The second authorisation either permits with the full guard satisfied, or denies `WINDOW_EXHAUSTED` — never permits over the bound |

### 9.4 The mandatory negative control

`tests/negative-controls/repeatable-read-race.test.ts`.

**Test-only unsafe path.** A second implementation of the reconciler + authorisation pair that:

- runs at `REPEATABLE READ` instead of the declared isolation,
- takes **no** `SELECT … FOR UPDATE` on `window_balance` (read-then-write instead),
- computes `standing_monetary` in application code from a stale snapshot rather than through the
  in-statement trigger.

This is the weaker/incomplete semantics `36 §2` names. It lives **only** under `tests/negative-controls/`
and against a **test-only** schema variant. **Production code is not weakened.**

**Required output.** The suite asserts the unsafe path **reproduces the forbidden interleaving** — a
transient headroom window that a concurrent authorisation consumes, or a lost realised update — and that the
same assertion battery that passes against production **fails** against it. Expected console shape:

```
safe implementation:        PASS
unsafe negative control:    EXPECTED FAILURE OBSERVED
```

**If the negative control cannot be made to fail, S1A stops.** `phase2-v1.3-implementation-brief.md §7`
condition 4: *"The S1 concurrency harness cannot produce a failing negative control at `REPEATABLE READ`."*
That revokes the architecture PASS; it is not repaired by adjusting the test.

### 9.5 Status

`IMPLEMENTED — S1A. This is the load-bearing test of the increment.`

---

## 10. Applicable PASS-revocation conditions

`phase2-v1.3-implementation-brief.md §7` (= `redteam3/62 §11`). Of the ten, **seven** are reachable from
S1A. Recorded here so the S1A result can answer each.

| # | Condition (abridged; the brief carries the full text) | Reachable in S1A | S1A detector |
|---|---|---|---|
| 1 | A remediation answering a BLOCKING finding by **weakening the invariant** — specifically *"dropping the standing term from `I3`"* | **Yes** | VC-L2's operand assertion (§1.4). A three-term guard is a condition-1 trigger, not a passing implementation |
| 2 | The audit plane's independent input path requires a control-DB read | No | S1A builds no audit plane |
| 3 | The cessation specification proves undeclarable | No | TB-07 blocked; S1A does not attempt it |
| 4 | **The S1 concurrency harness cannot produce a failing negative control at `REPEATABLE READ`** | **Yes** | §9.4 |
| 5 | Independent re-chaining cannot agree across two instances | No | No chain in S1A |
| 6 | `I18` divergence persists between reserved and settled | Partially — the `I18b` rate-class leg only | §2.3 |
| 7 | More than one additional action class proves non-canonicalisable | No | No canonicaliser in S1A |
| 8 | **The standing term cannot be made atomic with the realised term** without either serialising every vendor spend observation behind the authorisation path or admitting a transient headroom window | **Yes — the decisive one** | §9.3 assertions 1 and 3. The brief: *"would be the first finding in four passes to bear on the substrate choice"* |
| 9 | `charge.standing_authorization_id` cannot be derived unambiguously | No | `I22` / VC-S6 out of S1A |
| 10 | The override's aggregate bound cannot be both safe and usable | No | `I63` out of S1A |

**Plus the three conditions the S1A mandate adds on top of `62 §11`**, which map onto the same evidence:

| Mandate condition | Maps to |
|---|---|
| `I3` cannot be implemented as a real single-commit bound | §1, and `62 §11` condition 8 |
| Independent lock ordering still permits transient unauthorized headroom | §7, §9.3 assertion 1 |
| Realised and standing cannot move atomically without blocking financial truth | §6, §9.3 assertion 5, and `62 §11` condition 8 |
| The first rate authorization cannot permit without weakening the ceiling | §8.3, VC-S7 |
| More architecture disagreement is discovered on the money path | `62 §11` condition 1; reported, not resolved |
| DBOS or the step journal requires abandoning the Postgres-centric transaction property | §11, ADR-IMP-002 |

**`62 §11` condition 1 restated as an implementation rule.** *"Each is the tempting repair for a finding
above and each is prohibited."* If any test below fails, the response is **STOP and report**, never:

- drop the standing term from the guard,
- add a tolerance to `I18b`,
- relax the `REPEATABLE READ` negative control until it passes,
- serialise vendor spend observations behind the authorisation path to make atomicity easy.

---

## 11. Durable-execution spike obligations

`phase2-v1.3-implementation-brief.md §4`, verbatim:

> **The DBOS-versus-step-journal spike is authorised** (`62 §6`), unchanged and re-authorised. Gap-free
> `journal_seq` requires a counter row inside the authorising transaction, which is a property of the
> substrate and not of the workflow engine, and the outbox is ACOS-owned either way. **Add to its kill-point
> matrix:** the TB-04 interleavings — an asynchronous realised-spend update against a concurrent
> authorisation on the same `window_balance` row, **in both orderings**.

`31 §3.2` and `34 ADR-002(b)`, the fallback correction, verbatim: *"migrating to Temporal **moves the
checkpoint out of Postgres and destroys R1**"* — so Temporal is **outside** this spike, and `31 §3.3`:
*"**Do not switch to Temporal because it was v1.0's named fallback.**"*

`34 ADR-002` reconsider trigger (e): *"the S1 spike shows the hand-rolled journal is simpler to attack and
equally correct."*

**Deviation from `31 §3.3` recorded here rather than silently.** `31 §3.3` says *"Spike both … against a
vendor sandbox for `refundCreate` and for the ESP rather than against mocks (VAL-04)."* S1A uses **mocks**:
the S1A mandate prohibits Shopify, Stripe and ESP adapters and any real vendor credential, and
`37` S1 states all four action classes run against mocks. VAL-04's point — that vendor idempotency is a
vendor property — is therefore **not** proved by this spike and the spike does not claim it. What the spike
decides is narrower and is stated in ADR-IMP-002: **does DBOS preserve or materially complicate ACOS's
Postgres transaction semantics compared with an ACOS-owned step journal?**

Kill points, per the S1A mandate, each recorded with resulting DB state / workflow state / duplicate
behaviour / recovery behaviour / whether any ACOS invariant is weakened:

1. before the application transaction begins
2. after locks acquired
3. after business rows change but before commit
4. immediately after commit
5. after durability/checkpoint state
6. during retry/recovery
7. concurrent retry of the same work item

plus the TB-04 interleavings in both orderings.

Decision recorded in `docs/implementation/ADR-IMP-002-durable-execution.md` as exactly one of:
`SELECT DBOS FOR S1` · `SELECT ACOS POSTGRES STEP JOURNAL FOR S1` ·
`S1 BLOCKED — DURABILITY SUBSTRATE INVALIDATES OPTION A`.

---

## 12. Explicitly out of scope for S1A

Per the S1A mandate and `phase2-v1.3-implementation-brief.md §3` / `§5`:

**Not built:** Effect Canonicaliser (beyond fixture types for the rate test) · Cedar · symcc · AI CEO · any
LLM · Pydantic AI · research workers · S2 ingress · Shopify · Stripe · Google Ads · Meta · email · real
adapters · `I8` vendor inverse sweep · production audit infrastructure · production advertising ceilings ·
cessation verification · cessation specification values · `PAUSE_PENDING` retry · campaign budget
supersession · owner UI · customer communication · the journal chain · `ACOS-JCS-1` · `JournalAttestation` ·
the mirror state machine · `DegradedModeOverride`.

**Blocked by a scheduled finding** (`phase2-v1.3-implementation-brief.md §5`), and S1A respects all four:

| Component | Blocked by | S1A behaviour |
|---|---|---|
| Any cessation measurement | **TB-07** | Not attempted. `T7`/`T8` structurally unreachable |
| Seeding production ceilings on `W_MONTH_ADSPEND` | **TB-08(a)** | `$186.00` is used **only** as the signed non-production fixture value from `51 §2`, in test fixtures. No production seeding |
| `PAUSE_PENDING` retry | **TB-11** | `T3` is a legal transition in the trigger; **no retry logic** |
| Any `campaign.budget.set` supersession path | **TB-13** | VC-S5's successor is a **distinct fixture authorisation**. No `SUPERSEDED` status, no max-over-instance cap |

---

## 13. Contract summary table

| # | Contract item | Architecture source | Mechanism | Test | Independent / negative oracle | Status |
|---|---|---|---|---|---|---|
| 1 | `I3` four-term guard | Registry `§1.2` `I3`; `24 §3` K5 | `BEFORE UPDATE` trigger on `window_balance` | `commitment-guard`, `guard-operands` (VC-L2) | Hand table; trigger body parsed from `pg_proc`; **three-term negative control** | IMPLEMENTED |
| 2 | Financial truth writable above ceiling | `24 §3` K5 | Guard's `IF` predicate | `commitment-guard` cases 9–10; VC-S8 financial-truth leg | Hand table | IMPLEMENTED |
| 3 | `I18b` for rate classes | Registry `§1.1` `I18b`; `26 §2.1.3` | Zero-amount reservation row; `forward_integral` a separate column | `rate-class-handoff` | **`forward_integral`-as-reservation negative control reproduces TB-03** | IMPLEMENTED |
| 4 | `I62` transition set | Registry `§1.2` `I62`; `24 §3.1` | `BEFORE UPDATE` trigger on `(OLD.status, NEW.status)` | `standing-transitions` | App check disabled; `REVOKED→EXPIRED` must fail | PARTIAL (T7/T8 unreachable) |
| 5 | K5 schema | `24 §3` K5 | Migrations, as printed | `schema-conformance` | `information_schema` introspection | IMPLEMENTED |
| 6 | `forward_monetary` generated | `24 §3` K5 | `GENERATED ALWAYS AS (GREATEST(0, cap − realised)) STORED` | `generated-column` | Direct write must raise; `is_generated='ALWAYS'` | IMPLEMENTED |
| 7 | `max(0,·)` does not distribute | `24 §3` K5 | Per-authorisation generation + trigger sum | `max-does-not-distribute` | Hand-computed counterexample | IMPLEMENTED |
| 8 | Window-instance semantics | `24 §3.1`; `26 §10.1` | `window_instance_key`; `instance_in_scope`; `LIVE`-only boundary job | **VC-S5** | Hand constants; distinct successor fixture (TB-13 respected) | IMPLEMENTED (2 clauses deferred) |
| 9 | Realised/standing atomicity | `24 §3` K5 TB-04 | One statement + in-statement sync trigger | **VC-S8** | Hand-summed deltas; **`REPEATABLE READ` negative control** | IMPLEMENTED |
| 10 | Lock order | `30 §5.2`; `24 §3` K5 | Single `lockOrder.ts` helper | `lock-order-sole-path`, `-deadlock` | Source grep; **reversed-order deadlock control** | IMPLEMENTED |
| 11 | Step R rate branch | `26 §7` (v1.3.1 E1); `26 §2.1.3` | `stepR.ts`, two branches, one transaction | **VC-S7** | Hand arithmetic; fixture dispatch payload | IMPLEMENTED |
| 12 | VC-S8 both orderings | `36 §2` VC-S8 | Deterministic barrier harness | **VC-S8 A and B** | Third read-only observer; **mandatory negative control** | IMPLEMENTED |
| 13 | Durable-execution spike | Brief `§4`; `31 §3.3`; `34 ADR-002` | Two candidates, one work item, 7 kill points + TB-04 | `spikes/durable-execution/` | Kill-point matrix; DB state inspected directly | ADR-IMP-002 |

---

*Written before production code, per the S1A mandate. No acceptance criterion in this document was invented
from memory; every one carries its architecture reference above.*
