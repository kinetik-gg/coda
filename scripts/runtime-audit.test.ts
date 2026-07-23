import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  isImmutableImageReference,
  isLocalImageReference,
  isRuntimeRole,
  parseRuntimeInspection,
  runtimeInspectFormat,
  type RuntimeInspection,
  validateRuntimeInspection,
} from './runtime-audit';

const image = `registry.example/coda@sha256:${'a'.repeat(64)}`;

function validInspection(): RuntimeInspection {
  return {
    capAdd: null,
    capDrop: ['ALL'],
    healthStatus: 'healthy',
    image,
    memory: 2_147_483_648,
    memorySwap: 2_684_354_560,
    pidsLimit: 128,
    portBindings: {},
    privileged: false,
    readonlyRootfs: true,
    running: true,
    securityOpt: ['no-new-privileges:true'],
    stateStatus: 'running',
    tmpfs: {
      '/tmp': 'rw,noexec,nosuid,nodev,size=536870912,mode=1777',
    },
    user: 'node',
  };
}

describe('runtime audit', () => {
  it('accepts the exact hardened runtime contract', () => {
    expect(validateRuntimeInspection(validInspection(), image)).toEqual([]);
  });

  it('accepts equivalent option order and binary size notation', () => {
    const inspection = validInspection();
    inspection.tmpfs = {
      '/tmp': 'mode=1777,nodev,size=512m,nosuid,rw,noexec',
    };
    inspection.portBindings = null;
    expect(validateRuntimeInspection(inspection, image)).toEqual([]);
  });

  it.each([
    ['image', 'different', 'container image is not the expected image'],
    ['stateStatus', 'exited', 'container is not running and healthy'],
    ['running', false, 'container is not running and healthy'],
    ['healthStatus', 'starting', 'container is not running and healthy'],
    ['user', '', 'container user is not the expected non-root user'],
    ['readonlyRootfs', false, 'root filesystem is not read-only'],
    ['privileged', true, 'privileged mode is enabled or invalid'],
    ['capDrop', [], 'Linux capabilities are not fully dropped'],
    ['capAdd', ['SYS_ADMIN'], 'Linux capabilities are explicitly added'],
    ['securityOpt', [], 'privilege escalation is not disabled'],
    ['tmpfs', { '/tmp': 'rw,size=512m,mode=1777' }, '/tmp is not bounded and hardened'],
    ['memory', 0, 'memory limit is incorrect'],
    ['memorySwap', 0, 'memory-plus-swap limit is incorrect'],
    ['pidsLimit', 0, 'PID limit is incorrect'],
    [
      'portBindings',
      { '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '3000' }] },
      'direct host port bindings are present or invalid',
    ],
    ['portBindings', { '3000/tcp': 'invalid' }, 'direct host port bindings are present or invalid'],
  ] as const)('rejects an invalid %s value', (key, value, failure) => {
    const inspection = validInspection();
    inspection[key] = value;
    expect(validateRuntimeInspection(inspection, image)).toContain(failure);
  });

  it('rejects mutable expected image references', () => {
    expect(isImmutableImageReference('registry.example/coda:latest')).toBe(false);
    expect(() =>
      validateRuntimeInspection(validInspection(), 'registry.example/coda:latest'),
    ).toThrow(/immutable/u);
  });

  it.each([
    'postgres:17.7-alpine@sha256:bb377b7239d2774ac8cc76f481596ce96c5a6b5e9d141f6d0a0ee371a6e7c0f2',
    'minio/minio:RELEASE.2025-07-23T15-54-02Z@sha256:d249d1fb6966de4d8ad26c04754b545205ff15a62e4fd19ebd0f26fa5baacbc0',
    `registry.example:5000/team/coda:v0.0.2@sha256:${'b'.repeat(64)}`,
  ])('accepts pinned OCI image reference %s', (reference) => {
    expect(isImmutableImageReference(reference)).toBe(true);
  });

  it.each([
    `Registry.example/coda:v0.0.2@sha256:${'b'.repeat(64)}`,
    `registry.example/coda:bad tag@sha256:${'b'.repeat(64)}`,
    `registry.example/coda:v0.0.2@sha512:${'b'.repeat(64)}`,
    `registry.example/coda:v0.0.2@sha256:${'B'.repeat(64)}`,
    `registry.example/coda:v0.0.2@@sha256:${'b'.repeat(64)}`,
  ])('rejects invalid image reference %s', (reference) => {
    expect(isImmutableImageReference(reference)).toBe(false);
  });

  it('allows a narrow local-image policy only when explicitly requested', () => {
    const inspection = validInspection();
    inspection.image = 'coda-test:local';
    expect(isLocalImageReference('coda-test:local')).toBe(true);
    expect(isLocalImageReference('coda-test')).toBe(false);
    expect(isLocalImageReference('coda-test:latest')).toBe(false);
    expect(isLocalImageReference('registry.example/team/coda:latest')).toBe(false);
    expect(() => validateRuntimeInspection(inspection, 'coda-test:local', 'application')).toThrow(
      /immutable/u,
    );
    expect(
      validateRuntimeInspection(inspection, 'coda-test:local', 'application', {
        allowLocalImage: true,
      }),
    ).toEqual([]);
  });

  it.each([
    ['database', 1_073_741_824, 1_342_177_280, 192],
    ['object-storage', 1_610_612_736, 2_147_483_648, 128],
  ] as const)('accepts the %s dependency contract', (role, memory, memorySwap, pidsLimit) => {
    const inspection = validInspection();
    inspection.user = role === 'database' ? 'postgres' : '1000:1000';
    inspection.readonlyRootfs = false;
    inspection.tmpfs = {};
    inspection.memory = memory;
    inspection.memorySwap = memorySwap;
    inspection.pidsLimit = pidsLimit;

    expect(validateRuntimeInspection(inspection, image, role)).toEqual([]);
    inspection.memory = memory + 1;
    expect(validateRuntimeInspection(inspection, image, role)).toContain(
      'memory limit is incorrect',
    );
  });

  it('recognizes only explicit runtime roles', () => {
    expect(isRuntimeRole('application')).toBe(true);
    expect(isRuntimeRole('database')).toBe(true);
    expect(isRuntimeRole('object-storage')).toBe(true);
    expect(isRuntimeRole('unknown')).toBe(false);
    expect(isRuntimeRole('toString')).toBe(false);
  });

  it('accepts only the explicitly allowed loopback container port', () => {
    const inspection = validInspection();
    inspection.portBindings = {
      '3000/tcp': [{ HostIp: '127.0.0.1', HostPort: '53000' }],
    };
    expect(
      validateRuntimeInspection(inspection, image, 'application', {
        allowedLoopbackPort: 3000,
      }),
    ).toEqual([]);
    inspection.portBindings = {
      '3000/tcp': [{ HostIp: '0.0.0.0', HostPort: '53000' }],
    };
    expect(
      validateRuntimeInspection(inspection, image, 'application', {
        allowedLoopbackPort: 3000,
      }),
    ).toContain('direct host port bindings are present or invalid');
    inspection.portBindings = {
      '9000/tcp': [{ HostIp: '127.0.0.1', HostPort: '59000' }],
    };
    expect(
      validateRuntimeInspection(inspection, image, 'application', {
        allowedLoopbackPort: 3000,
      }),
    ).toContain('direct host port bindings are present or invalid');
  });

  it('parses only the selected runtime inspection fields', () => {
    const source = validInspection();
    const output = [
      source.image,
      source.user,
      source.stateStatus,
      source.running,
      source.healthStatus,
      source.readonlyRootfs,
      source.privileged,
      source.capDrop,
      source.capAdd,
      source.securityOpt,
      source.tmpfs,
      source.memory,
      source.memorySwap,
      source.pidsLimit,
      source.portBindings,
    ]
      .map((value) => JSON.stringify(value))
      .join('\n');
    expect(parseRuntimeInspection(output)).toEqual(source);
    expect(runtimeInspectFormat).not.toContain('.Config.Env');
    expect(runtimeInspectFormat).not.toContain('{{json .Config}}');
    expect(runtimeInspectFormat).not.toContain('{{json .HostConfig}}');
    expect(runtimeInspectFormat).not.toContain('{{json .State}}');
  });

  it('gates every long-running service in candidate deployment smoke tests', () => {
    const smoke = readFileSync('scripts/smoke-deployment.ts', 'utf8');
    const release = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(smoke).toContain("role: 'application'");
    expect(smoke).toContain("role: 'database'");
    expect(smoke).toContain("role: 'object-storage'");
    expect(smoke).toContain("'--local-image'");
    expect(release).toContain('CODA_IMAGE: ${{ env.CANDIDATE_IMAGE }}');
    expect(release).toContain('run: pnpm deployment:smoke full-stack');
    expect(release).toContain('run: pnpm deployment:smoke app-only');
  });
});
