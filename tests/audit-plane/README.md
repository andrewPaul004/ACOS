# `tests/audit-plane/` — the SYNTHETIC Z4 provider-read runtimes

**TEST-ONLY. Nothing here is production code and nothing here reaches a vendor.**

`§27` of the S1O mandate forbids any provider send call and any real provider request:

> Do not make any provider send call. No: SendGrid send; Mailgun send; Postmark send. **No
> real provider secret should be required.** The first real send belongs to the resumed
> provider-validation slice after owner review.

The same restraint applies to reads. **S1O selects a provider from official documentation and
builds the audit-plane boundary; it contacts no provider at all.** The runtimes here are the
synthetic Z4 counterparts of `tests/integration-plane/`'s synthetic Z2 runtimes, and they
exist so the boundary can be proved with a synthetic credential before a real one is
provisioned — `§17`: "Use synthetic credential first."

## What is here

```
readerA/            provider `synthetic_esp` — the READ-ONLY audit reader
  reader.ts         the synthetic AuditProviderReader: three read operations, no send
  providerReadClient.ts  the one clearly marked provider-READ call boundary. In-process,
                    deterministic, no network of any kind
  secretSource.ts   the fixture AuditReadSecretSource, scoped to `synthetic_esp`
```

## Why this is a separate root from `tests/integration-plane/`

`§13`: "Do not put audit credentials into: control process; **control integration adapter
runtime**; **same secret source as send credential**."

`main.ts`'s `isInsideAuditRuntimeRoot` refuses to load a module that does not resolve inside
the runtime's own `ACOS_AUDIT_READER_RUNTIME_ROOT`, so an audit reader confined to
`tests/audit-plane/readerA/` cannot load anything under `tests/integration-plane/` — not
adapter A's provider client, and not adapter A's secret source. The two roots are what make
that a refusal rather than a convention.

## What is deliberately absent

No `fetch`. No `http`, `https`, `net`, `tls` or `dgram`. No vendor SDK. No vendor name. No
real credential. **And no send member of any kind** — `isAuditProviderReader` refuses a
reader object carrying `send`, `post`, `put`, `patch`, `delete`, `write`, `create`,
`update`, `invoke`, `dispatch`, `request`, `call`, `execute` or `fetch`, and the refusal runs
at composition before any credential is resolved.

The secrets these fixtures serve are `TEST_ONLY_AUDIT_READ_SECRET_…` sentinels minted by the
test that launches the runtime. They are not provisioned here, they are not committed, and
`§17`'s leak matrix asserts they appear nowhere except the reader that resolved them — and,
specifically, **not in the sibling integration send process**.

## The one thing a synthetic reader CANNOT prove

`§15`: "For a provider to qualify, the audit credential must be independently demonstrated to
perform required message/activity queries **and fail a write/send attempt at the PROVIDER**.
A documentation claim alone is not the final acceptance proof for a configured provider."

A synthetic reader refuses a write because this repository wrote it to. That proves the ACOS
side of the boundary and proves nothing about any vendor. **The empirical attempted-write
test against the selected provider's real account remains OPEN**, is recorded as such in
`tools/provider-selection/capabilityRecord.ts`'s `unresolvedAccountItems`, and belongs to the
resumed provider-validation slice.
