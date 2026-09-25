# S1N — implementation log

Branch `feature/s1n-integration-plane`, from `2a8d82a` on a clean worktree.

---

## 0. Baseline, verified before any edit

| | |
|---|---|
| HEAD | `2a8d82a84c7ac0180346b2936be82feb00d9c12c` |
| worktree | clean (`git status --porcelain` empty) |
| architecture gate | **89 PASS / 0 FAIL** |
| architecture seeds | **58 run, 58 discriminate** |
| accepted regression | 167 files / 2421 tests / 2421 passed / 0 failed / 0 skipped, carried from the S1M acceptance record |

**One honest note about the baseline regression run.** A full `npm run verify` was started at
the pinned tree and the first S1N source files were authored while it was still running, so
its result is not a clean baseline and is not quoted as one. The gate and all 58 seeds WERE
run to completion on the clean pinned tree before any file was created, and the 2421 figure is
the accepted one recorded in `2a8d82a`'s commit message and in `S1M-result.md §16`. The
authoritative regression number for this slice is the single final run in `§8` below.

---

## 1. Reading before building

`23 §5`, `23 §7` (zone rules), `23 §11`, `29 §3` (the whole credential section), `33 §7`
item 3, `34` ADR-023 and ADR-024, `36 §7`, `36 §13`, `37 §2` (S1, S2, S3 and the later
adapter slice), `48` in full, `50 §2a`, `phase2-v1.3-invariant-registry.md` rows I24 and I25.

Then the code: `adapterPort.ts`, `adapterRegistry.ts`, `effectGateway.ts`,
`dispatchEnvelope.ts`, `dispatchCapability.ts`, and the three accepted boundary tests that
scan `src/` — `no-real-transport-boundary.test.ts`, `no-dispatch-boundary.test.ts`,
`no-transport-boundary.test.ts`.

**What the reading decided.**

1. `37 §2` sequences `I24`/`I25` at **S2** and the four adapters at **S3**. S1N pulls the
   MECHANISM forward because S1M's PARTIAL identified its absence as the blocker, and pulls
   no provider forward at all. This is a sequencing choice, not an architecture change; the
   gate reads documents and is unaffected.
2. `48 §2` rows 1–4 are the four integration-plane components that would fill a registry and
   none exists, so **production's registries stay empty** — the same posture
   `EMPTY_ADAPTER_REGISTRY` already held, now mirrored by `emptyAdapterRuntimeRegistry()`.
3. The accepted `.dispatch(`-confinement assertions must survive, so the integration-side
   adapter contract uses a **different method name** (`invoke`). That is not cosmetic: the
   two contracts are genuinely different, because a Z2 adapter receives a credential and a
   Z1 port must not.

---

## 2. The one accepted assertion that had to change, and why it was not evaded

`no-real-transport-boundary.test.ts` asserted:

> `src/` contains NO `ExternalEffectAdapter` implementation at all

and its sibling said in its own comment that *"a future slice that adds one has to change
this assertion out loud."*

**The S1N transport proxy slipped past all four of that test's patterns on the first run** —
`adapterId: descriptor.adapterId` has no quote, `resolutionCapabilities:
descriptor.resolutionCapabilities` has no bracket, and `dispatch: (envelope) =>` is neither
`async dispatch(` nor `dispatch(envelope:`. The test went green with an adapter
implementation sitting in `src/`.

**That was not accepted as a pass.** The assertion was rewritten to:

- **name exactly one permitted file**, `src/integration/control/integrationClient.ts`;
- **add a fifth pattern**, `/\bdispatch\s*:\s*\(/`, so the shape that slipped past is now the
  shape that is caught everywhere else;
- **narrow the carve-out with twenty new assertions** on the permitted file: no
  `readFileSync`, no `readFile(`, no `process.env`, no secret-manager name, no `secret`
  identifier, no `fetch`, no `http`/`https`/`net`/`tls`, no axios/undici, no `Authorization`,
  no `Bearer`, no `apiKey`, no `accessToken`, no URL, and no dynamic `import(`;
- **assert it is the only file in `src/` that imports `node:child_process`.**

The carve-out is smaller than the hole it opens. Recorded here because a reviewer should be
able to find this paragraph from the test and the test from this paragraph.

---

## 3. The process mechanism, and why `fork`

`§5` forbids satisfying `I25` with a module, a class, an in-process worker object, a DI
container, `node:vm` or a function boundary. `§39` prefers *"a private parent-created IPC
channel over an open localhost socket"* and `§40` forbids a listener.

`child_process.fork` gives all of it in one call: a distinct PID, a distinct heap, a distinct
module registry, an **argument array** rather than a shell (`§38`), an **explicit `env`** that
REPLACES rather than merges (`§12`), and an anonymous IPC descriptor with no address that
exactly one child inherits (`§39`, `§40`).

A spike ran first, before any production file was written, and confirmed on this platform
that a parent variable not in the allowlist — `ADAPTER_B_SECRET` — does not reach the child.
It also found that Windows injects a fixed set of OS variables regardless of `env`, which is
why `PLATFORM_INJECTED_ENV_KEYS` is declared: `§30` asks for the child environment to be
tested **exactly**, and an exact assertion needs the expected set closed on both sides.

---

## 4. The guard order, and why it is the security property

`integrationHost.ts` runs seven checks and each is an early return rather than a flag:

```
1 decode                closed schema (§14)
2 adapter identity      this runtime serves exactly one (§7)
3 authorisation_ref     I24 at the runtime (48 §4 item 3)
4 binding digest        §16 — bound to THIS effect, not merely non-null
5 payload hash          sha256 of the bytes equals the hash the authorisation committed
6 credential            revoked or unavailable refuses here (§24)
7 adapter.invoke        the FIRST line of adapter code, and the only call site
```

Every member of `REFUSAL_REASONS` is therefore raised strictly before step 7, which is what
lets the control side map a refusal to `NOT_SENT_CONFIRMED / PRE_SEND_FAILURE` without
inventing a guarantee. That mapping is the **only** arm that releases a commitment, and it
rests on this ordering rather than on anything a message said.

---

## 5. `§16`'s binding, and what it does not close

The digest is `sha256` over a `U+0000`-separated concatenation of a domain separator and
every identity-bearing request member. The separator is a **source escape** and not a
physical byte — the same rule `lockOrder.ts` already carries for its own separator, and the
focused suite asserts it, because the first write of `wire.ts` did contain a physical NUL and
the assertion is what found it.

It refuses transit mutation, replay-with-one-field-swapped, and a caller spending a
legitimate authorisation on a different effect. **It does not close a compromised control
plane**, which could recompute it — and that is stated in the module rather than glossed:
independent authorisation verification at the point the credential is presented is one of
ADR-024's two named benefits of **option B**, which the architecture defers.

On the control side the binding is already structural and stronger: `0010`'s composite
foreign key makes `authorisation_id` a member of a key into `effect`, and
`buildDispatchEnvelope` reads it from the committed row.

---

## 6. Three defects the focused suite found, and what they were

Recorded because each was a real defect in the first implementation rather than a test that
needed adjusting.

**1. `main.ts` started an integration runtime inside the Vitest worker.** The module gated
its executable half on `process.send !== undefined`, on the reasoning that only a forked
child has one. A Vitest worker IS a forked child, so importing the module for one of its
exported functions started a runtime, which then failed its own environment check and called
`process.exit(1)`. The gate is now the **launch contract** — `process.send` AND
`ACOS_INTEGRATION_RUNTIME_IDENTITY` — which nothing but `integrationClient.ts` produces.

**2. The late-marking negative control did not discriminate.** It marked the provider
boundary and then threw, so `crossed` was `true` and the host correctly answered
`OUTCOME_UNKNOWN` — which is the SAFE answer, so the control proved nothing. Rewritten so the
fault occurs BETWEEN the send and the mark, which is the actual defect: the host sees
`crossed === false` for a request that was sent.

**3. A wrong claim about `JSON.parse` in `wire.ts`.** The comment said V8 "silently drops" a
`__proto__` key. It does not: it defines an own data property, so the prototype is untouched
and the key survives. The check is still on the raw text and is still correct, for two
reasons that are now stated accurately — attributability (the closed-field walk would refuse
the same bytes as the uninformative `UNKNOWN_FIELD`) and reach (a nested `outcome` object is
not covered by a top-level field walk).

A fourth correction was to the `process.env`-reader allowlist in `source-boundary.test.ts`,
which was written from memory and named two files that do not read the environment while
omitting two that do. It is now the exact three, each with its citation.

---

## 6a. Two accepted assertions the first full regression caught, and how each was answered

Both were found by `npm run verify` rather than by the focused suites, and **neither was
answered by amending the accepted assertion.**

**1. `postmark-tooling-boundary.test.ts` — *"`postmark` appears nowhere under `src/`, in any
case."*** `integrationAdapter.ts` listed the providers `§4` forbids, in prose, to say that
none of them is implemented. The accepted assertion reads RAW source, comments included, and
it is right to: the rule is that the vendor name is absent from the tree, and a comment
saying a vendor is absent is still that vendor's name in the tree.

Fixed by removing the list and pointing at `S1N-contract.md §4`. The first attempt still
failed — the replacement named the test file, and the test file's own name contains the
vendor. That is a small thing and it is recorded because it is the exact shape of how such a
rule erodes.

**2. `rate-class-local-authorisation.test.ts` — `I55`, *"there is NO code path in `src/` that
revokes."*** `SecretResolution` had a `'REVOKED'` member for ADR-024's **per-credential**
revocation switch, and the accepted assertion forbids the bare literal `'REVOKED'` anywhere
in `src/` because `I23`/`I62`'s `StandingAuthorization` transition is unbuilt.

There was a precedent for an exemption: S1H exempted `kernel/mirror` for
`DegradedModeOverride.status`, a different entity, and held it to a sharper rule instead.
**That precedent was deliberately not used.** Renaming the member to `'CREDENTIAL_REVOKED'`
costs nothing, keeps the accepted assertion untouched and unexempted, and is more precise —
it now matches the wire refusal reason of the same name exactly. An exemption would have
made the `I55` assertion one entry weaker for no benefit.

---

## 7. What the perimeter check actually finds today

```
production call sites:        0
test-only call sites:         4   (two declarations, two call sites, one pair per adapter)
UNANNOTATED:                  0
```

**Zero production sites is the honest number**, not a broken scanner: `src/` contains no
vendor call, because `48 §2` rows 1–4 do not exist. The four synthetic sites are what make the
check non-vacuous today, and `§17` permits them explicitly. They are scanned under
`TEST_ONLY` scope, so `§18` holds: a test fixture cannot become a production perimeter entry
by being annotated.

The scanner needed two corrections during authoring. It flagged `preconditions.ts`'s
`async fetch(` — a **declaration** of `26 §7` step G's precondition-port method, which reads
the control database — so the bare-`fetch` pattern now excludes declarations, exactly as the
accepted boundary test scopes its own. And it was per-file, so it saw a provider client's
declaration and its call site in another module as unrelated; it is now two passes.

---

## 8. Verification

| | |
|---|---|
| architecture gate | **89 PASS / 0 FAIL** |
| architecture seeds | **58 run, 58 discriminate** |
| `git diff 2a8d82a -- docs/architecture/` | **empty** |
| `npm run typecheck` | clean |
| `npm run lint` | clean, `--max-warnings 0` |
| `npm run verify:perimeter` | **PASS**, 0 unannotated |
| `npm run verify:packaging` | **PASS**, 8 separation obligations |

Focused S1N suites, each run on its own before the full regression:

| file | tests |
|---|---|
| `tests/integration/perimeter/process-boundary.test.ts` | 12 |
| `tests/integration/perimeter/ipc-protocol.test.ts` | 21 |
| `tests/integration/perimeter/gateway-integration.test.ts` | 9 |
| `tests/integration/perimeter/credential-leak-matrix.test.ts` | 7 |
| `tests/integration/perimeter/source-boundary.test.ts` | 13 |
| `tests/integration/perimeter/perimeter-enumeration.test.ts` | 7 |
| `tests/negative-controls/integration-controls.test.ts` | 16 |
| **total** | **85** |

The full `npm run verify` result is in `S1N-result.md §16`.
