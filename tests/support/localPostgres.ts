import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Bring up REAL PostgreSQL for the test suite.
 *
 * The S1A mandate: "Use real PostgreSQL for tests. Do NOT emulate ACOS concurrency
 * behavior with SQLite." Everything below runs the PostgreSQL project's own server
 * binaries. Nothing here emulates, shims or stubs a lock, an isolation level or a
 * trigger.
 *
 * Two providers, selected by ACOS_PG_PROVIDER:
 *
 *   external  — a server is already listening at ACOS_CONTROL_PG_URL. Used by CI and by
 *               `npm run db:up` (docker-compose.yml).
 *   local     — start a cluster from PostgreSQL binaries on this machine, in a scratch
 *               data directory outside the repository. This is the fallback for a
 *               developer machine with no working container runtime; it is the SAME
 *               PostgreSQL, started by pg_ctl instead of by a container supervisor.
 *
 * The default is `external` if the URL is reachable and `local` otherwise, so a working
 * Docker environment is always preferred and the fallback never silently displaces it.
 */

export interface ClusterSpec {
  readonly name: string;
  readonly port: number;
  readonly database: string;
}

const SUPERUSER = 'acos';
const PASSWORD = 'acos_local_dev';
/** The database `CREATE DATABASE` is issued from. Never itself created. */
const MAINTENANCE_DATABASE = 'postgres';

export const CONTROL: ClusterSpec = { name: 'control', port: 55432, database: 'acos_control' };
export const AUDIT: ClusterSpec = { name: 'audit', port: 55433, database: 'acos_audit' };

/**
 * DBOS's SYSTEM database — S1A-H1.
 *
 * Candidate A of the durable-execution spike keeps workflow status and step outputs in a
 * database that is NOT the application database. `docker compose up` creates
 * `acos_control` and `acos_audit` and nothing else, so before this repair the spike
 * derived a URL naming a database that had never been created and five candidate-A tests
 * failed with `3D000: database "acos_dbos_sys" does not exist`. The original S1A run was
 * only green because the database had been created by hand.
 *
 * It is provisioned here, on the audit SERVER, because that server is a convenient second
 * physical PostgreSQL and for no other reason. It is NOT the architecture's audit plane
 * (`phase2-v1.3-implementation-brief.md §4`), and `docker-compose.yml` says so.
 */
export const DBOS_SYSTEM_DATABASE = 'acos_dbos_sys';

/**
 * Every database name this harness is permitted to create.
 *
 * PostgreSQL does not accept a parameter in `CREATE DATABASE`, so the name is
 * interpolated. This set is the reason that is safe: a name reaching `ensureDatabase` is
 * checked against these static, in-repository constants before it is ever interpolated,
 * so a name arriving from an environment variable — including one carrying a URL a
 * developer edited — cannot become DDL.
 */
const TRUSTED_DATABASES: ReadonlySet<string> = new Set([
  CONTROL.database,
  AUDIT.database,
  DBOS_SYSTEM_DATABASE,
]);

export function urlFor(spec: ClusterSpec): string {
  return `postgres://${SUPERUSER}:${PASSWORD}@127.0.0.1:${spec.port}/${spec.database}`;
}

/**
 * Rewrite a PostgreSQL URL to name a different database on the SAME server, preserving
 * host, port, credentials and query parameters.
 *
 * Used for two things: deriving the DBOS system URL from the configured audit URL, and
 * deriving the maintenance (`postgres`) URL that `CREATE DATABASE` has to be issued from.
 * Both providers go through this one function, so the external/Docker path and the local
 * PostgreSQL-binary path cannot disagree about where the system database lives.
 */
export function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

/** The DBOS system database URL, on the same server as the given audit URL. */
export function dbosSystemUrlFor(auditUrl: string): string {
  return withDatabase(auditUrl, DBOS_SYSTEM_DATABASE);
}

/**
 * Provision the DBOS system database — S1A-H1's actual repair.
 *
 * Idempotent, and exported so the regression test can assert both that it is idempotent
 * and that the prerequisite it establishes is really present. Called by `provision()`
 * on BOTH providers.
 */
export async function ensureDbosSystemDatabase(auditUrl: string): Promise<string> {
  await ensureDatabase(auditUrl, DBOS_SYSTEM_DATABASE);
  return dbosSystemUrlFor(auditUrl);
}

function binRoot(): string {
  const configured = process.env['ACOS_PG_BIN'];
  if (configured) return configured;
  const local = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
  return join(local, 'acos-s1a', 'pgsql', 'bin');
}

function exe(name: string): string {
  const suffix = process.platform === 'win32' ? '.exe' : '';
  return join(binRoot(), `${name}${suffix}`);
}

export function localBinariesAvailable(): boolean {
  return existsSync(exe('pg_ctl')) && existsSync(exe('initdb'));
}

function stateRoot(): string {
  return process.env['ACOS_PG_STATE'] ?? join(tmpdir(), 'acos-s1a-pg');
}

function dataDir(spec: ClusterSpec): string {
  return join(stateRoot(), spec.name, 'data');
}

function logFile(spec: ClusterSpec): string {
  return join(stateRoot(), spec.name, 'server.log');
}

function run(command: string, args: readonly string[], label: string): void {
  const result = spawnSync(command, [...args], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) {
    throw new Error(
      `${label} failed (exit ${String(result.status)})\n` +
        `stdout: ${result.stdout ?? ''}\nstderr: ${result.stderr ?? ''}`,
    );
  }
}

/**
 * Run a command whose child will outlive it and inherit its stdio.
 *
 * `pg_ctl start` spawns the postgres postmaster, which keeps the inherited stdio handles
 * open for the life of the server. A piped spawnSync therefore waits forever for pipes
 * that will never close, even though pg_ctl itself exited seconds earlier. stdio is
 * discarded here for that reason; the server's own output goes to `-l logfile`.
 */
function runDetachedParent(command: string, args: readonly string[], label: string): void {
  const result = spawnSync(command, [...args], { stdio: 'ignore', windowsHide: true });
  if (result.error) {
    throw new Error(`${label} failed to launch: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed (exit ${String(result.status)}); see the server log`);
  }
}

export async function isReachable(url: string, timeoutMs = 2_000): Promise<boolean> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: timeoutMs });
  try {
    await client.connect();
    await client.query('SELECT 1');
    return true;
  } catch {
    return false;
  } finally {
    try {
      await client.end();
    } catch {
      /* already closed */
    }
  }
}

function initCluster(spec: ClusterSpec): void {
  const dir = dataDir(spec);
  if (existsSync(join(dir, 'PG_VERSION'))) return;

  mkdirSync(dir, { recursive: true });
  const pwFile = join(stateRoot(), spec.name, 'superuser.pw');
  writeFileSync(pwFile, PASSWORD, 'utf8');

  run(
    exe('initdb'),
    [
      '-D', dir,
      '-U', SUPERUSER,
      '--pwfile', pwFile,
      '-A', 'scram-sha-256',
      '-E', 'UTF8',
      '--locale=C',
    ],
    `initdb (${spec.name})`,
  );
  rmSync(pwFile, { force: true });

  // The same server settings docker-compose.yml declares, and for the same reasons:
  // targeted interleaving needs a transaction to be able to sit at a barrier longer
  // than a default deadlock check would tolerate, and needs lock waits to be visible.
  // fsync is off because this cluster is disposable test infrastructure.
  writeFileSync(
    join(dir, 'postgresql.auto.conf'),
    [
      `port = ${String(spec.port)}`,
      `listen_addresses = '127.0.0.1'`,
      `unix_socket_directories = ''`,
      `deadlock_timeout = '200ms'`,
      `log_lock_waits = on`,
      `max_connections = 100`,
      `timezone = 'UTC'`,
      `log_timezone = 'UTC'`,
      `fsync = off`,
      `synchronous_commit = off`,
      `full_page_writes = off`,
      '',
    ].join('\n'),
    'utf8',
  );
}

function startCluster(spec: ClusterSpec): void {
  const dir = dataDir(spec);
  const status = spawnSync(exe('pg_ctl'), ['-D', dir, 'status'], {
    encoding: 'utf8',
    windowsHide: true,
  });
  if (status.status === 0) return; // already running

  runDetachedParent(
    exe('pg_ctl'),
    ['-D', dir, '-l', logFile(spec), '-w', '-t', '60', 'start'],
    `pg_ctl start (${spec.name})`,
  );
}

/**
 * Create `database` on the server `serverUrl` addresses, if it is absent.
 *
 * Deliberately not `psql`/`createdb`: the CLI adds an argument-parsing surface with no
 * benefit here, and `pg` is already a dependency of the thing under test. An identifier
 * is interpolated rather than bound because PostgreSQL does not accept a parameter in
 * `CREATE DATABASE`. The name is therefore checked twice before it reaches the statement:
 * it must be a member of TRUSTED_DATABASES — a static set of in-repository constants —
 * and it must match a conservative identifier pattern. A name arriving from an
 * environment variable cannot satisfy the first check unless it is already one of ours.
 *
 * `serverUrl` supplies only host, port and credentials; the database it names is
 * replaced with the maintenance database. That is what makes this generic across the
 * Docker/external provider (where the URL comes from the environment) and the local
 * PostgreSQL-binary provider (where this file builds it).
 */
export async function ensureDatabase(serverUrl: string, database: string): Promise<void> {
  if (!TRUSTED_DATABASES.has(database)) {
    throw new Error(
      `refusing to CREATE DATABASE ${JSON.stringify(database)}: not a trusted S1A ` +
        `database name. Permitted: ${[...TRUSTED_DATABASES].join(', ')}.`,
    );
  }
  if (!/^[a-z_][a-z0-9_]*$/.test(database)) {
    throw new Error(`refusing to interpolate database name ${JSON.stringify(database)}`);
  }

  const adminUrl = withDatabase(serverUrl, MAINTENANCE_DATABASE);
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 15_000 });
  try {
    await client.connect();
  } catch (error) {
    const redacted = adminUrl.replace(/:[^:@]*@/, ':***@');
    throw new Error(
      `cannot reach the PostgreSQL server at ${redacted} to provision "${database}". ` +
        `Start the documented environment with \`npm run db:up\`.\n` +
        `  cause: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      database,
    ]);
    if (existing.rowCount === 0) {
      try {
        await client.query(`CREATE DATABASE ${database}`);
      } catch (error) {
        // 42P04 duplicate_database — another process created it between the check and
        // the statement. The postcondition this function promises is "it exists", and it
        // does.
        const code = (error as { code?: string } | null)?.code;
        if (code !== '42P04') throw error;
      }
    }
  } finally {
    await client.end();
  }
}

export function stopCluster(spec: ClusterSpec): void {
  const dir = dataDir(spec);
  if (!existsSync(join(dir, 'PG_VERSION'))) return;
  spawnSync(exe('pg_ctl'), ['-D', dir, '-m', 'immediate', '-w', '-t', '30', 'stop'], {
    encoding: 'utf8',
    windowsHide: true,
  });
}

export interface ProvisionResult {
  readonly provider: 'external' | 'local';
  readonly controlUrl: string;
  readonly auditUrl: string;
  /**
   * The DBOS SYSTEM database URL — S1A-H1.
   *
   * Returned EXPLICITLY rather than left to the consumer to derive. The original defect
   * was exactly that division of labour: the spike derived
   * `ACOS_DBOS_SYS_PG_URL` from the audit URL by string substitution, so it depended on
   * a database that provisioning did not know existed and had never created. The
   * infrastructure that creates it is now the thing that names it.
   */
  readonly dbosSystemUrl: string;
  readonly serverVersion: string;
}

async function serverVersionOf(url: string): Promise<string> {
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const result = await client.query<{ server_version: string }>('SHOW server_version');
    return result.rows[0]?.server_version ?? 'unknown';
  } finally {
    await client.end();
  }
}

export async function provision(): Promise<ProvisionResult> {
  const requested = process.env['ACOS_PG_PROVIDER'];
  const externalControl = process.env['ACOS_CONTROL_PG_URL'] ?? urlFor(CONTROL);
  const externalAudit = process.env['ACOS_AUDIT_PG_URL'] ?? urlFor(AUDIT);

  if (requested !== 'local' && (await isReachable(externalControl))) {
    // S1A-H1. `docker compose up` creates acos_control and acos_audit. It does NOT create
    // the DBOS system database, and candidate A of the spike cannot start without it.
    // Provisioning it here is what makes `db:down; db:up; npm test` reproducible from a
    // clean environment with no manual SQL.
    await ensureDbosSystemDatabase(externalAudit);
    return {
      provider: 'external',
      controlUrl: externalControl,
      auditUrl: externalAudit,
      dbosSystemUrl: dbosSystemUrlFor(externalAudit),
      serverVersion: await serverVersionOf(externalControl),
    };
  }

  if (requested === 'external') {
    throw new Error(
      `ACOS_PG_PROVIDER=external but ${externalControl} is not reachable. ` +
        `Start it with \`npm run db:up\`.`,
    );
  }

  if (!localBinariesAvailable()) {
    throw new Error(
      [
        'No PostgreSQL is available.',
        '',
        '  1. Preferred: start the documented environment with `npm run db:up`',
        '     (docker-compose.yml).',
        '  2. Fallback: place PostgreSQL binaries where ACOS_PG_BIN points, or at',
        `     ${binRoot()}.`,
        '',
        'The S1A test suite requires real PostgreSQL. It will not run against anything',
        'else, and there is no in-memory substitute.',
      ].join('\n'),
    );
  }

  for (const spec of [CONTROL, AUDIT]) {
    initCluster(spec);
    startCluster(spec);
    await ensureDatabase(urlFor(spec), spec.database);
  }

  // S1A-H1, on the local-binary provider too. The same helper, the same server, the same
  // guarantee: no candidate-A test ever connects to a database that does not exist.
  const auditUrl = urlFor(AUDIT);
  await ensureDbosSystemDatabase(auditUrl);

  const controlUrl = urlFor(CONTROL);
  return {
    provider: 'local',
    controlUrl,
    auditUrl,
    dbosSystemUrl: dbosSystemUrlFor(auditUrl),
    serverVersion: await serverVersionOf(controlUrl),
  };
}

/** Remove the scratch clusters entirely. Used by `npm run db:down` in local mode. */
export function teardownLocal(): void {
  for (const spec of [CONTROL, AUDIT]) stopCluster(spec);
  rmSync(stateRoot(), { recursive: true, force: true });
}
