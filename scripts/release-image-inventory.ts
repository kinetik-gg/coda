import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PINNED_IMAGE_PATTERN = /(?<reference>[A-Za-z0-9][A-Za-z0-9./:_-]*@sha256:[a-f0-9]{64})/gu;

export const bundledImageSources = ['compose.yaml', 'deploy/coolify/compose.full.yaml'] as const;

export interface BundledReleaseImage {
  id: string;
  reference: string;
}

function pinnedServiceImages(content: string, source: string): string[] {
  const images: string[] = [];
  for (const line of content.split(/\r?\n/u)) {
    if (!/^\s*image:/u.test(line) || line.includes('CODA_IMAGE')) continue;
    const normalized = line.replace(/\$\{[A-Z][A-Z0-9_]*:-/u, '');
    const matches = [...normalized.matchAll(PINNED_IMAGE_PATTERN)];
    if (matches.length !== 1 || !matches[0]?.groups?.reference) {
      throw new Error(`${source} contains an unpinned bundled service image`);
    }
    images.push(matches[0].groups.reference);
  }
  return images;
}

export function bundledReleaseImages(repositoryRoot: string): BundledReleaseImage[] {
  const references = new Set<string>();
  for (const source of bundledImageSources) {
    const content = readFileSync(resolve(repositoryRoot, source), 'utf8');
    for (const image of pinnedServiceImages(content, source)) references.add(image);
  }
  const images = [...references].sort().map((reference) => {
    const digest = reference.slice(reference.indexOf('@sha256:') + '@sha256:'.length);
    return { id: digest.slice(0, 12), reference };
  });
  if (new Set(images.map(({ id }) => id)).size !== images.length) {
    throw new Error('Bundled image identifiers are not unique');
  }
  return images;
}
