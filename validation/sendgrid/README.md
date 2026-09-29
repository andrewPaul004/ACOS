# `validation/sendgrid/` — the S1P non-production provider-validation package

**This tree is NOT `src/`, NOT `tests/`, and the distinction is load-bearing.**

## What lives here

The Twilio SendGrid **non-production** validation package: one integration-plane adapter with
one real vendor HTTP client, one audit-plane Email Activity reader with its own real vendor
HTTP client, a bounded observation loop, and the live-validation harness that drives them.

## Why it is not under `src/`

Three ACCEPTED boundary assertions say `src/` holds no adapter implementation, no vendor name
and no real transport:

- `tests/postmark/postmark-tooling-boundary.test.ts` — *"`src/` still contains NO adapter
  implementation at all"*, and the vendor-name scan over every file under `src/`.
- `tests/integration/gateway/no-real-transport-boundary.test.ts` — the gateway directory's
  import allow-list and the transport prohibition.
- S1M `§48`, verbatim on why it declined to widen them: *"Widening a security test in the same
  commit that adds nothing which needs the width is how a perimeter quietly stops being one."*

**S1P WIDENS NONE OF THEM.** `git diff` over `src/` for this slice touches no boundary those
suites assert, and production's `emptyAdapterRuntimeRegistry()` is still empty. A real vendor
client placed in the production control-plane tree would be one `fork` away from a production
deployment, and S1P is explicitly forbidden from enabling production SendGrid.

## Why it is not under `tests/`

`§18` of the S1N mandate scopes the `TEST_ONLY` perimeter scope to SYNTHETIC providers:
*"If a **test synthetic provider** needs an exemption from a specific network rule, it remains
TEST-ONLY and is not a production perimeter entry."*

**THIS CLIENT IS NOT SYNTHETIC.** `sendToProviderSendGrid` reaches `api.sendgrid.com`. Placing
it under `tests/` would make the first real external-write site in this repository's history
land in the scope that is *excluded from the production perimeter count* — which is the quiet
weakening `48 §7` question 4 exists to catch.

So `validation/` is a fourth perimeter root, its first path segment is not `tests`, and
`tools/perimeter/` therefore scans every site here at **`PRODUCTION` scope**: the send sites
must carry `PERIMETER_AUTHORISED(authorisation_ref)` and the read sites must carry
`PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6)`, or the build fails.

## What this package CANNOT do

| | |
|---|---|
| run during `npm test` | **No.** No file here is a vitest test file, nothing under `tests/` imports the harness entry point, and `tests/sendgrid/` exercises the pure mapping, refusal and bounded-observation logic against an injected transport that is never the real one. |
| reach a provider without an explicit opt-in | **No.** `harness/preflight.ts` refuses before any network call unless every gate passes, and `harness/cli.ts` requires an explicit acknowledgement token. |
| be reached from the control plane | **No.** The adapter is loaded by `src/integration/runtime/main.ts` inside the forked credential-holding child; the reader is loaded by `src/audit/provider/runtime/main.ts` inside the audit plane's own child. |
| send from the audit plane | **No.** `audit/` declares no `sendToProvider*` function. The `36 §13` attempted-write probe is `audit/sendRefusalProbe.ts`, which is unreachable from the audit read IPC surface by construction. |
| run today | **No.** No SendGrid credential exists in this repository or its environment, and the signed class-3 / class-5 records a real run needs have not been released. See `docs/implementation/S1P-operator-procedure.md`. |

## The two prerequisites that are NOT repository work

1. **A signed class-3 record** naming an email action class and the `sendgrid_email` adapter.
   `createAdapterRuntimeRegistry` refuses `ADAPTER_NOT_IN_CATALOGUE` without it, and the
   deployed `artifacts/control/class-03.action-catalogue.json` carries four action classes and
   three adapters, none of them email.
2. **Signed class-5 records** for the two credentials — a `NON_MONETARY_WRITE` `mail.send`
   record bound to that adapter, and a `READ_ONLY` `audit_plane`-scoped `email_activity.read`
   record. `CREDENTIAL_NOT_DECLARED` fails closed without them.

**S1P DOES NOT FORGE EITHER.** Both are owner-ceremony prerequisites, both are named by the
preflight as refusals, and `tests/sendgrid/registry-prerequisites.test.ts` asserts that the
refusals are the ones that actually fire against the deployed bytes.
