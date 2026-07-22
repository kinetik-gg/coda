import { collectAnnotations } from './annotations';
import { isDialogueFollower, matchCharacter } from './classification';
import { actionElement, base, normalizedLineText, parseStandaloneElement } from './elements';
import { detectLineEnding, parsingText, splitSourceLines } from './source-lines';
import { parseTitlePage } from './title-page';
import { parseEmbeddedRevisionMetadata } from './revision-metadata';
import type { FountainDocument, FountainElement, FountainSourceLine } from './types';

export function parseFountain(source: string): FountainDocument {
  const lines = splitSourceLines(source);
  const elements: FountainElement[] = [];
  const titlePage = parseTitlePage(source, lines);
  let cursor = titlePage?.nextLine ?? 0;
  if (titlePage) elements.push(titlePage.element);

  while (cursor < lines.length) {
    const standalone = parseStandaloneElement(source, lines, cursor);
    if (standalone) {
      elements.push(standalone.element);
      cursor = standalone.nextLine;
      continue;
    }

    const character = parseCharacterBlock(source, lines, cursor);
    if (character) {
      elements.push(...character.elements);
      cursor = character.nextLine;
      continue;
    }

    const actionEnd = findActionEnd(source, lines, cursor);
    elements.push(actionElement(source, lines, cursor, actionEnd));
    cursor = actionEnd + 1;
  }

  const annotations = collectAnnotations(source);
  const revisionMetadata = parseEmbeddedRevisionMetadata(source, annotations);
  return {
    source,
    hasBom: source.startsWith('\uFEFF'),
    lineEnding: detectLineEnding(lines),
    elements,
    annotations,
    ...(revisionMetadata ? { revisionMetadata } : {}),
  };
}

export function serializeFountain(document: FountainDocument): string {
  return document.source;
}

function parseCharacterBlock(
  source: string,
  lines: readonly FountainSourceLine[],
  index: number,
): { elements: FountainElement[]; nextLine: number } | undefined {
  const line = lines[index];
  const next = lines[index + 1];
  if (!line || !next) return undefined;
  const match = matchCharacter(parsingText(line));
  if (!match || !hasCharacterContext(lines, index, match.forced)) return undefined;

  const elements: FountainElement[] = [base(source, line, line, { kind: 'character', ...match })];
  let cursor = index + 1;
  let dialogueStart: number | undefined;

  const flushDialogue = (endIndex: number): void => {
    if (dialogueStart === undefined) return;
    const first = lines[dialogueStart];
    const last = lines[endIndex];
    if (first && last) {
      elements.push(
        base(source, first, last, {
          kind: 'dialogue',
          text: normalizedLineText(lines, dialogueStart, endIndex),
        }),
      );
    }
    dialogueStart = undefined;
  };

  while (cursor < lines.length) {
    const dialogueLine = lines[cursor];
    if (!dialogueLine || parsingText(dialogueLine) === '') break;
    const trimmed = parsingText(dialogueLine).trim();
    if (isParenthetical(trimmed)) {
      flushDialogue(cursor - 1);
      elements.push(
        base(source, dialogueLine, dialogueLine, { kind: 'parenthetical', text: trimmed }),
      );
    } else if (trimmed.startsWith('~')) {
      flushDialogue(cursor - 1);
      elements.push(
        base(source, dialogueLine, dialogueLine, { kind: 'lyric', text: trimmed.slice(1) }),
      );
    } else {
      dialogueStart ??= cursor;
    }
    cursor += 1;
  }
  flushDialogue(cursor - 1);
  return { elements, nextLine: cursor };
}

function hasCharacterContext(
  lines: readonly FountainSourceLine[],
  index: number,
  forced: boolean,
): boolean {
  const next = lines[index + 1];
  if (!next || !isDialogueFollower(parsingText(next))) return false;
  if (forced || index === 0) return true;
  const previous = lines[index - 1];
  return previous ? parsingText(previous).trim() === '' : true;
}

function findActionEnd(
  source: string,
  lines: readonly FountainSourceLine[],
  startIndex: number,
): number {
  let cursor = startIndex + 1;
  while (cursor < lines.length) {
    if (parseStandaloneElement(source, lines, cursor)) break;
    if (parseCharacterBlock(source, lines, cursor)) break;
    cursor += 1;
  }
  return cursor - 1;
}

function isParenthetical(text: string): boolean {
  return text.startsWith('(') && text.endsWith(')');
}
