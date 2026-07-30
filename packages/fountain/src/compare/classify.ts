import {
  placeRange,
  projectChangedRange,
  type RangePlacement,
  type SourceAlignment,
} from './alignment';
import type { ResolvedComparisonOptions } from './request';
import { searchAnchors, type SearchBudget } from './search';
import { sha256HexOfUtf8 } from './sha256';
import type {
  ScreenplayRangeCandidate,
  ScreenplayRangeComparison,
  ScreenplayRangeQuery,
  ScreenplayRangeSourceEvidence,
} from './types';

/**
 * The decision procedure for a single referenced range.
 *
 * The order of the steps is the whole design, so it is written out here once:
 *
 * 1. **Evidence check.** If the caller recorded a `sourceTextHash` and it disagrees with the excerpt
 *    actually read out of the old source, stop. The two inputs disagree about what the range says, so
 *    every later step would be reasoning from text the caller does not believe in. `ambiguous`.
 * 2. **Proof from the unchanged prefix.** Range ends before the first difference — it cannot have
 *    moved. `unchanged`.
 * 3. **Proof from the unchanged suffix.** Range starts after the last difference — it moved by exactly
 *    the length delta and by nothing else. `unchanged` when the delta is zero, otherwise
 *    `shifted-with-identical-text`.
 * 4. **Unique exact match.** The excerpt occurs exactly once anywhere in the new source, possibly only
 *    after adding surrounding context. Uniqueness is proven by counting, so this is applicable.
 * 5. **Repeated exact match.** More than one place still qualifies after every context width.
 *    `ambiguous`, with every candidate listed. This is the case the engine exists to refuse.
 * 6. **No exact match.** The text is gone. The affix projection says which region of the new source it
 *    must have become: non-empty makes it `materially-changed` with that region as a reviewable
 *    proposal, empty makes it `deleted`.
 *
 * Steps 2 and 3 never search and never consult the excerpt's uniqueness, because they do not need to:
 * an offset fixed by an identical prefix or an identical suffix is not a match, it is arithmetic.
 * Steps 4 onward are the only ones that spend budget.
 */

function makeCandidate(
  targetText: string,
  sourceRange: { start: number; end: number },
  sourceExcerpt: string,
  target: { start: number; end: number },
  contextCodeUnits: number,
): ScreenplayRangeCandidate {
  const text = targetText.slice(target.start, target.end);
  return {
    range: { start: target.start, end: target.end },
    text,
    textHash: sha256HexOfUtf8(text),
    identicalText: text === sourceExcerpt,
    atSourceOffset: target.start === sourceRange.start,
    shift: target.start - sourceRange.start,
    contextCodeUnits,
  };
}

function resolved(
  base: { id: string; source: ScreenplayRangeSourceEvidence },
  classification: 'unchanged' | 'shifted-with-identical-text',
  reason: ScreenplayRangeComparison['reason'],
  candidate: ScreenplayRangeCandidate,
): ScreenplayRangeComparison {
  return {
    id: base.id,
    classification,
    reason,
    autoApplicable: true,
    source: base.source,
    target: candidate,
    candidates: [candidate],
    candidatesTruncated: false,
  };
}

function undecided(
  base: { id: string; source: ScreenplayRangeSourceEvidence },
  classification: 'materially-changed' | 'deleted' | 'ambiguous',
  reason: ScreenplayRangeComparison['reason'],
  candidates: readonly ScreenplayRangeCandidate[],
  candidatesTruncated: boolean,
): ScreenplayRangeComparison {
  return {
    id: base.id,
    classification,
    reason,
    autoApplicable: false,
    // A single reviewable proposal is offered for `materially-changed`; nothing is offered when there
    // is no target or more than one, because a lone `target` reads as an answer.
    target: classification === 'materially-changed' ? (candidates[0] ?? null) : null,
    source: base.source,
    candidates,
    candidatesTruncated,
  };
}

function classifyUnchangedAffix(
  base: { id: string; source: ScreenplayRangeSourceEvidence },
  alignment: SourceAlignment,
  placement: Exclude<RangePlacement, 'overlaps-change'>,
  targetText: string,
): ScreenplayRangeComparison {
  const { start, end } = base.source.range;
  const delta =
    placement === 'unchanged-prefix' ? 0 : alignment.targetLength - alignment.sourceLength;
  const candidate = makeCandidate(
    targetText,
    base.source.range,
    base.source.text,
    { start: start + delta, end: end + delta },
    0,
  );
  const reason =
    placement === 'unchanged-prefix' ? 'inside-unchanged-prefix' : 'inside-unchanged-suffix';
  if (delta === 0) return resolved(base, 'unchanged', reason, candidate);
  return resolved(base, 'shifted-with-identical-text', reason, candidate);
}

function classifyByReplacement(
  base: { id: string; source: ScreenplayRangeSourceEvidence },
  alignment: SourceAlignment,
  targetText: string,
): ScreenplayRangeComparison {
  const { start, end } = base.source.range;
  const region = projectChangedRange(alignment, start, end);
  if (region.end <= region.start) {
    return undecided(base, 'deleted', 'replacement-region-empty', [], false);
  }
  const candidate = makeCandidate(targetText, base.source.range, base.source.text, region, 0);
  return undecided(base, 'materially-changed', 'replacement-region', [candidate], false);
}

export interface ClassifyResult {
  readonly comparison: ScreenplayRangeComparison;
  readonly budgetExhausted: boolean;
}

interface ComparisonTexts {
  readonly sourceText: string;
  readonly targetText: string;
}

interface ClassifyContext {
  readonly options: ResolvedComparisonOptions;
  readonly budget: SearchBudget;
}

function classifyBySearch(
  base: { id: string; source: ScreenplayRangeSourceEvidence },
  alignment: SourceAlignment,
  texts: ComparisonTexts,
  context: ClassifyContext,
): ClassifyResult {
  const { start, end } = base.source.range;
  const { targetText } = texts;
  const search = searchAnchors(
    { sourceText: texts.sourceText, targetText, start, end },
    context.options.contextWidths,
    context.options.maxCandidates,
    context.budget,
  );

  if (search.offsets.length === 0 && search.budgetExhausted) {
    return {
      comparison: undecided(base, 'ambiguous', 'search-budget-exhausted', [], false),
      budgetExhausted: true,
    };
  }

  const candidates = search.offsets.map((offset) =>
    makeCandidate(
      targetText,
      base.source.range,
      base.source.text,
      { start: offset, end: offset + (end - start) },
      search.contextCodeUnits,
    ),
  );
  const budgetExhausted = search.budgetExhausted;
  // Uniqueness requires a scan that saw every occurrence. A truncated scan trimmed offsets away, so
  // its surviving single candidate is a sample, not a proof, and must never be auto-applied.
  const only = candidates.length === 1 && !search.truncated ? candidates[0] : undefined;

  if (only !== undefined) {
    const reason =
      search.contextCodeUnits === 0
        ? 'unique-identical-match'
        : 'unique-identical-match-with-context';
    const classification = only.shift === 0 ? 'unchanged' : 'shifted-with-identical-text';
    return { comparison: resolved(base, classification, reason, only), budgetExhausted };
  }

  if (candidates.length > 1 || search.truncated) {
    const reason = 'multiple-identical-matches';
    const comparison = undecided(base, 'ambiguous', reason, candidates, search.truncated);
    return { comparison, budgetExhausted };
  }

  return { comparison: classifyByReplacement(base, alignment, targetText), budgetExhausted };
}

export function classifyRange(
  query: ScreenplayRangeQuery,
  texts: ComparisonTexts,
  alignment: SourceAlignment,
  context: ClassifyContext,
): ClassifyResult {
  const { sourceText, targetText } = texts;
  const { start, end } = query.range;
  const excerpt = sourceText.slice(start, end);
  const textHash = sha256HexOfUtf8(excerpt);
  const recordedTextHash = query.recordedTextHash ?? null;
  const source: ScreenplayRangeSourceEvidence = {
    range: { start, end },
    text: excerpt,
    textHash,
    recordedTextHash,
    recordedTextHashMatches: recordedTextHash === null ? null : recordedTextHash === textHash,
  };
  const base = { id: query.id, source };

  if (source.recordedTextHashMatches === false) {
    return {
      comparison: undecided(base, 'ambiguous', 'recorded-hash-mismatch', [], false),
      budgetExhausted: false,
    };
  }

  if (alignment.identical) {
    const candidate = makeCandidate(targetText, source.range, excerpt, { start, end }, 0);
    return {
      comparison: resolved(base, 'unchanged', 'identical-source-text', candidate),
      budgetExhausted: false,
    };
  }

  const placement = placeRange(alignment, start, end);
  if (placement !== 'overlaps-change') {
    return {
      comparison: classifyUnchangedAffix(base, alignment, placement, targetText),
      budgetExhausted: false,
    };
  }

  return classifyBySearch(base, alignment, texts, context);
}
