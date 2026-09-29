import { readFileSync } from 'node:fs';

import type {
  AuditProviderReader,
  ProviderReadQuery,
  ProviderReadResult,
} from '../../../src/audit/provider/runtime/auditProviderReader.js';
import { PROVIDER_READ_BOUNDARY } from '../../../src/audit/provider/runtime/auditProviderReader.js';
import type { AuditReadCredential } from '../../../src/audit/provider/runtime/auditSecretSource.js';
import { ENV_AUDIT_SECRET_LOCATOR } from '../../../src/audit/provider/protocol/readerEnvironment.js';
import {
  normaliseActivityRecords,
  toProviderReadResult,
  type SendGridReadResponse,
} from '../../../validation/sendgrid/audit/activityRecords.js';
import { serveRead } from '../simulatedAccount.js';

/**
 * TEST-ONLY. THE OFFLINE DOUBLE OF THE `twilio_sendgrid` AUDIT READER.
 *
 * =================================================================================
 * IT IS THE REAL READER WITH THE TRANSPORT REPLACED
 *
 * The two things this double must NOT simulate are the two things corrections 9 and 10 turn
 * on, so both are the production implementations, imported:
 *
 *   `normaliseActivityRecords`  echoes a correlation tag ONLY when the account actually
 *                               returned it, so the offline oracle's correlation is the
 *                               simulated provider's answer rather than the matcher's question.
 *   `toProviderReadResult`      maps a REFUSED or UNREADABLE answer to `PROVIDER_UNAVAILABLE`
 *                               and NEVER to `EVIDENCE` with zero records. A double that
 *                               mapped a 403 to an empty evidence set would hide exactly the
 *                               defect correction 9 closed.
 *
 * WHAT IS REPLACED: `readFromProviderSendGridActivity` becomes `serveRead` against the
 * file-backed account the integration double writes to. There is no `fetch` in this module.
 *
 * =================================================================================
 * AND IT STILL CANNOT SEND
 *
 * Three members — `providerId`, `boundary`, `readFromProvider` — because that is what the
 * ACCEPTED audit host's shape check admits, and it refuses any of fourteen mutation member
 * names. The double is subject to that check exactly as the real reader is: it is loaded by
 * `src/audit/provider/runtime/main.ts`, through the same host.
 * =================================================================================
 */

const PROVIDER_ID = 'twilio_sendgrid';

interface DoubleDocument {
  readonly simulatedAccountPath?: unknown;
}

function accountPath(): string {
  try {
    const document = JSON.parse(
      readFileSync(process.env[ENV_AUDIT_SECRET_LOCATOR] ?? '', 'utf8'),
    ) as DoubleDocument;
    return typeof document.simulatedAccountPath === 'string' ? document.simulatedAccountPath : '';
  } catch {
    return '';
  }
}

const ACCOUNT = accountPath();

/**
 * DEFECT 2.3, IN THE DOUBLE TOO.
 *
 * The double must not be a place where a malformed provider answer quietly becomes evidence,
 * because the offline scenario run is what proves the corrected mapping. It calls the SAME
 * production normaliser and applies the SAME rule the real client applies.
 */
function normalisedOrUnreadable(
  messages: readonly unknown[],
  correlationTag: string | null,
): SendGridReadResponse {
  const normalised = normaliseActivityRecords({ messages }, correlationTag);
  return normalised.kind === 'MALFORMED'
    ? { kind: 'UNREADABLE_RESPONSE', httpStatus: 200 }
    : { kind: 'ANSWERED', httpStatus: 200, records: normalised.records };
}

export const auditProviderReader: AuditProviderReader = {
  providerId: PROVIDER_ID,
  boundary: PROVIDER_READ_BOUNDARY,

  readFromProvider(
    _credential: AuditReadCredential,
    query: ProviderReadQuery,
  ): Promise<ProviderReadResult> {
    if (ACCOUNT.length === 0) return Promise.resolve({ kind: 'PROVIDER_UNAVAILABLE' });

    const served = serveRead(ACCOUNT, { correlationTag: query.correlationTag });
    const response: SendGridReadResponse =
      served.kind === 'REFUSED'
        ? { kind: 'REFUSED_BY_PROVIDER', httpStatus: served.httpStatus }
        : served.kind === 'UNREADABLE'
          ? { kind: 'UNREADABLE_RESPONSE', httpStatus: 200 }
          : normalisedOrUnreadable(served.messages, query.correlationTag);
    return Promise.resolve(toProviderReadResult(response, query.operation));
  },
};
