import { verifyAuditPlaneControlArtifacts } from '../../src/audit/controlArtifacts/auditPlaneVerifier.js';
import { filesystemArtifactPackage } from '../../src/kernel/controlArtifacts/artifactPackage.js';
import {
  bundleArtifactIdentities,
  bundleManifestEpoch,
  bundleManifestId,
  verifiedDegradedModeConfiguration,
  verifiedJcs1Specification,
} from '../../src/kernel/controlArtifacts/bundle.js';
import {
  AUDIT_TRUST_CONFIG_KEYS,
  CONTROL_TRUST_CONFIG_KEYS,
  readDeploymentTrustConfiguration,
} from '../../src/kernel/controlArtifacts/trustConfig.js';
import {
  bootstrapControlArtifactAuthority,
  kernelAuthorityReady,
} from '../../src/kernel/controlArtifacts/registry.js';
import { verifyControlArtifactBundle } from '../../src/kernel/controlArtifacts/verifier.js';
import { loadPolicyArtifacts } from '../../src/kernel/policy/policyArtifacts.js';

/**
 * `acos prelive verify` — THE LOCAL, READ-ONLY PRE-LIVE READINESS CHECK (`§39`, `§40`).
 *
 * =================================================================================
 * WHAT IT MAY CONCLUDE, AND THE TWO THINGS IT MAY NEVER SAY
 *
 * `§40`: the local pre-live release gate may report
 * `READY_FOR_PROVIDER_SANDBOX_CONFIGURATION` only if every local control-artifact
 * prerequisite passes, and it may NOT report either of the two broader launch claims that
 * section forbids, because many later obligations remain.
 *
 * The status union below has exactly two members and neither of the forbidden claims is one
 * of them. `tests/release/prelive-gate.test.ts` holds the forbidden strings and asserts they
 * appear nowhere in this module's source, its status union or its rendered report — which is
 * why they are described here rather than written out.
 *
 * `§39`: "It must NOT: make network/vendor calls; infer provider readiness; test
 * credentials; mark I36/I20/I8 closed." There is no HTTP client, no socket, no credential
 * and no provider name in this directory.
 *
 * =================================================================================
 * IT VERIFIES EACH PLANE SEPARATELY, THROUGH THAT PLANE'S OWN TRUST BOUNDARY
 *
 * `§23`: "Do not make the audit runtime fetch `controlPlane.getVerifiedKeys()`." `§27`:
 * "**Do not let 'control verified R2' serve as evidence 'audit verified R2.'**"
 *
 * The two checks below read DIFFERENT environment variables and run DIFFERENT verifier
 * implementations: the control plane's `verifyControlArtifactBundle`, and the audit plane's
 * separately authored `verifyAuditPlaneControlArtifacts`. Neither is handed the other's
 * result, its configuration or its bundle. This function then COMPARES two independently
 * obtained manifest identities, which is orchestration evidence about two verifications that
 * already happened — not a substitute for either.
 *
 * =================================================================================
 * WHY MANIFEST EQUALITY IS REPORTED AS A FINDING RATHER THAN INVENTED AS A PROTOCOL
 *
 * `§26` warns against inventing a distributed deployment protocol, and none is invented.
 * v1.3.6 declares two CROSS-PLANE OBLIGATIONS in terms of CONTENT:
 *
 *   * `50 §2b`: "The control plane and the audit plane each hold a BYTE-IDENTICAL COPY of
 *     this artifact" — the class-20 specification;
 *   * `50 §2c`, `50 §2f`: `corroboration_signal_max_age`'s audit-plane copy, where
 *     "**equality across the two planes is a cross-plane obligation**".
 *
 * Both are checked here, from each plane's own verified bytes. And `50 §3` property 2 —
 * "the AUDIT PLANE recomputes every hash from its own copy and compares to **the manifest it
 * holds**" — is the reason a divergence in manifest identity is reported as
 * `PLANES_ON_DIFFERENT_RELEASES`: an audit plane holding an older manifest is no longer
 * checking the control plane's current bundle, so the independent-recomputation property the
 * architecture relies on is not in force for the candidate release. The gate reports that
 * fact and declines readiness. It does not reconfigure anything, coordinate anything, or
 * claim a rollout protocol exists.
 * =================================================================================
 */

export type PreliveStatus =
  /** Every local control-artifact prerequisite passed. Nothing more is claimed. */
  | 'READY_FOR_PROVIDER_SANDBOX_CONFIGURATION'
  | 'NOT_READY';

export interface PreliveFinding {
  readonly code: string;
  readonly detail: string;
}

export interface PlaneEvidence {
  readonly verified: boolean;
  readonly manifestId: string | null;
  readonly manifestEpoch: string | null;
  readonly failure: string | null;
}

export interface PreliveResult {
  readonly status: PreliveStatus;
  readonly control: PlaneEvidence;
  readonly audit: PlaneEvidence;
  readonly manifestIdentitiesEqual: boolean;
  readonly findings: readonly PreliveFinding[];
}

export type EnvironmentSource = Readonly<Record<string, string | undefined>>;

interface ControlOutcome {
  readonly evidence: PlaneEvidence;
  readonly class20ContentHash: string | null;
  readonly corroborationSignalMaxAgeMs: number | null;
  readonly cedarLoaded: boolean;
  readonly cedarFailure: string | null;
  readonly classes: readonly number[];
}

function checkControlPlane(source: EnvironmentSource): ControlOutcome {
  try {
    const configuration = readDeploymentTrustConfiguration(source, CONTROL_TRUST_CONFIG_KEYS);
    const packageSource = filesystemArtifactPackage(configuration.artifactPackageRoot);

    // ---------------------------------------------------------------------------------
    // WHY THIS PROCESS RUNS `50 §3f` OCCASION 1 RATHER THAN VERIFYING IN THE ABSTRACT
    //
    // `§39` requires the gate to report "Cedar verified", and `50 §2e`'s O4 rule makes that
    // a question about the ENGINE: "A Cedar policy bundle is admitted to the engine only
    // after the verified manifest, its `content_hash`, its primary signature and its
    // second-factor signature have all been checked." The loader computes `26 §11`'s
    // `policy_version` through `ACOS-JCS-1`, and `50 §3f` binds every `ACOS-JCS-1` consumer
    // to the ACTIVE verified bundle — so a process that verified without publishing could
    // not answer the question `§39` asks.
    //
    // So when NOTHING is active in this process, the gate becomes a control plane for the
    // length of its own run: it performs occasion 1 exactly as a deployment does. That
    // changes no file, no configuration and no other process, which is what `§39`'s
    // "read-only" is about — and when a bundle IS already active (a test worker, a host
    // running the kernel), the gate verifies WITHOUT publishing, so it never displaces a
    // bundle somebody else is running on.
    // ---------------------------------------------------------------------------------
    const bundle = kernelAuthorityReady()
      ? verifyControlArtifactBundle(configuration, packageSource)
      : bootstrapControlArtifactAuthority({ configuration, source: packageSource });

    let cedarLoaded = false;
    let cedarFailure: string | null = null;
    try {
      loadPolicyArtifacts(bundle);
      cedarLoaded = true;
    } catch (error) {
      cedarFailure =
        typeof error === 'object' && error !== null && 'detail' in error
          ? String((error as { detail: unknown }).detail)
          : String(error);
    }
    return {
      evidence: {
        verified: true,
        manifestId: bundleManifestId(bundle),
        manifestEpoch: bundleManifestEpoch(bundle),
        failure: null,
      },
      class20ContentHash: verifiedJcs1Specification(bundle).contentHash,
      corroborationSignalMaxAgeMs:
        verifiedDegradedModeConfiguration(bundle).corroborationSignalMaxAgeMs,
      cedarLoaded,
      cedarFailure,
      classes: bundleArtifactIdentities(bundle).map((identity) => identity.artifactClass),
    };
  } catch (error) {
    return {
      evidence: {
        verified: false,
        manifestId: null,
        manifestEpoch: null,
        // The DETAIL, not the coarse worker-facing sentence: this report is read by an
        // operator at a terminal, which is the audience `50 §3f`'s security log is for.
        failure:
          typeof error === 'object' && error !== null && 'reasonCode' in error
            ? `${String((error as { reasonCode: unknown }).reasonCode)}: ${String(
                (error as { detail?: unknown }).detail ?? error,
              )}`
            : String(error),
      },
      class20ContentHash: null,
      corroborationSignalMaxAgeMs: null,
      cedarLoaded: false,
      cedarFailure: null,
      classes: [],
    };
  }
}

/**
 * Evaluate LOCAL evidence only. Nothing here reaches a network, a vendor or a credential.
 */
export function evaluatePreliveReadiness(source: EnvironmentSource = process.env): PreliveResult {
  const findings: PreliveFinding[] = [];

  const control = checkControlPlane(source);
  if (!control.evidence.verified) {
    findings.push({
      code: 'CONTROL_PLANE_NOT_VERIFIED',
      detail: control.evidence.failure ?? 'the control plane did not verify its bundle',
    });
  }
  if (control.evidence.verified && !control.cedarLoaded) {
    findings.push({
      code: 'CEDAR_BUNDLE_NOT_LOADABLE',
      detail: control.cedarFailure ?? 'the verified Cedar bundle did not load (50 §2e)',
    });
  }

  const auditOutcome = verifyAuditPlaneControlArtifacts(source);
  const audit: PlaneEvidence = auditOutcome.verified
    ? {
        verified: true,
        manifestId: auditOutcome.manifestId,
        manifestEpoch: auditOutcome.manifestEpoch,
        failure: null,
      }
    : {
        verified: false,
        manifestId: null,
        manifestEpoch: null,
        failure: `${auditOutcome.reason}: ${auditOutcome.detail}`,
      };
  if (!audit.verified) {
    findings.push({
      code: 'AUDIT_PLANE_NOT_VERIFIED',
      detail: audit.failure ?? 'the audit plane did not verify its own copy',
    });
  }

  // `50 §3` property 2 and `§27` of the mandate. Two INDEPENDENTLY obtained identities.
  const manifestIdentitiesEqual =
    control.evidence.manifestId !== null &&
    audit.manifestId !== null &&
    control.evidence.manifestId === audit.manifestId;
  if (control.evidence.verified && audit.verified && !manifestIdentitiesEqual) {
    findings.push({
      code: 'PLANES_ON_DIFFERENT_RELEASES',
      detail:
        `the control plane independently verified manifest ${String(control.evidence.manifestId)} ` +
        `and the audit plane independently verified ${String(audit.manifestId)}. Each plane ` +
        'verified ITS OWN configured package correctly; the deployment is mid-rollout and ' +
        'the audit plane’s independent recomputation (50 §3, property 2) is not in force ' +
        'for the control plane’s active release',
    });
  }

  // `50 §2b`'s byte-identity obligation, checked from each plane's OWN verified bytes.
  if (
    auditOutcome.verified &&
    control.class20ContentHash !== null &&
    auditOutcome.jcs1SpecificationContentHash !== control.class20ContentHash
  ) {
    findings.push({
      code: 'CROSS_PLANE_CLASS_20_DIVERGENCE',
      detail:
        'the two planes hold different ACOS-JCS-1 specification bytes; 50 §2b requires a ' +
        'BYTE-IDENTICAL COPY on each plane',
    });
  }

  // `50 §2c` / `50 §2f`'s ONE declared duplication in the whole inventory.
  if (
    auditOutcome.verified &&
    control.corroborationSignalMaxAgeMs !== null &&
    auditOutcome.corroborationSignalMaxAgeMs !== control.corroborationSignalMaxAgeMs
  ) {
    findings.push({
      code: 'CROSS_PLANE_CORROBORATION_MAX_AGE_DIVERGENCE',
      detail:
        'the two planes hold different corroboration_signal_max_age values; 50 §2c makes ' +
        'equality across the planes a cross-plane obligation',
    });
  }

  // `50 §2d`. Belt and braces: the verifiers already refuse a class-17 entry, and a gate
  // that reported readiness without looking would be trusting that rather than checking it.
  if (control.classes.includes(17)) {
    findings.push({
      code: 'RETIRED_CLASS_PRESENT',
      detail: 'the active control bundle carries a class-17 entry; class 17 is RETIRED (50 §2d)',
    });
  }

  return Object.freeze({
    status:
      findings.length === 0 ? 'READY_FOR_PROVIDER_SANDBOX_CONFIGURATION' : 'NOT_READY',
    control: control.evidence,
    audit,
    manifestIdentitiesEqual,
    findings: Object.freeze(findings),
  });
}

/** Render the result for an operator. Deterministic; no clock, no path, no host name. */
export function renderPreliveResult(result: PreliveResult): string {
  const out: string[] = [];
  out.push('ACOS PRE-LIVE CONTROL-ARTIFACT READINESS');
  out.push('');
  out.push('LOCAL EVIDENCE ONLY. No network call, no vendor call, no credential test.');
  out.push('This gate says nothing about provider readiness, I36, I20 or I8.');
  out.push('');
  out.push(`control plane verified : ${String(result.control.verified)}`);
  out.push(`control manifest_id    : ${result.control.manifestId ?? '—'}`);
  if (result.control.failure !== null) out.push(`control failure        : ${result.control.failure}`);
  out.push(`audit plane verified   : ${String(result.audit.verified)}`);
  out.push(`audit manifest_id      : ${result.audit.manifestId ?? '—'}`);
  if (result.audit.failure !== null) out.push(`audit failure          : ${result.audit.failure}`);
  out.push(`manifest identities equal: ${String(result.manifestIdentitiesEqual)}`);
  out.push('');
  if (result.findings.length > 0) {
    out.push(`${String(result.findings.length)} finding(s):`);
    for (const finding of result.findings) {
      out.push(`  ${finding.code}`);
      out.push(`    ${finding.detail}`);
    }
    out.push('');
  }
  out.push(`RESULT: ${result.status}`);
  if (result.status === 'READY_FOR_PROVIDER_SANDBOX_CONFIGURATION') {
    out.push('');
    out.push('This is the ONLY readiness claim this gate makes. It means the local');
    out.push('control-artifact prerequisites pass on both planes. It does NOT mean the');
    out.push('system may take a real external effect, and many obligations remain open.');
  }
  return `${out.join('\n')}\n`;
}

export { AUDIT_TRUST_CONFIG_KEYS, CONTROL_TRUST_CONFIG_KEYS };
