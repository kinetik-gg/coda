import type {
  FountainAnnotation,
  FountainRevisionGeneration,
  FountainRevisionMetadata,
  FountainRevisionRange,
} from './types';

const generationCount = 8;
const revisionMarkers = ['*', '**', '+', '++', '@', '@@', '#', '##'] as const;

export function fountainRevisionMarker(generation: FountainRevisionGeneration): string {
  return revisionMarkers[generation];
}

export function parseEmbeddedRevisionMetadata(
  source: string,
  annotations: readonly FountainAnnotation[],
): FountainRevisionMetadata | undefined {
  const metadataComment = [...annotations]
    .reverse()
    .find(
      (annotation) =>
        annotation.kind === 'boneyard' &&
        source.slice(annotation.contentStart, annotation.contentEnd).includes('BEAT:'),
    );
  if (!metadataComment || metadataComment.kind !== 'boneyard') return undefined;

  const comment = source.slice(metadataComment.contentStart, metadataComment.contentEnd);
  const prefix = comment.indexOf('BEAT:');
  const suffix = comment.lastIndexOf('END_BEAT');
  if (prefix < 0 || suffix <= prefix) return undefined;

  const payload = parseObject(comment.slice(prefix + 'BEAT:'.length, suffix).trim());
  if (!payload) return undefined;
  const textLength = integer(payload['Text Length']);
  const currentGeneration = generation(payload['Revision Level']);
  const revision = object(payload.Revision);
  if (textLength === undefined || currentGeneration === undefined || !revision) return undefined;

  const ranges = [
    ...revisionRanges(revision.Addition, 'addition', textLength),
    ...revisionRanges(revision.Removed, 'removal', textLength),
    ...revisionRanges(revision.RemovalSuggestion, 'removal_suggestion', textLength),
  ].sort((left, right) => left.start - right.start || left.end - right.end);

  return {
    enabled: payload['Revision Mode'] === true,
    currentGeneration,
    textLength,
    ranges,
  };
}

function revisionRanges(
  value: unknown,
  kind: FountainRevisionRange['kind'],
  textLength: number,
): FountainRevisionRange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!Array.isArray(candidate)) return [];
    const start = integer(candidate[0]);
    const length = integer(candidate[1]);
    const revisionGeneration = generation(candidate[2]);
    if (
      start === undefined ||
      length === undefined ||
      revisionGeneration === undefined ||
      start < 0 ||
      length <= 0 ||
      start + length > textLength
    ) {
      return [];
    }
    return [{ start, end: start + length, generation: revisionGeneration, kind }];
  });
}

function parseObject(value: string): Record<string, unknown> | undefined {
  try {
    return object(JSON.parse(value));
  } catch {
    return undefined;
  }
}

function object(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}

function generation(value: unknown): FountainRevisionGeneration | undefined {
  const numeric = integer(value);
  return numeric !== undefined && numeric >= 0 && numeric < generationCount
    ? (numeric as FountainRevisionGeneration)
    : undefined;
}
