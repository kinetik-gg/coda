/**
 * Word paragraphs -> Fountain, plus the per-element report that says how much of
 * each paragraph survived the trip.
 *
 * Two signals drive the mapping, in this order. A paragraph's *style name*
 * ("Scene Heading", "Character", "Dialogue") is what every screenwriting
 * exporter agrees on, and a paragraph carrying one is mapped with confidence.
 * A paragraph carrying no recognisable style — a screenplay typed directly in
 * Word, which is most of what actually arrives — falls back to text patterns,
 * and every such guess is reported as `uncertain` rather than passed off as a
 * conversion. Nothing is silently upgraded to a certainty the source did not
 * provide.
 *
 * Text is never re-cased or re-worded. Where a paragraph's text would not parse
 * back as the element it was classified as, it is *forced* with Fountain's
 * escape syntax (`.`, `@`, `>`, `!`) instead, so the round trip is exact.
 */
import type {
  ScreenplayAdapterLimits,
  ScreenplayConversionElement,
  ScreenplayConversionStatus,
  ScreenplayConversionWarning,
} from '@coda/contracts';
import type { DocxDocument, DocxParagraph } from './docx-document';

export type DocxElementKind =
  | 'scene-heading'
  | 'action'
  | 'character'
  | 'dialogue'
  | 'parenthetical'
  | 'transition'
  | 'centered'
  | 'section'
  | 'lyric'
  | 'page-break'
  | 'note'
  | 'title-page';

/** Normalised style name/id -> screenplay element. Both are checked, name first. */
const STYLE_KINDS = new Map<string, DocxElementKind>([
  ['sceneheading', 'scene-heading'],
  ['sceneheadings', 'scene-heading'],
  ['scenehead', 'scene-heading'],
  ['slugline', 'scene-heading'],
  ['slug', 'scene-heading'],
  ['action', 'action'],
  ['description', 'action'],
  ['narrative', 'action'],
  ['shot', 'action'],
  ['character', 'character'],
  ['charactername', 'character'],
  ['cast', 'character'],
  ['speaker', 'character'],
  ['dialogue', 'dialogue'],
  ['dialog', 'dialogue'],
  ['speech', 'dialogue'],
  ['parenthetical', 'parenthetical'],
  ['parenthetic', 'parenthetical'],
  ['paren', 'parenthetical'],
  ['wryly', 'parenthetical'],
  ['transition', 'transition'],
  ['transitions', 'transition'],
  ['centered', 'centered'],
  ['centeredtext', 'centered'],
  ['act', 'section'],
  ['actheading', 'section'],
  ['sequence', 'section'],
  ['lyric', 'lyric'],
  ['lyrics', 'lyric'],
  ['song', 'lyric'],
  ['pagebreak', 'page-break'],
  ['note', 'note'],
  ['annotation', 'note'],
  ['comment', 'note'],
]);

/** Style names that map onto Fountain title-page keys. */
const TITLE_PAGE_KEYS = new Map<string, string>([
  ['title', 'Title'],
  ['subtitle', 'Credit'],
  ['credit', 'Credit'],
  ['author', 'Author'],
  ['authors', 'Author'],
  ['byline', 'Author'],
  ['writtenby', 'Author'],
  ['source', 'Source'],
  ['contact', 'Contact'],
  ['draftdate', 'Draft date'],
]);

const SCENE_HEADING_PATTERN = /^(?:INT|EXT|EST|I\/E|INT\.?\/EXT)[.\s/]/iu;
const TRANSITION_PATTERN = /^(?:[\p{Lu}\p{N} '&()/-]*TO:|FADE (?:IN|OUT)[.:]?|FADE TO BLACK\.?)$/u;
const CHARACTER_PATTERN = /^[\p{Lu}][\p{Lu}\p{N} .'’()#&/-]*\^?$/u;
const PARENTHETICAL_PATTERN = /^\(.*\)$/u;
const FOUNTAIN_SIGIL_PATTERN = /^[.#!>=~@*_[\]]/u;

function normalizeStyle(value: string | undefined): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9]/gu, '');
}

interface Classification {
  readonly kind: DocxElementKind;
  readonly titleKey?: string;
  /** True when only the text, not a style, said what this paragraph is. */
  readonly guessed: boolean;
}

function classifyByStyle(paragraph: DocxParagraph): Classification | undefined {
  for (const candidate of [paragraph.styleName, paragraph.styleId]) {
    const normalized = normalizeStyle(candidate);
    if (normalized === '') continue;
    const titleKey = TITLE_PAGE_KEYS.get(normalized);
    if (titleKey) return { kind: 'title-page', titleKey, guessed: false };
    const kind = STYLE_KINDS.get(normalized);
    if (kind) return { kind, guessed: false };
  }
  return undefined;
}

/**
 * Classifies a paragraph nothing else identified. `previous` is the kind emitted
 * before it, which is what separates a character cue from a plain all-caps line:
 * a cue is followed by speech, and a parenthetical only exists inside a dialogue
 * block.
 */
function classifyByText(
  paragraph: DocxParagraph,
  previous: DocxElementKind | undefined,
  next: DocxParagraph | undefined,
): Classification {
  const text = paragraph.text;
  if (SCENE_HEADING_PATTERN.test(text)) return { kind: 'scene-heading', guessed: true };
  if (TRANSITION_PATTERN.test(text)) return { kind: 'transition', guessed: true };
  if (
    PARENTHETICAL_PATTERN.test(text) &&
    (previous === 'character' || previous === 'dialogue' || previous === 'parenthetical')
  ) {
    return { kind: 'parenthetical', guessed: true };
  }
  if (previous === 'character' || previous === 'parenthetical') {
    return { kind: 'dialogue', guessed: true };
  }
  if (isCharacterCue(text, next)) return { kind: 'character', guessed: true };
  if (paragraph.alignment === 'center') return { kind: 'centered', guessed: true };
  return { kind: 'action', guessed: true };
}

function isCharacterCue(text: string, next: DocxParagraph | undefined): boolean {
  if (text.length === 0 || text.length > 60 || !CHARACTER_PATTERN.test(text)) return false;
  const following = next?.text ?? '';
  return following.length > 0 && !SCENE_HEADING_PATTERN.test(following);
}

/**
 * Accumulates the Fountain snapshot and hands back the exact character range each
 * paragraph occupies in it, which is what makes the report's `target` locations
 * real rather than document-level approximations.
 *
 * Appending stops once the run's output ceiling is crossed, leaving the result
 * one line past the cap. The runtime's own `checkOutput` then reports
 * `output-too-large` against a specific number instead of the adapter guessing
 * at a reason, and memory stays bounded either way.
 */
class FountainBuilder {
  private readonly chunks: string[] = [];
  private length = 0;

  constructor(private readonly maxCharacters: number) {}

  get overflowed(): boolean {
    return this.length > this.maxCharacters;
  }

  separate(): void {
    if (this.length === 0 || this.overflowed) return;
    if (!this.chunks[this.chunks.length - 1]?.endsWith('\n\n')) this.push('\n');
  }

  line(text: string): { start: number; end: number } {
    const start = this.length;
    this.push(`${text}\n`);
    return { start, end: Math.min(this.length, start + text.length) };
  }

  toString(): string {
    return this.chunks.join('');
  }

  private push(text: string): void {
    if (this.overflowed) return;
    this.chunks.push(text);
    this.length += text.length;
  }
}

function forceAction(text: string): string {
  const ambiguous =
    FOUNTAIN_SIGIL_PATTERN.test(text) ||
    SCENE_HEADING_PATTERN.test(text) ||
    TRANSITION_PATTERN.test(text) ||
    CHARACTER_PATTERN.test(text);
  return ambiguous ? `!${text}` : text;
}

function renderLine(kind: DocxElementKind, text: string): string | undefined {
  switch (kind) {
    case 'scene-heading':
      return SCENE_HEADING_PATTERN.test(text) ? text : `.${text}`;
    case 'character':
      return CHARACTER_PATTERN.test(text) ? text : `@${text}`;
    case 'transition':
      return TRANSITION_PATTERN.test(text) ? text : `> ${text}`;
    case 'parenthetical':
      return PARENTHETICAL_PATTERN.test(text) ? text : `(${text})`;
    case 'centered':
      return `> ${text} <`;
    case 'section':
      return `# ${text}`;
    case 'lyric':
      return `~${text}`;
    case 'page-break':
      return '===';
    case 'dialogue':
      return text;
    case 'action':
      return forceAction(text);
    case 'note':
    case 'title-page':
      return undefined;
  }
}

/** Kinds that must sit in their own block, separated by a blank line. */
const BLOCK_KINDS = new Set<DocxElementKind>([
  'scene-heading',
  'action',
  'transition',
  'centered',
  'section',
  'lyric',
  'page-break',
  'character',
]);

interface ParagraphOutcome {
  readonly status: ScreenplayConversionStatus;
  readonly summary: string;
  readonly warnings: ScreenplayConversionWarning[];
}

/**
 * Decides how honest the report has to be about one paragraph. Degradations
 * accumulate: an unsupported drawing outranks an uncertain guess, which outranks
 * a clean style-driven conversion.
 */
function assessParagraph(
  paragraph: DocxParagraph,
  classification: Classification,
): ParagraphOutcome {
  const warnings: ScreenplayConversionWarning[] = [];
  let status: ScreenplayConversionStatus = classification.guessed ? 'uncertain' : 'converted';
  if (classification.guessed && classification.kind === 'action') status = 'preserved';
  const note = (code: string, message: string, escalate: ScreenplayConversionStatus): void => {
    warnings.push({ code, message });
    if (escalate === 'unsupported' || status === 'converted' || status === 'preserved') {
      status = escalate;
    }
  };
  if (paragraph.droppedObjects > 0) {
    note(
      'DOCX_EMBEDDED_OBJECT_DROPPED',
      `${paragraph.droppedObjects} embedded drawing or object was not imported; Fountain has no equivalent.`,
      'unsupported',
    );
  }
  if (paragraph.numbered) {
    note(
      'DOCX_LIST_NUMBERING_LOST',
      `List numbering (${paragraph.numberingFormat ?? 'unknown format'}) was dropped; Fountain has no list construct.`,
      'uncertain',
    );
  }
  if (paragraph.inTable) {
    note(
      'DOCX_TABLE_FLATTENED',
      'This text came from a table cell and was flattened into the script body.',
      'uncertain',
    );
  }
  if (paragraph.fieldCodes > 0) {
    note(
      'DOCX_FIELD_CODE_DROPPED',
      'A field code was dropped; its computed value is not part of the stored document.',
      'uncertain',
    );
  }
  if (paragraph.trackedChanges > 0) {
    note(
      'DOCX_TRACKED_CHANGE',
      'This paragraph carries tracked changes; deleted text was excluded and insertions were kept.',
      'uncertain',
    );
  }
  if (paragraph.externalLinks > 0) {
    note(
      'DOCX_EXTERNAL_LINK_NOT_FOLLOWED',
      'A hyperlink pointed outside the package; its text was kept and the target was never fetched.',
      'uncertain',
    );
  }
  return { status, summary: summarize(classification, paragraph), warnings };
}

function summarize(classification: Classification, paragraph: DocxParagraph): string {
  const label = classification.kind.replace('-', ' ');
  const source = paragraph.styleName ?? paragraph.styleId;
  if (classification.guessed) {
    return `Classified as ${label} from its text, because the paragraph carries no screenplay style.`;
  }
  return `Converted the "${source ?? label}" paragraph to Fountain ${label}.`;
}

export interface DocxConversion {
  readonly convertedFountain: string;
  readonly elements: ScreenplayConversionElement[];
  readonly warnings: ScreenplayConversionWarning[];
}

interface BuildState {
  readonly builder: FountainBuilder;
  readonly elements: ScreenplayConversionElement[];
  previous?: DocxElementKind;
}

/**
 * A title-page style only means a title page while the document is still in its
 * preamble. The same style applied halfway down a script is a heading someone
 * reused, and emitting `Title:` there would produce a Fountain document whose
 * title page silently swallowed body text.
 */
function classifyParagraph(
  paragraph: DocxParagraph,
  next: DocxParagraph | undefined,
  previous: DocxElementKind | undefined,
): Classification {
  const styled = classifyByStyle(paragraph);
  if (
    styled &&
    (styled.kind !== 'title-page' || previous === undefined || previous === 'title-page')
  ) {
    return styled;
  }
  return classifyByText(paragraph, previous, next);
}

function emitParagraph(
  state: BuildState,
  paragraph: DocxParagraph,
  classification: Classification,
): void {
  const outcome = assessParagraph(paragraph, classification);
  const rendered =
    classification.kind === 'title-page'
      ? `${classification.titleKey ?? 'Title'}: ${paragraph.text}`
      : renderLine(classification.kind, paragraph.text);
  let target: ScreenplayConversionElement['target'] = null;
  if (rendered !== undefined && rendered !== '') {
    if (BLOCK_KINDS.has(classification.kind)) state.builder.separate();
    const range = state.builder.line(rendered);
    target = {
      kind: classification.kind,
      location: { unit: 'character', start: range.start, end: range.end },
    };
    state.previous = classification.kind;
  }
  state.elements.push({
    id: `p-${paragraph.index + 1}`,
    status: classification.kind === 'note' ? 'unsupported' : outcome.status,
    source: {
      kind: 'docx-paragraph',
      location: { unit: 'paragraph', start: paragraph.index, end: paragraph.index + 1 },
    },
    target,
    summary:
      classification.kind === 'note'
        ? 'A Word note or comment paragraph was not imported.'
        : outcome.summary,
    warnings: outcome.warnings.slice(0, 20),
  });
}

/**
 * Builds the Fountain snapshot and the report from a walked document.
 *
 * Empty paragraphs are skipped entirely rather than reported: Word uses them as
 * spacing, and one report entry per blank line would bury the paragraphs that
 * actually needed a decision.
 */
export function buildDocxConversion(
  document: DocxDocument,
  options: {
    limits: ScreenplayAdapterLimits;
    packageWarnings: readonly ScreenplayConversionWarning[];
  },
): DocxConversion {
  const state: BuildState = {
    builder: new FountainBuilder(options.limits.maxOutputCharacters),
    elements: [],
  };
  const content = document.paragraphs.filter(
    (paragraph) => paragraph.text !== '' || paragraph.pageBreak,
  );
  for (const [position, paragraph] of content.entries()) {
    if (state.elements.length > options.limits.maxElements) break;
    if (paragraph.pageBreak && paragraph.text === '') {
      emitParagraph(state, paragraph, { kind: 'page-break', guessed: false });
      continue;
    }
    const classification = classifyParagraph(paragraph, content[position + 1], state.previous);
    emitParagraph(state, paragraph, classification);
  }
  const warnings = [...options.packageWarnings];
  if (document.truncated) {
    warnings.push({
      code: 'DOCX_DOCUMENT_TRUNCATED',
      message: 'The document exceeded the import ceilings and was not read to the end.',
    });
  }
  return {
    convertedFountain: state.builder.toString(),
    elements: state.elements,
    warnings: warnings.slice(0, options.limits.maxWarnings + 1),
  };
}
