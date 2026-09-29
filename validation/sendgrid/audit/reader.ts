import type {
  AuditProviderReader,
  ProviderReadQuery,
  ProviderReadResult,
} from '../../../src/audit/provider/runtime/auditProviderReader.js';
import { PROVIDER_READ_BOUNDARY } from '../../../src/audit/provider/runtime/auditProviderReader.js';
import type { AuditReadCredential } from '../../../src/audit/provider/runtime/auditSecretSource.js';
import { toProviderReadResult } from './activityRecords.js';
import {
  readFromProviderSendGridActivity,
  readFromProviderSendGridMessage,
} from './providerReadClient.js';

/**
 * THE SENDGRID Z4 AUDIT READER — `twilio_sendgrid`. READ-ONLY, BY CONSTRUCTION.
 *
 * =================================================================================
 * WHERE THIS RUNS, AND WHAT HAS ALREADY BEEN CHECKED BEFORE IT DOES
 *
 * This module is loaded by `src/audit/provider/runtime/main.ts`, inside the audit plane's own
 * `child_process.fork` — a process whose PID differs from the control process AND from the
 * integration runtime, whose environment is a nine-key constructed allowlist disjoint from
 * the integration plane's BY COMPUTATION, and whose credential comes from a source the
 * integration plane does not hold a locator for.
 *
 * By the time `readFromProvider` runs, the ACCEPTED audit host has already:
 *
 *   1. decoded the request against the closed read-only schema (unknown operation: REFUSED);
 *   2. checked the provider identity against this reader's own;
 *   3. checked this reader carries NO mutation member — fourteen names refused, plus any
 *      member outside the declared three;
 *   4. checked the signed class-5 risk class is `READ_ONLY`;
 *   5. resolved the credential from the AUDIT plane's own source;
 *   6. checked the labels are not the secret;
 *   7. compared the resolved material's identity to the signed `credential_id`, BEFORE this
 *      function is reached.
 *
 * **AND THE SIGNED RECORD IT ACTED ON WAS READ BY THE AUDIT PLANE'S OWN VERIFIER**, from its
 * own copy through its own deployment variables — never from the control plane's bundle.
 * `S1O-C3`: an audit reader admitted on the control plane's reading of the record that says
 * it is read-only is an audit plane trusting the plane it audits for its own independence.
 *
 * =================================================================================
 * IT CANNOT SEND, AND NOT BECAUSE IT CHOOSES NOT TO
 *
 * `isAuditProviderReader` admits an object with EXACTLY `providerId`, `boundary` and
 * `readFromProvider`, and refuses one carrying any of fourteen mutation member names. This
 * object has three members. `providerReadClient.ts` declares no `sendToProvider*` function
 * for it to call. The audit IPC wire has three operations and no `SEND`, no `CREATE`, no
 * `RAW` and no `PASSTHROUGH`.
 *
 * **THE `36 §13` ATTEMPTED-WRITE PROBE IS IN A DIFFERENT FILE THIS ONE DOES NOT IMPORT.**
 * `§8.2`: the negative control "must be an explicitly isolated validation/probe path that
 * cannot become a production audit capability."
 *
 * =================================================================================
 * AND IT DOES NOT TRUST THE CONTROL PLANE'S ACCOUNT OF THE SEND
 *
 * `§8.2`: "no reliance on integration/control-plane claims that 'SendGrid accepted it'".
 * `ProviderReadQuery` carries a period, an optional correlation tag, an optional provider
 * message id and a record bound. There is no member an ACOS outcome, an ACOS effect state or
 * a control-plane verdict could occupy, and `ProviderReadResponse` has no `verified`,
 * `matched` or `expected` member for one to travel back on.
 * =================================================================================
 */

const PROVIDER_ID = 'twilio_sendgrid';

export const auditProviderReader: AuditProviderReader = {
  providerId: PROVIDER_ID,
  boundary: PROVIDER_READ_BOUNDARY,

  async readFromProvider(
    credential: AuditReadCredential,
    query: ProviderReadQuery,
  ): Promise<ProviderReadResult> {
    if (query.operation === 'MESSAGE_ACTIVITY_DETAIL') {
      if (query.providerMessageId === null) {
        // The host's `OPERATION_ARGUMENTS_INVALID` covers this; the reader refuses again
        // rather than dereferencing, because a reader that relied on its host's validation
        // would be a reader whose safety lived in another module.
        return { kind: 'PROVIDER_UNAVAILABLE' };
      }
      // PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — 48 §2 row 13.
      const detail = await readFromProviderSendGridMessage({
        secret: credential.secret,
        providerMessageId: query.providerMessageId,
        expectedCorrelationTag: query.correlationTag,
      });
      return toProviderReadResult(detail, query.operation);
    }

    // PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — 48 §2 row 13. `MESSAGE_ACTIVITY_SEARCH`
    // and `MESSAGE_ACTIVITY_COUNT` reach the same documented endpoint; the COUNT operation
    // differs only in what the audit plane is told back, never in what is queried.
    const activity = await readFromProviderSendGridActivity({
      secret: credential.secret,
      query: {
        correlationTag: query.correlationTag,
        periodStartMs: query.periodStartMs,
        periodEndMs: query.periodEndMs,
        limit: query.maxRecords,
      },
    });
    return toProviderReadResult(activity, query.operation);
  },
};
