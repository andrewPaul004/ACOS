import {
  PROVIDER_READ_BOUNDARY,
  type AuditProviderReader,
  type ProviderReadQuery,
  type ProviderReadResult,
} from '../../../src/audit/provider/runtime/auditProviderReader.js';
import type { AuditReadCredential } from '../../../src/audit/provider/runtime/auditSecretSource.js';
import {
  isProviderReadScript,
  readFromProviderActivity,
  type ProviderReadScript,
} from './providerReadClient.js';

/**
 * READER A — THE SYNTHETIC Z4 AUDIT PROVIDER READER. TEST-ONLY.
 *
 * =================================================================================
 * WHAT IT IS AND WHAT IT CANNOT BE
 *
 * `§27`: no real provider request. So the provider this reader queries is
 * `providerReadClient.ts`'s in-process function, and the provider identity is
 * `synthetic_esp` — a name no vendor answers to, chosen so a real provider name never
 * appears in the audit plane's launch configuration.
 *
 * **THE OBJECT HAS EXACTLY THREE MEMBERS**, and that is enforced rather than observed:
 * `isAuditProviderReader` refuses a reader carrying any of `send`, `post`, `put`, `patch`,
 * `delete`, `write`, `create`, `update`, `invoke`, `dispatch`, `request`, `call`, `execute`
 * or `fetch`, and refuses any member outside the declared three. The refusal runs at
 * composition, before a credential is resolved, so a mutation-capable reader never sees
 * material.
 *
 * `tests/negative-controls/unsafe-audit-read-boundary.ts` holds the version that adds a
 * `send` member, and the discrimination is that the host refuses this one to start and
 * accepts nothing from it.
 *
 * =================================================================================
 * THE SCRIPT ARRIVES THROUGH THE CORRELATION TAG, AND NOT THROUGH THE PROTOCOL
 *
 * `§16`: "No generic URL." A reader whose behaviour could be selected by a protocol field
 * would be a reader whose protocol carried a control channel, so `ProviderReadRequest` has
 * no script member and none is added for testing.
 *
 * Instead the test encodes the script in the CORRELATION TAG it asks about — a value the
 * protocol already carries for its own reason — and this module reads it out. A real reader
 * would ignore it entirely. The same device `tests/integration-plane/adapterA/adapter.ts`
 * uses for its own scripts, for the same reason.
 */

const SCRIPT_PREFIX = 'script:';

function scriptFrom(query: ProviderReadQuery): ProviderReadScript {
  const tag = query.correlationTag ?? query.providerMessageId ?? '';
  const marker = tag.indexOf(SCRIPT_PREFIX);
  if (marker < 0) return 'ONE_MATCHING_RECORD';
  const candidate = tag.slice(marker + SCRIPT_PREFIX.length).split('|')[0] ?? '';
  return isProviderReadScript(candidate) ? candidate : 'ONE_MATCHING_RECORD';
}

class SyntheticAuditProviderReader implements AuditProviderReader {
  public readonly providerId = 'synthetic_esp';

  public readonly boundary = PROVIDER_READ_BOUNDARY;

  public async readFromProvider(
    credential: AuditReadCredential,
    query: ProviderReadQuery,
  ): Promise<ProviderReadResult> {
    /*
     * PERIMETER_EXEMPT(audit_plane_read_only, 48-3-6) — `48 §2` row 13.
     *
     * The ONE call site of this reader's provider-read boundary, annotated because `48 §3`
     * requires an exemption to be "a **named, annotated, reviewed** hole". The exemption is
     * read-only: `readFromProviderActivity` performs a query and has no branch that mutates
     * provider state. `36 §13`'s EMPIRICAL attempted-write test against a real provider
     * account remains separately owed and is NOT discharged by this annotation.
     */
    const response = await readFromProviderActivity(
      {
        operation: query.operation,
        periodStartMs: query.periodStartMs,
        periodEndMs: query.periodEndMs,
        correlationTag: query.correlationTag,
        providerMessageId: query.providerMessageId,
        maxRecords: query.maxRecords,
        // The credential is presented at the boundary and nowhere else. It is not stored on
        // this object, not logged, and not placed on the result.
        secret: credential.secret,
      },
      scriptFrom(query),
    );

    if (!response.reachable) return { kind: 'PROVIDER_UNAVAILABLE' };

    // `MESSAGE_ACTIVITY_COUNT` answers with the count alone. The narrowest read that answers
    // the question — `30 §5.10`'s scrub posture — so a sweep needing a total does not pull a
    // page of provider records to get one.
    if (query.operation === 'MESSAGE_ACTIVITY_COUNT') {
      return { kind: 'EVIDENCE', records: [], recordCount: response.recordCount };
    }

    return {
      kind: 'EVIDENCE',
      records: response.records.map((record) =>
        Object.freeze({
          providerMessageId: record.providerMessageId,
          providerStatus: record.providerStatus,
          providerTimestampMs: record.providerTimestampMs,
          correlationTag: record.correlationTag,
        }),
      ),
      recordCount: response.recordCount,
    };
  }
}

/** The named export `isAuditProviderReaderModule` requires. A default could smuggle a shape. */
export const auditProviderReader: AuditProviderReader = new SyntheticAuditProviderReader();
