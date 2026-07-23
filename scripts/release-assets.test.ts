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
    expect(workflow).toContain('needs: [promote, release-policy]');
    expect(workflow).toContain('bundled-image-scan,');
    expect(workflow).toContain('candidate-scan,');
    expect(workflow).toContain('deployment,');
    expect(workflow).toContain('recovery,');
    expect(workflow).toContain('security,');
    expect(workflow).toContain('verification,');
    expect(workflow).toContain('contents: write');
    expect(workflow).toContain('pnpm release:publish-assets');
    expect(workflow).not.toContain('--clobber');
  });

  it('exercises the exact staged digest before immutable promotion', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    const recovery = readFileSync('.github/workflows/recovery.yml', 'utf8');
    const deployment = readFileSync('.github/workflows/deployment.yml', 'utf8');
    const stage = release.indexOf('  stage:');
    const promotion = release.indexOf('  promote:');
    const publication = release.indexOf('  release:');
    const candidateReference =
      '${{ needs.stage.outputs.image_name }}@${{ needs.stage.outputs.image_digest }}';

    expect(stage).toBeGreaterThan(-1);
    expect(promotion).toBeGreaterThan(stage);
    expect(publication).toBeGreaterThan(promotion);
    expect(
      release.match(new RegExp(candidateReference.replaceAll(/[${}.]/gu, '\\$&'), 'gu')),
    ).toHaveLength(3);
    expect(recovery).toContain('SUPPLIED_IMAGE: ${{ inputs.candidate_image }}');
    expect(deployment).toContain('CODA_IMAGE: ${{ inputs.candidate_image }}');
    expect(deployment).toContain('topology: [full-stack, app-only]');
  });

  it('resumes immutable image promotion only for the verified digest', () => {
    const workflow = readFileSync('.github/workflows/release.yml', 'utf8');
    const stateCheck = workflow.indexOf('- name: Check immutable version state');
    const promotion = workflow.indexOf('- name: Promote verified digest to immutable version');
    const verification = workflow.indexOf('- name: Verify immutable version digest');

    expect(stateCheck).toBeGreaterThan(-1);
    expect(promotion).toBeGreaterThan(stateCheck);
    expect(verification).toBeGreaterThan(promotion);
    expect(workflow).toContain('published_digest" != "$IMAGE_DIGEST');
    expect(workflow).toContain('echo "promotion_needed=false" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain('echo "promotion_needed=true" >> "$GITHUB_OUTPUT"');
    expect(workflow).toContain("if: steps.version.outputs.promotion_needed == 'true'");
  });
});
