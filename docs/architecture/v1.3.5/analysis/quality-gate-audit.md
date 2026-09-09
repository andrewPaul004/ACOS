# Quality Gate Audit — ACOS Phase 2

**Performed 2026-09-01, before packaging. Version 1.0.**

## Provenance note, stated first

The Phase 2 brief's quality-gate list was supplied as an attachment. **Seven gates are recoverable verbatim by their citations inside `22`–`37`** (1, 2, 4, 11, 13, 14, 15). The remaining eight are reconstructed from the concerns recorded while working through them, and their wording below is **paraphrase, not quotation.** Marked accordingly. The reviewer should re-read the original list against this audit; a paraphrased gate is a weaker check than the real one, and saying so is cheaper than pretending otherwise.

Verdict scale: **PASS** · **PASS WITH NOTE** · **FAIL**.

---

## Gate 1 — Has a business model been chosen implicitly? *(verbatim, cited `24 §2`)*

**PASS WITH NOTE.**

The kernel derivation explicitly excludes products, orders, customers, suppliers, campaigns and content as domain entities, and `24 §2` names this as the failure the gate tests for. `33 §9` walks four models with no kernel change. Option D was rejected specifically on this ground (ADR-014).

**Note:** the commerce adapter targets Shopify, and Shopify is a physical-commerce-shaped platform. That is an *adapter* choice, reversible per ADR-014's reconsideration trigger, but a reviewer could reasonably argue it exerts gravitational pull on the first business selection. Recorded rather than argued away.

---

## Gate 2 — Has an LLM been accidentally treated as a security boundary? *(verbatim, cited `27 §3`)*

**PASS.**

`27 §3` is a ten-row mechanical check. The relevant negative finding is load-bearing: Project Vend's oversight CEO approved discounts roughly 8:1 against its own written policy, which is direct evidence that a supervisory agent is not an authority control. Authority lives in Cedar, evaluated in a process no model-bearing runtime can reach, with `36 §10`'s compromised-worker test verifying the unreachability rather than asserting it.

The wording tension between EM2's "separate process boundary from model inference" and in-process Cedar is resolved explicitly in ADR-005.

---

## Gate 3 — Is any control enforced only by a prompt? *(reconstructed)*

**PASS.**

Sweep of every control claimed in `26`, `29` and `30`: each resolves to a Cedar policy, a database constraint, a generated column, an absent credential, an egress rule, a schema validator, or a continuous invariant. Two items are deliberately *not* gates and are labelled telemetry rather than controls: injection classifiers (ADR-010) and utterance classifiers (ADR-015). That labelling is the correct handling given no measured false-negative rate exists for either.

---

## Gate 4 — What can a fully compromised model still do? *(verbatim, cited `26 §14`, `29 §7`)*

**PASS.**

Answered as a number rather than a posture: up to `MAL(window)` in money and `MIE(window)` in irrecoverable actions, and nothing else. `26 §14` tabulates the full attacker surface; `29 §9`/`§10` and `35 §1`/`§2` walk it. `36 §9.1` makes it measurable with a zero threshold on five specific counters.

---

## Gate 5 — Can retries create duplicate financial or customer actions? *(reconstructed — the concern is recorded verbatim in working notes)*

**PASS WITH NOTE, and the note is the honest answer.**

Money: three idempotency layers (`25 §7`), a unique constraint on the effect idempotency key, DBOS's never-re-execute guarantee, and Shopify `refundCreate`'s `@idempotent` behaviour since API 2026-04. The `OUTCOME_UNKNOWN` state exists precisely so a timeout is not collapsed into a failure (`35 §4`).

**The exposed case is outbound email.** Third-party ESPs are at-least-once by design. Mitigation is a send-ledger with a pre-send claim plus provider idempotency keys where the provider offers them — and not every provider does. So a duplicate customer *message* remains possible in a narrow window, where a duplicate *refund* does not. Since sends are IRRECOVERABLE, that is the residual worth naming, and `36 §7`'s adapter contract tests verify the claim empirically rather than trusting a vendor annotation.

---

## Gate 6 — Is financial truth reachable by a model anywhere? *(reconstructed)*

**PASS.**

EM7, ADR-007, `28`. K6 has no model client; `36 §12` verifies by static dependency check rather than by inspection. Models may narrate computed figures and cannot produce them. The tolerance-rule temporal prohibition (`I7`) closes the one degradation path that would otherwise let a discrepancy be defined away.

---

## Gate 7 — Does the architecture depend on detecting prompt injection? *(reconstructed)*

**PASS.**

ADR-010 states the opposite assumption: the model is compromised. Nasr et al. broke 12 of 12 defences (71–100% ASR, 100% under human red-teaming), so any design contingent on detection is unsound. `36 §9.1` scores effect on the business, not attack success against the model.

---

## Gate 8 — Are the deterministic and probabilistic halves cleanly separated? *(reconstructed)*

**PASS.**

Four planes by trust and determinism, not by business domain (`23 §3`). The separation is verified by the replaceability test (`36 §11`) rather than by diagram: with every model unreachable, ingest, fulfilment, finance, reconciliation, approvals, escalations and audit invariants all continue. `36 §11` also flags this as the test most likely to fail on a first attempt, which is the correct expectation.

---

## Gate 9 — Is every number in the package graded? *(reconstructed)*

**PASS WITH NOTE.**

Phase 1 figures are cited with their section. Phase 2's own numbers are labelled: `37 §5`'s authority limits are ESTIMATE and RECOMMENDATION, `33 §7`'s infrastructure cost is an estimate, `33 §8`'s scale envelope is qualitative by choice.

**Note:** `33 §8`'s "low thousands of orders per month" and "roughly 100/second" in ADR-004 are engineering judgement presented without an explicit grade tag. They are not load-bearing for any control, but a strict reading of the constitution's evidence discipline would want them marked. Left as-is with this note rather than retro-tagged, so the reviewer can judge.

---

## Gate 10 — Can the audit record be suppressed? *(reconstructed)*

**PASS.**

Separate Postgres instance, separate credentials, insert-only grant, hash chain, continuous verification via `I1`, adverse-facts appendix computed by the audit plane (ADR-013, `27 §5`). `36 §13` tests the grant by attempting the prohibited operation. `36 §6` mandates that effects **halt** when the audit store is unreachable rather than buffering locally, which closes the window a more convenient design would leave open.

---

## Gate 11 — Can agents be replaced without migrating the company? *(verbatim, cited `27 §9`)*

**PASS.**

Workers hold no state, are not addressable by one another, and have no conversations. The autonomy ledger keys on `(task_type, action_class, model_binding, resource_class)`, so a replacement resets the earned level without touching state, grants, evidence, decisions, financial records or audit history. `36 §11` is the test.

---

## Gate 12 — Have design preferences been mislabelled as evidence requirements? *(reconstructed — the concern is recorded verbatim in working notes)*

**PASS, and this gate changed the package.**

`22` is split into three tiers precisely because of this gate: 17 **EM** constraints traced to a Phase 1 finding, 11 **SR** design preferences that are inferences, and 6 **DP** technology preferences. `38 §5` names the six SR items most open to challenge and states their costs.

The specific instance worth flagging to the reviewer: **SR1's strong form** — exactly one write capability rather than a small scoped set — is an inference, not a requirement. EM1, EM2 and EM8 jointly forbid models invoking external writes; they do not compel the single-tool collapse. It is taken because it makes EM9's count a `SELECT COUNT`, and its cost (every capability is a code change) is the largest velocity cost in the architecture. A reviewer who rejected SR1 would not thereby violate any EM constraint.

---

## Gate 13 — Does the architecture work for a materially different business model? *(verbatim, cited `32 §6`, `33 §9`)*

**PASS.**

`33 §9` tests four: high-margin POD, subscription/replenishables, high-value fenced digital, independent micro-SaaS. No kernel capability changes in any column. New adapters, new action classes, new escalation reasons — all of which are the intended extension mechanism under SR7.

---

## Gate 14 — Does the architecture privilege the Phase 1 lead? *(verbatim, cited `32 §6`, `33 §9`)*

**PASS.**

`21 §8`'s anti-assumption that wall art on Etsy is not the answer is honoured: the POD column in `33 §9` is not privileged, Etsy is excluded at the adapter level per its API terms (`29 §6`), and PA-API v5 does not appear. Option D was rejected on exactly this gate.

**One residual, stated for the reviewer:** micro-SaaS strains the model because tenant data isolation is a property of the product being sold rather than of ACOS's write path. That is a scope boundary, not a business-model dependency, but it is the weakest cell in the table.

---

## Gate 15 — Is the MVP small enough to build *and attack*? *(verbatim, cited `23 §11`, `31`, `32 §6`, `33 §1`)*

**PASS.**

One Postgres schema set, one control-plane deployable, eleven logical services, two adapters, three task types, six continuous invariants at MVP. No cluster, no message bus, no service mesh. ADR-003's decisive argument is that every hour of cluster operations is an hour not spent on the injection harness, and the harness is where `11 E6` and `11 E11` get their numbers.

The independent check is `10 §5`'s list of six things ACOS genuinely builds: five are kernel components here, and the sixth — the discovery loop — is explicitly not solved (ADR-020). Phase 2 has not invented scope.

---

## Summary

| Gate | Verdict |
|---|---|
| 1 Implicit business model | PASS WITH NOTE (Shopify adapter gravity) |
| 2 LLM as security boundary | PASS |
| 3 Prompt-only controls | PASS |
| 4 Compromised-model surface | PASS |
| 5 Retry duplication | PASS WITH NOTE (**ESP at-least-once sends**) |
| 6 Model in financial path | PASS |
| 7 Dependence on injection detection | PASS |
| 8 Deterministic/probabilistic separation | PASS |
| 9 Number grading | PASS WITH NOTE (two untagged engineering estimates) |
| 10 Audit suppression | PASS |
| 11 Agent replaceability | PASS |
| 12 Preference mislabelled as requirement | PASS (**and it restructured `22`**) |
| 13 Different business model | PASS |
| 14 Privileging the Phase 1 lead | PASS |
| 15 MVP small enough to attack | PASS |

**No gate failed. Three carry notes and one carries a real residual** — duplicate outbound sends under ESP at-least-once delivery, which is the one place in the architecture where a duplicate *irrecoverable* action remains possible. It is in `38 §7` as an architectural risk and in `36 §7` as a contract test.

**No document was rewritten as a result of this audit.** One clarification was added (ADR-005's process-boundary note) because a reviewer would otherwise read EM2 and ADR-005 as contradictory.
