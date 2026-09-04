# ADR-IMP-001 — Control-plane language and the S1A dependency set

**Status: ACCEPTED for S1.** Issued during S1A, 2026-09-04.

**This is an IMPLEMENTATION decision, not an architecture revision.** It selects nothing
the architecture left open on purpose and changes no invariant, ceiling, window, grant or
mechanism. `phase2-v1.3-implementation-brief.md §1` names the authoritative set; nothing
in this ADR is in it. If a later increment finds this choice in conflict with a normative
artifact, the artifact wins and this ADR is rewritten.

---

## Decision

**TypeScript on Node.js 20 LTS, against PostgreSQL 16, using `node-postgres` (`pg`)
directly for the money path.**

No ORM, no query builder, and no framework between the kernel and the transaction.

## Exact versions selected

Pinned in `package.json` and locked in `package-lock.json`. `latest` is not used
anywhere and no dependency is specified by range in `package.json`.

| Dependency | Version | Role |
|---|---|---|
| Node.js | **20.19.5** (engines: `>=20.11.0`) | Runtime |
| PostgreSQL | **16.9** | The substrate under test |
| `pg` | **8.16.3** | The only runtime dependency |
| `typescript` | **5.8.3** | Typecheck |
| `vitest` | **3.2.4** | Test runner |
| `tsx` | **4.20.3** | TS execution for migrations and kill-point child processes |
| `@types/node` | **20.19.9** | |
| `@types/pg` | **8.15.5** | |
| `eslint` | **9.32.0** | |
| `@typescript-eslint/parser`, `-eslint-plugin` | **8.39.0** | |
| `@dbos-inc/dbos-sdk` | **4.27.6** | **Spike only.** See ADR-IMP-002 |
| `@dbos-inc/node-pg-datasource` | **4.27.6** | **Spike only.** See ADR-IMP-002 |

**One runtime dependency.** `pg` is the entire production dependency set for S1A.
Everything else is a devDependency, and the two DBOS packages exist solely so
`spikes/durable-execution/` can evaluate a real DBOS rather than a description of one.

**Not installed, per the S1A mandate:** agent frameworks · Pydantic AI · LangGraph ·
Langfuse · Temporal · Shopify SDKs · Stripe SDKs · advertising SDKs. None appears in
`package.json` or `package-lock.json`.

---

## Rationale

### 1. PostgreSQL transaction support — the decisive criterion

`33 §1` calls the Postgres-centric single-transaction property decisive for Option A, and
`24 §3` K5's repair turns on exactly which writes share a commit point. The language
choice is therefore mostly a question of how honestly a client library lets you express:

```sql
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT … FROM window_balance WHERE … FOR UPDATE;   -- one row, in the declared order
UPDATE standing_window_exposure SET realised_monetary = realised_monetary + $1 …;
UPDATE journal_counter SET next_seq = next_seq + 1 …;
COMMIT;
```

`pg` lets you write precisely that and nothing else happens. There is no connection
pooling that silently moves a statement to another backend mid-transaction, no lazy
loading that adds a query inside the lock window, and no dialect layer that rewrites
`FOR UPDATE`.

**This mattered concretely twice during S1A**, and both would have been invisible under
an ORM:

- **Lock acquisition order.** `30 §5.2` requires ascending `window_id`. PostgreSQL does
  not guarantee that `SELECT … ORDER BY … FOR UPDATE` acquires locks in the ORDER BY's
  order under concurrency. `src/kernel/exposure/lockOrder.ts` therefore locks **one row
  per statement** in the sorted order. An ORM's `findMany({lock: …})` would have produced
  the multi-row form and a deadlock proof that holds only when nothing is contending.
- **`NUMERIC` never becomes a float.** `30 §5.3` makes decimal scale semantic. `pg`
  returns `NUMERIC` as a string by default; `src/db/pool.ts` asserts that at startup and
  refuses to run if a type parser has been changed. Most ORMs map `NUMERIC` to `number`.

The S1A mandate's own preference — *"Using `node-postgres` directly, or an equally
transparent Postgres layer, is preferred for the money-path substrate"* — is adopted
without qualification.

### 2. DBOS support

DBOS Transact's primary and most mature SDK is TypeScript (`@dbos-inc/dbos-sdk`), and
`@dbos-inc/node-pg-datasource` exposes the raw `pg` client inside a DBOS transaction. The
spike in ADR-IMP-002 was able to run **the same `stepApplyLedger` function** under DBOS
and under an ACOS-owned journal with no adaptation layer, which is what made the
comparison meaningful rather than a comparison of two rewrites.

Had the control plane been in another language, DBOS would have been a
different-maturity SDK or an out-of-process dependency, and the spike would have
compared two different things.

### 3. Future in-process Cedar support

`phase2-v1.3-implementation-brief.md §2` requires **K3 Cedar in-process** in S1.

Checked against first-party sources during S1A: **`@cedar-policy/cedar-wasm` 4.12.0**
exists on npm, published by the Cedar project, described as *"Wasm bindings and typescript
types for Cedar lib"*. Cedar's engine is Rust; the wasm bindings run **in the same
process** as a Node control plane.

**This is the constraint that would have forced the decision on its own.** The S1A
mandate says: *"Do not introduce a Cedar sidecar merely to preserve another language."* A
sidecar would put a network hop and a second failure domain between step E's categorical
prohibition check and the authorisation, and `26 §7`'s sequence is fail-closed precisely
because none of those steps may become unavailable independently. TypeScript reaches
Cedar in-process today, so no sidecar is needed and none is proposed.

**Cedar is NOT implemented in S1A** and no Cedar dependency is installed. It is recorded
here only because the language choice must not foreclose it, and it does not.

### 4. Testability

`36 §0` requires that independent validation not call the same production function twice,
and `36 §2` requires targeted interleaving with deterministic barriers. Both are easier in
a single-process async runtime than in a threaded one: `tests/support/barrier.ts`
coordinates two real PostgreSQL backends from one test process with plain promises, and
the interleaving is exactly what the test author wrote — no scheduler involved.

The kill-point spike needs the opposite: **real OS processes that die**. `tsx` running
`spikes/durable-execution/child.ts` gives that, with `process.kill(pid, 'SIGKILL')` as an
uncatchable termination.

### 5. Small-team operational burden

One runtime dependency, one language across kernel, tests and spike, no compilation step
in the test loop, and no build artefact to deploy. `31 §13`'s *"do not build"* list and
`33 §6`'s scale envelope both point the same way: at 100–300 orders per month the
constraint is comprehensibility, not throughput.

---

## Alternatives considered

| Alternative | Why not |
|---|---|
| **TypeScript with Prisma / Drizzle / TypeORM** | Each obscures the two things S1A had to get exactly right — lock acquisition order and `NUMERIC` fidelity. `24 §3` K5's guard, `24 §3` K5's sync trigger and `30 §5.2`'s order are all expressed in SQL and DDL; an ORM would add a translation layer between the architecture's printed text and the installed object, and VC-L2 asserts the installed object |
| **Rust** | Best Cedar story (native) and excellent Postgres support, but the durable-execution candidate the architecture names has no first-party Rust SDK, so the spike could not have been run as specified. Also the largest ramp for a one-developer team |
| **Python** | DBOS has a Python SDK and Cedar has bindings, but `26 §2.1`'s `AuthorizationRequest` and `I21`'s *"a test constructing an AuthorizationRequest from a fifth ProposedIntent field must not compile"* is a **type-level** requirement. `I21`'s stated test is a compile failure; Python cannot produce one |
| **Go** | Strong operationally; Cedar in-process is via cgo/wasm rather than first-party, and DBOS has no Go SDK, so the spike again could not run as specified |
| **Java / Kotlin** | Cedar has a first-party Java binding, but the operational weight is wrong for one developer and no DBOS SDK exists |

**`I21` deserves a separate note.** The registry's enforcement column for `I21` is
*"RUNTIME (type-level) + CI"* and its test is *"a test constructing an
`AuthorizationRequest` from a fifth `ProposedIntent` field must not compile."* That
requirement is only satisfiable in a statically typed language, and it narrows the field
to TypeScript, Rust, Go, Java or Kotlin before any other criterion is applied. S1A does
not build the canonicaliser, so `I21` is not exercised here — but choosing a language that
could not satisfy it would have been a decision about S1 taken silently during S1A.

---

## Consequences

**Accepted.**

- **JavaScript numbers cannot hold money.** Mitigated structurally rather than by
  convention: `src/kernel/exposure/money.ts` represents money as a bigint of minor units,
  `pg` returns `NUMERIC` as a string, and `pool.ts` refuses to start if that changes. No
  money value in this repository is ever a `number`.
- **Single-threaded runtime.** Irrelevant at `33 §6`'s scale envelope, and the money path
  is serialised by row locks in any case.
- **`SERIALIZABLE` requires an ACOS-owned retry.** Measured during S1A and recorded in
  `S1A-implementation-log.md §8`. Not a language consequence — it is a PostgreSQL
  property — but it is a consequence of choosing to write the transaction explicitly
  rather than letting a framework retry invisibly, and that visibility is the point.

**Reconsider if:**

1. Cedar's wasm bindings prove unable to evaluate the policy set in-process within the
   step-E latency the sequence needs — which would reopen the sidecar question that
   `phase2-v1.3-implementation-brief.md §2`'s "in-process" requirement forecloses.
2. `I21`'s type-level property proves unenforceable in TypeScript for the real
   `AuthorizationRequest`, when the canonicaliser is built.
3. A dependency on the money path is ever proposed that is not `pg`.

---

## What this ADR does not decide

It does not choose the durable-execution layer — that is ADR-IMP-002. It does not choose a
policy engine; `phase2-v1.3-implementation-brief.md §2` already declares Cedar and S1A
does not implement it. It does not authorise any dependency beyond the table above.
