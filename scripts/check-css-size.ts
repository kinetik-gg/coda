import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const MAX_CSS_LINES = 650;
// apps/web/src holds component styling; packages/design-tokens is the
// single source of truth for the shared spacing/type/chrome tokens it
// exports, so both are covered by the same budget.
const CSS_ROOTS = [resolve('apps/web/src'), resolve('packages/design-tokens')];

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'coverage']);

async function findCssFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) return [];
        return findCssFiles(join(directory, entry.name));
      }
      return entry.isFile() && entry.name.endsWith('.css') ? [join(directory, entry.name)] : [];
    }),
  );
  return nestedFiles.flat();
}

function countLines(source: string): number {
  if (source.length === 0) return 0;
  return source.split(/\r?\n/u).length - (source.endsWith('\n') ? 1 : 0);
}

async function main(): Promise<void> {
  const cssFileLists = await Promise.all(CSS_ROOTS.map((root) => findCssFiles(root)));
  const cssFiles = cssFileLists.flat();
  const violations: string[] = [];

  for (const cssFile of cssFiles) {
    const lineCount = countLines(await readFile(cssFile, 'utf8'));
    if (lineCount <= MAX_CSS_LINES) continue;
    violations.push(`${relative(process.cwd(), cssFile)}: ${lineCount} lines`);
  }

  if (violations.length > 0) {
    console.error(`CSS files must not exceed ${MAX_CSS_LINES} lines:\n${violations.join('\n')}`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Unable to check CSS file sizes.', error);
  process.exitCode = 1;
});
