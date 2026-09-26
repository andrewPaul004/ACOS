/**
 * `§17` — THE AUDIT READER'S LOG. STRUCTURED, CLOSED, AND SECRET-FREE BY SHAPE.
 *
 * =================================================================================
 * WHY THE RECORD TYPE IS CLOSED RATHER THAN SANITISED
 *
 * `§17` requires that the audit secret cannot appear in "control process; integration send
 * process; IPC; DB; control journal; worker output; **logs/errors**".
 *
 * A sanitiser over a free-form record is a denylist, and a denylist is a list of the shapes
 * somebody thought of. So `AuditReadLogRecord` is a closed interface whose every member is
 * an identity or a closed enum, and there is NO member a credential, a provider URL, an
 * environment or a stack could occupy.
 *
 * `emitAuditReadLog` writes ONE line of JSON to `stderr` and nothing else. `stderr` rather
 * than `stdout` for the reason `runtimeLog.ts` gives: the parent pipes both, `stdout` is the
 * channel an accidental `console.log` would take, and keeping the structured stream on
 * `stderr` lets the boundary test assert the child's `stdout` is EMPTY — a stronger
 * statement than asserting a log line is clean.
 *
 * =================================================================================
 * AND THE RECORD CARRIES NO ACOS-SIDE IDENTITY, WHICH IS THE AUDIT PLANE'S OWN RULE
 *
 * `runtimeLog.ts` records `authorisationRef`, `effectId` and `outboxId`, because `48 §4`
 * item 2 wants an external WRITE traceable to the authorisation that permitted it. **A
 * READ is not a write and has no authorisation**, and `48`'s v1.3 note says the audit
 * plane's reads are "never parameterised by an ACOS-side identifier or tag set".
 *
 * So this record has no `authorisationRef`, no `effectId` and no `outboxId`. What it has is
 * the provider, the period, the operation, the correlation tag the read filtered on, and the
 * result class — which is what happened at the provider and nothing about what ACOS believes.
 * =================================================================================
 */

/** The closed set of things worth recording. One member per guard outcome plus the result. */
export const AUDIT_READ_LOG_EVENTS = [
  'READER_STARTED',
  'READ_REQUEST_RECEIVED',
  'READ_REQUEST_REFUSED',
  'PROVIDER_READ_ISSUED',
  'READ_COMPLETED',
] as const;

export type AuditReadLogEvent = (typeof AUDIT_READ_LOG_EVENTS)[number];

/** One log record. EVERY MEMBER IS AN IDENTITY, A BOUND, OR A CLOSED ENUM. */
export interface AuditReadLogRecord {
  readonly event: AuditReadLogEvent;
  readonly readerIdentity: string;
  readonly providerId: string;
  readonly readId: string | null;
  /** The closed operation name. Never a URL, never a path, never a method verb. */
  readonly operation: string | null;
  readonly periodStartMs: number | null;
  readonly periodEndMs: number | null;
  /** The ACOS correlation tag the read filtered on. An ACOS-minted tag, not a credential. */
  readonly correlationTag: string | null;
  /** How many records the provider returned. A count, never their content. */
  readonly recordCount: number | null;
  /** The closed refusal reason or result kind. Never a message. */
  readonly resultClass: string | null;
}

export type AuditReadLogSink = (line: string) => void;

const defaultSink: AuditReadLogSink = (line) => {
  process.stderr.write(`${line}\n`);
};

/**
 * Emit one record.
 *
 * The record is REBUILT member by member rather than spread, so a caller that handed in an
 * object with extra properties — a credential, say, or a provider response — emits only the
 * declared members. That is the one place a closed type alone would not be enough, because
 * TypeScript's excess-property check does not survive a value arriving as `unknown` and
 * being asserted.
 */
export function emitAuditReadLog(
  record: AuditReadLogRecord,
  sink: AuditReadLogSink = defaultSink,
): void {
  sink(
    JSON.stringify({
      event: record.event,
      readerIdentity: record.readerIdentity,
      providerId: record.providerId,
      readId: record.readId,
      operation: record.operation,
      periodStartMs: record.periodStartMs,
      periodEndMs: record.periodEndMs,
      correlationTag: record.correlationTag,
      recordCount: record.recordCount,
      resultClass: record.resultClass,
    }),
  );
}
