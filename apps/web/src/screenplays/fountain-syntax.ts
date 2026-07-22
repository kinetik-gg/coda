import {
  parseFountain,
  type FountainAnnotation,
  type FountainDocument,
  type FountainElement,
} from '@coda/fountain';
import { StateField, type EditorState, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, type DecorationSet } from '@codemirror/view';

export type FountainLineKind =
  | 'action'
  | 'boneyard'
  | 'centered'
  | 'character'
  | 'dialogue'
  | 'lyric'
  | 'note'
  | 'page-break'
  | 'parenthetical'
  | 'scene'
  | 'section'
  | 'synopsis'
  | 'title-page'
  | 'transition';

const kindMap: Record<FountainElement['kind'], FountainLineKind> = {
  action: 'action',
  boneyard: 'boneyard',
  centered: 'centered',
  character: 'character',
  dialogue: 'dialogue',
  lyric: 'lyric',
  note: 'note',
  page_break: 'page-break',
  parenthetical: 'parenthetical',
  scene_heading: 'scene',
  section: 'section',
  separator: 'action',
  synopsis: 'synopsis',
  title_page: 'title-page',
  transition: 'transition',
};

export function classifyFountainLines(source: string): FountainLineKind[] {
  const lineCount = source.split('\n').length;
  const kinds = Array.from<FountainLineKind>({ length: lineCount }).fill('action');
  return classifyDocumentLines(parseFountain(source), kinds);
}

function classifyDocumentLines(
  document: FountainDocument,
  kinds: FountainLineKind[],
): FountainLineKind[] {
  for (const element of document.elements) {
    const kind = kindMap[element.kind];
    for (let line = element.lineStart; line <= element.lineEnd; line += 1) kinds[line] = kind;
  }
  return kinds;
}

const classForAnnotation: Record<FountainAnnotation['kind'], string> = {
  bold: 'cm-fountain-bold',
  bold_italic: 'cm-fountain-bold-italic',
  boneyard: 'cm-fountain-inline-boneyard',
  italic: 'cm-fountain-italic',
  note: 'cm-fountain-inline-note',
  underline: 'cm-fountain-underline',
};

const classForKind: Record<FountainLineKind, string> = {
  action: 'cm-fountain-action',
  boneyard: 'cm-fountain-boneyard',
  centered: 'cm-fountain-centered',
  character: 'cm-fountain-character',
  dialogue: 'cm-fountain-dialogue',
  lyric: 'cm-fountain-lyric',
  note: 'cm-fountain-note',
  'page-break': 'cm-fountain-page-break',
  parenthetical: 'cm-fountain-parenthetical',
  scene: 'cm-fountain-scene',
  section: 'cm-fountain-section',
  synopsis: 'cm-fountain-synopsis',
  'title-page': 'cm-fountain-title-page',
  transition: 'cm-fountain-transition',
};

function buildDecorations(state: EditorState): DecorationSet {
  const source = state.doc.toString();
  const document = parseFountain(source);
  const kinds = classifyDocumentLines(
    document,
    Array.from<FountainLineKind>({ length: state.doc.lines }).fill('action'),
  );
  const ranges: Range<Decoration>[] = [];
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const kind = kinds[number - 1] ?? 'action';
    ranges.push(Decoration.line({ class: classForKind[kind] }).range(line.from));
  }
  for (const annotation of document.annotations) {
    if (annotation.end > annotation.start) {
      ranges.push(
        Decoration.mark({ class: classForAnnotation[annotation.kind] }).range(
          annotation.start,
          annotation.end,
        ),
      );
    }
  }
  return Decoration.set(ranges, true);
}

const fountainDecorations = StateField.define<DecorationSet>({
  create: buildDecorations,
  update(value, transaction) {
    return transaction.docChanged
      ? buildDecorations(transaction.state)
      : value.map(transaction.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

export function fountainSyntax(): Extension {
  return fountainDecorations;
}
