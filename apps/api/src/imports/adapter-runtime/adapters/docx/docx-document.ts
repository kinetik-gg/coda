/**
 * The WordprocessingML walker: `word/document.xml` (plus the styles and
 * numbering parts that give its style ids meaning) turned into a flat list of
 * paragraphs with the properties a screenplay mapping needs.
 *
 * It is a SAX walk, not a DOM build, for the reason the ADR gives: a document
 * tree for a 20 MB part is exactly the external-memory blowup the runtime's heap
 * ceiling cannot see. Nothing here holds more than the current paragraph plus the
 * paragraphs already emitted, and both are capped against the run's limits so a
 * hostile document reaches an attributable `output-too-large`/`element-limit`
 * failure instead of an unbounded allocation.
 *
 * Caps are enforced by going quiet rather than by throwing: once a ceiling is
 * crossed the walker stops accumulating but keeps draining the parser, so the
 * result still carries one paragraph (or one character) more than the ceiling
 * allows. That is what lets the runtime's own `checkOutput` name the specific
 * limit that was exceeded, instead of the adapter reporting a generic rejection.
 */
import { ScreenplayAdapterSourceError } from '@coda/contracts';
import type { ScreenplayAdapterContext } from '@coda/contracts';
import type { SaxTag } from 'sax';
import type { DocxRelationship } from './docx-package';
import { attributeValue, parseXmlPart } from './docx-xml';

export interface DocxParagraph {
  /** Zero-based position among the body's paragraphs; the report's source location. */
  readonly index: number;
  readonly styleId?: string;
  /** Resolved `w:name` for {@link styleId}, when the styles part defines one. */
  readonly styleName?: string;
  readonly alignment?: string;
  readonly numberingFormat?: string;
  readonly numbered: boolean;
  readonly inTable: boolean;
  readonly pageBreak: boolean;
  /** Drawings, pictures, and embedded objects seen in this paragraph — dropped, never opened. */
  readonly droppedObjects: number;
  /** `w:instrText` field instructions, whose computed values a static import cannot know. */
  readonly fieldCodes: number;
  /** Hyperlinks whose relationship target leaves the package; recorded, never fetched. */
  readonly externalLinks: number;
  readonly trackedChanges: number;
  readonly text: string;
}

export interface DocxDocument {
  readonly paragraphs: readonly DocxParagraph[];
  /** True once a ceiling stopped collection, so the caller knows the walk is partial. */
  readonly truncated: boolean;
}

interface MutableParagraph {
  index: number;
  styleId?: string;
  alignment?: string;
  numberingFormat?: string;
  numbered: boolean;
  inTable: boolean;
  pageBreak: boolean;
  droppedObjects: number;
  fieldCodes: number;
  externalLinks: number;
  trackedChanges: number;
  text: string[];
}

interface WalkState {
  readonly paragraphs: MutableParagraph[];
  readonly relationships: ReadonlyMap<string, DocxRelationship>;
  readonly numbering: ReadonlyMap<string, string>;
  readonly styleNames: ReadonlyMap<string, string>;
  readonly maxParagraphs: number;
  readonly maxCharacters: number;
  sawRoot: boolean;
  paragraphDepth: number;
  tableDepth: number;
  current?: MutableParagraph;
  inProperties: boolean;
  inNumbering: boolean;
  inText: boolean;
  inSuppressedText: boolean;
  characters: number;
  truncated: boolean;
}

const DROPPED_OBJECT_TAGS = new Set(['drawing', 'pict', 'object', 'oleObject', 'embedded']);

function newParagraph(index: number, inTable: boolean): MutableParagraph {
  return {
    index,
    inTable,
    numbered: false,
    pageBreak: false,
    droppedObjects: 0,
    fieldCodes: 0,
    externalLinks: 0,
    trackedChanges: 0,
    text: [],
  };
}

/** `w:val="0"`/`"false"` turns a WordprocessingML toggle off; a missing value turns it on. */
function toggleIsOn(tag: SaxTag): boolean {
  const value = attributeValue(tag, 'val');
  return value !== '0' && value?.toLowerCase() !== 'false';
}

function appendText(state: WalkState, text: string): void {
  const paragraph = state.current;
  if (!paragraph || state.inSuppressedText) return;
  if (state.characters >= state.maxCharacters) {
    state.truncated = true;
    return;
  }
  const room = state.maxCharacters - state.characters;
  const slice = text.length > room ? text.slice(0, room + 1) : text;
  paragraph.text.push(slice);
  state.characters += slice.length;
}

function openParagraphProperty(state: WalkState, tag: SaxTag, local: string): void {
  const paragraph = state.current;
  if (!paragraph) return;
  if (local === 'pStyle') paragraph.styleId = attributeValue(tag, 'val');
  else if (local === 'jc') paragraph.alignment = attributeValue(tag, 'val');
  else if (local === 'pageBreakBefore' && toggleIsOn(tag)) paragraph.pageBreak = true;
  else if (local === 'numPr') state.inNumbering = true;
  else if (local === 'numId' && state.inNumbering) {
    paragraph.numbered = true;
    paragraph.numberingFormat = state.numbering.get(attributeValue(tag, 'val') ?? '');
  }
}

function openRunChild(state: WalkState, tag: SaxTag, local: string): void {
  const paragraph = state.current;
  if (!paragraph) return;
  if (local === 't') state.inText = true;
  else if (local === 'tab') appendText(state, ' ');
  else if (local === 'noBreakHyphen') appendText(state, '-');
  else if (local === 'br') {
    if ((attributeValue(tag, 'type') ?? '') === 'page') paragraph.pageBreak = true;
    else appendText(state, '\n');
  } else if (local === 'instrText' || local === 'delText') {
    // Field instructions have no static value, and deleted text is by definition
    // not part of the document. Both are counted, then their character data is
    // dropped rather than silently mixed into the dialogue.
    state.inSuppressedText = true;
    if (local === 'instrText') paragraph.fieldCodes += 1;
    else paragraph.trackedChanges += 1;
  } else if (local === 'ins' || local === 'del') paragraph.trackedChanges += 1;
  else if (DROPPED_OBJECT_TAGS.has(local)) paragraph.droppedObjects += 1;
}

function openHyperlink(state: WalkState, tag: SaxTag): void {
  const paragraph = state.current;
  if (!paragraph) return;
  const relationshipId = attributeValue(tag, 'id');
  const relationship = relationshipId ? state.relationships.get(relationshipId) : undefined;
  if (relationship?.external) paragraph.externalLinks += 1;
}

function startParagraph(state: WalkState): void {
  state.paragraphDepth += 1;
  if (state.paragraphDepth !== 1) return;
  if (state.paragraphs.length > state.maxParagraphs) {
    state.truncated = true;
    return;
  }
  state.current = newParagraph(state.paragraphs.length, state.tableDepth > 0);
}

function endParagraph(state: WalkState): void {
  if (state.paragraphDepth === 1 && state.current) {
    state.paragraphs.push(state.current);
    state.current = undefined;
  }
  state.paragraphDepth = Math.max(0, state.paragraphDepth - 1);
}

function handleOpen(state: WalkState, tag: SaxTag, local: string): void {
  if (!state.sawRoot) {
    state.sawRoot = true;
    if (local !== 'document') {
      throw new ScreenplayAdapterSourceError(
        'This DOCX package does not contain a WordprocessingML document part.',
      );
    }
    return;
  }
  if (local === 'tbl') state.tableDepth += 1;
  else if (local === 'p') startParagraph(state);
  else if (local === 'pPr') state.inProperties = true;
  else if (state.inProperties) openParagraphProperty(state, tag, local);
  else if (local === 'hyperlink') openHyperlink(state, tag);
  else openRunChild(state, tag, local);
  // `sax` emits `onclosetag` for a self-closing element too, so the close side
  // is never handled here — doing both would unbalance every depth counter.
}

function handleClose(state: WalkState, local: string): void {
  if (local === 'tbl') state.tableDepth = Math.max(0, state.tableDepth - 1);
  else if (local === 'p') endParagraph(state);
  else if (local === 'pPr') state.inProperties = false;
  else if (local === 'numPr') state.inNumbering = false;
  else if (local === 't') state.inText = false;
  else if (local === 'instrText' || local === 'delText') state.inSuppressedText = false;
}

/**
 * Walks the main document part.
 *
 * `maxParagraphs`/`maxCharacters` come from the run's limits, so the walk stops
 * one step past whichever ceiling the document crosses first and the runtime
 * attributes the failure to that specific limit.
 */
export async function parseDocxDocument(
  documentXml: string,
  options: {
    partName: string;
    relationships: ReadonlyMap<string, DocxRelationship>;
    numbering: ReadonlyMap<string, string>;
    styleNames: ReadonlyMap<string, string>;
  },
  context: ScreenplayAdapterContext,
): Promise<DocxDocument> {
  const state: WalkState = {
    paragraphs: [],
    relationships: options.relationships,
    numbering: options.numbering,
    styleNames: options.styleNames,
    maxParagraphs: context.limits.maxElements,
    maxCharacters: context.limits.maxOutputCharacters,
    sawRoot: false,
    paragraphDepth: 0,
    tableDepth: 0,
    inProperties: false,
    inNumbering: false,
    inText: false,
    inSuppressedText: false,
    characters: 0,
    truncated: false,
  };
  await parseXmlPart(
    options.partName,
    documentXml,
    {
      onOpen: (tag, local) => handleOpen(state, tag, local),
      onClose: (local) => handleClose(state, local),
      onText: (text) => {
        if (state.inText) appendText(state, text);
      },
    },
    context,
  );
  return {
    paragraphs: state.paragraphs.map((paragraph) => finalize(paragraph, state.styleNames)),
    truncated: state.truncated,
  };
}

function finalize(
  paragraph: MutableParagraph,
  styleNames: ReadonlyMap<string, string>,
): DocxParagraph {
  const { text, styleId, ...rest } = paragraph;
  return {
    ...rest,
    styleId,
    styleName: styleId === undefined ? undefined : styleNames.get(styleId),
    text: text.join('').replace(/\r/gu, '').trim(),
  };
}
