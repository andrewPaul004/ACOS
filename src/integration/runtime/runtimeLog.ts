/**
 * `§43` — THE INTEGRATION RUNTIME'S LOG. STRUCTURED, CLOSED, AND SECRET-FREE BY SHAPE.
 *
 * =================================================================================
 * WHY THE RECORD TYPE IS CLOSED RATHER THAN SANITISED
 *
 * `§43`: the log "Must include useful non-secret identities such as: adapter ID;
 * authorisation_ref; effect/outbox identity; correlation tag; invocation result class" and
 * "Must not include: credential; raw environment; signing private material; unrestricted
 * payload bodies where privacy architecture forbids."
 *
 * A sanitiser over a free-form record is a denylist, and `30 §5.7`'s rule against string
 * classification applies here for the same reason it applies to causes: a redaction pass is
 * a list of the shapes somebody thought of. So `IntegrationLogRecord` is a closed interface
 * whose every member is an identity or a closed enum, and there is NO member a credential, a
 * payload body, an environment or a stack could occupy.
 *
 * `emitIntegrationLog` writes ONE line of JSON to `stderr` and nothing else. `stderr`
 * rather than `stdout` because the parent pipes both, and `stdout` on a `fork`ed child is
 * the channel an accidental `console.log` of an invocation object would take — keeping the
 * structured stream on `stderr` means the boundary test can assert that the child's
 * `stdout` is EMPTY, which is a stronger statement than asserting a log line is clean.
 * =================================================================================
 */

/** The closed set of things worth recording. One member per guard outcome plus the result. */
export const INTEGRATION_LOG_EVENTS = [
  'RUNTIME_STARTED',
  'REQUEST_RECEIVED',
  'REQUEST_REFUSED',
  'ADAPTER_INVOKED',
  'INVOCATION_COMPLETED',
] as const;

export type IntegrationLogEvent = (typeof INTEGRATION_LOG_EVENTS)[number];

/**
 * One log record. EVERY MEMBER IS AN IDENTITY OR A CLOSED ENUM.
 *
 * `authorisationRef` is present deliberately: `§43` names it, and `48 §4` item 2's whole
 * point is that an external write is traceable to the authorisation that permitted it. An
 * authorisation reference is an internal identifier, not a credential.
 */
export interface IntegrationLogRecord {
  readonly event: IntegrationLogEvent;
  readonly runtimeIdentity: string;
  readonly adapterId: string;
  readonly invocationId: string | null;
  readonly authorisationRef: string | null;
  readonly effectId: string | null;
  readonly outboxId: string | null;
  readonly correlationTag: string | null;
  /** The closed refusal reason or outcome kind. Never a message. */
  readonly resultClass: string | null;
}

/** The sink. A parameter so the focused suite can capture without touching a global. */
export type IntegrationLogSink = (line: string) => void;

const defaultSink: IntegrationLogSink = (line) => {
  process.stderr.write(`${line}\n`);
};

/**
 * Emit one record.
 *
 * The record is REBUILT member by member rather than spread, so a caller that handed in an
 * object with extra properties — an invocation, say, or a credential — emits only the
 * declared members. That is the one place where a closed type alone would not be enough,
 * because TypeScript's excess-property check does not survive a value arriving as
 * `IntegrationLogRecord` from somewhere else.
 */
export function emitIntegrationLog(
  record: IntegrationLogRecord,
  sink: IntegrationLogSink = defaultSink,
): void {
  sink(
    JSON.stringify({
      event: record.event,
      runtimeIdentity: record.runtimeIdentity,
      adapterId: record.adapterId,
      invocationId: record.invocationId,
      authorisationRef: record.authorisationRef,
      effectId: record.effectId,
      outboxId: record.outboxId,
      correlationTag: record.correlationTag,
      resultClass: record.resultClass,
    }),
  );
}
