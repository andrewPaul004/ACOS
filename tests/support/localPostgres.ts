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

export const CONTROL: ClusterSpec = { name: 'control', port: 55432, database: 'acos_control' };
export const AUDIT: ClusterSpec = { name: 'audit', port: 55433, database: 'acos_audit' };

export function urlFor(spec: ClusterSpec): string {
  return `postgres://${SUPERUSER}:${PASSWORD}@127.0.0.1:${spec.port}/${spec.database}`;
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
 * Create the cluster's database if it is absent, over a `pg` connection to the
 * maintenance database.
 *
 * Deliberately not `psql`/`createdb`: the CLI adds an argument-parsing surface with no
 * benefit here, and `pg` is already a dependency of the thing under test. An identifier
 * is interpolated rather than bound because PostgreSQL does not accept a parameter in
 * `CREATE DATABASE`; the name is a constant in this file, never external input, and it
 * is validated before use.
 */
async function ensureDatabase(spec: ClusterSpec): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(spec.database)) {
    throw new Error(`refusing to interpolate database name ${JSON.stringify(spec.database)}`);
  }
  const adminUrl = `postgres://${SUPERUSER}:${PASSWORD}@127.0.0.1:${spec.port}/postgres`;
  const { default: pg } = await import('pg');
  const client = new pg.Client({ connectionString: adminUrl, connectionTimeoutMillis: 15_000 });
  await client.connect();
  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [
      spec.database,
    ]);
    if (existing.rowCount === 0) {
      await client.query(`CREATE DATABASE ${spec.database}`);
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
    return {
      provider: 'external',
      controlUrl: externalControl,
      auditUrl: externalAudit,
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
    await ensureDatabase(spec);
  }

  const controlUrl = urlFor(CONTROL);
  return {
    provider: 'local',
    controlUrl,
    auditUrl: urlFor(AUDIT),
    serverVersion: await serverVersionOf(controlUrl),
  };
}

/** Remove the scratch clusters entirely. Used by `npm run db:down` in local mode. */
export function teardownLocal(): void {
  for (const spec of [CONTROL, AUDIT]) stopCluster(spec);
  rmSync(stateRoot(), { recursive: true, force: true });
}
