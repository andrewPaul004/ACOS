# S1H — Test Matrix

Every S1H test file, what it establishes, and the oracle it is judged against. Ordered by
what it proves rather than by directory.

**Oracle legend.** `HAND` — a hand-authored table or reading that imports nothing from
`src/`. `DB` — a real PostgreSQL constraint, trigger or grant. `CRYPTO` — real
`node:crypto` Ed25519 over real generated keys. `SOURCE` — a scan of `src/` asserting an
absence or a confinement. `DUAL` — both PostgreSQL instances, in one test.

---

## 0. What the v1.3.3 owner-resolution pass added

Five files, and no accepted S1H file was deleted or weakened. `S1H-owner-resolution.md`
carries the dispositions; the boundary of each new quantity is asserted at the finest unit
the operand can carry.

| File | Establishes | Oracle |
|---|---|---|
| `tests/mirror/degraded-mode-thresholds.test.ts` | `51 §3.7`'s `$20.00` and `51 §3.8`'s `PT15M` / `PT30M`, each against a hand-authored second transcription; the STRICT floor boundary at the minor unit; both INCLUSIVE timing boundaries at the millisecond; `PT30M > PT15M` as arithmetic; the alignment with `cadence × k` and the NON-merger with `max_age` and with every override quantity | HAND |
| `tests/mirror/dispatch-precedence-approval-floor.test.ts` | **`S1H-C1` closed.** `30 §5.1a`'s boundary table row by row in all three states; `$20.00` vs `$20.01`; `$25.01`'s distinction from the DENY bound; the full 72-row cross-product through the DERIVED operand; row 2 is reached, so the derivation is not vacuous; the absence of the boolean, of any test-only seam, and of `vendor_amount` in the classifier's executable lines | HAND + SOURCE |
| `tests/integration/mirror/full-halt-posture.test.ts` | **`S1H-C10` closed.** Every recoverability class at `29:59.999` and at `30:00.000`; the posture in `CORROBORATED_DEGRADED` and its absence in `NORMAL`; the reduction is monotone toward HALT; the timer's declared start and every declared non-reset against real PostgreSQL; the coherence guard; `§14`'s vulnerable control and its discrimination; the override reaching rows 3 and 4 and **not** row 5 | HAND + DB |
| `tests/integration/mirror/mirror-lag-critical.test.ts` | `30 §5.1a`'s lag operand from the real unmirrored backlog; the INCLUSIVE 15-minute boundary; **all four of `§15`'s "unlocks nothing" assertions over the durable tables**; the control-derived operand's exposure proven to be in the SAFE direction | DB + HAND |
| `tests/integration/audit/store-write-availability.test.ts` | **`S1H-C8` closed.** The closed three-code mapping, asserted against the DEPLOYED function definition; twenty-one excluded codes; fail-closed on everything else; the 15-minute derivation window as arithmetic; **all five of `§8`'s controls including the mandatory POSITIVE one**; the conjunct ORDERING under simultaneous injection; audit ownership and append-only | DUAL + DB + SOURCE |

| Negative control | Defect it embodies | Discriminates? |
|---|---|---|
| `tests/negative-controls/unsafe-prolonged-unreachability.ts` | the ordinary three-state table evaluated for ever — **what `b524637` shipped** | **YES**, and the two AGREE below the threshold, so the difference is the posture alone |
| `tests/negative-controls/unsafe-store-write-classifier.ts` | three mappers: any non-acceptance outcome, any thrown error, and a fail-OPEN-on-error-class SQLSTATE reader | **YES**, on all four of `§8` A–D |

---

## 1. Pure kernel — the state machine and the classifier

| File | Establishes | Oracle | Notes |
|---|---|---|---|
| `tests/mirror/mirror-state-transitions.test.ts` | `30 §5.6`'s three states; every legal transition; every illegal one; the `max_age` boundary at the millisecond | HAND | the `max_age < cadence × k` relation is asserted as ARITHMETIC over the two constants, one of which is the audit side's own transcription |
| `tests/mirror/first-match-order.test.ts` | `30 §5.1` item 4 is an ORDERED FIRST-MATCH list; `VC-A6`'s three named fixtures; no fixture matches two rows with disagreeing outcomes | HAND | the five predicates are transcribed IN THE TEST and compared to production's matched row; the row order is asserted against a literal, not read from the module |
| `tests/mirror/vc-a2-inversion.test.ts` | **`VC-A2`.** All 72 rows (24 operand combinations × 3 states) against the hand-authored disposition table, including the matched row and the tag | HAND | `tests/support/mirrorPrecedenceTable.ts` imports nothing; the suite also asserts the oracle is non-constant, so the proof is not vacuous. **v1.3.3:** the above-floor dimension is now `total_exposure` on either side of `51 §3.7`'s declared floor, so the same 72 rows prove the DERIVATION as well as the table |
| `tests/mirror/corroboration-signal-contract.test.ts` | `§7`'s eight adversarial artifacts; the freshness boundary; the signed field order | CRYPTO + HAND | every case runs real Ed25519 against real generated keys; the signing bytes are compared to the hand-authored fourth reading |

**The inversion proof, stated as the assertions that carry it.**

| Assertion | Where |
|---|---|
| For all 24 combinations, `UNCORROBORATED_STALL` is equal-or-stricter than `NORMAL` | `vc-a2-inversion.test.ts` |
| And STRICTLY stricter for at least one — so the inversion does work | same |
| Every strictly-stricter row is row 3, COMPENSABLE and clock-bearing | same |
| `CORROBORATED_DEGRADED`'s dispositions are IDENTICAL to `NORMAL`'s | same |
| Exactly the clock-bearing COMPENSABLE rows relax from `UNCORROBORATED_STALL` | same |
| Every dispatch in `CORROBORATED_DEGRADED` requires the tag; nothing else does | same |

---

## 2. The corroboration signal, end to end across two servers

| File | Establishes | Oracle |
|---|---|---|
| `tests/integration/mirror/vc-a2d-signal-authenticity.test.ts` | **`VC-A2d`.** No signal when no stall holds; the observation reads audit-owned facts; the audit DB canonicalises and the audit process signs; the bytes are bound to the stored fields; `expires_at` is bound to `max_age` by a CHECK; re-issuance is fresh on one interval; the interval is immutable except for its close; **`30 §5.6`'s whole reachability table**; a substituted key makes the state unreachable | DUAL + CRYPTO + DB |
| `tests/integration/mirror/audit-signal-ownership.test.ts` | **`§27`.** Every forbidden operation attempted as the real role: 11 against `acos_audit_replication`, 9 against `acos_audit_signal_reader`; append-only under the evaluator AND under the owner; `signal_id` never reused; the signature is produced only in `src/audit/` | DB + SOURCE |

**The reachability table, row by row.**

| `30 §5.6` outage class | Expected | Asserted how |
|---|---|---|
| Network partition | `CORROBORATED_DEGRADED` NOT reached | twice: an injected `UNAVAILABLE`, and a real pool against a closed TCP port |
| Audit store down | not reached | `observeStall` against a closed port returns `null`; nothing is published |
| Audit-plane host down | not reached | same path |
| Quota saturated | an INCIDENT, not a mode change | `AUDIT_QUOTA_SATURATED` raised; `observeStall` never returns `STORE_WRITE_REJECTED` |
| Push path degraded, read path healthy | **reached** | the full audit-issue → control-fetch → verify → consume path |

---

## 3. Durability, journaling and replay

| File | Establishes | Oracle |
|---|---|---|
| `tests/integration/mirror/mirror-state-durability.test.ts` | Every transition is journaled on the SAME chain; no unaudited boolean (FKs + CHECK); a repeated declaration is a no-op; two open declarations are impossible; replay-protection at the application AND at the primary key; a consumed signal is immutable; a rejected signal writes NOTHING; **the persisted state never disagrees with a fresh derivation**; `§38`'s four crash/restart cases | DB |

**`§38`'s crash cases.**

| Case | Result |
|---|---|
| Crash after the declaration, before any signal | reconstructs `UNCORROBORATED_STALL` |
| Crash after the signal is persisted, before the state row | reconstructs `CORROBORATED_DEGRADED` from the operands |
| Restart while the held signal is stale | reconstructs `UNCORROBORATED_STALL` |
| Failure inside the transition transaction | neither the journal row nor the corroboration survives |
| Restart with an active override | `vc-a2e-override.test.ts` (the override is read from the DB on every classification) |
| Restart after expiry / after the cap is exhausted | `vc-a2e-override.test.ts` |

---

## 4. The override

| File | Establishes | Oracle |
|---|---|---|
| `tests/integration/mirror/vc-a2e-override.test.ts` | **`VC-A2e`.** `51 §3.6`'s eight quantities agree across three transcriptions; owner authority is a real Ed25519 signature; an AI_ROLE cannot grant; a forged or post-hoc-widened grant does not verify; the scope rule is structural on both the application and the DB path; an ACTIVE override restores rows 3/4 and never 1/2; the three per-override bounds each terminate dispatch independently; counters are monotonic; the scope is fixed at creation; an override cannot be deleted; **auto-expiry is to the restrictive state, never to `NORMAL`**; the second-approver rule with all four attacks | DB + CRYPTO + HAND |
| `tests/integration/mirror/vc-a2f-override-composition.test.ts` | **`VC-A2f` / `I63(b)`.** The oracle reproduces `51 §3.6`'s worked composition; production agrees on the count leg, on class rotation, on expiry-and-recreation and on the window roll; the consumable legs are cut to 8 effects and $100.00; the safety argument is arithmetic | HAND (second implementation) |
| `tests/integration/mirror/override-count-race.test.ts` | **`§18`/`§37`.** Two concurrent claims for the final count — exactly one wins; the same at cap 3 with two consumed; ten claimants against a cap of 5 yield exactly 5; the DB refuses an over-cap counter with the application check bypassed; **the race is a REAL lock**, observed in `pg_locks` | DB, two real backends, barrier-driven |
| `tests/integration/mirror/override-cannot-widen-ceilings.test.ts` | **`§15`.** No schema field can name monetary authority; no FK reaches a money table; no source statement in `src/kernel/mirror/` or `src/kernel/clocks/` touches one; a MAXIMUM override leaves every ceiling, every `I3` term, the grant set and a recomputed `MAL_monetary` of `$300.00` byte-identical | DB + SOURCE + HAND |

**`§31`'s VC-A2d override-abuse attacks, and where each is answered.**

| Attack | Answered by |
|---|---|
| One actor repeatedly recreates overrides | `I63_COMPOSITION_COUNT` — `vc-a2f`, `vc-a2f-...-unbounded` |
| Same approver acts as "second" approver | `override_second_approver_is_distinct` — `vc-a2e` |
| Same credential under another display name | `OVERRIDE_SECOND_APPROVER_SHARES_CREDENTIAL` — `vc-a2e` |
| Rotate recoverability / action classes to evade the count | the aggregate is class-blind — `vc-a2f` |
| Expire and recreate to evade the duration cap | every candidate window is checked — `vc-a2f` |
| Forged or stale audit signal combined with an override | the signal is refused before any override is consulted — `vc-a2d-signal-replay` |
| Override attempts `IRRECOVERABLE` scope | no grant path admits it — `vc-a2e` |
| Override attempts to modify ceilings | schema, source, cryptography and behaviour — `override-cannot-widen-ceilings` |
| A model requests an override | `OVERRIDE_PRINCIPAL_NOT_OWNER`; no `isOwner` parameter exists — `vc-a2e` |

---

## 5. `I56` and `I17f`

| File | Establishes | Oracle |
|---|---|---|
| `tests/integration/mirror/i56-clock-provenance.test.ts` | All four declared source kinds resolve and can start a clock; the statute set is closed; an unresolvable citation is refused by the application AND by the FK; no OBSERVATION / CLAIM / `DECISION_DELEGATED` grade is STORABLE; a retained record is immutable; liveness at and past the deadline; **the negative control — a triage worker classifying 50 cases creates ZERO clocks**; and TA-08's deferral asserted as the current behaviour | DB + SOURCE |
| `tests/integration/mirror/i17f-attestation-divergence.test.ts` | **`I17f(b)`.** Declaration arrives → silent; declaration cannot be pushed → fires; control lies by not declaring → fires IDENTICALLY; the finding claims NO attribution; the signal exists independently; the detector refuses and halts nothing; evaluation is separable from recording; **`(a)` and `(c)`'s operands are asserted ABSENT** | DUAL + DB |

**`§13`'s four cases, and what the suite refuses to claim.**

| Case | Divergence | Attribution |
|---|---|---|
| Declaration reaches the audit plane | silent | — |
| Declaration does not reach it because transport is down | FIRES | **NONE**, and the finding says so |
| Control lies by not declaring | FIRES, identically | **NONE** |
| The audit signal exists independently | asserted via `observed_by` = the audit evaluator | — |

---

## 6. Canonicalisation and the journal

| File | Establishes | Oracle |
|---|---|---|
| `tests/integration/mirror/mirror-journal-rows.test.ts` | One counter, one chain, one transport across all five row kinds; the chain links across kinds; the two allocators agree; **`VC-A3` extended** — control bytes, audit bytes and a hand-authored fourth reading agree for each new kind; the ACCEPTED kinds still hash as before; **`§29`: no JSON column on either plane**; the per-kind shape is a DB constraint; the three discriminator enums are closed; **`S1H-C4`'s hole is closed and `mirrored_at` is still settable** | DUAL + HAND + DB |

---

## 7. The boundary

| File | Establishes | Oracle |
|---|---|---|
| `tests/integration/mirror/no-dispatch-boundary.test.ts` | The classifier returns a disposition with no payload; it is pure; **no HTTP, fetch or socket anywhere in `src/`**; no adapter module, outbox, exclusive claim, vendor read or anchor; no `DISPATCHED` state; the mirror mechanism is CONFINED to four directories; the local authorisation transaction cannot see the mirror; no `src/` file imports from `tests/`; neither schema has a dispatch surface; `§41`'s open items are asserted as absences | SOURCE + DB |
| `tests/integration/authority/local-authorisation-boundary.test.ts` (AMENDED) | `I17b`'s external anchor is still absent; **and the pre-R authority path cannot reach the mirror at all** | SOURCE |

---

## 8. The mandatory vulnerable controls

`36 §0`: a pass with no discriminating control is indistinguishable from a test that does
not exercise the property.

| Control | Unsafe result | Production result | Discriminates? |
|---|---|---|---|
| `unsafe-mirror-state-machine.ts` — `unsafeSelfDeclaredResolver` (`§33`) | declaration alone → `CORROBORATED_DEGRADED`; clock-bearing refund DISPATCH_ELIGIBLE | `UNCORROBORATED_STALL`; the same refund SUSPENDED | **YES** |
| `unsafe-mirror-state-machine.ts` — `unsafeSignatureOnlyResolver` (`§32`) | a genuine signal replayed at 4× `max_age` → `CORROBORATED_DEGRADED` | `SIGNAL_STALE`; state stays `UNCORROBORATED_STALL` | **YES** |
| `unsafe-precedence-order.ts` — `UNSAFE_ROW_4_BEFORE_ROW_3` (`§22`) | the clock-bearing refund SUSPENDS at row 4 | DISPATCHES at row 3 | **YES** |
| `unsafe-precedence-order.ts` — `UNSAFE_ROW_3_BEFORE_ROW_2` (`§22`) | identical to production at all four S1 action classes | — | **NO, and the suite records that** |
| `unsafe-override-composition.ts` (`§34`) | 10 overrides admitted → 240 h, 50 effects, $500.00; 60 → 1440 h | 3 admitted; the 4th refused `I63_COMPOSITION_COUNT` | **YES** |

**Test files that run them.**

| File | Control |
|---|---|
| `tests/negative-controls/vc-a2-self-declared-degradation.test.ts` | self-declared degradation, plus the cross-product both ways |
| `tests/negative-controls/vc-a2d-signal-replay.test.ts` | signature-without-freshness, on a genuine end-to-end signal |
| `tests/negative-controls/vc-a2f-override-composition-unbounded.test.ts` | per-override-only admission |
| `tests/mirror/first-match-order.test.ts` | both row permutations |

**Each control is SHARP, and that is asserted.** The self-declared machine agrees with
production when no declaration is open. The signature-only machine agrees on a FRESH
signal, on a forged signature and on a wrong company — only freshness differs. The
per-override-only admission correctly REFUSES a genuinely over-long, over-count or
over-cap single override. A control that differed everywhere would isolate nothing.

---

## 9. Accepted tests amended, and why each amendment is additive

| File | Amendment | Why it is not a weakening |
|---|---|---|
| `tests/negative-controls/vc-a1d-adversarial-attester.test.ts` | the audit evaluator's visible-table list goes from 3 to 5 | both new tables are written by the audit plane's OWN evaluator from its OWN holdings, neither is an input ABOUT the control journal, and neither settles the `§5.5` case 2b residual. The property — no vendor table, no replica, no control read — is unchanged and still asserted |
| `tests/integration/authority/local-authorisation-boundary.test.ts` | the mirror-absence assertion is replaced | S1H builds the mirror machine, which `37` S1 puts in this slice. The mirror half MOVES to `no-dispatch-boundary.test.ts` as CONFINEMENT, `I17b`'s anchor absence STAYS, and a NEW stricter assertion is added: the pre-R authority path cannot reach the mirror |

**No accepted test was deleted. No accepted assertion was relaxed.** The two amendments
above are the only changes to accepted test files.

---

## 10. Self-validation audit — `§39`, clause by clause

| Forbidden | Status |
|---|---|
| Expected state generated from the production transition table | **not done.** `mirrorPrecedenceTable.ts` and the state expectations are hand-authored literals |
| Expected precedence generated by the production rule list | **not done.** `expectedFor` is a hand-written sequence of `if`s from `30 §5.1`; the row order is asserted against a literal in the test file |
| Expected signal age calculated by the production verifier | **not done.** Every boundary instant is computed from `T0` and the literal `300000` |
| Expected override limit read from the production state-machine object | **not done.** `ORACLE_LIMITS` is hand-transcribed from `51 §3.6` and imports nothing; the aggregate is a second implementation |
| Testing a signature by calling the same signer/verifier as both oracle sides | **not done.** The audit DB canonicalises, the control TS canonicalises, and `jcs1Oracle.ts` is the third reading. The end-to-end test in `vc-a2d-signal-authenticity.test.ts` uses the real audit issuer and the real control verifier and compares both to the oracle |
| Using worker/model fixture values as authoritative clock truth | **not done.** `i56-clock-provenance.test.ts`'s triage outputs are DATA with no path to a clock |

**One place where a test helper does sign with the control-side byte builder**, and why it
is not a violation: `signalSignedWith` in `tests/support/mirrorFixture.ts` takes the byte
function as a parameter and is used to construct the ARTIFACT-LEVEL negative cases — a
"modified timestamp after signing" fixture needs a signature that was valid before the
modification. What those cases test is the verifier's DECISION, not the signature
mechanism. The mechanism is tested end to end against the audit database's independent
construction, in `vc-a2d-signal-authenticity.test.ts`, which does not use the helper.

---

## 11. Real-PostgreSQL and dual-PostgreSQL coverage

| Property | Instances | File |
|---|---|---|
| Mirror-state persistence and reconstruction | control | `mirror-state-durability.test.ts` |
| Signal issuance, signing and fetch | **both** | `vc-a2d-signal-authenticity.test.ts` |
| Audit ownership of the signal (grants) | audit | `audit-signal-ownership.test.ts` |
| `I17f(b)` from audit holdings | **both** | `i17f-attestation-divergence.test.ts` |
| `ACOS-JCS-1` cross-implementation, new kinds | **both** | `mirror-journal-rows.test.ts` |
| Override counters, caps and aggregate | control | `vc-a2e-override.test.ts`, `vc-a2f-...` |
| Concurrent final-count claim | control, two backends | `override-count-race.test.ts` |
| `I56` schema and provenance | control | `i56-clock-provenance.test.ts` |
| No dispatch surface | **both** | `no-dispatch-boundary.test.ts` |
| Signal replay end to end | **both** | `vc-a2d-signal-replay.test.ts` |
| Override composition | control | `vc-a2f-...-unbounded.test.ts` |
| **FULL-HALT POSTURE and the timer's reset semantics** (v1.3.3) | control | `full-halt-posture.test.ts` |
| **The mirror-lag operand and its four non-effects** (v1.3.3) | control | `mirror-lag-critical.test.ts` |
| **`STORE_WRITE_REJECTED`'s derivation, its four exclusions and its positive control** (v1.3.3) | **both** | `store-write-availability.test.ts` |

No in-memory mutex, no mocked database and no simulated lock appears anywhere in the S1H
suite. The one place a delay is injected is the barrier hook in
`claimOverrideAllowanceOn`, which is a test-only parameter and is `36 §14`'s own
prescription: "targeted interleaving with injected delays, not throughput".
