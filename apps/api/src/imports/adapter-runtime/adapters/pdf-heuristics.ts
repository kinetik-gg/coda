import type { PdfExtractedLine, PdfExtractedPage } from './pdf-extract';

/** The Fountain construct a PDF line or line-group was classified as. */
export type PdfBlockKind =
  'scene_heading' | 'transition' | 'character' | 'parenthetical' | 'dialogue' | 'action';

/**
 * A run of one or more original PDF lines that heuristics decided belong to the
 * same Fountain construct. `certain` blocks matched an unambiguous textual
 * pattern (an `INT./EXT.` slugline, a `(parenthetical)`, an all-caps `...TO:`
 * transition); `uncertain` blocks were inferred from indentation alone, which
 * varies enough across PDF producers that the classification is reported, not
 * silently trusted.
 */
export interface PdfBlock {
  kind: PdfBlockKind;
  pageIndex: number;
  confidence: 'certain' | 'uncertain';
  lines: readonly string[];
}

const SCENE_HEADING = /^(?:INT\.\/EXT|INT\/EXT|I\/E|INT|EXT|EST)[.\s]/iu;
const TRANSITION_TEXT = /(?:^|\s)TO:$/u;
const TRANSITION_WORDS =
  /^(?:FADE IN|FADE OUT|FADE TO BLACK|DISSOLVE TO|SMASH CUT TO|MATCH CUT TO|JUMP CUT TO|CUT TO BLACK|THE END)[:.]?$/iu;
const PARENTHETICAL = /^\([^()]*\)$/u;
/** Leading characters that this Fountain dialect always treats as a forced marker. */
const STRUCTURAL_PREFIX = /^(?:\.|@|>|~|#|=|\[\[|\/\*)/u;

/**
 * Indentation bands as a share of page width, measured from the page's own
 * left margin (its least-indented line) rather than the physical edge, so a
 * page's own body-text column stands in for the "action" margin regardless of
 * the document's absolute paper size. Derived from the standard US screenplay
 * format on a Letter page: action/scene heading at 1.5in, dialogue at 2.5in
 * (+1in beyond the margin, ~0.12 of 8.5in), character at 3.7in (+2.2in beyond
 * the margin, ~0.26). `characterMin` sits between those two so a genuinely
 * indented all-caps cue reads as certain while one sitting at the dialogue
 * column reads as an ambiguous guess instead.
 */
const INDENT_BAND = {
  dialogueMin: 0.05,
  characterMin: 0.2,
};

/**
 * Classifies every extracted line of every page into {@link PdfBlock}s and
 * merges adjacent same-kind lines into a single block, mirroring how a
 * screenplay's action paragraphs and dialogue speeches span several visual PDF
 * lines but form one Fountain element.
 */
export function classifyPdfPages(pages: readonly PdfExtractedPage[]): PdfBlock[] {
  const blocks: PdfBlock[] = [];
  for (const page of pages) {
    blocks.push(...classifyPage(page));
  }
  return blocks;
}

function classifyPage(page: PdfExtractedPage): PdfBlock[] {
  const marginX = leftMargin(page.lines);
  const blocks: PdfBlock[] = [];
  let open:
    { kind: PdfBlockKind; confidence: 'certain' | 'uncertain'; lines: string[] } | undefined;
  let inCharacterBlock = false;

  const flush = (): void => {
    if (!open) return;
    blocks.push({ ...open, pageIndex: page.pageIndex });
    open = undefined;
  };

  for (const line of page.lines) {
    const trimmed = line.text.trim();
    if (trimmed === '') {
      flush();
      inCharacterBlock = false;
      continue;
    }
    const classification = classifyLine(trimmed, line, page.pageWidth, marginX, inCharacterBlock);
    if (classification.kind === 'character') inCharacterBlock = true;
    else if (classification.kind === 'scene_heading' || classification.kind === 'transition') {
      inCharacterBlock = false;
    }

    const mergeable =
      open &&
      open.kind === classification.kind &&
      classification.kind !== 'character' &&
      (classification.kind === 'action' || classification.kind === 'dialogue');
    if (mergeable && open) {
      open.lines.push(trimmed);
      open.confidence = open.confidence === 'certain' ? classification.confidence : 'uncertain';
      continue;
    }
    flush();
    open = { kind: classification.kind, confidence: classification.confidence, lines: [trimmed] };
  }
  flush();
  return blocks;
}

function classifyLine(
  trimmed: string,
  line: PdfExtractedLine,
  pageWidth: number,
  marginX: number,
  inCharacterBlock: boolean,
): { kind: PdfBlockKind; confidence: 'certain' | 'uncertain' } {
  if (SCENE_HEADING.test(trimmed)) return { kind: 'scene_heading', confidence: 'certain' };
  if (PARENTHETICAL.test(trimmed) && inCharacterBlock) {
    return { kind: 'parenthetical', confidence: 'certain' };
  }
  const upper = trimmed === trimmed.toUpperCase() && /\p{L}/u.test(trimmed);
  if (
    upper &&
    trimmed.length <= 60 &&
    (TRANSITION_TEXT.test(trimmed) || TRANSITION_WORDS.test(trimmed))
  ) {
    return { kind: 'transition', confidence: 'certain' };
  }
  const indent = pageWidth > 0 ? Math.max(0, line.x - marginX) / pageWidth : 0;
  if (inCharacterBlock && !upper) return { kind: 'dialogue', confidence: 'certain' };
  if (upper && trimmed.length <= 60 && !trimmed.startsWith('(')) {
    return {
      kind: 'character',
      confidence: indent >= INDENT_BAND.characterMin ? 'certain' : 'uncertain',
    };
  }
  if (indent >= INDENT_BAND.dialogueMin) {
    return { kind: 'dialogue', confidence: 'uncertain' };
  }
  return { kind: 'action', confidence: 'certain' };
}

function leftMargin(lines: readonly PdfExtractedLine[]): number {
  if (lines.length === 0) return 0;
  return Math.min(...lines.map((line) => line.x));
}

/**
 * Renders a block's Fountain text, forcing scene headings, characters, and
 * transitions with their explicit marker so classification survives regardless
 * of surrounding blank-line context, and neutralizing any line that would
 * otherwise collide with one of this dialect's *unconditional* structural
 * markers (a bare leading `.`, `@`, `>`, `~`, `#`, `=`, `[[`, or `/*`, all of
 * which this Fountain parser recognizes even mid-paragraph). Action's own `!`
 * forced marker is what neutralizes the collision, exactly as it does for a
 * genuine forced-action line.
 */
export function renderPdfBlock(block: PdfBlock): string {
  switch (block.kind) {
    case 'scene_heading':
      return renderSceneHeading(block.lines[0] ?? '');
    case 'transition':
      return `>${block.lines[0] ?? ''}`;
    case 'character':
      return `@${block.lines[0] ?? ''}`;
    case 'parenthetical':
      return renderParenthetical(block.lines[0] ?? '');
    case 'dialogue':
      return block.lines.join('\n');
    case 'action':
      return renderAction(block.lines);
  }
}

function renderSceneHeading(text: string): string {
  return SCENE_HEADING.test(text) ? text : `.${text}`;
}

function renderParenthetical(text: string): string {
  return PARENTHETICAL.test(text) ? text : `(${text})`;
}

function renderAction(lines: readonly string[]): string {
  const [first, ...rest] = lines;
  if (first === undefined) return '';
  const safeFirst = STRUCTURAL_PREFIX.test(first) ? `!${first}` : first;
  return [safeFirst, ...rest].join('\n');
}
