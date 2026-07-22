import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { format, resolveConfig } from 'prettier';
import { buildExternalOpenApiDocument } from './external-openapi';

const outputPath = resolve(__dirname, '../../../../docs/openapi.json');

async function main(): Promise<void> {
  const prettierConfig = await resolveConfig(outputPath);
  const rendered = await format(JSON.stringify(buildExternalOpenApiDocument()), {
    ...prettierConfig,
    parser: 'json',
  });
  if (process.argv.includes('--check')) {
    const current = await readFile(outputPath, 'utf8').catch(() => '');
    if (current !== rendered) {
      console.error('docs/openapi.json is stale. Run pnpm openapi:generate.');
      process.exitCode = 1;
    }
    return;
  }
  await writeFile(outputPath, rendered, 'utf8');
  console.log('Generated docs/openapi.json');
}

void main();
