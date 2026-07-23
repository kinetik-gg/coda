// Every in-repo Coda image reference is a template placeholder that the deployment bundle
// stamps with the release digest. This module also lets a completed release open a pull
// request that rewrites those references to the newly published, immutable digest. The
// pattern deliberately matches both the placeholder and an already-propagated 64-hex digest
// so re-running the propagation, and re-stamping the bundle, stays idempotent. It never
// matches a mutable tag, preserving the immutable-digest policy.
export function codaDigestReferencePattern(): RegExp {
  return /ghcr\.io\/kinetik-gg\/coda@sha256:(?:replace-with-release-manifest-digest|[0-9a-f]{64})/gu;
}

// Files carrying an operator-facing Coda digest reference. `deploy/coda.app.env.example`
// intentionally omits CODA_IMAGE, so it is a no-op unless that ever changes.
export const digestReferenceFiles = [
  'deploy/coolify/app.env.example',
  'deploy/coolify/full.env.example',
  'deploy/coda.app.env.example',
  'docs/operations.md',
] as const;

export function countDigestReferences(content: string): number {
  return [...content.matchAll(codaDigestReferencePattern())].length;
}

export function propagateDigestReference(
  content: string,
  reference: string,
): { content: string; replaced: number } {
  let replaced = 0;
  const next = content.replace(codaDigestReferencePattern(), () => {
    replaced += 1;
    return reference;
  });
  return { content: next, replaced };
}
