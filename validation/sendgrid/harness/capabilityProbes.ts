import type { ProbeOperands, S1PProbePlane, S1PProbeRole } from './probeEnvironment.js';
import type { ProbeLaunchResult } from './probeClient.js';
import type { ProbeRecord } from './probeResult.js';

/**
 * `§12` — THE CAPABILITY-PROBE ORCHESTRATION, AND THE RULE THAT BLOCKS THE MATRIX.
 *
 * =================================================================================
 * FOUR PROBES, FOUR SEPARATE ONE-SHOT PROCESSES, ONE CREDENTIAL EACH
 *
 * `§12` names them:
 *
 *   1. the INTEGRATION send credential performs a permitted non-production send — which the
 *      SCENARIO DRIVER already does, through the accepted gateway and the accepted runtime, so
 *      it is not duplicated here. A separate send would be an unauthorised message.
 *   2. the AUDIT credential performs an Email Activity read, and SUCCESS is required;
 *   3. the AUDIT credential attempts `POST /v3/mail/send`, and a PROVIDER REFUSAL is required
 *      (`36 §13`);
 *   4. the INTEGRATION credential attempts an Email Activity read, where a provider refusal is
 *      what a correctly scoped `mail.send`-only key produces (`§8.7`'s inverse direction).
 *
 * Each runs in its OWN one-shot process holding ONE credential. `§5.1`: the attempted-write
 * probe "must not have access to the integration credential or integration secret locator",
 * which the one-slot environment allowlist makes structural rather than conventional.
 *
 * =================================================================================
 * `§12`'s TWO RULES, WHICH ARE WHY THIS IS A FUNCTION AND NOT A LOOP
 *
 * **"A provider-unreachable/inconclusive probe does NOT pass."** `PROVIDER_UNREACHABLE`,
 * `INCONCLUSIVE` and `NOT_RUN` are each a BLOCK, not a shrug. A probe that could not ask the
 * provider has established nothing, and reporting it as satisfied would make an outage look
 * like a conformant credential.
 *
 * **"A credential whose observed capability disagrees with signed class-5 declaration blocks
 * the scenario matrix."** The signed record says what the deployment believes it provisioned;
 * `36 §13` asks the vendor. When they disagree, the VENDOR is right and the matrix does not
 * run — because every row of it would be measured with a credential that is not the one the
 * architecture admitted.
 *
 * =================================================================================
 * WHY IT TAKES THE LAUNCHER AS A PORT
 *
 * So the orchestration — the four launches, their plane/role pairing, and the verdict rule —
 * is exercised OFFLINE, with no credential and no provider, exactly as `§11` requires of the
 * driver. `tests/sendgrid/capability-probes.test.ts` drives every blocking case with scripted
 * replies. The LIVE composition passes `runCredentialProbe`.
 * =================================================================================
 */

/** The launcher this orchestration needs. `probeClient.ts`'s `runCredentialProbe`, injected. */
export type ProbeLauncher = (input: {
  readonly role: S1PProbeRole;
  readonly plane: S1PProbePlane;
  readonly sourceModule: string;
  readonly locator: string;
  readonly expectedCredentialId: string;
  readonly operands?: ProbeOperands;
}) => Promise<ProbeLaunchResult>;

export interface CapabilityProbeConfig {
  readonly integrationSourceModule: string;
  readonly integrationLocator: string;
  readonly integrationCredentialId: string;
  readonly auditSourceModule: string;
  readonly auditLocator: string;
  readonly auditCredentialId: string;
  /** The `36 §13` attempted write goes to the OWNER-CONTROLLED sink and nowhere else. */
  readonly senderAddress: string;
  readonly sinkAddress: string;
  /** A DEDICATED correlation for the attempted write, so it cannot contaminate a scenario. */
  readonly probeCorrelationTag: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
}

/** Why the scenario matrix may not run. A closed set; every member is a BLOCK. */
export const PROBE_BLOCKS = [
  /** `36 §13`: the audit credential was NOT refused a send. The provisioning is wrong. */
  'AUDIT_CREDENTIAL_CAN_SEND',
  /** The audit credential could not read Email Activity. `I36`'s oracle has no source. */
  'AUDIT_CREDENTIAL_CANNOT_READ',
  /** `§8.7`'s inverse direction: a `mail.send`-only key that can also read. */
  'INTEGRATION_CREDENTIAL_CAN_READ',
  /** A probe did not reach the provider, or answered inconclusively, or did not run. */
  'PROBE_INCONCLUSIVE',
  /** A one-shot probe process did not answer at all. */
  'PROBE_PROCESS_FAILED',
] as const;

export type ProbeBlock = (typeof PROBE_BLOCKS)[number];

export interface CapabilityProbeOutcome {
  /** Every probe record, in launch order. Sanitized; no member can carry a secret. */
  readonly probes: readonly ProbeRecord[];
  /** `§16`: the audit-key send-refusal result, restated so it cannot be overlooked. */
  readonly auditKeySendRefusal: ProbeRecord | null;
  /** Empty means the matrix may run. Any member blocks it. */
  readonly blocks: readonly ProbeBlock[];
}

function recordOf(result: ProbeLaunchResult): ProbeRecord | null {
  if (result.kind !== 'REPLY') return null;
  return result.reply.kind === 'PROBE_RECORD' ? result.reply.record : null;
}

/**
 * Run the three credential-capability probes and decide whether the matrix may proceed.
 *
 * ORDER IS DELIBERATE: the audit READ first, because it is the least dangerous and its failure
 * makes everything after it unmeasurable; then the audit attempted WRITE, which is the one
 * `36 §13` exists for; then the integration read, which is `§8.7`'s safe inverse.
 */
export async function orchestrateCapabilityProbes(
  launch: ProbeLauncher,
  config: CapabilityProbeConfig,
): Promise<CapabilityProbeOutcome> {
  const probes: ProbeRecord[] = [];
  const blocks: ProbeBlock[] = [];

  const push = (result: ProbeLaunchResult): ProbeRecord | null => {
    const record = recordOf(result);
    if (record === null) {
      blocks.push('PROBE_PROCESS_FAILED');
      return null;
    }
    probes.push(record);
    return record;
  };

  // 2 — THE AUDIT CREDENTIAL READS. `CAPABILITY_CONFIRMED` is required.
  const auditRead = push(
    await launch({
      role: 'READ_PROBE',
      plane: 'AUDIT',
      sourceModule: config.auditSourceModule,
      locator: config.auditLocator,
      expectedCredentialId: config.auditCredentialId,
      operands: { periodStartMs: config.periodStartMs, periodEndMs: config.periodEndMs },
    }),
  );
  if (auditRead !== null && auditRead.outcome !== 'CAPABILITY_CONFIRMED') {
    blocks.push(
      auditRead.outcome === 'CAPABILITY_REFUSED_BY_PROVIDER'
        ? 'AUDIT_CREDENTIAL_CANNOT_READ'
        : 'PROBE_INCONCLUSIVE',
    );
  }

  // 3 — `36 §13`. THE AUDIT CREDENTIAL ATTEMPTS A SEND, AND A PROVIDER REFUSAL IS REQUIRED.
  const auditSend = push(
    await launch({
      role: 'SEND_PROBE',
      plane: 'AUDIT',
      sourceModule: config.auditSourceModule,
      locator: config.auditLocator,
      expectedCredentialId: config.auditCredentialId,
      operands: {
        correlationTag: config.probeCorrelationTag,
        senderAddress: config.senderAddress,
        sinkAddress: config.sinkAddress,
      },
    }),
  );
  if (auditSend !== null) {
    if (auditSend.outcome === 'CAPABILITY_CONFIRMED') {
      /*
       * THE AUDIT KEY CAN SEND. The most serious finding this harness can make, and it is
       * reported rather than hidden: `48 §3.6`'s read-only exemption is NOT earned by this
       * credential, so the audit plane's independence rests on nothing.
       */
      blocks.push('AUDIT_CREDENTIAL_CAN_SEND');
    } else if (auditSend.outcome !== 'CAPABILITY_REFUSED_BY_PROVIDER') {
      blocks.push('PROBE_INCONCLUSIVE');
    }
  }

  // 4 — `§8.7`'s INVERSE DIRECTION, and it is safe in a way the send probe is not: a read
  // cannot mutate, so the worst case of a mis-scoped send key is a record read.
  const integrationRead = push(
    await launch({
      role: 'READ_PROBE',
      plane: 'INTEGRATION',
      sourceModule: config.integrationSourceModule,
      locator: config.integrationLocator,
      expectedCredentialId: config.integrationCredentialId,
      operands: { periodStartMs: config.periodStartMs, periodEndMs: config.periodEndMs },
    }),
  );
  if (integrationRead !== null) {
    if (integrationRead.outcome === 'CAPABILITY_CONFIRMED') {
      blocks.push('INTEGRATION_CREDENTIAL_CAN_READ');
    } else if (integrationRead.outcome !== 'CAPABILITY_REFUSED_BY_PROVIDER') {
      blocks.push('PROBE_INCONCLUSIVE');
    }
  }

  return Object.freeze({
    probes: Object.freeze([...probes]),
    auditKeySendRefusal: auditSend,
    blocks: Object.freeze([...new Set(blocks)]),
  });
}

/**
 * v1.3.8 — UNDER `SIGNED_PROVIDER_PUSH`, NONE OF THE THREE PROBES ABOVE IS LAUNCHED.
 *
 *   probe 2  the audit Email Activity read — NOT APPLICABLE: no SendGrid audit credential
 *            exists under push (ADR-027 decision 3), and Email Activity is not the oracle.
 *   probe 3  the audit-key attempted send — NOT APPLICABLE, for the same reason: there is no
 *            audit key whose read-only exemption `36 §13` would have to earn.
 *   probe 4  the integration-key Email Activity read — NOT RUN. Under push the paid Email
 *            Activity entitlement is not required, so a provider refusal could not distinguish
 *            "this key is `mail.send`-only" from "this account has no entitlement", and the
 *            probe would call `/v3/messages`, which push mode does not touch.
 *
 * Probe 1, the integration key's permitted send, is the scenario driver's kill point 1, as in
 * read mode. What the skipped probe 4 would have partly covered — whether the integration
 * key's provider-side permissions have drifted beyond `mail.send` — is therefore an OPEN
 * EMPIRICAL OBLIGATION, stated in the evidence bundle. It is not discharged by buying the
 * entitlement, by adding a broad management credential, or by any call in this slice.
 */
export const SIGNED_PUSH_OPEN_EMPIRICAL_OBLIGATIONS: readonly string[] = Object.freeze([
  'PROVIDER_PERMISSION_DRIFT: the integration credential\'s provider-side permissions are not ' +
    'observed beyond mail.send under SIGNED_PROVIDER_PUSH. The read-direction capability probe ' +
    'is not run (it would be confounded by the absent Email Activity entitlement and would ' +
    'touch /v3/messages), and no management credential is provisioned to read the scopes.',
  'PUSH_DELIVERY_COMPLETENESS: no empirical characterisation of the provider event stream\'s ' +
    'completeness exists, so no absence-based conclusion (I36 PASS, I8 clean, exact I20 ' +
    'numerator) is available on push evidence.',
]);
