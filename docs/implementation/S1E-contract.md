# S1E — Pre-Reservation Authority Pipeline: Contract

Baseline: `0054e5f` (S1D ACCEPTED). Branch: `feature/s1e-pre-reservation-authority`.

Architecture: `docs/architecture/v1.3.1/` — Operating Spine v1.3, package issue v1.3.1.
Treated as normative and READ-ONLY. No file under it is modified by S1E.

---

## 1. Scope

### 1.1 What S1E implements

The worker-originated **pre-reservation authority pipeline**: `26 §7`'s deterministic,
ordered, fail-closed sequence from step D through the edge that would enter step R, composed
with the accepted S1B, S1C and S1D path.

```
ProposedIntent
  → B / C / C2       accepted S1B schema, closed catalogue, constructor registry
  → C′               accepted S1C live re-enumeration under the entity advisory lease
  → D … L            NEW — S1E's authority gates
  → M                accepted S1D real in-process Cedar decision, UNCHANGED
  → N, P             NEW — S1E's autonomy and channel gates
  → PRE_RESERVATION_PASS
```

One production entry point: `PreReservationAuthorityPipeline.evaluateUnderLease`.

### 1.2 What S1E refuses to implement

Every item below is out of scope by mandate and absent from the tree. The source-rule suite
`tests/authority/authority-channel-attacks.test.ts` rule 3 asserts the absence of the first
group as a grep over `src/kernel/authority/`.

| Refused | Where it belongs |
|---|---|
| Step R — economic reservation, `window_balance` mutation, the four-term guard | the next slice |
| The rate-class standing reservation transaction | with step R |
| `AuthorizationDecision`, effect rows, reservation rows, authorisation rows | steps R–W |
| Step S — approval requirement, the `26 §12` state machine, `I60` | a later slice |
| Step R′ — approval resume, verify mode, `RESERVATION_ABSENT`, `I51` | a later slice |
| Steps T–V — idempotency mint/verify, prior-result return, `I42` | with step R |
| Step W — the signed decision; step X — the audit write | a later slice |
| Audit plane, mirror, attestations, diff, `ACOS-JCS-1` transmission | S1/S3 audit work |
| Outbox, external-effect exclusive claim, adapter dispatch, HTTP | S2–S4 |
| Vendor credentials, Shopify / Stripe / Google / Meta / ESP | S3+ |
| Reconciler, settlement, `I18d` | S3 |
| AI workers, AI CEO | S2, DEF |
| symcc | deferred past S1 by `45 §3` |
| Owner signing of Cedar artifacts (O4); `I19` continuous integrity | OPEN, unchanged |
| Enumeration journaling / quota (VC-C2's second half), `I52` CI half | S2 |
| Additional action classes | the catalogue stays at four |

---

## 2. Architecture mapping

Every implemented gate, its architecture label, its authoritative source, its enforcement
layer, its denial behaviour and its tests.

| Step | Current architecture meaning (`26 §7`) | Implementation | Authoritative source | Invariant(s) | Denial | Tests |
|---|---|---|---|---|---|---|
| **B** | Schema valid; only the five model-facing fields | *pre-existing* `canonicalisation/intent.ts` | `ProposedIntent` wire form | `I21` | `MALFORMED` | S1B suite |
| **C** | `action_class` in the closed catalogue | *pre-existing* `canonicalisation/actionCatalogue.ts` | closed catalogue (SR7) | — | `UNKNOWN_ACTION` | S1B suite |
| **C2** | Registered canonical constructor for the class | *pre-existing* `canonicalisation/registry.ts` | constructor registry | `I61` | `NOT_CANONICALISABLE` | S1B suite |
| **C′** | Canonicalise under the entity advisory lock; re-enumerate live; resolve the content-addressed selector | *pre-existing* `enumeration/liveSelector.ts` | `commerce_*`, `enumeration_record` | `I53`, `I52`, `I21` | `SELECTOR_*`, collapsed to `SELECTOR` | S1C suite; `pre-reservation-pipeline.test.ts` |
| **D** | Principal authenticated, chain signature valid, depth ≤ 3 | **NEW** `authority/principal.ts` | `principal_session`, `principal`, `principal_key`, `delegation_hop`, `authority_task` | `26 §3` rules 1–4 | `PRINCIPAL` | `pre-reservation-pipeline.test.ts` §step D (8); `authority-controls.test.ts` attack 1 |
| **E** | Categorical prohibition — unappealable | **NEW** `authority/prohibitions.ts` | `26 §6`'s table, as a frozen constant in code | `26 §7` property 1 | `PROHIBITED` | `authority-channel-attacks.test.ts` rule 6 (5); `authority-controls.test.ts` attack 4 |
| **F** | Agent profile / platform status OK; kill switch not set | **NEW** `authority/platformStatus.ts` | `company_platform_status`, `agent_profile_capability` | `I14` (profile), `26 §7` fail-closed | `PLATFORM_SUSPENDED` | `pre-reservation-pipeline.test.ts` §step F (5) |
| **G** | Fetch preconditions from the state store; the proposer does not supply | **NEW** `authority/preconditions.ts` | `action_class_precondition`, `state_fact` | `26 §7` property 3 | `PRECONDITION` | §steps G–H″ (1) |
| **H** | All preconditions RECORD / OBSERVATION and within `max_age` | **NEW** `authority/preconditions.ts` | `state_fact.grade` (generated), `max_age_seconds`, `staleness_policy` | `I5`, `I6`, `I27` | `PRECONDITION`, `STALE`, `PRECONDITION_UNCORROBORATED` | §steps G–H″ (7); `authoritative-state-integrity.test.ts` |
| **H′** | Contradiction check | **NEW** `authority/preconditions.ts` | `contradiction_link` | `I29` | `PRECONDITION_CONTRADICTED` | §steps G–H″ (3); `authority-controls.test.ts` attack 2 |
| **H″** | Delegated-grade check | **NEW** `authority/preconditions.ts` | `state_fact` grade + catalogue class shape | `I28` | `PRECONDITION_DELEGATED` | §steps G–H″ (2) |
| **I** | Matching grant exists after subset intersection | **NEW** `authority/grants.ts`, `authority/resourceSelector.ts` | `authority_grant`, `authority_grant_action_class`, `authority_grant_window`, `window_registry` | `26 §3` rule 2, `26 §4` | `NO_GRANT` | §step I (9); `authority-controls.test.ts` attack 3 |
| **J** | `recoverability ≤ grant.recoverability_max` | **NEW** `authority/recoverability.ts` | action catalogue + effective grant authority | `26 §5` | `RECOVERABILITY` | §step J (1); §step I broad/narrow pair |
| **K** | `counterparty.novelty ≤ grant limit` | **NEW** `authority/counterparty.ts` | catalogue `value_direction`; `authority_grant.counterparty_novelty_max` | `I59`, `26 §1` Corollary 1 | `NOVEL_COUNTERPARTY` | happy path (applicability); unit coverage in the gate |
| **L** | Evidence requirements: corroboration, tier, freshness, coverage | **NEW** `authority/evidence.ts` | `evidence_source`, `evidence_item`, `evidence_set`, `evidence_set_item`, `action_evidence_binding` | `24 §13`, `24 §14` | `EVIDENCE` | §step L (6); `evidence-independence.test.ts` (9) |
| **M** | `per_action_max` satisfied | *pre-existing* `policy/policyEngine.ts` — **composed, not reimplemented** | hash-committed Cedar artifacts | `26 §11` P1, SR-C1 | `PER_ACTION` | §step M (2); accepted S1D suites |
| **N** | Autonomy ledger permits this key at this level | **NEW** `authority/autonomy.ts` | `autonomy_ledger_entry`, `authority_task`, `principal.model_binding` | `I47` (runtime leg) | `REQUIRE_APPROVAL` (not a denial) | §step N (7) |
| **P** | Channel set → utterance policy `§9` | **NEW** `authority/channel.ts` | request `channel` (catalogue-derived) | `26 §9` | `UTTERANCE`, fail-closed | happy path; `steps.ts` order suite |

### 2.1 Step J — read, not guessed

`26 §7`'s flowchart edge, verbatim: `J{recoverability ≤ grant.recoverability_max?}` →
`|no| D8[DENY: RECOVERABILITY]`.

* **Name.** Recoverability ceiling.
* **Input.** `AuthorizationRequest.recoverability`, which `26 §2.1` states is "from the action
  catalogue — never from the intent", and the effective grant authority's
  `recoverability_max`.
* **Authoritative source.** `ACTION_CATALOGUE[action_class].recoverability` (`26 §5`'s worked
  assignments) and `authority_grant.recoverability_max`.
* **Invariants.** `26 §5` (assignment is per class, never per request, never by a model);
  `I21` (the left operand is unreachable from `ProposedIntent`).
* **Failure condition.** `ordinal(request) > ordinal(effective ceiling)` over
  `REVERSIBLE < COMPENSABLE < IRRECOVERABLE`.
* **Applicable on the worker path?** Yes. `26 §7.1` also marks it **Evaluated** on the
  `KERNEL_SERVICE` branch, so the gate carries no principal-kind branch.
* **Tests.** `pre-reservation-pipeline.test.ts` §step J; the broader/narrower grant pair in
  §step I; `authority-controls.test.ts` attack 3 (both implementations).

### 2.2 Step K applicability comes from the catalogue

`refund.create`'s `value_direction` is `INBOUND_ORIGINAL_INSTRUMENT` (`26 §11.2` row 3), so
`26 §1` Corollary 1 applies: "A first-time buyer receiving their own refund to their own
original instrument is not a novel counterparty." The class therefore has no counterparty and
step K's novelty comparison does not apply to it.

**That decision is read off the closed catalogue, never off the intent.** `counterparty.ts`
splits the six declared directions into outbound and non-outbound and fails closed in BOTH
directions:

* an outbound direction with a null counterparty denies `NOVEL_COUNTERPARTY`;
* a non-outbound direction carrying a counterparty denies `NOVEL_COUNTERPARTY`.

The second is `36 §2` VC-R2/VC-R3's requirement in code: "a compromised constructor declaring
an outbound class `NONE` must fail these, since it would otherwise remove the class from P4's
scope entirely."

No `destination_id` was invented. S1B.2 finding 3 removed the independently mutable
destination and S1E does not restore it: the destination is the RECORD-grade parent
transaction named by `parent_transaction_id` with `instrument`, both inside the
content-addressed `semantic_option_digest`. Split tender remains non-canonicalisable.

### 2.3 The `KERNEL_SERVICE` branch — deferred, and not a hidden route

`26 §7.1` skips steps I, K, L and N for a request whose `principal.kind == KERNEL_SERVICE`
**and whose authority is a `StandingRevocationAuthority`** (`24 §3` K5). The second condition
is the whole branch: `I55`'s revocation authority is created by the step-R transaction that
creates a `StandingAuthorization`, and S1E implements no step R.

S1E therefore:

* does **not** implement the branch;
* does **not** make `principal.kind == KERNEL_SERVICE` sufficient to reach it — a kernel
  principal traverses every worker gate, and `pre-reservation-pipeline.test.ts` asserts it
  reaches step I and denies `NO_GRANT`, which is STD-03's deadlock, unresolved;
* records the deferral rather than claiming the path complete.

Adding the branch on a kind check alone would have created exactly the "undocumented authority
bypass in the money path" `26 §7.1` was written to close.

---

## 3. Owner clarifications

1. **The S1D Cedar `PERMIT` is a policy subdecision, not final authorisation.** It is one of
   eighteen terminals in `26 §7` and it occupies step M. `decision.ts` said so at S1D and S1E
   changes nothing about it.
2. **`PRE_RESERVATION_PASS` means only "eligible to ATTEMPT step R".** It is not
   `AUTHORISED`, `RESERVED`, `APPROVED` or `DISPATCHABLE`.
3. **S1E creates no dispatchable authority.** `PreReservationQualified` carries no
   `DispatchPayload`, no `authorisationId` and no `reservationId`; the payload is held inside
   the pipeline and withheld. `tests/type-negative/prereservation-as-dispatchable.ts` makes
   the attempt a compile failure.
4. **Step R is deliberately next and is not part of S1E.**
5. **The S1C entity lease is held continuously through the whole S1E sequence**, on one
   PostgreSQL session, with no release and no reacquisition.
6. **VC-C3 remains PARTIAL.** Continuity is proven through the pre-reservation sequence; the
   propose→authorise→**execute** span is not, because its second half does not exist.
7. **Worker-facing denial stays coarse even though the kernel records the exact gate.**
   `step` and `detail` are audit-path only and are never projected.
8. **Missing authoritative state fails closed** — an absent platform-status row, an absent
   agent-profile capability, an absent precondition fact, an absent grant and an absent
   autonomy-ledger entry each refuse.
9. **No model or caller value can supply** a principal, a grade, a grant, evidence authority,
   counterparty or value-direction authority, a platform status, or a policy operand.
10. **Cedar policy artifacts remain hash-committed, not owner-signed.** O4 is unchanged and
    still OPEN.
11. **symcc remains deferred** past S1 per `45 §3`; S1E does not install it.
12. **No audit, outbox, adapter or AI work was pulled forward.**
13. **`40P01` remains a lock-order defect and is never converted into a retry.** S1E acquires
    none of the step-R money locks and introduces no new lock order.
14. **The pre-existing Vitest dependency advisory is unchanged** — S1E adds no dependency,
    removes none and changes no version. `package.json` is byte-identical to `0054e5f`.

### 3.1 S1E's own fixture decisions and interpretations

Recorded in full in `S1E-owner-clarifications.md`: S1E-C1 (the declared `refund.create`
precondition), S1E-C2 (representing the Metric Layer and Decision Registry inside `24 §6`'s
six writer kinds), S1E-C3 (the closed resource-predicate language), **S1E-C4 (multi-grant
composition — INTERSECTION, requiring owner disposition)**, S1E-C5 (the grant's
`irrecoverable_units` half omitted), S1E-C6 (`PrincipalKind` corrected to `26 §3`'s set),
S1E-C7 (no free-text audit note on the outcome record).

---

## 4. Residuals

Everything in §1.2 remains open, plus:

* **VC-C2 — OPEN**: journaling/quota half deferred to its architecture-scheduled boundary.
* **I52 — OPEN**: CI / spec-review half deferred to S2.
* **VC-C3 — PARTIAL ONLY**: lease continuity proven through pre-reservation authority; the
  full propose→authorise→execute span remains open.
* **VC-C4 — OPEN**: constructor-versioned approval resume; S1E has no resume path.
* **VC-A3 — OPEN**: independent `ACOS-JCS-1` implementation.
* **`I18b` runtime — OPEN**: no S1E-created reservation exists to check against.
* **`I18d`, `I42`, `I19`, O4 — OPEN**, unchanged.
* **`26 §7.1` KERNEL_SERVICE branch — DEFERRED**, with its prerequisite named.
* **`26 §9` utterance policy — DEFERRED**, and step P fails closed in the meantime.
