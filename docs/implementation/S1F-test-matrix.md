# S1F — Test Matrix

Every S1F suite, what it proves, and the ORACLE it proves it against. The last column is the
one that matters: `36 §0`'s discipline and `46 R1` — *"a test that calls the same function
twice proves nothing."*

---

## 1. The suites

| Suite | Real Postgres | Proves | Oracle |
|---|---|---|---|
| `tests/integration/authority/local-authorisation-pipeline.test.ts` | yes | `26 §7` D–W end to end; all four things `33 §1` names are committed; runtime `I18b`; every referenced instance bound; the S1A guard actually moved; the decision is really signed; SERIALIZABLE observed | hand-authored `$9.41 + $0.59 = $10.00`; hand-authored window list; hand-authored `journal_seq = 1`; signature verified against independently reconstructed fields |
| `tests/integration/authority/local-transaction-atomicity.test.ts` | yes | the kill-point matrix — eleven declared points, ordinary + rate + approval; nothing persists after any abort; one transaction in `src/`; no transport | direct SQL sweep over eleven tables from a SEPARATE connection; `journal_counter.next_seq` back to `1`; source scans |
| `tests/integration/authority/multi-window-binding.test.ts` | yes | every referenced window binds, in BOTH directions; total rollback on any failure; exact boundary and one-cent-over; realised and count ledgers participate; UNION composition; a unioned window can deny; intersection narrows before R; the declared lock order, observed | hand-authored `$50.00`/`$250.00` ceilings and pre-loaded realised figures; hand-authored expected lock sequence; the single-window vulnerable control |
| `tests/integration/authority/local-idempotency.test.ts` | yes | `I42`'s DB half; the same intent twice; a semantically distinct effect does not collide; a duplicate consumes exposure once; the duplicate's own authorisation row is released too; R precedes T; the lease serialises concurrent attempts; the constraint is the backstop | direct SQL row counts and `reserved_monetary` reads; source scan of `idempotency.ts`; two RAW concurrent inserts with the lease bypassed; the read-then-write vulnerable control |
| `tests/integration/authority/journal-sequencing.test.ts` | yes | the chain from 32 zero bytes; row 2 chains from row 1; the row hash equals an INDEPENDENTLY framed digest; `I17d`; immutability except `mirrored_at`; non-contiguous sequences refused; gap-freedom under rollback, concurrency and `40001`; no `40P01` on the declared order | an `ACOS-JCS-1` framer HAND-WRITTEN IN THE TEST FILE from `30 §5.3`'s table; hand-authored sequence integers; the reversed-lock-order vulnerable control |
| `tests/integration/authority/rate-class-local-authorisation.test.ts` | yes | VC-S7 through S1F; the zero-amount row is real; `forward_integral` never in the ordinary amount on ANY row; term 1 = `$0.00`, term 2 = the whole economics; `I55` creation and scoping; no revocation path in `src/` | `26 §2.1.3`'s worked January figures, transcribed (`$186.00`, `$12.00`); hand-authored `cessation_grace` arithmetic; the forward-integral and omitted-row vulnerable controls |
| `tests/integration/authority/lease-continuity-s1f.test.ts` | yes | VC-C3 PARTIAL — one backend from before C′ to after `COMMIT`; the lock held during the transaction; a competitor refused during and admitted after; a released lease refuses the transaction; no release-and-reacquire | `pg_backend_pid()` and `pg_locks` read from an OBSERVER connection; `pg_try_advisory_lock` from a second backend; source scans |
| `tests/integration/authority/local-authorisation-boundary.test.ts` | yes | the two step tables compose to `26 §7`'s flowchart and are disjoint; `I2`/`I31`/`I42`/`I60` are enforced by the DATABASE; money scale; the rate field table as a CHECK; the effect status set; append-only; no resume, audit, settlement or second Cedar path | `information_schema` and the catalogues, read from the RUNNING database; the flowchart transcribed in the test |
| `tests/negative-controls/local-authorisation-controls.test.ts` | yes | the vendor-amount control; the two-transaction control; the canonical effect cannot change between Cedar and R; the controls are test-only; the isolation assertion is not decoration | hand-authored `$40.50` fixture with `$9.50` of headroom; a real crash between two transactions; authoritative state mutated at the edge into R; three isolation levels read back from PostgreSQL |
| `tests/authority/decision-signature.test.ts` | no | the signing bytes are deterministic and field-ordered; key order cannot change them; EVERY field is covered; null ≠ empty string; real Ed25519; a non-Ed25519 key is refused; no clock or random source in the module | 20 single-field perturbations, each asserted to move the bytes; verification with the public key; source scan |
| `tests/type-negative/local-authorisation-as-dispatchable.ts` (via `tests/authority/authority-type-boundary.test.ts`) | no | a COMMITTED local authorisation is not dispatchable, as a COMPILE failure | a real `tsc` run; expected diagnostics on marked lines; no diagnostic on an unmarked line |

---

## 2. The mandatory adversarial controls

`tests/negative-controls/unsafe-local-authorisation.ts` holds seven named defects. Each
differs from production in ONE expression or statement, and each is exercised by a case that
asserts the two implementations DISAGREE on one fixture.

| # | Defect | Vulnerable result | Production result | Discriminating fixture |
|---|---|---|---|---|
| 1 | reserve `vendor_amount` instead of `total_exposure` | COMMITS; reserves `$9.41` where `$10.00` is owed | `WINDOW_EXHAUSTED`, nothing persisted | `W_DAY_REFUND` realised `$40.50` → `$9.50` of headroom |
| 2 | check only ONE of the referenced windows | COMMITS, leaving `$10.00` on one window and `$0.00` on the other | `WINDOW_EXHAUSTED`, nothing persisted | month exhausted / day clear, then reversed |
| 3 | rate class puts `forward_integral` in the ordinary amount AND the standing row | `WINDOW_EXHAUSTED` — the TB-03 double count | PERMITS | clean January, `W_MONTH_ADSPEND` ceiling `$186.00` = the standing cap exactly |
| 4 | rate class omits the zero-amount reservation row | COMMITS standing state with no reservation | writes the row; a decision over the omission is refused by a NOT NULL FK | clean January |
| 5 | reservation and decision in SEPARATE transactions | a crash between them strands a reservation with no decision, no effect and no journal row | the same crash point leaves NOTHING | a real abort between the two |
| 6 | journal counter acquired FIRST | `40P01` against a declared-order transaction | the declared order produces no `40P01` under contention | a targeted two-participant interleaving |
| 7 | duplicate detected by `SELECT` instead of by the key | both attempts COMMIT; the same intent takes exposure twice | the second returns the prior result; exposure moves once | two transactions parked between their read and their write, on different window rows |

Each control also has a **not-broken** case — a fixture on which the control and production
AGREE — so "the control commits and production denies" cannot be satisfied by a control that
always commits or a production path that always denies.

---

## 3. The kill-point matrix

Eleven declared points, from `LOCAL_COMMIT_POINTS` in
`src/kernel/authorisation/localAuthorisationErrors.ts` — the production sequence's own
boundaries, not a separate list. The matrix asserts the three coverage lists partition it
exactly, so a production sequence that grew a twelfth write without a point would show up as
a point with no coverage.

| Point | Reached by |
|---|---|
| `AFTER_ISOLATION_ASSERTED` | ordinary, rate |
| `AFTER_FIRST_WINDOW_LOCK` | ordinary, rate |
| `AFTER_ALL_WINDOW_LOCKS` | ordinary, rate |
| `AFTER_AUTHORISATION_ROW` | ordinary, rate |
| `AFTER_RESERVATION_ROW` | ordinary, rate |
| `AFTER_STANDING_ROWS` | rate only |
| `AFTER_EFFECT_ROW` | ordinary, rate |
| `AFTER_APPROVAL_ROW` | approval-bearing only |
| `AFTER_DECISION_ROW` | ordinary, rate |
| `AFTER_JOURNAL_SEQ_ALLOCATED` | ordinary, rate |
| `AFTER_JOURNAL_ROW` | ordinary, rate |

After every abort, from a SEPARATE connection: eleven tables empty, every `window_balance`
term at `0.00`, `reserved_count` at `0`, and `journal_counter.next_seq` at `1`.

And a DISCRIMINATOR per branch: with no kill, the same fixture writes every row — 1
authorisation, 2 authorisation-window rows, 1 reservation, 2 reservation-window rows, 1
effect, 1 decision, 1 journal row (and for the rate branch 1 standing authorisation, 1
revocation authority and 2 standing-window rows).

---

## 4. What no S1F test claims

| Not claimed | Why |
|---|---|
| external exactly-once | `25 §7`: duplicate prevention at the dispatch boundary rests on vendor idempotency, a vendor query or the outbox claim. None exists. |
| `VC-A3` — cross-instance byte identity | needs a SECOND independent implementation. The byte oracle here is a third READING of the specification, in the test file, and the suite says so. |
| `I17`, `I17b`, `I17c`, `I17e`, `I41`, `I8` | audit-side properties. No audit store, no push, no attestation, no diff. |
| full `VC-C3` | there is no execute step to span. Reported PARTIAL. |
| `I18d` | settlement. S3 synthetic, T3 real money. |
| `I51`'s runtime path | the trigger is the accepted S1A one; no resume exists to exercise it. |
| `I60`'s transition clause | the transition trigger is deferred with the transitions it constrains. |
| a rate class traversing C′ | `campaign.budget.set` has no registered constructor. |
| the `KERNEL_SERVICE` revocation execution path | the authority ENTITY is created; the pause is not dispatched. |

---

## 5. Accepted-test changes

| Accepted test | Change | Kind |
|---|---|---|
| `tests/canonicalisation/i21-type-boundary.test.ts` | fixture list fourteen → fifteen, sorted insertion | cardinality widened, exactness preserved |
| `tests/authority/authority-type-boundary.test.ts` | one new `describe` block for the S1F fixture's diagnostics | additive |

**No accepted test was deleted. No accepted assertion was weakened. No accepted test was
skipped.** Two accepted source-rule greps flagged prose in migration `0007`; the COMMENTS
were reworded and the rules left untouched. The reasons are in
`S1F-owner-clarifications.md` §S1F-C9.
