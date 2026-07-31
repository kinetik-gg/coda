import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import {
  diffBranchProtection,
  formatDrift,
  type LiveBranchProtection,
  type RequiredChecksManifest,
} from './required-checks';

/**
 * Runner for the required-check drift gate (issue #273). All comparison logic
 * lives in `required-checks.ts`; this file only owns fetching the live branch
 * protection state and reporting the result.
 *
 * This is deliberately **not** wired into `pnpm quality` or the required CI
 * checks: reading branch protection requires admin permission on the
 * repository, which a contributor's fork, an untrusted pull request, or the
 * default `GITHUB_TOKEN` does not have. Run it by hand — or from a scheduled
 * workflow authenticated with an admin-scoped token — whenever branch
 * protection may have changed:
 *
 *   pnpm ci:check-required-checks
 *
 * It only reads GitHub's branch protection API; it never calls an endpoint
 * that could change it.
 */
const MANIFEST_PATH = '.github/branch-protection.main.json';
const REPO = 'kinetik-gg/coda';

async function readManifest(): Promise<RequiredChecksManifest> {
  const raw = await readFile(MANIFEST_PATH, 'utf8');
  return JSON.parse(raw) as RequiredChecksManifest;
}

function fetchLiveProtection(branch: string): LiveBranchProtection {
  const raw = execFileSync('gh', ['api', `repos/${REPO}/branches/${branch}/protection`], {
    encoding: 'utf8',
  });
  return JSON.parse(raw) as LiveBranchProtection;
}

async function main(): Promise<void> {
  const manifest = await readManifest();
  const live = fetchLiveProtection(manifest.branch);
  const drift = diffBranchProtection(manifest, live);

  if (drift.length > 0) {
    console.error(
      `${MANIFEST_PATH} no longer matches the live branch protection for "${manifest.branch}". ` +
        'Update the manifest to match (this script never writes to GitHub):\n' +
        formatDrift(drift),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-required-checks: ${MANIFEST_PATH} matches the live branch protection for "${manifest.branch}".`,
  );
}

main().catch((error: unknown) => {
  console.error(
    'Unable to check required-check drift. This needs `gh` authenticated with admin permission ' +
      `on ${REPO} (reading branch protection requires it).`,
    error,
  );
  process.exitCode = 1;
});
