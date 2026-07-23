export const screenplayPaperSizes = ['letter', 'a4'] as const;
export type ScreenplayPaperSize = (typeof screenplayPaperSizes)[number];

/**
 * Clean-room screenplay geometry measured in PostScript points. Coordinates in
 * layout models use a PDF-style bottom-left origin so the browser and PDF
 * renderer can consume the same placements without independently typesetting.
 */
export interface ScreenplayPaperSpecification {
  id: ScreenplayPaperSize;
  label: string;
  shortLabel: string;
  widthPoints: number;
  heightPoints: number;
  editorColumns: number;
  actionColumns: number;
  sceneHeadingColumns: number;
  characterColumns: number;
  dialogueColumns: number;
  parentheticalColumns: number;
  dualCharacterColumns: number;
  dualDialogueColumns: number;
  dualParentheticalColumns: number;
  bodyFrameLeft: number;
  bodyTop: number;
  bodyBottom: number;
  firstBodyBaseline: number;
  subsequentBodyBaseline: number;
  lastBodyBaseline: number;
  leftMargin: number;
  rightEdge: number;
  sceneNumberLeft: number;
  sceneNumberRight: number;
  pageNumberRight: number;
  pageNumberTop: number;
  pageNumberBaseline: number;
  revisionMarkLeft: number;
  lineHeight: number;
  fontSize: number;
  /** Actual Courier Prime glyph advance at the configured font size. */
  fontAdvance: number;
  /** Screenplay layout `ch` unit, intentionally slightly wider than the font advance. */
  glyphWidth: number;
  linesPerPage: number;
}

const FONT_SIZE = 12;
const LINE_HEIGHT = 12;
// Courier Prime at the canonical 12pt screenplay size.
const COURIER_PRIME_GLYPH_WIDTH = 7.25;
const COURIER_PRIME_FONT_ADVANCE = (1228 / 2048) * FONT_SIZE;
const HEADER_RESERVATION = 36;
const TOP_MARGIN = 40;

interface PaperSpecificationInput {
  id: ScreenplayPaperSize;
  label: string;
  shortLabel: string;
  widthPoints: number;
  heightPoints: number;
  bodyFrameLeft: number;
  bottomMargin: number;
  actionColumns: number;
  sceneHeadingColumns: number;
  characterColumns: number;
  dualCharacterColumns: number;
  dualDialogueColumns: number;
  dualParentheticalColumns: number;
}

function specification(input: PaperSpecificationInput): ScreenplayPaperSpecification {
  const bodyTop = input.heightPoints - TOP_MARGIN - HEADER_RESERVATION + LINE_HEIGHT;
  const bodyBottom = input.bottomMargin + LINE_HEIGHT;
  const leftMargin = input.bodyFrameLeft + 7 * COURIER_PRIME_GLYPH_WIDTH;
  return Object.freeze({
    id: input.id,
    label: input.label,
    shortLabel: input.shortLabel,
    widthPoints: input.widthPoints,
    heightPoints: input.heightPoints,
    editorColumns: input.actionColumns,
    actionColumns: input.actionColumns,
    sceneHeadingColumns: input.sceneHeadingColumns,
    characterColumns: input.characterColumns,
    dialogueColumns: 35,
    parentheticalColumns: 28,
    dualCharacterColumns: input.dualCharacterColumns,
    dualDialogueColumns: input.dualDialogueColumns,
    dualParentheticalColumns: input.dualParentheticalColumns,
    bodyFrameLeft: input.bodyFrameLeft,
    bodyTop,
    bodyBottom,
    leftMargin,
    rightEdge: leftMargin + input.actionColumns * COURIER_PRIME_GLYPH_WIDTH,
    sceneNumberLeft: input.bodyFrameLeft + 0.5,
    sceneNumberRight: input.widthPoints - 53.5,
    pageNumberRight: input.widthPoints - 41,
    pageNumberTop: 28,
    pageNumberBaseline: input.heightPoints - 36.5,
    revisionMarkLeft: input.widthPoints - 40,
    lineHeight: LINE_HEIGHT,
    fontSize: FONT_SIZE,
    fontAdvance: COURIER_PRIME_FONT_ADVANCE,
    glyphWidth: COURIER_PRIME_GLYPH_WIDTH,
    firstBodyBaseline: input.heightPoints - 73,
    subsequentBodyBaseline: input.heightPoints - 72.5,
    lastBodyBaseline:
      input.heightPoints - 73 - Math.floor((bodyTop - bodyBottom) / LINE_HEIGHT) * LINE_HEIGHT,
    linesPerPage: Math.floor((bodyTop - bodyBottom) / LINE_HEIGHT) + 1,
  });
}

export const SCREENPLAY_PAPER: Readonly<Record<ScreenplayPaperSize, ScreenplayPaperSpecification>> =
  Object.freeze({
    letter: specification({
      id: 'letter',
      label: 'US Letter (8.5 × 11 in)',
      shortLabel: 'Letter',
      widthPoints: 612,
      heightPoints: 792,
      bodyFrameLeft: 52,
      bottomMargin: 50,
      actionColumns: 63,
      sceneHeadingColumns: 57,
      characterColumns: 40,
      dualCharacterColumns: 21,
      dualDialogueColumns: 28,
      dualParentheticalColumns: 26,
    }),
    a4: specification({
      id: 'a4',
      label: 'A4 (210 × 297 mm)',
      shortLabel: 'A4',
      widthPoints: 595,
      heightPoints: 842,
      bodyFrameLeft: 50,
      bottomMargin: 60,
      actionColumns: 60,
      sceneHeadingColumns: 55,
      characterColumns: 38,
      dualCharacterColumns: 20,
      dualDialogueColumns: 27,
      dualParentheticalColumns: 25,
    }),
  });

export function screenplayPaper(size: ScreenplayPaperSize): ScreenplayPaperSpecification {
  return SCREENPLAY_PAPER[size];
}
