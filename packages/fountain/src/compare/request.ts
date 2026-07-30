import {
  FOUNTAIN_COMPARE_MAX_SOURCE_LENGTH,
  ScreenplayComparisonError,
  type ScreenplayComparisonOptions,
  type ScreenplayComparisonRequest,
  type ScreenplayRangeQuery,
} from './types';

/**
 * Request validation and option defaults.
 *
 * Everything checked here is something the range contract's own schema and an immutable revision's
 * stored text already guarantee, so a well-behaved caller never trips it. Checking anyway means the
 * classification vocabulary stays a statement about the screenplay: there is no `invalid` verdict for
 * a human to puzzle over in a rebase preview, because impossible input never becomes a verdict.
 */

export interface ResolvedComparisonOptions {
  readonly maxSearchPasses: number;
  readonly maxCandidates: number;
  readonly contextWidths: readonly number[];
}

const DEFAULT_MAX_SEARCH_PASSES = 128;
const DEFAULT_MAX_CANDIDATES = 16;
const DEFAULT_CONTEXT_WIDTHS: readonly number[] = [32, 128, 512];

function requirePositiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new ScreenplayComparisonError(
      'invalid-option',
      `${name} must be a positive integer, received ${String(value)}`,
    );
  }
  return value;
}

function resolveContextWidths(widths: readonly number[]): readonly number[] {
  const resolved = widths.map((width) => requirePositiveInteger(width, 'contextWidths entry'));
  for (let index = 1; index < resolved.length; index += 1) {
    const previous = resolved[index - 1] ?? 0;
    const current = resolved[index] ?? 0;
    if (current <= previous) {
      throw new ScreenplayComparisonError(
        'invalid-option',
        'contextWidths must be strictly ascending so escalation is deterministic',
      );
    }
  }
  return resolved;
}

export function resolveOptions(options?: ScreenplayComparisonOptions): ResolvedComparisonOptions {
  return {
    maxSearchPasses: requirePositiveInteger(
      options?.maxSearchPasses ?? DEFAULT_MAX_SEARCH_PASSES,
      'maxSearchPasses',
    ),
    maxCandidates: requirePositiveInteger(
      options?.maxCandidates ?? DEFAULT_MAX_CANDIDATES,
      'maxCandidates',
    ),
    contextWidths: resolveContextWidths(options?.contextWidths ?? DEFAULT_CONTEXT_WIDTHS),
  };
}

function assertSourceLength(text: string, code: 'source-too-long' | 'target-too-long'): void {
  if (text.length > FOUNTAIN_COMPARE_MAX_SOURCE_LENGTH) {
    throw new ScreenplayComparisonError(
      code,
      `source exceeds ${String(FOUNTAIN_COMPARE_MAX_SOURCE_LENGTH)} code units`,
    );
  }
}

function assertRange(query: ScreenplayRangeQuery, sourceLength: number): void {
  const { start, end } = query.range;
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new ScreenplayComparisonError(
      'non-integer-range',
      'range offsets must be integers',
      query.id,
    );
  }
  if (end <= start) {
    throw new ScreenplayComparisonError(
      'empty-range',
      'range must be non-empty half-open [start, end)',
      query.id,
    );
  }
  if (start < 0 || end > sourceLength) {
    throw new ScreenplayComparisonError(
      'range-out-of-bounds',
      `range [${String(start)}, ${String(end)}) falls outside a source of ${String(sourceLength)} code units`,
      query.id,
    );
  }
}

export function assertRequest(request: ScreenplayComparisonRequest): void {
  assertSourceLength(request.sourceText, 'source-too-long');
  assertSourceLength(request.targetText, 'target-too-long');

  const seen = new Set<string>();
  for (const query of request.ranges) {
    if (seen.has(query.id)) {
      throw new ScreenplayComparisonError(
        'duplicate-range-id',
        `duplicate range id ${query.id}`,
        query.id,
      );
    }
    seen.add(query.id);
    assertRange(query, request.sourceText.length);
  }
}
