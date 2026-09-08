# 62 — Implementation Gate v2

**ACOS Operating Spine v1.2. Third independent architecture red team. Issued 2026-09-03.**
**Supersedes `58-implementation-gate.md` as the operative gate. `58 §12`'s twelve implementation-validation obligations are carried forward and amended in `§10` below, not replaced.**
**Verdict source: `59-third-redteam-verdict.md` — CONDITIONAL PASS — REMEDIATION REQUIRED.**

Answers the twelve gate questions the Phase 2.4 mission poses.

---

## 1. Did Mechanism A pass?

**Conditionally.** Its central concept works and is worth keeping.

The audit plane has acquired a **genuine independent input**: the absence of an expected attestation is an observation the audited party cannot forge, and it closes the stopped-writer case at 15 minutes. The **inversion** — making `UNCORROBORATED_STALL` stricter than `NORMAL` — is the most valuable single change in v1.2, and `52 §1` Path B is closed by it: a unilateral degradation declaration is strictly worse for the declarer on every precedence row. The **relocation** of the unqualified completeness claim from `I17` to `I8` is honest at every one of the eleven sites checked (`61 §1` A8), not relabelling. `ACOS-JCS-1` is what makes the attestation's `head_hash` leg unforgeable and was a precondition for SR-A1 in a way the ledger does not state.

**Seven BLOCKING defects.** TA-01 (`30 §5.5` case 2's 15-minute bound does not hold against the attester, and `VC-A1` passes for the wrong reason), TA-02 (`I8` — the sole detector for both omission residuals — has no declared sweep cadence), TA-03 (`I8`'s tag-set sentence admits a coverage-narrowing reading), TA-04 (no dispatch→tag detector), TA-05 (the owner override escaping `UNCORROBORATED_STALL` is specified nowhere, while the ledger records AUD-07 as closed), TA-06 (the corroboration signal's transport, authentication and freshness are undeclared, and the corroborated state is close to unreachable without them), TA-07 (`36 §6` and `36 §14` state the pre-inversion behaviour).

---

## 2. Did Mechanism B pass?

**Conditionally.** Its lifecycle shape and its conservative direction are correct.

Releasing forward exposure in exactly one state, requiring evidence rather than a status change to reach it, retaining in every non-`REVOKED` status, and declining to offer a `REVOKED` transition at all while `cessation_lag` is `UNMEASURED` are all right, and the commercial cost is disclosed in two artifacts rather than discovered. The flagged deviation from `57 §2` is **validated by this pass and for a stronger reason than the one recorded**: the exposure-remainder form is structurally insensitive to realised-spend reporting error, because `realised + forward ≡ standing_cap` identically, while the multiplicative form adds to a wrong `realised` rather than compensating for it (`61 §2` B8).

**Six BLOCKING defects.** TB-01 (`24 §3` K5's printed `window_balance` `CHECK` omits the standing term, so the mechanism's only claimed property is enforced by nothing in the artifact declaring the enforcement), TB-02 (forward exposure's window-instance scoping is undeclared; the literal formula exhausts `W_MONTH_ADSPEND` permanently), TB-03 (no declared handoff between the rate class's reservation and the standing forward exposure; every literal reading denies the first `campaign.budget.set`), TB-04 (the realised/standing joint update has no declared atomicity or lock), TB-05 (`charge.standing_authorization_id` is ACOS-derived and its provenance is undeclared, so the SR-S2 scoping is a self-assertion), TB-06 (no transition invariant, and `any → EXPIRED` includes `REVOKED`).

---

## 3. Any FATAL defects?

**No.** Zero across thirty entries. `47` found zero across ninety-two, `52` zero across fifty-six.

Every BLOCKING item has a local repair: a restated sentence, a declared value, a corrected `CHECK` expression, an added invariant, a specified entity, or a scoping rule. **None requires abandoning the attestation, the three-state machine, the inversion, the five-state standing lifecycle, the exposure-remainder form, or the conservative default.** No BLOCKING has been inflated to justify the conditional verdict and none has been deflated to reach a pass.

**`58 §13` condition 2 is not triggered.** The third review does **not** conclude that the audit plane cannot obtain an independent input path. It has obtained one, without reading the control database and without opening a new suppression channel. `I17`'s claim does not degrade to WORDING; it degrades to *transport completeness plus a bounded liveness check on the attestation channel*, which is what v1.2 already states, minus the one case TA-01 identifies.

**`58 §13` condition 3 is not triggered, and its trigger has moved.** `cessation_lag` has not been measured and — per TB-07 — **cannot be measured until the cessation specification is declared**. The condition is waiting on architecture, not on data. `§10` amends obligation 9 accordingly.

---

## 4. Any unresolved BLOCKING defects?

**Yes. Fourteen.** Seven Mechanism A, six Mechanism B, one joint.

All fourteen land in the S1 surface — the journal and its sequence and chain, the exposure ledger and its `window_balance` row, the constructor's `exposure` block, the mirror state machine, and the validation plan S1's fixtures are authored from. `58 §7`'s reasoning applies unchanged: building S1 against a `CHECK` missing a term, a formula with no instance scoping, an oracle specification carrying superseded figures, and an override with no declared shape means writing the S1 fixtures wrong and then rewriting them.

Ten MATERIAL and lower are scheduled in `§9`.

---

## 5. Is S1 implementation authorized?

**No.**

**S1 is permitted once the fourteen BLOCKING items in `60` are applied and a verification-only pass confirms application.** None of the fourteen introduces a new mechanism, so **no fourth adversarial red team is required** — this is the substantive difference from `58 §9`, which required a third adversarial pass because two new mechanisms had been introduced. What is required now is the same discipline `phase2-v1.2-remediation-ledger.md` applied to `57`: one entry per finding, one disposition, no merges, and a consistency pass whose conditions are stated so that they can fail.

**One condition on that consistency pass.** `analysis/v1.2-consistency-audit.md` returned PASS on conditions C5 and C6 and both are false (TB-09, TOS-04). The next pass must (a) restate C5 and C6 as *"stated identically wherever stated, and stated nowhere in a superseded form"*, (b) add a condition asserting that every printed `CHECK` expression matches the registry's declared operand list, and (c) record the two false PASSes, because `21 §2` item 16's finding is that an unrecorded failure in the audit trail is more decision-relevant than the defect it concealed.

---

## 6. Is the DBOS-versus-step-journal spike authorized?

**Yes. Unchanged from `58 §9` and re-authorised here.**

It has no dependency on any finding in this pass, it is a spike rather than a build, and it informs SR-A4's sequencing. `58 §8`'s reasoning stands: gap-free `journal_seq` requires a counter row inside the authorising transaction, which is a property of the Postgres-centric substrate and not of the workflow engine, and the outbox is ACOS-owned either way.

**One addition to the spike's kill-point matrix from this pass.** Include the interleaving TB-04 constructs: an asynchronous realised-spend update against a concurrent authorisation on the same `window_balance` row, in both orderings. It bears on whether the standing term can be a generated column, which is the recommended repair, and it is cheaper to learn in the spike than in the build.

---

## 7. Is separate audit-account provisioning authorized?

**Yes. Unchanged from `58 §9` and re-authorised, with one scope extension.**

It takes calendar time, it is an S1 provisioning decision, and this review needed a real second account to reason about as much as the second review did. `30 §5` requires *"a different provider or, at minimum, a separate account with a separate payment method and separate operator credentials"*, and `30 §5.8`'s MVP selection is the owner mailbox copy plus WORM object storage on a separate provider.

**Extension, and it is small.** TA-06's repair requires the audit plane to **publish and sign** a stall artifact that the control plane fetches. That needs a signing key held by the audit plane and an endpoint reachable from the control plane. Provisioning the key and the endpoint is part of audit separation, not part of S1's build, and doing it now removes a dependency from the remediation.

**Nothing else.** No schema, no constructor, no ledger, no journal, no repository beyond what the spike requires.

---

## 8. Is S2 implementation authorized yet?

**No, and for `58 §10`'s reason, which is unchanged and correct.**

S2's proof of property 2 — that a compromised model cannot move money — is an argument about the constructor, the named windows and `I21`. TB-03 changes the constructor's `exposure` block for rate classes and TB-01 changes the `window_balance` schema. Proving containment against objects that will change proves it about the wrong object.

`58 §10`'s recommendation that SR-C2's `enumerate_effects` be *specified* in the remediation and *tested* in S2 stands and is unaffected by this pass.

---

## 9. What remains categorically prohibited?

**Unchanged from `58 §11`. This review adds nothing to the prohibition list and removes nothing from it.**

**Categorically prohibited** (`26 §6`, architecturally unreachable, no grant overrides): `payee.create` · `payee.bank_details.modify` · `payment_method.add` · `credential.create/rotate/export` · `oauth.scope.modify` · `payment_page_code.write` · `theme.checkout.write` · `authority.*` · `audit.write/close/delete` · `platform.spend_cap.raise` · `platform.budget_limit.raise` · `review.create` · `testimonial.create` · `tax.filing.*` · `entity.*` · `contract.execute` · `legal.response.send` · `dispute.representment.submit`.

**Prohibited by the MVP's non-production boundary**, and this document authorises none of them: production deployment · real customers · real money · live advertising · supplier commitments · autonomous business operation · any real platform identity · any public storefront.

**Non-autonomous by disqualifier:** `email.campaign.send` · any class with no registered constructor · any class whose API offers no idempotency and which is also irrecoverable · cross-currency monetary classes · split-tender refunds. **This review adds none.**

**Three additional prohibitions specific to this gate**, each expiring when its finding is remediated:

1. **No `campaign.budget.set` fixture may be authored against `51 §3.2` until TB-03 is applied**, because the rate class's `total_exposure` is undefined and every literal reading denies. An S1 fixture authored now would encode one of the two denying readings.
2. **No `window_balance` schema may be created until TB-01 is resolved**, because two artifacts declare different column sets and different `CHECK` arities for the same table.
3. **No `cessation_lag` measurement may be attempted until the cessation specification of TB-07 is declared**, because the quantity is undefined until the authoritative timestamp and the interval start exist.

---

## 10. Which properties must be validated empirically during S1/S3?

**`58 §12`'s twelve obligations are carried forward. Items 8 and 9 are amended, and five are added. Seventeen total.**

| # | Obligation | Slice | Status |
|---|---|---|---|
| 1 | Gap-free `journal_seq` under concurrency and rollback, with the declared lock order and no deadlock against the window balance row | S1 | Carried, unchanged |
| 2 | `I3`'s multi-term sum as a single DB-checked bound, with the mandatory `REPEATABLE READ` negative control that **must fail** | S1 | Carried, and now **four** terms — TB-01's correction is a precondition, not part of the test |
| 3 | Independent re-chaining across two instances over rows containing structured fields — the `jsonb` ordering question is empirical | S1 | Carried, unchanged |
| 4 | The five ordering kill points, including the ack-lost re-push, asserting duplicate versus tamper is distinguished | S1 | Carried, unchanged |
| 5 | Standing boundary re-reservation against simulated platform overdelivery, asserting the day-2 pause does **not** occur | S1 | Carried, and **extended**: assert the *cross-boundary* case TB-02 identifies — pause mid-month, cross the boundary, assert the next instance's headroom against the declared rule |
| 6 | Verify-mode resume after reservation reaping, after a constructor bump, and after an out-of-band settlement | S1 | Carried, unchanged |
| 7 | `refundCreate`'s `@idempotent` key scope and deduplication window, empirically | S3 | Carried, unchanged |
| **8** | Whether the audit plane's own vendor reads detect an out-of-band mutation the control plane suppresses, in a real development store — **and, added, the measured end-to-end detection latency, which is the operand `I8` does not declare** | S3 | **Amended (TA-02)** |
| **9** | **Declare the per-adapter cessation specification first** — reporting settlement latency, authoritative timestamp kind, revision window, minimum observation count — **then** measure each field. The single scalar `cessation_lag` is not measurable | S1 (declare), S3 (measure) | **Amended (TB-07).** As written the obligation was not executable |
| 10 | Whether `reconciler_match_rule` distinguishes a renewal from a crafted charge, with the crafted case authored by someone other than the rule's author | S3 | Carried, and **extended**: the crafted case must also be authored independently of the **derivation** of `standing_authorization_id`, per TB-05 |
| 11 | Outbox kill points against a real ESP sandbox, measured by the provider's own accepted count | S4 | Carried, unchanged |
| 12 | `Σ settled cost attributable to agent-authorised effects ≤ MAL_total(w)` — at the bank line, weeks later. **The only unforgeable MAL test** | T3 | Carried, unchanged. Still the one that matters |
| **13** | **Adversarial-attester negative control.** Truncate the push *and* adjust the attestation to match, and assert `I17e` does **not** fire — so `VC-A1` discriminates transport loss from attester suppression instead of conflating them | S1 | **New (TA-01)** |
| **14** | **Dispatch→tag detection.** Dispatch inside an audit-published `MIRROR_INPUT_STALL` interval with the tag omitted, and assert the audit plane raises a critical incident | S1 (fixture), S6 (live) | **New (TA-04)** |
| **15** | **Override composition.** Exercise the specified override repeatedly across consecutive outages, rotating action classes and recreating after expiry, and assert the declared aggregate bound holds | S1 (fixture), S5 (owner path) | **New (TA-05).** Cannot be written until the override is specified |
| **16** | **Realised/standing atomicity.** Targeted interleaving of an asynchronous realised-spend update against a concurrent authorisation on the same `window_balance` row, both orderings, with the mandatory weaker-isolation negative control | S1 | **New (TB-04)** |
| **17** | **First-authorisation permit.** Assert that the **first** `campaign.budget.set` in a clean window **permits**. No current verification case asserts it, and under every literal reading of TB-03 it denies | S1 | **New (TB-03)** |

**Obligation 12 remains the one no amount of CI converts into a proof.** `51 §5`'s last row says so and it is right.

---

## 11. What specific implementation result revokes the architecture PASS?

**`58 §13`'s seven conditions are carried forward. Conditions 2 and 3 are amended. Three are added. Ten total.**

1. **A remediation that answers a BLOCKING finding by weakening the invariant** rather than supplying the missing mechanism or value. *Carried unchanged.* For this pass specifically: retaining forward exposure in fewer statuses to make TB-02 tractable; relaxing `I54` to admit a timed-out verification read; adding a tolerance to `I18b`; or dropping the standing term from `I3` to make TB-01's `CHECK` simpler. **Each of these is the tempting repair for a finding above and each is prohibited.**
2. **The audit plane's independent input path is found, in implementation, to require a control-database read or to open a second unverified channel.** *Amended.* The condition as written asked the third review to conclude this and the third review concluded the opposite. It survives as an **implementation** revocation: if TA-06's signed stall artifact cannot be made to work without the control plane reading audit-side state it should not hold, or if the fix introduces a second path the control plane can suppress independently, then `I17`'s claim degrades permanently to WORDING and the split halt loses its second leg.
3. **The cessation specification proves unmeasurable, or `cessation_lag` measures long enough that pause-and-reauthorise within a window is impossible.** *Amended per TB-07.* The original condition presumed a measurable scalar. Two distinct revoking results now exist: the specification cannot be declared for the adapter at all, or it can and the measured latency is long. Both are **business-model findings** about advertising under this architecture, not engineering findings, and `26 §10.5` is right to say so.
4. **The S1 concurrency harness cannot produce a failing negative control at `REPEATABLE READ`.** *Carried unchanged*, and now covering obligation 16 as well as obligation 2.
5. **Independent re-chaining cannot be made to agree across two instances** for rows containing structured fields, after `ACOS-JCS-1`. *Carried unchanged.*
6. **`I18` divergence between reserved and settled amounts persists** after SR-C1's field split and CAN-06's per-corridor spread allowance. *Carried unchanged.*
7. **More than one additional action class proves non-canonicalisable during S1** beyond the two `58` added. *Carried unchanged.*
8. **The standing term cannot be made atomic with the realised term** without either serialising every vendor spend observation behind the authorisation path or admitting a transient state in which headroom exists that no authorisation created. *New, TB-04.* Either outcome means `I3`'s four-term bound is not enforceable at one commit point, which is `58 §8`'s decisive property for Option A and would be the first finding in three passes to bear on the substrate choice.
9. **`charge.standing_authorization_id` cannot be derived unambiguously** from any combination of the audit plane's own vendor reads, in a real sandbox, across a predecessor/successor pair with delayed posting. *New, TB-05.* Then `I22`'s per-authorisation scoping is unenforceable, the SR-S2 repair is decorative, and STD-02 is open.
10. **The specified override's aggregate bound cannot be set at a value that is both safe and usable.** *New, TA-05.* If every value that bounds composition also makes the escape unusable during a real multi-day provider outage, the EM15/EM16 trade has no viable escape hatch and `47 §9`'s tension is a genuine deadlock rather than a priced residual. This is the condition most likely to be reached by argument rather than by measurement, and it should be settled before S1 rather than during it.

---

## 12. What is the exact next authorized development boundary?

**Authorized now:**

1. **Apply the fourteen BLOCKING items** in `60`, using `phase2-v1.2-remediation-ledger.md`'s discipline — one entry per finding, one disposition from `APPLIED` / `APPLIED WITH EXPLICIT RESIDUAL` / `NOT APPLIED — BLOCKING`, no merges, no silent consolidation, and a `§4`-equivalent check that no repair weakened an invariant.
2. **Schedule the ten MATERIAL and lower items.** TB-09 (the superseded figures in `36 §12` and `37 §5`) and TOS-04 (the two false consistency PASSes) should be applied **with** the BLOCKING set rather than after it, because `36 §12` is the `I7` oracle specification and an S1 oracle author reading it will reproduce `54 §2.3`'s circularity. The remaining eight may follow S1's start.
3. **Run a verification-only consistency pass** with the three conditions in `§5`. Not an adversarial review.
4. **The DBOS-versus-step-journal spike**, with the TB-04 interleaving added to its kill-point matrix (`§6`).
5. **Provision the separate audit account and provider**, including the signing key and read endpoint TA-06's repair requires (`§7`).

**Not authorized:** S1 build. S2. Schema creation. Repository initialisation beyond the spike. Constructor code. Ledger code. Journal code. Any vendor account beyond the audit separation. Any production code.

**The gate that follows.** S1 opens on the verification pass confirming fourteen of fourteen applied, plus TB-09 and TOS-04, plus the three consistency conditions passing — **and not before, and not on a fourth adversarial review, which this pass does not require.**

---

## Authorisation statement

The verdict is **CONDITIONAL PASS — REMEDIATION REQUIRED**, so the authorising sentence is not available and is deliberately not written here.

**What is authorised:** applying the fourteen BLOCKING items in `60`; applying TB-09 and TOS-04 alongside them; running the verification-only consistency pass; the DBOS-versus-step-journal spike with its extended matrix; and provisioning the separate audit account, provider, signing key and read endpoint.

**Nothing else.**

One closing observation for the owner rather than for the implementer. Three independent passes have now found zero FATAL defects across 178 findings, and the defect profile has shifted in a way that is worth reading: `47`'s findings were about missing mechanisms, `52`'s were about missing quantities, and this pass's are predominantly about **two artifacts stating the same mechanism differently**. `24 §3` K5 against the registry on the `CHECK`; `36 §6` against `30 §5.6` on the mirror; the ledger against `30 §5.6` on the override; `36 §12` against `51 §4` on the arithmetic. That is AUDA-01's signature — *two behaviours for one condition, in documents of equal standing, with no supersession note* — and it has now appeared in v1.0, in v1.1's remediation of it, and in v1.2's remediation of that. The mechanical defence is a consistency condition asserting that a mechanism declared in two places is declared identically, and it is cheaper than a fourth red team.

**Grade: DECISION.** Made by the third independent architecture red team on the package as delivered, 2026-09-03.
