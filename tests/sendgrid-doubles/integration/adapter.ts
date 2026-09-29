import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

import type {
  AdapterInvocation,
  IntegrationAdapter,
  ProviderBoundary,
} from '../../../src/integration/runtime/integrationAdapter.js';
import type { WireOutcome } from '../../../src/integration/protocol/wire.js';
import { ENV_SECRET_LOCATOR } from '../../../src/integration/protocol/runtimeEnvironment.js';
import { buildSendGridSendRequest } from '../../../validation/sendgrid/integration/requestMapping.js';
import {
  SIGNED_ACTION_CLASS,
  SIGNED_METHOD,
  SIGNED_RECOVERABILITY,
  parseValidationEmailPayload,
} from '../../../validation/sendgrid/integration/validationPayload.js';
import { acceptSend } from '../simulatedAccount.js';

/**
 * TEST-ONLY. THE OFFLINE DOUBLE OF THE `sendgrid_email` ADAPTER.
 *
 * =================================================================================
 * IT IS THE REAL ADAPTER WITH THE TRANSPORT REPLACED, AND NOTHING ELSE REPLACED
 *
 * `§11` requires the scenario driver to be "fully exercised against deterministic offline
 * doubles". A double that accepted any payload and answered 202 would exercise the DRIVER and
 * prove nothing about the adapter the driver launches. So every check the corrected adapter
 * performs before its provider boundary is performed here, from the SAME production modules:
 *
 *   A. the invocation must name the SIGNED operation — `email.send`, `emailSend`,
 *      `IRRECOVERABLE`. The three constants are IMPORTED from the real adapter so this double
 *      cannot drift from it (correction 17).
 *   B. `invocation.dispatchPayloadBytes` is parsed by the production
 *      `parseValidationEmailPayload`, against the production CLOSED schema (correction 2).
 *   C. the request is built by the production `buildSendGridSendRequest`, from the parsed
 *      payload and from nothing else. **THIS MODULE READS NO SENDER AND NO SINK FROM ITS
 *      LAUNCH CONFIGURATION**, which is the property CONTROL 9 discriminates.
 *   D. only the kernel's correlation tag is added outside the payload.
 *
 * WHAT IS REPLACED: `sendToProviderSendGrid` becomes `acceptSend` against a file-backed
 * simulated account. There is no `fetch` in this module and no import of the real provider
 * client, so an offline run cannot reach `api.sendgrid.com` through it.
 *
 * =================================================================================
 * THE ACCOUNT PATH RIDES ON THE RUNTIME'S OWN LOCATOR DOCUMENT
 *
 * The integration child's environment is an eight-key constructed allowlist with no slot for a
 * simulator path, and widening the accepted allowlist so a TEST DOUBLE could be configured
 * would be the tail wagging the dog. So the path is a field of the document this runtime's own
 * locator already names — the same mechanism `killPointAdapter.ts` uses for its own arming
 * flag, and the same one `tests/integration-plane/adapterA/` uses for its provider script.
 * =================================================================================
 */

const ADAPTER_ID = 'sendgrid_email';

interface DoubleDocument {
  readonly simulatedAccountPath?: unknown;
  /** How many successful reads must pass before THIS adapter's message becomes visible. */
  readonly visibleAfterReads?: unknown;
}

function doubleConfiguration(): { readonly accountPath: string; readonly visibleAfterReads: number } {
  try {
    const document = JSON.parse(
      readFileSync(process.env[ENV_SECRET_LOCATOR] ?? '', 'utf8'),
    ) as DoubleDocument;
    return {
      accountPath:
        typeof document.simulatedAccountPath === 'string' ? document.simulatedAccountPath : '',
      visibleAfterReads:
        typeof document.visibleAfterReads === 'number' ? document.visibleAfterReads : 0,
    };
  } catch {
    return { accountPath: '', visibleAfterReads: 0 };
  }
}

const DOUBLE = doubleConfiguration();

export const integrationAdapter: IntegrationAdapter = {
  adapterId: ADAPTER_ID,

  async invoke(invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome> {
    const refusePreSend = (): WireOutcome => ({
      kind: 'ADAPTER_FAILED',
      failureClass: 'ADAPTER_THREW_PRE_SEND',
    });

    // A — CORRECTION 17. The signed operation, or nothing.
    if (invocation.actionClass !== SIGNED_ACTION_CLASS) return refusePreSend();
    if (invocation.method !== SIGNED_METHOD) return refusePreSend();
    if (invocation.recoverability !== SIGNED_RECOVERABILITY) return refusePreSend();

    // B — CORRECTION 2. The authorised bytes, parsed against the production closed schema.
    const parsed = parseValidationEmailPayload(invocation.dispatchPayloadBytes, {
      adapterId: ADAPTER_ID,
      method: SIGNED_METHOD,
      authorisationRef: invocation.authorisationRef,
    });
    if (parsed.kind === 'REFUSED') return refusePreSend();

    // C and D — the production mapping, from the parsed payload and the kernel's own tag.
    const mapped = buildSendGridSendRequest({
      authorised: parsed.payload,
      correlationTag: invocation.correlationTag,
      sandboxMode: false,
    });
    if (mapped.kind === 'REFUSED') return refusePreSend();

    if (DOUBLE.accountPath.length === 0) return refusePreSend();

    // THE MARK GOES BEFORE THE "CALL", exactly as it does in the real adapter: the offline
    // run must produce the same `mayHaveCrossedProviderBoundary` evidence the live one would.
    boundary.markProviderClientCrossed();

    const response = acceptSend(DOUBLE.accountPath, {
      /*
       * THE CATEGORIES THE **BODY** CARRIES, read back out of the constructed request.
       *
       * Not `invocation.correlationTag` directly: the point of reading the body is that the
       * simulated account echoes what the ADAPTER ACTUALLY SENT, so a mapping defect that
       * dropped the tag would show up as an unobservable message rather than as a passing run.
       */
      categories: mapped.body.categories,
      visibleAfterReads: DOUBLE.visibleAfterReads,
    });

    if (response.httpStatus === 202 && response.providerMessageId !== null) {
      return {
        kind: 'ADAPTER_RETURNED',
        providerReference: response.providerMessageId,
        rawResponseHash: createHash('sha256')
          .update(
            `sendgrid:202:${response.providerMessageId}:${invocation.correlationTag}`,
            'utf8',
          )
          .digest('hex'),
      };
    }
    // 200 is the account applying sandbox mode; 4xx is a provider rejection. Neither is an
    // acceptance and neither is `NOT_SENT_CONFIRMED` — the real adapter's taxonomy, kept.
    return { kind: 'ADAPTER_FAILED', failureClass: 'PROVIDER_CLIENT_REJECTED' };
  },
};
