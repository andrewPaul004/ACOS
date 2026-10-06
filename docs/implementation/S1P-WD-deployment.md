# S1P-WD — Non-production deployment packaging for signed provider push

**Status: S1P-WD DEPLOYMENT PACKAGING COMPLETE — AZURE APP/DB NOT PROVISIONED.**
Nothing was deployed. No Azure, SendGrid or provider call was made; no infrastructure, credential,
webhook or real artifact was created. `docs/architecture/` is unchanged.

This slice makes the accepted S1P-WR provider-evidence ingress (`48 §8` row I1,
`src/audit/providerEvidence/ingressMain.ts`) deployable to Azure Container Apps.

| Item | Location |
|---|---|
| Container image | `deploy/provider-evidence-ingress/Dockerfile`, `deploy/provider-evidence-ingress/tsconfig.build.json`, `.dockerignore` |
| Image contents (derived), staging, image inspection | `tools/deploy/ingressImage.ts`, `tools/deploy/ingressImageCli.ts` (`npm run deploy:ingress-image`) |
| Container App definition (reviewable, non-executing) | `deploy/provider-evidence-ingress/containerapp.template.json`, `containerapp.params.example.json` |
| Renderer / validator / binding probes (prints, never runs) | `tools/deploy/containerApp.ts`, `tools/deploy/containerAppCli.ts` (`npm run deploy:render-ingress`) |
| Image-safe ingress DB module | `src/audit/providerEvidence/evidenceIngressPool.ts` — role-checked, TLS-checked, verbatim, no password; `ingressMain.ts` imports it and refuses startup otherwise |
| Role-specific deployment URL rule (shared) | `src/audit/db/roleScopedUrl.ts` — exact role, host, database, password, exactly one `sslmode=verify-full`, no competing TLS/host parameter; used by the ingress (in the image) and the evaluator (not in it) |
| Evaluator credential | `src/audit/db/auditPool.ts` — `auditEvaluatorUrl()` uses an `acos_audit_evaluator` URL verbatim only if it passes the same rule, else throws (not in the image) |
| Tests | `tests/deploy/ingress-image.test.ts`, `tests/deploy/container-app.test.ts` |

---

## 1. Reserved identity and target

| | |
|---|---|
| Resource group / environment / region | `rg-acos-s1p-nonprod` / `cae-acos-s1p-audit` / `centralus` |
| Environment default domain | `thankfulbay-82c0739d.centralus.azurecontainerapps.io` |
| Future app | `ca-acos-s1p-webhook` |
| **Reserved `ingress_identity`** | `https://ca-acos-s1p-webhook.thankfulbay-82c0739d.centralus.azurecontainerapps.io/provider-evidence/sendgrid` |

The reserved URL appears in this repository only as **deployment configuration** — the template's
launch echo, which can only stop the receiver (`launchEchoMatches`). The authority for the ingress
identity is the SIGNED class-28 record, which does not exist yet. A test asserts the URL appears
nowhere under `src/` or `artifacts/control/`.

## 2. Container image

* **Build stage** (Node 24 LTS: `node:24.21.0-trixie-slim@sha256:8ec5d755…`, digest-pinned): `npm ci --ignore-scripts` from the root lockfile;
  `tsc -p deploy/provider-evidence-ingress/tsconfig.build.json` compiles ONLY the ingress entry
  point's import closure (comments removed); `ingressImageCli.ts stage` copies exactly that closure
  plus `pg`'s REQUIRED locked dependency tree into `/stage`.
* **Runtime stage** (Node 24 LTS on Debian 13: `gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f58…`, digest-pinned): no shell, no package manager,
  no `tsx`/TypeScript. `COPY --from=build --chown=0:0 /stage/ /app/` is its only file operation;
  files are root-owned and read-only to the process; `USER 65532:65532`; `EXPOSE 8080`;
  `ENTRYPOINT ["/nodejs/bin/node", "/app/src/audit/providerEvidence/ingressMain.js"]` — the same
  module `npm run ingress:provider-evidence` runs, compiled. There is no CMD and no other process.
* **Contents are derived, not listed**: the 11 application modules are the
  `AUDIT_PROVIDER_EVIDENCE_INGRESS` closure computed by `tools/integration-packaging/` (the same
  walk `npm run verify:packaging` evaluates against `48 §8`); the 13 package directories are `pg`
  and its required dependencies from `package-lock.json` (`pg-cloudflare`/`pg-native` are optional
  and excluded; a dev dependency reaching the closure is refused). The image carries an
  `IMAGE-MANIFEST.json` with every file's SHA-256.
* **Build context is an allowlist** (`.dockerignore`): everything excluded, then only
  `package.json`, `package-lock.json`, `tsconfig.json`, `src/`, `tools/integration-packaging/`,
  `tools/deploy/` and the build tsconfig re-included; `.env*`, `*.local.json`, `*.pem`, `*.key`,
  `*.pfx`, `*.p12`, `node_modules`, `.git` re-excluded inside them. `tests/`, `validation/`,
  `artifacts/`, `docs/`, review artifacts, evidence and key material never enter the context.
* **Both base images are Node 24 LTS and PINNED BY DIGEST** as the `ARG` defaults (owner ruling:
  Node 20 is end-of-life and does not run a newly exposed public webhook):
  `node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe`
  and `gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e`
  (resolved 2026-10-05; both report Node v24.21.0, LTS "Krypton", OpenSSL 3.5.8; Debian 13).
  A tag alone is mutable; `baseImagePinProblems` (tested) refuses any default that is not
  `name@sha256:<64 hex>`, any default outside the selected family (build `node:24.x.y-trixie-slim`,
  runtime `distroless/nodejs24-debian13:nonroot` — so a digest-pinned Node 20 FAILS), and any
  `FROM` that bypasses the ARGs. A Node-major or base change is a reviewed change to those lines
  and that rule. The repository-wide `engines` (`>=20.11.0`) is unchanged: this is a deployment
  runtime choice, and the compatibility runs found no reason to change it. Build for the platform: `docker build --platform linux/amd64 -f deploy/provider-evidence-ingress/Dockerfile -t <registry>/acos-s1p-provider-evidence:<git-commit-sha> .`
* **Read-only root filesystem**: the process writes nothing to disk (logs go to stderr). Container
  Apps does not expose a read-only-root flag; the app files are root-owned and the process is
  non-root, so it cannot modify its own code.
* **The image contains ZERO database password literals.** The development module that derives
  audit-role URLs with committed passwords (`auditPool.ts`) is no longer in the ingress closure (§4).
  Every committed database password is DERIVED from the files that commit it
  (`knownCommittedDatabasePasswords`: role `PASSWORD '…'` in SQL, `…PASSWORD = '…'` constants,
  `POSTGRES_PASSWORD`, `.env.example` URLs) and the inspection fails if any occurs in an application
  file or ANYWHERE in the raw `docker export` bytes; it also fails on `auditPool.js` in the image,
  any import of it, and any credential-derivation code (`.password =`, `.username =`, `asRole(`).

## 3. Runtime environment contract (read from the code, complete)

Nothing else in the ingress closure reads the environment (`ingressMain.ts` `INGRESS_ENVIRONMENT`,
`auditPlaneVerifier.ts` `AUDIT_PLANE_TRUST_VARIABLES`, `evidenceIngressPool.ts`
`EVIDENCE_INGRESS_URL_VARIABLE`). The ingress takes `ACOS_AUDIT_PG_URL` from the SAME environment
record as its other inputs (in `main`, that record is `process.env`).

| Variable | Container App value | Kind |
|---|---|---|
| `ACOS_PROVIDER_EVIDENCE_PROVIDER` | `twilio_sendgrid` | literal; selects which SIGNED class-28 record to serve |
| `ACOS_PROVIDER_EVIDENCE_INGRESS_ECHO` | the reserved identity, exactly | literal; non-authoritative launch echo |
| `ACOS_PROVIDER_EVIDENCE_LISTEN_HOST` | `0.0.0.0` | literal; bind inside the container |
| `ACOS_PROVIDER_EVIDENCE_LISTEN_PORT` | `8080` | literal; equals `ingress.targetPort` |
| `ACOS_AUDIT_PG_URL` | `secretref:audit-pg-url` — the `acos_audit_evidence_ingress` URL | Key Vault secret reference (§6); any other role refuses startup |
| `ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY` | 64-hex owner PRIMARY Ed25519 public key | `50 §3a` trust root (public) |
| `ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY` | 64-hex owner SECOND-FACTOR public key | `50 §3a` trust root (public) |
| `ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID` | released `manifest_id` | `50 §3e` deployment pin |
| `ACOS_AUDIT_CONTROL_ARTIFACT_ROOT` | `/etc/acos/control-artifacts` | the read-only mount (§5) |

Must NOT be set: any `PG*` variable (pg would fall back to them), any `ACOS_CONTROL_*`, any
`ACOS_S1P_*` (locators), any SendGrid, Key Vault, `AZURE_CLIENT_*`/`AZURE_TENANT_*` or decision-key
variable. The renderer refuses a definition carrying one. `NODE_EXTRA_CA_CERTS` is the only
optional addition, and only if §6's TLS check needs it.

TLS is terminated by Container Apps; Node serves plain HTTP/1.1 on 8080 inside the environment.

## 4. Database credentials: one role per process, none in the image

The accepted runtime's ingress used `auditPool.ts`, which DERIVES every audit role's URL from a
local OWNER URL with the repository's committed development passwords. That module is right for
local development and tests and wrong for a deployed process, so:

* **`src/audit/db/roleScopedUrl.ts`** (new, in the image; no password) — THE rule for a
  role-specific deployment URL. Accepted only if: `postgres:`/`postgresql:`; the decoded user is
  EXACTLY the role; a non-empty host; a non-empty database; a non-empty password; EXACTLY ONE
  `sslmode` parameter whose value is EXACTLY `verify-full`; no `ssl` parameter, no case-variant of
  either, and no `host`/`hostaddr` override. It is then used **verbatim** — never rewritten,
  normalised or upgraded; other parameters such as `sslrootcert=…` are preserved byte for byte. No
  `PGSSL*` variable is consulted: the URL is the sole database TLS authority. Refusals:
  `AUDIT_STORE_URL_MISSING`, `…_URL_MALFORMED`, `…_ROLE_MISMATCH`, `…_HOST_MISSING`,
  `…_DATABASE_MISSING`, `…_PASSWORD_MISSING`, `…_TLS_NOT_VERIFY_FULL` (absent or any weaker mode),
  `…_TLS_PARAMETER_CONFLICT` (duplicate/case-variant `sslmode`, any `ssl`, a host override).
* **`src/audit/providerEvidence/evidenceIngressPool.ts`** (in the image) applies that rule for
  `acos_audit_evidence_ingress` (a role mismatch is named `AUDIT_STORE_ROLE_NOT_EVIDENCE_INGRESS`).
  `ingressMain.ts` imports it and **refuses startup before the listener binds** with
  `AUDIT_STORE_CREDENTIAL_INVALID`, the specific reason carried as the detail. The owner, the
  evaluator, the replication role, a look-alike role, or weaker TLS: refused, never rewritten.
* **`src/audit/db/auditPool.ts`** (not in the image): unchanged for the ingress role (local and
  test derivation only). The **evaluator** accepts its OWN role-specific URL (user exactly
  `acos_audit_evaluator`) verbatim ONLY if it passes the same rule — otherwise it THROWS, so a live
  S1P validation run uses the evaluator's credential over verified TLS and never the owner URL.
  Any other user is the LOCAL development owner URL, derived as before with no TLS requirement.
* **Tests and the local test database.** The local test PostgreSQL has no TLS and the rule is not
  relaxed for it, so tests that need the real store hand the ingress an explicit store port over
  the test-side role pool (`testIngressStore()` in `tests/support/providerEvidenceFixture.ts`). The
  default TLS pool path is proven end to end in the S1P-WD container checks against a TLS
  PostgreSQL (verify-full + `sslrootcert`, TLSv1.3; hostname mismatch and unknown CA both fail).

| Process | Database role | Supplied as | Never receives |
|---|---|---|---|
| Container App `ca-acos-s1p-webhook` (provider-evidence ingress) | `acos_audit_evidence_ingress` (INSERT+SELECT on the three `A0009` tables) | Key Vault secret → `ACOS_AUDIT_PG_URL` | the owner credential; any other role |
| S1P live validation / evaluator (operator workstation, Phase C) | `acos_audit_evaluator` (SELECT on the `A0009` tables) | `ACOS_AUDIT_PG_URL` = the evaluator URL, in the operator's shell | the owner credential |

The audit OWNER credential is used only by the operator, for migrations (§6).

## 5. Control-artifact delivery

The audit verifier reads `manifest.json` and the named artifact files from
`ACOS_AUDIT_CONTROL_ARTIFACT_ROOT`, hashes the EXACT bytes, checks both signatures, and refuses
unless the manifest id equals the pin. Container Apps can provide that filesystem contract
directly, so **no adapter was written**:

* **Package** (manifest + signed artifacts): an Azure Files share registered with the environment
  as storage `acos-audit-control-artifacts` with **`--access-mode ReadOnly`**, mounted at
  `/etc/acos/control-artifacts` (`dir_mode=0555,file_mode=0444`). Files are uploaded byte-for-byte
  from the released package; a changed byte fails verification (and the share is not trusted for
  anything the signatures and pin do not establish).
* **Trust roots and pin**: the two owner root PUBLIC keys and the expected manifest id are the
  existing `ACOS_AUDIT_*` variables, set as literal values in the app's REVISIONED template — the
  accepted S1K/S1L contract, kept in a different trust domain from the mutable share (someone who
  can rewrite the share cannot also substitute the keys that verify it). They are public values;
  private halves never exist anywhere in the runtime (`50 §3a`).
* **Never in the environment**: class-28 JSON, any artifact bytes, the class-28 SendGrid
  verification key (it is inside the signed class-28 file), any private key. The template test
  asserts no env value carries artifact content.
* **Never in the image**: no control-artifact file is baked (inspection rule `BAKED_CONTROL_ARTIFACTS`).
* **Owner decision — RESOLVED (2026-10-05): keep the accepted S1K/S1L mechanism.** The two
  `50 §3a` PUBLIC Ed25519 root values (`ACOS_AUDIT_OWNER_ARTIFACT_ROOT_KEY`,
  `ACOS_AUDIT_OWNER_ARTIFACT_SECOND_FACTOR_KEY`) remain deployment environment inputs under the
  existing verifier contract, in a separate trust domain from the mutable artifact mount. No
  launcher; not in class 28; not in the Azure Files package they authenticate; not SendGrid
  verification-key material. Still prohibited: class-28 JSON from the environment, the class-28
  SendGrid `verification_key` from the environment, and any unsigned environment value standing
  in for signed class-28 authority.

## 6. Audit PostgreSQL — deployment contract and recommendation

**Contract (from the code and migrations).**

* Migrations: `npm run db:migrate:audit` (`src/audit/db/migrate.ts`) applies `A0001`…`A0009` in
  order, recording them in `audit_schema_migration`; run from an OPERATOR workstation with
  `ACOS_AUDIT_PG_URL` = the server ADMIN URL. **Never at ingress startup** (the image contains no
  migration code).
* Roles created (with committed development passwords): `acos_audit_owner` (NOLOGIN),
  `acos_audit_replication`, `acos_audit_evaluator`, `acos_audit_signal_reader`,
  `acos_audit_evidence_ingress`. The migrator grants itself `acos_audit_owner`, sets schema
  privileges, then creates objects as the owner. `A0009` grants the ingress role SELECT+INSERT on
  `provider_evidence_observation`, `provider_evidence_event`, `provider_evidence_inconsistency`
  and the evaluator SELECT on the same.
* **Immediately after migration, rotate every login role's password** (they are public in this
  repository), e.g. in `psql` as the admin: `\password acos_audit_evidence_ingress`, and the same
  (or `ALTER ROLE … NOLOGIN` if unused in this deployment) for `acos_audit_replication`,
  `acos_audit_evaluator`, `acos_audit_signal_reader`. Then verify the development password is
  refused for each.
* Runtime URL (stored only as the Key Vault secret `acos-audit-evidence-ingress-pg-url`; never in
  source, image, Docker history, params file, rendered template or class 28):
  `postgres://acos_audit_evidence_ingress:<rotated password>@<server>.postgres.database.azure.com:5432/acos_audit?sslmode=verify-full`
  — the role's own credential (§4). The Phase C evaluator URL has the same shape with
  `acos_audit_evaluator` and its own rotated password. `sslmode=verify-full` (TLS with chain and
  hostname verification in `pg` 8.16 / `pg-connection-string` 2.14) is now ENFORCED by
  `roleScopedUrl.ts`: any other mode, a duplicate, an `ssl` parameter or a host override refuses
  startup. If the server's chain is not in Node's bundled CA store, add `sslrootcert=<mounted CA
  file>` to the URL (preserved verbatim) — never a weaker mode.
* **Non-superuser migration**: Azure Flexible Server's admin is not a superuser (it has CREATEROLE
  and CREATEDB). The migrations use only role creation, self-grant of a role the migrator
  created, schema grants on a database it owns, PL/pgSQL `SECURITY DEFINER` functions and
  triggers — no extension, `ALTER SYSTEM` or superuser-only statement. The S1P-WD review records a
  local run of all audit migrations as such a non-superuser against a FRESH PostgreSQL 16 cluster;
  the real server is confirmed in Phase A step 2.

**Decision note (this non-production validation only).**

| | A. Azure Database for PostgreSQL Flexible Server | B. Another external PostgreSQL |
|---|---|---|
| Isolation | own server, own admin, own roles; same subscription as the app | different provider/account possible |
| Durability | managed storage, automated backups (7-day default) | provider-dependent |
| TLS | enforced by default; public CA chain; `verify-full` works | provider-dependent; often SNI-routed poolers |
| Minimum cost | Burstable **B1ms** (1 vCore, 2 GiB) ≈ US$12/month compute in US regions + 32 GiB storage + backup — verify in the Azure pricing calculator at provisioning; stoppable | free tiers exist, with idle suspension and connection limits |
| Teardown | delete the server (or the resource group) | vendor-specific |
| Migrations/roles | compatible with the non-superuser model above | unverified: some providers restrict `CREATE ROLE`/`GRANT` to a console/API, which the migrations do not use |

**Recommendation: A**, with the lowest sensible configuration: PostgreSQL 16, Burstable B1ms,
32 GiB storage, no HA, locally-redundant backup with 7-day retention, TLS enforced, public access
restricted by firewall to what the Container Apps environment and the operator workstation need
(a non-VNet Consumption environment has no fixed egress IP — the owner chooses between the
"Allow Azure services" rule and VNet integration; that choice is not made here), database
`acos_audit`. **Not created in this slice.**

`30 §5`'s production requirement — the audit store on a different provider, or a separate account
with separate payment and operator credentials — is NOT met by a database in the same subscription
as the app. This deployment is non-production validation only; the production audit store remains
an open obligation.

## 7. Database credential handling

The database URL is a Container Apps secret `audit-pg-url` declared as a **Key Vault reference**
(`keyVaultUrl` + the app's user-assigned identity) and surfaced to the process only as
`ACOS_AUDIT_PG_URL` via `secretRef`. It is never in the Dockerfile, the image, source, a committed
file, the params file, or class 28. The vault is an **AUDIT-SIDE** vault holding only this secret;
the renderer refuses a vault or identity named for the send side.

The app's user-assigned identity (`id-acos-s1p-webhook`) needs exactly: `AcrPull` on the registry
and `Key Vault Secrets User` on that one secret. Container Apps exposes the identity endpoint to
the container; the ingress contains no Azure SDK and never calls it, and least privilege bounds
what a compromised process could reach to that one secret and image pulls.

## 8. The send-side credential is not here

The integration SendGrid `mail.send` key in the SEND-side vault has no path into this deployment:
the image contains no secret source, no Key Vault or Azure SDK code, no integration runtime and no
locator handling (inspection rules + packaging gate); the template contains no SendGrid, locator,
integration or send-vault reference and exactly the nine ingress variables (template tests); the
renderer refuses a send-named identity or vault.

## 9. Container App definition

`containerapp.template.json` (JSON is valid YAML, so `az containerapp create --yaml` accepts it):
external ingress, `targetPort` 8080, `transport: http`, **`allowInsecure: false`** (port 80
redirects to HTTPS and never reaches the app), no additional ports, no custom domain, no Dapr, one
container, no command override, **TCP** startup/readiness/liveness probes on 8080 (no HTTP route
— the process listens only after it is READY, so "accepts connections" is the readiness
signal), `minReplicas 1`, `maxReplicas 2`, 0.25 vCPU / 0.5 GiB, one read-only Azure Files volume.

`npm run deploy:render-ingress -- <params.json> <out.json>` substitutes non-secret parameters,
refuses on any problem (tag not a 40-hex commit SHA, `latest`, unfilled placeholder, identical
root keys, send-named identity/vault, versioned secret URI, extra port/secret value/variable/
container/command), writes the rendered definition, and PRINTS the `az` commands and the binding
probes. It imports no process, network or Azure API.

## 10. Image registry and the LOCKED commit-SHA tag

Not created. The image reference is `<registry>.azurecr.io/acos-s1p-provider-evidence:<git-commit-sha>`.
A 40-hex tag is only a NAME — Azure Container Registry lets a tag be overwritten or deleted — so
it becomes immutable only once LOCKED. The printed Phase A script (`operatorSteps`, checked by
`operatorSequenceProblems`, which the renderer runs on its own output) is, in order:

1. `set -euo pipefail`;
2. refuse unless `git rev-parse HEAD` equals the tag and the tree is clean;
3. `az acr login --name <registry>`;
4. `docker build --platform linux/amd64 … -t <registry>.azurecr.io/acos-s1p-provider-evidence:<sha> .`;
5. `docker push …:<sha>`;
6. record the manifest digest: `az acr repository show --name <registry> --image acos-s1p-provider-evidence:<sha> --query digest --output tsv` (provenance, not a substitute for the lock);
7. **lock**: `az acr repository update --name <registry> --image acos-s1p-provider-evidence:<sha> --write-enabled false --delete-enabled false`;
8. **verify, or stop**: read `[changeableAttributes.writeEnabled, changeableAttributes.deleteEnabled]` back and `exit 1` unless both are `false`;
9. only then register the read-only share and `az containerapp create … --yaml`.

The tag may be called immutable only after step 8 passes. `latest` and floating tags are refused
by the renderer, the ordering rule and the tests. Azure Container Registry (Basic SKU) is the
natural registry, pulled by the app's user-assigned identity with `AcrPull`.

## 11. Container Apps ingress assumptions, and the verification that replaces them

Documented by Microsoft (Ingress in Azure Container Apps): TLS 1.2/1.3 terminated at the ingress;
port 80 redirected to 443 by default (made explicit with `allowInsecure: false`); HTTP/1.1 and
HTTP/2 front ends; `X-Forwarded-Proto` / `X-Forwarded-For` added; 240-second request timeout.

**NOT documented: that the original `Host` reaches the container unchanged.** The platform is
Envoy-based and routes by host, which suggests it is preserved, but that is an inference. The
receiver reads ONLY `Host` (exactly one, no port, lower-cased) and the origin-form path, never a
forwarded header, and that check is not weakened. So the binding is VERIFIED in Phase A step 10
before any provider delivers:

| Probe (unsigned) | Pass |
|---|---|
| POST exact URL | **401** — proves the app saw `Host` = reserved FQDN and the exact path; a 404 here is the **AZURE CONTAINER APPS INGRESS BINDING BLOCKER** |
| GET exact URL | 405 |
| POST with `?probe=1` / trailing `/` / `/health` | 404 |
| POST with another `Host` | 404 or 421 |
| POST to `http://` (port 80) | 301/302/307/308/400/403/404 — never 401 |

No probe is signed, so none can be persisted. **Local evidence (not Azure):** the built image behind
an Envoy 1.31 TLS front end routing only the reserved FQDN passed every probe over HTTP/2 and
HTTP/1.1 (Envoy converts HTTP/2 `:authority` to the HTTP/1.1 `Host` the receiver reads), refused
TLS 1.1, redirected plaintext with 301, refused a literal `Host: …:443` at the front end, and
stored a signed HTTP/2 delivery (204, one COMPLETE observation) — see the S1P-WD review. The receiver does not require `Content-Length`, so
re-chunking by the proxy is harmless (tested). `tests/deploy/container-app.test.ts` runs this exact
plan through a local ACA-like front end (Host preserved: all pass; Host rewritten: the exact probe
returns 404 and the evaluator names the blocker) and proves a signed delivery survives the
front end.

## 12. Operator procedure (exact order)

**The runtime cannot become READY until a verified class-28 `SIGNED_PROVIDER_PUSH` record for
`twilio_sendgrid` exists** (`ingressMain.ts` refuses `CHANNEL_NOT_DECLARED` /
`CHANNEL_NOT_SIGNED_PROVIDER_PUSH` and never listens). That record needs the provider's public
key, which exists only after the webhook is created with signing enabled. So the brief's
"verify READY" and "verify binding" (A9–A10) cannot be satisfied with real artifacts before
Phase B; they move after the release, with the webhook kept DISABLED until the binding passes.

PHASE A — infrastructure, NO SendGrid webhook
1. Provision the audit PostgreSQL (§6); create database `acos_audit`.
2. From the operator workstation: `npm run db:migrate:audit` with the ADMIN URL; rotate every
   audit login role password (§6); confirm the development passwords are refused.
3. Provision the registry (ACR); create `id-acos-s1p-webhook` with `AcrPull`.
4. Run the printed script's build, push, digest-record, **lock** and **lock-verification** steps
   (§10) — it stops unless `writeEnabled == false` and `deleteEnabled == false`; then export the
   pushed image and run `npm run deploy:ingress-image -- inspect` against it (must PASS, including
   zero database password literals).
5. Create the AUDIT-side Key Vault secret holding the ingress-role URL (§6–7); grant the identity
   `Key Vault Secrets User` on it.
6. Create the Azure Files share; register it with the environment `--access-mode ReadOnly`
   (printed command); upload the currently released control-artifact package byte-for-byte.
7. Render with `npm run deploy:render-ingress`; review the output.
8. Create the app (`az containerapp create --yaml …`) — only after step 4's lock is verified. Expected: **NOT READY** —
   `INGRESS_NOT_READY` with `CHANNEL_NOT_DECLARED` if the released package verifies (proving the
   mount, roots and pin), or `AUDIT_CONTROL_ARTIFACTS_NOT_VERIFIED` if no released package exists
   yet. Either is correct at this point; nothing listens.
9. *(Optional rehearsal, owner decision)* to de-risk the Host binding before the ceremony: a
   temporary revision with a TEST-ONLY package (test roots, a push record at the reserved identity
   with a test key) and `ACOS_AUDIT_PG_URL` pointing at an EMPTY scratch database with no grants,
   so nothing signed with the public test key can persist; run step B10's probes; then delete the
   revision and the scratch database. Never with the real audit database.

PHASE B — provider trust material
10. Create the SendGrid Event Webhook at the EXACT reserved URL, **disabled for delivery**.
11. Enable the signed webhook (signature verification).
12. Capture the exact `public_key` string.
13. Confirm it parses as a P-256 SPKI under the accepted profile (the class-28 parser refuses
    anything else).
14. Derive `key_identity` = lowercase hex SHA-256 over the DER SPKI.
15. Build the real class-28 candidate (the push record at the reserved identity).
16. Build the real class-5 candidate with the integration credential's versioned Key Vault
    secret identity as `credential_id`.
17. Owner + second-factor release of the package (offline ceremony).
18. Move the deployment pin only through the accepted release process; upload the released bytes
    to the share; update `ACOS_AUDIT_EXPECTED_ACTIVE_MANIFEST_ID` (new revision).
19. Confirm **READY** (`INGRESS_READY` with the expected `keyIdentity` in the logs).
20. Run the binding probes (§11) against the real FQDN. Any failure: stop; a 404 on the exact URL
    is the AZURE CONTAINER APPS INGRESS BINDING BLOCKER, reported to the owner, not worked around.

PHASE C — provider evidence validation
21. Enable webhook delivery; perform a safe signed connectivity/test event.
22. Resolve and record the Test-Integration classification without guessing.
23. Only then: bounded live validation / the six scenarios (S1P harness, push mode).

## 13. Security regression tests

`tests/deploy/ingress-image.test.ts` — the image contents equal the packaging-gate closure; no
integration/provider-read/credential/validation/test module; packages are `pg`'s required locked
tree (no Azure, Cedar, optional or dev package); a staged image inspects clean and the inspection
FAILS on tests, test doubles, validation, Azure SDK, `.env`, baked control artifacts, `.git`,
private-key PEM, `TEST_ONLY`, SendGrid key shape, secret-source and locator content, extra or
missing files; the Dockerfile has two stages, copies only `/stage`, runs only the ingress entry
point, non-root, one exposed port, no secret-bearing `ENV`/`ARG`, no `latest`, never copies
tests/validation/artifacts/docs and never bakes control artifacts; `.dockerignore` is the exact
allowlist with secret re-exclusions.

`tests/deploy/container-app.test.ts` — the template's environment equals the variables the code
reads; one external target port; `allowInsecure: false`; no health/second route; no SendGrid,
locator, integration, send-vault or control-plane value; database URL is a Key Vault secret
reference; control artifacts are a read-only mount and never env content; immutable image
placeholder, one container, no command override, bounded scale; renderer refusals; the deploy
tools import no process/network/Azure API; the reserved identity is configuration only; the
binding probes through an ACA-like front end (pass when Host is preserved, catch a rewrite);
signed delivery through the front end; the role-specific URL is used verbatim and persists.

Added by the correction pass: the closure excludes `auditPool.ts` and includes
`evidenceIngressPool.ts`; every committed DB password is derived and absent from every closure
module; inspection fails on a password literal in any app file or in the raw image export, on
`auditPool.js` in the image or imported, and on credential-derivation code; the ingress module uses
the ingress role URL verbatim and refuses owner/evaluator/replication/look-alike/missing/malformed
URLs; startup refuses an owner URL; the evaluator accepts its own URL verbatim; local derivation
still works; both base-image ARG defaults are digest-pinned and tag-only/`latest`/truncated/bypassing
defaults are refused; the operator sequence builds → pushes → locks → verifies before any
deployment reference, and an ordering rule refuses a sequence missing the lock, missing the
verification, deploying before verification, locking before pushing, not exiting on a failed
verification, leaving delete enabled, lacking `set -euo pipefail`, or using `latest`.

Added by the final correction pass: both base images are the Node 24 / Debian 13 family and a
digest-pinned Node 20 (or Debian 12, bookworm, or floating `node:24`) default is refused; for BOTH
the ingress and the evaluator role, one `sslmode=verify-full` is accepted verbatim (with
`sslrootcert` preserved) and missing / `disable` / `allow` / `prefer` / `require` / `verify-ca` /
`no-verify` / upper-cased / duplicate / case-variant / `ssl=false` / `ssl=true` / host-override /
empty-host / empty-database / missing-or-empty-password URLs are refused with named reasons; the
ingress refuses evaluator/owner/other roles even with verify-full; the evaluator refuses owner and
other roles and throws on weak TLS; no `PGSSL*` fallback; the ingress starts on a verify-full URL
and refuses weaker TLS before listening.

## 14. Open provisioning obligations

Audit PostgreSQL; migrations + password rotation on it; registry; app identity; audit-side Key
Vault secret; Azure Files share; Container App; READY; public Host/path/TLS binding verification;
SendGrid webhook creation (disabled), signing, `public_key` capture and P-256 confirmation; real
class-28 and class-5 candidates and their release; pin move; signed connectivity event;
Test-Integration classification; the six live I36 scenarios; delivery-completeness
characterisation; live I20; live I8; I17b. Production audit store separation (`30 §5`) remains
open. (The evaluator-URL debt recorded by the first candidate is closed: §4.)
