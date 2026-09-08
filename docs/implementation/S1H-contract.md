# S1H — Contract

**Slice:** the mirror state machine, the corroboration signal, and bounded degraded-mode
authority.
**Baseline:** `e47a437` (S1G ACCEPTED).
**Branch:** `feature/s1h-mirror-state-machine`.
**Architecture:** `docs/architecture/v1.3.2/`, **unmodified**. Underlying architecture is
Operating Spine v1.3; authoritative package issue is v1.3.2.

---

## 1. Where the slice begins and ends

S1G ended at **`26 §7` step X — the audit write**, and stopped before `30 §5.1`'s third
arrow.

S1H implements the **state and decision machinery that arrow requires**, and stops before
the arrow itself.

```
BEGIN … COMMIT                       -- durable, locally chained, gap-free      S1F
  ↓
push to audit store                  -- async, retried, quota-bounded, idempotent  S1G
  ↓
[ mirror state machine · corroboration signal · precedence classifier ]         S1H
  ↓
dispatch, per (4)                    -- NOT BUILT
```

**There is no external dispatch, no outbox, no exclusive claim, no adapter, no vendor read
and no `DISPATCHED` state in this slice.** `no-dispatch-boundary.test.ts` asserts each as
an absence over the whole of `src/` and both schemas.

What S1H adds, conceptually:

```
audit holdings / attestation continuity
  → audit-published MIRROR_INPUT_STALL interval
  → audit-signed MirrorInputStallSignal                    (Ed25519, audit key)
  → control-side fetch over a distinct read credential      (pull only, fail closed)
  → control-side verification against its OWN canonical bytes
  → consumption, journaled and replay-protected
  → NORMAL | UNCORROBORATED_STALL | CORROBORATED_DEGRADED
  → optional bounded DegradedModeOverride                   (owner Ed25519, I63)
  → deterministic PRE-DISPATCH disposition                  (30 §5.1 item 4)
```

---

## 2. Architecture → implementation → owner → trust boundary → validation

| Architecture item | Implementation | DB owner | Trust boundary | Validation |
|---|---|---|---|---|
| `30 §5.6` — three states, inverted | `src/kernel/mirror/mirrorState.ts` (pure) | — | total function of durable facts + clock | `mirror-state-transitions.test.ts` |
| `30 §5.6` — durable state, re-derived every evaluation | `mirrorStateMachine.ts`; `mirror_declaration`, `mirror_corroboration`, `mirror_state` (0009) | control | the cache is never authority; every read re-derives | `mirror-state-durability.test.ts` |
| `30 §5.6` — declaration alone reaches only the STRICTER state | `resolveMirrorState`; no authority check on `declareMirrorDegraded` | control | there is nothing to gain by lying | `vc-a2-inversion.test.ts`, `vc-a2-self-declared-degradation.test.ts` |
| `30 §5.7` — `AUDIT_MIRROR_DEGRADED` is a journal row | `emit_mirror_declaration` (0009), row kind on `effect_journal` | control | same counter, same chain, same transport | `mirror-journal-rows.test.ts` |
| `30 §5.7.1` — the signal's ten declared fields | `audit_mirror_input_stall_signal` (A0002) | audit (`acos_audit_owner`) | the control plane holds no privilege on it | `audit-signal-ownership.test.ts` |
| `30 §5.7.1` — Ed25519 over `ACOS-JCS-1` bytes | `audit_mirror_signal_canonical_bytes` (A0002) + `issueSignal` | audit | the private key is a parameter of `src/audit/` only | `vc-a2d-signal-authenticity.test.ts` |
| `30 §5.7.1` — signed bytes bound to the stored fields | `audit_mirror_signal_bind_bytes` trigger | audit | a signature over unre-derived bytes is refused at insert | `vc-a2d-signal-authenticity.test.ts` |
| `30 §5.7.1` — control-side verification | `corroborationSignal.ts`, real `node:crypto` Ed25519 | control (verify only) | the verifier BUILDS the bytes; it never receives them | `corroboration-signal-contract.test.ts` |
| `30 §5.7.1` — `max_age` = 5 minutes, both conjuncts | `SIGNAL_MAX_AGE_MS`, `isCorroborationFresh` | control clock | evaluated at EVERY state evaluation | `mirror-state-transitions.test.ts`, `vc-a2d-signal-replay.test.ts` |
| `30 §5.7.1` — replay protection on `signal_id` | `mirror_corroboration` PK + `emit_mirror_corroboration_consumed` | control | uniqueness is the constraint, not the check | `mirror-state-durability.test.ts` |
| `30 §5.7.1` — pull only, read-only credential | `signalSource.ts` port + `corroborationFetch.ts` adapter + `acos_audit_signal_reader` | audit grants | one method, and it reads | `audit-signal-ownership.test.ts` |
| `30 §5.6` reachability table | `SignalFetch`'s three outcomes; `UNAVAILABLE` ≡ no corroboration | — | fail closed; nothing fabricates corroboration | `vc-a2d-signal-authenticity.test.ts` |
| `30 §5.1` item 4 — ordered first-match precedence | `dispatchPrecedence.ts` (pure), rows as a literal array | — | authoritative operands only; no model input | `first-match-order.test.ts`, `vc-a2-inversion.test.ts` |
| `22 §3.1` — state-qualified precedence | the same classifier, state as the outer discriminator | — | — | `vc-a2-inversion.test.ts` (72 rows) |
| `36 §6` — every dispatch tagged in `CORROBORATED_DEGRADED` | `requiresUnmirroredTag` | — | a deterministic PROPERTY, not a tag on anything | `vc-a2-inversion.test.ts` |
| `30 §5.7.2` — `DegradedModeOverride` as kernel state | `degraded_mode_override` (0009) + `degradedModeOverride.ts` | control | owner Ed25519 over the grant's canonical bytes | `vc-a2e-override.test.ts` |
| `30 §5.7.2` scope rule — rows 3/4, no `IRRECOVERABLE` | `override_recoverability_classes_bounded`, `override_precedence_rows_bounded` | control | STRUCTURAL: no grant path admits it | `vc-a2e-override.test.ts` |
| `51 §3.6` — eight quantities | `degraded_mode_override_limits()` + `OVERRIDE_LIMITS` + hand-authored oracle | control | three transcriptions, asserted equal | `vc-a2e-override.test.ts` |
| `I63(a)` — per-override bound | CHECK constraints + `overrideCovers` + `claimOverrideAllowanceOn` | control | DB is authoritative; the app gives the legible refusal | `vc-a2e-override.test.ts`, `override-count-race.test.ts` |
| `I63(b)` — rolling 30-day aggregate | `degraded_mode_override_aggregate_bound` constraint trigger + `projectedAggregateBreach` | control | every candidate window, not one look-back | `vc-a2f-override-composition.test.ts` |
| `30 §5.7.2` item 9 — distinct second approver | `degraded_mode_override_second_approver` trigger | control | distinct ROW, distinct KIND, distinct REGISTERED KEY | `vc-a2e-override.test.ts` |
| `30 §5.7.2` item 4 — expiry to the restrictive state | `expireOverrides` → `evaluateStateOn` | control | `NORMAL` is unreachable from an expiry | `vc-a2e-override.test.ts` |
| `30 §5.7.2` item 1 — changes no ceiling | no money relation named anywhere in the module | control | schema, source and behaviour | `override-cannot-widen-ceilings.test.ts` |
| `I56` / `30 §9.1` — clock provenance | `retained_source_record`, `statutory_clock` (0009) + `statutoryClock.ts` | control | NOT NULL FK; `provenance = 'RECORD'` is the only admissible value | `i56-clock-provenance.test.ts` |
| `I17f(b)` — `ATTESTATION_DIVERGENCE` | `src/audit/attestationDivergence.ts` + incident kind (A0002) | audit | a DETECTOR; it refuses nothing and attributes nothing | `i17f-attestation-divergence.test.ts` |
| `30 §5.3` — `ACOS-JCS-1` for three new kinds, both planes | `0009` + `A0002`, independently transcribed | both | judged by a hand-authored fourth reading | `mirror-journal-rows.test.ts` |
| `S1H-C4` — the S1G immutability hole | `effect_journal_immutable_except_mirrored_at`, now total | control | strictly more refusing than the accepted trigger | `mirror-journal-rows.test.ts` |

---

## 3. The state machine

`30 §5.6`'s three states, and every legal transition.

| From | Input | To | Durable state written | Journal row |
|---|---|---|---|---|
| — | first evaluation, nothing declared | `NORMAL` | `mirror_state` | none |
| `NORMAL` | control observes the mirror unreachable | `UNCORROBORATED_STALL` | `mirror_declaration` (open) + `mirror_state` | `AUDIT_MIRROR_DEGRADED` / `OPENED` |
| `UNCORROBORATED_STALL` | a valid, fresh, unconsumed signal is consumed | `CORROBORATED_DEGRADED` | `mirror_corroboration` + `mirror_state` | `MIRROR_CORROBORATION_CONSUMED` |
| `CORROBORATED_DEGRADED` | the held signal passes `max_age` | `UNCORROBORATED_STALL` | `mirror_state` | none — a re-derivation, not an act |
| `UNCORROBORATED_STALL` | control observes the mirror acknowledging | `NORMAL` | `mirror_declaration` (closed) + `mirror_state` | `AUDIT_MIRROR_DEGRADED` / `CLOSED` |
| `CORROBORATED_DEGRADED` | control observes the mirror acknowledging | `NORMAL` | as above; the held signal is reported as an anomaly | `AUDIT_MIRROR_DEGRADED` / `CLOSED` |

**Illegal, and refused.**

| Attempt | Refused by |
|---|---|
| declaration alone → `CORROBORATED_DEGRADED` | `resolveMirrorState`; there is no such branch |
| unsigned / forged / wrong-key signal → `CORROBORATED_DEGRADED` | `verifyCorroborationSignal`, real Ed25519 |
| another company's signal | `SIGNAL_WRONG_COMPANY` |
| stale signal, or exactly at `observed_at + max_age` | `SIGNAL_STALE` (the second conjunct is strict) |
| future-dated signal | `SIGNAL_FUTURE_DATED` (`S1H-C6`) |
| replay of a consumed `signal_id` | `mirror_corroboration` primary key |
| a persisted `CORROBORATED_DEGRADED` outliving its signal | every read re-derives |
| `mirror_state = CORROBORATED_DEGRADED` with no basis signal | `mirror_state_corroborated_names_a_signal` |
| two open declarations | `mirror_declaration_one_open_per_company` |
| rewriting a consumed signal's `expires_at` | `APPEND_ONLY_TABLE_mirror_corroboration` |

---

## 4. The three new journal row kinds — DECLARED FIELD ORDERS

`30 §5.3` requires the order to be *"declared per row kind, in the specification"*. The
architecture mandates that these facts be journaled (`30 §5.7`, `§5.7.1`, `§5.7.2` item 7)
without declaring a byte order for them. **These three declarations are the
specification**, as 0008's was for `JOURNAL_ATTESTATION`. `S1H-C9` records that.

Every field is a SCALAR. No JSON column reaches a hashed field on either plane, so
`ACOS-JCS-1`'s RFC-8785 leg is not engaged and S1G's position is preserved rather than
extended (`§29` of the S1H mandate). `mirror-journal-rows.test.ts` asserts it as a schema
property on both servers.

### 4.1 `AUDIT_MIRROR_DEGRADED`

Domain tag `acos.journal.audit_mirror_degraded.v1`.

| # | Field | `ACOS-JCS-1` type |
|---|---|---|
| 1 | the domain tag | text |
| 2 | `company_id` | text |
| 3 | `journal_seq` | int |
| 4 | `journal_row_kind` | text |
| 5 | `mirror_declaration_id` | text |
| 6 | `mirror_declaration_event` — `OPENED` \| `CLOSED` | text |
| 7 | `mirror_observed_reason` — `PUSH_ACK_TIMEOUT` \| `PUSH_PATH_UNREACHABLE` \| `AUDIT_STORE_WRITE_REJECTED` | text |
| 8 | `occurred_at` | ts |
| 9 | `prev_hash` | bytes |

### 4.2 `MIRROR_CORROBORATION_CONSUMED`

Domain tag `acos.journal.mirror_corroboration_consumed.v1`.

| # | Field | Type |
|---|---|---|
| 1 | the domain tag | text |
| 2 | `company_id` | text |
| 3 | `journal_seq` | int |
| 4 | `journal_row_kind` | text |
| 5 | `corroboration_signal_id` | text |
| 6 | `corroboration_interval_start` | ts |
| 7 | `corroboration_observed_at` | ts |
| 8 | `corroboration_expires_at` | ts |
| 9 | `corroboration_reason` | text |
| 10 | `occurred_at` | ts |
| 11 | `prev_hash` | bytes |

### 4.3 `DEGRADED_MODE_OVERRIDE_EVENT`

Domain tag `acos.journal.degraded_mode_override_event.v1`. `override_event` is the closed
set `30 §5.7.2` item 7 enumerates: `REQUESTED`, `GRANTED`, `SECOND_APPROVED`,
`ALLOWANCE_TAKEN`, `EXHAUSTED`, `EXPIRED`, `REVOKED`.

**The cap-decrement event is named `ALLOWANCE_TAKEN`, not `CLAIMED`.** `25 §7` layer 4's
outbox owns the `CLAIMED` literal — `I36`'s at-most-once EXCLUSIVE CLAIM on an external
effect — and `local-authorisation-boundary.test.ts` forbids that literal anywhere in `src/`
until the outbox exists. `30 §5.7.2` item 7 names the obligation ("each cap decrement") and
not the identifier, so the identifier is S1H's (`S1H-C9`), and it says what actually
happens: `§18`'s pre-dispatch override allowance is taken against a counter, and nothing is
claimed externally.

| # | Field | Type |
|---|---|---|
| 1 | the domain tag | text |
| 2 | `company_id` | text |
| 3 | `journal_seq` | int |
| 4 | `journal_row_kind` | text |
| 5 | `override_id` | text |
| 6 | `override_event` | text |
| 7 | `override_actor` | text |
| 8 | `occurred_at` | ts |
| 9 | `prev_hash` | bytes |

---

## 5. The corroboration signal — DECLARED SIGNED FIELD ORDER

Domain tag `acos.mirror_input_stall_signal.v1`. `30 §5.7.1`: *"Ed25519 over `ACOS-JCS-1`
canonical bytes **of the fields above**"* — so `signature` is not a member, exactly as
`row_hash` is not a member of a journal row's bytes. The order is the order `§5.7.1`
prints the struct in.

| # | Field | Type |
|---|---|---|
| 1 | the domain tag | text |
| 2 | `signal_id` | text |
| 3 | `company_id` | text |
| 4 | `observed_at` | ts |
| 5 | `interval_start` | ts |
| 6 | `last_attestation_seq` | int |
| 7 | `last_attestation_received_at` (nullable — `S1H-C5`) | ts |
| 8 | `reason` | text |
| 9 | `expires_at` | ts |
| 10 | `audit_instance_id` | text |

**Three production implementations and one oracle.** `A0002`'s
`audit_mirror_signal_canonical_bytes` (audit SQL, `audit_jcs1_*`);
`corroborationSignal.ts`'s `signalSigningBytes` (control TypeScript, the accepted
`ACOS-JCS-1` module); and `tests/support/jcs1Oracle.ts`'s `stallSignalFields`, which
imports nothing and is the judge.

**Declared quantities, transcribed and not invented.**

| Quantity | Value | Source |
|---|---|---|
| `max_age` | 5 minutes | `30 §5.7.1` table |
| `attestation_cadence` | 5 minutes | `30 §5.4` |
| `k` | 3 | `30 §5.4` |
| `k × cadence` | 15 minutes | `30 §5.4`, `I17e` operand block |
| Freshness rule | `now − observed_at ≤ max_age` **and** `now < expires_at` | `30 §5.7.1` |
| Signature | Ed25519, 64 bytes | `30 §5.7.1` |
| Reason enum | `ATTESTATION_STALL` \| `PUSH_PATH_UNREACHABLE` \| `STORE_WRITE_REJECTED` | `30 §5.7.1` |

---

## 6. The precedence classifier

`30 §5.1` item 4, as an ordered array of five predicates, evaluated first-match, inside the
declared state. `22 §3.1`'s state columns:

| Row | Condition | `NORMAL` | `UNCORROBORATED_STALL` | `CORROBORATED_DEGRADED` |
|---|---|---|---|---|
| 1 | `recoverability == IRRECOVERABLE` | HALT | HALT | HALT |
| 2 | above the approval floor, not clock-bearing, no recorded approval | HALT | HALT | HALT |
| 3 | clock-bearing **and** COMPENSABLE | DISPATCH | **SUSPEND** | DISPATCH, tagged |
| 4 | COMPENSABLE, discretionary | SUSPEND | SUSPEND | SUSPEND |
| 5 | `recoverability == REVERSIBLE` | DISPATCH | DISPATCH | DISPATCH, tagged |

**Authoritative operands, and where each comes from.**

| Operand | Provenance |
|---|---|
| `mirrorState` | `mirrorStateMachine.ts`, from `mirror_declaration` + `mirror_corroboration` |
| `recoverability` | `ACTION_CATALOGUE[action_class]` — `26 §5`, never per request, never by a model; `I21` makes it type-level unreachable |
| `clockBearing` | a LIVE `statutory_clock` citing a retained RECORD-grade artifact (`I56`) |
| `aboveApprovalFloor` | `26 §12`'s approval gate. **The numeric floor is undeclared — `S1H-C1`.** |
| `hasRecordedApproval` | the effect's `approval_id`, kernel state since S1F |
| `activeOverride` | `degraded_mode_override`, `ACTIVE`, in-window, owner-signed |
| `now` | the control database clock (`36 §6`) |

**Output.** `DISPATCH_ELIGIBLE | SUSPEND | HALT`, plus `matchedRow`,
`requiresUnmirroredTag`, `overrideId` and `ownerOverrideAvailable`. **No payload, no
adapter, no endpoint, no claim.**

---

## 7. The override

`30 §5.7.2`'s entity, and `51 §3.6`'s eight quantities.

| Quantity | Value | Enforcement |
|---|---|---|
| `max_override_duration` | 24 hours | `override_duration_bounded` CHECK + `requireGrantableScope` |
| `max_override_effect_count` | 5 | `override_effect_count_cap_bounded` CHECK |
| `max_override_monetary_exposure` | $50.00 | `override_monetary_cap_bounded` CHECK |
| `max_override_count` (30d) | 3 | `degraded_mode_override_aggregate_bound` trigger |
| `max_cumulative_override_hours` (30d) | 72 hours | the same trigger |
| `max_cumulative_override_effects` (30d) | 8 | the same trigger + `projectedAggregateBreach` |
| `max_cumulative_override_monetary` (30d) | $100.00 | the same trigger + `projectedAggregateBreach` |
| `second_approver_required_from` | the 2nd override in 30 days | `degraded_mode_override_second_approver` trigger |
| grantable `recoverability_classes` | ⊆ {COMPENSABLE, REVERSIBLE} | CHECK; `IRRECOVERABLE` has no grant path |
| grantable `precedence_rows` | ⊆ {3, 4} | CHECK; rows 1 and 2 unreachable |

**Owner authority is a real Ed25519 signature.** `26 §3` rule 1's mechanism, built at S1E:
the principal is resolved from `principal`, its key from `principal_key`, and the signature
is verified with `node:crypto` over the grant's `ACOS-JCS-1` canonical bytes. Every bound
the owner consents to is a SIGNED FIELD, so a handler that widened one produces a signature
that no longer verifies. **There is no `isOwner` parameter anywhere in the slice.**

**Second-approver distinctness has three legs.** A distinct row (`second_approver <>
granted_by`, CHECK); `kind = 'OWNER'` and `status = 'ACTIVE'` for both (trigger); and
**distinct `principal_key.public_key`** — so two display names sharing one credential are
refused (trigger).

---

## 8. Owner clarifications, restated

The full record is `S1H-owner-clarifications.md`. In brief:

1. **`S1H-C1` — the per-action approval floor has no declared numeric value.** Row 2's
   behaviour is implemented and tested; the operand's derivation is PARTIAL.
2. **`S1H-C2` — `30 §5.6`'s three entry conditions are not disjoint as written.** The
   stricter partition reading was taken; no authority differs between the readings.
3. **`S1H-C3` — `I63(b)`'s "all records" includes `REVOKED` and `EXPIRED`.** Fail-closed.
4. **`S1H-C4` — an S1G immutability hole was found and closed.** The attested prefix of a
   chained journal row was mutable in the control database.
5. **`S1H-C5` — `last_attestation_received_at` is nullable**, meaning "never attested".
6. **`S1H-C6` — a future-dated signal is REFUSED**, which is an addition to the declared
   conjunction and strictly stricter than it.
7. **`S1H-C7` — "rows 3 or 5 once approved" is imprecise**; "never row 2" is operative.
8. **`S1H-C8` — `STORE_WRITE_REJECTED` has no declared derivation.** Never issued. PARTIAL.
9. **`S1H-C9` — the three new byte orders are implementation declarations.**
10. **`S1H-C10` — the mirror-lag and prolonged-unreachability thresholds are undeclared.**
    The FULL-HALT POSTURE is NOT IMPLEMENTED. OPEN.
11. **`S1H-C11` — the override's scope rule is stated over rows, not states.** Implemented
    over rows; the `I17f(a)`-in-partition tension is reported, not resolved.
12. **`S1H-C12` — `I8`'s verification list cannot be populated at S1**, per `37` S1.

---

## 9. What S1H does NOT do

`no-dispatch-boundary.test.ts` asserts each of these as an absence in `src/` and in both
schemas:

* external dispatch, the adapter, the HTTP call, the vendor's own idempotency;
* the outbox and `I36`'s exclusive claim (`37` S4);
* any `DISPATCHED` effect state, and any `dispatched_at` column;
* the runtime `DISPATCHED_UNMIRRORED` TAG on a real effect — `requiresUnmirroredTag` is a
  deterministic property of a decision, which `§35` of the mandate permits;
* `I17f(a)` and `I17f(c)`, whose operands are dispatched effects;
* external anchoring (`I17b`, `30 §5.8`), `37` S3's;
* `I8`'s inverse sweep and the audit plane's own vendor credentials (`37` S3);
* the FULL-HALT POSTURE of `30 §5.1` item 5 — threshold undeclared, `S1H-C10`;
* reconciliation, settlement, `I8`'s vendor-side inverse sweep;
* approval resume, `R′`, `I51`'s runtime leg, `I60`, `VC-C4`;
* standing-revocation execution, the reaper, `I32`;
* `I19`'s runtime control-artifact hash verification, including class 24 (the audit public
  key) and class 25 (the override limit set);
* production owner-signature key management, and the class-20 residual;
* the HTTP endpoint of `30 §5.7.1` and the provisioned audit signing key;
* the audit plane's separate provider or account;
* TA-08's clock uniqueness, content collapse and volume anomaly bound (`S5`);
* AI CEO, AI workers, symcc, Cedar `O4`.
