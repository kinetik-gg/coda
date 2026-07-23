export const runtimeInspectFormat = [
  '{{json .Config.Image}}',
  '{{json .Config.User}}',
  '{{json .State.Status}}',
  '{{json .State.Running}}',
  '{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}',
  '{{json .HostConfig.ReadonlyRootfs}}',
  '{{json .HostConfig.Privileged}}',
  '{{json .HostConfig.CapDrop}}',
  '{{json .HostConfig.CapAdd}}',
  '{{json .HostConfig.SecurityOpt}}',
  '{{json .HostConfig.Tmpfs}}',
  '{{json .HostConfig.Memory}}',
  '{{json .HostConfig.MemorySwap}}',
  '{{json .HostConfig.PidsLimit}}',
  '{{json .HostConfig.PortBindings}}',
].join('\n');

const imageNamePattern = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*(?::[A-Za-z0-9_][A-Za-z0-9_.-]{0,127})?$/u;
const localRepositoryPattern = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/u;
const localTagPattern = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/u;
const sha256DigestPattern = /^sha256:[a-f0-9]{64}$/u;
const expectedTmpfsBytes = 512 * 1024 * 1024;

export type RuntimeRole = 'application' | 'database' | 'object-storage';

interface RuntimeContract {
  expectedUser: string;
  memory: number;
  memorySwap: number;
  pidsLimit: number;
  requireReadOnlyRoot: boolean;
  requireTmpfs: boolean;
}

const runtimeContracts: Readonly<Record<RuntimeRole, RuntimeContract>> = {
  application: {
    expectedUser: 'node',
    memory: 2_147_483_648,
    memorySwap: 2_684_354_560,
    pidsLimit: 128,
    requireReadOnlyRoot: true,
    requireTmpfs: true,
  },
  database: {
    expectedUser: 'postgres',
    memory: 1_073_741_824,
    memorySwap: 1_342_177_280,
    pidsLimit: 192,
    requireReadOnlyRoot: false,
    requireTmpfs: false,
  },
  'object-storage': {
    expectedUser: '1000:1000',
    memory: 1_610_612_736,
    memorySwap: 2_147_483_648,
    pidsLimit: 128,
    requireReadOnlyRoot: false,
    requireTmpfs: false,
  },
};

export interface RuntimeInspection {
  capAdd: unknown;
  capDrop: unknown;
  healthStatus: unknown;
  image: unknown;
  memory: unknown;
  memorySwap: unknown;
  pidsLimit: unknown;
  portBindings: unknown;
  privileged: unknown;
  readonlyRootfs: unknown;
  running: unknown;
  securityOpt: unknown;
  stateStatus: unknown;
  tmpfs: unknown;
  user: unknown;
}

export interface RuntimeValidationOptions {
  allowLocalImage?: boolean;
  allowedLoopbackPort?: number;
}

function parseJson(line: string): unknown {
  try {
    return JSON.parse(line) as unknown;
  } catch {
    throw new Error('Docker inspection returned an unexpected value');
  }
}

export function parseRuntimeInspection(output: string): RuntimeInspection {
  const lines = output.trimEnd().split(/\r?\n/u);
  if (lines.length !== 15) throw new Error('Docker inspection returned an unexpected shape');
  return {
    image: parseJson(lines[0] ?? ''),
    user: parseJson(lines[1] ?? ''),
    stateStatus: parseJson(lines[2] ?? ''),
    running: parseJson(lines[3] ?? ''),
    healthStatus: parseJson(lines[4] ?? ''),
    readonlyRootfs: parseJson(lines[5] ?? ''),
    privileged: parseJson(lines[6] ?? ''),
    capDrop: parseJson(lines[7] ?? ''),
    capAdd: parseJson(lines[8] ?? ''),
    securityOpt: parseJson(lines[9] ?? ''),
    tmpfs: parseJson(lines[10] ?? ''),
    memory: parseJson(lines[11] ?? ''),
    memorySwap: parseJson(lines[12] ?? ''),
    pidsLimit: parseJson(lines[13] ?? ''),
    portBindings: parseJson(lines[14] ?? ''),
  };
}

export function isImmutableImageReference(reference: string): boolean {
  const separator = reference.lastIndexOf('@');
  if (separator <= 0 || reference.indexOf('@') !== separator) return false;
  return (
    imageNamePattern.test(reference.slice(0, separator)) &&
    sha256DigestPattern.test(reference.slice(separator + 1))
  );
}

export function isLocalImageReference(reference: string): boolean {
  const separator = reference.lastIndexOf(':');
  if (separator <= 0 || reference.indexOf(':') !== separator) return false;
  const repository = reference.slice(0, separator);
  const tag = reference.slice(separator + 1);
  return (
    localRepositoryPattern.test(repository) &&
    localTagPattern.test(tag) &&
    tag.toLowerCase() !== 'latest'
  );
}

export function isRuntimeRole(value: string): value is RuntimeRole {
  return Object.prototype.hasOwnProperty.call(runtimeContracts, value);
}

function stringArrayIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.some((entry) => entry === expected);
}

function emptyStringArray(value: unknown): boolean {
  return value === null || (Array.isArray(value) && value.length === 0);
}

function recordValue(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

function tmpfsSize(value: string): number | undefined {
  const match = /^(\d+)([kmgt])?b?$/iu.exec(value);
  if (!match?.[1]) return undefined;
  const amount = Number(match[1]);
  if (!Number.isSafeInteger(amount)) return undefined;
  const exponent = match[2] ? 'kmgt'.indexOf(match[2].toLowerCase()) + 1 : 0;
  return amount * 1024 ** exponent;
}

function hardenedTmpfs(value: unknown): boolean {
  const mountOptions = recordValue(value, '/tmp');
  if (typeof mountOptions !== 'string') return false;
  const entries = mountOptions.split(',').map((option) => option.trim().toLowerCase());
  const flags = new Set(entries.filter((option) => !option.includes('=')));
  const options = new Map(
    entries
      .filter((option) => option.includes('='))
      .map((option) => {
        const separator = option.indexOf('=');
        return [option.slice(0, separator), option.slice(separator + 1)] as const;
      }),
  );
  return (
    ['rw', 'noexec', 'nosuid', 'nodev'].every((flag) => flags.has(flag)) &&
    !['ro', 'exec', 'suid', 'dev'].some((flag) => flags.has(flag)) &&
    options.get('mode') === '1777' &&
    tmpfsSize(options.get('size') ?? '') === expectedTmpfsBytes
  );
}

function isAllowedLoopbackBinding(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const binding = value as Record<string, unknown>;
  const hostIp = binding.HostIp;
  const hostPort = binding.HostPort;
  return (
    (hostIp === '127.0.0.1' || hostIp === '::1') &&
    typeof hostPort === 'string' &&
    /^[1-9]\d{0,4}$/u.test(hostPort) &&
    Number(hostPort) <= 65_535
  );
}

function hasDisallowedPublishedPorts(
  value: unknown,
  allowedLoopbackPort?: number,
): boolean | undefined {
  if (value === null) return false;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  for (const [containerPort, bindings] of Object.entries(value)) {
    if (bindings === null) continue;
    if (!Array.isArray(bindings)) return undefined;
    if (bindings.length === 0) continue;
    if (
      allowedLoopbackPort === undefined ||
      containerPort !== `${allowedLoopbackPort}/tcp` ||
      !bindings.every((binding) => isAllowedLoopbackBinding(binding))
    ) {
      return true;
    }
  }
  return false;
}

export function validateRuntimeInspection(
  inspection: RuntimeInspection,
  expectedImage: string,
  role: RuntimeRole = 'application',
  options: RuntimeValidationOptions = {},
): string[] {
  const validExpectedImage =
    isImmutableImageReference(expectedImage) ||
    (options.allowLocalImage === true && isLocalImageReference(expectedImage));
  if (!validExpectedImage) {
    throw new Error('Expected image must be an immutable name@sha256 reference');
  }

  const contract = runtimeContracts[role];
  const failures: string[] = [];
  if (inspection.image !== expectedImage)
    failures.push('container image is not the expected image');
  if (inspection.user !== contract.expectedUser) {
    failures.push('container user is not the expected non-root user');
  }
  if (
    inspection.stateStatus !== 'running' ||
    inspection.running !== true ||
    inspection.healthStatus !== 'healthy'
  ) {
    failures.push('container is not running and healthy');
  }
  if (contract.requireReadOnlyRoot && inspection.readonlyRootfs !== true) {
    failures.push('root filesystem is not read-only');
  }
  if (inspection.privileged !== false) failures.push('privileged mode is enabled or invalid');
  if (!stringArrayIncludes(inspection.capDrop, 'ALL')) {
    failures.push('Linux capabilities are not fully dropped');
  }
  if (!emptyStringArray(inspection.capAdd)) {
    failures.push('Linux capabilities are explicitly added');
  }
  if (!stringArrayIncludes(inspection.securityOpt, 'no-new-privileges:true')) {
    failures.push('privilege escalation is not disabled');
  }
  if (contract.requireTmpfs && !hardenedTmpfs(inspection.tmpfs)) {
    failures.push('/tmp is not bounded and hardened');
  }
  if (inspection.memory !== contract.memory) failures.push('memory limit is incorrect');
  if (inspection.memorySwap !== contract.memorySwap) {
    failures.push('memory-plus-swap limit is incorrect');
  }
  if (inspection.pidsLimit !== contract.pidsLimit) failures.push('PID limit is incorrect');
  const publishedPorts = hasDisallowedPublishedPorts(
    inspection.portBindings,
    options.allowedLoopbackPort,
  );
  if (publishedPorts !== false) failures.push('direct host port bindings are present or invalid');
  return failures;
}
