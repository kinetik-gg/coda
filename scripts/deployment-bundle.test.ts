import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { gunzipSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildDeploymentBundle,
  deploymentBundleFiles,
  deploymentOperatorFiles,
} from './deployment-bundle';

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

function extractArchive(archive: Buffer, directory: string): string {
  const root = resolve(directory);
  for (const [path, content] of tarFiles(gunzipSync(archive))) {
    const destination = resolve(root, path);
    if (!destination.startsWith(`${root}${sep}`)) throw new Error(`Unsafe archive path: ${path}`);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, content);
  }
  return join(root, 'coda-deployment-v0.0.2');
}

function runOperator(root: string, path: string, args: string[] = []): string {
  const result = spawnSync(process.execPath, [path, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('deployment release bundle', () => {
  it('is deterministic and pins the exact manifest digest', () => {
    const sourceOperations = readFileSync('docs/operations.md', 'utf8');
    expect(sourceOperations).toContain('pnpm deployment:validate');
    expect(sourceOperations).toContain('pnpm deployment:audit-runtime');
    expect(sourceOperations).toContain('pnpm exec tsx scripts/ops/coda-recovery.ts');

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
    for (const file of deploymentOperatorFiles) expect(files.has(`${root}${file}`)).toBe(true);
    for (const file of [
      'deploy/minio/compose.yaml',
      'deploy/minio/compose.local.yaml',
      'deploy/minio/minio.env.example',
      'deploy/coolify/compose.minio.yaml',
      'deploy/coolify/minio.env.example',
    ]) {
      expect(files.has(`${root}${file}`), file).toBe(true);
    }
    for (const file of [
      'deploy/coolify/templates/coda.yaml',
      'deploy/coolify/templates/coda-complete.yaml',
      'deploy/coolify/validate-templates.cjs',
    ]) {
      expect(files.has(`${root}${file}`), file).toBe(true);
    }
    const codaTemplate = files.get(`${root}deploy/coolify/templates/coda.yaml`)?.toString('utf8');
    const completeTemplate = files
      .get(`${root}deploy/coolify/templates/coda-complete.yaml`)
      ?.toString('utf8');
    // The readable version tag is promoted to the exact release version in the bundle.
    expect(codaTemplate).toContain("image: 'ghcr.io/kinetik-gg/coda:0.0.2'");
    expect(completeTemplate).toContain("image: 'ghcr.io/kinetik-gg/coda:0.0.2'");
    expect(codaTemplate).not.toContain('coda:0.0.4');
    expect(codaTemplate).toContain('SETUP_TOKEN=$SERVICE_PASSWORD_64_SETUPTOKEN');
    expect(codaTemplate).toContain('TRUSTED_PROXY_CIDRS=auto');
    expect(completeTemplate).toContain('$SERVICE_PASSWORD_POSTGRES');
    const minioStack = files.get(`${root}deploy/minio/compose.yaml`)?.toString('utf8');
    const minioEnv = files.get(`${root}deploy/minio/minio.env.example`)?.toString('utf8');
    expect(minioStack).toContain('minio-permissions');
    expect(minioStack).toContain('minio-init');
    expect(minioStack).not.toContain('CODA_IMAGE');
    expect(minioEnv).toContain('S3_BUCKET=');
    expect(minioEnv).not.toMatch(/^CODA_IMAGE=/mu);
    expect(minioEnv).not.toMatch(/^DATABASE_URL=/mu);
    const env = files.get(`${root}.env.example`)?.toString('utf8');
    const coolifyAppEnv = files.get(`${root}deploy/coolify/app.env.example`)?.toString('utf8');
    const coolifyFullEnv = files.get(`${root}deploy/coolify/full.env.example`)?.toString('utf8');
    const coolifyDocumentation = files.get(`${root}docs/coolify.md`)?.toString('utf8');
    const readme = files.get(`${root}README.md`)?.toString('utf8');
    const operations = files.get(`${root}docs/operations.md`)?.toString('utf8');
    const release = files.get(`${root}RELEASE.md`)?.toString('utf8');
    expect(env).toContain(`CODA_IMAGE=ghcr.io/kinetik-gg/coda@${digest}`);
    expect(coolifyAppEnv).toContain(`CODA_IMAGE=ghcr.io/kinetik-gg/coda@${digest}`);
    expect(coolifyFullEnv).toContain(`CODA_IMAGE=ghcr.io/kinetik-gg/coda@${digest}`);
    expect(coolifyDocumentation).not.toContain('replace-with-release-manifest-digest');
    expect(release).toContain(`Immutable image: ghcr.io/kinetik-gg/coda@${digest}`);
    expect(readme).toContain('git clone --branch v0.0.2');
    expect(operations).toContain('node operator/validate-deployment.js');
    expect(operations).toContain('node operator/audit-runtime.js');
    expect(operations).toContain('node operator/coda-recovery.js');
    expect(operations).not.toContain('pnpm deployment:');
    expect(operations).not.toContain('pnpm exec tsx scripts/ops/coda-recovery.ts');
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

  it('runs bundled operator utilities outside a source checkout', () => {
    const output = temporaryDirectory();
    const extraction = temporaryDirectory();
    const result = buildDeploymentBundle({
      digest,
      image: 'ghcr.io/kinetik-gg/coda',
      outputDirectory: output,
      repositoryRoot: process.cwd(),
      version: '0.0.2',
    });
    const root = extractArchive(readFileSync(result.archivePath), extraction);

    expect(runOperator(root, 'operator/validate-deployment.js', ['--help'])).toContain('Usage:');
    expect(runOperator(root, 'operator/audit-runtime.js', ['--help'])).toContain('Usage:');
    expect(runOperator(root, 'operator/coda-recovery.js', ['--help'])).toContain('Usage:');
    expect(runOperator(root, 'operator/validate-deployment.js')).toContain(
      'Validated Coolify adapters',
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
