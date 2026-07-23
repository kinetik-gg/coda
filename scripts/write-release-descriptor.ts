import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import {
  RELEASE_DESCRIPTOR_ASSET_NAME,
  bundleChecksumFromFile,
  serializeReleaseDescriptor,
} from './release-descriptor';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

const version = argument('version');
const image = argument('image');
const digest = argument('digest');
const outputDirectory = resolve(argument('output'));
const checksumPath = resolve(argument('checksum'));

const bundleSha256 = bundleChecksumFromFile(
  readFileSync(checksumPath, 'utf8'),
  `coda-deployment-v${version}.tar.gz`,
);

mkdirSync(outputDirectory, { recursive: true });
const descriptorPath = join(outputDirectory, RELEASE_DESCRIPTOR_ASSET_NAME);
writeFileSync(
  descriptorPath,
  serializeReleaseDescriptor({ version, image, digest, bundleSha256 }),
  'utf8',
);

process.stdout.write(`Wrote ${descriptorPath} for ${image}@${digest}.\n`);
