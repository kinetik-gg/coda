export type SemverComparison = 'current' | 'ahead' | 'behind' | 'unknown';

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[];
}

const VERSION_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/u;

/** Parses a bare (non-`v`-prefixed) SemVer string, or returns `null` if it is malformed. */
export function parseSemver(version: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(version.trim());
  if (!match) return null;
  const [, major, minor, patch, prerelease] = match;
  return {
    major: Number(major),
    minor: Number(minor),
    patch: Number(patch),
    prerelease: prerelease ? prerelease.split('.') : [],
  };
}

function compareIdentifier(a: string, b: string): number {
  const numericA = /^\d+$/u.test(a);
  const numericB = /^\d+$/u.test(b);
  if (numericA && numericB) return Number(a) - Number(b);
  if (numericA !== numericB) return numericA ? -1 : 1; // numeric identifiers sort lower
  return a < b ? -1 : a > b ? 1 : 0;
}

function comparePrerelease(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 0;
  if (a.length === 0) return 1; // no prerelease outranks any prerelease
  if (b.length === 0) return -1;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const partA = a[index];
    const partB = b[index];
    if (partA === undefined) return -1;
    if (partB === undefined) return 1;
    const result = compareIdentifier(partA, partB);
    if (result !== 0) return result;
  }
  return 0;
}

/** Returns -1, 0, or 1 as `a` sorts before, equal to, or after `b` per SemVer precedence. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  return comparePrerelease(a.prerelease, b.prerelease);
}

/**
 * Classifies the running version against the latest known release. Returns `'unknown'` when
 * either version fails to parse, so callers never surface a false verdict for malformed input.
 */
export function classifyVersion(current: string, latest: string): SemverComparison {
  const parsedCurrent = parseSemver(current);
  const parsedLatest = parseSemver(latest);
  if (!parsedCurrent || !parsedLatest) return 'unknown';
  const result = compareVersions(parsedCurrent, parsedLatest);
  if (result === 0) return 'current';
  return result > 0 ? 'ahead' : 'behind';
}
