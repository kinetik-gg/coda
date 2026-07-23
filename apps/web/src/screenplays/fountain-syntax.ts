import {
  parseFountain,
  type FountainAnnotation,
  type FountainDocument,
  type FountainElement,
} from '@coda/fountain';
import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import type { ScreenplayPreviewModel } from './screenplay-preview-model';
import type { ScreenplayPaperSize } from './screenplay-paper';

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

const fountainMarker = Decoration.mark({ class: 'cm-fountain-marker' });
const scenePrefixMarker = Decoration.mark({ class: 'cm-fountain-scene-prefix' });
const sceneNumberMarker = Decoration.mark({ class: 'cm-fountain-scene-number' });
const characterExtensionMarker = Decoration.mark({ class: 'cm-fountain-character-extension' });
const titleKeyMarker = Decoration.mark({ class: 'cm-fountain-title-key' });
const screenplayPaperFacet = Facet.define<ScreenplayPaperSize, ScreenplayPaperSize>({
  combine: (values) => values.at(-1) ?? 'letter',
});
const screenplayPreviewFacet = Facet.define<
  ScreenplayPreviewModel | undefined,
  ScreenplayPreviewModel | undefined
>({
  combine: (values) => values.at(-1),
});

function elementSourceText(element: FountainElement): string {
  if (element.raw.endsWith('\r\n')) return element.raw.slice(0, -2);
  if (element.raw.endsWith('\n')) return element.raw.slice(0, -1);
  return element.raw;
}

function addMark(
  ranges: Range<Decoration>[],
  decoration: Decoration,
  start: number,
  end: number,
): void {
  if (end > start) ranges.push(decoration.range(start, end));
}

function leadingMarkerLength(element: FountainElement): number {
  switch (element.kind) {
    case 'action':
    case 'scene_heading':
    case 'character':
    case 'transition':
      return element.forced ? 1 : 0;
    case 'lyric':
    case 'synopsis':
      return 1;
    case 'centered':
      return element.raw.startsWith('>') ? 1 : 0;
    case 'section':
      return element.depth;
    case 'page_break':
      return elementSourceText(element).length;
    case 'boneyard':
    case 'dialogue':
    case 'note':
    case 'parenthetical':
    case 'separator':
    case 'title_page':
      return 0;
  }
}

function addCharacterSyntaxMarks(
  ranges: Range<Decoration>[],
  element: Extract<FountainElement, { kind: 'character' }>,
  raw: string,
  contentEnd: number,
): void {
  if (element.dual && raw.endsWith('^')) {
    addMark(ranges, fountainMarker, contentEnd - 1, contentEnd);
  }
  if (!element.extension) return;
  const extension = /\s(\([^\r\n)]+\))\^?$/u.exec(raw);
  const extensionText = extension?.[1];
  if (extension?.index === undefined || !extensionText) return;
  const start = element.start + extension.index + 1;
  addMark(ranges, characterExtensionMarker, start, start + extensionText.length);
}

function addSceneSyntaxMarks(
  ranges: Range<Decoration>[],
  element: Extract<FountainElement, { kind: 'scene_heading' }>,
  raw: string,
): void {
  if (element.sceneNumber) {
    const marker = `#${element.sceneNumber}#`;
    const offset = raw.lastIndexOf(marker);
    if (offset >= 0) {
      addMark(
        ranges,
        sceneNumberMarker,
        element.start + offset,
        element.start + offset + marker.length,
      );
    }
  }
  const contentOffset = element.forced ? 1 : 0;
  const prefix = /^(?:INT\.?\/EXT\.?|INT\/EXT\.?|INT\.?|EXT\.?|I\/E\.?|EST\.?)(?=\s|$)/iu.exec(
    raw.slice(contentOffset),
  );
  if (!prefix) return;
  const start = element.start + contentOffset;
  addMark(ranges, scenePrefixMarker, start, start + prefix[0].length);
}

function addTitlePageSyntaxMarks(
  ranges: Range<Decoration>[],
  element: Extract<FountainElement, { kind: 'title_page' }>,
): void {
  for (const field of element.fields) {
    const colon = field.raw.indexOf(':');
    if (colon >= 0) addMark(ranges, titleKeyMarker, field.start, field.start + colon + 1);
  }
}

function addElementSyntaxMarks(ranges: Range<Decoration>[], element: FountainElement): void {
  const raw = elementSourceText(element);
  const contentEnd = element.start + raw.length;
  const prefixLength = leadingMarkerLength(element);
  addMark(ranges, fountainMarker, element.start, element.start + prefixLength);

  if (element.kind === 'centered' && raw.endsWith('<')) {
    addMark(ranges, fountainMarker, contentEnd - 1, contentEnd);
  }
  if (element.kind === 'character') addCharacterSyntaxMarks(ranges, element, raw, contentEnd);
  if (element.kind === 'scene_heading') addSceneSyntaxMarks(ranges, element, raw);
  if (element.kind === 'title_page') addTitlePageSyntaxMarks(ranges, element);
}

function addAnnotationSyntaxMarks(
  ranges: Range<Decoration>[],
  annotation: FountainAnnotation,
): void {
  addMark(
    ranges,
    Decoration.mark({ class: classForAnnotation[annotation.kind] }),
    annotation.start,
    annotation.end,
  );
  addMark(ranges, fountainMarker, annotation.start, annotation.contentStart);
  addMark(ranges, fountainMarker, annotation.contentEnd, annotation.end);
}

const toggleBoneyard = StateEffect.define<number>();

class BoneyardWidget extends WidgetType {
  constructor(
    private readonly sourceStart: number,
    private readonly length: number,
    private readonly expanded: boolean,
    private readonly importedMetadata: boolean,
  ) {
    super();
  }

  eq(other: BoneyardWidget): boolean {
    return (
      this.sourceStart === other.sourceStart &&
      this.length === other.length &&
      this.expanded === other.expanded &&
      this.importedMetadata === other.importedMetadata
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = this.expanded
      ? 'cm-fountain-boneyard-collapse'
      : 'cm-fountain-boneyard-summary';
    button.textContent = this.expanded
      ? 'Collapse boneyard'
      : `${this.importedMetadata ? 'Imported revision metadata' : 'Boneyard comment'} · ${this.length.toLocaleString()} characters`;
    button.setAttribute('aria-expanded', String(this.expanded));
    button.addEventListener('click', (event) => {
      event.preventDefault();
      view.dispatch({ effects: toggleBoneyard.of(this.sourceStart) });
      view.focus();
    });
    return button;
  }
}

interface LineDecorationContext {
  kinds: FountainLineKind[];
  sectionDepths: ReadonlyMap<number, number>;
  sceneLabels: ReadonlyMap<number, string>;
  pageLabels: ReadonlyMap<number, { index: number; label: string }>;
}

function buildLineDecorationContext(
  state: EditorState,
  document: FountainDocument,
  preview: ScreenplayPreviewModel | undefined,
): LineDecorationContext {
  const kinds = classifyDocumentLines(
    document,
    Array.from<FountainLineKind>({ length: state.doc.lines }).fill('action'),
  );
  const sectionDepths = new Map<number, number>();
  const sceneLabels = new Map(
    (preview?.scenes ?? []).map((scene, index) => [
      scene.line - 1,
      scene.sceneNumber ?? String(index + 1),
    ]),
  );
  const pageLabels = new Map<number, { index: number; label: string }>();
  for (const page of preview?.pages ?? []) {
    const firstSourceLine = page.lines.find((line) => !line.continuation) ?? page.lines[0];
    if (page.pageNumber === null || !firstSourceLine) continue;
    const offset = Math.min(Math.max(0, firstSourceLine.sourceStart), state.doc.length);
    pageLabels.set(state.doc.lineAt(offset).number - 1, {
      index: page.pageNumber,
      label: page.printedPageNumber ?? String(page.pageNumber),
    });
  }
  for (const element of document.elements) {
    if (element.kind === 'section') sectionDepths.set(element.lineStart, element.depth);
  }
  return { kinds, sectionDepths, sceneLabels, pageLabels };
}

function lineDecorationRanges(
  state: EditorState,
  context: LineDecorationContext,
): Range<Decoration>[] {
  const ranges: Range<Decoration>[] = [];
  for (let number = 1; number <= state.doc.lines; number += 1) {
    const line = state.doc.line(number);
    const kind = context.kinds[number - 1] ?? 'action';
    const sectionDepth = context.sectionDepths.get(number - 1);
    const sectionClass = sectionDepth
      ? ` cm-fountain-section-depth-${String(Math.min(sectionDepth, 6))}`
      : '';
    const attributes: Record<string, string> = { 'data-fountain-kind': kind };
    if (sectionDepth) attributes['data-fountain-section-depth'] = String(sectionDepth);
    const sceneLabel = context.sceneLabels.get(number - 1);
    const pageLabel = context.pageLabels.get(number - 1);
    if (sceneLabel) attributes['data-fountain-scene-label'] = sceneLabel;
    if (pageLabel) {
      attributes['data-fountain-page-index'] = String(pageLabel.index);
      attributes['data-fountain-page-label'] = pageLabel.label;
    }
    ranges.push(
      Decoration.line({
        attributes,
        class: `${classForKind[kind]}${sectionClass}`,
      }).range(line.from),
    );
  }
  return ranges;
}

function addElementDecorations(
  ranges: Range<Decoration>[],
  document: FountainDocument,
  expanded: ReadonlySet<number>,
): void {
  for (const element of document.elements) {
    addElementSyntaxMarks(ranges, element);
    if (element.kind !== 'boneyard' || element.text.length < 240) continue;
    const isExpanded = expanded.has(element.start);
    const widget = new BoneyardWidget(
      element.start,
      element.text.length,
      isExpanded,
      element.text.includes('Review Ranges') || element.text.includes('RemovalSuggestion'),
    );
    const range = isExpanded
      ? Decoration.widget({ widget, side: -1 }).range(element.start)
      : Decoration.replace({ widget }).range(element.start, element.end);
    ranges.push(range);
  }
}

function buildDecorations(state: EditorState, expanded: ReadonlySet<number>): DecorationSet {
  const source = state.doc.toString();
  const document = parseFountain(source);
  const preview = state.facet(screenplayPreviewFacet);
  const ranges = lineDecorationRanges(state, buildLineDecorationContext(state, document, preview));
  addElementDecorations(ranges, document, expanded);
  for (const annotation of document.annotations) {
    addAnnotationSyntaxMarks(ranges, annotation);
  }
  return Decoration.set(ranges, true);
}

interface FountainDecorationState {
  decorations: DecorationSet;
  expanded: ReadonlySet<number>;
}

const installFountainDecorations = StateEffect.define<DecorationSet>();

const fountainDecorations = StateField.define<FountainDecorationState>({
  create(state) {
    const expanded = new Set<number>();
    return { decorations: buildDecorations(state, expanded), expanded };
  },
  update(value, transaction) {
    const expanded = new Set(
      transaction.docChanged
        ? [...value.expanded].map((position) => transaction.changes.mapPos(position, 1))
        : value.expanded,
    );
    let toggled = false;
    for (const effect of transaction.effects) {
      if (effect.is(installFountainDecorations)) {
        return { decorations: effect.value, expanded };
      }
      if (!effect.is(toggleBoneyard)) continue;
      toggled = true;
      if (expanded.has(effect.value)) expanded.delete(effect.value);
      else expanded.add(effect.value);
    }
    if (toggled) return { decorations: buildDecorations(transaction.state, expanded), expanded };
    if (transaction.docChanged) {
      return { decorations: value.decorations.map(transaction.changes), expanded };
    }
    return value;
  },
  provide: (field) => EditorView.decorations.from(field, (value) => value.decorations),
});

/**
 * Rebuild whole-document Fountain decorations after the editor has been idle.
 * Mapping the existing decoration tree through an edit keeps typing immediate;
 * parsing and pagination-derived labels are refreshed once the burst settles.
 */
const deferredFountainDecorationRefresh = ViewPlugin.fromClass(
  class {
    private timeout: number | undefined;

    constructor(private readonly view: EditorView) {}

    update(update: ViewUpdate): void {
      if (
        !update.docChanged &&
        !update.transactions.some((transaction) => transaction.reconfigured)
      ) {
        return;
      }
      this.schedule();
    }

    destroy(): void {
      if (this.timeout !== undefined) window.clearTimeout(this.timeout);
    }

    private schedule(): void {
      if (this.timeout !== undefined) window.clearTimeout(this.timeout);
      this.timeout = window.setTimeout(() => {
        this.timeout = undefined;
        const state = this.view.state;
        const expanded = state.field(fountainDecorations).expanded;
        const decorations = buildDecorations(state, expanded);
        if (this.view.state.doc !== state.doc) {
          this.schedule();
          return;
        }
        this.view.dispatch({ effects: installFountainDecorations.of(decorations) });
      }, 120);
    }
  },
);

export function fountainSyntax(
  paperSize: ScreenplayPaperSize = 'letter',
  preview?: ScreenplayPreviewModel,
): Extension {
  return [
    screenplayPaperFacet.of(paperSize),
    screenplayPreviewFacet.of(preview),
    fountainDecorations,
    deferredFountainDecorationRefresh,
  ];
}
