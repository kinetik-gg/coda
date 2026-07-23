import { spawnSync } from 'node:child_process';
import {
  isImmutableImageReference,
  isLocalImageReference,
  isRuntimeRole,
  parseRuntimeInspection,
  runtimeInspectFormat,
  type RuntimeRole,
  validateRuntimeInspection,
} from './runtime-audit';

interface AuditOptions {
  allowLocalImage: boolean;
  allowedLoopbackPort?: number;
  container: string;
  expectedImage: string;
  role: RuntimeRole;
}

interface RawAuditOptions {
  allowedLoopbackPort?: number;
  container?: string;
  image?: string;
  localImage?: string;
  role?: string;
}

type StringOption = 'container' | 'image' | 'localImage' | 'role';

const containerNamePattern = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/u;
const usage =
  'Usage: deployment:audit-runtime --container <name> (--image <name@sha256> | --local-image <local-name:tag>) --role <application|database|object-storage> [--allow-loopback-port <port>]';

function assignStringOption(
  options: RawAuditOptions,
  key: StringOption,
  option: string,
  value: string,
): void {
  if (options[key]) throw new Error(`Option ${option} must be provided once`);
  options[key] = value;
}

function assignLoopbackPort(options: RawAuditOptions, option: string, value: string): void {
  if (options.allowedLoopbackPort !== undefined) {
    throw new Error(`Option ${option} must be provided once`);
  }
  const port = Number(value);
  if (!/^[1-9]\d{0,4}$/u.test(value) || !Number.isInteger(port) || port > 65_535) {
    throw new Error('The allowed loopback container port is invalid');
  }
  options.allowedLoopbackPort = port;
}

function collectOptions(args: string[]): RawAuditOptions {
  const values = args[0] === '--' ? args.slice(1) : args;
  const options: RawAuditOptions = {};
  for (let index = 0; index < values.length; index += 2) {
    const option = values[index];
    const value = values[index + 1];
    if (!option || !value) throw new Error(usage);
    switch (option) {
      case '--allow-loopback-port':
        assignLoopbackPort(options, option, value);
        break;
      case '--container':
        assignStringOption(options, 'container', option, value);
        break;
      case '--image':
        assignStringOption(options, 'image', option, value);
        break;
      case '--local-image':
        assignStringOption(options, 'localImage', option, value);
        break;
      case '--role':
        assignStringOption(options, 'role', option, value);
        break;
      default:
        throw new Error(usage);
    }
  }
  return options;
}

function parseOptions(args: string[]): AuditOptions {
  const options = collectOptions(args);
  if (!options.container || !containerNamePattern.test(options.container)) {
    throw new Error('A valid explicit container name is required');
  }
  if (
    (options.image === undefined) === (options.localImage === undefined) ||
    (options.image !== undefined && !isImmutableImageReference(options.image)) ||
    (options.localImage !== undefined && !isLocalImageReference(options.localImage))
  ) {
    throw new Error('Exactly one valid immutable or local image reference is required');
  }
  if (!options.role || !isRuntimeRole(options.role)) {
    throw new Error('A valid explicit runtime role is required');
  }
  const expectedImage = options.image ?? options.localImage;
  if (!expectedImage) throw new Error('An explicit image reference is required');
  return {
    allowLocalImage: options.localImage !== undefined,
    allowedLoopbackPort: options.allowedLoopbackPort,
    container: options.container,
    expectedImage,
    role: options.role,
  };
}

function main(): void {
  const args = process.argv.slice(2);
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) {
    process.stdout.write(`${usage}\n`);
    return;
  }
  const options = parseOptions(args);
  const result = spawnSync(
    'docker',
    ['inspect', '--type', 'container', '--format', runtimeInspectFormat, options.container],
    { encoding: 'utf8', windowsHide: true },
  );
  if (result.error || result.status !== 0) {
    throw new Error('Docker could not inspect the requested container');
  }
  const failures = validateRuntimeInspection(
    parseRuntimeInspection(result.stdout),
    options.expectedImage,
    options.role,
    {
      allowLocalImage: options.allowLocalImage,
      allowedLoopbackPort: options.allowedLoopbackPort,
    },
  );
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
