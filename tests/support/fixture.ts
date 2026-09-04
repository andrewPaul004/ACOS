import { createPool, inTransaction, type Client, type Pool } from '../../src/db/pool.js';
import { up, down } from '../../src/db/migrate.js';
import { ensureWindowInstance } from '../../src/kernel/exposure/ledger.js';
import { instanceFor, type WindowPeriod } from '../../src/kernel/exposure/windowInstance.js';

/**
 * The S1A test fixture.
 *
 * Every window ceiling below is transcribed from `51-limits-fixture.md §2`, which the
 * package declares to be "the single copy of the authority limits fixture" and which is
 * a SIGNED NON-PRODUCTION fixture. It is loaded into a scratch database by tests.
 * Nothing in `src/` seeds it — `phase2-v1.3-implementation-brief.md §5` blocks seeding a
 * production ceiling on W_MONTH_ADSPEND pending TB-08(a), and S1A respects that by
 * having no seeding path at all outside test code.
 */

export const COMPANY_ID = 'co_s1a_fixture';
export const COMPANY_TZ = 'UTC';

/** `51 §2`, transcribed. UNBOUNDED is a declared member of the type, never a null. */
export interface WindowFixture {
  readonly windowId: string;
  readonly name: string;
  readonly period: WindowPeriod;
  readonly maxMonetary: string;
  readonly maxMonetaryUnbounded: boolean;
  readonly maxCount: string;
  readonly maxCountUnbounded: boolean;
  readonly maxIrrecoverableUnits: string;
  readonly maxIrrecoverableUnbounded: boolean;
}

const U = true;
const B = false;

export const WINDOWS: readonly WindowFixture[] = [
  // window_id                  name                        period    max_monetary  unb  max_count unb  max_irr unb
  w('W_DAY_REFUND',            'Daily refund',             'DAY',    '50.00',  B,  '2',   B,  '0', U),
  w('W_MONTH_REFUND',          'Monthly refund',           'MONTH',  '250.00', B,  '10',  B,  '0', U),
  w('W_DAY_CREDIT',            'Daily goodwill credit',    'DAY',    '12.50',  B,  '1',   B,  '0', U),
  w('W_MONTH_CREDIT',          'Monthly goodwill credit',  'MONTH',  '50.00',  B,  '4',   B,  '0', U),
  w('W_DAY_ADSPEND',           'Daily ad spend',           'DAY',    '12.00',  B,  '0',   U,  '0', U),
  w('W_MONTH_ADSPEND',         'Monthly ad spend',         'MONTH',  '186.00', B,  '0',   U,  '0', U),
  w('W_DAY_MIE',               'Daily MIE',                'DAY',    '0.00',   U,  '13',  B,  '13', B),
  w('W_MONTH_MIE',             'Monthly MIE',              'MONTH',  '0.00',   U,  '43',  B,  '43', B),
  w('W_MONTH_UNGATED',         'Monthly ungated count',    'MONTH',  '0.00',   U,  '200', B,  '0', U),
  w('W_LIABILITY_OUTSTANDING', 'Outstanding liability',    'BALANCE','200.00', B,  '0',   U,  '0', U),
  w('W_MONTH_REFUND_OVERRIDE', 'Refund override headroom', 'MONTH',  '0.00',   B,  '0',   B,  '0', U),
  w('W_MONTH_CREDIT_OVERRIDE', 'Credit override headroom', 'MONTH',  '0.00',   B,  '0',   B,  '0', U),
];

function w(
  windowId: string,
  name: string,
  period: WindowPeriod,
  maxMonetary: string,
  maxMonetaryUnbounded: boolean,
  maxCount: string,
  maxCountUnbounded: boolean,
  maxIrrecoverableUnits: string,
  maxIrrecoverableUnbounded: boolean,
): WindowFixture {
  return {
    windowId,
    name,
    period,
    maxMonetary,
    maxMonetaryUnbounded,
    maxCount,
    maxCountUnbounded,
    maxIrrecoverableUnits,
    maxIrrecoverableUnbounded,
  };
}

export function windowPeriod(windowId: string): WindowPeriod {
  const found = WINDOWS.find((x) => x.windowId === windowId);
  if (!found) throw new Error(`no fixture window ${windowId}`);
  return found.period;
}

/**
 * `51 §3.2`'s single rate grant, transcribed:
 *   campaign.budget.set | $6.00 / day | day | W_DAY_ADSPEND, W_MONTH_ADSPEND
 *   revocation_effect_class campaign.pause | adapter google_ads
 */
export const RATE_GRANT = {
  actionClass: 'campaign.budget.set',
  rateAmount: '6.00',
  rateCurrency: 'USD',
  ratePeriod: 'day',
  windows: ['W_DAY_ADSPEND', 'W_MONTH_ADSPEND'] as const,
  revocationEffectClass: 'campaign.pause',
  adapter: 'google_ads',
} as const;

export interface Harness {
  readonly pool: Pool;
  readonly url: string;
  connect(): Promise<Client>;
  /** Drop and rebuild the schema, then load the fixture. Every test starts here. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Bring the schema up from an EMPTY database and load the fixture.
 *
 * The repository quality gate requires that "migrations apply from an empty database"
 * and that they "can be torn down/recreated in test infrastructure". Doing it per test
 * file exercises the gate on every run rather than asserting it once.
 */
export async function createHarness(): Promise<Harness> {
  const url = process.env['ACOS_CONTROL_PG_URL'];
  if (!url) throw new Error('ACOS_CONTROL_PG_URL is not set; globalSetup did not run');
  const pool = createPool({ connectionString: url, max: 24, applicationName: 'acos-s1a-test' });

  const harness: Harness = {
    pool,
    url,
    async connect() {
      return pool.connect();
    },
    async reset() {
      const client = await pool.connect();
      try {
        await down(client);
        await up(client);
        await loadFixture(client);
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
  return harness;
}

export async function loadFixture(client: Client): Promise<void> {
  await client.query(
    `INSERT INTO company (company_id, name, timezone, created_at)
     VALUES ($1, 'S1A fixture company', $2, '2025-12-01T00:00:00Z')`,
    [COMPANY_ID, COMPANY_TZ],
  );
  await client.query(`INSERT INTO journal_counter (company_id) VALUES ($1)`, [COMPANY_ID]);

  for (const win of WINDOWS) {
    await client.query(
      `INSERT INTO window_registry (
         company_id, window_id, name, boundary_kind, period,
         max_monetary, max_monetary_unbounded,
         max_count, max_count_unbounded,
         max_irrecoverable_units, max_irrecoverable_unbounded)
       VALUES ($1, $2, $3, 'DISCRETE', $4, $5::NUMERIC, $6, $7::BIGINT, $8, $9::BIGINT, $10)`,
      [
        COMPANY_ID,
        win.windowId,
        win.name,
        win.period,
        win.maxMonetary,
        win.maxMonetaryUnbounded,
        win.maxCount,
        win.maxCountUnbounded,
        win.maxIrrecoverableUnits,
        win.maxIrrecoverableUnbounded,
      ],
    );
  }
}

/** Materialise the window_balance rows for the given windows at the given instant. */
export async function materialiseInstances(
  client: Client,
  at: Date,
  windowIds: readonly string[],
): Promise<void> {
  for (const windowId of windowIds) {
    const instance = instanceFor(windowId, windowPeriod(windowId), at, COMPANY_TZ);
    await ensureWindowInstance(client, COMPANY_ID, instance);
  }
}

export function instanceOf(windowId: string, at: Date) {
  return instanceFor(windowId, windowPeriod(windowId), at, COMPANY_TZ);
}

/** Convenience: run `fn` in one SERIALIZABLE transaction on a fresh client. */
export async function tx<T>(
  harness: Harness,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await harness.connect();
  try {
    return await inTransaction(client, 'SERIALIZABLE', fn);
  } finally {
    client.release();
  }
}
