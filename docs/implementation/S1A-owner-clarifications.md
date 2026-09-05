# S1A Owner Implementation Clarifications

**Issued 2026-09-04, during S1A.1**, after the owner's independent review of the actual
repository.

This document records **owner implementation clarifications**. It is not an architecture
amendment and it is not a correction of the architecture record.

**The immutable architecture package under `docs/architecture/v1.3.1/` was not
modified** by S1A.1, in any respect, and no historical artefact was rewritten. Where the
architecture contains a textual contradiction or mismatch, that contradiction **is
present**, is quoted here verbatim, and is left where it is. What follows is the reading
S1 implementation uses, and — for both clarifications below — **the reading S1A already
implemented and tested**. Neither changes any implemented behaviour, any authority
quantity, or any MAL figure.

| ID | Clarification | Changes behaviour? |
|---|---|---|
| **S1A-H3** | The irrecoverable-units ledger's standing term is explicitly `0` in the current model | **No** |
| — | The single money-path lock order, resolving `30 §5.2`'s internal contradiction | **No** |

The other two S1A.1 findings are repairs rather than clarifications and are recorded in
`S1A-implementation-log.md`: **S1A-H1** (the DBOS spike's clean-environment bootstrap
defect, §16) and **S1A-H2** (`40001` retryable, `40P01` pass-revoking, §17). **S1A-H4**
(the step journal's scope) is recorded in `ADR-IMP-002-durable-execution.md`.

---

## 1. The money-path lock order

### 1.1 The contradiction, quoted

`30 §5.2`, under *"Lock order, declared once and cited everywhere"* (AUD-04), prints:

> **1. `window_balance` rows, `FOR UPDATE`, ascending `window_id`. 2.
> `journal_counter(company_id)`, `FOR UPDATE`. 3. Everything else.**

and then, in the **immediately following sentence**:

> The counter is taken **last** because it is the most contended and holding it across the
> balance checks would serialise every company operation behind the slowest one.

**These two passages contradict each other literally.** The numbered list puts the counter
at position **2**, with *"everything else"* at position **3**. The next sentence requires
the counter to be **last**. Both cannot be followed as printed. This is a real defect in
the architecture text, it is not a misreading, and S1A.1 does not claim otherwise.

`24 §3` K5 item 3 resolves it, and does so unambiguously:

> **The reconciler takes the same lock order as the authorising transaction** —
> `window_balance` rows `FOR UPDATE` ascending `window_id`, then
> `standing_window_exposure`, then the journal counter. There is one lock order in the
> system and both writers of the money row obey it.

Registry `§1.2` `I3`'s enforcement column agrees, describing the `window_balance` row as
taken *"ascending `window_id`, **before the journal counter**"*.

So two of the three passages put the counter last, one of them explicitly names
`standing_window_exposure` as the middle position, and `30 §5.2`'s own prose sentence
agrees with them. Only `30 §5.2`'s numbered list disagrees, and it disagrees with the
sentence printed directly beneath it.

### 1.2 The owner clarification for S1 implementation

The single money-path lock order is:

1. **`window_balance` rows**, `FOR UPDATE`, **deterministic ascending order**
2. **`standing_window_exposure` rows** where required, `FOR UPDATE`, **deterministic
   order**
3. **`journal_counter(company_id)`**, `FOR UPDATE` — **last**, where the path participates
   in the journal
4. **Other non-money-path state**

There is exactly one such order in the system, and both writers of the money row obey it.

### 1.3 This changes no implemented behaviour

**It documents the ordering S1A already tested.** The S1A implementation and the
owner-issued S1A implementation mandate both used
`window_balance → standing_window_exposure → journal_counter last`, and that ordering
survived the actual deadlock and concurrency tests:

- `src/kernel/exposure/lockOrder.ts` is the **single** acquisition site — enforced by a
  test that walks `src/` with comments stripped and fails on a second `FOR UPDATE` against
  `window_balance`, `standing_window_exposure` or `journal_counter`.
- `tests/integration/exposure/lock-order.test.ts` asserts the sequence issued **at the
  database** is `W_DAY_REFUND, W_MONTH_REFUND` (balances), then the same two (standing
  rows), then `journal_counter` — the counter observably last, even when the caller
  supplies its windows in the wrong order.
- Twelve concurrent same-window transactions produce **zero `40P01`**, asserted with **no
  retry** in the path.
- The reversed-order negative control **does** deadlock, so the no-deadlock result is
  discriminating rather than vacuous.

### 1.4 The one tie-break that is an implementation choice, not an architecture claim

`30 §5.2` orders by `window_id`. A transaction touching **two instances of one window** —
which VC-S5's cross-boundary case does — has no order under that rule alone.
`lockOrder.ts` therefore sorts by `(window_id, window_instance_key)`. This narrows an
ambiguity in the direction of a total order; it contradicts nothing. Recorded previously in
`S1A-implementation-log.md §7` and repeated here because it is part of what "deterministic
ascending order" means above.

### 1.5 What this clarification does not do

It does not amend `30 §5.2`. Whether the architecture record is corrected is an
**architecture action**, not an implementation one. It is recorded here for the owner's
review, alongside the version-pin finding in `ADR-IMP-002 §1` and the stale-summary
findings in `S1A-implementation-log.md §1`.

---

## 2. S1A-H3 — the irrecoverable ledger's standing term is explicitly zero

### 2.1 The mismatch, quoted

Registry `§1.2` `I3` describes **four conceptual terms for each of the three ledgers**:

> For every named window **instance** `i`, across each of the three ledgers (monetary,
> count, irrecoverable-units): `Σ open reservations + Σ forward exposure of every
> StandingAuthorization not in status REVOKED and in scope for i + Σ presumed exposure of
> effects in PRESUMED_SETTLED + realised spend ≤ w.ceiling` for that ledger.

`24 §3` K5's **single authoritative `window_balance` schema** declares, for the
irrecoverable ledger:

```
  reserved_irrecoverable,                         presumed_irrecoverable, realised_irrecoverable,
```

— three terms, with a gap in the printed alignment where the monetary and count rows each
carry a `standing_*` column, and **no `standing_irrecoverable`**.

`standing_window_exposure`, which is where `I3`'s term 2 is materialised from, carries
**only monetary forward exposure**. `I3`'s own operand row says so:

> Term 2 from `24 §3` K5's `standing_window_exposure` rows, `forward_monetary` a
> **generated column** over `(standing_cap_monetary, realised_monetary)`, summed into
> `window_balance.standing_monetary` by trigger in the same statement […]

There is no irrecoverable-units standing quantity anywhere in the architecture. So `I3`'s
four-term statement and K5's three-column schema are, as printed, a mismatch.

### 2.2 The owner clarification for S1 implementation

**For the irrecoverable-units ledger, the conceptual standing term is definitionally `0`
under the current `StandingAuthorization` model.**

The implemented irrecoverable guard therefore has **three stored non-zero operands**:

```
reserved_irrecoverable + presumed_irrecoverable + realised_irrecoverable
```

**plus an implicit zero standing term.** Three stored operands `+ 0` is `I3`'s four
conceptual terms. The count ledger's standing term (`standing_count`) **is** declared and
the guard does carry it; only the irrecoverable ledger's is definitionally zero.

### 2.3 What is explicitly NOT done

- **`standing_irrecoverable` is not added.** K5's printed schema is the authority and it
  does not declare one.
- **The existing guard arithmetic is not changed.** The installed trigger body is
  unmodified by S1A.1.

### 2.4 The assertion that makes the implicit zero explicit

The risk this clarification creates is precise: a **future `StandingAuthorization` type
that introduces irrecoverable-unit forward exposure** could silently reuse this schema,
and the guard would then omit a term that was no longer zero — which is TB-01's shape and
`phase2-v1.3-implementation-brief.md §7` condition 1's trigger.

`tests/integration/exposure/irrecoverable-standing-zero.test.ts` closes that path
mechanically:

| Assertion | What it forbids |
|---|---|
| `window_balance` declares exactly `reserved_`, `presumed_`, `realised_irrecoverable` and no standing one | Adding the column without reconciling it against K5 |
| `standing_window_exposure`'s column set is exactly its eight monetary/scoping columns, with **no** `irrecoverable` and **no** `count` quantity | Introducing irrecoverable forward exposure into the table `I3` term 2 reads from |
| **Every** column in the schema matching `%irrecoverable%` is one of the seven K5 declares, asserted as an exact set | Adding an irrecoverable quantity anywhere in the schema quietly |
| The three stored terms may consume the **whole** ceiling (`5 + 4 + 4 = 13` against `W_DAY_MIE`'s `13`) | A non-zero fourth term — which would necessarily reduce what the three can hold |
| One unit above the ceiling is still refused with `ACS03` from the trigger | Reading "implicit zero" as "the bound is weaker" |

`vc-l2-guard-operands.test.ts` continues to assert the three-operand irrecoverable sum
read back from the installed `pg_proc.prosrc`, and `schema-conformance.test.ts` continues
to assert the absence of `standing_irrecoverable`. S1A.1 adds the behavioural and
exact-set assertions above; it removes nothing.

**A future type that introduces irrecoverable-unit forward exposure would have nowhere to
store it and no operand to enter the bound through. It would require an ARCHITECTURE
change**, and the assertions above force that conversation instead of permitting a drift
into it.

### 2.5 This changes no implemented behaviour

The guard, the schema and the arithmetic are exactly what S1A shipped. What S1A.1 adds is
the explicit statement of the interpretation, and tests that pin it.

---

## 3. Authority quantities

**No authority number changed in S1A.1.** No ceiling, no rate, no `standing_cap`, no MAL
figure, no `51 §2` fixture cell and no `51 §3` grant was altered. `tests/support/fixture.ts`
is byte-identical in its transcribed limits, and `tests/support/oracle.ts` — which imports
nothing from `src/` — still agrees with `26 §2.1.3`'s printed working and
`phase2-v1.3.1-verification.md §10`'s recomputation.
