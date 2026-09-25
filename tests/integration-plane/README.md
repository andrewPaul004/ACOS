# `tests/integration-plane/` — the SYNTHETIC Z2 runtimes

**TEST-ONLY. Nothing here is production code and nothing here reaches a vendor.**

`§4` of the S1N mandate forbids Postmark, SendGrid, Mailgun, Stripe, Shopify, Meta, Google,
any real provider HTTP and any vendor SDK. `§7` of the S1J mandate put the deterministic
mock in "test/support or another explicitly non-production test location", and this is the
other explicitly non-production test location — the one that is loaded *by a separate OS
process*, which is the whole subject of S1N.

## What is here

```
adapterA/           `mock_ads`       — REVERSIBLE `campaign.pause`, COMPENSABLE `campaign.budget.set`
  adapter.ts        the synthetic IntegrationAdapter
  providerClient.ts §31's ONE clearly marked provider-client call boundary. In-process,
                    deterministic, no network of any kind.
  secretSource.ts   the fixture AdapterSecretSource, scoped to `mock_ads`

adapterB/           `mock_commerce`  — IRRECOVERABLE `fulfilment.reship`
  adapter.ts
  providerClient.ts
  secretSource.ts
```

Two roots, and the separation is the point. `§7`: "one credential scope → one adapter
runtime", and `§11`: "Adapter B must not be able to import A's provider-specific module."
`main.ts` refuses to load a module that does not resolve inside the runtime's own
`ACOS_INTEGRATION_RUNTIME_ROOT`, and `tools/integration-packaging/` proves the two static
import closures are disjoint.

## What is deliberately absent

No `fetch`. No `http`, `https`, `net`, `tls` or `dgram`. No vendor SDK. No vendor name. No
real credential. `tests/integration/integration/no-real-provider-boundary.test.ts` asserts
each as an absence over this directory as well as over `src/`.

The secrets these fixtures serve are `TEST_ONLY_VENDOR_SECRET_…` sentinels minted by the
test that launches the runtime. They are not provisioned here, they are not committed, and
`§29`'s leak matrix asserts they appear nowhere except the runtime that resolved them.
