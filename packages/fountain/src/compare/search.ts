/**
 * Bounded exact-substring search with deterministic context escalation.
 *
 * This is the searching half of the engine, used only for ranges the affix alignment could not
 * resolve by proof. Two rules keep it honest:
 *
 * 1. It counts occurrences instead of taking the first one. "Found once" and "found four times" are
 *    different answers, and only the first can be applied without asking anybody.
 * 2. When an excerpt repeats, it retries with a fixed, ascending ladder of surrounding context taken
 *    from the *old* source. A short excerpt like a character cue occurs all over a screenplay; the
 *    same cue preceded by its own 128 code units of neighbours usually occurs once. The width that
 *    succeeded is reported, so the reason a range resolved is always a stated fact.
 *
 * Every scan is one linear pass charged against a shared pass budget. Nothing here recurses,
 * back-tracks, or scores similarity, so the same inputs always produce the same offsets in the same
 * order.
 */

export interface OccurrenceScan {
  /** Ascending match offsets, at most `limit` of them. */
  readonly offsets: readonly number[];
  /** True when the scan stopped at `limit` with matches still to come. */
  readonly truncated: boolean;
}

/**
 * Ascending offsets of every occurrence of `needle` in `haystack`, stopping once `limit` have been
 * collected. Overlapping occurrences are counted: advancing by one code unit rather than by the
 * needle length means a repeated excerpt is never undercounted into a false "unique match".
 */
export function scanOccurrences(haystack: string, needle: string, limit: number): OccurrenceScan {
  if (needle.length === 0 || needle.length > haystack.length || limit <= 0) {
    return { offsets: [], truncated: false };
  }

  const offsets: number[] = [];
  let from = 0;
  while (from <= haystack.length - needle.length) {
    const found = haystack.indexOf(needle, from);
    if (found < 0) break;
    if (offsets.length === limit) return { offsets, truncated: true };
    offsets.push(found);
    from = found + 1;
  }

  return { offsets, truncated: false };
}

/** A shared, mutable count of full-source scans a single request is still allowed to spend. */
export class SearchBudget {
  private remaining: number;
  private readonly limit: number;

  public constructor(limit: number) {
    this.limit = limit;
    this.remaining = limit;
  }

  public get used(): number {
    return this.limit - this.remaining;
  }

  /** Charges one pass. Returns false when nothing was left to charge. */
  public spend(): boolean {
    if (this.remaining <= 0) return false;
    this.remaining -= 1;
    return true;
  }
}

export interface AnchorSearchResult {
  /**
   * Ascending offsets in the new source where the *excerpt* starts, adjusted back off whatever
   * context was used to find it.
   */
  readonly offsets: readonly number[];
  readonly truncated: boolean;
  /** Context width, in code units, that produced `offsets`. `0` means the bare excerpt. */
  readonly contextCodeUnits: number;
  /** True when the budget ran out before the search could reach a conclusion. */
  readonly budgetExhausted: boolean;
}

export interface AnchorSearchInput {
  readonly sourceText: string;
  readonly targetText: string;
  readonly start: number;
  readonly end: number;
}

interface ContextNeedle {
  readonly needle: string;
  /** Code units of context that precede the excerpt inside `needle`. */
  readonly leadLength: number;
}

/** Builds the excerpt surrounded by up to `width` code units of its original neighbours. */
function contextNeedle(input: AnchorSearchInput, width: number): ContextNeedle {
  const { sourceText, start, end } = input;
  const leadStart = Math.max(0, start - width);
  const trailEnd = Math.min(sourceText.length, end + width);
  return { needle: sourceText.slice(leadStart, trailEnd), leadLength: start - leadStart };
}

/**
 * Scans for one occurrence more than the caller wants to see, so "there are more than you asked for"
 * is distinguishable from "that is all of them", then trims the extra back off.
 */
function scanForNeedle(
  targetText: string,
  { needle, leadLength }: ContextNeedle,
  maxCandidates: number,
): OccurrenceScan {
  const scan = scanOccurrences(targetText, needle, maxCandidates + 1);
  const truncated = scan.truncated || scan.offsets.length > maxCandidates;
  const kept = truncated ? scan.offsets.slice(0, maxCandidates) : scan.offsets;
  return { offsets: kept.map((offset) => offset + leadLength), truncated };
}

/**
 * Locates the old excerpt in the new source, escalating through `contextWidths` only while the answer
 * is still ambiguous.
 *
 * Escalation stops on the first width that yields exactly one match — that is a resolved anchor. A
 * width that yields *zero* matches means the surrounding context itself changed and says nothing new
 * about the excerpt, so the last still-ambiguous result is kept rather than being overwritten by an
 * emptier one. Widths that cannot grow the needle (the range already touches both document edges)
 * are not tried at all, since they would repeat the previous scan.
 */
export function searchAnchors(
  input: AnchorSearchInput,
  contextWidths: readonly number[],
  maxCandidates: number,
  budget: SearchBudget,
): AnchorSearchResult {
  const excerptLength = input.end - input.start;
  if (!budget.spend()) {
    return { offsets: [], truncated: false, contextCodeUnits: 0, budgetExhausted: true };
  }

  const bare = scanForNeedle(input.targetText, contextNeedle(input, 0), maxCandidates);
  let best: AnchorSearchResult = {
    offsets: bare.offsets,
    truncated: bare.truncated,
    contextCodeUnits: 0,
    budgetExhausted: false,
  };
  // A truncated scan is never unique, however few offsets survived the trim.
  if (best.offsets.length <= 1 && !best.truncated) return best;

  for (const width of contextWidths) {
    if (width <= 0) continue;
    const candidate = contextNeedle(input, width);
    if (candidate.needle.length <= excerptLength) break;
    if (!budget.spend()) return { ...best, budgetExhausted: true };
    const attempt = scanForNeedle(input.targetText, candidate, maxCandidates);
    if (attempt.offsets.length === 0) return best;
    best = {
      offsets: attempt.offsets,
      truncated: attempt.truncated,
      contextCodeUnits: width,
      budgetExhausted: false,
    };
    if (attempt.offsets.length === 1) return best;
  }

  return best;
}
