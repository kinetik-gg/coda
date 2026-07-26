import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import { collectDeclaredFontTokens, formatViolations, inspectStylesheet } from './font-tokens';

// apps/web/src holds every component stylesheet; packages/design-tokens is
// the single source of truth for the type ladder those stylesheets consume,
// so it declares the pixel values and is not itself scanned for literals.
const CSS_ROOT = resolve('apps/web/src');
const TOKENS_CSS = resolve('packages/design-tokens/tokens.css');

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

async function main(): Promise<void> {
  const declaredTokens = collectDeclaredFontTokens(await readFile(TOKENS_CSS, 'utf8'));
  if (declaredTokens.size === 0) {
    console.error(
      `No --coda-font-* tokens are declared in ${relative(process.cwd(), TOKENS_CSS)}.`,
    );
    process.exitCode = 1;
    return;
  }

  const cssFiles = await findCssFiles(CSS_ROOT);
  const violations = (
    await Promise.all(
      cssFiles.map(async (cssFile) =>
        inspectStylesheet(
          relative(process.cwd(), cssFile),
          await readFile(cssFile, 'utf8'),
          declaredTokens,
        ),
      ),
    )
  ).flat();

  if (violations.length > 0) {
    console.error(
      `Interface font sizes must come from the --coda-font-* scale (see AGENTS.md):\n${formatViolations(violations)}`,
    );
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Unable to check interface font tokens.', error);
  process.exitCode = 1;
});
