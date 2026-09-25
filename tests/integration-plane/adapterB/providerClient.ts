/**
 * ADAPTER B's PROVIDER-CLIENT BOUNDARY — `§31`. SYNTHETIC, IN-PROCESS, NO NETWORK.
 *
 * B's own client, in B's own root, sharing no module with A's. `48 §4` item 1: "One
 * vendor-HTTP client per adapter." The perimeter scanner counts this as a SECOND call site
 * and requires its own annotation; one annotation covering two adapters would be exactly
 * the maintained-list failure `48 §4` item 2 replaces with a call-site annotation.
 *
 * There is no network here and no vendor. `§4`.
 */

export const B_PROVIDER_SCRIPTS = ['ACCEPT', 'REJECT_NO_MUTATION', 'AMBIGUOUS'] as const;

export type BProviderScript = (typeof B_PROVIDER_SCRIPTS)[number];

export function isBProviderScript(value: string): value is BProviderScript {
  return (B_PROVIDER_SCRIPTS as readonly string[]).includes(value);
}

export interface BProviderRequest {
  readonly method: string;
  readonly correlationTag: string;
  readonly payloadBytes: Buffer;
  readonly secret: string;
}

export interface BProviderResponse {
  readonly accepted: boolean;
  readonly reference: string;
  readonly rawRecord: string;
}

/**
 * The one provider-client call site in adapter B's runtime.
 *
 * PERIMETER_AUTHORISED(authorisation_ref) — I24, 48 §4 item 2. Reached only from B's
 * `adapter.ts`, which receives an invocation whose `authorisationRef` the host validated
 * and bound before any adapter code ran.
 */
export function sendToProviderB(
  request: BProviderRequest,
  script: BProviderScript,
): Promise<BProviderResponse> {
  if (script === 'AMBIGUOUS') {
    return Promise.resolve({
      accepted: false,
      reference: '',
      rawRecord: `{"synthetic":"b-ambiguous","tag":"${request.correlationTag}"}`,
    });
  }
  if (script === 'REJECT_NO_MUTATION') {
    return Promise.resolve({
      accepted: false,
      reference: '',
      rawRecord: `{"synthetic":"b-rejected","tag":"${request.correlationTag}"}`,
    });
  }
  return Promise.resolve({
    accepted: request.secret.length > 0,
    reference: `synthetic-b:${request.correlationTag}`,
    rawRecord: `{"synthetic":"b-accepted","method":"${request.method}"}`,
  });
}
