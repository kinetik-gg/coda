import { describe, expect, it } from 'vitest';
import {
  isImmutableImageReference,
  parseRuntimeInspection,
  runtimeInspectFormat,
  type RuntimeInspection,
  validateRuntimeInspection,
} from './runtime-audit';

const image = `registry.example/coda@sha256:${'a'.repeat(64)}`;

function validInspection(): RuntimeInspection {
  return {
    image,
    stateStatus: 'running',
    running: true,
    healthStatus: 'healthy',
    readonlyRootfs: true,
    capDrop: ['ALL'],
    securityOpt: ['no-new-privileges:true'],
    tmpfs: {
      '/tmp': 'rw,noexec,nosuid,nodev,size=536870912,mode=1777',
    },
    memory: 2_147_483_648,
    memorySwap: 2_684_354_560,
    pidsLimit: 128,
    portBindings: {},
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
    ['readonlyRootfs', false, 'root filesystem is not read-only'],
    ['capDrop', [], 'Linux capabilities are not fully dropped'],
    ['securityOpt', [], 'privilege escalation is not disabled'],
    ['tmpfs', { '/tmp': 'rw,size=512m,mode=1777' }, '/tmp is not bounded and hardened'],
    ['memory', 0, 'memory limit is not 2 GiB'],
    ['memorySwap', 0, 'memory-plus-swap limit is not 2.5 GiB'],
    ['pidsLimit', 0, 'PID limit is not 128'],
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

  it('parses only the selected runtime inspection fields', () => {
    const source = validInspection();
    const output = [
      source.image,
      source.stateStatus,
      source.running,
      source.healthStatus,
      source.readonlyRootfs,
      source.capDrop,
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
});
