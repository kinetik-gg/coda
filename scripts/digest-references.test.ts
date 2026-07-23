import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  countDigestReferences,
  digestReferenceFiles,
  propagateDigestReference,
} from './digest-references';

const placeholder = 'ghcr.io/kinetik-gg/coda@sha256:replace-with-release-manifest-digest';
const oldDigest = `ghcr.io/kinetik-gg/coda@sha256:${'1'.repeat(64)}`;
const reference = `ghcr.io/kinetik-gg/coda@sha256:${'a'.repeat(64)}`;

describe('release digest propagation', () => {
  it('rewrites the placeholder and an already-propagated digest', () => {
    expect(propagateDigestReference(`CODA_IMAGE=${placeholder}\n`, reference)).toEqual({
      content: `CODA_IMAGE=${reference}\n`,
      replaced: 1,
    });
    expect(propagateDigestReference(`CODA_IMAGE=${oldDigest}\n`, reference).content).toBe(
      `CODA_IMAGE=${reference}\n`,
    );
  });

  it('is idempotent and never touches mutable tags or abstract prose', () => {
    expect(propagateDigestReference(`CODA_IMAGE=${reference}\n`, reference).replaced).toBe(1);
    expect(countDigestReferences('image: ghcr.io/kinetik-gg/coda:latest')).toBe(0);
    expect(countDigestReferences('the ghcr.io/kinetik-gg/coda@sha256:... reference')).toBe(0);
  });

  it('targets the templated Coolify and app-only references in the repository', () => {
    const references = Object.fromEntries(
      digestReferenceFiles.map((file) => [
        file,
        countDigestReferences(readFileSync(resolve(process.cwd(), file), 'utf8')),
      ]),
    );
    expect(references['deploy/coolify/app.env.example']).toBe(1);
    expect(references['deploy/coolify/full.env.example']).toBe(1);
    expect(references['docs/operations.md']).toBeGreaterThanOrEqual(1);
    // The minimal app-only template intentionally omits CODA_IMAGE.
    expect(references['deploy/coda.app.env.example']).toBe(0);
  });

  it('is wired into the release workflow with minimal, scoped permissions', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(workflow).toContain('pnpm release:propagate-digest');
    expect(workflow).toContain('gh pr create');
    expect(workflow).toContain('pull-requests: write');
    // The immutable-digest guard must still run against the rewritten templates.
    expect(workflow).toContain('node deploy/coolify/validate.cjs');
  });
});
