import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const MAX_CSS_LINES = 650;
const CSS_ROOT = resolve('apps/web/src');

async function findCssFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) return findCssFiles(entryPath);
      return entry.isFile() && entry.name.endsWith('.css') ? [entryPath] : [];
    }),
  );
  return nestedFiles.flat();
}

function countLines(source: string): number {
  if (source.length === 0) return 0;
  return source.split(/\r?\n/u).length - (source.endsWith('\n') ? 1 : 0);
}

async function main(): Promise<void> {
  const cssFiles = await findCssFiles(CSS_ROOT);
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
