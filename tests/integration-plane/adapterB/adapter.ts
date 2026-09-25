import { createHash } from 'node:crypto';

import type {
  AdapterInvocation,
  IntegrationAdapter,
  ProviderBoundary,
} from '../../../src/integration/runtime/integrationAdapter.js';
import type { WireOutcome } from '../../../src/integration/protocol/wire.js';
import { isBProviderScript, sendToProviderB, type BProviderScript } from './providerClient.js';

/**
 * SYNTHETIC ADAPTER B — `mock_commerce`. TEST-ONLY.
 *
 * Serves the one class the verified class-3 catalogue routes to `mock_commerce`:
 * `fulfilment.reship`, IRRECOVERABLE. Its entry's `carries_vendor_monetary_field` is
 * `false`, so `mock_commerce` derives `NON_MONETARY` and is admissible under option A — and
 * its `value_direction` is `OUTBOUND_GOODS_TO_ADDRESS`, which is the case
 * `adapterRuntimeRegistry.ts`'s block comment uses to show why the broader reading of
 * ADR-024's trigger cannot be the intended one.
 *
 * BECAUSE IT IS IRRECOVERABLE, `25 §7`'s EM6 criterion applies to it: its descriptor must
 * declare at least one resolution primitive or `resolveAdapterFor` refuses before
 * invocation. The descriptor declares `QUERYABLE_MESSAGE_LOG`, which is a TEST FIXTURE
 * declaration exactly as `adapterPort.ts` says — `36 §7` requires such a claim to be
 * MEASURED against a vendor sandbox, and S1N measures nothing because there is no vendor.
 */

const ADAPTER_ID = 'mock_commerce';

function scriptFor(invocation: AdapterInvocation): BProviderScript {
  const declared = invocation.credential.version ?? 'ACCEPT';
  return isBProviderScript(declared) ? declared : 'ACCEPT';
}

export const integrationAdapter: IntegrationAdapter = {
  adapterId: ADAPTER_ID,

  async invoke(invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome> {
    const script = scriptFor(invocation);

    // The mark goes BEFORE the call. See `integrationAdapter.ts`'s `ProviderBoundary`.
    boundary.markProviderClientCrossed();

    // PERIMETER_AUTHORISED(authorisation_ref) — I24, 48 §4 item 2. `invocation` carries
    // `authorisationRef`, bound to this effect by the host before adapter code ran.
    const response = await sendToProviderB(
      {
        method: invocation.method,
        correlationTag: invocation.correlationTag,
        payloadBytes: invocation.dispatchPayloadBytes,
        secret: invocation.credential.secret,
      },
      script,
    );

    if (script === 'AMBIGUOUS') return { kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' };
    if (script === 'REJECT_NO_MUTATION') {
      return { kind: 'NOT_SENT_CONFIRMED', basis: 'PROVIDER_REJECTED_NO_MUTATION' };
    }
    if (!response.accepted) {
      return { kind: 'ADAPTER_FAILED', failureClass: 'PROVIDER_CLIENT_REJECTED' };
    }
    return {
      kind: 'ADAPTER_RETURNED',
      providerReference: response.reference,
      rawResponseHash: createHash('sha256').update(response.rawRecord, 'utf8').digest('hex'),
    };
  },
};
