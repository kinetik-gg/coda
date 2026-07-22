import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { missingReleaseAssets } from './release-assets';

describe('immutable release assets', () => {
  const expected = [
    { name: 'coda-deployment-v0.0.2.sha256', size: 100 },
    { name: 'coda-deployment-v0.0.2.tar.gz', size: 2_000 },
  ];

  it('permits only absent assets to be appended on retry', () => {
    expect(missingReleaseAssets(expected, [expected[0]])).toEqual([
      'coda-deployment-v0.0.2.tar.gz',
    ]);
    expect(missingReleaseAssets(expected, expected)).toEqual([]);
  });

  it('rejects replacement or unexpected release assets', () => {
    expect(() => missingReleaseAssets(expected, [{ ...expected[0], size: 101 }])).toThrow(
      'differs in size',
    );
    expect(() => missingReleaseAssets(expected, [{ name: 'mutable.zip', size: 1 }])).toThrow(
      'unexpected asset',
    );
  });

  it('keeps release publication downstream and forbids clobbering', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(workflow).toContain('needs: [release-policy, publish, security, verification]');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('pnpm release:publish-assets');
    expect(workflow).not.toContain('--clobber');
  });
});
