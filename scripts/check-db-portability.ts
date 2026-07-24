import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

// Portability gate (issue #76 / #77 lane). Every Postgres-specific SQL construct that Prisma does
// not abstract must live behind the DatabaseCapabilities seam, so its raw SQL exists in exactly one
// place. This gate fails when any such construct appears in `apps/api/src` OUTSIDE the adapter
// directory, catching a regression the moment it is written rather than when SQLite is wired up.
const API_SRC = resolve('apps/api/src');

// The one directory permitted to contain dialect-specific SQL: the Postgres adapter and its test.
const ADAPTER_DIR = resolve('apps/api/src/database');

// Constructs measured non-portable against SQLite by the #73 spike. Names are matched as raw text;
// comments are stripped first so explanatory prose that mentions these functions does not trip.
const FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /advisory_xact_lock/, label: 'advisory lock (pg_advisory_xact_lock / pg_try_...)' },
  { pattern: /hashtext/, label: 'hashtext / hashtextextended' },
  { pattern: /FOR UPDATE/, label: 'FOR UPDATE (row lock)' },
  { pattern: /SKIP LOCKED/, label: 'SKIP LOCKED' },
  { pattern: /INTERVAL '/, label: "INTERVAL '…' literal" },
];

async function collectTsFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);
      if (entryPath === ADAPTER_DIR) return [];
      if (entry.isDirectory()) return collectTsFiles(entryPath);
      return entry.isFile() && entry.name.endsWith('.ts') ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

// Replace comment bodies with blank space, preserving newlines so line numbers stay accurate.
function stripComments(source: string): string {
  const blanked = source.replace(/\/\*[\s\S]*?\*\//g, (match) => match.replace(/[^\n]/g, ' '));
  return blanked
    .split('\n')
    .map((line) => line.replace(/(?<!:)\/\/.*$/, ''))
    .join('\n');
}

async function main(): Promise<void> {
  const files = await collectTsFiles(API_SRC);
  const violations: string[] = [];

  for (const file of files) {
    const lines = stripComments(await readFile(file, 'utf8')).split('\n');
    lines.forEach((line, index) => {
      for (const { pattern, label } of FORBIDDEN) {
        if (pattern.test(line)) {
          violations.push(`${relative(process.cwd(), file)}:${index + 1}  ${label}`);
        }
      }
    });
  }

  if (violations.length > 0) {
    console.error(
      'Postgres-specific SQL must live behind the DatabaseCapabilities seam ' +
        '(apps/api/src/database). Found outside it:\n' +
        violations.join('\n'),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-db-portability: ${files.length} files clean — no dialect-specific SQL outside the adapter.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
