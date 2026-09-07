# S1D — owner clarifications

Every judgement S1D made that the architecture does not decide outright, sorted by what kind
of claim it is. The categories are deliberate: **an implementation choice must never be read
as an architecture claim.**

| Category | Meaning |
|---|---|
| **A — architecture-mandated** | The architecture decides it. S1D transcribed it. No latitude was taken. |
| **F — fixture / control decision** | A concrete value or artifact S1D had to choose so a test could exist. Not a production commitment. |
| **I — implementation choice** | A construction the architecture permits but does not specify. Reversible without an architecture change. |
| **O — open obligation** | Something S1D deliberately did not do, with the reason and the normative basis. |

---

## A — architecture-mandated

### S1D-A1 · the per-action limit is $25.00, and the operand is `total_exposure`

`51 §3.1`, verbatim row: `| refund.create | **$25.00** | 2 | **10** |
INBOUND_ORIGINAL_INSTRUMENT | COMPENSABLE | EXACT |`, and immediately below it: *"
`per_action_max.monetary` is compared against **`exposure.total_exposure`**, not
`exposure.vendor_amount` (SR-C1, `26 §8`)."*

**S1D invented no quantity.** The figure appears in exactly one place in the tree — the
hash-committed Cedar policy text — and `tests/policy/source-rules-s1d.test.ts` rule 2 asserts it
appears in no TypeScript source anywhere under `src/`.

### S1D-A2 · the comparison is `<=`, so at the limit permits

`26 §8`: `context.exposure.total_exposure <= 25.00`. `26 §11.2` row 3: *"Bounded by
`total_exposure ≤ $25.00`"*. Two independent statements, both `<=`. Verified rather than
assumed, and the `$25.00` boundary case is the test that discriminates the two readings.

### S1D-A3 · the two denial terminals are `26 §7`'s own

`PER_ACTION` is `D11` at step M; `NO_GRANT` is `D7` at step I. **No denial code was invented.**
`36 §3` is explicit that an unpolicied class is *"a deny by default (SR7) — correct, but
silently so"*, which is why `NO_GRANT` is the right terminal for "no policy path admitted
this" and why the gap-analysis suite exists to remove the silence.

### S1D-A4 · every decision records `policy_version` and `constructor_version`

`26 §11`, verbatim: *"Every `AuthorizationDecision` records `policy_version` **and
`constructor_version`** […] same inputs, same `policy_version`, same `constructor_version`,
same verdict, forever."* Both are on `PolicyDecisionLineage`, on permits and denials alike.

### S1D-A5 · the policy set is a control artifact

`50 §2` class 2: *"**Policy set** (Cedar source + compiled artifact) | ✔ | Owner, second
factor | All effects"*. `50 §3`'s I19 mechanism halts on a content-hash mismatch. S1D
computes the content hash and fails closed on missing / unexpected / duplicate / malformed.
The **signature** half is open — see S1D-O4.

### S1D-A6 · `role` belongs on the principal

`26 §3`'s printed record carries `role` explicitly: *"role, // e.g. ceo, support_reasoner,
market_researcher"*, and `26 §8` reads it as `principal in Role::"support_reasoner"`. S1B's
`ResolvedPrincipal` simply had no use for it yet. Adding it is a transcription, not a design
choice — and it is **required, not optional**, so an absent role cannot default.

---

## F — fixture / control decisions

### S1D-F1 · `ApprovedReasons` is every member of S1B's closed reason-code fixture

`26 §8` reads `context.reason_code in ApprovedReasons` and **never enumerates the set**. S1B
declared the closed `reason_code` enum as a fixture under clarification S1B-C6 and recorded
it as one. `ApprovedReasons` is the approved subset of that fixture enum, and the architecture
gives no grounds for excluding any member.

**So all five are approved.** Inventing an exclusion in order to have a smaller set would have
been an invented policy quantity — the exact thing the S1D mandate forbids — and the
alternative, an empty set, would have made the class unreachable and failed `26 §11` P6.

The set lives as a literal **inside the hash-committed policy artifact** rather than in code or in an
entity store built at request time, so a caller has no position from which to supply a
different one.

*This is a fixture decision resting on an S1B fixture decision. It is not a claim that this
is the production approved-reason taxonomy.* Selecting that belongs to the grant slice.

### S1D-F2 · the VC-C1 end-to-end order rows

`tests/integration/policy/vc-c1-end-to-end.test.ts` inserts an order whose line and parent
transaction each have `$25.00` refundable remaining and whose authoritative retained fee is
`$1.03`, so the enumeration's `min(line, transaction)` yields exactly the architecture's
`$25.00` and the constructor adds exactly its `$1.03`.

**The accepted S1C `loadCommerceFixture` was deliberately not extended**, because accepted
tests assert cardinalities over the orders it loads.

No fee rate, percentage or rounding rule exists anywhere in the S1D tree — S1B-C3a's rule is
unchanged and `tests/canonicalisation/source-rules.test.ts` rule 5 still enforces it.

### S1D-F3 · the vulnerable negative control binds `vendor_amount`

`tests/negative-controls/unsafe-vendor-amount-policy.ts` is a full second request builder
differing from production in one expression. It is test-only, imported by nothing under
`src/`, and asserted to be so.

**Production was not weakened to accommodate it.** Nothing was made overridable and no seam
was opened; the cost is a duplicated builder, and that cost is the point — a design that made
the operand configurable would have been easier to test and worse.

---

## I — implementation choices

### S1D-I1 · the per-action cap is expressed as a `forbid`, not only as a `when` conjunct

`26 §8` writes the cap inside the `permit`'s `when`. `26 §11` P1 states the stronger property:
*"**No policy path permits** `refund.create` whose `exposure.total_exposure` exceeds the
configured per-action cap."*

A `when` conjunct in one permit cannot carry P1 — a second permit added later for another
role would satisfy P1's negation without touching that file. In Cedar a `forbid` is the only
construct that holds regardless of what permits exist, so P1 is expressed as one.

**Both are deployed.** `26 §8`'s conjunct is transcribed verbatim into the grant AND the cap
is a `forbid`. The duplication is deliberate and has a tripwire:
`tests/policy/policy-artifacts.test.ts` asserts both carry the same `51 §3.1` figure and that
no other decimal literal is used as a cap anywhere in the set.

The `forbid` is also what makes the denial **attributable**: Cedar's `diagnostics.reason`
names it, so `PER_ACTION` is decided by which policy fired and **never by re-reading an
amount**. `denialCategory.ts` has no access to any monetary value.

*The architecture calls its `§8` sketches "Cedar-like syntax for concreteness, not as a
commitment (DP3)", so this is a rendering choice within a permitted latitude.*

### S1D-I2 · Cedar's `decimal` extension carries the money

`money.ts` holds a bigint of minor units at `SCALE = 2`; `toDb` renders at exactly that scale;
Cedar's `decimal` carries four places. The round trip is lossless and the comparison is exact
fixed-point. **No `number` exists anywhere on the policy path.**

The alternative — comparing raw minor-unit `Long`s — would have worked equally exactly but
would have made the policy text read `<= 2500`, which is not the figure `51 §3.1` prints.

### S1D-I3 · `in` is rendered as `.contains()` for value sets

`26 §8` writes both `context.reason_code in ApprovedReasons` and
`context.customer_novelty in [NEW, RETURNING]`. Cedar reserves `in` for entity hierarchy and
uses `.contains()` for value sets. The **principal** clause does use entity `in`, exactly as
`26 §8` writes it, because the role genuinely is a hierarchy edge.

### S1D-I4 · a `PolicyEvaluationDefect` is thrown, never returned

A malformed artifact, a rejected request, a Cedar evaluation error, an unregistered class or
an absent authoritative operand are **control-plane defects, not denials**. This follows the
accepted S1C asymmetry in `enumeration/workerFacingDenial.ts` verbatim rather than inventing
a rule, and `50 §3`'s I19 mechanism halts on a control-artifact mismatch rather than
returning a business outcome.

The property that matters — no defect path can produce `PERMIT` — is asserted case by case in
`tests/policy/fail-closed.test.ts`.

### S1D-I5 · `AuthorisationPipeline` binds C′ and step M into one call

TypeScript's `readonly` prevents post-C′ mutation at compile time and prevents nothing at
runtime. Rather than document that gap, S1D removes it: the canonical effect never becomes a
caller-visible value before the decision is taken. It is returned **with** the decision,
afterwards.

### S1D-I6 · `resource.exists` is `true` because a `ResolvedResource` exists

`26 §8` reads `resource.exists`. A `ResolvedResource` is produced only by a successful
authoritative resolution — S1C's C′ denies `SELECTOR_STALE` when *"the resource no longer
resolves to enumerable RECORD-grade state"* — so existence is **entailed by the presence of
the record**, and the entailment is proven by execution in the end-to-end suite.

S1D deliberately did **not** add an `exists` field to `ResolvedResource`: a field nothing can
currently set to `false` reads as a check and performs none. A later slice that can present
an unresolved resource to policy must add it.

### S1D-I7 · the `Acos::Role` entity carries no attributes, and its absence is immaterial

Recorded as a finding rather than asserted away.
`tests/policy/fail-closed.test.ts` shows that dropping the standalone role entity does **not**
change any decision, because `26 §3` makes the role a parent edge and Cedar reads that edge
off the principal entity. Dropping the **principal**, or stripping its parent, does fail
closed. If a role entity ever acquires an attribute a policy reads, that test must change
with it — which is why it exists.

---

## O — open obligations

### S1D-O1 · the four window-headroom terms of `26 §8` are NOT implemented

`26 §8`'s worked refund policy carries four terms S1D does not evaluate:

```
exposure.window("W_DAY_REFUND").count_headroom > 0 &&
exposure.window("W_MONTH_REFUND").count_headroom > 0 &&
exposure.window("W_DAY_REFUND").monetary_headroom   >= context.exposure.total_exposure &&
exposure.window("W_MONTH_REFUND").monetary_headroom >= context.exposure.total_exposure
```

**Why not.** `26 §7` places window headroom at **step R** — *"R — any window lacks headroom →
D13 DENY: WINDOW_EXHAUSTED"* — and step R is the reservation, which the S1D mandate excludes
by name. ADR-005's consequences paragraph, verbatim: *"Cedar cannot express everything:
numeric aggregation over time windows lives in the exposure ledger, not in policy"*, and
`36 §4` item 2 repeats it.

**How the omission is made safe.** `acos.cedarschema` declares **no window attribute at all**,
so there is no position in which a fixture-supplied headroom could be presented to Cedar as an
evaluated operand. `tests/policy/source-rules-s1d.test.ts` rule 3 asserts that absence over
the schema and every `.cedar` artifact.

**What a reader must therefore hold.** A `PERMIT` from S1D is a **step-M permit**. It is not
an `AuthorizationDecision` and it authorises no dispatch. `decision.ts` says so in its type
name and at length in its header.

**Note the apparent tension, resolved.** `26 §8` puts the headroom terms in the policy while
ADR-005 puts window aggregation in the ledger. These are consistent: the LEDGER computes
headroom and Cedar compares an already-aggregated figure. S1D implements neither half, and
the reservation slice owns both. **This is not recorded as a normative conflict** — see
`S1D-result.md` question 16.

### S1D-O2 · steps D, E, F, G, H, H′, H″, I, J, K, L, N of `26 §7`

Principal chain and depth, categorical prohibitions, platform status and kill switch,
precondition fetch, grade and freshness, contradiction, delegated grade, grant intersection,
recoverability, counterparty novelty, evidence, autonomy ledger. None is required to prove
VC-C1 and each is its own slice.

### S1D-O3 · the other three catalogue classes have no policy

`campaign.pause`, `fulfilment.reship`, `campaign.budget.set`. The S1D mandate forbids adding
policies for breadth. `36 §3`'s gap analysis is discharged in its second half — the silence is
removed — by `tests/policy/policy-set-gap-analysis.test.ts`, which asserts each fails closed
**by execution**, twice over (no registered construction, and no Cedar action in the schema).

### S1D-O4 · owner signing of the policy artifact

`50 §3`'s manifest row is `{class, artifact_id, version, content_hash, signed_at, signature}`.
S1D computes and binds the **content hash** and builds no key management, because the S1D
mandate forbids inventing signing infrastructure this slice does not already require.

The constructor-signing machinery S1B built (real Ed25519 over declared canonical bytes) is
the obvious model when the manifest slice lands.

### S1D-O5 · `I19` as a continuous runtime check

S1D fails closed at **load**. `50 §3` also specifies a continuous recompute-and-compare
against the manifest, with the halt scope for class 2 being *"All effects"*. There is no
manifest and no scheduler in S1, so the continuous half is open.

### S1D-O6 · symcc, P1–P8 as proofs

Deferred by `22` DP3 and `45 §3`, recorded as an `11 E6` amendment under `28 §9.2`. S1D
asserts **P1 and P6 as runtime properties** for `refund.create` and proves neither
symbolically. P2, P3, P4, P4a, P5, P5a, P7 and P8 concern classes and mechanisms S1D does not
implement.

### S1D-O7 · denial-ordering within step M

`26 §7` evaluates L (evidence) before M (per-action). When several `26 §8` conjuncts fail at
once, Cedar reports the determining `forbid` and S1D reports `PER_ACTION` — which is correct
for the terminal it names, but is not a proof that the architecture's **step ordering** was
honoured, because S1D implements only one of those steps. Ordering becomes assertable when
the earlier steps exist.

### S1D-O8 · an observation, not a finding — `PrincipalKind`

S1B's `PrincipalKind` is `'AGENT' | 'HUMAN' | 'KERNEL_SERVICE'`; `26 §3` prints
`OWNER | KERNEL_SERVICE | AI_ROLE | ADAPTER | AUDIT_REVIEWER`. This is a **pre-existing S1B
divergence**, not something S1D introduced, and S1D did not change it: `kind` is carried into
the Cedar entity as a declared attribute and no policy reads it, so nothing in S1D depends on
which enumeration is right. Recorded so the reconciliation is not lost.

### S1D-O9 · the S1C wording tension is carried forward, unresolved

S1C recorded a tension between `26 §2.0.1`'s "denies" and `36 §2` VC-C2's "returns an empty
set rather than a denial that leaks existence" for out-of-scope enumeration. Owner disposition
is `NEEDS TEXTUAL RESOLUTION`.

**It is not blocking to S1D.** It concerns enumeration scoping at the READ, which happens
before C′ and therefore before policy; no Cedar policy, schema attribute or denial terminal in
S1D depends on which reading is taken. S1D neither resolved it nor edited the architecture.
