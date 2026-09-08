# ACOS — control plane

**Non-production architectural MVP. S1A increment only.**

This repository contains the first authorized implementation work against **ACOS Operating
Spine v1.3, package issue v1.3.2**. It implements **S1A**: the exposure-ledger substrate
proof and the durable-execution spike. Nothing more.

> **This is NOT authorized for** production deployment · real customers · real money · real
> advertising · real supplier commitments · a public storefront · autonomous production
> operation.
>
> There are no vendor credentials in this repository, no adapter that reaches a real
> vendor, and no path that spends money.

---

## What S1A proved

**S1A PASS — PROCEED.** Full answers in
[`docs/implementation/S1A-result.md`](docs/implementation/S1A-result.md).

| | |
|---|---|
| Four-term commitment guard | works; operand set verified from the installed trigger |
| First rate authorisation | **PERMITS** — `$186.00 ≤ $186.00`, `$12.00 ≤ $12.00` |
| Realised/standing atomicity | holds in **both** interleavings |
| Mandatory negative control | **EXPECTED FAILURE OBSERVED** |
| Transient unauthorised headroom | none in the production path |
| Financial truth above the ceiling | recorded, with the right incidents on the right path |
| Window-instance boundary | passes |
| Declared lock order | no deadlock |
| Durable execution | **ACOS Postgres step journal** selected |
| Pass-revocation conditions | none triggered |

139 tests, 14 files, against real PostgreSQL 16.9.

---

## Layout

```
ACOS/
├── _input/                          the original architecture zip, retained
├── docs/
│   ├── architecture/v1.3.1/         the architecture package as first issued. IMMUTABLE
│   ├── architecture/v1.3.2/         the CURRENT package issue. IMMUTABLE INPUT
│   └── implementation/              S1A's own documents (see below)
├── src/
│   ├── db/
│   │   ├── migrations/              plain SQL, forward-only, applied verbatim
│   │   ├── migrate.ts               a deliberately small runner
│   │   └── pool.ts                  pg, explicit transactions, NUMERIC-as-string assertion
│   └── kernel/exposure/             the money path
│       ├── lockOrder.ts             THE single lock-acquisition site
│       ├── stepR.ts                 26 §7 step R, two branches, no shared verb
│       ├── reconciler.ts            the TB-04 single statement
│       ├── boundaryReReservation.ts 24 §3.1's LIVE-only rule
│       ├── standingCap.ts           51 §3.2's formula, exact rationals
│       ├── windowInstance.ts        24 §3.1's instance keying, company timezone
│       ├── money.ts                 bigint minor units; never a JS number
│       ├── retry.ts                 the ACOS-owned serialisation retry
│       ├── ledger.ts                reads and per-term writes
│       └── errors.ts                SQLSTATE contract with the triggers
├── tests/
│   ├── support/                     harness, fixture, INDEPENDENT ORACLE, barriers
│   ├── integration/exposure/        VC-S5, VC-S7, VC-S8, VC-L2, I62, guard, schema
│   └── negative-controls/           the tests that MUST fail
├── spikes/durable-execution/        DBOS vs ACOS step journal, 7 kill points
├── docker-compose.yml
└── package.json
```

**Each `docs/architecture/vX.Y.Z/` package is an immutable input.** A package issue is never
modified in place: `v1.3.2` was materialised as a new directory carrying the `ACOS-JCS-1`
NULL-framing correction (`phase2-v1.3.2-errata.md`, JCS-01), and `v1.3.1` remains on disk
byte-identical to its own issue. **`docs/architecture/v1.3.2/` is the current authoritative
input.** Neither is modified, including where
it contains a known stale sentence — see the precedence note in
[`S1A-contract.md`](docs/implementation/S1A-contract.md) and
[`S1A-implementation-log.md §1`](docs/implementation/S1A-implementation-log.md).

## The S1A documents

| Document | What it is |
|---|---|
| [`S1A-contract.md`](docs/implementation/S1A-contract.md) | Architecture → mechanism → test → oracle. Written **before** production code |
| [`S1A-implementation-log.md`](docs/implementation/S1A-implementation-log.md) | Choices, surprises, and why. Read `§8` and `§9` |
| [`S1A-test-matrix.md`](docs/implementation/S1A-test-matrix.md) | Every test, and whether it proves, attacks or negatively controls |
| [`ADR-IMP-001-control-plane-language.md`](docs/implementation/ADR-IMP-001-control-plane-language.md) | TypeScript + Node 20 + `pg`, with exact pinned versions |
| [`ADR-IMP-002-durable-execution.md`](docs/implementation/ADR-IMP-002-durable-execution.md) | The spike, the kill-point matrix, and the decision |
| [`S1A-result.md`](docs/implementation/S1A-result.md) | The twelve questions, answered exactly |

---

## Running it

**Requires real PostgreSQL.** The suite will not run against anything else and there is no
in-memory substitute — the properties under test are properties of PostgreSQL's locks,
isolation levels and triggers.

```bash
npm install
npm run db:up        # docker compose: control + audit containers
npm run verify       # typecheck + lint + the full suite
```

`npm run verify` is the gate. Individually:

```bash
npm run typecheck
npm run lint
npm run test                    # everything
npm run test:integration        # VC-S5, VC-S7, VC-S8, VC-L2, I62, guard, schema
npm run test:negative-controls  # the tests that must fail
npm run spike                   # the durable-execution kill-point matrix
```

**If Docker is unavailable**, the harness falls back to PostgreSQL server binaries run
directly by `pg_ctl` in a scratch directory outside the repository — the same PostgreSQL,
started differently. Point `ACOS_PG_BIN` at a `pgsql/bin` directory, or set
`ACOS_PG_PROVIDER=external` and `ACOS_CONTROL_PG_URL` to force the documented path. The
suite always prefers a reachable external server. See
[`S1A-implementation-log.md §12`](docs/implementation/S1A-implementation-log.md).

The suite migrates **from an empty database on every test file**, so "migrations apply from
empty" and "migrations can be torn down and recreated" are exercised on every run rather
than asserted once.

---

## The rules this repository is built under

- **`36 §0`** — independent validation must not call the same production function twice.
  `tests/support/oracle.ts` imports nothing from `src/`; every expected figure is
  transcribed by hand from the architecture and cross-checked against its printed answers.
- **`36 §2`** — every concurrency test carries a negative control that must fail.
  `tests/negative-controls/` is that, and production code was not weakened to produce it.
- **Targeted interleaving, not load.** `tests/support/barrier.ts` places two real
  PostgreSQL backends at named instruction boundaries. No test runs N requests and hopes.
- **The database enforces; the application does not.** The commitment guard, the `I62`
  transition set, `forward_monetary`'s generation and the realised/standing coupling are
  all triggers and constraints, and the tests attack them with raw SQL.
- **One lock order, one acquisition site**, enforced by a test that reads the source tree.

## Scheduled blocks respected

Per [`phase2-v1.3-implementation-brief.md §5`](docs/architecture/v1.3.2/phase2-v1.3-implementation-brief.md),
this repository contains **no** path to any of:

| Blocked | By |
|---|---|
| Cessation measurement — nothing sets `cessation_verified_at`, asserted by a test | **TB-07** |
| Production ceiling seeding on `W_MONTH_ADSPEND` — `$186.00` appears only as the signed non-production fixture, in test code | **TB-08(a)** |
| `PAUSE_PENDING` retry | **TB-11** |
| `campaign.budget.set` supersession — no `SUPERSEDED` status, no max-over-instance cap | **TB-13** |

## Not built in S1A

Effect Canonicaliser · Cedar · symcc · AI CEO · any LLM · research workers · S2 ingress ·
Shopify · Stripe · Google Ads · Meta · email · real adapters · `I8` inverse sweep · the
journal chain · `ACOS-JCS-1` · `JournalAttestation` · the mirror state machine ·
`DegradedModeOverride` · production audit infrastructure · owner UI.

---

## Next

**STOP.** The owner reviews S1A independently before further code is authorized.
The recommended next increment is named at the end of
[`S1A-result.md`](docs/implementation/S1A-result.md).
