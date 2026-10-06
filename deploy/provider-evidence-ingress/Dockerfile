# syntax=docker/dockerfile:1.7
#
# S1P-WD — THE PROVIDER-EVIDENCE INGRESS IMAGE (`48 §8` row I1). IT RUNS THE INGRESS AND NOTHING ELSE.
#
# Build from the REPOSITORY ROOT, for the Container Apps platform, tagged with the git commit:
#
#   docker build --platform linux/amd64 -f deploy/provider-evidence-ingress/Dockerfile \
#     -t <registry>/acos-s1p-provider-evidence:<git-commit-sha> .
#
# * BUILD stage: installs the repository's locked dependencies, compiles ONLY the ingress entry
#   point's import closure to JavaScript, and stages exactly that closure plus the locked `pg`
#   dependency tree (`tools/deploy/ingressImage.ts`). Nothing else leaves this stage.
# * RUNTIME stage: distroless Node.js 24 LTS on Debian 13 — no shell, no package manager, no `tsx`, no
#   TypeScript — running as the non-root `nonroot` user, with the staged files owned by root
#   and therefore read-only to the process.
#
# NOT IN THIS IMAGE, BY CONSTRUCTION: any SendGrid credential, the send-side Key Vault, any
# managed-identity or Azure SDK code, any secret locator, the integration runtime, the
# provider-read runtime, `tests/`, `validation/`, fixtures, test keys, the control-artifact
# package (mounted read-only at deploy time), and the database URL (a platform secret).
#
# BOTH BASE IMAGES ARE NODE 24 LTS ("Krypton") AND PINNED BY DIGEST. Node 20 is end-of-life and is
# not used for a public webhook. A tag is mutable, so each default names the reviewed manifest
# digest (resolved 2026-10-05: Node v24.21.0, Debian 13 "trixie"); `baseImagePinProblems`
# (`tools/deploy/ingressImage.ts`, enforced by `tests/deploy/ingress-image.test.ts`) refuses a
# default that is not `name@sha256:<64 hex>` OR not the selected Node 24 / Debian 13 family. A
# Node-major or base change is an ordinary reviewed change to these two lines and that rule.

ARG BUILD_IMAGE=node:24.21.0-trixie-slim@sha256:8ec5d7557396cfe32d21c3f9c13072355ceab22b584578ca4bb28af31120cffe
ARG RUNTIME_IMAGE=gcr.io/distroless/nodejs24-debian13:nonroot@sha256:9eeb7f5887d0e239e78264b06f7f11d2e14be534050481803a9e4728fcdd278e

FROM ${BUILD_IMAGE} AS build
WORKDIR /build
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY src/ ./src/
COPY tools/integration-packaging/ ./tools/integration-packaging/
COPY tools/deploy/ ./tools/deploy/
COPY deploy/provider-evidence-ingress/tsconfig.build.json ./deploy/provider-evidence-ingress/
RUN npx tsc -p deploy/provider-evidence-ingress/tsconfig.build.json \
 && npx tsx tools/deploy/ingressImageCli.ts stage build/provider-evidence-ingress /stage

FROM ${RUNTIME_IMAGE} AS runtime
WORKDIR /app
COPY --from=build --chown=0:0 /stage/ /app/
USER 65532:65532
ENV NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["/nodejs/bin/node", "/app/src/audit/providerEvidence/ingressMain.js"]
