import type { Recoverability } from '../../kernel/canonicalisation/actionClasses.js';
import type { WireOutcome } from '../protocol/wire.js';
import type { AdapterCredential } from './adapterSecretSource.js';

/**
 * THE INTEGRATION-SIDE ADAPTER CONTRACT — Z2, AND A DIFFERENT CONTRACT FROM THE PORT.
 *
 * =================================================================================
 * WHY THIS IS NOT `ExternalEffectAdapter`
 *
 * `adapterPort.ts` declares the CONTROL-SIDE port: what the Effect Gateway may hand across
 * its boundary, and what it may receive back. Every member of `DispatchEnvelope` is
 * something the kernel computed, and `dispatch` "receives no client, no credential, no
 * configuration and no callback into the kernel."
 *
 * THAT DESCRIPTION IS EXACTLY WRONG FOR A Z2 ADAPTER AFTER S1N, and deliberately so. An
 * integration-plane adapter DOES receive a credential — `23 §3`: "vendor credentials live
 * here and nowhere else" — resolved by its own runtime from its own deployment boundary and
 * never from the message. Reusing one interface for both sides would mean one of two things
 * and both are defects: either the control-side port grows a credential member (`I25`
 * violated at the type level), or the integration-side adapter cannot see its own credential
 * and has to reach around its own contract for it.
 *
 * So there are two contracts, they are named for their planes, and the method names differ
 * (`dispatch` on the control side, `invoke` here) so that the ACCEPTED static assertion —
 * "exactly ONE production file calls `.dispatch(` on an adapter" — stays true and unamended
 * with the Effect Gateway as that one file.
 * =================================================================================
 *
 * =================================================================================
 * AN ADAPTER IS STILL A TCB MEMBER, AND THIS IS STILL NOT A REAL ONE
 *
 * `49 §3.1` makes adapters TCB members and `29 §3.1` states why: "Each presents a vendor
 * credential whose scope exceeds the action classes it serves, and each writes facts the
 * policy engine trusts. There is no design in which they are not."
 *
 * S1N IMPLEMENTS NO ADAPTER. `§4` of the mandate forbids every provider it enumerates, and
 * THE NAMES ARE DELIBERATELY NOT REPEATED HERE: the ACCEPTED S1M tooling-boundary suite
 * asserts that no vendor name appears anywhere under `src/` in any case, and a comment
 * saying a vendor is absent is still that vendor's name in the tree. The list is in
 * `S1N-contract.md §4`. `§4` forbids any real provider HTTP and any vendor SDK, and there is
 * none anywhere under `src/`. The implementations that satisfy this interface in S1N are
 * SYNTHETIC and live under `tests/integration-plane/`, which is the same
 * "explicitly non-production test location" `§7` of the S1J mandate named for the
 * deterministic mock. `emptyAdapterRuntimeRegistry()` is what production actually holds.
 * =================================================================================
 */

/**
 * What one Z2 adapter is handed. THE VALIDATED REQUEST PLUS ITS OWN CREDENTIAL.
 *
 * Every member except `credential` is a field the host DECODED from the wire and then
 * CHECKED: the payload bytes hash to `dispatchPayloadHash`, the binding digest verifies over
 * the identity fields, the adapter identity equals the runtime's own, and the authorisation
 * reference is present. An adapter therefore never has to validate its own input, and — more
 * to the point — never has the opportunity to accept input the host refused.
 *
 * `credential` did not cross the wire. It was resolved by this runtime from this runtime's
 * own `AdapterSecretSource`, in this process, after the guards ran.
 */
export interface AdapterInvocation {
  readonly adapterId: string;
  readonly method: string;
  readonly actionClass: string;
  readonly recoverability: Recoverability;
  /** `I24`. Present by construction: the host refuses the request before building this. */
  readonly authorisationRef: string;
  readonly companyId: string;
  readonly effectId: string;
  readonly outboxId: string;
  readonly claimId: string;
  readonly idempotencyKey: string;
  readonly correlationTag: string;
  readonly resourceRef: string;
  readonly requiresUnmirroredTag: boolean;
  readonly overrideRef: string | null;
  readonly dispatchPayloadHash: string;
  /** The canonical payload, verbatim. `24 §3` K4: "with that payload **verbatim**". */
  readonly dispatchPayloadBytes: Buffer;
  /** Z2's own credential. `23 §3`. Never serialised, never logged, never returned. */
  readonly credential: AdapterCredential;
}

/**
 * `§31` — THE PROVIDER-CLIENT CALL BOUNDARY, AS A RECORDED FACT RATHER THAN A HOPE.
 *
 * =================================================================================
 * WHY THE ADAPTER MUST TELL THE HOST WHETHER IT CROSSED
 *
 * `25 §7.2`'s discriminating question is not "did the call succeed?" but "COULD THE WRITE
 * HAVE ESCAPED?", and after S1N there are TWO processes that have to agree on the answer.
 * The host cannot observe the adapter's control flow, so if the adapter threw, the host has
 * exactly one honest way to classify it: ask whether the provider-client boundary was
 * crossed before the throw.
 *
 * `markProviderClientCrossed` is that answer, and it is RECORDED BEFORE the provider call
 * rather than after it — a flag set afterwards would be unset in precisely the case it
 * exists for, which is a call that crossed and then died. `§41`: "after invocation
 * ambiguity -> OUTCOME_UNKNOWN."
 *
 * `createUnsafeLateMarkingAdapter` in the negative-control suite is the discriminating
 * control: an adapter whose fault falls BETWEEN its send and its mark, so the host sees
 * `crossed === false` for a request that was sent and classifies a possible escape as a
 * pre-send failure.
 * =================================================================================
 */
export interface ProviderBoundary {
  /** Call IMMEDIATELY BEFORE the provider client, never after it. */
  markProviderClientCrossed(): void;
}

/**
 * ONE TRUSTED Z2 ADAPTER.
 *
 * `invoke` returns a member of the closed wire taxonomy directly, so there is no per-adapter
 * mapping layer and no place for a vendor exception to be reinterpreted into an ACOS fact.
 * `36 §7` / `I26`: "A compromised adapter must produce a well-formed VENDOR RESPONSE, not a
 * well-formed ACOS FACT."
 *
 * An adapter that THROWS has told the host nothing, and the host classifies from
 * `ProviderBoundary` rather than from the exception: crossed becomes `OUTCOME_UNKNOWN`, not
 * crossed becomes `ADAPTER_FAILED / ADAPTER_THREW_PRE_SEND`. The exception's message never
 * crosses the boundary (`§23`).
 */
export interface IntegrationAdapter {
  readonly adapterId: string;
  invoke(invocation: AdapterInvocation, boundary: ProviderBoundary): Promise<WireOutcome>;
}

/**
 * What a loaded adapter module must export.
 *
 * ONE NAMED EXPORT, `integrationAdapter`, and not a default: a default export is whatever
 * the module happened to evaluate to, and the host refusing a module that does not name its
 * adapter is one more thing a mis-wired or substituted module cannot get past.
 */
export interface IntegrationAdapterModule {
  readonly integrationAdapter: IntegrationAdapter;
}

export function isIntegrationAdapterModule(value: unknown): value is IntegrationAdapterModule {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = (value as { integrationAdapter?: unknown }).integrationAdapter;
  if (typeof candidate !== 'object' || candidate === null) return false;
  const adapter = candidate as { adapterId?: unknown; invoke?: unknown };
  return typeof adapter.adapterId === 'string' && typeof adapter.invoke === 'function';
}
