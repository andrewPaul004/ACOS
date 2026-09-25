# S1N — evidence: tool runs

Captured on the branch head, verbatim.

## `npm run verify:perimeter`

```text
ACOS EXTERNAL-WRITE PERIMETER — I24 / 48 §4 item 2

roots:                        src, tests\integration-plane
production call sites:        0
  carrying authorisation_ref: 0
  annotated PERIMETER_EXEMPT: 0
  UNANNOTATED:                0
test-only call sites:         4
  UNANNOTATED:                0

TEST_ONLY  PROVIDER_CLIENT    AUTHORISED                         tests\integration-plane\adapterA\adapter.ts:70
TEST_ONLY  PROVIDER_CLIENT    AUTHORISED                         tests\integration-plane\adapterA\providerClient.ts:73
TEST_ONLY  PROVIDER_CLIENT    AUTHORISED                         tests\integration-plane\adapterB\adapter.ts:46
TEST_ONLY  PROVIDER_CLIENT    AUTHORISED                         tests\integration-plane\adapterB\providerClient.ts:40

RESULT: PASS
```

## `npm run verify:packaging`

```text
ACOS INTEGRATION PACKAGING MANIFEST — §11, §45, §46

CONTROL_PLANE  (64 first-party modules)
    src/db/pool.ts
    src/integration/control/adapterRuntimeRegistry.ts
    src/integration/control/integrationClient.ts
    src/integration/protocol/runtimeEnvironment.ts
    src/integration/protocol/runtimeIdentity.ts
    src/integration/protocol/wire.ts
    src/kernel/canonicalisation/actionCatalogue.ts
    src/kernel/canonicalisation/actionClasses.ts
    src/kernel/canonicalisation/authoritativeCost.ts
    src/kernel/canonicalisation/brands.ts
    src/kernel/canonicalisation/canonicalBytes.ts
    src/kernel/canonicalisation/constructorVersion.ts
    src/kernel/canonicalisation/errors.ts
    src/kernel/canonicalisation/grantWindows.ts
    src/kernel/canonicalisation/intent.ts
    src/kernel/canonicalisation/jcs1Admission.ts
    src/kernel/canonicalisation/optionDigest.ts
    src/kernel/canonicalisation/rationale.ts
    src/kernel/canonicalisation/registry.ts
    src/kernel/canonicalisation/types.ts
    src/kernel/clocks/statutoryClock.ts
    src/kernel/controlArtifacts/artifactPackage.ts
    src/kernel/controlArtifacts/artifactParsers.ts
    src/kernel/controlArtifacts/bundle.ts
    src/kernel/controlArtifacts/casSig.ts
    src/kernel/controlArtifacts/ed25519.ts
    src/kernel/controlArtifacts/errors.ts
    src/kernel/controlArtifacts/incidents.ts
    src/kernel/controlArtifacts/manifestCore.ts
    src/kernel/controlArtifacts/registry.ts
    src/kernel/controlArtifacts/requiredSet.ts
    src/kernel/controlArtifacts/trustConfig.ts
    src/kernel/controlArtifacts/verifier.ts
    src/kernel/enumeration/clock.ts
    src/kernel/enumeration/contextSpec.ts
    src/kernel/enumeration/entityLease.ts
    src/kernel/enumeration/enumerateEffects.ts
    src/kernel/enumeration/enumeratedOptionSet.ts
    src/kernel/enumeration/enumerationRecord.ts
    src/kernel/enumeration/port.ts
    src/kernel/exposure/errors.ts
    src/kernel/exposure/ledger.ts
    src/kernel/exposure/lockOrder.ts
    src/kernel/exposure/money.ts
    src/kernel/exposure/retry.ts
    src/kernel/exposure/windowInstance.ts
    src/kernel/gateway/adapterPort.ts
    src/kernel/gateway/adapterRegistry.ts
    src/kernel/gateway/dispatchCapability.ts
    src/kernel/gateway/dispatchEnvelope.ts
    src/kernel/gateway/dispatchLease.ts
    src/kernel/gateway/dispatchRevalidation.ts
    src/kernel/gateway/effectGateway.ts
    src/kernel/gateway/outcomePolicy.ts
    src/kernel/gateway/outcomeTransaction.ts
    src/kernel/mirror/corroborationSignal.ts
    src/kernel/mirror/degradedModeOverride.ts
    src/kernel/mirror/degradedModeThresholds.ts
    src/kernel/mirror/dispatchPrecedence.ts
    src/kernel/mirror/mirrorState.ts
    src/kernel/mirror/mirrorStateMachine.ts
    src/kernel/mirror/signalSource.ts
    src/kernel/outbox/claim.ts
    src/kernel/outbox/outboxState.ts

INTEGRATION_ADAPTER:mock_ads  (12 first-party modules)
    src/integration/protocol/runtimeEnvironment.ts
    src/integration/protocol/runtimeIdentity.ts
    src/integration/protocol/wire.ts
    src/integration/runtime/adapterSecretSource.ts
    src/integration/runtime/integrationAdapter.ts
    src/integration/runtime/integrationHost.ts
    src/integration/runtime/main.ts
    src/integration/runtime/runtimeLog.ts
    src/kernel/canonicalisation/actionClasses.ts
    tests/integration-plane/adapterA/adapter.ts
    tests/integration-plane/adapterA/providerClient.ts
    tests/integration-plane/adapterA/secretSource.ts

INTEGRATION_ADAPTER:mock_commerce  (12 first-party modules)
    src/integration/protocol/runtimeEnvironment.ts
    src/integration/protocol/runtimeIdentity.ts
    src/integration/protocol/wire.ts
    src/integration/runtime/adapterSecretSource.ts
    src/integration/runtime/integrationAdapter.ts
    src/integration/runtime/integrationHost.ts
    src/integration/runtime/main.ts
    src/integration/runtime/runtimeLog.ts
    src/kernel/canonicalisation/actionClasses.ts
    tests/integration-plane/adapterB/adapter.ts
    tests/integration-plane/adapterB/providerClient.ts
    tests/integration-plane/adapterB/secretSource.ts

SEPARATION OBLIGATIONS
  PASS  I25 / §10 — the CONTROL closure contains no secret source, no provider client, no adapter implementation and no integration-runtime module
  PASS  §11 — adapter A's closure contains no module of adapter B's
  PASS  §11 — adapter B's closure contains no module of adapter A's
  PASS  §11 — the two adapter closures overlap only in the shared integration protocol, the integration-runtime host and the closed catalogue member sets
  PASS  §45 — the mock_ads runtime holds its OWN adapter and its OWN secret source
  PASS  §45 — the mock_commerce runtime holds its OWN adapter and its OWN secret source
  PASS  §12 — the mock_ads runtime's closure reaches no control or audit database module
  PASS  §12 — the mock_commerce runtime's closure reaches no control or audit database module

RESULT: PASS
```
