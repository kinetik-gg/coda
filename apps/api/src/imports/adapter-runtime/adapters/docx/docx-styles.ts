/**
 * The two supporting parts a screenplay DOCX needs resolved before its body
 * means anything.
 *
 * `word/styles.xml` maps a paragraph's `w:pStyle` id to the human style *name*
 * — that name ("Scene Heading", "Character", "Dialogue") is what every
 * screenwriting exporter actually agrees on, while the id is producer-specific
 * (`SceneHeading`, `Style13`, `a7`). Without it the mapping falls back to
 * heuristics on the text alone.
 *
 * `word/numbering.xml` maps a `w:numId` to the list format it resolves through,
 * so a numbered paragraph can be reported honestly: Fountain has no list
 * construct, so the number itself is lost and the reader deserves to be told.
 *
 * Both parts go through the same decode + preflight + `sax` path as the body.
 */
import type { ScreenplayAdapterContext } from '@coda/contracts';
import type { SaxTag } from 'sax';
import { attributeValue, parseXmlPart } from './docx-xml';

/** Style id -> style name, from `word/styles.xml`. */
export async function parseDocxStyles(
  partName: string,
  xml: string | undefined,
  context: ScreenplayAdapterContext,
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (xml === undefined) return names;
  let currentId: string | undefined;
  await parseXmlPart(
    partName,
    xml,
    {
      onOpen: (tag, local): void => {
        if (local === 'style') currentId = attributeValue(tag, 'styleId');
        else if (local === 'name' && currentId !== undefined) {
          const name = attributeValue(tag, 'val');
          if (name !== undefined) names.set(currentId, name);
        }
      },
      onClose: (local): void => {
        if (local === 'style') currentId = undefined;
      },
    },
    context,
  );
  return names;
}

interface NumberingState {
  abstractFormats: Map<string, string>;
  numToAbstract: Map<string, string>;
  currentAbstractId?: string;
  currentNumId?: string;
}

/**
 * Numbering id -> list format, from `word/numbering.xml`.
 *
 * A `w:num` points at a `w:abstractNum`, which carries one `w:numFmt` per
 * indentation level. Only the first level's format is kept: the mapping needs to
 * say *that* a paragraph was a list item and roughly what kind, not to reproduce
 * a nine-level numbering scheme Fountain cannot express anyway.
 */
export async function parseDocxNumbering(
  partName: string,
  xml: string | undefined,
  context: ScreenplayAdapterContext,
): Promise<Map<string, string>> {
  const state: NumberingState = { abstractFormats: new Map(), numToAbstract: new Map() };
  if (xml === undefined) return new Map();
  await parseXmlPart(
    partName,
    xml,
    {
      onOpen: (tag, local) => openNumbering(state, tag, local),
      onClose: (local) => closeNumbering(state, local),
    },
    context,
  );
  const formats = new Map<string, string>();
  for (const [numId, abstractId] of state.numToAbstract) {
    const format = state.abstractFormats.get(abstractId);
    if (format !== undefined) formats.set(numId, format);
  }
  return formats;
}

function openNumbering(state: NumberingState, tag: SaxTag, local: string): void {
  if (local === 'abstractNum') state.currentAbstractId = attributeValue(tag, 'abstractNumId');
  else if (local === 'num') state.currentNumId = attributeValue(tag, 'numId');
  else if (local === 'abstractNumId' && state.currentNumId !== undefined) {
    const abstractId = attributeValue(tag, 'val');
    if (abstractId !== undefined) state.numToAbstract.set(state.currentNumId, abstractId);
  } else if (local === 'numFmt' && state.currentAbstractId !== undefined) {
    const format = attributeValue(tag, 'val');
    if (format !== undefined && !state.abstractFormats.has(state.currentAbstractId)) {
      state.abstractFormats.set(state.currentAbstractId, format);
    }
  }
}

function closeNumbering(state: NumberingState, local: string): void {
  if (local === 'abstractNum') state.currentAbstractId = undefined;
  else if (local === 'num') state.currentNumId = undefined;
}
