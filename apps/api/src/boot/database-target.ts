export interface DatabaseTarget {
  readonly host: string;
  readonly port: number;
}

const DEFAULT_POSTGRES_PORT = 5432;

/**
 * Extract only the host and port from a database connection string, for display on the boot
 * diagnostic page. Never returns the username, password, database name, or query parameters.
 */
export function parseDatabaseTarget(databaseUrl: string): DatabaseTarget {
  try {
    const url = new URL(databaseUrl);
    const port = url.port ? Number.parseInt(url.port, 10) : DEFAULT_POSTGRES_PORT;
    return { host: url.hostname || 'unknown', port: Number.isFinite(port) ? port : 0 };
  } catch {
    return { host: 'unknown', port: 0 };
  }
}
