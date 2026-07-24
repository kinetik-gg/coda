import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runningVersion } from './running-version';

describe('runningVersion', () => {
  it('reads the version from the API package manifest', () => {
    const manifest = JSON.parse(readFileSync(join(__dirname, '../../package.json'), 'utf8')) as {
      version: string;
    };
    expect(runningVersion()).toBe(manifest.version);
  });

  it('is cached across repeated calls', () => {
    expect(runningVersion()).toBe(runningVersion());
  });
});
