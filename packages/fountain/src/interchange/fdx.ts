import {
  DOMImplementation,
  DOMParser,
  XMLSerializer,
  type Document,
  type Element,
  type Node,
} from '@xmldom/xmldom';
import { matchSceneHeading } from '../classification';
import { parseFountain } from '../parser';
import type { FountainElement, FountainTitlePageElement } from '../types';
import { requireNonEmptySource, type ScreenplayInput } from './input';
import {
  ScreenplayInterchangeError,
  type ScreenplayExportResult,
  type ScreenplayImportResult,
} from './types';

const XML_DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="no"?>';
const UNSAFE_XML = /<!DOCTYPE|<!ENTITY/iu;

const TITLE_FIELD_BY_FDX_TYPE: Readonly<Record<string, string>> = {
  title: 'Title',
  credit: 'Credit',
  author: 'Author',
  authors: 'Authors',
  source: 'Source',
  'draft date': 'Draft date',
  contact: 'Contact',
  notes: 'Notes',
};

export function importFinalDraft(input: ScreenplayInput): ScreenplayImportResult {
  const source = requireNonEmptySource(input);
  const document = parseFinalDraftDocument(source);
  const warnings = new Set<string>();
  const root = requireDocumentElement(document);
  const titleSource = importTitlePage(root, warnings);
  const content = directChild(root, 'Content');
  if (!content) {
    throw new ScreenplayInterchangeError('INVALID_FDX', 'The Final Draft document has no Content element.', {
      format: 'final-draft',
    });
  }

  const writer = new FountainWriter();
  importContent(content, writer, warnings);
  const body = writer.toString();
  const fountain = [titleSource, body].filter((part) => part.trim() !== '').join('\n\n');
  if (fountain.trim() === '') {
    throw new ScreenplayInterchangeError('INVALID_FDX', 'The Final Draft document contains no screenplay text.', {
      format: 'final-draft',
    });
  }

  return {
    fountain: `${fountain.replace(/\s+$/u, '')}\n`,
    sourceFormat: 'final-draft',
    fidelity: 'lossy',
    warnings: [...warnings],
  };
}

export function exportFinalDraft(fountain: string): ScreenplayExportResult {
  if (fountain.trim() === '') {
    throw new ScreenplayInterchangeError('EMPTY_INPUT', 'The screenplay is empty.');
  }
  const screenplay = parseFountain(fountain);
  const warnings = new Set<string>();
  const document = new DOMImplementation().createDocument(null, 'FinalDraft');
  const root = requireDocumentElement(document);
  root.setAttribute('DocumentType', 'Script');
  root.setAttribute('Template', 'No');
  root.setAttribute('Version', '5');

  const content = appendElement(document, root, 'Content');
  const titlePage = screenplay.elements.find(
    (element): element is FountainTitlePageElement => element.kind === 'title_page',
  );
  for (const element of screenplay.elements) appendFdxElement(document, content, element, warnings);
  if (titlePage) appendTitlePage(document, root, titlePage, warnings);

  let serialized: string;
  try {
    serialized = new XMLSerializer().serializeToString(document, { requireWellFormed: true });
  } catch (error) {
    throw new ScreenplayInterchangeError(
      'SERIALIZATION_FAILED',
      'The screenplay contains text that cannot be represented in a valid FDX document.',
      { cause: error, format: 'final-draft' },
    );
  }
  return {
    content: `${XML_DECLARATION}\n${serialized}`,
    targetFormat: 'final-draft',
    mimeType: 'application/xml',
    suggestedExtension: '.fdx',
    fidelity: 'lossy',
    warnings: [...warnings],
  };
}

function parseFinalDraftDocument(source: string): Document {
  if (UNSAFE_XML.test(source)) {
    throw new ScreenplayInterchangeError(
      'UNSAFE_XML',
      'Final Draft files containing document types or entity declarations are not accepted.',
      { format: 'final-draft' },
    );
  }
  try {
    const errors: string[] = [];
    const parser = new DOMParser({
      onError(level, message) {
        if (level !== 'warning') errors.push(message);
      },
    });
    const document = parser.parseFromString(source, 'application/xml');
    if (errors.length > 0) throw new Error(errors.join('; '));
    if (document.documentElement?.localName !== 'FinalDraft') {
      throw new ScreenplayInterchangeError(
        'INVALID_FDX',
        'The XML root element must be FinalDraft.',
        { format: 'final-draft' },
      );
    }
    return document;
  } catch (error) {
    if (error instanceof ScreenplayInterchangeError) throw error;
    throw new ScreenplayInterchangeError('MALFORMED_XML', 'The Final Draft XML is malformed.', {
      cause: error,
      format: 'final-draft',
    });
  }
}

function requireDocumentElement(document: Document): Element {
  const root = document.documentElement;
  if (!root) {
    throw new ScreenplayInterchangeError('MALFORMED_XML', 'The XML document has no root element.', {
      format: 'final-draft',
    });
  }
  return root;
}

function importTitlePage(root: Element, warnings: Set<string>): string {
  const titlePage = directChild(root, 'TitlePage');
  const content = titlePage ? directChild(titlePage, 'Content') : undefined;
  if (!content) return '';

  const values = new Map<string, string[]>();
  for (const paragraph of directChildren(content, 'Paragraph')) {
    const fdxType = paragraph.getAttribute('Type')?.trim() ?? '';
    const key = TITLE_FIELD_BY_FDX_TYPE[fdxType.toLowerCase()];
    const text = paragraphText(paragraph).trim();
    if (!key || text === '') {
      if (text !== '') warnings.add(`Unsupported Final Draft title-page field “${fdxType || 'Unknown'}” was omitted.`);
      continue;
    }
    const current = values.get(key) ?? [];
    current.push(text);
    values.set(key, current);
  }

  return [...values.entries()]
    .map(([key, lines]) => formatTitleField(key, lines))
    .join('\n');
}

function importContent(content: Element, writer: FountainWriter, warnings: Set<string>): void {
  for (const child of directChildren(content)) {
    if (child.localName === 'DualDialogue') {
      importDualDialogue(child, writer, warnings);
    } else if (child.localName === 'Paragraph') {
      importParagraph(child, writer, warnings, false);
    } else {
      warnings.add(`Unsupported Final Draft content element “${child.localName ?? child.nodeName}” was omitted.`);
    }
  }
}

function importDualDialogue(element: Element, writer: FountainWriter, warnings: Set<string>): void {
  let cueIndex = 0;
  for (const paragraph of descendantElements(element, 'Paragraph')) {
    const isCharacter = normalizedType(paragraph) === 'character';
    if (isCharacter) cueIndex += 1;
    importParagraph(paragraph, writer, warnings, isCharacter && cueIndex > 1);
  }
  warnings.add('Dual dialogue was preserved as Fountain dual-dialogue markup; exact column layout may differ.');
}

function importParagraph(
  paragraph: Element,
  writer: FountainWriter,
  warnings: Set<string>,
  dual: boolean,
): void {
  const type = normalizedType(paragraph);
  const text = paragraphText(paragraph).replace(/\r\n?/gu, '\n').trimEnd();
  if (paragraph.getAttribute('StartsNewPage')?.toLowerCase() === 'yes') writer.block('===');

  switch (type) {
    case 'scene heading': {
      if (text.trim() === '') {
        warnings.add('An empty Final Draft scene heading was omitted.');
        return;
      }
      const numbered = withSceneNumber(text, paragraph.getAttribute('Number'));
      writer.block(matchSceneHeading(numbered) ? numbered : `.${numbered}`);
      return;
    }
    case 'action':
      writer.action(text);
      return;
    case 'character':
      if (text.trim() === '') {
        warnings.add('An empty Final Draft character cue was omitted.');
      } else {
        writer.character(formatCharacterCue(text, dual));
      }
      return;
    case 'parenthetical':
      if (!writer.dialogueLine(text.startsWith('(') ? text : `(${text})`)) {
        warnings.add('A parenthetical without a character cue was imported as action.');
      }
      return;
    case 'dialogue':
      if (!writer.dialogueLine(text)) {
        warnings.add('Dialogue without a character cue was imported as action.');
      }
      return;
    case 'transition':
      writer.block(text.endsWith('TO:') && text === text.toUpperCase() ? text : `>${text}`);
      return;
    case 'page break':
      writer.block('===');
      return;
    case 'shot':
      writer.action(text);
      warnings.add('Final Draft Shot paragraphs were imported as forced action.');
      return;
    case '':
      writer.action(text);
      return;
    default:
      writer.action(text);
      warnings.add(`Final Draft paragraph type “${paragraph.getAttribute('Type') ?? type}” was imported as action.`);
  }
}

function appendFdxElement(
  document: Document,
  content: Element,
  element: FountainElement,
  warnings: Set<string>,
): void {
  switch (element.kind) {
    case 'title_page':
    case 'separator':
      return;
    case 'scene_heading': {
      const paragraph = appendParagraph(document, content, 'Scene Heading', element.text);
      if (element.sceneNumber) paragraph.setAttribute('Number', element.sceneNumber);
      return;
    }
    case 'action':
      appendParagraph(document, content, 'Action', element.text);
      return;
    case 'character': {
      const cue = `${element.name}${element.extension ? ` ${element.extension}` : ''}`;
      const paragraph = appendParagraph(document, content, 'Character', cue);
      if (element.dual) {
        paragraph.setAttribute('DualDialogue', 'Yes');
        warnings.add('Fountain dual-dialogue intent was retained as metadata; exact column layout may differ.');
      }
      return;
    }
    case 'parenthetical':
      appendParagraph(document, content, 'Parenthetical', element.text);
      return;
    case 'dialogue':
      appendParagraph(document, content, 'Dialogue', element.text);
      return;
    case 'transition':
      appendParagraph(document, content, 'Transition', element.text);
      return;
    case 'page_break': {
      const paragraph = appendParagraph(document, content, 'Action', '');
      paragraph.setAttribute('StartsNewPage', 'Yes');
      return;
    }
    case 'centered': {
      const paragraph = appendParagraph(document, content, 'Action', element.text);
      paragraph.setAttribute('Alignment', 'Center');
      warnings.add('Centered Fountain text was exported as centered action.');
      return;
    }
    case 'lyric':
      appendParagraph(document, content, 'Action', element.text);
      warnings.add('Fountain lyrics were exported as action.');
      return;
    case 'section':
    case 'synopsis':
    case 'note':
    case 'boneyard':
      warnings.add(`Fountain ${element.kind.replace('_', ' ')} content is not representable in FDX and was omitted.`);
  }
}

function appendTitlePage(
  document: Document,
  root: Element,
  titlePage: FountainTitlePageElement,
  warnings: Set<string>,
): void {
  const container = appendElement(document, root, 'TitlePage');
  const content = appendElement(document, container, 'Content');
  for (const field of titlePage.fields) {
    const type = canonicalTitleType(field.key);
    if (!type) {
      warnings.add(`Fountain title-page field “${field.key}” is not representable in FDX and was omitted.`);
      continue;
    }
    for (const line of field.value.split('\n')) appendParagraph(document, content, type, line);
  }
}

function appendParagraph(
  document: Document,
  parent: Element,
  type: string,
  text: string,
): Element {
  const paragraph = appendElement(document, parent, 'Paragraph');
  paragraph.setAttribute('Type', type);
  const textElement = appendElement(document, paragraph, 'Text');
  if (text !== '') textElement.appendChild(document.createTextNode(text));
  return paragraph;
}

function appendElement(document: Document, parent: Node, name: string): Element {
  const element = document.createElement(name);
  parent.appendChild(element);
  return element;
}

function directChild(parent: Element, name: string): Element | undefined {
  return directChildren(parent, name)[0];
}

function directChildren(parent: Element, name?: string): Element[] {
  const elements: Element[] = [];
  for (let index = 0; index < parent.childNodes.length; index += 1) {
    const child = parent.childNodes.item(index);
    if (child?.nodeType === 1 && (!name || child.localName === name)) elements.push(child as Element);
  }
  return elements;
}

function descendantElements(parent: Element, name: string): Element[] {
  const matches = parent.getElementsByTagName(name);
  return Array.from({ length: matches.length }, (_, index) => matches.item(index)).filter(
    (element): element is Element => element !== null,
  );
}

function paragraphText(paragraph: Element): string {
  const textElements = paragraph.getElementsByTagName('Text');
  const parts: string[] = [];
  for (let index = 0; index < textElements.length; index += 1) {
    const text = textElements.item(index)?.textContent;
    if (text) parts.push(text);
  }
  return parts.join('');
}

function normalizedType(paragraph: Element): string {
  return paragraph.getAttribute('Type')?.trim().toLowerCase() ?? '';
}

function withSceneNumber(text: string, number: string | null): string {
  const trimmedNumber = number?.trim();
  return trimmedNumber && !/\s+#[^#\r\n]+#\s*$/u.test(text) ? `${text} #${trimmedNumber}#` : text;
}

function formatCharacterCue(text: string, dual: boolean): string {
  const candidate = text.trim();
  const forced = candidate !== candidate.toUpperCase() ? `@${candidate}` : candidate;
  return dual ? `${forced}^` : forced;
}

function formatTitleField(key: string, values: readonly string[]): string {
  const lines = values.flatMap((value) => value.split('\n'));
  const first = lines[0] ?? '';
  const rest = lines.slice(1).map((line) => `   ${line}`);
  return [`${key}: ${first}`, ...rest].join('\n');
}

function canonicalTitleType(key: string): string | undefined {
  const normalized = key.trim().toLowerCase();
  const canonical = TITLE_FIELD_BY_FDX_TYPE[normalized];
  return canonical === 'Authors' ? 'Author' : canonical;
}

class FountainWriter {
  private readonly lines: string[] = [];
  private dialogueOpen = false;

  block(text: string): void {
    this.ensureBlank();
    this.lines.push(...text.split('\n'));
    this.dialogueOpen = false;
  }

  action(text: string): void {
    for (const line of text.split('\n')) {
      if (line !== '') this.block(`!${line}`);
    }
  }

  character(text: string): void {
    this.ensureBlank();
    this.lines.push(text);
    this.dialogueOpen = true;
  }

  dialogueLine(text: string): boolean {
    if (!this.dialogueOpen) {
      this.action(text);
      return false;
    }
    this.lines.push(...text.split('\n'));
    return true;
  }

  toString(): string {
    return this.lines.join('\n').trim();
  }

  private ensureBlank(): void {
    if (this.lines.length > 0 && this.lines.at(-1) !== '') this.lines.push('');
  }
}
