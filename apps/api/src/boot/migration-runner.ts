import { spawn } from 'node:child_process';
import path from 'node:path';

export type Spawn = typeof spawn;

/**
 * Run `prisma migrate deploy` as a child process, forwarding its stdout so the exact CLI output
 * (`... migrations have been applied`, `No pending migrations to apply`, ...) continues to reach
 * container logs unchanged. On failure the collected stderr becomes the rejection's message so it
 * can still be classified as a database error.
 *
 * This used to run from the container entrypoint before the application started at all, which
 * meant an unreachable database crashed the container before it could ever serve a diagnostic
 * page. It now runs from inside the boot sequence, after the connection probe succeeds, so a
 * failure here re-enters the same diagnostic retry loop instead of crash-looping.
 */
export function runMigrations(apiRoot: string, spawnFn: Spawn = spawn): Promise<void> {
  const cliEntry = require.resolve('prisma/build/index.js');
  const schemaPath = path.join(apiRoot, 'prisma', 'schema.prisma');
  return new Promise((resolve, reject) => {
    const child = spawnFn(
      process.execPath,
      [cliEntry, 'migrate', 'deploy', '--schema', schemaPath],
      { stdio: ['ignore', 'inherit', 'pipe'] },
    );
    let stderr = '';
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `prisma migrate deploy exited with code ${code}`));
    });
  });
}
