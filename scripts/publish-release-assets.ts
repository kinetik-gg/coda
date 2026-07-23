import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { missingReleaseAssets, type ReleaseAssetMetadata } from './release-assets';
import { immutableReleaseNote, immutableReleaseReference } from './release-reference';

interface ExistingRelease {
  assets: ReleaseAssetMetadata[];
  body: string;
  isDraft: boolean;
  isPrerelease: boolean;
  tagName: string;
}

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function gh(args: string[], capture = false): string {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`gh ${args[0] ?? ''} failed: ${result.stderr}`);
  return result.stdout;
}

function existingRelease(tag: string): ExistingRelease | undefined {
  const result = spawnSync(
    'gh',
    ['release', 'view', tag, '--json', 'assets,body,isDraft,isPrerelease,tagName'],
    { encoding: 'utf8' },
  );
  if (result.error) throw result.error;
  if (result.status === 0) return JSON.parse(result.stdout) as ExistingRelease;
  if (/not found|HTTP 404|release does not exist/iu.test(result.stderr)) return undefined;
  throw new Error(`Unable to inspect existing release: ${result.stderr}`);
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assertExpectedAssets(directory: string, tag: string): string[] {
  const version = tag.slice(1);
  const expectedNames = [
    `coda-deployment-v${version}.sha256`,
    `coda-deployment-v${version}.tar.gz`,
    'release.json',
  ].sort();
  const names = readdirSync(directory).sort();
  if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
    throw new Error('Release asset directory does not contain the exact versioned bundle pair');
  }
  return names.map((name) => join(directory, name));
}

function verifyExistingAssets(tag: string, paths: string[], existingNames: Set<string>): void {
  const downloadDirectory = mkdtempSync(join(tmpdir(), 'coda-release-assets-'));
  try {
    for (const path of paths) {
      const name = basename(path);
      if (!existingNames.has(name)) continue;
      gh(['release', 'download', tag, '--pattern', name, '--dir', downloadDirectory]);
      if (sha256(path) !== sha256(join(downloadDirectory, name))) {
        throw new Error(`Published asset ${name} differs from the deterministic local asset`);
      }
    }
  } finally {
    rmSync(downloadDirectory, { force: true, recursive: true });
  }
}

function publishNewRelease(tag: string, title: string, paths: string[], note: string): void {
  gh([
    'release',
    'create',
    tag,
    ...paths,
    '--verify-tag',
    '--generate-notes',
    '--notes',
    note,
    '--title',
    title,
  ]);
}

function reconcileRelease(
  tag: string,
  title: string,
  paths: string[],
  immutableReference: string,
  note: string,
): void {
  const existing = existingRelease(tag);
  if (!existing) {
    publishNewRelease(tag, title, paths, note);
    return;
  }
  if (existing.tagName !== tag || existing.isDraft || existing.isPrerelease) {
    throw new Error('Existing release metadata does not match the immutable release policy');
  }
  if (!existing.body.includes(immutableReference)) {
    throw new Error('Existing release body does not contain the immutable container reference');
  }
  const local = paths.map((path) => ({ name: basename(path), size: statSync(path).size }));
  const missing = new Set(missingReleaseAssets(local, existing.assets));
  const existingNames = new Set(existing.assets.map((asset) => asset.name));
  verifyExistingAssets(tag, paths, existingNames);
  const missingPaths = paths.filter((path) => missing.has(basename(path)));
  if (missingPaths.length > 0) gh(['release', 'upload', tag, ...missingPaths]);
}

function main(): void {
  const tag = argument('tag');
  if (!/^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(tag)) {
    throw new Error('Release tag must be v-prefixed SemVer');
  }
  const directory = resolve(argument('assets'));
  const image = argument('image');
  const digest = argument('digest');
  reconcileRelease(
    tag,
    argument('title'),
    assertExpectedAssets(directory, tag),
    immutableReleaseReference(image, digest),
    immutableReleaseNote(image, digest),
  );
}

main();
