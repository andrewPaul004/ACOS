# S1O — contract

**Credential-risk definition, the audit-plane provider-read boundary, and provider selection.**
Against **ACOS Operating Spine v1.3**, package issue **v1.3.7** — issued by this slice.
Baseline `e9ec232` (S1N, PASS). Branch `feature/s1o-provider-selection-audit-boundary`.

---

## 1. What this slice is for

Three objectives, and the first is the one the other two rest on.

**1. Resolve `S1N-C1` normatively.** S1N built the integration-plane credential boundary and
found that ADR-024's option-B trigger — *"the first **money-moving credential** or the third
adapter, whichever comes first"* — had **no mechanised operand anywhere in v1.3.6**. It
derived one from the action catalogue under protest and flagged it. The owner ruled that
derivation **wrong in kind**, and v1.3.7 replaces it.

**2. Build the audit-plane provider-read boundary.** `48 §2` row 13 — "Audit plane vendor
reads" — described a capability with **no component**, and `48 §3.6`'s "read-only, separately
provisioned, and attempted-write-tested" was a requirement with **nothing to hold it**. S1O
builds the second process, on the audit side, with a synthetic reader and a synthetic
credential.

**3. Select the provider** for the resumed real-provider validation, from current official
documentation, under a decision rule written as a function rather than a paragraph.

**No provider request of any kind was made. No real credential is required or held.**

---

## 2. The transformation

```
before   ADR-024 trigger operand   (none — prose in six deliverables)
after    50 §2g field 6, signed class-5 bytes, read by the registry

before   audit plane ──► (nothing)
after    audit plane ──► closed read-only boundary ──► dedicated reader runtime ──► provider

before   provider selection        (Postmark, PARTIAL on blocker C)
after    Twilio SendGrid, selected on a documented disjoint scope pair
```

---

## 3. What was built

| Component | Plane | What it is |
|---|---|---|
| `docs/architecture/v1.3.7/` | ARCH | package issue v1.3.7: `50 §2g`, ADR-024's mechanised trigger, `48 §3.6`'s operand, `37 §2`'s SEQ-04, and 12 new gate conditions |
| `src/kernel/controlArtifacts/credentialRisk.ts` | Z1 | the closed `CredentialRiskClass`, the nine clauses, maximum privilege, and `§2g`'s self-consistency rule |
| `src/kernel/controlArtifacts/artifactParsers.ts` | Z1 | `parseClass5CredentialScopes` — the closed seven-field schema, four refusals |
| `src/kernel/controlArtifacts/{bundle,requiredSet,verifier}.ts` | Z1 | class 5 as the **seventh** pre-live signed artifact and manifest member |
| `src/integration/control/adapterRuntimeRegistry.ts` | Z1 | ADR-024's trigger, **rebased off the action catalogue onto the signed credential record** |
| `src/audit/provider/protocol/readerIdentity.ts` | Z4 | `AUDIT_PROVIDER_READER:<provider_id>`, an identity space disjoint from Z2's |
| `src/audit/provider/protocol/readWire.ts` | Z4 | the closed read-only protocol: 3 operations, 10 request fields, 12 refusals, period-bounded always |
| `src/audit/provider/protocol/readerEnvironment.ts` | Z4 | an eight-key allowlist, constructed, **disjoint from the integration plane's by computation** |
| `src/audit/provider/plane/auditReaderRegistry.ts` | Z4 | `48 §3.6`'s exemption enforced: `READ_ONLY`, `audit_plane`-scoped, and no locator the send side holds |
| `src/audit/provider/plane/auditReadClient.ts` | Z4 | the transport. Forks the reader, bounds the deadline and the concurrency |
| `src/audit/provider/runtime/auditProviderReader.ts` | Z4 | the reader contract — **three members, fourteen mutation names refused at composition** |
| `src/audit/provider/runtime/auditSecretSource.ts` | Z4 | the audit plane's own secret contract, keyed by PROVIDER. **No cloud vendor selected** |
| `src/audit/provider/runtime/auditReadHost.ts` | Z4 | seven guards, in order, ending at the only `readFromProvider` call site |
| `src/audit/provider/runtime/main.ts` | Z4 | the forked entry point, confinement, and the `READ_ONLY` start gate |
| `src/audit/provider/independentFinding.ts` | Z4 | `§14`'s independence, **as a type**: two operands, neither a control-plane verdict |
| `src/audit/controlArtifacts/auditPlaneVerifier.ts` | Z4 | class 5 verified **independently by the audit plane**, keeping only `audit_plane` records |
| `tools/provider-selection/capabilityRecord.ts` | EVID | the dated record, the `§19` conjunction, and `§23`'s decision rule as a function |
| `tools/perimeter/perimeterScan.ts` | CI | `PROVIDER_READ_CLIENT` — `48 §2` row 13 enumerated, annotated and exempt |
| `artifacts/control/class-05.credential-scopes.json` | ARTIFACT | six declared credentials, including the two that answer `§8` and `§9` |
| `tests/audit-plane/readerA/` | TEST | the synthetic Z4 runtime: three reads, **no send member of any kind** |

**`src/kernel/gateway/effectGateway.ts` is not touched by this slice — not one line.**

---

## 4. The architecture this implements, by citation

| Obligation | Source | Where |
|---|---|---|
| `money-moving credential` has a mechanised definition | `S1N-C1`, ADR-024 | `50 §2g`; `credentialRisk.ts` |
| The classification is a CREDENTIAL property, not an action property | `50 §2g`, `29 §14` | `declaredCredentialRiskClass` — a lookup, not a derivation |
| The class is closed at three values with no permissive default | `50 §2g` | `CREDENTIAL_RISK_CLASSES`; the parser's fourth refusal |
| A mixed envelope takes the highest reachable class | `50 §2g` | field 5 non-empty ⇒ `MONEY_MOVING`, checked at parse |
| A missing classification FAILS CLOSED | `50 §2g` | `CREDENTIAL_NOT_DECLARED`, in both registries |
| The classification is signed, dual-signed, manifest-bound authority | `50 §2g`, `50 §6` | class 5, the seventh pre-live artifact |
| Option B at the first money-moving credential or the third adapter | ADR-024, `50 §2g` | `createAdapterRuntimeRegistry` refuses both halves |
| Option B remains unimplemented | ADR-024, `37 §2` | no execution proxy exists |
| The audit plane holds an independent read credential incapable of mutation | `48 §3.6`, `36 §13` | the reader runtime; `isAuditProviderReader` |
| The audit credential is not in the control process or the send runtime | `I25`, `23 §7`, `29 §3.5` | the process boundary; the disjoint allowlists |
| The audit credential does not share a source with the send credential | `§13` | `READER_LOCATOR_SHARED_WITH_INTEGRATION` |
| Audit reads are period-bounded and never ACOS-tag-bounded | `48` v1.3 note | `PERIOD_BOUND_INVALID`; the tag narrows, never replaces |
| An audit finding does not depend on a control-plane verdict | `§14`, `30 §5.4` | `deriveIndependentFinding` has no parameter for one |
| Every vendor read is an enumerated, annotated perimeter site | `48 §2` row 13, `48 §3` | `PROVIDER_READ_CLIENT` in the CI scan |
| `I8` / `36 §13` are not weakened to accommodate a provider | `§26`, `48 §3.6` | Postmark NOT SELECTED; the test stays owed |

---

## 5. What S1O deliberately does not do

- **No provider request.** No SendGrid, Mailgun or Postmark call, no `fetch`, no HTTP, no
  socket, no vendor SDK, no vendor name in any runtime. Asserted by scan over
  `src/audit/provider/` and `tests/audit-plane/`.
- **No real credential.** The only material anywhere is a `TEST_ONLY_AUDIT_READ_SECRET_…`
  sentinel minted per test, written outside the repository.
- **No cloud secret manager.** `§9` of the S1N mandate still forbids selecting one, and
  v1.3.7 names none.
- **No option B.** The trigger is mechanised; the execution proxy is not built.
- **No S1M resumption.** The six-kill-point test is not re-run and no sandbox is configured.
- **No change to the Effect Gateway, the claim, the outbox, the ledger or the journal.**
- **No widening of class 3.** The action catalogue stays at ten-plus-four.
- **No production signing.** Class 5's owner signature is newly owed and undischarged.

---

## 6. The two accepted assertions amended, out loud

`45 §3` warns about accepted boundary assertions changed quietly. Two changed here.

**1. `tests/integration/perimeter/perimeter-enumeration.test.ts`** asserted the perimeter
roots were exactly `['src', …'integration-plane']`. S1O adds `tests/audit-plane/`, and the
test now asserts three roots plus a new case requiring every `PROVIDER_READ_CLIENT` site to be
`TEST_ONLY`, `EXEMPT`, and annotated `audit_plane_read_only / 48-3-6` — and requiring **zero**
send clients under the audit plane. The reason is `48 §3`'s own: an exemption is a *named,
annotated, reviewed* hole, and an unenumerated read is unreviewed rather than exempt.

**2. `tests/negative-controls/integration-controls.test.ts` CONTROLS 12 and 13** asserted
S1N's `derivedCredentialClass` and `movesValueUnderBroadReading`. Both functions are
**removed** — they computed the answer v1.3.7 rules wrong in kind — and the controls now
assert the signed lookup, plus a third case proving one adapter's two credentials classify
differently. `CREDENTIAL_CLASS_UNDERSTATED` is removed with them, because there is no
deployment-declared class left to understate.

`tests/release/deployment-dry-run.test.ts` also changed, and only mechanically: two cases
spliced a class-17 entry at a **literal index** that encoded the inventory's length. Class 5
moved it, turning both into order failures that silently stopped testing the pin. The index is
now derived from the classes actually present.
