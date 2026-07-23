import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/u;
const IMAGE_PATTERN = /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;
const PLACEHOLDER_REFERENCES = [
  /ghcr\.io\/kinetik-gg\/coda@sha256:replace-with-release-manifest-digest/gu,
  /ghcr\.io\/kinetik-gg\/coda@sha256:\.\.\./gu,
  /name@sha256:\.\.\./gu,
];

export const deploymentBundleFiles = [
  '.env.example',
  'CHANGELOG.md',
  'LICENSE',
  'README.md',
  'compose.app.local.yaml',
  'compose.app.yaml',
  'compose.local.yaml',
  'compose.yaml',
  'deploy/coda.app.env.example',
  'deploy/coolify/app.env.example',
  'deploy/coolify/compose.app.yaml',
  'deploy/coolify/compose.full.yaml',
  'deploy/coolify/full.env.example',
  'docs/coolify.md',
  'docs/operations.md',
] as const;

export interface DeploymentBundleOptions {
  digest: string;
  image: string;
  outputDirectory: string;
  repositoryRoot: string;
  version: string;
}

interface BundleEntry {
  content: Buffer;
  path: string;
}

function sha256(content: Buffer | string): string {
  return createHash('sha256').update(content).digest('hex');
}

function assertReleaseInput(options: DeploymentBundleOptions): void {
  if (!VERSION_PATTERN.test(options.version)) throw new Error('Version must be SemVer without v');
  if (!IMAGE_PATTERN.test(options.image)) throw new Error('Image name is not canonical');
  if (!DIGEST_PATTERN.test(options.digest)) throw new Error('Digest must be an exact sha256');
}

function injectReleaseCoordinates(content: string, reference: string, version: string): string {
  let transformed = content;
  for (const placeholder of PLACEHOLDER_REFERENCES) {
    transformed = transformed.replace(placeholder, reference);
  }
  return transformed.replace(
    /git clone --branch v\d+\.\d+\.\d+/gu,
    `git clone --branch v${version}`,
  );
}

function readBundleEntries(options: DeploymentBundleOptions): BundleEntry[] {
  const reference = `${options.image}@${options.digest}`;
  const root = `coda-deployment-v${options.version}`;
  const entries = deploymentBundleFiles.map((path) => {
    const content = injectReleaseCoordinates(
      readFileSync(resolve(options.repositoryRoot, path), 'utf8'),
      reference,
      options.version,
    );
    if (/coda:latest|replace-with-release-manifest-digest/u.test(content)) {
      throw new Error(`Mutable or unresolved image reference in ${path}`);
    }
    return { content: Buffer.from(content, 'utf8'), path: `${root}/${path}` };
  });
  const release = Buffer.from(
    [
      `Coda deployment bundle v${options.version}`,
      '',
      `Immutable image: ${reference}`,
      '',
      'This bundle contains the canonical Compose topologies, their explicit localhost overlays, and the platform deployment adapters.',
      'Database migrations are forward operations; restore a verified backup to roll back across migrations.',
      '',
    ].join('\n'),
    'utf8',
  );
  entries.push({ content: release, path: `${root}/RELEASE.md` });
  const manifest = [...entries]
    .sort((left, right) => left.path.localeCompare(right.path))
    .map(({ content, path }) => `${sha256(content)}  ${path.slice(root.length + 1)}`)
    .join('\n');
  entries.push({ content: Buffer.from(`${manifest}\n`, 'utf8'), path: `${root}/MANIFEST.sha256` });
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function writeOctal(header: Buffer, value: number, offset: number, length: number): void {
  const encoded = `${value.toString(8).padStart(length - 1, '0')}\0`;
  header.write(encoded, offset, length, 'ascii');
}

function tarHeader(path: string, size: number): Buffer {
  if (Buffer.byteLength(path, 'utf8') > 100) throw new Error(`Bundle path is too long: ${path}`);
  const header = Buffer.alloc(512);
  header.write(path, 0, 100, 'utf8');
  writeOctal(header, 0o644, 100, 8);
  writeOctal(header, 0, 108, 8);
  writeOctal(header, 0, 116, 8);
  writeOctal(header, size, 124, 12);
  writeOctal(header, 0, 136, 12);
  header.fill(0x20, 148, 156);
  header.write('0', 156, 1, 'ascii');
  header.write('ustar\0', 257, 6, 'ascii');
  header.write('00', 263, 2, 'ascii');
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  header.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
  return header;
}

export function createDeterministicTar(entries: BundleEntry[]): Buffer {
  const chunks: Buffer[] = [];
  for (const entry of entries) {
    chunks.push(tarHeader(entry.path, entry.content.length), entry.content);
    const padding = (512 - (entry.content.length % 512)) % 512;
    if (padding > 0) chunks.push(Buffer.alloc(padding));
  }
  chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

export function buildDeploymentBundle(options: DeploymentBundleOptions): {
  archivePath: string;
  checksumPath: string;
  reference: string;
} {
  assertReleaseInput(options);
  const outputDirectory = resolve(options.outputDirectory);
  const archiveName = `coda-deployment-v${options.version}.tar.gz`;
  const checksumName = `coda-deployment-v${options.version}.sha256`;
  if (existsSync(outputDirectory) && readdirSync(outputDirectory).length > 0) {
    throw new Error('Bundle output directory must be empty');
  }
  mkdirSync(outputDirectory, { recursive: true });
  const archive = gzipSync(createDeterministicTar(readBundleEntries(options)), { level: 9 });
  archive[9] = 255;
  const archivePath = join(outputDirectory, archiveName);
  const checksumPath = join(outputDirectory, checksumName);
  writeFileSync(archivePath, archive);
  writeFileSync(checksumPath, `${sha256(archive)}  ${basename(archivePath)}\n`, 'utf8');
  return {
    archivePath,
    checksumPath,
    reference: `${options.image}@${options.digest}`,
  };
}
