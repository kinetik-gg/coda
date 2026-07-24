import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

// Runtime-profile gate (issue #78). The server/desktop divergences are independent capability
// toggles, and no feature may branch on the profile name directly — every consumer reads a named
// capability key instead. This gate enforces that acceptance criterion structurally: the raw
// `RUNTIME_PROFILE` env var and the profile-name literals ('server' / 'desktop') may appear in
// exactly ONE production file, the capability module, and nowhere else. A leak elsewhere means a
// feature is (or could be) branching on the profile, so the build fails the moment it is written.
const API_SRC = resolve('apps/api/src');

// The one file permitted to name the profiles and read RUNTIME_PROFILE: the capability map itself.
const CAPABILITY_MODULE = resolve('apps/api/src/config/runtime-capabilities.ts');

const FORBIDDEN: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /RUNTIME_PROFILE/,
    label: 'RUNTIME_PROFILE env reference (read it only in the capability module)',
  },
  {
    pattern: /(['"`])(server|desktop)\1/,
    label: "profile-name literal ('server' / 'desktop') — branch on a capability key instead",
  },
];

async function collectTsFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);
      if (entryPath === CAPABILITY_MODULE) return [];
      // Tests legitimately configure RUNTIME_PROFILE and drive both presets; the criterion is about
      // features (production code) not branching on the profile, so test files are out of scope.
      if (entry.isFile() && (entry.name.endsWith('.test.ts') || entry.name.endsWith('.spec.ts')))
        return [];
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
      'Runtime-profile identity must live only in apps/api/src/config/runtime-capabilities.ts. ' +
        'Consume a capability key instead. Found outside it:\n' +
        violations.join('\n'),
    );
    process.exitCode = 1;
    return;
  }
  console.log(
    `check-runtime-profile-portability: ${files.length} files clean — no profile branching outside the capability module.`,
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
