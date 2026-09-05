import type { Client } from '../../db/pool.js';
import { fromDb, type Money } from '../exposure/money.js';
import type { ResolvedResource } from '../canonicalisation/types.js';
import type { AuthoritativeResourceState, ResourceResolution } from './port.js';

/**
 * The authoritative commerce state reader for `refund.create`.
 *
 * `24 §3` K4, on the Effect Canonicaliser, verbatim: it "fetches the authoritative state
 * itself, under the existing entity advisory lock (`25 §14`)". This module is the "fetches
 * the authoritative state itself" half; `entityLease.ts` is the lock, and every function
 * here takes the lease's own client so the read happens on the connection that holds it.
 *
 * There is no vendor here. No Shopify, no Stripe, no HTTP, no SDK. The tables are real
 * PostgreSQL (`0005__commerce_state.sql`) and the S1C contract records their shape as an
 * implementation fixture (S1C-C1), because the architecture names the DIMENSIONS a refund
 * enumeration reads and prints no DDL.
 *
 * ---------------------------------------------------------------------------------
 * NOTHING HERE IS REACHABLE FROM `ProposedIntent`
 *
 * `24 §3` K4, on what AI may not do, verbatim: "Supply an exposure figure, a vendor
 * parameter, a monetary value, a counterparty, a value_direction, a recoverability class,
 * or any field of the dispatched request."
 *
 * The only model-supplied value that reaches this module is `resource_ref`, one of `I21`'s
 * four permitted fields, and it is used to LOOK UP a row — never to populate one. Amount,
 * instrument, parent transaction, refundable remaining, fee, currency and customer novelty
 * are all read from these tables.
 * ---------------------------------------------------------------------------------
 */

interface OrderRow {
  order_id: string;
  resource_ref: string;
  grade: string;
  currency: string;
  customer_novelty: string;
}

function isGrade(value: string): value is ResolvedResource['grade'] {
  return (
    value === 'RECORD' ||
    value === 'OBSERVATION' ||
    value === 'CLAIM' ||
    value === 'DECISION_DELEGATED'
  );
}

/**
 * Resolve `resource_ref` to a RECORD-grade order, or say why not.
 *
 * `26 §2.0.1`, the resource-scope row: "`resource_ref` must resolve to a RECORD-grade
 * entity inside the task's `context_spec` scope, the same rule `propose_intent` applies."
 *
 * The `context_spec` scope check happens in the enumeration CORE, before this is called, so
 * a `resource_ref` the task may not see never becomes a database query.
 */
export async function resolveOrderResource(
  client: Client,
  companyId: string,
  resourceRef: string,
): Promise<ResourceResolution> {
  const result = await client.query<OrderRow>(
    `SELECT order_id, resource_ref, grade, currency, customer_novelty
       FROM commerce_order
      WHERE company_id = $1 AND resource_ref = $2`,
    [companyId, resourceRef],
  );
  const row = result.rows[0];
  if (!row) return { ok: false, failure: 'RESOURCE_ABSENT' };

  if (!isGrade(row.grade) || row.grade !== 'RECORD') {
    // `26 §8`: `resource.grade == "RECORD"`. A CLAIM-grade order is a customer's ACCOUNT of
    // an order, and `24 §2` is emphatic that a claim is not a record. The two branches are
    // merged because they produce the same external behaviour and the same audit class.
    return { ok: false, failure: 'RESOURCE_NOT_RECORD_GRADE' };
  }
  if (row.customer_novelty !== 'NEW' && row.customer_novelty !== 'RETURNING') {
    // The CHECK constraint forbids this, so reaching it means the schema and this module
    // disagree. Fail closed rather than widening the type at the read.
    throw new Error(
      `commerce_order ${row.order_id} carries an undeclared customer_novelty ${row.customer_novelty}`,
    );
  }

  return {
    ok: true,
    state: {
      resource: {
        resourceRef: row.resource_ref,
        resourceId: row.order_id,
        grade: 'RECORD',
      },
      ledgerCurrency: row.currency,
      customerNovelty: row.customer_novelty,
    },
  };
}

/** Dimension 1 of `26 §8`'s two-dimensional refund enumeration. */
export interface AuthoritativeOrderLine {
  readonly lineId: string;
  /** `26 §8`: `context.selected_option.line_refundable_remaining`. CURRENT POLICY STATE. */
  readonly refundableRemaining: Money;
}

/** Dimension 2. `26 §8`: "`instrument` is enumerated, not asserted". */
export interface AuthoritativeParentTransaction {
  readonly parentTransactionId: string;
  readonly instrument: string;
  readonly refundableRemaining: Money;
}

/** S1B-C3a, made real: an AMOUNT and the record it came from. Never a rate. */
export interface AuthoritativeRetainedFeeRecord {
  readonly lineId: string;
  readonly parentTransactionId: string;
  readonly amount: Money;
  readonly currency: string;
  readonly sourceRef: string;
}

/**
 * Everything the refund enumerator reads, from one consistent read.
 *
 * All three reads run on the same client — the lease's — inside whatever transaction the
 * caller established, so they observe one snapshot. Splitting them across connections would
 * let the line set and the transaction set come from different instants, and a refund
 * enumerated across two instants is the CAN-03 shape at a smaller scale.
 */
export interface AuthoritativeRefundState {
  readonly resourceState: AuthoritativeResourceState;
  readonly lines: readonly AuthoritativeOrderLine[];
  readonly parentTransactions: readonly AuthoritativeParentTransaction[];
  readonly retainedFees: readonly AuthoritativeRetainedFeeRecord[];
}

export async function readRefundState(
  client: Client,
  companyId: string,
  resourceState: AuthoritativeResourceState,
): Promise<AuthoritativeRefundState> {
  const orderId = resourceState.resource.resourceId;

  // ORDER BY exists so the returned list is DETERMINISTIC, and for no other reason.
  // Position is never identity: `26 §2.0.1` addresses an option by
  // H(action_class ‖ resource_id ‖ semantic_option_digest), and the production selector has
  // no integer field in which an index could be expressed.
  const lines = await client.query<{ line_id: string; refundable_remaining: string }>(
    `SELECT line_id, refundable_remaining
       FROM commerce_order_line
      WHERE company_id = $1 AND order_id = $2
      ORDER BY line_id`,
    [companyId, orderId],
  );

  const transactions = await client.query<{
    parent_transaction_id: string;
    instrument: string;
    refundable_remaining: string;
  }>(
    `SELECT parent_transaction_id, instrument, refundable_remaining
       FROM commerce_parent_transaction
      WHERE company_id = $1 AND order_id = $2
      ORDER BY parent_transaction_id`,
    [companyId, orderId],
  );

  const fees = await client.query<{
    line_id: string;
    parent_transaction_id: string;
    amount: string;
    currency: string;
    source_ref: string;
  }>(
    `SELECT line_id, parent_transaction_id, amount, currency, source_ref
       FROM commerce_refund_retained_fee
      WHERE company_id = $1 AND order_id = $2
      ORDER BY line_id, parent_transaction_id`,
    [companyId, orderId],
  );

  return {
    resourceState,
    lines: lines.rows.map((row) => ({
      lineId: row.line_id,
      refundableRemaining: fromDb(row.refundable_remaining),
    })),
    parentTransactions: transactions.rows.map((row) => ({
      parentTransactionId: row.parent_transaction_id,
      instrument: row.instrument,
      refundableRemaining: fromDb(row.refundable_remaining),
    })),
    retainedFees: fees.rows.map((row) => ({
      lineId: row.line_id,
      parentTransactionId: row.parent_transaction_id,
      amount: fromDb(row.amount),
      currency: row.currency,
      sourceRef: row.source_ref,
    })),
  };
}
