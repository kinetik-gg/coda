import { spawnSync } from 'node:child_process';
import {
  isImmutableImageReference,
  parseRuntimeInspection,
  runtimeInspectFormat,
  validateRuntimeInspection,
} from './runtime-audit';

interface AuditOptions {
  container: string;
  image: string;
}

const containerNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;

function parseOptions(args: string[]): AuditOptions {
  const values = args[0] === '--' ? args.slice(1) : args;
  const options: Partial<AuditOptions> = {};
  for (let index = 0; index < values.length; index += 2) {
    const option = values[index];
    const value = values[index + 1];
    if (!value || (option !== '--container' && option !== '--image')) {
      throw new Error('Usage: deployment:audit-runtime --container <name> --image <name@sha256>');
    }
    const key = option === '--container' ? 'container' : 'image';
    if (options[key]) throw new Error(`Option ${option} must be provided once`);
    options[key] = value;
  }
  if (!options.container || !containerNamePattern.test(options.container)) {
    throw new Error('A valid explicit container name is required');
  }
  if (!options.image || !isImmutableImageReference(options.image)) {
    throw new Error('A valid explicit immutable image reference is required');
  }
  return options as AuditOptions;
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const result = spawnSync(
    'docker',
    ['inspect', '--type', 'container', '--format', runtimeInspectFormat, options.container],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error || result.status !== 0) {
    throw new Error('Docker could not inspect the requested container');
  }
  const failures = validateRuntimeInspection(parseRuntimeInspection(result.stdout), options.image);
  if (failures.length > 0) {
    process.stderr.write(
      `Runtime audit failed:\n${failures.map((item) => `- ${item}`).join('\n')}\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('Runtime audit passed.\n');
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : 'Runtime audit failed';
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
