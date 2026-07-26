import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

interface LicenseReportEntry {
  name: string;
  versions: string[];
  paths: string[];
  license: string;
  author?: unknown;
}

type LicenseReport = Record<string, LicenseReportEntry[]>;

interface PackageMetadata {
  version?: unknown;
  author?: unknown;
  contributors?: unknown;
  repository?: string | { url?: string; directory?: string };
  os?: unknown;
  cpu?: unknown;
  libc?: unknown;
}

interface CreditEntry {
  name: string;
  version: string;
  license: string;
  attribution: string;
  projectUrl: string;
  licenseTextUrl: string;
  source: 'dependency' | 'bundled-asset' | 'application';
}

const repositoryRoot = resolve(__dirname, '..');
const outputPath = resolve(
  repositoryRoot,
  'apps/web/src/app-shell/generated/open-source-credits.json',
);
const runtimeRoots = ['@coda/web', '@coda/api'] as const;
const licenseCandidates = [
  'LICENSE',
  'LICENSE.md',
  'LICENSE.txt',
  'LICENCE',
  'LICENCE.md',
  'COPYING',
];

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function packageManagerCommand(filter: string): LicenseReport {
  const packageManager = process.env.npm_execpath;
  const command = packageManager ? process.execPath : 'pnpm';
  const args = packageManager
    ? [packageManager, '--filter', filter, 'licenses', 'list', '--prod', '--json']
    : ['--filter', filter, 'licenses', 'list', '--prod', '--json'];
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `pnpm licenses failed for ${filter}`);
  }
  return JSON.parse(result.stdout) as LicenseReport;
}

function stringifyPerson(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (!value || typeof value !== 'object') return undefined;
  const person = value as { name?: unknown; url?: unknown };
  if (typeof person.name === 'string' && person.name.trim()) return person.name.trim();
  if (typeof person.url === 'string' && person.url.trim()) return person.url.trim();
  return undefined;
}

function normalizeRepository(value: PackageMetadata['repository']): {
  url?: string;
  directory?: string;
} {
  const raw = typeof value === 'string' ? value : value?.url;
  if (!raw) return {};
  let url = raw
    .replace(/^git\+https:/u, 'https:')
    .replace(/^git:\/\//u, 'https://')
    .replace(/^git@github\.com:/u, 'https://github.com/')
    .replace(/\.git$/u, '');
  if (!/^https?:\/\//u.test(url)) url = `https://github.com/${url}`;
  return {
    url,
    ...(typeof value === 'object' && value.directory ? { directory: value.directory } : {}),
  };
}

function findLicenseFile(packagePath: string): string | undefined {
  const names = new Map(
    readdirSync(packagePath).map((entry) => [entry.toLocaleLowerCase(), entry]),
  );
  for (const candidate of licenseCandidates) {
    const actual = names.get(candidate.toLocaleLowerCase());
    if (actual) return join(packagePath, actual);
  }
  return undefined;
}

function copyrightLines(licenseFile: string | undefined): string[] {
  if (!licenseFile) return [];
  const lines = readFileSync(licenseFile, 'utf8')
    .split(/\r?\n/u)
    .map((line) => line.replace(/\s+/gu, ' ').trim())
    .filter((line) => /^(?:copyright\s*(?:\(c\)|©|\d{4})|©)/iu.test(line));
  return [...new Set(lines)].slice(0, 3);
}

function attribution(
  metadata: PackageMetadata,
  report: LicenseReportEntry,
  licenseFile: string | undefined,
): string {
  const copyrights = copyrightLines(licenseFile);
  if (copyrights.length) return copyrights.join(' · ');
  const author = stringifyPerson(report.author) ?? stringifyPerson(metadata.author);
  if (author) return author;
  if (Array.isArray(metadata.contributors)) {
    const contributors = metadata.contributors
      .map(stringifyPerson)
      .filter((value): value is string => Boolean(value))
      .slice(0, 3);
    if (contributors.length) return contributors.join(' · ');
  }
  return `Contributors to ${report.name}`;
}

function npmPackageUrl(name: string, version: string): string {
  return `https://www.npmjs.com/package/${encodeURIComponent(name)}/v/${encodeURIComponent(version)}`;
}

function repositoryLicenseUrl(
  repository: ReturnType<typeof normalizeRepository>,
  licenseFile: string | undefined,
): string | undefined {
  if (!repository.url || !licenseFile) return undefined;
  const filename = basename(licenseFile);
  const path = [repository.directory, filename].filter(Boolean).join('/');
  const host = new URL(repository.url).hostname.toLowerCase();
  if (host === 'github.com') return `${repository.url}/blob/HEAD/${path}`;
  if (host === 'gitlab.com') return `${repository.url}/-/blob/HEAD/${path}`;
  return undefined;
}

function licenseTextUrl(
  license: string,
  repository: ReturnType<typeof normalizeRepository>,
  licenseFile: string | undefined,
): string {
  if (/^[A-Za-z0-9.-]+$/u.test(license)) {
    return `https://spdx.org/licenses/${encodeURIComponent(license)}.html`;
  }
  return (
    repositoryLicenseUrl(repository, licenseFile) ??
    `https://spdx.org/licenses/${encodeURIComponent(license.replace(/[()]/gu, ''))}.html`
  );
}

function isHostSelectedOptionalPackage(metadata: PackageMetadata): boolean {
  return metadata.os !== undefined || metadata.cpu !== undefined || metadata.libc !== undefined;
}

function dependencyCredits(): CreditEntry[] {
  const credits = new Map<string, CreditEntry>();
  for (const root of runtimeRoots) {
    const report = packageManagerCommand(root);
    for (const entries of Object.values(report)) {
      for (const entry of entries) {
        entry.versions.forEach((version, index) => {
          if (entry.name.startsWith('@coda/')) return;
          const packagePath = entry.paths[index];
          if (!packagePath) throw new Error(`Missing package path for ${entry.name}@${version}`);
          const metadata = JSON.parse(
            readFileSync(join(packagePath, 'package.json'), 'utf8'),
          ) as PackageMetadata;
          // Native optional packages selected by the install host are delivery
          // artifacts of portable parents such as esbuild and @napi-rs/canvas.
          // Crediting the parent keeps this manifest about shipped source
          // projects and prevents macOS/Linux installs from rewriting it.
          if (isHostSelectedOptionalPackage(metadata)) return;
          const repository = normalizeRepository(metadata.repository);
          const licenseFile = findLicenseFile(packagePath);
          credits.set(`${entry.name}@${version}`, {
            name: entry.name,
            version,
            license: entry.license,
            attribution: attribution(metadata, entry, licenseFile),
            // The versioned registry page is the stable canonical project
            // destination for every package in this dependency-tree report.
            projectUrl: npmPackageUrl(entry.name, version),
            licenseTextUrl: licenseTextUrl(entry.license, repository, licenseFile),
            source: 'dependency',
          });
        });
      }
    }
  }
  return [...credits.values()];
}

function displayAssetName(directory: string): string {
  return directory
    .split('-')
    .map((word) => `${word.slice(0, 1).toLocaleUpperCase()}${word.slice(1)}`)
    .join(' ');
}

function firstProjectLink(readme: string | undefined): string | undefined {
  if (!readme) return undefined;
  return /\[[^\]]+\]\((https?:\/\/[^)]+)\)/u.exec(readme)?.[1];
}

function bundledFontCredits(): CreditEntry[] {
  const fontsRoot = resolve(repositoryRoot, 'apps/web/src/assets/fonts');
  return readdirSync(fontsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry): CreditEntry[] => {
      const directory = join(fontsRoot, entry.name);
      const licenseFile = join(directory, 'OFL.txt');
      if (!existsSync(licenseFile)) return [];
      const readmePath = join(directory, 'README.md');
      const readme = existsSync(readmePath) ? readFileSync(readmePath, 'utf8') : undefined;
      const license = readFileSync(licenseFile, 'utf8');
      const name = displayAssetName(entry.name);
      const firstLine = license
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find(Boolean);
      return [
        {
          name,
          version: 'bundled',
          license: 'OFL-1.1',
          attribution: firstLine ?? `Contributors to ${name}`,
          projectUrl:
            firstProjectLink(readme) ??
            `https://fonts.google.com/?query=${encodeURIComponent(name)}`,
          licenseTextUrl: 'https://spdx.org/licenses/OFL-1.1.html',
          source: 'bundled-asset',
        },
      ];
    });
}

function applicationCredit(): CreditEntry {
  const licenseFile = resolve(repositoryRoot, 'LICENSE');
  const metadata = JSON.parse(
    readFileSync(resolve(repositoryRoot, 'package.json'), 'utf8'),
  ) as PackageMetadata;
  if (typeof metadata.version !== 'string') throw new Error('Root package version is missing');
  return {
    name: 'Coda',
    version: metadata.version,
    license: 'MIT',
    attribution: copyrightLines(licenseFile)[0] ?? 'Coda contributors',
    projectUrl: 'https://github.com/kinetik-gg/coda',
    licenseTextUrl: 'https://github.com/kinetik-gg/coda/blob/main/LICENSE',
    source: 'application',
  };
}

function generatedOutput(): string {
  const packages = [applicationCredit(), ...dependencyCredits(), ...bundledFontCredits()].sort(
    (left, right) =>
      compare(left.license, right.license) ||
      compare(left.name, right.name) ||
      compare(left.version, right.version),
  );
  return `${JSON.stringify(
    {
      scope:
        'Host-neutral production dependency closure of @coda/web and @coda/api, plus font files bundled by the web client. Environment-selected native optional packages are represented by their portable parent packages.',
      packages,
    },
    null,
    2,
  )}\n`;
}

const output = generatedOutput();
if (process.argv.includes('--check')) {
  if (!existsSync(outputPath) || readFileSync(outputPath, 'utf8') !== output) {
    const displayed = relative(repositoryRoot, outputPath);
    throw new Error(`${displayed} is stale; run pnpm credits:generate`);
  }
  console.log('Open-source credits manifest is current.');
} else {
  mkdirSync(resolve(outputPath, '..'), { recursive: true });
  writeFileSync(outputPath, output);
  console.log(`Wrote ${relative(repositoryRoot, outputPath)}.`);
}
