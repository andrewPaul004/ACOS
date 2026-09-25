import { createHash } from 'node:crypto';

import type {
  AdapterInvocation,
  IntegrationAdapter,
  ProviderBoundary,
} from '../../../src/integration/runtime/integrationAdapter.js';
import type { WireOutcome } from '../../../src/integration/protocol/wire.js';
import { isProviderScript, sendToProvider, type ProviderScript } from './providerClient.js';

/**
 * SYNTHETIC ADAPTER A — `mock_ads`. TEST-ONLY.
 *
 * Serves the two classes the verified class-3 catalogue routes to `mock_ads`:
 * `campaign.pause` (REVERSIBLE) and `campaign.budget.set` (COMPENSABLE, rate-based).
 * Neither carries a vendor monetary field, which is why `mock_ads` derives `NON_MONETARY`
 * and is admissible under ADR-024's option A.
 *
 * =================================================================================
 * HOW A TEST SCRIPTS IT WITHOUT SENDING IT ANYTHING
 *
 * `§13` puts no control member on the wire, so the behaviour cannot be requested by the
 * control plane — and that is a property worth keeping rather than a nuisance to work
 * around. The script is read from the RUNTIME's own secret-source locator, which is launch
 * configuration: a test that wants a hanging provider launches a runtime configured for one.
 *
 * The consequence is exactly right for what the suite proves: one runtime behaves one way
 * for its whole life, the control plane cannot change it mid-flight, and nothing about the
 * outcome is attributable to anything the control plane said.
 * =================================================================================
 */

const ADAPTER_ID = 'mock_ads';

function scriptFor(invocation: AdapterInvocation): ProviderScript {
  // The script rides on the credential's non-secret `version` label, which the fixture
  // source sets from its locator. It is not derived from the secret and it is not a message
  // field — see the block comment above.
  const declared = invocation.credential.version ?? 'ACCEPT';
  return isProviderScript(declared) ? declared : 'ACCEPT';
}

export const integrationAdapter: IntegrationAdapter = {
  adapterId: ADAPTER_ID,

  async invoke(invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome> {
    const script = scriptFor(invocation);

    if (script === 'THROW_BEFORE_SEND') {
      // The boundary is NOT marked, so the host classifies this as ADAPTER_THREW_PRE_SEND.
      throw new Error('SYNTHETIC_PRE_SEND_FAULT');
    }
    if (script === 'EXIT_BEFORE_SEND') process.exit(9);

    /*
     * `§31` / `25 §7.2` — THE MARK GOES BEFORE THE CALL, NEVER AFTER IT.
     *
     * `integrationAdapter.ts` states the rule and the reason: a flag set after the provider
     * call is unset in exactly the case it exists for, which is a call that crossed and then
     * died. Everything above this line is provably pre-send; everything below it may have
     * escaped.
     */
    boundary.markProviderClientCrossed();

    let response;
    try {
      // PERIMETER_AUTHORISED(authorisation_ref) — I24, 48 §4 item 2. `invocation` carries
      // `authorisationRef`, which the integration host validated for PRESENCE and then for
      // BINDING to this exact effect before any line of this adapter ran.
      response = await sendToProvider(
        {
          method: invocation.method,
          correlationTag: invocation.correlationTag,
          idempotencyKey: invocation.idempotencyKey,
          payloadBytes: invocation.dispatchPayloadBytes,
          secret: invocation.credential.secret,
        },
        script,
      );
    } catch {
      // The boundary was crossed. `25 §7.2`: "Anything for which the request MAY have
      // escaped is OUTCOME_UNKNOWN." The exception is not read and its message never
      // crosses the process boundary (`§23`).
      return { kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' };
    }

    if (script === 'AMBIGUOUS') return { kind: 'OUTCOME_UNKNOWN', reason: 'AMBIGUOUS' };
    if (script === 'REJECT_NO_MUTATION') {
      /*
       * `25 §7.2`'s SECOND admissible basis, and the one a synthetic adapter can honestly
       * declare only because it IS the provider: "a provider rejection whose declared
       * adapter contract guarantees no external mutation occurred."
       *
       * A REAL adapter may not return this without a measured vendor contract — `36 §7`
       * requires the guarantee to be established against a sandbox, and S1N measures
       * nothing because there is no vendor. The synthetic provider's rejection path performs
       * no mutation because there is nothing to mutate, which is a property of the fixture
       * and is not evidence about any provider.
       */
      return { kind: 'NOT_SENT_CONFIRMED', basis: 'PROVIDER_REJECTED_NO_MUTATION' };
    }
    if (!response.accepted) return { kind: 'ADAPTER_FAILED', failureClass: 'PROVIDER_CLIENT_REJECTED' };

    /*
     * `§44` — THE RAW RECORD STAYS HERE. A DIGEST CROSSES.
     *
     * "Do not expose arbitrary raw provider response to worker/model. If current
     * architecture's R6 retention mechanism is not implemented yet: keep this bounded to
     * test type definitions and sanitized result evidence."
     *
     * `WireOutcome` has no member a body could occupy, so the bound is structural rather
     * than a decision this adapter makes. What crosses is a 64-character digest, which is
     * `I26`'s shape: "Every RECORD-grade fact resolves to a retained vendor response with a
     * matching content hash." The retention half of `I26` is not implemented anywhere in
     * this repository and is not claimed here.
     */
    return {
      kind: 'ADAPTER_RETURNED',
      providerReference: response.reference,
      rawResponseHash: createHash('sha256').update(response.rawRecord, 'utf8').digest('hex'),
    };
  },
};
