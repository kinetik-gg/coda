import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const script = fileURLToPath(new URL('./verify-fountain-pdf-parity.ts', import.meta.url));
const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe('strict Fountain PDF parity command', () => {
  it('rejects omitted fixture hashes before reading input files', () => {
    const result = run([
      '--fountain',
      'missing.fountain',
      '--reference',
      'missing.pdf',
      '--paper',
      'a4',
    ]);

    expect(result.status).not.toBe(0);
    expect(output(result)).toContain(
      'Strict PDF parity requires expected SHA-256 values for both fixtures',
    );
    expect(output(result)).not.toContain('ENOENT');
  });

  it('rejects a mismatched source hash before loading the renderer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'coda-pdf-provenance-'));
    temporaryDirectories.push(directory);
    const fountain = join(directory, 'fixture.fountain');
    const reference = join(directory, 'fixture.pdf');
    writeFileSync(fountain, 'INT. TEST ROOM - DAY');
    writeFileSync(reference, 'not parsed before provenance passes');

    const result = run([
      '--fountain',
      fountain,
      '--reference',
      reference,
      '--expected-fountain-sha256',
      '0'.repeat(64),
      '--expected-reference-sha256',
      '0'.repeat(64),
    ]);

    expect(result.status).not.toBe(0);
    expect(output(result)).toContain('Fountain source does not match the expected SHA-256');
    expect(output(result)).not.toContain('Vite');
  });
});

function run(arguments_: readonly string[]) {
  return spawnSync(process.execPath, ['--import', 'tsx', script, ...arguments_], {
    encoding: 'utf8',
    timeout: 15_000,
  });
}

function output(result: ReturnType<typeof run>): string {
  return `${result.stdout}${result.stderr}`;
}
