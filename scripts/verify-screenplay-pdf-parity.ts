import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyPdfParity } from '../apps/web/src/screenplays/screenplay-pdf-parity';

void main();

async function main(): Promise<void> {
  const argumentsByName = parseArguments(process.argv.slice(2));
  const candidatePath = requiredPath(argumentsByName, 'candidate');
  const referencePath = requiredPath(argumentsByName, 'reference');
  const coordinateTolerance = optionalNumber(argumentsByName, 'coordinate-tolerance');
  const pageSizeTolerance = optionalNumber(argumentsByName, 'page-size-tolerance');
  const [candidate, reference] = await Promise.all([
    readFile(candidatePath),
    readFile(referencePath),
  ]);
  const report = await verifyPdfParity(candidate, reference, {
    ...(coordinateTolerance === undefined
      ? {}
      : { coordinateTolerancePoints: coordinateTolerance }),
    ...(pageSizeTolerance === undefined ? {} : { pageSizeTolerancePoints: pageSizeTolerance }),
  });

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.passed ? 0 : 1;
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

function optionalNumber(values: ReadonlyMap<string, string>, name: string): number | undefined {
  const value = values.get(name);
  if (value === undefined) return undefined;
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) usage();
  return numeric;
}

function usage(): never {
  throw new Error(
    'Usage: pnpm screenplay:pdf-parity --candidate <coda.pdf> --reference <reference.pdf> [--coordinate-tolerance <points>] [--page-size-tolerance <points>]',
  );
}
