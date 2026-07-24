import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Resolves to apps/api/package.json from both the TS source tree (src/updates/) and the
// compiled dist layout (dist/updates/), since both sit two directories below apps/api.
const packageManifestPath = join(__dirname, '../../package.json');

let cachedVersion: string | undefined;

/** The SemVer version of the running API build, sourced from the package manifest. */
export function runningVersion(): string {
  if (cachedVersion === undefined) {
    const manifest = JSON.parse(readFileSync(packageManifestPath, 'utf8')) as {
      version?: string;
    };
    cachedVersion = manifest.version ?? '0.0.0';
  }
  return cachedVersion;
}
