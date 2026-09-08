import type { SignalWire } from './corroborationSignal.js';

/**
 * `30 §5.7.1` — THE FETCH PORT. THE CONTROL PLANE PULLS; NOTHING IS PUSHED TO IT.
 *
 * =================================================================================
 * `30 §5.7.1`, Endpoint and Transport, verbatim:
 *
 *   | **Endpoint** | The audit plane's own read endpoint on its own host (`§5` *Own read
 *   |              | path*, the same host that serves V7): `GET /audit/v1/mirror-input-
 *   |              | stall?company_id=…`. It is a **read** endpoint; **the audit plane never
 *   |              | pushes and never initiates a connection to the control plane**.
 *   | **Transport**| HTTPS, control plane → audit plane, pull only. The control plane
 *   |              | authenticates with a read-only bearer credential scoped to this
 *   |              | endpoint and to V7. **The audit plane accepts no writes on this path**,
 *   |              | so the fetch opens no new suppression channel and `58 §13` condition 2
 *   |              | is not engaged.
 * =================================================================================
 *
 * ---------------------------------------------------------------------------------
 * WHY THE PORT HAS THREE OUTCOMES AND NOT TWO
 *
 * "No signal" and "could not reach the audit plane" are DIFFERENT FACTS with the SAME
 * AUTHORITY CONSEQUENCE, and collapsing them into `null` would make the distinction
 * unrecordable. `30 §5.6`'s reachability table is built entirely out of that distinction:
 *
 *   | Network partition between the planes | Yes | Yes | **No** — the fetch path is the
 *   |                                      |     |     | severed path | **No.** Stays
 *   |                                      |     |     | `UNCORROBORATED_STALL`
 *   | Audit store down                     | No  | No  | — | **No**
 *   | Audit-plane host down                | No  | No  | — | **No**
 *   | Push path degraded, read path healthy| Yes | Yes | Yes | **Yes**
 *
 * `30 §5.7`: "An audit-plane observation the control plane cannot fetch does not unlock the
 * state; **that is the fail-closed direction** and `§5.6`'s reachability table is its cost."
 *
 * So `UNAVAILABLE` and `NONE` both resolve to no corroboration — the state remains or
 * reverts to `UNCORROBORATED_STALL` — and there is NO code path anywhere in this slice that
 * turns an unavailable fetch into a held signal. `signal-transport-fail-closed.test.ts`
 * proves it against a genuinely unreachable audit server.
 * ---------------------------------------------------------------------------------
 *
 * ---------------------------------------------------------------------------------
 * THE CONTROL PLANE HAS NO WRITE PATH INTO THE SIGNAL STORE, AND THAT IS A GRANT.
 *
 * This interface declares one method and it is a read. The concrete implementation
 * (`src/replication/corroborationFetch.ts`) connects as `acos_audit_signal_reader`, which
 * `A0002` grants SELECT on the two signal tables and nothing else — no INSERT, no UPDATE,
 * no DELETE, no access to `audit_journal`, `audit_incident` or the quota ledger.
 * `audit-signal-ownership.test.ts` attempts each forbidden operation as that real role
 * against real PostgreSQL.
 * ---------------------------------------------------------------------------------
 */

export type SignalFetch =
  /** A signal was returned. It is NOT yet verified — `verifyCorroborationSignal` does that. */
  | { readonly kind: 'SIGNAL'; readonly signal: SignalWire }
  /**
   * The audit plane answered and holds no current signal. `30 §5.7.1`, Issuance: "No signal
   * is issued when no stall condition holds."
   */
  | { readonly kind: 'NONE' }
  /**
   * The fetch failed. Partition, audit store down, audit host down, credential refused.
   * `30 §5.6`: `CORROBORATED_DEGRADED` is UNREACHABLE in each of those cases.
   */
  | { readonly kind: 'UNAVAILABLE'; readonly detail: string };

export interface CorroborationSignalSource {
  /**
   * `GET /audit/v1/mirror-input-stall?company_id=…`, as the repository harness can realise
   * it. Must never throw: an exception escaping here would let a caller's `catch` decide
   * what an unreachable audit plane means, and `§5.7`'s fail-closed direction is not a
   * caller's decision.
   */
  fetchCurrent(companyId: string): Promise<SignalFetch>;
}
