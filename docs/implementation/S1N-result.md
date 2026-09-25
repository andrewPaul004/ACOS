# S1N — result

**Verdict: PASS.**

Integration-plane runtime and the per-adapter credential boundary, against
**ACOS Operating Spine v1.3, package issue v1.3.6**, unchanged.

---

## 1. What S1N answers

S1M returned PARTIAL for three reasons. The second was the load-bearing one:

> no integration-plane runtime exists, so there is no architecture-legal place for a provider
> token.

`I25` — *"No process in the control plane holds a vendor credential"* — is a statement about a
**process**, and the repository had one. S1N builds the second process and the boundary around
it, with a synthetic adapter and a synthetic credential, and introduces no provider.

```
before      control process ──► adapter object ──► vendor
after       control process ──► deterministic integration boundary ──► dedicated adapter runtime ──► vendor
```

**Measured:** control PID and integration PID differ; adapter A's PID and adapter B's differ;
the sentinel secret appears on none of ten captured surfaces and does appear in its own
source, so the matrix is not vacuous.

---

## 2. The process boundary

A real OS process, via `child_process.fork`, and every option is load-bearing:

| option | why |
|---|---|
| fixed module path from this file's own location | `§38` — no `command = caller_input` |
| `args: []` | nothing on a command line, so no interpolation |
| `env:` a **constructed** seven-key allowlist | `§12`, `§30` — `fork` replaces, never merges |
| `execArgv` fixed | `§37` — a worker supplies no runtime flag |
| `stdio: ['ignore','pipe','pipe','ipc']` | `§40` — no port, no HTTP, no named socket |
| no shell, ever | `§38` |

`§39`'s authentication question has the answer the mandate anticipated: the channel IS the
authentication. An anonymous descriptor the parent created, inherited by exactly one child,
with no address. See `S1N-owner-clarifications.md` **S1N-C2**.

---

## 3. The credential boundary

| | |
|---|---|
| control-plane credential access | **none.** No secret loader, no vault SDK, no vendor token, no auth header anywhere in the control closure; the three `process.env` readers are the control DB URL and two **public** Ed25519 trust configurations |
| integration credential source | `AdapterSecretSource`, scoped to one adapter **at construction**, resolving from its own deployment boundary. `resolve()` takes **no argument**, so it cannot be asked for another adapter's material |
| what crosses the wire | an adapter invocation, an `authorisation_ref`, a canonical dispatch envelope, bounded metadata. **No credential, and no member one could occupy** |
| child environment | seven keys, constructed. `ADAPTER_B_SECRET`, `ACOS_CONTROL_PG_URL`, `ACOS_AUDIT_PG_URL`, `OWNER_SIGNING_PRIVATE_KEY` and `UNRELATED_APPLICATION_SECRET` are all absent, asserted from the child's own `process.env` |
| A / B isolation | two roots, two processes, two locators, two sources, two provider clients, **disjoint import closures** |
| revocation | a state of the SOURCE (`CREDENTIAL_REVOKED` returns no material), not a flag in ACOS. Per credential, operable without restarting anything, sibling unaffected |
| rotation | per-invocation resolution; the material changes with **no process restart** and no control-plane knowledge beyond a non-secret label |

`§9` is honoured: **no cloud secret manager is selected.** The interface is declared, the
S1N implementations are test fixtures, and production's runtime registry is empty.

---

## 4. `I24` — every call site carries an authorisation reference

Three mechanisms, matching `48 §4` items 1–3.

1. **One provider client per adapter**, in that adapter's own root.
2. **A CI enumeration** (`tools/perimeter/`, `npm run verify:perimeter`, and the same scan
   inside `npm run verify`) that fails the build on an unannotated site.
3. **A runtime assertion** — `integrationHost.ts` guard 3 — refusing before adapter code.

And `§16`'s binding, which is the half that matters: the reference must be **bound to this
effect**, not merely present. Authorisation A on effect B's envelope is refused
`AUTHORISATION_BINDING_MISMATCH` before the adapter runs, and a host whose check is a null
check accepts the same attack.

**Today's enumeration: 0 production sites, 4 test-only sites, 0 unannotated.** Zero production
sites is the honest number — `48 §2` rows 1–4 do not exist. The four synthetic sites are what
make the check non-vacuous, and `§18` holds: a `TEST_ONLY` site never becomes a production
perimeter entry.

---

## 5. `I25` — the control plane is credential-blind

| | |
|---|---|
| control vendor secret | **none**, and no route to one |
| control secret-loader dependency | **none.** The control side's import list is hand-authored and asserted; `../runtime/adapterSecretSource.js` is named as forbidden |
| integration-only secret loading | yes, in the child, from its own source, after six guards |
| packaging | the control closure contains no secret source, no provider client, no adapter and no integration-runtime module |

**Status: satisfiable for the first time.** Before S1N there was no process the sentence could
be true of.

---

## 6. What did not change

`src/kernel/gateway/effectGateway.ts` — **not one line**. The gateway still resolves an
`ExternalEffectAdapter` from its registry and still awaits `dispatch` inside the dispatch-lease
callback, so:

- `§19` the gateway remains the sole production dispatch origin;
- `§20` the fresh-claim capability is unchanged, and a persisted `CLAIMED` row plus a live
  runtime still cannot dispatch;
- `§21` `25 §14.1`'s Epoch B entity lease spans the IPC **structurally**, because the `await`
  did not move. The accepted event order holds and the release is still last;
- `§27` the IPC `invocationId` is transport observability and replaces no identity.

---

## 7. Crash and deadline semantics

| Point | Integration state | Local effect state | Replay? |
|---|---|---|---|
| control dies before IPC send | never started | `CLAIMED`, no outcome — the accepted ambiguous state | no |
| runtime unavailable before the request | not started | `NOT_SENT_CONFIRMED / PRE_SEND_FAILURE` where the send provably failed; `OUTCOME_UNKNOWN` where bytes may have been buffered | no |
| runtime dies before adapter invocation | indeterminate to the control plane | `OUTCOME_UNKNOWN / AMBIGUOUS` | no |
| runtime dies after the provider boundary | crossed | `OUTCOME_UNKNOWN / AMBIGUOUS` | no |
| response channel dies after the outcome | crossed | `OUTCOME_UNKNOWN / AMBIGUOUS` | no |
| deadline elapses after send | may have crossed | `OUTCOME_UNKNOWN / TIMEOUT` | no |
| concurrency bound refuses | nothing sent | `NOT_SENT_CONFIRMED / PRE_SEND_FAILURE` | no |
| adapter throws before its provider boundary | not crossed | `ADAPTER_FAILED` — no local policy, no row | no |

**No new retry path exists.** `§26`: a process boundary does not authorise a resend.
`§28`: a restart restores adapter availability and nothing else — the client holds no
`lastRequest`, no pending buffer and no retry queue, and the fresh-claim capability cannot be
reconstructed from a row.

---

## 8. Option A and option B

**Option A implemented.** Per-adapter secret, per-adapter runtime, per-adapter filesystem
locator, per-adapter dependency closure, per-credential revocation.

**Option B not implemented**, as ADR-024 requires — and its trigger is enforced at
composition, by throw:

| trigger | criterion | enforcement |
|---|---|---|
| third adapter | ADR-024's exact words | `OPTION_B_TRIGGER_ADAPTER_COUNT`; two still admitted |
| money-moving credential | `50 §2a` field 4, over the **verified** class-3 artifact | `OPTION_B_TRIGGER_MONEY_MOVING_CREDENTIAL`, and `CREDENTIAL_CLASS_UNDERSTATED` if a deployment misdeclares |

`mock_processor` (`refund.create`, `carries_vendor_monetary_field: true`) is refused today.

---

## 9. Secret leak matrix

| Surface | Sentinel observable? |
|---|---|
| control process environment | **no** |
| control-plane event log | **no** |
| IPC request bytes | **no** |
| IPC response / refusal | **no** |
| every row of every control table (raw SQL) | **no** |
| the journal | **no** |
| effect and outbox rows | **no** |
| integration runtime `stderr` (structured log) | **no** |
| integration runtime `stdout` | **no** — empty |
| worker-facing `GatewayResult` | **no** |
| sibling adapter's runtime | **no** |
| error objects | **no** |
| **its own integration-only secret source** | **yes** |

The last row is what makes the other twelve mean something.

---

## 10. Vulnerable controls

**Fourteen required, fifteen implemented, all discriminate.** The full table is
`S1N-test-matrix.md §7`. Each removes exactly ONE production mechanism and is run against the
same input as production, so each discrimination is attributable.

---

## 11. Open architecture question

**`money-moving credential` has no mechanised definition in v1.3.6.** S1N binds it to
`50 §2a` field 4 and records the alternative reading as a reported accessor that enforces
nothing. Full disposition in `S1N-owner-clarifications.md` **S1N-C1**, including why the
broader reading cannot be the intended one — it would leave option A admitting no adapter at
all, contradicting ADR-024's own *"with two adapters and no money"*.

This is **not** a PARTIAL trigger: `§36` says to return PARTIAL only if S1N must exercise the
trigger and cannot, and S1N exercises both halves and both refuse.

---

## 12. The Postmark finding — carried forward, unweakened

| | |
|---|---|
| Postmark adapter implemented? | **NO** |
| read-only API credential issue | **UNRESOLVED.** A Postmark server token grants sending, sent-message inspection and the bounce API as one undivided capability, so `36 §13`'s replica-read test cannot pass and `48 §2` row 13's read-only exemption is not earned |
| architecture weakened? | **NO.** `git diff 2a8d82a -- docs/architecture/` is empty |
| `POSTMARK_*` consumed by S1N? | **NO**, asserted by scan |
| `I8` | **OPEN** |
| recommended provider-selection status | prefer a provider offering a restricted send key for the integration adapter, an **independent read-only key** for the audit plane, provider-visible correlation, and a provider query/event surface |

S1N makes the finding easier to act on rather than easier to ignore: the place a restricted
send key would go now exists, and the audit plane's read-only credential still needs a
runtime of its own (`§32`).

---

## 13. Scope

| | |
|---|---|
| real provider | **NO** |
| real HTTP / socket / vendor SDK | **NO** |
| vendor credential | **synthetic TEST ONLY** |
| cloud secret manager selected | **NO** |
| option B | **NO** |
| production owner ceremony | **NO** |
| reconciliation | **NO** |
| architecture edited | **NO** |

---

## 14. Verification

| | |
|---|---|
| baseline | `2a8d82a`, clean worktree, confirmed before any edit |
| architecture package | v1.3.6, unchanged |
| architecture gate | **89 PASS / 0 FAIL** |
| architecture seeds | **58 run, 58 discriminate** |
| `npm run verify:perimeter` | **PASS** — 0 unannotated |
| `npm run verify:packaging` | **PASS** — 8 separation obligations |
| `npm run verify` | see `§16` |

---

## 15. Pre-live gate status

The local architecture may truthfully say **`INTEGRATION_BOUNDARY_READY`**.

It may **not** say `READY_FOR_PROVIDER_SANDBOX_CONFIGURATION` in the sense S1M's gate means
it, because S1M's other prerequisites are unchanged: no provider credential exists, no
provider has been selected, and `36 §13`'s independent audit-read credential has no candidate.
`npm run verify:postmark-sandbox` still reports `NOT_READY` and S1N does not touch it.

**No real-provider validation is claimed.** `I36`'s enforcement leg stays closed at S1 and its
verification leg stays open at S4. `I20` and `I8` remain open.

---

## 16. Regression

ONE full `npm run verify`, on the branch head, exit **0**.

| | |
|---|---|
| test files | **174** |
| tests | **2506** |
| passed | **2506** |
| failed | **0** |
| skipped | **0** |
| duration | 3792 s |

**2506 = the accepted 2421 + exactly the 85 S1N adds.** No accepted test was deleted, and one
was amended in place (`no-real-transport-boundary.test.ts`, `S1N-implementation-log.md §2`),
so the file count rises by 7 and the test count by 85.

| S1N file | tests |
|---|---|
| `tests/integration/perimeter/process-boundary.test.ts` | 12 |
| `tests/integration/perimeter/ipc-protocol.test.ts` | 21 |
| `tests/integration/perimeter/gateway-integration.test.ts` | 9 |
| `tests/integration/perimeter/credential-leak-matrix.test.ts` | 7 |
| `tests/integration/perimeter/source-boundary.test.ts` | 13 |
| `tests/integration/perimeter/perimeter-enumeration.test.ts` | 7 |
| `tests/negative-controls/integration-controls.test.ts` | 16 |
| **total** | **85** |

Of those: **OS-process integration tests** 30 (every test that forks a real runtime),
**credential-leak tests** 7, **perimeter tests** 7, **vulnerable controls** 16 covering all
fourteen `§52` attacks plus the late-provider-mark and broad-exemption controls.

**The first full run found two collisions with accepted assertions** and neither was answered
by weakening one; both fixes are recorded in `S1N-implementation-log.md §6a`.

---

## 17. Remaining obligations

Carried forward unchanged: S1M real-provider validation · provider selection · the provider
audit credential · real-provider `I36` · `I20` · `I8` · `I17b` · residual 12 · class-19
migration · the remaining S4 signed classes · the control incident table · the production
owner ceremony · the AI CEO and workers.

Added by S1N: **S1N-C1** (the money-moving definition) and the audit plane's own credential
boundary (`§32`), which needs its own runtime and is not claimed here.
