import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { verifyPdfParity } from '../src/screenplays/screenplay-pdf-parity';
import type { ScreenplayPaperSize } from '../src/screenplays/screenplay-paper';

interface PdfExportModule {
  createScreenplayPdf(
    source: string,
    paper: ScreenplayPaperSize,
  ): Promise<Uint8Array<ArrayBufferLike>>;
}

const argumentsByName = parseArguments(process.argv.slice(2));
const fountainPath = requiredPath(argumentsByName, 'fountain');
const referencePath = requiredPath(argumentsByName, 'reference');
const candidateOutput = optionalPath(argumentsByName, 'candidate-output');
const paper = paperSize(argumentsByName.get('paper'));
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fontDirectory = join(appRoot, 'src/assets/fonts/courier-prime');
const originalFetch = globalThis.fetch;
const vite = await createServer({ root: appRoot, mode: 'test', appType: 'custom' });

try {
  globalThis.fetch = async (input: string | URL | Request) => {
    const filename = basename(requestUrl(input).split('?')[0] ?? '');
    return new Response(await readFile(join(fontDirectory, filename)), { status: 200 });
  };
  const loaded = (await vite.ssrLoadModule(
    '/src/screenplays/screenplay-pdf-export.ts',
  )) as PdfExportModule;
  const [source, reference] = await Promise.all([
    readFile(fountainPath, 'utf8'),
    readFile(referencePath),
  ]);
  const candidate = await loaded.createScreenplayPdf(source, paper);
  if (candidateOutput) await writeFile(candidateOutput, candidate);
  const report = await verifyPdfParity(candidate, reference);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
} finally {
  globalThis.fetch = originalFetch;
  await vite.close();
}

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return 'url' in input ? input.url : input.href;
}

function parseArguments(values: readonly string[]): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith('--') || value === undefined) usage();
    result.set(name.slice(2), value);
  }
  return result;
}

function requiredPath(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (!value) usage();
  return resolve(value);
}

function optionalPath(values: ReadonlyMap<string, string>, name: string): string | undefined {
  const value = values.get(name);
  return value ? resolve(value) : undefined;
}

function paperSize(value: string | undefined): ScreenplayPaperSize {
  if (value === undefined || value === 'letter') return 'letter';
  if (value === 'a4') return value;
  usage();
}

function usage(): never {
  throw new Error(
    'Usage: pnpm screenplay:pdf-parity:fountain --fountain <draft.fountain> --reference <reference.pdf> [--paper letter|a4] [--candidate-output <candidate.pdf>]',
  );
}
