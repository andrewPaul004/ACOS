# S1F — Owner Clarifications

Points where the current architecture admitted more than one reading, or where S1F had to
choose something the architecture does not state. Each records the passage, the silence or
the difference, the choice, and what it would take to change it.

**None of these is an architecture amendment.** No file under `docs/architecture/` is
modified by this slice.

> **OWNER RESOLUTION — RECORDED.** All nine items have been dispositioned by the owner.
> The dispositions, the evidence each was checked against, and the two test-only
> conformance additions the review required are in
> [`S1F-owner-resolution.md`](./S1F-owner-resolution.md). No production source file and no
> migration changed in that pass, and no item resolved to DEFECT or to OWNER DECISION
> STILL REQUIRED.

---

## S1F-C1 — the write order of the effect row relative to the reservation row

**OWNER DISPOSITION: `OWNER CLARIFICATION — ACCEPTED`.** The owner accepts the current
logical order: `26 §7` decides gate/denial precedence, `30 §5.1` continues to govern the
single transaction, the lock discipline and the post-`COMMIT` boundary, and the physical
`INSERT` order inside one transaction is not itself an authority rule. No production
change. Recorded in `S1F-owner-resolution.md` §1.

### The two passages

`30 §5.1` item 3, verbatim:

```
BEGIN
  SELECT ... FOR UPDATE on window_balance rows, ascending window_id
  SELECT ... FOR UPDATE on journal_counter(company_id)
  authorisation row
  effect row (status = AUTHORISED)
  reservation row
  state transition
  journal row (journal_seq, local prev_hash/row_hash over ACOS-JCS-1 bytes)
COMMIT
```

`26 §7` load-bearing property 8, verbatim:

> Idempotency check happens after reservation and before permit (steps T–V), so a duplicate
> proposal returns the prior result **and the reservation is released** rather than
> double-counted.

### The difference

`30 §5.1` writes the effect row — which carries the idempotency key and therefore `I42`'s
unique constraint — BEFORE the reservation row. `26 §7` puts step R before steps T–V, and
its stated consequence is a *released* reservation, which is only reachable if the
reservation was taken before the duplicate was detected.

### Why it is not a mechanism conflict

Both passages describe ONE transaction with ONE commit point. Under atomicity the
intermediate write order is unobservable in every respect but one: which condition
determines the outcome when a proposal is **both** a duplicate **and** short of headroom.

### The resolution taken

The GATE order is `26 §7`'s — reserve, then check the key. The LOCK order and the single
commit point are `30 §5.2`'s and `30 §5.1`'s, honoured exactly. The divergence is confined
to the position of one `INSERT`.

`26 §7` is the more specific statement: it decides the joint case explicitly and gives its
reason, and it is the sequence specification an implementer reads first. `30 §5.1`'s list
appears inside a section whose subject is the lock order and the single commit point.

### What would change it

An owner ruling that a duplicate should be reported in preference to a window denial. The
observable consequence is asserted directly rather than left implicit, so the ruling has
exactly one test to move:
`tests/integration/authority/local-idempotency.test.ts` — *"R PRECEDES T — a duplicate that
ALSO lacks headroom denies WINDOW_EXHAUSTED"*.

---

## S1F-C2 — what "the resulting state transition" is at the local authorisation boundary

**OWNER DISPOSITION: `OWNER CLARIFICATION — ACCEPTED`, classification B — MINIMAL
REPRESENTATION.** The architecture requires a resulting transition atomically but does not
prescribe its storage representation; S1F records the minimum non-authority-widening local
state that represents the committed decision, in the column `30 §5.1` already names. No new
business or authority transition was invented, so it is not classification C. Full field-by-
field statement, including the kill-point evidence and every "does it change X" answer, in
`S1F-owner-resolution.md` §2. No production change.

### The passage

`33 §1`: *"The exposure reservation, the authorisation decision, the effect journal row with
its gap-free sequence and local chain hash, and **the resulting state transition** commit or
fail together."*

`30 §5.1`'s ordering block lists *"effect row (status = AUTHORISED)"* and *"state
transition"* as SEPARATE lines.

### The silence

Neither passage says what state transitions at authorisation time. The candidates are the
effect row's own lifecycle status, a `state_fact` append, and a `25 §5` work-item transition.

### The reading taken

**The effect row's `status = AUTHORISED` is the local authoritative state transition S1F can
commit.** `30 §5.1` names exactly that, in as many words, on the line before "state
transition".

A commerce-state or work-item transition is a consequence of DISPATCH — the external world
agreeing that something happened — and `30 §5.1`'s own ordering places dispatch AFTER
`COMMIT`. At the S1F boundary nothing has been dispatched, so there is no resulting external
state to record, and inventing a row for one would be recording a belief the system has no
basis for.

### What S1F does NOT do

It does not write a `state_fact`. `24 §5`'s grade is GENERATED from the writer identity and
`33 §6` makes `state_facts` append-only with correction by supersession; a fact asserting
"this effect was authorised" would be a K1 belief about a K4 event, and `24 §9`'s systems-of-
record table assigns effect status to K4.

It does not introduce a separate `effect_status_transition` table either. The S1F mandate is
explicit: *"Do NOT invent record types if existing architecture uses different names."* The
effect row's status column is the existing name.

### What would change it

An owner ruling that the authorisation transaction must also append a `state_fact` or
transition a work item. Both would be additive: a new row inside the same transaction, and
the kill-point matrix would extend by one point.

---

## S1F-C3 — the rate class reaches step R without traversing C′

**OWNER DISPOSITION: `RATE C′ BOUNDARY — TEST SEAM ONLY / SAFE`.** Accepted as a bounded
test/internal step-R seam, on the verified condition that it creates no production authority
bypass. The negative proof the owner required — a fabricated rate proposal through the most
public production-reachable S1F API, refused at C′, with zero rows in all eleven tables and
no headroom moved — was ADDED by the resolution pass and is in
`tests/integration/authority/rate-class-local-authorisation.test.ts`. The primitive's single
gated caller is asserted in `local-authorisation-boundary.test.ts`. `campaign.budget.set`
remains NOT CANONICALISABLE on the worker path and its constructor remains OPEN. Full
statement in `S1F-owner-resolution.md` §3. No production change.

`campaign.budget.set` IS in the closed catalogue (`actionCatalogue.ts`, `rateBased: true`)
and has NO registered constructor. `26 §7` step C2 therefore denies it
`NOT_CANONICALISABLE`, and building a constructor for it means a per-class commerce state
model, a per-class live enumerator and a per-class `semantic_option_digest` — canonicaliser
work for a class, excluded by the S1F mandate.

So the rate branch reaches step R with a KERNEL-SUPPLIED exposure block, exactly as accepted
`VC-S7` does.

**What is therefore proven:** that the zero-amount reservation, the `StandingAuthorization`,
its `StandingRevocationAuthority`, the `standing_window_exposure` rows, the effect, the
signed decision and the journal row commit or fail TOGETHER, and that the first rate
authorisation in a clean January window PERMITS through the S1F transaction.

**What is therefore NOT proven:** that a rate class traverses C′, that its `option_id` is
content-addressed against a live enumeration, or that its exposure block is computed by a
versioned constructor.

---

## S1F-C4 — `I60`'s partial index is structurally redundant, and is installed as declared

**OWNER DISPOSITION: `IMPLEMENTATION DETAIL — NON-SEMANTIC`. `OWNER CLARIFICATION —
ACCEPTED; I60 REMAINS PARTIAL`.** No new transition, no widened approval authority, and the
transition-state enforcement stays deferred. `S1F-owner-resolution.md` §4.

`26 §12.2`: *"`RESUMING` carries a unique partial index on `(approval_id)` (I60), so a
second resume cannot start."*

With `approval_id` as the `approval` table's primary key, a unique index on `(approval_id)`
— partial or not — is trivially satisfied. Two readings were available: install it as
declared, or infer what it "should" have keyed on so that it would actually constrain a
second resume.

**Installed as declared.** Inferring the intended key would be designing the resume path,
which is deferred with everything else about resume. The index is the shape `I60` names, so
if a later slice gives a resume its own row the constraint is already in place.

Recorded in the migration comment and asserted in
`tests/integration/authority/local-authorisation-boundary.test.ts` so the redundancy is a
stated fact rather than something a reader has to notice.

---

## S1F-C5 — append-only is enforced by a trigger, not by a withheld GRANT

**OWNER DISPOSITION: `IMPLEMENTATION DETAIL — NON-SEMANTIC`.** Accepted as the S1 local
enforcement MECHANISM, not as an architecture amendment. It claims no audit-plane
independence and no `VC-A3`/`I41`. `S1F-owner-resolution.md` §5.

`33 §6` requires append-only tables to have *"no `UPDATE` or `DELETE` grant for any
application role"*.

S1 runs as one database role, and `33 §6` is itself explicit that per-module roles *"are not
isolation against compromised in-process code"*, that `effect_path` spans every schema the
authorisation transaction touches, and that it is *"declared the privileged path"*. There is
no second role to withhold the grant from.

A trigger is the substitute that actually refuses the write in this deployment — and it
refuses it for the privileged role too, which a grant to a single role could not. `33 §6`'s
mechanism becomes available when there are two roles; the property it exists to guarantee is
enforced now.

`effect_journal` is the one exception, and it is the architecture's own: `30 §5.2` requires
`mirrored_at` to be settable *"on first successful acknowledgement"* and calls it *"advisory
only"*. Its trigger permits exactly that column and refuses every other change and every
`DELETE`.

---

## S1F-C6 — `24 §3.1`'s "on the database clock" is still the injected kernel clock

**OWNER DISPOSITION: `DEFERRED RESIDUAL`. The `24 §3.1` database-clock residual remains
OPEN.** The current conservative use is accepted for S1F; no new external clock mechanism is
invented. The exact timestamp source for window-instance derivation, reservation
creation/expiry, approval timestamps and standing-authorisation timestamps is tabulated in
`S1F-owner-resolution.md` §6. No production change.

**Unchanged from S1A. Restated because S1F is the first slice where the instant decides a
COMMITTED window instance on the live authority path.**

`24 §3.1`: a window instance is *"keyed by `window_instance_key` […] evaluated in the company
timezone **on the database clock**."*

`phase2-v1.3-implementation-brief.md §3` excludes *"any live clock — `I56`'s schema is S1;
live clocks are S5"*, and the accepted S1A `windowInstance.ts` states the same rule.

**What IS read from the database:** the COMPANY TIMEZONE (`company.timezone`) and the WINDOW
PERIOD (`window_registry.period`). Those are the two operands that decide which instance a
commitment lands in, and neither is caller-supplied.

**What is NOT read from the database:** the instant. It comes from the kernel-owned injected
`Clock`, the same one S1C, S1D and S1E were built and verified against. Reading `now()`
instead would create a second time source alongside it.

**The residual:** in production the injected clock is `systemClock`, i.e. the control
plane's wall clock rather than PostgreSQL's. The two can differ. Closing it means either a
`SELECT now()` read on the money path or a declared clock-skew bound, and both are S5's
`I56` work.

**What is NOT at risk:** there is no `windowInstance` parameter anywhere on the S1F boundary,
so no caller and no model can choose the instance its commitment lands in.

---

## S1F-C7 — the `ACOS-JCS-1` null question did NOT need reopening

**OWNER DISPOSITION: `OWNER CLARIFICATION — ACCEPTED`. S1F uses the existing specification;
it does not close `VC-A3`.** No representation was invented. The generic `VC-A3`
representation obligation — cross-instance re-chaining, proof over structured fields, null
versus empty at both independent implementations, and any generic nullable `bytes` / JSON
literal-null integration issue — stays OPEN until the dedicated audit validation slice.
`S1F-owner-resolution.md` §7.

**Recorded because the S1F mandate asks explicitly whether it did.**

The mandate: *"Before introducing any NEW generic nullable-`bytes` / JSON literal-null
encoding, inspect the recorded open obligation. If S1F cannot correctly write the
architecture-required local journal record without resolving a genuinely unspecified
`ACOS-JCS-1` null representation: STOP THAT PART AND RETURN PARTIAL."*

**It was not necessary, and nothing was invented.**

`30 §5.3` already declares the rule: *"Single `0x00` sentinel byte for null; an empty string
is a zero-length value."* Owner clarification **S1B-C8** already closed the injectivity gap
that made it ambiguous — ACOS canonical text admits only well-formed Unicode scalar sequences
containing no `U+0000`, so no accepted text can imitate the sentinel. On the SQL side the
exclusion is structural: PostgreSQL `text` cannot store `U+0000` at all.

The journal row kind's nullable columns are `approval_id` (text), `vendor_amount` and
`forward_integral` (money). All three are covered by the existing rule.

**No JSON-valued column was put in the journal row kind, deliberately.** `30 §5.3`'s JSON
rule is RFC 8785, and RFC 8785 in PL/pgSQL would be a second canonicaliser for the hardest of
the seven hazards. Every field of the row kind is text, integer, boolean, money, timestamp or
bytes, so the rule is not exercised and no SQL-side JCS implementation exists.

**`ACOS-JCS-1` remains an open obligation for `VC-A3`**, which is cross-INSTANCE byte
identity and needs a second independent implementation — the audit store's own trigger. S1F
builds the control trigger only and claims nothing about VC-A3.

---

## S1F-C8 — the money-path modules are not in `src/kernel/authority/`

**OWNER DISPOSITION: `IMPLEMENTATION DETAIL — NON-SEMANTIC`.** No authority surface changed:
no model-facing export, no worker-facing authority field, no alternate Cedar route, no
alternate DB credential or path around the effect-path discipline, and no test helper
imported into production. `S1F-owner-resolution.md` §8.

The accepted `tests/authority/authority-channel-attacks.test.ts` asserts that the authority
tree contains no `window_balance`, `exposure_reservation`, `FOR UPDATE`, `INSERT INTO` or
`UPDATE `. That assertion is correct — `src/kernel/authority/` is `24 §3` K3, the gates — and
it is not weakened.

S1F's transaction is K4 and K5 work: the Effect Gateway's journal and the Exposure Ledger's
reservation. It lives in a new `src/kernel/authorisation/` module.

`authority/preReservation.ts` gains one method that composes the two. It carries no money-path
token, opens no transaction and takes no lock.

**And the accepted step table was not extended.** The same accepted suite asserts *"there is
no step R, S, T, U, V, W or X in the declared sequence"* — the S1E boundary as a property of
the table itself. `AUTHORITY_STEPS` remains the pre-reservation sequence; S1F declares
`LOCAL_AUTHORISATION_STEPS` separately, and the boundary suite asserts the two are disjoint
and that their concatenation is `26 §7`'s whole flowchart.

---

## S1F-C9 — accepted-test lists widened by exactly one entry each

**OWNER DISPOSITION: `IMPLEMENTATION DETAIL — NON-SEMANTIC`.** Strictly additive: every
previously enumerated fixture remains, the new file exists because S1F legitimately added a
new negative fixture, no previous negative source rule stopped executing, and the exact
allowlist is still an exact allowlist. `S1F-owner-resolution.md` §9.

Two accepted tests pin CARDINALITIES that any new fixture necessarily changes. Both were
widened following the precedent S1D and S1E set — with the reason stated in the list — and no
assertion was relaxed:

| Accepted test | Change | Why it is not a weakening |
|---|---|---|
| `tests/canonicalisation/i21-type-boundary.test.ts` — *"the fixture directory contains a positive control and fourteen negative files"* | fourteen → fifteen, with `local-authorisation-as-dispatchable.ts` added in sorted position | the assertion's purpose is that the directory is EXACTLY the declared set; it stays exact. The harness's discriminating properties — the positive control compiles clean, no diagnostic on an unmarked line — now cover the new file too |
| `tests/authority/authority-type-boundary.test.ts` | a new `describe` block owning the new fixture's expected diagnostics | additive. Every existing block is untouched, and the new one names each missing field individually so a future result type that acquired one fails there |

Two accepted SOURCE-RULE greps also flagged prose in migration `0007`, and in both cases the
COMMENT was reworded rather than the rule relaxed:

* `tests/canonicalisation/source-rules.test.ts` — *"no other file in `src/` references
  rationale at all"*. The schema comment naming the field `intent_hash` commits to was
  rewritten to describe it without using the reserved word. The rule's exemption list is
  unchanged.
* `tests/canonicalisation/constructor-version.test.ts` — *"no S1B code path emits
  `CONSTRUCTOR_SEMANTIC_CHANGE`"*. The comment listing the deferred resume denials now names
  them by their section reference. No code path emits it, which is what the rule is for.
