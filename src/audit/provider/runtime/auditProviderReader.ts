import type {
  ProviderEvidenceRecord,
  ProviderReadOperation,
} from '../protocol/readWire.js';
import type { AuditReadCredential } from './auditSecretSource.js';

/**
 * `§16` — THE AUDIT-SIDE PROVIDER READER CONTRACT. THREE READS AND NO FOURTH METHOD.
 *
 * =================================================================================
 * WHAT `§16` FORBIDS, AND HOW A TYPE FORBIDS IT
 *
 *   "Permit only declared provider-read operations needed for audit/reconciliation. **No
 *    generic URL. No send operation.** No credential crosses IPC. Unknown operation:
 *    REFUSED."
 *
 * `AuditProviderReader` has exactly the members below. There is no `send`, no `post`, no
 * `write`, no `create`, no `request`, no `call` and no `invoke`, and there is no method
 * taking a URL, a path, a method verb, a header map or a body. **A reader object cannot
 * express a mutation**, so an audit reader that wanted to send would have to gain a member
 * — which is a change to this file, to `auditReadHost.ts`'s dispatch, and to the boundary
 * suite's hand-authored member list.
 *
 * `tests/negative-controls/unsafe-audit-read-boundary.ts` holds the discriminating control:
 * a reader object that DOES expose a send method, and the assertions that catch it.
 *
 * =================================================================================
 * `§31` OF S1N's MARK, CARRIED OVER: ONE CLEARLY MARKED PROVIDER BOUNDARY
 *
 * `48 §4` item 1 wants one vendor client per credential scope, and `tools/perimeter/`
 * recognises a SEND client by the `sendToProvider*` declaration shape. The audit plane's
 * counterpart is `readFromProvider*`, and `PROVIDER_READ_BOUNDARY` below is the mark a
 * reader implementation carries so the perimeter scan can enumerate a READ site and
 * classify it under `48 §2` row 13's read-only exemption rather than silently miss it.
 *
 * **A READ SITE IS STILL A PERIMETER SITE.** `48 §3.6` calls row 13 EXEMPT, and an
 * exemption is "a **named, annotated, reviewed** hole". An unenumerated read is not exempt;
 * it is unreviewed.
 * =================================================================================
 */

/** The mark an audit provider-read boundary carries. `48 §2` row 13, `48 §3.6`. */
export const PROVIDER_READ_BOUNDARY = 'ACOS_AUDIT_PROVIDER_READ_BOUNDARY' as const;

/** The arguments one read carries. A closed record, and no member is a destination. */
export interface ProviderReadQuery {
  readonly operation: ProviderReadOperation;
  /** `48`'s v1.3 note: PERIOD-BOUNDED, always, on every operation. */
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  /** Narrows a period-bounded result. Never replaces the period. */
  readonly correlationTag: string | null;
  /** The PROVIDER's own message id, for `MESSAGE_ACTIVITY_DETAIL` only. */
  readonly providerMessageId: string | null;
  readonly maxRecords: number;
}

/** What one read produced. A closed set; there is no exception with a message. */
export type ProviderReadResult =
  | {
      readonly kind: 'EVIDENCE';
      readonly records: readonly ProviderEvidenceRecord[];
      /** The provider's own total for the period, which may exceed `records.length`. */
      readonly recordCount: number;
    }
  /** The provider was reached and refused, or was not reached at all. */
  | { readonly kind: 'PROVIDER_UNAVAILABLE' };

/**
 * ONE PROVIDER'S READ BOUNDARY. THE ONLY THING IN THE AUDIT PLANE THAT TOUCHES A PROVIDER.
 *
 * `readFromProvider` takes the resolved credential as an ARGUMENT rather than holding it,
 * for the reason the integration adapter's `invoke` does: a client that held its credential
 * would keep it alive across reads, and `§17`'s leak matrix would then have a long-lived
 * heap reference to assert about instead of a call-scoped one.
 */
export interface AuditProviderReader {
  /** The ONE provider identity this reader serves. A wiring assertion, never a selector. */
  readonly providerId: string;
  /**
   * The mark. Present so `tools/perimeter/` and the packaging manifest can see a read
   * boundary that carries no `fetch` — which is every reader in this repository today,
   * because `§27` forbids a real provider call and there is no vendor HTTP anywhere.
   */
  readonly boundary: typeof PROVIDER_READ_BOUNDARY;
  readFromProvider(
    credential: AuditReadCredential,
    query: ProviderReadQuery,
  ): Promise<ProviderReadResult>;
}

/**
 * The closed member list, HAND-AUTHORED, so `auditReadHost.ts` can refuse a reader carrying
 * anything else at COMPOSITION rather than discovering it at the first read.
 *
 * `§16`: "No send operation." A reader that gained a `send` member would satisfy this
 * interface structurally — TypeScript's structural typing admits extra members — so the
 * shape is checked at runtime, against this list, before the reader is used.
 */
export const AUDIT_PROVIDER_READER_MEMBERS = [
  'providerId',
  'boundary',
  'readFromProvider',
] as const;

/** Every member name that would make a reader mutation-capable. Refused by name AND by list. */
export const FORBIDDEN_READER_MEMBERS = [
  'send',
  'sendToProvider',
  'post',
  'put',
  'patch',
  'delete',
  'write',
  'create',
  'update',
  'invoke',
  'dispatch',
  'request',
  'call',
  'execute',
  'fetch',
] as const;

/**
 * Whether a value is a reader this host will use.
 *
 * TWO CHECKS, AND BOTH ARE NEEDED. The member list closes the shape; the forbidden list
 * names the mutations explicitly so a failure message says WHICH capability was found rather
 * than "unexpected member". The second is redundant against the first today, and it is kept
 * because the first is the one a future refactor is likely to widen.
 */
export function isAuditProviderReader(value: unknown): value is AuditProviderReader {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.providerId !== 'string') return false;
  if (candidate.boundary !== PROVIDER_READ_BOUNDARY) return false;
  if (typeof candidate.readFromProvider !== 'function') return false;
  for (const member of FORBIDDEN_READER_MEMBERS) {
    if (member in candidate) return false;
  }
  const allowed = new Set<string>(AUDIT_PROVIDER_READER_MEMBERS);
  for (const key of Object.keys(candidate)) {
    if (!allowed.has(key)) return false;
  }
  return true;
}

/** What a reader module must export. A named export, so a default cannot smuggle a shape. */
export interface AuditProviderReaderModule {
  readonly auditProviderReader: AuditProviderReader;
}

export function isAuditProviderReaderModule(
  value: unknown,
): value is AuditProviderReaderModule {
  if (typeof value !== 'object' || value === null) return false;
  return isAuditProviderReader((value as { auditProviderReader?: unknown }).auditProviderReader);
}
