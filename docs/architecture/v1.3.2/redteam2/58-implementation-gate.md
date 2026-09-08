# 58 — Implementation Gate

**ACOS Operating Spine v1.1. Second red team. Issued 2026-09-03.**
Answers the thirteen gate questions. Verdict: **CONDITIONAL PASS — REMEDIATION REQUIRED** (`52`).

---

## 1. Did R1 — the Effect Canonicaliser — survive?

**Survived in shape. Did not survive in specification.**

Enumerate-then-select is the right answer to `47 §1`, and `I21` is a real type-level property where v1.0's precondition test was *"a tautology over the fields that do not bound money and impossible for the ones that do"*. The kernel now computes every field that bounds money. That is a genuine repair of the package's most consequential defect.

Four blocking specification defects: `I18`'s equality is ill-typed and unsatisfiable for every class carrying a cost component (CAN-01); the enumeration's transport to the model is not specified at all (CAN-02); positional selectors permit **silent substitution of a different effect with no invariant firing** (CAN-03); and `constructor_version` is recorded nowhere, so `26 §11`'s reproducibility claim is false across any deploy (CAN-04).

CAN-03 is the one to note: it is a constructed path in which the executed effect is economically different from the selected one and `I18`, `I21`, `I2`, `I3`, `I29` and `I31` all hold.

## 2. Did R2 — `StandingAuthorization` — survive?

**Survived as a representation. Did not survive as a containment mechanism.**

Representing a rate as an entity with a forward integral, mandatory expiry and a named revocation class is correct, and `MAL_total` can now see advertising exposure at all, which v1.0 could not.

The containment half fails on four counts: forward exposure and boundary re-reservation are undefined against the four rolling windows the fixture declares (STD-01); **the release condition for standing headroom is unspecified**, and releasing on pause dispatch restores the exact v1.0 defect R2 exists to close (STD-02); expiry triggers a revocation that expiry forbids, because the revocation effect needs the grant that just lapsed (STD-03); and forward exposure carries no overdelivery allowance, so documented platform budget behaviour pauses a healthy campaign in the first week (STD-04).

`35 §7` calls this *"the layer that actually bounds this scenario"*. As specified, it is the layer that pauses the campaign for the wrong reason and may not stop the spend.

## 3. Did R3 — journal ordering and the split halt — survive?

**The trade-off survived. The completeness property did not.**

I endorse the EM15/EM16 trade explicitly: dispatching a statutory-clock-bearing compensable effect against a committed, locally chained, gap-free journal row is better than breaching a federal deadline to protect a mirror. `22 §3.1`'s reasoning is sound and IRRECOVERABLE is the right boundary. Neither invariant needs renegotiating.

Six blocking defects. Two are structural: `I17` is declared two-sided and owned by the audit plane, whose declared inputs contain no control-journal read, so **tail truncation is undetectable** (AUD-01); and degraded mode is entered on the word of the audited party, which also classifies each effect into the halt row that governs it (AUD-02). Four are mechanical: the canonical row form is undefined and `jsonb` does not preserve key order, so independent re-chaining cannot work (AUD-03); gap-free sequencing has an unstated company-scoped serialisation point (AUD-04); an ordinary crash-retry produces a duplicate sequence value that presents as tampering and poisons the anchor (AUD-05); and the halt table has two rows matching one effect with opposite behaviour and no precedence rule (AUD-10).

AUD-10 deserves the emphasis: **it is AUDA-01's defect signature — two mutually exclusive behaviours for one condition, in documents of equal standing, with no supersession note — reproduced inside the remediation written to remove it, on the case the remediation exists to serve.**

## 4. Did R8 — the four authorised-loss quantities — survive?

**The arithmetic survived. Four of its semantics did not.**

I recomputed every figure in `51 §4` from `26 §10.1`'s formulae by an independent implementation and reproduced all ten exactly, including the $5,205 composition figure. `51 §4.2`'s claim that the MONTH window binds is **correct as stated**, verified by brute-force enumeration over all five gated classes.

Four blocking semantic defects: `min()` over an absent window monetary cap has no stated convention and **no window in `51 §2` declares one**, so every term of `MAL_monetary` depends on an unstated guess my implementation had to infer from the printed answer (LIM-01); `I3`'s `window ceiling` operand does not exist in any artifact, and the two possible repairs make `I3` either vacuous or `MAL_monetary` an over-count (LIM-02); order-driven irrecoverable cost is excluded, absent from **both** six-item exclusion lists, and its three governing controls have no declared values in the class `33 §9` says dominates POD by volume (LIM-03); and realisable loss exceeds the displayed ceiling through released-but-unresolved reservations plus the `I32` owner override, with no invariant firing and no re-signature triggered (LIM-04).

Four quantities are better than one, and `MAL_total` is the right thing to display — with `MIE_cost` as a p50/p95 band rather than a point, and with a realisable-cash line that includes the cost ceilings the owner can also lose.

## 5. Did R9 / P4 survive?

**Verify mode survived. The lifecycle and the proof did not.**

Kernel-state approvals remove DBO-03's orphaned-suspension class entirely, and deny-rather-than-top-up is the only choice preserving both the ceiling and SR5. Both decisions are right and both should stand.

Four blocking defects: OWNER approvals have no expiry while reservations are reaped, so the reservation is **guaranteed** to be gone before the tier that most needs it resumes, and R′ covers *insufficient* rather than *absent* (RES-01); `26 §11.2`'s hand proof — the only proof of P4 until symcc returns — omits eight authority-bearing classes including two the fixture actively grants (RES-02); `settlement_direction`'s two-way cut cannot express `goodwill.credit.issue`, which is a monetary class entering `MAL_monetary` (RES-03); and `I31` is cited four times for a property it does not state, so **R9's central rule is enforced by no invariant** (RES-04).

RES-04 is the notable one: citation drift in the registry created to end citation drift, and the consistency pass's C5 check cannot find it because it verifies that identifiers *resolve*, not that the resolved statement entails the citing sentence.

## 6. Are there any FATAL defects?

**No.** Every one of the twenty-two BLOCKING defects has a local repair specified in `57` — a field split, a declared value, a precedence order, a status transition, an attestation row, a completed table. None requires abandoning a mechanism or returning to a rejected alternative.

The base rate matters. `47` found zero FATAL across ninety-two defects and the brief says that rate should stay low; I have not inflated one to justify the pass being conditional, and the two paths in `52 §1` that exceed the authority boundary are compositions of under-specified mechanisms rather than mechanisms that cannot work.

## 7. Are there any unresolved BLOCKING defects?

**Yes. Twenty-two, all unresolved, all T1.** Enumerated in `53 §0` and specified in `57`. Every one lands in the S1 schema, the constructor, the exposure ledger, the journal or the policy set, which is why none can be deferred past S1 code.

`46`'s reconsideration trigger for the ledger's own READY-FOR-SECOND-REDTEAM decision — *"any two classified BLOCKING against the same one of the five items"* — is met for all five. That is recorded as a fact about the trigger, not as an argument for a different verdict: the correct reconsideration is the remediation in `57`.

## 8. Is Option A still viable?

**Yes, and this review strengthens the case for it.**

Option A's load-bearing property is that authorisation, effect, reservation, state transition and journal row commit in **one transaction**, and `analysis/v1.1-internal-consistency-pass.md` C7 is right that *"stays in Postgres"* rather than *"modular monolith"* is what matters. Three findings depend on that transaction and would be materially harder or impossible under a distributed substrate:

- SR-A4's gap-free sequencing needs a counter row inside the authorising transaction. Across a distributed engine there is no such transaction, and R18's finding that migrating to Temporal *"destroys R1"* is confirmed from a second direction.
- SR-L2's window ceiling as a DB-checked bound needs the balance row and the journal counter in one transaction with a declared lock order.
- SR-L4's `PRESUMED_SETTLED` term needs `I3`'s sum evaluable at a single commit point.

R18's correction of ADR-002's fallback — an ACOS-owned Postgres step journal rather than Temporal — is the right fallback for the right reason, and the S1 spike comparing DBOS against a hand-rolled step journal remains worth running.

## 9. Is implementation of S1 permitted?

**Not yet. S1 is permitted once `57`'s twenty-two T1 items are applied and the third review returns on SR-A1, SR-A2 and SR-S2.**

S1 builds the constructor, the exposure ledger with named windows and standing authorisations, the journal with its sequence and chain, and the kernel-state approval path. Every one of the twenty-two defects is in that surface. Building S1 first and remediating after means writing the S1 fixture tables against an unsatisfiable `I18`, the ledger against a non-existent window ceiling, and the journal against an unspecified canonical form — and then rewriting all three.

**A narrow exception is reasonable and should be taken.** Two S1 activities have no dependency on any finding and are on the critical path for information the remediation itself needs:

- **The DBOS-versus-step-journal spike** (`31 §3.3`, `37 S1`) on the kill-point matrix. It informs SR-A4's sequencing and is a spike, not a build.
- **Provisioning the separate audit account and provider** (`33 §7`, `49 §3.2`). It is an S1 provisioning decision, it takes calendar time, and SR-A1's third review needs a real second account to reason about.

Nothing else. No schema, no constructor, no ledger, no journal.

## 10. Is implementation of S2 permitted?

**No, and not for its own defects.**

S2 — untrusted ingress, one bounded reasoning worker, the perimeter CI check — is in a better state than S1: R4 was explicitly excluded from second review on `46`'s own reasoning that the enumeration will be incomplete and the correct answer is the CI check and the maintained artifact. I found nothing in S2's surface within scope.

S2 is nevertheless gated behind S1 because `37 §2` is right that *"every later slice's safety is an argument about S1 and S2"*, and because S2's proof of property 2 — that a compromised model cannot move money — is an argument about the constructor, the windows and `I21`. Proving containment against a constructor that will change is proving it about the wrong object, which is `45 §7`'s lesson applied to the test plan.

**One S2 item should move earlier regardless:** SR-C2's `enumerate_effects` capability is a model-facing read and belongs in the same `context_spec` and egress analysis S2 performs. Specifying it in the remediation and testing it in S2 is the right split.

## 11. What capabilities remain explicitly prohibited?

Unchanged from v1.1, and this review adds nothing to the prohibition list and removes nothing from it.

**Categorically prohibited** (`26 §6`, architecturally unreachable, no grant overrides): `payee.create` · `payee.bank_details.modify` · `payment_method.add` · `credential.create/rotate/export` · `oauth.scope.modify` · `payment_page_code.write` · `theme.checkout.write` · `authority.*` · `audit.write/close/delete` · `platform.spend_cap.raise` · `platform.budget_limit.raise` · `review.create` · `testimonial.create` · `tax.filing.*` · `entity.*` · `contract.execute` · `legal.response.send` · `dispute.representment.submit`.

**Prohibited by the MVP's non-production boundary**, and this document does not authorise any of them: production deployment · real customers · real money · live advertising · supplier commitments · autonomous business operation · any real platform identity · any public storefront.

**Non-autonomous by disqualifier**, with this review adding two:

| Class | Disqualifier |
|---|---|
| `email.campaign.send` | One ESP server token performs both send classes, so the distinction is policy-only at the credential level (`26 §9.9`, `29 §3.3`) |
| Any class with no registered constructor | `DENY: NOT_CANONICALISABLE` (`26 §7`) |
| Any class whose API offers no idempotency and which is also irrecoverable | `25 §7` |
| **Cross-currency monetary classes** (new) | Settled cost is not computable pre-dispatch; autonomy requires a per-corridor spread allowance that does not yet exist (CAN-06) |
| **Split-tender refunds** (new) | Not canonicalisable under a line-item-only enumeration; requires SR-R3's instrument dimension (CAN-07) |

## 12. What must be tested during implementation rather than proved on paper?

Twelve obligations. Each is an item where further architecture reasoning cannot settle the question and a sandbox or development-store test can.

| # | Obligation | Slice |
|---|---|---|
| 1 | Gap-free `journal_seq` under concurrency and rollback, with the declared lock order and no deadlock against the window balance row | S1 |
| 2 | `I3`'s multi-term sum as a single DB-checked bound, with the mandatory REPEATABLE READ negative control that **must fail** | S1 |
| 3 | Independent re-chaining across two instances over rows containing structured fields — the `jsonb` ordering question is empirical | S1 |
| 4 | The five ordering kill points, including the ack-lost re-push, asserting duplicate versus tamper is distinguished | S1 |
| 5 | Standing boundary re-reservation against simulated platform overdelivery, asserting the day-2 pause does **not** occur | S1 |
| 6 | Verify-mode resume after reservation reaping, after a constructor bump, and after an out-of-band settlement | S1 |
| 7 | `refundCreate`'s `@idempotent` key scope and deduplication window, **empirically** — and specifically whether the window exceeds the reconciler's resolution latency | S3 |
| 8 | Whether the audit plane's own vendor reads detect an out-of-band mutation the control plane suppresses, in a real development store | S3 |
| 9 | `cessation_lag` per adapter — how long after a pause the platform's spend reporting settles. Vendor documentation does not state it | S3 |
| 10 | Whether `reconciler_match_rule` distinguishes a renewal from a crafted charge, with the crafted case authored by someone other than the rule's author | S3 |
| 11 | Outbox kill points against a **real ESP sandbox**, measured by the provider's own accepted count | S4 |
| 12 | `Σ settled cost attributable to agent-authorised effects ≤ MAL_total(w)` — at the bank line, weeks later. **The only unforgeable MAL test** | T3 |

Item 12 is the one that matters and the one no amount of CI converts into a proof. `51 §5`'s last row says so and it is right.

## 13. What result during MVP implementation would revoke this pass?

Seven conditions. Any one revokes it and returns the package to architecture.

1. **A remediation that answers a BLOCKING finding by weakening the invariant** rather than supplying the missing mechanism or value — `I18` relaxed to a tolerance admitting omitted cost components, `I17` restated as one-sided and called complete, `I3` shedding the `PRESUMED_SETTLED` term, P4 narrowed to shorten the hand proof.
2. **The third review on SR-A1/SR-A2 concludes the audit plane cannot obtain an independent input path** without either reading the control database or introducing a new suppression channel. In that case `I17`'s completeness claim degrades permanently to WORDING and the split halt's unsuppressibility argument loses its second leg.
3. **`cessation_lag` proves unmeasurable or long enough** that pause-and-reauthorise within a window is impossible and advertising becomes an all-or-nothing monthly commitment. That is a business-model finding, not an engineering one, and it changes what `Standing(w)` means.
4. **The S1 concurrency harness cannot produce a failing negative control** at REPEATABLE READ. `36 §2` is right that a concurrency test without one is indistinguishable from a test that does not exercise the race, and `36 §14`'s note that 10× load cannot reproduce serialisable write skew at these volumes means targeted interleaving is the only route.
5. **Independent re-chaining cannot be made to agree** across two instances for rows containing structured fields, after SR-A3's canonical form is specified. Then `I41`'s mirror side does not exist and the local chain is self-attested.
6. **`I18` divergence between reserved and settled amounts persists after SR-C1's field split and CAN-06's per-corridor spread allowance.** `47 §10` names this as one of three conditions that would fail the architecture and it is discoverable only in operation.
7. **More than one additional action class proves non-canonicalisable** during S1 beyond the two this review adds. One is an architecture finding; several is a finding about the automatability of the business model, which is `26 §1.4.6`'s own framing and the more useful result.

---

## Authorisation statement

The verdict is **CONDITIONAL PASS — REMEDIATION REQUIRED**, so the authorising sentence is not available and is deliberately not written here.

What is authorised: applying `57`'s twenty-two T1 remediation items; convening the narrow third review on SR-A1, SR-A2 and SR-S2; and the two S1 exceptions in §9 — the DBOS-versus-step-journal spike and provisioning the separate audit account.

Nothing else. No schema creation, no repository initialisation beyond what the spike requires, no vendor account provisioning beyond the audit separation, no production code.

**Grade: DECISION.** Made by the second independent architecture red team on the package as delivered, 2026-09-03.
