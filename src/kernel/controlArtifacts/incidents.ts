import { ControlArtifactIntegrityFailure, type ControlArtifactReasonCode } from './errors.js';

/**
 * `50 §3f`'s declared failure behaviour, as an emitted CRITICAL security incident.
 *
 * =================================================================================
 * `50 §3f`, "Failure", verbatim
 *
 *   "On any integrity or signature failure the declared incident semantics are **unchanged
 *    and retained**:
 *      - **fail closed**;
 *      - **do not use the candidate artifact**;
 *      - raise the declared **CRITICAL security incident**;
 *      - **journal it** where the current architecture permits a trusted journal to remain
 *        operational;
 *      - **do not silently fall back to an older artifact**;
 *      - **do not fetch a replacement from the network**."
 *
 * and, immediately after:
 *
 *   "**If bootstrap fails before journalling infrastructure is safely available, local
 *    startup-failure evidence and logging may be the only immediate signal, and that is
 *    accepted.** **A journal chain must NOT be fabricated using unverified `ACOS-JCS-1`
 *    rules** in order to record the failure of the artifact that declares those rules."
 *
 * =================================================================================
 * THE TWO OCCASIONS PRODUCE DIFFERENT EVIDENCE, AND THAT IS THE POINT
 *
 * `BOOTSTRAP` — class 20 has not been admitted, so no `ACOS-JCS-1` implementation may be
 * used. The incident is LOCAL STARTUP EVIDENCE and nothing else. This module writes no
 * journal row, calls no canonicaliser and touches no database on this path, which is how
 * "must NOT be fabricated" becomes a property rather than a promise.
 *
 * `RELOAD` — a bundle was already verified and published, so the journal machinery is
 * running under an admitted specification and the incident may be journalled by whatever
 * observer the deployment installs. This module still does not journal it itself: it
 * PUBLISHES the incident to a sink, because a module that both refuses a candidate bundle
 * and writes to the journal would be a second write path into the chain.
 *
 * =================================================================================
 * WHAT AN INCIDENT MAY CARRY
 *
 * An incident is INTERNAL. It carries the structured `reasonCode` and the internal detail,
 * because it is read by an operator inside the trust boundary. `errors.ts` is what keeps the
 * same failure coarse on the way out to a worker or a model — and
 * `tests/controlArtifacts/error-coarsening.test.ts` asserts that the worker-facing string
 * and the incident detail are different objects with different content.
 * =================================================================================
 */

export const CONTROL_ARTIFACT_INCIDENT_KIND = 'CONTROL_ARTIFACT_INTEGRITY_FAILURE';

/** Which of `50 §3f`'s occasions raised it. There is no third. */
export type ControlArtifactIncidentOccasion = 'BOOTSTRAP' | 'RELOAD';

export interface ControlArtifactSecurityIncident {
  readonly kind: typeof CONTROL_ARTIFACT_INCIDENT_KIND;
  /** `50 §3f` declares this severity and no other. */
  readonly severity: 'CRITICAL';
  readonly occasion: ControlArtifactIncidentOccasion;
  readonly reasonCode: ControlArtifactReasonCode;
  /** INTERNAL. Never a worker-facing string. */
  readonly detail: string;
  /**
   * TRUE only for `RELOAD`.
   *
   * `50 §3f`: a journal chain "must NOT be fabricated using unverified `ACOS-JCS-1` rules".
   * At `BOOTSTRAP` no verified class-20 identity exists, so this is FALSE and the evidence
   * is local. The flag is computed from the occasion here rather than supplied by a caller,
   * so no call site can assert journalability it does not have.
   */
  readonly journallingPermitted: boolean;
  readonly occurredAt: Date;
}

export type ControlArtifactIncidentSink = (incident: ControlArtifactSecurityIncident) => void;

/**
 * The default sink: structured STDERR, and nothing else.
 *
 * Not the journal, not the database, not the network. `50 §3f` forbids fetching a
 * replacement over the network on this path, and a sink that wrote to a remote collector
 * would be a network call on exactly the path an attacker has just proved they can reach.
 */
function defaultSink(incident: ControlArtifactSecurityIncident): void {
  process.stderr.write(
    `${JSON.stringify({
      kind: incident.kind,
      severity: incident.severity,
      occasion: incident.occasion,
      reasonCode: incident.reasonCode,
      detail: incident.detail,
      journallingPermitted: incident.journallingPermitted,
      occurredAt: incident.occurredAt.toISOString(),
    })}\n`,
  );
}

let sink: ControlArtifactIncidentSink = defaultSink;

/**
 * Install an incident observer.
 *
 * A deployment installs one that journals `RELOAD` incidents; tests install one that
 * collects them. IT CANNOT SUPPRESS A FAILURE: the sink is called on the way out of a
 * refusal that has already been decided, and `raiseControlArtifactIncident` rethrows
 * regardless of what the sink does. A throwing sink is swallowed for the same reason —
 * the refusal must not become an unrelated exception on the way to the caller.
 */
export function setControlArtifactIncidentSink(next: ControlArtifactIncidentSink): void {
  sink = next;
}

export function resetControlArtifactIncidentSink(): void {
  sink = defaultSink;
}

/**
 * Raise `50 §3f`'s CRITICAL incident for a refusal that has already been decided, then
 * RETHROW.
 *
 * The signature takes the failure rather than producing one, so there is no path on which an
 * incident is raised and the candidate is used anyway.
 */
export function raiseControlArtifactIncident(
  occasion: ControlArtifactIncidentOccasion,
  failure: ControlArtifactIntegrityFailure,
  now: Date = new Date(),
): never {
  const incident: ControlArtifactSecurityIncident = Object.freeze({
    kind: CONTROL_ARTIFACT_INCIDENT_KIND,
    severity: 'CRITICAL' as const,
    occasion,
    reasonCode: failure.reasonCode,
    detail: failure.detail,
    journallingPermitted: occasion === 'RELOAD',
    occurredAt: now,
  });
  try {
    sink(incident);
  } catch {
    // A sink that throws does not change the verdict and does not replace the failure the
    // caller must see.
  }
  throw failure;
}

/** Narrow an unknown error to the integrity failure this module raises incidents for. */
export function isControlArtifactIntegrityFailure(
  error: unknown,
): error is ControlArtifactIntegrityFailure {
  return error instanceof ControlArtifactIntegrityFailure;
}
