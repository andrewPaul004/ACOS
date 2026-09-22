# S1J owner clarifications — the v1.3.5 continuation

Every item below is an **implementation decision taken against `docs/architecture/v1.3.5/`**, not a
reading of the architecture and not an amendment to it. The package at `81c2939` is unchanged; the
architecture gate is re-run unmodified and reports `64 PASS / 0 FAIL`.

Where an item exists because the architecture is silent, it says so and says which direction it
fails in. Where an item exists because an *earlier implementation slice* left something unbuilt, it
says that instead — those are not architecture gaps and are not reported as such.

---

## S1J-C7 — `irrecoverable_units` is resolved at the reservation writer, not passed to it

**Decision.** `src/kernel/exposure/stepR.ts` resolves the unit count from the closed catalogue by
action class (`irrecoverableUnitsFor`), inside `reserveOrdinary`. No request type on the reservation
surface carries the value: `OrdinaryReservationRequest`, `RateClassAuthorisationRequest` and
`WindowTarget` have no `irrecoverableUnits` member.

**Why, and why it differs from `countUnits`.** `51 §2.3` requires the value to be "kernel- and
catalogue-owned" with "no generic caller parameter for it, and no request field carries one".
`countUnits` **is** a request field, because `51 §2`'s count ceilings count effects and the accepted
S1A/S1F shape already put the figure on the request. Copying that shape for MIE units would have
satisfied the type checker and broken the declaration, so the two are deliberately asymmetric and
`stepR.ts`'s helper header records the asymmetry at the call site.

**Fails closed.** An action class not in the catalogue throws rather than reserving zero.

---

## S1J-C8 — the committed-reservation release is implemented here for the first time

**Decision.** `25 §7.2` releases the money reservation "under the existing reservation-release
semantics". **No accepted slice had any.** `26 §7` load-bearing property 8 names a release — "a
duplicate proposal returns the prior result AND THE RESERVATION IS RELEASED" — and the accepted S1F
implements it by rolling back to a `SAVEPOINT`, which releases by never having committed. S1J is the
first slice that releases a **committed** reservation.

**What was built, and the bound on it.** `releaseMonetaryReservation` moves the *same two terms*
step R moved, by the *same amounts*, on the *same bound window instances*, read from the immutable
`reservation_window_instance` rows step R wrote. `0013` adds `released_at` and `released_reason` to
`exposure_reservation` with a one-member reason domain and a one-way trigger, so `I3` term 1 stays
reconstructable as the sum over unreleased reservations.

**No new ledger, no new term, no status machine, and no `NEVER_SENT` release** — the latter moves
`presumed_irrecoverable` and requires provider evidence that does not exist.

**This is an implementation gap that S1J closed, not an architecture omission.** The architecture
declared the release; no slice had needed one before.

---

## S1J-C9 — the enumeration/option identity and the task scope are persisted

**Decision.** `0013` adds `authorisation.enumeration_id`, `authorisation.option_id` and
`enumeration_record.context_spec`.

**Why.** `25 §14.1` makes dispatch-time revalidation mandatory and names its operands, including
"the original enumeration/option identity". Three of the four operands were already on the committed
`authorisation` row; the enumeration/option pair was not, so a dispatch one epoch later had nothing
to revalidate against. `26 §2.1` had **always** required the request to record both
("`enumeration_ref` — the `enumeration_id` and its `computed_at`" and "the enumerated option whose
`option_id` the selector names"), so persisting them closes a conformance gap in the row rather than
adding an authority fact.

**Why the scope too.** The revalidation re-enumerates the current permissible effects and tests
membership of the original `option_id`. That enumeration is scoped by the task's `context_spec`
(`24 §3` K4), and for `refund.create` the task's `reason_code_scope` is *inside* the
`semantic_option_digest` (`26 §2.2`) — so a different scope computes different `option_id`s. A scope
supplied at the dispatch boundary would let a caller widen the admitted resource set one epoch after
the gates ran **and** change the identity being compared. Persisting it on the kernel's own
enumeration record means no dispatch surface has a parameter for one.

**Fails closed.** An authorisation with no identity, or an enumeration with no persisted scope, is
`STALE` and the claim is refused. It is never treated as a pass.

**The rate branch is the declared null case.** `campaign.budget.set` never traverses C′ (`26 §7`
step C2 — no registered constructor), so it carries neither and is not dispatchable. That is the
correct answer for a class ACOS cannot revalidate.

---

## S1J-C10 — the two constructor-less classes get a TEST-ONLY enumerator

**Decision.** `tests/support/fixtureEnumerator.ts` registers a minimal live enumerator for
`campaign.pause` and `fulfilment.reship` **in the outbox test harness only**. Production's catalogue
is untouched and `ConstructorRegistry` still receives one constructor in every other harness, so
`36 §2`'s "an action class with no registered constructor must produce DENY: NOT_CANONICALISABLE"
remains asserted by the accepted S1B/S1C suites.

**Why it was needed.** `25 §14.1`'s revalidation is mandatory. `37 §2` S1 requires all three
recoverability classes to be exercised, and v1.3.5's SEQ-02 puts the IRRECOVERABLE execution
semantics — step R's reservation, the `reserved → presumed` movement and its kill-point matrix — at
S1. The accepted S1I/S1J fixtures reached those classes through hand-authored facts that bypass C′,
which stood in for *half* of C′: they supplied a canonical payload and no enumeration. Under v1.3.5
those effects would be refused at the dispatch boundary — correctly, and for a fixture reason.

**This is not an architecture contradiction and is not reported as one.** In a conformant S1
pipeline a class with no constructor cannot be authorised, so it cannot be dispatched, so the
revalidation is always performable for a genuinely authorised effect. What was missing was in the
fixture. Registering a constructor for those classes in production would be canonicaliser work for a
new class and is out of this slice's scope; the alternative — weakening the revalidation for classes
that carry no enumeration — would have deleted the control v1.3.5 exists to add.

**The option object is cast.** `SelectedAuthoritativeOption` is a union of one at S1B. Widening a
production type so a fixture can satisfy it would be the wrong direction, and the cast is safe
because only the fixture constructor's own `computeSemanticOptionDigest` and
`optionDescriptionFields` ever read the value.

**The state model is `commerce_order`, reused.** One resolvable, mutable, RECORD-graded row is all a
fixture needs, and demoting `grade` is how a gap-mutation test makes an authorised effect stale —
a real property of authoritative state rather than a flag.

---

## S1J-C11 — the outcome transaction's isolation is chosen by the movement

**Decision.** `SERIALIZABLE` where the outcome moves a ledger term, `READ COMMITTED` where it moves
none. The level is asserted at the connection before the first balance lock.

**Why not SERIALIZABLE everywhere.** `25 §10.1` requires the PRESUME row to be in a "serializable
local transaction" and `33 §6` scopes the requirement to the exposure ledger, "the only table with a
serialisable-isolation requirement". The accepted S1J outcome transaction is `READ COMMITTED` for a
stated reason: "at `REPEATABLE READ` the loser of a race would raise `40001` instead of reading the
committed prior outcome, which converts a determinate answer into a retryable error." A branch that
moves no ledger term has no write skew to prevent, and a determinate `alreadyResolved` is worth more
than an isolation level it does not need.

**The pre-read that chooses it reads only immutable rows** — `effect.recoverability`, under
`acos_append_only` — and decides nothing about authority. The policy is recomputed inside the
transaction, under the outbox row lock, from a second authoritative read.

---

## S1J-C12 — `reservation_window_instance` is append-only against UPDATE

**Decision.** `0013` adds a trigger refusing `UPDATE` to `reservation_window_instance`. `DELETE` is
not refused.

**Why the asymmetry.** The table is now `I20`'s ACOS-side denominator, and a denominator a later
statement can **raise** is a denominator an attacker can raise — so the rewrite is refused. Deletion
lowers the denominator, which tightens `I20`'s bound and therefore fails in the safe direction; it is
also already constrained by the append-only `effect` and `authorisation` rows the evidence joins to,
and by the accepted fixtures' need to reset a database between attempts.

**Recorded rather than glossed:** a stronger rule (refusing `DELETE` as well) is available and was
not taken, because it would have made the accepted negative-control fixtures unable to reset without
disabling a trigger — and a control that disables the very trigger under test proves less than one
that does not need to.

---

## Carried forward unchanged from the accepted S1J

`S1J-C3` (the append-only effect row does not mutate through the outcome lifecycle) is **confirmed
still aligned** and required no work: `25 §7.1` declares that "the post-dispatch status is carried by
the outcome row", and `outcomeTransaction.ts` writes no `effect` row on any branch.

`S1J-C1` and `S1J-C2` are **closed by v1.3.5** (MIE-01 and OBX-04 respectively) and are no longer
open points. `S1J-C4` is closed by OBX-04's recoverability qualification; `S1J-C5` was closed at
v1.3.4; `S1J-C6` is closed by SER-01.
