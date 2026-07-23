import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDeploymentBundle, deploymentBundleFiles } from './deployment-bundle';

const temporaryDirectories: string[] = [];
const digest = `sha256:${'1'.repeat(64)}`;

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'coda-deployment-bundle-'));
  temporaryDirectories.push(directory);
  return directory;
}

function tarFiles(archive: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const path = header.subarray(0, 100).toString('utf8').replace(/\0.*$/u, '');
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/u, '').trim();
    const size = Number.parseInt(sizeText, 8);
    const contentOffset = offset + 512;
    files.set(path, archive.subarray(contentOffset, contentOffset + size));
    offset = contentOffset + Math.ceil(size / 512) * 512;
  }
  return files;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('deployment release bundle', () => {
  it('is deterministic and pins the exact manifest digest', () => {
    const first = temporaryDirectory();
    const second = temporaryDirectory();
    const options = {
      digest,
      image: 'ghcr.io/kinetik-gg/coda',
      repositoryRoot: process.cwd(),
      version: '0.0.2',
    };
    const one = buildDeploymentBundle({ ...options, outputDirectory: first });
    const two = buildDeploymentBundle({ ...options, outputDirectory: second });
    const firstArchive = readFileSync(one.archivePath);
    expect(firstArchive).toEqual(readFileSync(two.archivePath));
    const files = tarFiles(gunzipSync(firstArchive));
    const root = 'coda-deployment-v0.0.2/';
    for (const file of deploymentBundleFiles) expect(files.has(`${root}${file}`)).toBe(true);
    const env = files.get(`${root}.env.example`)?.toString('utf8');
    const coolifyAppEnv = files.get(`${root}deploy/coolify/app.env.example`)?.toString('utf8');
    const coolifyFullEnv = files.get(`${root}deploy/coolify/full.env.example`)?.toString('utf8');
    const coolifyDocumentation = files.get(`${root}docs/coolify.md`)?.toString('utf8');
    const readme = files.get(`${root}README.md`)?.toString('utf8');
    const release = files.get(`${root}RELEASE.md`)?.toString('utf8');
    expect(env).toContain(`CODA_IMAGE=ghcr.io/kinetik-gg/coda@${digest}`);
    expect(coolifyAppEnv).toContain(`CODA_IMAGE=ghcr.io/kinetik-gg/coda@${digest}`);
    expect(coolifyFullEnv).toContain(`CODA_IMAGE=ghcr.io/kinetik-gg/coda@${digest}`);
    expect(coolifyDocumentation).not.toContain('replace-with-release-manifest-digest');
    expect(release).toContain(`Immutable image: ghcr.io/kinetik-gg/coda@${digest}`);
    expect(readme).toContain('git clone --branch v0.0.2');
    for (const [path, content] of files) {
      expect(content.toString('utf8'), path).not.toMatch(
        /coda:latest|replace-with-release-manifest-digest/u,
      );
    }
    const expectedChecksum = createHash('sha256').update(firstArchive).digest('hex');
    expect(readFileSync(one.checksumPath, 'utf8')).toBe(
      `${expectedChecksum}  coda-deployment-v0.0.2.tar.gz\n`,
    );
  });

  it('rejects mutable or malformed release coordinates', () => {
    const base = {
      digest,
      image: 'ghcr.io/kinetik-gg/coda',
      outputDirectory: temporaryDirectory(),
      repositoryRoot: process.cwd(),
      version: '0.0.2',
    };
    expect(() => buildDeploymentBundle({ ...base, digest: 'sha256:latest' })).toThrow(
      'exact sha256',
    );
    expect(() =>
      buildDeploymentBundle({ ...base, image: 'ghcr.io/kinetik-gg/coda:latest' }),
    ).toThrow('canonical');
    expect(() => buildDeploymentBundle({ ...base, version: 'v0.0.2' })).toThrow('SemVer');
  });
});
