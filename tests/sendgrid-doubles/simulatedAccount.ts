import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

/**
 * TEST-ONLY. A DETERMINISTIC, FILE-BACKED SIMULATION OF ONE SENDGRID ACCOUNT'S EMAIL ACTIVITY.
 *
 * =================================================================================
 * WHY A FILE RATHER THAN AN IN-PROCESS DOUBLE
 *
 * The property the S1P scenario driver has to exercise is a CROSS-PROCESS one: the integration
 * runtime accepts a message in one forked child, and the audit reader observes it in a
 * DIFFERENT forked child whose environment allowlist is disjoint from the first's. An
 * in-process double could not be shared between them without the two planes sharing a module,
 * which is exactly the composition `§14` of the S1O mandate forbids and which
 * `tests/sendgrid/prerequisites-and-separation.test.ts` asserts is absent.
 *
 * A file is the smallest thing two isolated processes can both reach, and reaching it is a
 * filesystem write rather than a network call — so **nothing in this module is a perimeter
 * site**, `tools/perimeter/` does not scan this root, and no offline run can reach
 * `api.sendgrid.com` through it.
 *
 * =================================================================================
 * WHAT IT SIMULATES, AND WHAT IT DELIBERATELY DOES NOT
 *
 * IT SIMULATES: acceptance with a provider-minted message id, `categories` echo, an Email
 * Activity search narrowed by category and period, a SCRIPTED read refusal (the documented
 * 403), and a SCRIPTED visibility LAG so a late second message can be made to appear only
 * after the first observation.
 *
 * IT DOES NOT SIMULATE: provider idempotency. `35 §12.3` is explicit that "a mock with a naive
 * idempotency implementation passes while the vendor would not", so this account accepts every
 * send it is given and mints a NEW id each time. If ACOS dispatches twice, the account holds
 * two messages and the oracle sees two — which is the only way an offline run can demonstrate
 * that the oracle would catch a real duplicate.
 * =================================================================================
 */

/** One accepted message, as the simulated Email Activity feed holds it. */
export interface SimulatedMessage {
  readonly msg_id: string;
  readonly status: string;
  readonly last_event_time: string;
  readonly categories: readonly string[];
  /**
   * How many SUCCESSFUL reads must occur before this message becomes visible.
   *
   * `0` is the ordinary case. A positive value is the DELAYED-DUPLICATE script: the second
   * message of a pair stays invisible until the oracle has already observed the first, which
   * is precisely the condition the stop-on-first loop could not detect.
   */
  readonly visibleAfterReads: number;
}

/** How the account answers a read. Scripted, so a refusal is a test input rather than luck. */
export type SimulatedReadBehaviour =
  | { readonly kind: 'OK' }
  /** The documented "this key lacks Email Activity permission" answer. */
  | { readonly kind: 'REFUSE'; readonly httpStatus: number }
  /** The provider answered with a body this client cannot read. */
  | { readonly kind: 'UNREADABLE' }
  /** Refuse for the FIRST `n` reads, then answer normally. */
  | { readonly kind: 'REFUSE_THEN_OK'; readonly httpStatus: number; readonly refusals: number };

export interface SimulatedAccountState {
  readonly messages: readonly SimulatedMessage[];
  readonly readBehaviour: SimulatedReadBehaviour;
  /** How many reads have been served. Persisted, because the readers are separate processes. */
  readonly readsServed: number;
  /** Whether the account applies sandbox mode to every send. `§8.6`'s configuration defect. */
  readonly sandboxAppliedByAccount: boolean;
  /** Whether the send credential is accepted at all. `false` models a provider rejection. */
  readonly sendAccepted: boolean;
}

export const EMPTY_ACCOUNT: SimulatedAccountState = Object.freeze({
  messages: Object.freeze([]),
  readBehaviour: Object.freeze({ kind: 'OK' as const }),
  readsServed: 0,
  sandboxAppliedByAccount: false,
  sendAccepted: true,
});

export function writeAccount(path: string, state: SimulatedAccountState): void {
  writeFileSync(path, JSON.stringify(state), 'utf8');
}

export function readAccount(path: string): SimulatedAccountState {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as SimulatedAccountState;
  } catch {
    return EMPTY_ACCOUNT;
  }
}

/** What the simulated `POST /v3/mail/send` answered. */
export interface SimulatedSendResponse {
  readonly httpStatus: number;
  readonly providerMessageId: string | null;
}

/**
 * Accept one send. A NEW id every time — see this module's header on idempotency.
 *
 * The category list is the request's own, so the reader's echo behaviour is the account's
 * answer rather than the matcher's question, exactly as the real normaliser requires.
 */
export function acceptSend(
  path: string,
  input: { readonly categories: readonly string[]; readonly visibleAfterReads?: number },
): SimulatedSendResponse {
  const state = readAccount(path);
  if (!state.sendAccepted) return { httpStatus: 400, providerMessageId: null };
  if (state.sandboxAppliedByAccount) {
    // S1O's capability record: a sandbox send is validated, never delivered, and generates NO
    // Email Activity event. So the account records NOTHING and answers 200 rather than 202.
    return { httpStatus: 200, providerMessageId: null };
  }
  const message: SimulatedMessage = {
    msg_id: `sim.${randomUUID().replace(/-/g, '')}`,
    status: 'delivered',
    last_event_time: new Date().toISOString(),
    categories: [...input.categories],
    visibleAfterReads: input.visibleAfterReads ?? 0,
  };
  writeAccount(path, { ...state, messages: [...state.messages, message] });
  return { httpStatus: 202, providerMessageId: message.msg_id };
}

/** What the simulated `GET /v3/messages` answered. */
export type SimulatedReadResponse =
  | { readonly kind: 'OK'; readonly messages: readonly SimulatedMessage[] }
  | { readonly kind: 'REFUSED'; readonly httpStatus: number }
  | { readonly kind: 'UNREADABLE' };

/**
 * Serve one Email Activity read, narrowed by category, and advance the account's read counter.
 *
 * The counter is what makes `visibleAfterReads` a DETERMINISTIC visibility lag: the Nth
 * successful read is the first that can see a message scripted to appear after N-1.
 */
export function serveRead(
  path: string,
  input: { readonly correlationTag: string | null },
): SimulatedReadResponse {
  const state = readAccount(path);
  const behaviour = state.readBehaviour;

  if (behaviour.kind === 'REFUSE') return { kind: 'REFUSED', httpStatus: behaviour.httpStatus };
  if (behaviour.kind === 'UNREADABLE') return { kind: 'UNREADABLE' };
  if (behaviour.kind === 'REFUSE_THEN_OK' && state.readsServed < behaviour.refusals) {
    writeAccount(path, { ...state, readsServed: state.readsServed + 1 });
    return { kind: 'REFUSED', httpStatus: behaviour.httpStatus };
  }

  const served = state.readsServed + 1;
  writeAccount(path, { ...state, readsServed: served });
  const visible = state.messages.filter((message) => served > message.visibleAfterReads);
  const matching =
    input.correlationTag === null
      ? visible
      : visible.filter((message) => message.categories.includes(input.correlationTag!));
  return { kind: 'OK', messages: matching };
}
