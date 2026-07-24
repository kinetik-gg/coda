/**
 * Classification for a failed boot-time database connection or migration attempt.
 *
 * The classifier never has access to credentials: it only ever sees the error object raised by a
 * TCP probe, the Prisma client, or the `prisma migrate deploy` CLI, and derives a class from
 * well-known Node system-error codes, Prisma error codes, and (as a last resort) safe substrings of
 * the error text. It must stay conservative — an unrecognized shape falls back to `unknown` rather
 * than guessing.
 */
export type DatabaseErrorClass =
  'dns' | 'connection-refused' | 'tls' | 'auth' | 'timeout' | 'unknown';

interface ClassifiableError {
  code?: string;
  errorCode?: string;
  message?: string;
}

const DNS_CODES = new Set(['ENOTFOUND', 'EAI_AGAIN']);
const TIMEOUT_CODES = new Set(['ETIMEDOUT', 'ESOCKETTIMEDOUT']);
const PRISMA_AUTH_CODES = new Set(['P1000']);
const PRISMA_TLS_CODES = new Set(['P1011']);
const PRISMA_TIMEOUT_CODES = new Set(['P1002', 'P1008']);

function asClassifiable(error: unknown): ClassifiableError {
  return typeof error === 'object' && error !== null ? (error as ClassifiableError) : {};
}

function classifyByCode(err: ClassifiableError): DatabaseErrorClass | undefined {
  if (err.code && DNS_CODES.has(err.code)) return 'dns';
  if (err.code === 'ECONNREFUSED') return 'connection-refused';
  if (err.code && TIMEOUT_CODES.has(err.code)) return 'timeout';
  if (err.errorCode && PRISMA_AUTH_CODES.has(err.errorCode)) return 'auth';
  if (err.errorCode && PRISMA_TLS_CODES.has(err.errorCode)) return 'tls';
  if (err.errorCode && PRISMA_TIMEOUT_CODES.has(err.errorCode)) return 'timeout';
  return undefined;
}

function classifyByMessage(message: string): DatabaseErrorClass {
  if (
    /p1000|password authentication failed|authentication failed|invalid credentials/.test(message)
  )
    return 'auth';
  if (/p1011|self[- ]signed certificate|certificate|tls|ssl/.test(message)) return 'tls';
  if (/p1002|p1008|timed out|timeout/.test(message)) return 'timeout';
  if (/econnrefused|connection refused/.test(message)) return 'connection-refused';
  if (/enotfound|eai_again|getaddrinfo|dns/.test(message)) return 'dns';
  return 'unknown';
}

/** Classify a boot-time database failure without ever inspecting or echoing credentials. */
export function classifyDatabaseError(error: unknown): DatabaseErrorClass {
  const err = asClassifiable(error);
  const byCode = classifyByCode(err);
  if (byCode) return byCode;
  const message = typeof err.message === 'string' ? err.message.toLowerCase() : '';
  return classifyByMessage(message);
}

const LABELS: Record<DatabaseErrorClass, string> = {
  dns: 'DNS resolution failed',
  'connection-refused': 'Connection refused',
  tls: 'TLS/SSL negotiation failed',
  auth: 'Authentication failed',
  timeout: 'Connection timed out',
  unknown: 'Database connection failed',
};

export function labelForErrorClass(errorClass: DatabaseErrorClass): string {
  return LABELS[errorClass];
}

const HINTS: Record<DatabaseErrorClass, readonly string[]> = {
  dns: [
    'Check the hostname in DATABASE_URL for typos and confirm it resolves from inside the container network.',
    'Managed providers often expose a different hostname for internal vs. public connections; use the one reachable from this deployment.',
  ],
  'connection-refused': [
    'Confirm the database is running and listening on the configured port.',
    'Check firewall rules, security groups, and that the database allows connections from this host.',
  ],
  tls: [
    'Managed Postgres providers usually require `sslmode=require` (or `sslaccept=strict`) in DATABASE_URL.',
    'If the provider supplies a private CA certificate, mount it read-only and reference it with Prisma-supported certificate parameters instead of disabling verification.',
  ],
  auth: [
    'Verify the username and password in DATABASE_URL, including percent-encoding for reserved characters.',
    'Confirm the database user has been granted access to the target database and schema.',
  ],
  timeout: [
    'The database may be reachable but overloaded or rate-limiting new connections; check connection pool limits on the provider.',
    'Check network latency or an intermediate proxy dropping long-lived connections.',
  ],
  unknown: [
    'Check the container logs for the full error and consult the database provider status page.',
    'Verify DATABASE_URL matches the provider-documented connection string format.',
  ],
};

export function hintsForErrorClass(errorClass: DatabaseErrorClass): readonly string[] {
  return HINTS[errorClass];
}
