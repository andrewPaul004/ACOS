# S1E — Owner Clarifications

Decisions S1E had to make that the architecture does not settle, recorded as implementation
fixtures or interpretations rather than presented as readings of `docs/architecture/v1.3.1/`.

The discipline is S1B's, quoted from S1B-C3a: *"An implementation may not invent an economic
rule because the rule reproduces a fixture."* Generalised here: an implementation may not
present a choice as architecture.

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

## S1E-C2 — the Metric Layer and the Decision Registry inside `24 §6`'s six writer kinds — INTERPRETATION

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

**Owner decision required?** A wording amendment to `24 §6` naming the two components would
close it. No behaviour depends on the answer.

---

## S1E-C3 — the grant resource-predicate language is CLOSED — FIXTURE

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

---

## S1E-C4 — multiple matching grants INTERSECT — **OWNER DISPOSITION REQUIRED**

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

**Owner decision required.** If the intended semantics are additive — that two grants confer
the union of their per-action authority — this is a behavioural difference and should be
directed rather than inferred. S1E's negative control
`tests/negative-controls/unsafe-permissive-grant-union.ts` implements the union reading and
`tests/negative-controls/authority-controls.test.ts` attack 3 shows the two disagreeing on one
fixture, so the consequence of either choice is visible and measured.

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
