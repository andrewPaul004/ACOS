# S1F — Implementation Log

Decisions taken while building the atomic local authorisation commit, each with the passage
it rests on and what was rejected. Written as the slice was built, in the order the
questions arose.

---

## 1. Which local records the architecture actually requires to be atomic with step R

**The question.** The S1F mandate forbids creating `reservation committed` while the
corresponding local authority state is absent because "that will be added in S1G". So the
set had to be DERIVED from the current architecture rather than guessed.

**What was read.** `26 §7`'s complete sequence and its nine load-bearing properties;
`26 §2.1.3`'s rate handoff; `24 §3` K4, K5 and K9; `25 §7` and `§12`; `30 §5.1`–`§5.3`;
`33 §1` and `§6`; `37 §2`'s S1 scope; the v1.3 invariant registry; and
`phase2-v1.3.1-errata.md §1`.

**The answer, from three passages that agree.**

`33 §1` names four things: *"The exposure reservation, the authorisation decision, the effect
journal row with its gap-free sequence and local chain hash, and the resulting state
transition commit or fail together, as a single Postgres transaction."*

`33 §6` names the tables: *"§1's transaction spans `authorisations`, `effects`,
`exposure_reservations` and `state_facts` — four module schemas"*, and the `effect_path` role
*"spans `authorisations`, `effects`, `exposure_reservations`, `state_facts` and `journal`,
and it is **declared the privileged path**."*

`30 §5.1` item 3 prints the write order inside the `BEGIN`.

`24 §3` K5 states it as an invariant: *"Reservation is atomic with the authorisation decision
(SR5)."*

So the atomic set is: reservation (+ its window rows + the balance move + the rate branch's
standing rows), the authorisation row, the effect row, the decision row, the approval row
where step S finds a tier, the journal-counter allocation and the journal row.

**What was rejected.** Committing the reservation and adding the decision later. That is
Option B/C behaviour, `33 §1` calls it the difference the architecture selection turned on,
and the S1F mandate names it as an automatic FAIL.

---

## 2. The `30 §5.1` / `26 §7` write-order difference

**The observation.** `30 §5.1`'s list puts the effect row BEFORE the reservation row.
`26 §7` property 8 puts step R before steps T–V and states the consequence: *"a duplicate
proposal returns the prior result **and the reservation is released** rather than
double-counted."* A release presupposes the reservation was taken first.

**Why it is not a mechanism conflict.** Both passages describe one transaction with one
commit point. Under atomicity the intermediate write order is unobservable in every respect
but one — which condition determines the outcome when a proposal is BOTH a duplicate AND
short of headroom.

**The resolution.** `26 §7` decides that case explicitly and gives its reason; `30 §5.1`'s
list appears inside a section whose subject is the lock order and the single commit point,
both of which the implementation honours exactly. So the gate order is `26 §7`'s and the
divergence is confined to the position of one `INSERT`.

**What was NOT done.** No architecture file was edited, and the easier reading was not
chosen for being easier: the consequence is asserted directly, so the choice is visible in
the suite rather than only in prose. `tests/integration/authority/local-idempotency.test.ts`
— *"R PRECEDES T — a duplicate that ALSO lacks headroom denies WINDOW_EXHAUSTED"*, with the
local step trace showing `['R']` and no `T`.

Recorded as owner clarification **S1F-C1**.

---

## 3. The savepoint, and why step V needs one

`26 §7` step V returns the prior result and RELEASES the reservation. Inside one transaction
there is no "release" primitive — the reservation was never committed — so the release is a
rollback of the attempt.

A `SAVEPOINT` taken **after** the money-path locks and **before** the authorisation row makes
the whole attempt releasable as a unit:

* the locks were acquired before the savepoint, so they are RETAINED across the rollback —
  which is what stops a concurrent proposal occupying the released headroom in the gap;
* the authorisation row, the reservation, its window rows, the balance movement and the rate
  branch's standing rows all go back together, so a duplicate leaves NO stranded
  authorisation. Asserted: *"the duplicate attempt left NO authorisation row of its own"*.

A `ROLLBACK TO SAVEPOINT` is also the only way to continue after a `23505`, because
PostgreSQL puts the transaction in an aborted state — so the mechanism the architecture needs
and the mechanism PostgreSQL requires are the same one.

---

## 4. Identifiers are derived, never random

`30 §5.2` requires the idempotency key to be *"computed before the transaction that allocates
the sequence"* so *"a retry after a crash would [not] compute a different key"*.

The same argument applies to every other identifier the transaction writes. A `40001` retry
that minted a fresh `reservation_id` would leave the first attempt's rolled-back id in the
caller's hands; a crash-and-resubmit that minted a fresh `decision_id` would make the
prior-result lookup ambiguous.

So `mintIds` is `H(domain ‖ authorisation_ref)` under the accepted framed-concatenation
construction, with a distinct domain per identifier. There is **no random source and no clock
read** in it.

`authorisation_ref` is `26 §2.1`'s *"the authorisation reference the gateway allocates"* — it
is already a kernel-owned per-proposal value, and it is the `authorisation` row's primary key.
A second proposal of the same intent carries a DIFFERENT ref, so it inserts its own
authorisation row, reserves, and is then caught by `I42` at the effect row — which is exactly
where `26 §7` puts the check.

---

## 5. `ACOS-JCS-1` in PL/pgSQL, and the null question

`I17d` requires the chain to be *"computed by database functions inside each instance, under
roles the writing principal cannot execute as"*, and `30 §5.1` says the local chain is
*"computed by a control-DB trigger"*. So the journal's hash could not be computed in
TypeScript.

`30 §5.3`'s seven rules were implemented as seven SQL helpers. Six were mechanical:

| rule | SQL |
|---|---|
| field framing, 4-byte big-endian length | `int4send(length(v)) \|\| v` |
| null | `'\x00'::bytea` |
| text, UTF-8 NFC | `convert_to(normalize(v, NFC), 'UTF8')` |
| money at the declared scale | `to_char(v, 'FM99999999999999990.00')` |
| timestamp, RFC 3339 UTC, six digits, `Z` | `to_char(v AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')` |
| the digest | `sha256(bytea)`, built in since PostgreSQL 11 — no extension |

**The seventh rule was avoided rather than implemented.** `30 §5.3`'s JSON rule is RFC 8785,
and RFC 8785 in PL/pgSQL would be a second canonicaliser for the hardest of the seven
hazards. The journal row kind was therefore declared with **no JSON-valued column**: every
field is text, integer, boolean, money, timestamp or bytes. The rule is not exercised by this
row kind and no SQL-side JCS implementation exists.

**The `ACOS-JCS-1` null question did NOT need to be reopened.** The S1F mandate says to stop
and return partial rather than invent a canonical null representation. Nothing was invented:
`30 §5.3` already declares *"Single `0x00` sentinel byte for null"*, and owner clarification
**S1B-C8** already closed the injectivity gap that made it ambiguous (`U+0000` is inadmissible
in ACOS canonical text, so no accepted text can imitate the sentinel; PostgreSQL `text` cannot
store `U+0000` at all, so the exclusion is structural on the SQL side). The nullable columns
in the journal row are `approval_id` (text), `vendor_amount` and `forward_integral` (money) —
all three covered by the existing rule. No NEW nullable-`bytes` or JSON-literal-null encoding
was introduced.

`ACOS-JCS-1` GENERALLY remains an open obligation for `VC-A3`, which is cross-INSTANCE byte
identity and needs a second independent implementation (the audit trigger). S1F builds the
control trigger only and claims nothing about VC-A3.

**The byte oracle is a third reading.** `tests/integration/authority/journal-sequencing.test.ts`
frames the expected bytes by hand from `30 §5.3`'s table — not by importing
`canonicalBytes.ts`. Comparing the SQL trigger against the TypeScript canonicaliser would be
a useful test and it is VC-A3's, not this one's.

---

## 6. The step table was NOT extended

The accepted `tests/authority/authority-channel-attacks.test.ts` asserts *"there is no step R,
S, T, U, V, W or X in the declared sequence"* — *"The S1E boundary, as a property of the step
table itself."*

Appending `R` to `AUTHORITY_STEPS` would have deleted an accepted assertion, and the
assertion is correct: `AUTHORITY_STEPS` is what the PRE-RESERVATION pipeline is checked
against, and a pipeline able to claim it evaluated step R would be claiming a step it does not
implement.

So S1F declares its own table, `localSteps.ts`'s `LOCAL_AUTHORISATION_STEPS`. The accepted
assertion is untouched and passes unchanged, and
`tests/integration/authority/local-authorisation-boundary.test.ts` asserts the two tables are
disjoint and that their concatenation is `26 §7`'s whole flowchart.

---

## 7. How the payload stays withheld

`26 §7` step T mints the idempotency key from the DISPATCH PAYLOAD, and `24 §3` K4's effect
row records the ADAPTER. Both live on the payload the accepted S1E boundary deliberately
withholds, and both are needed by the journal and the effect row.

Three options were considered:

1. add the payload to `PreReservationQualified` — **rejected**: it deletes the accepted
   structural boundary and the type-negative fixture that asserts it;
2. an optional out-parameter on `evaluateUnderLease` — **rejected**: a public seam a caller
   could use to capture kernel-internal values;
3. a module-scoped `WeakMap` keyed by the frozen result — **adopted**.

The map is not exported, has no accessor, and is read by exactly one function. A caller
holding an S1E result therefore holds exactly what the accepted type says it holds, and
`tests/type-negative/prereservation-as-dispatchable.ts` continues to hold unchanged.

`WeakMap` rather than a field on the pipeline: the pipeline is reentrant, and a field would
let one concurrent proposal's continuation be consumed by another's commit.

What crosses is the request's economics, the `dispatch_payload_hash`, the idempotency key and
the adapter name. There is no method, no vendor parameter map, no monetary effect and no
credential — so the handle is not sufficient to dispatch, which is the property, not the
absence of the word "payload".

---

## 8. `lineage` is not a parameter of the pipeline continuation

`authoriseLocallyUnderLease` takes `Omit<LocalAuthorisationOptions, 'lineage'>`. On that path
the lineage is the ACCEPTED S1E result's own — the policy version the Cedar engine reported,
the constructor version the signed record resolved to, the determining policies and the gate
trace.

A caller able to supply one could put a different `policy_version` on the journal row than the
one that actually decided step M, which is the shape `26 §11`'s reproducibility claim exists
to prevent. The first version of the fixture DID pass a placeholder lineage, and the
end-to-end assertion on `lineage.stepsEvaluated` is what caught it.

---

## 9. The accepted step R was reused, not reimplemented

`exposure/stepR.ts` is the ACCEPTED S1A implementation of both branches, including the E1
two-branch shape and the `no shared verb` discipline. S1F calls it unchanged, with
`participatesInJournal: false` — because the counter is already held by S1F's own acquisition
and the sequence is allocated next to the journal row it numbers.

The accepted step-R functions take the declared locks AGAIN through the same single
acquisition site. Re-locking rows this transaction already holds is a no-op in the same
declared order, and it keeps the money-path lock discipline in exactly one module. The
alternative — passing a "locks already held" flag into accepted code — would have opened a
seam in the one place `30 §5.2` says there must be no second discipline.

---

## 10. `countUnits`

`51 §2` declares `W_DAY_REFUND.max_count = 2` and `W_MONTH_REFUND.max_count = 10`, and what
those ceilings count is EFFECTS. So an ordinary authorisation consumes ONE count unit, and
the count ledger genuinely binds — the third refund in a day denies even with monetary
headroom. Asserted:
`tests/integration/authority/multi-window-binding.test.ts`'s *"the COUNT ledger
participates"*.

The rate branch passes `0n`, matching accepted VC-S7. Both ad-spend windows declare
`max_count` UNBOUNDED (`51 §2`), so the count ledger does not bind a rate class either way,
and inventing a figure for it would have been a rule with no source.

---

## 11. The kill-point split is TEST-ONLY, and says so

`36 §2`'s matrix needs an abort "after the first window lock/check", and production takes all
of its locks in ONE call to the single acquisition site.

Rather than restructure production to match the numbered list — which the S1F mandate
explicitly forbids — the split happens **only when a hook is present**:

```ts
if (options.at !== undefined && instanceRefs.length > 0) { ...lock the first...; await hook(...); }
```

`declaredOrder` chooses the same first row the single call would have locked first, and the
second call re-locks it as a no-op. **Production issues exactly one acquisition.**

---

## 12. `I60`'s partial index is structurally redundant, and is installed anyway

`26 §12.2`: *"`RESUMING` carries a unique partial index on `(approval_id)` (I60), so a second
resume cannot start."*

With `approval_id` as the primary key the index is trivially satisfied. Two readings were
available: install it as declared, or "improve" it to key on something that would actually
constrain a second resume.

**Installed as declared, and recorded.** The architecture names this index; guessing at what
it "should" have keyed on would be designing the resume path, which is deferred. If a later
slice gives a resume its own row, the index is already the shape `I60` asks for. The
redundancy is stated in the migration comment and asserted in the boundary suite rather than
left for a reader to notice.

---

## 13. Append-only is a trigger, not a grant

`33 §6` requires append-only tables to have *"no `UPDATE` or `DELETE` grant for any
application role"*.

S1 runs as one database role. `33 §6` is itself explicit that per-module roles *"are not
isolation against compromised in-process code"* and that `effect_path` spans every schema the
transaction touches and is *"declared the privileged path"*. So there is no second role to
withhold the grant from.

A trigger is the substitute that actually refuses the write in this deployment — and it
refuses it for the privileged role too, which a grant to a single role could not. Recorded
here as a substitution rather than presented as the architecture's mechanism.

`effect_journal` is the one exception: `30 §5.2` requires `mirrored_at` to be settable *"on
first successful acknowledgement"* and calls it *"advisory only"*, so its trigger permits
exactly that column and refuses every other change and every `DELETE`.

---

## 14. The isolation assertion, and what PostgreSQL already prevents

`33 §6` requires isolation to be *"set and asserted at the connection"*, and names the hazard:
a reservation *"written inside a framework `@transaction` at default isolation silently
reintroduces write skew on the `SUM` guard."*

Measured against real PostgreSQL, the framework-wrapper case fails closed on its own: a
nested `BEGIN ISOLATION LEVEL SERIALIZABLE` is treated as `SET TRANSACTION`, which is an
ERROR once a statement has run in the outer transaction. So the money path cannot start at
all. That is asserted, with the error text, in
`tests/negative-controls/local-authorisation-controls.test.ts`.

The production assertion is still written and still throws, because "PostgreSQL happens to
refuse this shape today" is not the property `33 §6` asks for. The assertion reads
`current_setting('transaction_isolation')` — the DATABASE's answer, not a constant — and the
comparison is shown to be capable of failing by reading the same setting inside SERIALIZABLE,
REPEATABLE READ and READ COMMITTED transactions and getting three different answers.

`LocalAuthorisationOptions` has no `isolation` member, so there is no caller override.

---

## 15. The rate branch does not traverse C′, and the result says so

`campaign.budget.set` IS in the closed catalogue (`actionCatalogue.ts`, `rateBased: true`) and
has NO registered constructor, so `26 §7` step C2 would deny it `NOT_CANONICALISABLE`.
Building one is a per-class commerce state model, a per-class enumerator and a per-class
semantic option digest — canonicaliser work for a class, and outside the S1F mandate.

So the rate branch reaches step R with a KERNEL-SUPPLIED exposure block, exactly as accepted
VC-S7 does. What S1F proves for it is S1F's own property — that the zero-amount reservation,
the standing authorisation, its revocation authority, the standing window rows, the effect,
the signed decision and the journal row commit or fail TOGETHER. It does not prove that a
rate class traverses C′, and the result reports that boundary rather than eliding it.

---

## 16. Findings from building the suite

**16.1 — The lineage placeholder.** The first fixture passed a placeholder `lineage` on the
pipeline path, and the end-to-end assertion on `lineage.stepsEvaluated` failed with `[]`.
Fixed by removing `lineage` from the continuation's parameter type entirely (§8), which turned
a fixture bug into a structural guarantee.

**16.2 — A day-only grant denies at step I, not at the intersection.** The first version of
the multi-grant intersection case gave the second grant `windows: ['W_DAY_REFUND']` and
expected a step-M denial. It denied at step I with `GRANT_MISSING_MONTH_WINDOW` — an S1E rule.
Rewritten to give both grants the same window set so the only variable is the bound under
test, which is also the shape the accepted S1E union control uses.

**16.3 — `per_action_max` on a grant row does not decide step M, and a test asserting it does
would assert a defect.** `grants.ts` states the accepted boundary: *"The per-action cap that
binds is still the one in the Cedar artifact […] Moving the binding figure into a database row
would put the money cap somewhere a compromised writer could raise, which is the opposite of
`26 §11`'s 'No runtime editing'."* The intersection case was rewritten to use
`recoverability_max`, which IS a grant-row operand that step J compares against — so the
"adding a grant never widens" property is proved on a dimension where it is actually
enforced.

**16.4 — Source scans need to distinguish vocabulary from mechanism.** Three scans produced
false positives on first run and each was narrowed with a stated reason rather than deleted:
`26 §7` step G's *"the engine fetches its own preconditions"* makes `PreconditionEvaluator.fetch`
the architecture's own word, not a network call; `KERNEL_SERVICE` is a member of `26 §3`'s
principal-kind enum, so its presence is a declaration and not an execution path; and
`principal.ts` and `liveSelector.ts` CITE negative controls by path in prose, which is
documentation and not a dependency. The scans now match import statements and call sites over
comment-stripped code.

**16.5 — A `pg_advisory_lock` in a test can hang the test.** The first competitor test issued
a BLOCKING acquire before the span and timed out. Rewritten to use `pg_try_advisory_lock`,
which is non-blocking, so the observation cannot become an acquisition — the same instrument
the accepted S1C lease suite uses, and for the same reason.

**16.6 — `array_agg` over `text` arrives as a PostgreSQL array literal.** `pool.ts`
deliberately leaves `pg`'s type parsers alone so NUMERIC stays a string, so the schema
introspection helpers use `string_agg` and compare joined names.
