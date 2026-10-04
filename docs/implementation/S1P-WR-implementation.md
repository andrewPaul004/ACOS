# S1P-WR — Signed provider push runtime

**Runtime implementation of the ACCEPTED Operating Spine v1.3.8 `SIGNED_PROVIDER_PUSH` evidence mode
(ADR-027, `48 §8`, `50 §2h`). `docs/architecture/v1.3.8/` is not modified by this slice.**

**Status: S1P-WR RUNTIME IMPLEMENTATION COMPLETE — LIVE PROVISIONING NOT STARTED.**
No SendGrid API call, no Azure call, no email, no real webhook, no production artifact or signature,
no pin move.

---

## 1. Runtime map

| Concern | Location |
|---|---|
| Class 28, audit plane (consumer, closed union, key, `key_identity`, ingress grammar) | `src/audit/providerEvidence/class28.ts` |
| Class 28, control plane (independent second parse; mode authority for the harness) | `src/kernel/controlArtifacts/providerEvidenceTrust.ts`, `bundle.ts` (`verifiedProviderEvidenceTrust`) |
| Required-set / audit verifier / release inventory membership | `requiredSet.ts`, `verifier.ts`, `src/audit/controlArtifacts/auditPlaneVerifier.ts`, `tools/control-release/inventory.ts`, `verifyRelease.ts` |
| `SENDGRID_EVENT_WEBHOOK_V1` (strict Base64, strict DER, SPKI P-256, P1–P10) | `src/audit/providerEvidence/sendgridEventWebhookV1.ts` |
| `ingress_identity` grammar, launch echo, per-request target | `src/audit/providerEvidence/ingressIdentity.ts` |
| Post-verification normalisation (COMPLETE / INCOMPLETE) | `src/audit/providerEvidence/eventPayload.ts` |
| Durable store, `sg_event_id` dedup, inconsistency handling | `src/audit/providerEvidence/evidenceStore.ts`, `src/audit/db/migrations/A0009__provider_evidence.sql` |
| Observation API (`I36`, `I20`, `I8`) | `src/audit/providerEvidence/evidenceReader.ts` |
| Request pipeline | `src/audit/providerEvidence/receiver.ts` |
| Independently runnable entrypoint (`npm run ingress:provider-evidence`) | `src/audit/providerEvidence/ingressMain.ts` |
| Ingress role | `acos_audit_evidence_ingress` (`A0009`), `createAuditEvidenceIngressPool` |
| Perimeter `PERIMETER_INGRESS(channel, trust_class)` | `tools/perimeter/perimeterScan.ts` |
| Receiver dependency closure | `tools/integration-packaging/packagingManifest.ts` (`AUDIT_PROVIDER_EVIDENCE_INGRESS`) |
| S1P harness | `validation/sendgrid/harness/pushEvidence.ts`, `scenarioDriver.ts`, `liveComposition.ts` |
| S1P CLI, mode-discriminated (correction pass) | `validation/sendgrid/harness/cli.ts`, `preflight.ts`, `deploymentConfig.ts`, `evidence.ts`, `capabilityProbes.ts` (`SIGNED_PUSH_OPEN_EMPIRICAL_OBLIGATIONS`) |

## 2. Implementation decisions (implementation-level, never authority)

* **Class-28 artifact encoding:** UTF-8 JSON `{artifact_id, artifact_version, channels[]}`, one record
  per provider, strictly ascending `provider`, exactly one mode per provider, no two push channels on
  one ingress. The repository's deployed `artifacts/control/class-28.provider-evidence-trust.json`
  carries ONE synthetic `PROVIDER_READ` channel (`synthetic_esp`) and NO push channel.
* **Raw-body limit:** 1 MiB (`MAX_PROVIDER_EVIDENCE_BODY_BYTES`). v1.3.8 G4 declares no figure; this is
  an availability limit only, 4× the repository's 256 KiB IPC bound, enforced by declared length and
  while streaming. It can only refuse.
* **Uncompressed P-256 point only** in the SPKI; a fail-closed restriction consistent with the
  provider's published fixture key. It can only refuse.
* **Timestamp digits:** at most 32 ASCII digits. No freshness window.
* **Content type:** exactly one `Content-Type`, `application/json`, optionally `charset=utf-8`.
* **Response codes:** 404 target, 405 method, 415 content type, 413 size, 400 unreadable body,
  401 unauthenticated, 503 store failure, 204 after commit (COMPLETE or INCOMPLETE). Empty bodies.
* **Incompleteness scope:** an INCOMPLETE observation taints every correlation queried over a receipt
  interval containing it; an `sg_event_id` inconsistency taints both correlations it names.
* **Incomplete batches persist no event rows** (only the observation receipt); readable siblings never
  count. Enforced by a store trigger as well as by the path.
* **No health route** on the public listener (G1: one route). Readiness is the startup result.
* **Correlation reads are interval-bounded.** `observeCorrelation` counts only events whose ACOS
  `received_at` lies in `[receivedFrom, receivedTo]` (both endpoints inclusive). An `sg_event_id`
  identity inconsistency is deliberately NOT interval-bounded: it taints the correlation for its
  lifetime, because narrowing it could only turn an untrusted reading into a trusted one.
* **`I20` numerator vs lower bound.** `i20ProviderOperand` reports `observedDistinctAcceptedMessages`
  (a lower bound, always) and `exactAcceptedMessageNumerator` (null unless a
  `PushCompletenessBasis` establishes completeness). The basis union has ONE member today,
  `UNESTABLISHED`; a future empirical characterisation would be a new, separately reviewed member.
  The harness's `compareI20` carries `observedDistinctAcceptedMessagesLowerBound`, which may prove
  `EXCEEDS_BASIS` and nothing else.
* **`I20` is a UNION of message identities on both sides.** Each harness `I20ScenarioOperand`
  carries `observedProviderMessageIds`, copied from `ObservationResult.providerMessageIds`; an
  exact `providerAcceptedCount` is structurally paired with the id set it counts and checked
  against it (a disagreement, or a count with no set, makes the comparison UNRESOLVED and is
  listed in `inconsistentScenarios`). Both the exact numerator and the observed lower bound are
  the size of the GLOBAL UNION of identities across the scenario set — never a sum of
  per-scenario counts — which is the audit store's `i20ProviderOperand` definition. Point 6
  contributes the empty set; a scenario that never observed contributes `null` (no lower bound).
* **Cross-plane class-28 agreement is exact-artifact identity.** `planesAgreeOnClass28`
  (`liveComposition.ts`) — the single rule used by the stage-1 preflight
  (`auditPlaneAgreesOnPushChannel`) and by `openLiveComposition` — requires the control bundle's
  class-28 content hash (`verifiedProviderEvidenceTrustContentHash`, the `50 §3c` hash recomputed
  against the manifest during verification) to EQUAL the audit plane's own
  `providerEvidenceTrustDigest`. Mode and `key_identity` remain as defence in depth only.
* **Point 6.** `redispatchOccurred` is `true` on a new distinct provider message id (positive
  evidence, any bound), `false` only when both observations settle absence (fixture, or a completed
  measured interval with a trustworthy count), and `null` otherwise. Point 6 FAILS on any `true`,
  PASSES only when every re-entry row is `false`, and is otherwise UNRESOLVED. This is a uniform
  visibility-bound rule: it applies to `PROVIDER_READ` under the live `UNESTABLISHED` bound too. A
  local adapter-call counter has no input to it.

## 2a. The CLI is mode-discriminated (correction pass)

The mode is read in stage 1 from the VERIFIED class-28 record (`verifiedEvidenceModeFor`) and from
nothing else. An undeclared mode is `PROVIDER_EVIDENCE_MODE_UNDECLARED` AND every read gate.

| Item | `PROVIDER_READ` | `SIGNED_PROVIDER_PUSH` |
|---|---|---|
| Integration credential id, class-5 record, risk class, KV identity binding, source principal | required | required |
| Audit credential id (`deploymentConfig.auditCredentialId: string \| null`) | required | must be ABSENT (refused if supplied) |
| Audit locator (`ACOS_S1P_AUDIT_LOCATOR`) | required (stage-2 identity) | must be ABSENT (refused if supplied) |
| Audit class-5 READ_ONLY record | required | not looked up |
| Email Activity entitlement | required | not applicable |
| Audit evidence store (`ACOS_AUDIT_PG_URL`) | — | required |
| Audit plane's own class-28 agreement: equal exact-byte class-28 content hash (control `verifiedProviderEvidenceTrustContentHash` = audit `providerEvidenceTrustDigest`), plus mode/key as defence in depth | — | required |
| Stage-2 processes | integration + audit identity | integration identity only |
| Capability probes | audit read, audit send-refusal, integration read-refusal | none (see obligations) |
| Composition `auditLocator` / `runtime.auditReader` | locator / reader config | `null` / `null`; `launchAuditReader` refuses |
| `I36` oracle, duplicate control | `observeCorrelation` over the audit reader | `observePushCorrelation` over the audit store |
| `I8` | provider-read inverse sweep | `runPushInverseObservation`; never `ALL_PROVIDER_RECORDS_ACCOUNTED` |
| Evidence bundle | `schema …v2`, `packageIssue v1.3.8`, `providerEvidence.mode PROVIDER_READ` | same schema; every audit-read item `NOT_APPLICABLE`; `auditIdentityMatchedSignedRecord: null` |

The CLI also refuses before any row runs if the opened composition's evidence port disagrees with
the verified mode, so the scenario driver's oracle is never chosen by a port's presence alone.

## 3. Boundary tests changed, and why

Earlier slices asserted, over all of `src/`, the ABSENCE of things nothing then needed: a vendor
name, an inbound transport, a provider accepted count, a delivery webhook, a provider-evidence table.
v1.3.8 is the accepted architecture that introduces exactly one of each, in the audit plane. Every
affected test was narrowed TOKEN- and FILE-exactly; none was widened generally, and every pattern
still applies to every file. `tests/support/providerEvidenceSurface.ts` is the single definition of
the permitted surface (closed file list × closed token list).

| Test | What changed |
|---|---|
| `tests/integration/audit/plane-independence.test.ts` | `node:http` admitted only in `ingressMain.ts` as an inbound named import with the ingress declaration; `https://` only as the grammar prefix in `ingressIdentity.ts`. `fetch(`/`axios` still forbidden everywhere |
| `tests/integration/perimeter/source-boundary.test.ts` | vendor scan admits only the profile identifier/module name, the two header literals, the grammar prefix and the inbound import in their files; `ingressMain.ts` joins the exact `process.env` reader list |
| `tests/integration/perimeter/perimeter-enumeration.test.ts` | admits `INGRESS`-annotated listener/inbound-import sites; asserts zero ingress violations |
| `tests/controlArtifacts/boundaries.test.ts`, `tests/integration/mirror/no-dispatch-boundary.test.ts` | the ingress's exact inbound import line removed from its own file before the transport scan |
| `tests/sendgrid/prerequisites-and-separation.test.ts`, `tests/integration/gateway/no-real-transport-boundary.test.ts`, `tests/integration/authority/local-transaction-atomicity.test.ts`, `tests/integration/outbox/no-transport-boundary.test.ts` | the declared surface removed via `providerEvidenceSurface.ts` before the vendor/transport/accepted-count scans |
| `tests/negative-controls/vc-a1d-adversarial-attester.test.ts`, `tests/integration/gateway/dispatch-outcome-journal-rows.test.ts`, `tests/integration/gateway/mock-kill-matrix.test.ts` | the three `A0009` tables are named exactly, and asserted EMPTY in those suites — no push channel, no evidence, `I8`/`I17f`/`I20` still OPEN |
| `tests/controlArtifacts/class-authority.test.ts`, `credential-risk.test.ts`, `tests/release/ceremony.test.ts` | the pre-live set's class list/count now includes class 28 |

## 4. Open obligations

* **PROVIDER PERMISSION DRIFT — OPEN EMPIRICAL OBLIGATION.** Under push no capability probe runs: the
  integration-key Email Activity read would be confounded by the absent entitlement and would touch
  `/v3/messages`. Whether the integration key's provider-side permissions have drifted beyond
  `mail.send` is not observed. Not discharged by buying the entitlement, by a management credential,
  or by any call in this slice.
* **LIVE SENDGRID TEST-INTEGRATION CLASSIFICATION — OPEN PROVISIONING OBLIGATION.** v1.3.8 supplies no
  field that distinguishes a signed SendGrid "Test Integration" event from a real one. Nothing is
  guessed: the oracle counts only events carrying a kernel-minted correlation of an actual scenario,
  and a correlation-less signed event makes its observation INCOMPLETE.
* Provisioning: the real integration credential; the real class-5 record; public ingress hosting and
  TLS front end; SendGrid webhook creation; capture of the exact `public_key` string and P-256
  confirmation; the real class-28 candidate; owner + second-factor release; a signed provider test;
  the live six-scenario `I36` run; completeness characterisation; `I20`; `I8`; `I17b`.
