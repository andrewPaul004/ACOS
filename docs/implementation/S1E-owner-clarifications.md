# S1E — Owner Clarifications

Decisions S1E had to make that the architecture does not settle, recorded as implementation
fixtures or interpretations rather than presented as readings of `docs/architecture/v1.3.1/`.

The discipline is S1B's, quoted from S1B-C3a: *"An implementation may not invent an economic
rule because the rule reproduces a fixture."* Generalised here: an implementation may not
present a choice as architecture.

---

## Owner disposition register

Recorded in the owner-resolution pass of 2026-09-07, on top of the S1E implementation commit
`e1b7a7f`. The four columns are kept distinct deliberately, because conflating them is how an
implementation choice becomes an architecture claim.

| Item | Architecture requirement | Owner clarification | Implementation choice | Deferred textual architecture cleanup |
|---|---|---|---|---|
| **S1E-C4** | `26 §3` rule 2 and `26 §4` v1.2: a delegation and a grant "can only **narrow**". `26 §7` step I: "matching grant exists after subset intersection" | **ACCEPTED — INTERSECTION.** The permissive/union reading is REJECTED. Adding a matching grant must never widen | Per-dimension narrowest bound; `window_refs` by UNION; the union reading retained as a negative control | Yes — `26 §4` does not print the per-action composition rule; a later maintenance pass should state it |
| **S1E-C2** | `24 §5`'s grade table and `24 §6`'s six `writer_kind` members | **ACCEPTED FOR S1.** A trusted `KERNEL_SERVICE` writer plus an immutable kernel-owned discriminator, on five conditions, all met | `derivation_spec` and `decision_authority` columns; `grade` a GENERATED column | Yes — `24 §5` against `24 §6` is a TEXTUAL discrepancy, deferred |
| **S1E-C3** | `26 §4` prints `resource_selector { type, predicate }` and no syntax | **ACCEPTED S1 SUBSET**, fail-closed; NOT declared universal or permanent | `ANY`, `RESOURCE_REF_EQ:`, `RESOURCE_ID_PREFIX:`; anything else HALTS | Yes — a future form requires an explicit catalogue/architecture decision first |
| **S1E-C6** | `26 §3`'s `OWNER \| KERNEL_SERVICE \| AI_ROLE \| ADAPTER \| AUDIT_REVIEWER` | **ACCEPTED.** The correction stands; the finding is RESOLVED | S1B's three-member union replaced by the declared five | None |

**`docs/architecture/v1.3.1/` was NOT modified by this pass**, and none of the four
dispositions required a production change.

---

## S1E-C1 — the declared `refund.create` precondition — FIXTURE

**The gap.** `26 §7` step G requires the engine to "fetch preconditions from state store" and
`26 §4` types a grant's `conditions` as "predicate over RECORD/OBSERVATION/DECISION_OWNER-grade
state". Neither passage enumerates which preconditions `refund.create` declares. `24 §15`'s
worked contradiction case is the nearest thing: *"a refund proceeding on the commerce
projection while a conflicting processor record is open."*

**The choice.** S1E declares exactly one precondition for `refund.create`:

```
precondition_key  order_payment_settled
subject_template  {resource_ref}
predicate         payment_settled
required_value    true
```

seeded per order at PARSER writer kind (therefore RECORD grade) with `max_age = 86400s` and
`staleness_policy = BLOCK`.

**Status.** An S1E implementation fixture, chosen because it is the one `24 §15` names. It is
not an architecture claim about what a production refund requires. The MECHANISM — the list
is kernel-owned, the subject is templated from the KERNEL-RESOLVED resource, and the proposer
has no field through which to name, supply or suppress a precondition — is the property under
test; the row's contents are the fixture.

---

## S1E-C2 — the Metric Layer and the Decision Registry inside `24 §6`'s six writer kinds — OWNER CLARIFICATION, ACCEPTED FOR S1

**The conflict, stated precisely.** `24 §5`'s grade table names the **Metric Layer** as
OBSERVATION's writer and the **Decision Registry** as the writer of `DECISION_OWNER` and
`DECISION_DELEGATED`. `24 §6`'s provenance block declares
`writer_kind // TRANSPORT | PARSER | KERNEL_SERVICE | MODEL | OWNER | PROMOTER` — which has
no member for either.

**Is it a normative conflict requiring a STOP?** No, and the reasoning is recorded because
the mandate requires the distinction. Nothing about authority, money, principal identity,
grants, evidence grade, contradiction, locking, audit or execution eligibility is ambiguous:
the two passages agree about WHICH grade each component may write. What is undeclared is only
how the writer is REPRESENTED in the provenance block, and a conservative implementation
exists that changes no behaviour.

**The choice.** Both are represented as the `KERNEL_SERVICE` writers they are — `24 §3` K12
(Metric Layer) and K9 (Decision & Approval Registry) are kernel capabilities — discriminated
by two further kernel-owned columns:

| Columns | Derived grade |
|---|---|
| `writer_kind = KERNEL_SERVICE`, `derivation_spec` set | `OBSERVATION` (`24 §5`: "Computed, with a named spec and lineage") |
| `writer_kind = KERNEL_SERVICE`, `decision_authority = OWNER` | `DECISION_OWNER` |
| `writer_kind = KERNEL_SERVICE`, `decision_authority = DELEGATED` | `DECISION_DELEGATED` |
| `writer_kind = KERNEL_SERVICE`, neither | `RECORD` |

**Why not add two enum members.** Because `24 §6` prints six and inventing a seventh and
eighth would be an architecture edit performed in a migration. The alternative reading —
representing them as MODEL writers — is refused outright: it would make MOA-10 reachable, and
the schema's `state_fact_model_writes_no_decision` CHECK forbids it.

**OWNER CLARIFICATION — ACCEPTED FOR S1; TEXTUAL ARCHITECTURE CLEANUP DEFERRED**
(owner-resolution pass, 2026-09-07). The representation above is accepted for S1. The
`24 §5` / `24 §6` discrepancy is ruled a TEXTUAL architecture issue rather than a behavioural
redesign; a wording amendment to `24 §6` naming the two components would close it, and
v1.3.1 is not edited now.

**The five conditions of the acceptance, and where each holds as committed at `e1b7a7f`:**

| Condition | Where it holds |
|---|---|
| The discriminator is established by kernel/trusted code | `state_fact` has NO writer anywhere in `src/`. `src/kernel/authority/preconditions.ts:149` holds the single `FROM state_fact` in the tree, and it is a SELECT. Rows are kernel/migration/fixture-seeded |
| It cannot be supplied or overridden by the model/caller | `ProposedIntent` carries no writer, grade, provenance or discriminator field, and `tests/type-negative/authority-operand-supplied.ts` makes an attempt to add one a COMPILE failure |
| Evidence grade derives from trusted writer identity | `grade` is `GENERATED ALWAYS AS (…) STORED` over `writer_kind`, `promoter_rule`, `derivation_spec` and `decision_authority`. PostgreSQL refuses any INSERT or UPDATE that supplies it |
| Metric Layer and Decision Registry stay distinguishable | `derivation_spec IS NOT NULL` derives OBSERVATION; `decision_authority` derives `DECISION_OWNER` or `DECISION_DELEGATED`. The three remain separately derivable from the row |
| No generic `KERNEL_SERVICE` caller can claim either identity merely by supplying metadata | There is no caller write path at all; and `state_fact_model_writes_no_decision` and `state_fact_model_invokes_no_promoter` refuse the MODEL routes at the schema |

**No production change was required by this ruling.**

---

## S1E-C3 — the grant resource-predicate language is CLOSED — OWNER CLARIFICATION, ACCEPTED S1 SUBSET

**The gap.** `26 §4` prints `resource_selector { type, predicate }` and specifies no syntax
for `predicate`.

**The choice.** Three forms, parsed by `authority/resourceSelector.ts` and nowhere else:

```
ANY                          every resource of the declared type
RESOURCE_REF_EQ:<ref>        exactly one resource, by the KERNEL-RESOLVED ref
RESOURCE_ID_PREFIX:<prefix>  a declared prefix of the KERNEL-RESOLVED resource id
```

An unrecognised predicate is an `AuthorityDefect`, not a non-match. A grant nobody can parse
must halt rather than silently failing to select: a silent non-match is an availability
failure that reads as a security success, and the next engineer "fixes" it by loosening
something.

**Why not a general expression language.** `26 §2.3`: "The engine reads no prose." An
interpreter over a string column on the money path is worse than prose, because its inputs
are rows and rows are what a compromised adapter writes (`24 §10` case 6).

**OWNER CLARIFICATION — ACCEPTED S1 SUBSET; FUTURE EXTENSION REQUIRES EXPLICIT DESIGN**
(owner-resolution pass, 2026-09-07). The closed three-form language is accepted for S1 on five
conditions, each of which `src/kernel/authority/resourceSelector.ts` meets as committed at
`e1b7a7f`: only the three declared forms parse; an unknown or malformed form raises an
`AuthorityDefect` and HALTS rather than returning a non-match; there is no generic expression
evaluator; there is no caller-controlled SQL, code, regex execution, Cedar expression
injection or arbitrary predicate escape hatch — the file's only operations are `===`,
`startsWith` and `slice` over a KERNEL-RESOLVED ref and id; and an unsupported future selector
form therefore fails closed.

**This ruling does NOT declare the three forms to be ACOS's universal or permanent selector
language.** It is the closed selector subset implemented for current S1 needs. Any future
predicate form requires an explicit catalogue/architecture decision and tests before it
becomes accepted.

**No production change was required by this ruling.**

---

## S1E-C4 — multiple matching grants INTERSECT — **OWNER CLARIFICATION, ACCEPTED**

**The gap, and why it matters.** `26 §7` step I asks "Matching grant exists after subset
intersection?" and `26 §4` v1.2 declares the WINDOW arithmetic in full —
`MAL_monetary(w) = min(w.max_monetary, Σ_g min(…))`, "the sum over grants referencing a
window may exceed the ceiling, and the ceiling binds". It does **not** declare how two
matching grants' PER-ACTION bounds compose: `recoverability_max`, `counterparty_selector`,
`per_action_max`, `evidence_requirements`, `approval_requirement`.

Both readings are expressible and they differ materially:

| Reading | Consequence |
|---|---|
| **Union** (the most permissive matching grant wins) | An owner who adds a broad grant silently erases every narrow restriction they wrote earlier, and nothing reports it |
| **Intersection** (the narrowest bound wins) | A broad grant cannot widen a narrow one; two grants can only ever restrict |

**The conservative choice S1E made.** INTERSECTION, per dimension:

| Dimension | Composition |
|---|---|
| `recoverability_max` | minimum over `REVERSIBLE < COMPENSABLE < IRRECOVERABLE` |
| counterparty `novelty_max` | minimum; a grant declaring NONE is the minimum |
| `per_action_max.monetary` | minimum of the declared ones |
| `evidence_requirements` | strictest: `max(min_sources)`, `min(max_tier)`, `min(max_age_days)` |
| `approval_requirement` | highest tier |
| `window_refs` | **UNION** — `26 §7` step R reserves against EVERY referenced window instance and fails if ANY lacks headroom, so union is the restrictive direction here |

**The governing sentences.** `26 §3` rule 2 — "A delegation can only **narrow**" — and
`26 §4` v1.2 — "a grant may only **narrow**". No passage in `26` endorses widening.

**OWNER CLARIFICATION — ACCEPTED** (owner-resolution pass, 2026-09-07). INTERSECTION is the
ruled semantics. A permissive/union interpretation of per-action authority bounds is
REJECTED. The ruling, normatively:

* the effective authority is the most restrictive authority permitted by ALL simultaneously
  matching grants;
* `per_action_max` uses the narrowest applicable bound;
* recoverability and capability constraints likewise may not become more permissive merely
  because another matching grant exists;
* referenced window sets compose by UNION, and the future step R must constrain and reserve
  against EVERY referenced applicable window as the architecture requires;
* **adding another matching grant must NEVER widen the authority already available to an
  effect.** The composition is intentionally monotonic in the safe direction.

**Conformance as committed at `e1b7a7f`.** `evaluateGrantMatch` in
`src/kernel/authority/grants.ts` already implements exactly this ruling: minimum
recoverability, minimum counterparty novelty with NULL as the floor, minimum declared
`per_action_max.monetary`, `max(min_sources)` / `min(max_tier)` / `min(max_age_days)` for
evidence, the highest approval tier, and a sorted UNION of `window_refs` checked for equality
against the request's. **No production change was required by this ruling.**

**Three grant columns are carried and READ BY NOTHING**, named here so that a later slice
cannot compose them by accident. `standing_required`, `autonomy_key_binding` and
`gate_class_on_permit` are loaded onto `MatchedGrant` and no consumer in `src/` reads them —
the autonomy key is kernel-derived from `26 §13`'s `(task_type, action_class, model_binding,
resource_class)`, not from the grant column. Being unread they confer no authority and cannot
widen anything today. The slice that first reads one must compose it under this same ruling:
`standing_required` composes by OR — required if ANY matching grant requires it — and a gate
class must compose to the strictest.

**The vulnerable control is RETAINED.**
`tests/negative-controls/unsafe-permissive-grant-union.ts` implements the rejected union
reading, and `tests/negative-controls/authority-controls.test.ts` attack 3 shows the two
disagreeing on one fixture end to end. It is kept deliberately as regression evidence that
the rejected reading remains detectable — not as an open question.

**Architecture text.** `docs/architecture/v1.3.1/` is NOT edited by this pass. The ruling is
recorded as an implementation owner clarification, pending a later architecture-text
maintenance pass that may state the per-action composition rule in `26 §4`.

---

## S1E-C5 — the grant's `per_action_max.irrecoverable_units` is NOT stored — INTERPRETATION

**The gap.** `26 §4` prints `per_action_max { monetary?, irrecoverable_units? }`. S1E
evaluates neither at step I — the monetary bound that BINDS is the literal inside the
hash-committed Cedar artifact (`26 §11` P1), and irrecoverable COUNTS bind at step R against
`W_DAY_MIE` and `W_MONTH_MIE` (`51 §2`, `51 §2.2`), which is out of scope.

**The choice.** The monetary half is stored for the audit record and the multi-grant
intersection. The `irrecoverable_units` half is **absent from the schema**, on S1B.1's
precedent for `declaredWindows`: *"rather than leave a field whose only plausible reader is
the wrong one, the field is gone."*

**The second reason, and it is the stronger one.** The accepted S1A assertion in
`tests/integration/exposure/irrecoverable-standing-zero.test.ts` — "EVERY irrecoverable
column in the schema is one of the seven K5 declares" — exists so that a new irrecoverable
quantity cannot be added quietly. S1E honours that assertion rather than widening it.

**Consequence to carry forward.** The slice that implements step R's irrecoverable ledger
must add the column deliberately, and will have to update that accepted list in the same
commit — which is exactly what the assertion is for.

---

## S1E-C6 — `PrincipalKind` corrected to `26 §3`'s declared set — REPAIR

S1B declared `PrincipalKind = 'AGENT' | 'HUMAN' | 'KERNEL_SERVICE'`. `26 §3` declares
`OWNER | KERNEL_SERVICE | AI_ROLE | ADAPTER | AUDIT_REVIEWER`.

While nothing read `kind`, the divergence cost nothing. S1E's step D and `26 §7.1`'s
`KERNEL_SERVICE` branch both key on it, so the union is corrected to the architecture's set.
`AGENT` becomes `AI_ROLE`; `HUMAN` was unused.

**Blast radius.** One type declaration and two test fixture literals. The Cedar schema
declares `kind: String` and no policy reads it, so **no control artifact moves and the policy
digest does not change**. No accepted assertion is weakened.

`ResolvedPrincipal` also gains `modelBinding: string | null`, which `26 §3` declares and
`26 §13`'s autonomy-ledger key requires. It is kernel-resolved from the `principal` row.

**OWNER CLARIFICATION — ACCEPTED** (owner-resolution pass, 2026-09-07). The correction to
`26 §3`'s declared set is accepted and the finding is RESOLVED. The implementation matches the
current architecture text and every accepted regression test remains green, so **no further
production change is required.**

---

## S1E-C7 — no free-text audit note on the outcome record — DESIGN

`PreReservationDenied` carries `(step, code, detail)` and **no `auditNote` string**.

**Why.** The accepted S1B rule in `tests/canonicalisation/worker-facing-denial.test.ts` is
that nothing in `src/` outside the denial types reads `.auditNote`. S1E honours it rather
than adding itself to the exemption list, and the design is better for it: the triple is
closed and enumerable, an audit consumer can render a sentence from it, and a free string on
the money path is a string that can accidentally acquire an amount — the probing oracle
`26 §7` names.

The free-text context still exists on the `AuthorityDenied`, `CanonicalisationDenied` and
`PolicyDeny` values, for the audit-write step a later slice adds. It does not travel on the
outcome record.

`AuthorityDenied` uses TypeScript parameter properties so the class never writes
`this.auditNote`, which is what keeps the accepted rule byte-identical.

---

## S1E-C8 — step P fails closed rather than being omitted — INTERPRETATION

`26 §7`'s `P{Channel set?}` routes a channel-bearing request into `§9`'s utterance policy,
which `37 §2` places in S4 and which S1E does not implement.

`refund.create` sets `channel = null`, so the branch is not taken by any fixture. S1E
implements the gate anyway and **denies** on a non-null channel, because a gate whose
correctness rests on a fixture is a gate one catalogue addition away from being wrong: the
day a channel-bearing class is registered, an omitted step P would run straight to step R with
nothing having evaluated the utterance, and no test would fail.
