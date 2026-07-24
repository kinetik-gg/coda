import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Read the API package version stamped into a backup manifest. Defaults to the API package root
 * resolved relative to the compiled module location so it works both in `dist` and under tests.
 */
export function readApiVersion(apiRoot = join(__dirname, '..', '..')): string {
  try {
    const raw = readFileSync(join(apiRoot, 'package.json'), 'utf8');
    return (JSON.parse(raw) as { version?: string }).version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

/** Extract the database name from a connection URL for the manifest's creation context. */
export function databaseNameFromUrl(databaseUrl: string): string {
  try {
    return decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//u, '')) || 'postgres';
  } catch {
    return 'postgres';
  }
}
