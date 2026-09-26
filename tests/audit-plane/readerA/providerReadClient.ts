/**
 * READER A's PROVIDER-READ BOUNDARY — `§16`. SYNTHETIC, IN-PROCESS, NO NETWORK.
 *
 * =================================================================================
 * WHAT THIS FILE EXISTS FOR
 *
 * The audit-plane counterpart of `tests/integration-plane/adapterA/providerClient.ts`.
 * `readFromProviderActivity` is the one function in reader A's runtime that stands where a
 * vendor activity-query client would stand, and it is marked as such with the annotation
 * `tools/perimeter/` looks for.
 *
 * `48 §2` row 13 — "Audit plane vendor reads" — is `EXEMPT (read-only; §3.6)`, and `48 §3`
 * is explicit about what an exemption is: "An exemption is not a hole. It is a **named,
 * annotated, reviewed** hole, and the difference is that a reviewer can find it." **An
 * UNENUMERATED read is not exempt; it is unreviewed.** So this boundary is annotated and
 * enumerated even though `48` exempts it from carrying an `authorisation_ref`.
 *
 * THERE IS NO NETWORK HERE AND NO VENDOR. The function is deterministic over an in-process
 * script, returns synthetic records, and reaches nothing outside this process. `§27` forbids
 * a real provider request and the boundary suite asserts the absence by pattern over this
 * directory.
 *
 * =================================================================================
 * AND THERE IS NO SEND FUNCTION IN THIS FILE, WHICH IS THE POINT OF THE WHOLE SLICE
 *
 * `§16`: "No send operation." A file named `providerReadClient.ts` that also exported a
 * `sendToProvider` would satisfy every structural check in the runtime and defeat the
 * architecture, so the absence is asserted directly:
 * `tests/integration/audit/audit-read-boundary.test.ts` scans this directory for the
 * `sendToProvider*` declaration shape `tools/perimeter/` recognises and requires ZERO.
 * =================================================================================
 */

/** The scripted behaviours a test can ask reader A's synthetic provider for. */
export const PROVIDER_READ_SCRIPTS = [
  /** The provider returns one record carrying the requested correlation tag. */
  'ONE_MATCHING_RECORD',
  /** The provider returns a record the audit plane did not ask about. `I8`'s sweep case. */
  'ONE_UNRELATED_RECORD',
  /** The provider answers and holds nothing for the period. */
  'EMPTY',
  /** The provider is not reachable. NOT the same as `EMPTY`, and never conflated with it. */
  'UNAVAILABLE',
  /** The provider returns more records than the request bounded. The host refuses it. */
  'OVER_BOUND',
  'HANG',
] as const;

export type ProviderReadScript = (typeof PROVIDER_READ_SCRIPTS)[number];

export function isProviderReadScript(value: string): value is ProviderReadScript {
  return (PROVIDER_READ_SCRIPTS as readonly string[]).includes(value);
}

export interface SyntheticProviderReadRequest {
  readonly operation: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly correlationTag: string | null;
  readonly providerMessageId: string | null;
  readonly maxRecords: number;
  /**
   * The read-only credential, presented exactly where a real client would present it.
   *
   * An ARGUMENT rather than a module-level value, for the reason adapter A's client takes
   * one: it is where a vendor client takes it, and it keeps the material in the one call
   * frame `§17`'s leak matrix has to account for. It is never logged, never returned and
   * never encoded.
   */
  readonly secret: string;
}

export interface SyntheticProviderReadRecord {
  readonly providerMessageId: string;
  readonly providerStatus: string;
  readonly providerTimestampMs: number;
  readonly correlationTag: string | null;
}

export interface SyntheticProviderReadResponse {
  readonly reachable: boolean;
  readonly records: readonly SyntheticProviderReadRecord[];
  readonly recordCount: number;
}

/**
 * The one provider-READ call site in reader A's runtime.
 *
 * PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — `48 §2` row 13. Read-only: this
 * function performs a query and has no branch that mutates provider state. The exemption is
 * `48 §3.6`'s, and the `36 §13` empirical attempted-write test against a real provider
 * account remains separately owed.
 */
export async function readFromProviderActivity(
  request: SyntheticProviderReadRequest,
  script: ProviderReadScript,
): Promise<SyntheticProviderReadResponse> {
  if (script === 'HANG') {
    await new Promise<never>(() => {
      /* never settles — the parent's deadline is what resolves this */
    });
  }
  if (script === 'UNAVAILABLE') {
    return { reachable: false, records: [], recordCount: 0 };
  }

  // The secret is USED — a vendor client would put it in an Authorization header — and the
  // use is confined to deciding whether the synthetic provider answers at all. Nothing
  // derived from it leaves this frame, and nothing derived from it is placed on a record.
  if (request.secret.length === 0) {
    return { reachable: false, records: [], recordCount: 0 };
  }

  // The synthetic provider's clock sits inside the requested period, so a record it returns
  // is a record the period-bounded read would genuinely have found.
  const withinPeriod = Math.floor((request.periodStartMs + request.periodEndMs) / 2);

  if (script === 'EMPTY') {
    return { reachable: true, records: [], recordCount: 0 };
  }
  if (script === 'ONE_UNRELATED_RECORD') {
    return {
      reachable: true,
      records: [
        {
          providerMessageId: 'synthetic-read-a:unrelated',
          providerStatus: 'accepted',
          providerTimestampMs: withinPeriod,
          // A tag the audit plane did not ask about. `I8`'s inverse sweep finds this only
          // because the read is PERIOD-bounded; a tag-bounded read would never return it.
          correlationTag: 'acos-corr-00000000-0000-4000-8000-00000000dead',
        },
      ],
      recordCount: 1,
    };
  }
  if (script === 'OVER_BOUND') {
    const overBound = request.maxRecords + 1;
    return {
      reachable: true,
      records: Array.from({ length: overBound }, (_unused, index) => ({
        providerMessageId: `synthetic-read-a:over-${String(index)}`,
        providerStatus: 'accepted',
        providerTimestampMs: withinPeriod,
        correlationTag: request.correlationTag,
      })),
      recordCount: overBound,
    };
  }

  return {
    reachable: true,
    records: [
      {
        providerMessageId:
          request.providerMessageId ?? `synthetic-read-a:${String(withinPeriod)}`,
        providerStatus: 'accepted',
        providerTimestampMs: withinPeriod,
        correlationTag: request.correlationTag,
      },
    ],
    recordCount: 1,
  };
}
