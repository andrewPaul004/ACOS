/**
 * ADAPTER A's PROVIDER-CLIENT BOUNDARY — `§31`. SYNTHETIC, IN-PROCESS, NO NETWORK.
 *
 * =================================================================================
 * WHAT THIS FILE EXISTS FOR
 *
 * `§31`: "The synthetic adapter should include one clearly marked provider-client call
 * boundary. This may simply call an in-process TEST synthetic function inside the
 * integration child, since no network exists. **The point is to prove I24 perimeter
 * enumeration.** Do not add `fetch`. Do not add a real provider library."
 *
 * So `sendToProvider` is the one function in adapter A's runtime that stands where a vendor
 * HTTP client would stand, and it is marked as such with the annotation
 * `tools/perimeter/` looks for. `48 §4` item 1: "**One vendor-HTTP client per adapter.** No
 * ad-hoc HTTP construction anywhere in the codebase. A single audited client type per
 * adapter, and the linter forbids raw HTTP libraries outside it."
 *
 * THERE IS NO NETWORK HERE AND NO VENDOR. The function is deterministic over its own
 * argument, returns a synthetic record, and reaches nothing outside this process. `§4` and
 * `§53` item 25 both require that, and the boundary suite asserts it by pattern over this
 * directory.
 * =================================================================================
 */

/** The scripted behaviours a test can ask adapter A's synthetic provider for. */
export const PROVIDER_SCRIPTS = [
  'ACCEPT',
  'REJECT_NO_MUTATION',
  'AMBIGUOUS',
  'THROW_AFTER_SEND',
  'THROW_BEFORE_SEND',
  'HANG',
  'EXIT_AFTER_SEND',
  'EXIT_BEFORE_SEND',
] as const;

export type ProviderScript = (typeof PROVIDER_SCRIPTS)[number];

export function isProviderScript(value: string): value is ProviderScript {
  return (PROVIDER_SCRIPTS as readonly string[]).includes(value);
}

export interface SyntheticProviderRequest {
  readonly method: string;
  readonly correlationTag: string;
  readonly idempotencyKey: string;
  readonly payloadBytes: Buffer;
  /**
   * The credential, presented exactly where a real client would present it.
   *
   * It is an ARGUMENT rather than a module-level value because that is where a vendor client
   * takes one, and because it keeps the material in the one call frame `§29`'s leak matrix
   * has to account for. It is never logged, never returned and never encoded.
   */
  readonly secret: string;
}

export interface SyntheticProviderResponse {
  readonly accepted: boolean;
  /** A synthetic opaque reference, in the shape a provider message id would take. */
  readonly reference: string;
  /** `§44`'s synthetic raw record. Retained inside the runtime; a DIGEST crosses the wire. */
  readonly rawRecord: string;
}

/**
 * The one provider-client call site in adapter A's runtime.
 *
 * PERIMETER_AUTHORISED(authorisation_ref) — I24, 48 §4 item 2. Every invocation of this
 * function is reached only from `adapter.ts`, which receives an `AdapterInvocation` whose
 * `authorisationRef` the integration host validated and bound before adapter code ran.
 */
export async function sendToProvider(
  request: SyntheticProviderRequest,
  script: ProviderScript,
): Promise<SyntheticProviderResponse> {
  if (script === 'HANG') {
    await new Promise<never>(() => {
      /* never settles — `§41`'s deadline is what resolves this */
    });
  }
  if (script === 'EXIT_AFTER_SEND') process.exit(7);
  if (script === 'THROW_AFTER_SEND') throw new Error('SYNTHETIC_PROVIDER_FAULT');
  if (script === 'AMBIGUOUS') {
    return {
      accepted: false,
      reference: '',
      rawRecord: `{"synthetic":"ambiguous","tag":"${request.correlationTag}"}`,
    };
  }
  if (script === 'REJECT_NO_MUTATION') {
    return {
      accepted: false,
      reference: '',
      rawRecord: `{"synthetic":"rejected","tag":"${request.correlationTag}"}`,
    };
  }
  // The secret is USED — a vendor client would put it in a header — and the use is confined
  // to computing the synthetic response's shape. Nothing derived from it leaves this frame.
  const presented = request.secret.length > 0;
  return {
    accepted: presented,
    reference: `synthetic-a:${request.idempotencyKey}`,
    rawRecord: `{"synthetic":"accepted","method":"${request.method}","tag":"${request.correlationTag}"}`,
  };
}
