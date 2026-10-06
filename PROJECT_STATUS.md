---
project: ACOS
category: software
status: active
stage: deployment
phase: S1P-WD accepted and committed locally; push to origin pending, then Phase A provisioning
next_actor: Andrew
next_action: Push feature/s1o-provider-selection-audit-boundary to origin (git push, no force)
waiting_on: clean push of the S1P-WD commit; then owner-executed Phase A provisioning starting with audit PostgreSQL
priority: high
last_updated: 2026-10-05
---

# ACOS — Project Status

## Goal

Build the ACOS control plane as a **non-production architectural MVP** against the ACOS
Operating Spine architecture package, one reviewed increment at a time. No real money, no real
customers, no production credentials, and no adapter under `src/` that reaches a real vendor —
properties enforced by the test suite, not by convention.

Current authoritative architecture input: `docs/architecture/v1.3.8/` (immutable).

## Current State

Branch `feature/s1o-provider-selection-audit-boundary` @ the S1P-WD commit "S1P-WD package signed
provider push deployment" (local only; origin is at `fd0f658`). The first S1P-WD commit (`1f6c1ca`)
was refused by GitHub push protection on a synthetic SendGrid-shaped test fixture and was amended
before it ever reached origin.

Increments S1A through S1O are accepted. S1P (Twilio SendGrid non-production provider
validation) is **not complete**: repository-side machinery exists and offline verification is
green, but no SendGrid webhook, provider request or live run exists. `I36`'s verification leg,
`I20`'s provider side and `I8`'s empirical leg remain open.

S1P-W (architecture v1.3.8) and S1P-WR (signed-push runtime) are reviewed and committed. **S1P-WD
(deployment packaging) is independently ACCEPTED and committed locally.** Classification:
**S1P-WD DEPLOYMENT PACKAGING COMPLETE — AZURE APP/DB NOT PROVISIONED.** Nothing deployed; no
Azure or SendGrid call made.

## Recently Completed

- **Push-protection fix** (2026-10-05, folded into the unpushed S1P-WD commit): the
  `SENDGRID_API_KEY_SHAPE` negative control in `tests/deploy/ingress-image.test.ts` now assembles its
  fixture from fragments at runtime (still matches the detector; test passes); the generated
  `S1P-webhook-deployment-review.md`/`.diff` were untracked (kept locally) and added to `.gitignore`.
  No tracked file at HEAD matches GitHub's SendGrid key pattern. Deploy tests 142/142, typecheck, lint green.
- **S1P-WD final correction pass** (ACCEPTED, 2026-10-05):
  1. **Node 24 LTS** (Node 20 is EOL) — Dockerfile pins `node:24.21.0-trixie-slim@sha256:8ec5d755…`
     (build) and `gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f58…` (runtime); built
     image runs Node v24.21.0 (OpenSSL 3.5.8, uid 65532, Debian 13.7); provider-evidence/deploy/
     push-mode tests pass under Node 24 (357/357). `baseImagePinProblems` now also enforces the Node
     24 / Debian 13 family — a digest-pinned Node 20 fails.
  2. **DB TLS fails closed** — new shared `src/audit/db/roleScopedUrl.ts`: a role-specific deployment
     URL needs exact role, host, database, password and EXACTLY ONE `sslmode=verify-full` (no `ssl`,
     no host override), used verbatim; ingress refuses startup otherwise
     (`AUDIT_STORE_CREDENTIAL_INVALID` + named detail); evaluator role URL held to the same rule
     (throws). Proven end to end against a TLS PostgreSQL (TLSv1.3; hostname mismatch / unknown CA → 503).
  Final gate: full suite **214 files / 3,360 tests, 0 failed, 0 skipped**; perimeter and packaging PASS;
  v1.3.8 127/0 (116/116); v1.3.7 108/0 (77/77).
- **S1P-WD correction pass** (accepted) — no DB password in the image; evaluator role URL; ACR
  commit-SHA tag lock + verification; digest-pinned bases; clean suite; root-key ruling RESOLVED.
- **S1P-WD first candidate** (approach accepted) — distroless single-purpose ingress image, derived
  contents, non-executing Container App template + renderer, binding probes, DB contract, Phase A/B/C.
- **S1P-WR** (`fd0f658`) and **S1P-W v1.3.8** (`01fe4f7`) — committed earlier.

## Current Work

Nothing running. S1P-WD commit awaiting `git push` (no force needed: the amended commit never reached origin).

## Awaiting Review

Nothing. S1P-WD accepted.

## Blockers

1. Push of the S1P-WD commit to origin.
2. Owner-only provisioning, in `docs/implementation/S1P-WD-deployment.md §12` order: Phase A (audit
   PostgreSQL with TLS + migrations + role-password rotation, ACR, app identity, build (Node 24
   pinned bases)/push/**lock/verify** the SHA tag, audit-side Key Vault secret holding the ingress
   URL with `sslmode=verify-full`, read-only share, Container App), Phase B (SendGrid
   webhook disabled, signing, `public_key`, P-256 check, class-28/class-5 release, pin move,
   READY, real-platform binding probes), Phase C (connectivity event, Test-Integration
   classification, live validation).
3. Production audit-store separation (`30 §5`) remains open.

## Next Action

Andrew runs `git push` (plain, no force). Once origin holds the S1P-WD commit, Phase A provisioning
resumes, owner-executed, beginning with audit PostgreSQL.

## Important Artifacts

- `S1P-webhook-deployment-review.md` + `.diff` — accepted S1P-WD review package (local only, gitignored).
- `docs/implementation/S1P-WD-deployment.md` — deployment record: env contract (§3), DB credentials
  (§4), control-artifact delivery and resolved root-key ruling (§5), DB contract (§6), ACR lock
  sequence (§10), probes (§11), operator procedure (§12).
- `deploy/provider-evidence-ingress/` — Dockerfile (digest-pinned), build tsconfig, Container App
  template, example params.
- `tools/deploy/` — image plan/stage/inspect and the print-only renderer + operator sequence.
- `src/audit/providerEvidence/evidenceIngressPool.ts` — the image-safe ingress DB module.
- `S1P-webhook-runtime-review.md` + `.diff` — accepted S1P-WR package.
- `docs/architecture/v1.3.8/` — authoritative, immutable architecture input.

## Recent Decisions

- **Node 24 LTS for the deployment runtime (owner, 2026-10-05)**; Node 20 is EOL. Repository-wide
  `engines` (`>=20.11.0`) unchanged.
- **Database TLS fails closed**: a role-specific deployment URL must carry exactly one
  `sslmode=verify-full`; weaker or conflicting TLS refuses, never repaired; no `PGSSL*` fallback;
  local development derivation unaffected.
- **Root public keys (owner, 2026-10-05): RESOLVED — keep the S1K/S1L env contract**; no launcher;
  never class-28 JSON or the SendGrid verification key from the environment.
- **The deployed ingress holds only `acos_audit_evidence_ingress`; live validation only
  `acos_audit_evaluator`; neither ever receives the audit owner URL.**
- **The commit-SHA tag is immutable only after the ACR lock is verified** (owner ruling); `latest`
  and floating tags are refused.
- **The ingress cannot be READY before Phase B** (it needs the released class-28 push record), so
  READY and the binding probes follow the release, with webhook delivery disabled until they pass.
- **A 404 on the exact unsigned probe is the AZURE CONTAINER APPS INGRESS BINDING BLOCKER** —
  reported, not worked around.
- **Full-suite runs happen with Docker Desktop stopped**; the one earlier timeout was CPU contention
  from the Docker VM, not a test defect.
- `README.md` is stale (S1A only); `docs/implementation/` and this file are the current record.
