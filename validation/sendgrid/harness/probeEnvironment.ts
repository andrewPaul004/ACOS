/**
 * `§5` OF THE S1P CORRECTION MANDATE — THE ONE-SHOT CREDENTIAL PROCESS BOUNDARY.
 *
 * =================================================================================
 * THE DEFECT: ONE OPERATOR PROCESS HELD BOTH VENDOR CREDENTIALS
 *
 * The rejected harness resolved the integration credential and the audit credential IN THE
 * CLI ITSELF, and its own comment admitted it. The review: "The normal validation coordinator
 * should hold ZERO vendor credential material."
 *
 * Why it matters, beyond tidiness. `48 §3.6`'s read-only exemption and `36 §13`'s
 * attempted-write test both rest on the audit credential being a DIFFERENT capability from
 * the send credential. A process holding both is a process in which that difference is a
 * convention: one stray log line, one heap dump, one accidental argument swap, and the
 * audit key is presented at `POST /v3/mail/send` by the send path — which is the exact
 * finding `36 §13` exists to make deliberately and under control.
 *
 * =================================================================================
 * THE STRUCTURE: **ONE LOCATOR PER PROCESS, AND THE ALLOWLIST HAS ONE SLOT**
 *
 * `S1P_PROBE_ENV_KEYS` below is a CLOSED, SEVEN-KEY allowlist with EXACTLY ONE locator member
 * and EXACTLY ONE source-module member. There is no second slot. A process launched through
 * `buildProbeEnvironment` therefore CANNOT hold two credentials, and the impossibility is a
 * property of the key set rather than of the caller's discipline —
 * `tests/sendgrid/credential-process-isolation.test.ts` asserts it by reading the child's own
 * reported environment keys, which is the only evidence that is not the parent's word for
 * what it passed.
 *
 * `fork` REPLACES the child's environment when `env` is supplied, so nothing the coordinator
 * holds leaks in; and the coordinator holds nothing, which is the point.
 *
 * =================================================================================
 * WHAT A PROBE PROCESS MAY DO, AND WHY EACH ROLE IS SEPARATE
 *
 *   `IDENTITY`    resolve the credential and report its NON-SECRET identity facts. NO
 *                 NETWORK. This is what stage 2 of the preflight needs, and nothing more.
 *   `SEND_PROBE`  `36 §13`'s attempted write, performed with the AUDIT credential and
 *                 expected to be REFUSED by the provider. `§5.1`: it "must not have access to
 *                 the integration credential or integration secret locator", which the
 *                 one-slot allowlist makes structural.
 *   `READ_PROBE`  `GET /v3/messages` with whichever single credential this process holds —
 *                 the audit one, where success is required, or the integration one, where a
 *                 provider refusal is the correctly-scoped answer (`§5.2`).
 *
 *   `DUPLICATE_SEND_PROBE`
 *                 `§13`'s deliberate two-send experiment, with the INTEGRATION credential, so
 *                 the `I36` oracle can be shown to SEE two accepted messages. Separately
 *                 acknowledged, and refused on the audit plane.
 *
 * The four roles are one ENTRY POINT with one role variable rather than four files,
 * because the property being asserted is about the PROCESS's credential holdings and a
 * single entry point with a closed role enum keeps the allowlist in one place. What is NOT
 * shared is the material: each launch resolves one credential, reports, and exits.
 * =================================================================================
 */

/** The protocol version the parent and the one-shot child agree on. */
export const S1P_PROBE_PROTOCOL_VERSION = 'acos.s1p.credential-probe.v1';

export const ENV_PROBE_PROTOCOL_VERSION = 'ACOS_S1P_PROBE_PROTOCOL_VERSION';
/** A member of `S1P_PROBE_ROLES`. A closed enum; an unknown role exits refusing. */
export const ENV_PROBE_ROLE = 'ACOS_S1P_PROBE_ROLE';
/** Which plane's credential this process holds. Evidence, and a wiring assertion. */
export const ENV_PROBE_PLANE = 'ACOS_S1P_PROBE_PLANE';
/** The ONE secret-source module this process may load. */
export const ENV_PROBE_SOURCE_MODULE = 'ACOS_S1P_PROBE_SOURCE_MODULE';
/** The ONE locator this process may read. A PATH, never material. */
export const ENV_PROBE_LOCATOR = 'ACOS_S1P_PROBE_LOCATOR';
/** The signed expected credential identity, echoed as trusted launch configuration. */
export const ENV_PROBE_EXPECTED_CREDENTIAL_ID = 'ACOS_S1P_PROBE_EXPECTED_CREDENTIAL_ID';
/** The probe's own non-secret operands, as one JSON document. NEVER a credential. */
export const ENV_PROBE_OPERANDS = 'ACOS_S1P_PROBE_OPERANDS';

/** THE CLOSED ALLOWLIST. Seven keys, ONE locator, ONE source module. */
export const S1P_PROBE_ENV_KEYS = [
  ENV_PROBE_PROTOCOL_VERSION,
  ENV_PROBE_ROLE,
  ENV_PROBE_PLANE,
  ENV_PROBE_SOURCE_MODULE,
  ENV_PROBE_LOCATOR,
  ENV_PROBE_EXPECTED_CREDENTIAL_ID,
  ENV_PROBE_OPERANDS,
] as const;

export type S1PProbeEnvKey = (typeof S1P_PROBE_ENV_KEYS)[number];

export const S1P_PROBE_ROLES = [
  'IDENTITY',
  'SEND_PROBE',
  'READ_PROBE',
  /**
   * `§11`, `§13` — THE DELIBERATE DUPLICATE PAIR. INTEGRATION PLANE ONLY, AND SEPARATELY
   * ACKNOWLEDGED.
   *
   * It is a role of this one-shot runtime rather than an adapter method or an IPC operation,
   * which is `§13`'s "isolated probe path, not normal kernel dispatch" and "cannot become a
   * normal adapter method" made structural: nothing on the dispatch wire names it and the
   * kernel has no way to ask for it.
   */
  'DUPLICATE_SEND_PROBE',
] as const;
export type S1PProbeRole = (typeof S1P_PROBE_ROLES)[number];

export function isProbeRole(value: unknown): value is S1PProbeRole {
  return typeof value === 'string' && (S1P_PROBE_ROLES as readonly string[]).includes(value);
}

export const S1P_PROBE_PLANES = ['INTEGRATION', 'AUDIT'] as const;
export type S1PProbePlane = (typeof S1P_PROBE_PLANES)[number];

export function isProbePlane(value: unknown): value is S1PProbePlane {
  return typeof value === 'string' && (S1P_PROBE_PLANES as readonly string[]).includes(value);
}

/** The non-secret operands a probe may be given. NO MEMBER CAN CARRY A CREDENTIAL. */
export interface ProbeOperands {
  /** `SEND_PROBE` only: the correlation tag the attempted write carries. */
  readonly correlationTag?: string;
  /** `SEND_PROBE` only: the sender the attempted write declares. */
  readonly senderAddress?: string;
  /** `SEND_PROBE` only: the OWNER-CONTROLLED sink the attempted write addresses. */
  readonly sinkAddress?: string;
  /** `READ_PROBE` only: the period bound. `48`: every read is period-bounded, always. */
  readonly periodStartMs?: number;
  readonly periodEndMs?: number;
}

/**
 * Build a one-shot probe process's COMPLETE environment.
 *
 * Constructed, never filtered: the returned object's keys are exactly
 * `S1P_PROBE_ENV_KEYS`, and there is no code path in this package that copies a key out of
 * `process.env` into a child. The one exception the platform forces is handled by `fork`
 * itself, which adds the OS variables listed in `PLATFORM_INJECTED_ENV_KEYS` on the
 * integration plane for the same reason.
 */
export function buildProbeEnvironment(input: {
  readonly role: S1PProbeRole;
  readonly plane: S1PProbePlane;
  readonly sourceModule: string;
  readonly locator: string;
  readonly expectedCredentialId: string;
  readonly operands: ProbeOperands;
}): Record<string, string> {
  return {
    [ENV_PROBE_PROTOCOL_VERSION]: S1P_PROBE_PROTOCOL_VERSION,
    [ENV_PROBE_ROLE]: input.role,
    [ENV_PROBE_PLANE]: input.plane,
    [ENV_PROBE_SOURCE_MODULE]: input.sourceModule,
    [ENV_PROBE_LOCATOR]: input.locator,
    [ENV_PROBE_EXPECTED_CREDENTIAL_ID]: input.expectedCredentialId,
    [ENV_PROBE_OPERANDS]: JSON.stringify(input.operands),
  };
}
