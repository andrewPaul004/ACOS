# S1N — contract

**Integration-plane runtime and the per-adapter credential boundary.**
Against **ACOS Operating Spine v1.3, package issue v1.3.6**, unchanged.
Baseline `2a8d82a` (S1M, PARTIAL). Branch `feature/s1n-integration-plane`.

---

## 1. What this slice is for

S1M was asked to cross a real external-provider boundary and returned **PARTIAL** for three
independent reasons. The second is the one S1N answers:

> **no integration-plane runtime exists, so there is no architecture-legal place for a
> provider token.**

`I25` — *"No process in the control plane holds a vendor credential"* — is a statement about
a **process**, and until this slice the repository had exactly one. `effectGateway.ts`
invoked `adapter.dispatch()` in its own process, so a real adapter's credential would have
been resolved in control-plane memory and `I25` would have been violated by the SHAPE of the
composition rather than by anyone's mistake.

S1N builds the missing process and the boundary around it, using a **synthetic** adapter and
a **synthetic** test credential. It introduces no provider, no vendor SDK, no HTTP and no
real credential.

**The transformation:**

```
before      control process ──► adapter object ──► vendor
after       control process ──► deterministic integration boundary ──► dedicated adapter runtime ──► vendor
```

**The property:** *vendor credential bytes never enter control-plane process memory.*

---

## 2. What was built

| Component | Plane | What it is |
|---|---|---|
| `src/integration/protocol/runtimeIdentity.ts` | shared | The closed runtime-identity set: `CONTROL_PLANE`, `INTEGRATION_ADAPTER:<adapter_id>`, with an identifier grammar |
| `src/integration/protocol/wire.ts` | shared | The closed IPC schema — 20 request fields, 4 reply kinds, 16 refusal reasons, a 256 KiB bound, and `§16`'s binding digest |
| `src/integration/protocol/runtimeEnvironment.ts` | shared | `§12`/`§30`'s seven-key **allowlist**, constructed and never filtered |
| `src/integration/control/adapterRuntimeRegistry.ts` | Z1 | Trusted deployment configuration, validated against the **verified class-3 catalogue**, carrying ADR-024's two option-B triggers |
| `src/integration/control/integrationClient.ts` | Z1 | The transport. Forks the runtime, speaks the protocol, bounds the deadline and the concurrency, and translates the closed reply |
| `src/integration/runtime/adapterSecretSource.ts` | Z2 | The narrow per-adapter secret contract. **No cloud vendor is selected** |
| `src/integration/runtime/integrationAdapter.ts` | Z2 | The integration-side adapter contract, and the `ProviderBoundary` mark |
| `src/integration/runtime/integrationHost.ts` | Z2 | The seven guards, in order, ending at the only `invoke` call site |
| `src/integration/runtime/runtimeLog.ts` | Z2 | `§43`'s closed structured record |
| `src/integration/runtime/main.ts` | Z2 | The forked entry point, the module-confinement check and the message loop |
| `tools/perimeter/` | CI | `I24` / `48 §4` item 2 — the external-write perimeter enumeration and its build gate |
| `tools/integration-packaging/` | CI | `§46`'s deterministic packaging manifest and the separation obligations |
| `tests/integration-plane/adapterA,B/` | TEST | Two synthetic Z2 runtimes, in two roots, with two provider clients and two secret sources |

**`src/kernel/gateway/effectGateway.ts` is not touched by this slice — not one line.**

---

## 3. The architecture this implements, by citation

| Obligation | Source | Where |
|---|---|---|
| No control-plane process holds a vendor credential | `I25`, `48 §4` item 4 | the process boundary; `source-boundary.test.ts` |
| Every vendor call site carries `authorisation_ref` or an annotated exemption | `I24`, `48 §4` items 2–3 | `tools/perimeter/`; `integrationHost.ts` guard 3 |
| Per-adapter runtime, filesystem and dependency isolation | `23 §7`, `29 §3.2`, `29 §3.5`, ADR-024 | one runtime per adapter; `ENV_RUNTIME_ROOT`; the packaging manifest |
| A per-credential revocation switch that **revokes** | ADR-024, `07 §10.6` | `SecretResolution.REVOKED` — a state of the source, not a flag in ACOS |
| Vendor secrets in a platform secret manager, injected at process start | ADR-024 | `AdapterSecretSource`; **no cloud vendor selected** (`§9`) |
| Option B at the first money-moving credential or the third adapter | ADR-024, `23 §11`, `31 §12` | `createAdapterRuntimeRegistry` refuses both |
| Adapters are TCB members | `49 §3.1`, `29 §3.1` | stated; the synthetic adapters are not real ones |
| Every external state change originating in reasoning passes the Effect Gateway | `23 §5`, `33 §1`, `48 §1` | the gateway is unchanged and remains the sole origin |
| The dispatch payload reaches the adapter verbatim | `24 §3` K4, `25 §14.1`, ADR-021 | guard 5 recomputes `sha256` on the far side |
| The closed adapter outcome taxonomy | `25 §5`, `25 §7.1`, `25 §7.2` | `WireOutcome` mirrors `AdapterOutcome` exactly |
| Epoch B's entity lease spans the invocation | `25 §14.1`, `30 §5.1` | structural: the `await` did not move |

---

## 4. What S1N deliberately does not do

- **No real provider.** No Postmark, SendGrid, Mailgun, Stripe, Shopify, Meta, Google, no
  vendor SDK, no `fetch`, no HTTP, no socket. Asserted by scan over `src/` and over
  `tests/integration-plane/`.
- **No real credential.** The only material anywhere is a `TEST_ONLY_VENDOR_SECRET_…`
  sentinel minted per test and written to a temporary directory outside the repository.
- **No cloud secret manager.** `§9` forbids selecting one and v1.3.6 names none.
- **No option B.** The broker/execution proxy is recorded and its trigger is enforced.
- **No change to the Effect Gateway, the claim, the outbox, the ledger or the journal.**
- **No new retry path.** `§26`: a process boundary does not authorise a resend.
- **No public listener.** No TCP port, no HTTP server, no named socket.
- **No weakening of the S1M Postmark finding.** `I8` stays open; no `POSTMARK_*` variable is
  consumed by anything S1N added.

---

## 5. Open architecture question carried forward

**v1.3.6 does not define `money-moving credential` as a mechanised predicate.** ADR-024,
`23 §11`, `29 §3.2`, `31 §12`, `33 §7` and `37 §5` all use the phrase; none says how a build
would decide it.

S1N binds it to `50 §2a` **field 4**, `carries_vendor_monetary_field`, whose own definition
(`I18a`) is *"where the dispatched vendor request carries a monetary field"* — a statement
about what the credential presents to the vendor. The broader reading (field 4 **or**
`value_direction ≠ NONE`) is implemented as a reported accessor and is **not** enforced,
because applied to the verified S1 catalogue it makes every adapter identity money-moving and
would leave option A admitting none — contradicting ADR-024's own *"with two adapters and no
money"* and `23 §11`'s four-adapter MVP.

**This is a derivation, not a transcription.** It is recorded in `S1N-result.md §11` as an
owner question. The other half of the trigger — *"the third adapter"* — is exactly stated and
is enforced with no derivation at all.

---

## 6. S1M resumability — `§49`

After S1N, a later provider slice reaches a vendor without moving a credential into the
control plane. The sequence it inherits:

```
Effect Gateway
  └─ AdapterRegistry (from IntegrationClient.adapterRegistry())
       └─ IPC, closed schema, bounded, private pipe
            └─ integration runtime, own PID, own environment, own secret source
                 └─ the adapter's own provider client
                      └─ vendor
```

**What a provider slice has to add, and nothing else:**

1. an `IntegrationAdapter` implementation in its own root, with its own provider client
   carrying `PERIMETER_AUTHORISED(authorisation_ref)`;
2. an `AdapterSecretSource` implementation for the chosen secret manager;
3. one `AdapterRuntimeDescriptor` in the deployment's runtime registry.

**What it must not touch:** the Effect Gateway, the claim, the outbox, the ledger, the
journal, the wire protocol, the guard order, or the option-B trigger.

**The runtime is not coupled to the synthetic adapter.** `src/` contains no import of any
module under `tests/integration-plane/`; `main.ts` loads whatever its trusted launch
configuration names, confined to that runtime's own root. The only mentions of the synthetic
adapters anywhere in `src/` are in prose comments explaining that they are test fixtures.
