export const runtimeInspectFormat = [
  '{{json .Config.Image}}',
  '{{json .State.Status}}',
  '{{json .State.Running}}',
  '{{if .State.Health}}{{json .State.Health.Status}}{{else}}null{{end}}',
  '{{json .HostConfig.ReadonlyRootfs}}',
  '{{json .HostConfig.CapDrop}}',
  '{{json .HostConfig.SecurityOpt}}',
  '{{json .HostConfig.Tmpfs}}',
  '{{json .HostConfig.Memory}}',
  '{{json .HostConfig.MemorySwap}}',
  '{{json .HostConfig.PidsLimit}}',
  '{{json .HostConfig.PortBindings}}',
].join('\n');

const immutableImagePattern = /^[a-z0-9]+(?:[._:/-][a-z0-9]+)*@sha256:[a-f0-9]{64}$/u;
const expectedTmpfsBytes = 512 * 1024 * 1024;

export interface RuntimeInspection {
  capDrop: unknown;
  healthStatus: unknown;
  image: unknown;
  memory: unknown;
  memorySwap: unknown;
  pidsLimit: unknown;
  portBindings: unknown;
  readonlyRootfs: unknown;
  running: unknown;
  securityOpt: unknown;
  stateStatus: unknown;
  tmpfs: unknown;
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
  if (lines.length !== 12) throw new Error('Docker inspection returned an unexpected shape');
  return {
    image: parseJson(lines[0] ?? ''),
    stateStatus: parseJson(lines[1] ?? ''),
    running: parseJson(lines[2] ?? ''),
    healthStatus: parseJson(lines[3] ?? ''),
    readonlyRootfs: parseJson(lines[4] ?? ''),
    capDrop: parseJson(lines[5] ?? ''),
    securityOpt: parseJson(lines[6] ?? ''),
    tmpfs: parseJson(lines[7] ?? ''),
    memory: parseJson(lines[8] ?? ''),
    memorySwap: parseJson(lines[9] ?? ''),
    pidsLimit: parseJson(lines[10] ?? ''),
    portBindings: parseJson(lines[11] ?? ''),
  };
}

export function isImmutableImageReference(reference: string): boolean {
  return immutableImagePattern.test(reference);
}

function stringArrayIncludes(value: unknown, expected: string): boolean {
  return Array.isArray(value) && value.some((entry) => entry === expected);
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

function hasPublishedPorts(value: unknown): boolean | undefined {
  if (value === null) return false;
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;
  for (const bindings of Object.values(value)) {
    if (bindings === null) continue;
    if (!Array.isArray(bindings)) return undefined;
    if (bindings.length > 0) return true;
  }
  return false;
}

export function validateRuntimeInspection(
  inspection: RuntimeInspection,
  expectedImage: string,
): string[] {
  if (!isImmutableImageReference(expectedImage)) {
    throw new Error('Expected image must be an immutable name@sha256 reference');
  }

  const failures: string[] = [];
  if (inspection.image !== expectedImage)
    failures.push('container image is not the expected image');
  if (
    inspection.stateStatus !== 'running' ||
    inspection.running !== true ||
    inspection.healthStatus !== 'healthy'
  ) {
    failures.push('container is not running and healthy');
  }
  if (inspection.readonlyRootfs !== true) failures.push('root filesystem is not read-only');
  if (!stringArrayIncludes(inspection.capDrop, 'ALL')) {
    failures.push('Linux capabilities are not fully dropped');
  }
  if (!stringArrayIncludes(inspection.securityOpt, 'no-new-privileges:true')) {
    failures.push('privilege escalation is not disabled');
  }
  if (!hardenedTmpfs(inspection.tmpfs)) failures.push('/tmp is not bounded and hardened');
  if (inspection.memory !== 2_147_483_648) failures.push('memory limit is not 2 GiB');
  if (inspection.memorySwap !== 2_684_354_560) {
    failures.push('memory-plus-swap limit is not 2.5 GiB');
  }
  if (inspection.pidsLimit !== 128) failures.push('PID limit is not 128');
  const publishedPorts = hasPublishedPorts(inspection.portBindings);
  if (publishedPorts !== false) failures.push('direct host port bindings are present or invalid');
  return failures;
}
