import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { digestReferenceFiles, propagateDigestReference } from './digest-references';
import { immutableReleaseReference } from './release-reference';

function argument(name: string): string {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`Missing --${name}`);
  return value;
}

function optional(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const reference = immutableReleaseReference(argument('image'), argument('digest'));
const root = resolve(optional('root') ?? process.cwd());

const changed: string[] = [];
let total = 0;
for (const file of digestReferenceFiles) {
  const path = resolve(root, file);
  const original = readFileSync(path, 'utf8');
  const { content, replaced } = propagateDigestReference(original, reference);
  if (replaced > 0 && content !== original) {
    writeFileSync(path, content, 'utf8');
    changed.push(`${file} (${replaced})`);
    total += replaced;
  }
}

if (total === 0) {
  process.stdout.write(`No digest references required updating for ${reference}.\n`);
} else {
  process.stdout.write(`Updated ${total} digest reference(s): ${changed.join(', ')}.\n`);
}
