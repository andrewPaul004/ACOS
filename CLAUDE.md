# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repository is

ACOS control plane — a **non-production architectural MVP** implementing the ACOS Operating
Spine architecture package. No real money, no real customers, no production credentials, no
adapter in `src/` that reaches a real vendor. That property is enforced by tests, not by
convention.

`README.md` is **stale** — it describes only the first increment (S1A). The repository has since
advanced through S1B…S1P. Treat `docs/implementation/` and `NEXT_STEPS.md` as the current record.

## Commands

```bash
npm install
npm run db:up        # docker compose: control + audit Postgres containers
npm run verify       # typecheck + lint + full suite — THE gate
```

Individually:

```bash
npm run typecheck                # tsc --noEmit
npm run lint                     # eslint, --max-warnings 0
npm run test                     # vitest run (everything)
npm run test:integration
npm run test:negative-controls
npm run spike                    # durable-execution kill-point matrix

npx vitest run tests/integration/exposure/lock-order.test.ts        # one file
npx vitest run tests/integration/exposure -t "window instance"      # one test by name
```

Database (two separate planes, two separate runners — deliberately):

```bash
npm run db:migrate / db:reset               # CONTROL plane
npm run db:migrate:audit / db:reset:audit   # AUDIT plane
```

Offline verification and reporting tools (none of these reach a network vendor):

```bash
npm run verify:perimeter          # BUILD GATE: unannotated vendor-call site = non-zero exit
npm run verify:packaging
npm run prelive:verify
npm run release:control           # offline control-artifact signer / release ceremony
npm run report:provider-selection
npm run validate:sendgrid         # S1P validation harness — the only real vendor HTTP
```

### Test environment

Tests require **real PostgreSQL 16.x**; there is no in-memory substitute, because the properties
under test are properties of Postgres locks, isolation levels and triggers. `tests/support/globalSetup.ts`
provisions it and publishes `ACOS_CONTROL_PG_URL`, `ACOS_AUDIT_PG_URL`, `ACOS_DBOS_SYS_PG_URL`.
Without Docker, point `ACOS_PG_BIN` at a `pgsql/bin` directory, or set `ACOS_PG_PROVIDER=external`
plus `ACOS_CONTROL_PG_URL`.

Every test file migrates from an **empty** database, so "migrations apply from empty" is exercised
on every run. `fileParallelism: false` and `sequence.concurrent: false` are required — concurrency
tests place two real backends at named barriers, and parallel files would turn a deterministic
interleaving into a flaky one.

## Architecture packages are immutable inputs

`docs/architecture/vX.Y.Z/` — each issue is **never modified in place**, including where it
contains a known-stale sentence. A correction is materialised as a new directory with its own
errata and verification files. `v1.3.8` is currently authoritative.

Production code cites the architecture by section (`30 §5.2`, `24 §3.1`, `50 §3f`) and by
invariant/condition id (`I62`, `I20`, `I8`, `VC-S5`, `TB-07`). Those citations are load-bearing —
when changing behaviour, cite the clause that requires it, and when the package contradicts itself
record the resolution rather than glossing it (see `src/kernel/exposure/lockOrder.ts` for the
canonical example).

## Increment discipline

Work proceeds in lettered increments S1A → S1P. Each produces, in `docs/implementation/`:

`S1x-contract.md` (written **before** production code) · `S1x-implementation-log.md` ·
`S1x-test-matrix.md` · `S1x-owner-clarifications.md` · `S1x-result.md`

The owner reviews each increment independently before further code is authorized; the repository
is frequently **paused on review** rather than blocked on code. Check `NEXT_STEPS.md` (gitignored,
auto-written) for the live state before starting work.

## Plane separation — the central structural constraint

| Root | Holds | Must not |
|---|---|---|
| `src/kernel`, `src/db` | the CONTROL plane: money path, authority, policy, gateway, outbox, mirror | import `tools/` or `validation/` |
| `src/audit` | the AUDIT plane: separate database, separate roles (`acos_audit_replication` INSERT-only, `acos_audit_evaluator`), separate process | share a process or credential with the control plane |
| `src/integration` | out-of-process adapter runtime; holds the SEND credential | hold the audit locator/credential |
| `validation/` | the ONLY real vendor HTTP clients (SendGrid, S1P) | be imported by anything under `src/` |
| `tools/` | offline signer, release ceremony, perimeter scan, report CLIs | be imported by anything under `src/` |

`tools/**` and `validation/**` are typechecked and linted with everything else — a mistake there
is a mistake in a release package or a request that reaches a provider.

Several tests **read the source tree** and fail on a structural violation rather than a behavioural
one — `tests/integration/exposure/lock-order.test.ts`, `tests/controlArtifacts/boundaries.test.ts`,
`tests/integration/perimeter/source-boundary.test.ts`, `tests/integration/audit/plane-independence.test.ts`,
`tests/sendgrid/provider-boundary.test.ts`. Adding an import can break the build even when the code
is correct; that is intended.

## Rules the test suite enforces

- **Independent oracle (`36 §0`).** `tests/support/oracle.ts` and the other `*Oracle.ts` files
  import nothing from `src/`. Expected figures are transcribed by hand from the architecture.
  Never make an oracle call production code.
- **Negative controls (`36 §2`).** `tests/negative-controls/unsafe-*.ts` are deliberately weakened
  reimplementations; the paired `*.test.ts` asserts the vulnerable variant is detected and the real
  one is not. **Never weaken production code to make a control pass** — a control that stops
  discriminating is a failed control.
- **Targeted interleaving, not load.** `tests/support/barrier.ts` parks two real backends at named
  instruction boundaries. No test runs N requests and hopes.
- **The database enforces; the application does not.** Commitment guard, `I62` transition set,
  generated columns and the realised/standing coupling are triggers and constraints in
  `src/db/migrations/*.sql`, attacked by tests with raw SQL.
- **One lock order, one acquisition site.** `src/kernel/exposure/lockOrder.ts` is the only module
  in `src/` permitted to `SELECT … FOR UPDATE` against `window_balance`,
  `standing_window_exposure` or `journal_counter`.

## Money representation

`bigint` minor units in TypeScript; `NUMERIC` as **string** out of Postgres. `src/db/pool.ts`
asserts at import time that `pg` is not parsing `NUMERIC` to a JS number and refuses to start
otherwise. A money value never becomes a JavaScript `number`. Scale is semantic — `25.0` and
`25.00` are different bytes (`30 §5.3`, ACOS-JCS-1).

## Control-artifact bootstrap

After S1K, the action catalogue, degraded-mode configuration, Cedar policy set and the ACOS-JCS-1
canonicaliser all resolve through an active **verified control-artifact bundle**. The kernel fails
closed before any authority execution if bootstrap did not complete.

`tests/support/controlArtifactSetup.ts` runs as a vitest `setupFile` for every test file, so a test
has the same READY kernel a deployment would. A test that needs an **unbootstrapped** kernel, or a
different package, calls `vi.resetModules()` to get a fresh module graph (the active bundle lives in
module-private state) — see `tests/controlArtifacts/bootstrap-gate.test.ts`.

`VerifiedControlArtifactBundle` is an opaque frozen object backed by a module-private `WeakMap`:
unforgeable by cast, non-serialisable, minted only by `verifier.ts`. Do not add a raw artifact
loader to the authority-facing surface, and do not make the bundle serialisable.

## TypeScript / lint conventions

- ESM throughout (`"type": "module"`), Node ≥ 20.11. Relative imports carry the **`.js`** extension.
- `tsconfig.json` is maximally strict: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`,
  `verbatimModuleSyntax`, `noUnusedLocals/Parameters`.
- `tests/type-negative/**` is excluded from the root tsconfig **by design** — those files are
  required to fail type checking and are compiled by
  `tests/canonicalisation/i21-type-boundary.test.ts`. Do not add them to `include`.
- Lint is small and intentional: `no-floating-promises` / `await-thenable` / `no-misused-promises`
  (a dropped promise on the money path is a transaction that silently never committed),
  `no-explicit-any`, `no-console`. `no-console` is lifted only for tests, spikes and the two
  migration CLIs.

## Scheduled blocks

`phase2-v1.3-implementation-brief.md §5` blocks specific behaviours (e.g. TB-07 cessation
measurement, TB-08(a) production ceiling seeding, TB-11 `PAUSE_PENDING` retry, TB-13 `campaign.budget.set`
supersession). Tests assert these paths do **not** exist. Before implementing something that looks
missing, check whether it is deliberately blocked.

## Project State Management

`PROJECT_STATUS.md` is the authoritative project handoff document.

### Before starting work

Read `PROJECT_STATUS.md` before making changes.

Use it to understand:
- the current project phase;
- recently completed work;
- current work;
- anything awaiting review;
- blockers;
- the expected next action.

Verify important state against the repository when appropriate. Do not blindly
trust stale status information if the repository contradicts it.

### Before ending EVERY task

You MUST update `PROJECT_STATUS.md` before giving your final response.

Update the YAML properties and the human-readable content so that a completely
new AI session can determine:

1. What project this is.
2. What phase/stage it is in.
3. What was most recently completed.
4. What is currently happening.
5. Whether anything is awaiting review.
6. What blockers or unresolved decisions exist.
7. The SINGLE next action required to resume work.
8. Who should perform that next action.
9. Which artifacts/files are most important for resuming work.

### YAML rules

Maintain these properties:

- `project`
- `category`
- `status`
- `stage`
- `phase`
- `next_actor`
- `next_action`
- `waiting_on`
- `priority`
- `last_updated`

Allowed `status` values:

- `active`
- `waiting`
- `review`
- `paused`
- `completed`

Allowed `next_actor` values:

- `Andrew`
- `ChatGPT`
- `Claude`
- `Codex`
- `External`

`next_action` must contain ONE concrete action, not a list of possible tasks.

Examples:

GOOD:
`next_action: Have ChatGPT independently review the Phase 6 completion report`

BAD:
`next_action: Review the work, fix anything needed, commit it, and begin Phase 7`

### General rules

Do not turn `PROJECT_STATUS.md` into a changelog.

Keep only enough recent history to understand the project's current state.

Do not mark implementation, testing, review, or a phase complete unless it has
actually been completed.

When implementation is complete but independent review is required, the project
is NOT fully complete. Set something like:

`status: review`
`next_actor: ChatGPT`
`next_action: Independently review the Phase X implementation`

If work is incomplete, accurately record what remains.

Before your final response, verify that `PROJECT_STATUS.md` reflects the actual
repository state.

@NEXT_STEPS.md
