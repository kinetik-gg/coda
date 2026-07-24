import { describe, expect, it } from 'vitest';
import { classifyVersion, compareVersions, parseSemver } from './semver-compare';

describe('parseSemver', () => {
  it('parses a bare version without a prerelease', () => {
    expect(parseSemver('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3, prerelease: [] });
  });

  it('parses a version with a dotted prerelease', () => {
    expect(parseSemver('1.2.3-beta.1')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: ['beta', '1'],
    });
  });

  it.each(['v1.2.3', '1.2', '1.2.3.4', 'not-a-version', '', '1.2.3-'])(
    'rejects malformed version %s',
    (version) => {
      expect(parseSemver(version)).toBeNull();
    },
  );
});

describe('compareVersions', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareVersions(parseSemver('2.0.0')!, parseSemver('1.9.9')!)).toBeGreaterThan(0);
    expect(compareVersions(parseSemver('1.2.0')!, parseSemver('1.10.0')!)).toBeLessThan(0);
    expect(compareVersions(parseSemver('1.2.3')!, parseSemver('1.2.4')!)).toBeLessThan(0);
    expect(compareVersions(parseSemver('1.2.3')!, parseSemver('1.2.3')!)).toBe(0);
  });

  it('ranks a release above any of its prereleases', () => {
    expect(compareVersions(parseSemver('1.0.0')!, parseSemver('1.0.0-alpha')!)).toBeGreaterThan(0);
    expect(compareVersions(parseSemver('1.0.0-alpha')!, parseSemver('1.0.0')!)).toBeLessThan(0);
  });

  it('compares prerelease identifiers per SemVer precedence', () => {
    expect(
      compareVersions(parseSemver('1.0.0-alpha')!, parseSemver('1.0.0-alpha.1')!),
    ).toBeLessThan(0);
    expect(
      compareVersions(parseSemver('1.0.0-alpha.1')!, parseSemver('1.0.0-alpha.beta')!),
    ).toBeLessThan(0);
    expect(
      compareVersions(parseSemver('1.0.0-alpha.beta')!, parseSemver('1.0.0-beta')!),
    ).toBeLessThan(0);
    expect(compareVersions(parseSemver('1.0.0-alpha.1')!, parseSemver('1.0.0-alpha.2')!)).toBe(-1);
  });
});

describe('classifyVersion', () => {
  it('reports current when versions match', () => {
    expect(classifyVersion('1.2.3', '1.2.3')).toBe('current');
  });

  it('reports behind when the running version is older', () => {
    expect(classifyVersion('1.2.3', '1.3.0')).toBe('behind');
  });

  it('reports ahead for a dev build newer than the latest release', () => {
    expect(classifyVersion('1.3.0', '1.2.3')).toBe('ahead');
  });

  it('reports unknown when either version is malformed', () => {
    expect(classifyVersion('not-a-version', '1.2.3')).toBe('unknown');
    expect(classifyVersion('1.2.3', 'not-a-version')).toBe('unknown');
  });
});
