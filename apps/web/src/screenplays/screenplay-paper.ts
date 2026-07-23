export const screenplayPaperSizes = ['letter', 'a4'] as const;
export type ScreenplayPaperSize = (typeof screenplayPaperSizes)[number];

/**
 * Screenplay geometry measured in PostScript points. Coordinates in layout
 * models use a PDF-style bottom-left origin so the browser and PDF renderer
 * consume the same placements without independently typesetting.
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
  sceneHeadingBaselineStep: number;
  fontSize: number;
  /** Primary PDF font advance at the configured font size. */
  fontAdvance: number;
  /** Screenplay layout `ch` unit. */
  glyphWidth: number;
  linesPerPage: number;
}

const FONT_SIZE = 12;
const LINE_HEIGHT = 12;
interface PaperSpecificationInput {
  id: ScreenplayPaperSize;
  label: string;
  shortLabel: string;
  widthPoints: number;
  heightPoints: number;
  bodyFrameLeft: number;
  leftMargin: number;
  glyphWidth: number;
  fontAdvance: number;
  firstBodyBaseline: number;
  subsequentBodyBaseline: number;
  lastBodyBaseline: number;
  pageNumberBaseline: number;
  pageNumberRight: number;
  sceneNumberLeft: number;
  sceneNumberRight: number;
  revisionMarkLeft: number;
  linesPerPage: number;
  sceneHeadingBaselineStep: number;
  actionColumns: number;
  sceneHeadingColumns: number;
  characterColumns: number;
  dualCharacterColumns: number;
  dualDialogueColumns: number;
  dualParentheticalColumns: number;
}

function specification(input: PaperSpecificationInput): ScreenplayPaperSpecification {
  const rightEdge = input.leftMargin + input.actionColumns * input.glyphWidth;
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
    bodyTop: input.firstBodyBaseline,
    bodyBottom: input.lastBodyBaseline,
    leftMargin: input.leftMargin,
    rightEdge,
    sceneNumberLeft: input.sceneNumberLeft,
    sceneNumberRight: input.sceneNumberRight,
    pageNumberRight: input.pageNumberRight,
    pageNumberTop: input.heightPoints - input.pageNumberBaseline - FONT_SIZE,
    pageNumberBaseline: input.pageNumberBaseline,
    revisionMarkLeft: input.revisionMarkLeft,
    lineHeight: LINE_HEIGHT,
    sceneHeadingBaselineStep: input.sceneHeadingBaselineStep,
    fontSize: FONT_SIZE,
    fontAdvance: input.fontAdvance,
    glyphWidth: input.glyphWidth,
    firstBodyBaseline: input.firstBodyBaseline,
    subsequentBodyBaseline: input.subsequentBodyBaseline,
    lastBodyBaseline: input.lastBodyBaseline,
    linesPerPage: input.linesPerPage,
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
      leftMargin: 102.75,
      glyphWidth: 7.25,
      fontAdvance: (1228 / 2048) * FONT_SIZE,
      firstBodyBaseline: 719,
      subsequentBodyBaseline: 719.5,
      lastBodyBaseline: 59,
      pageNumberBaseline: 755.5,
      pageNumberRight: 571,
      sceneNumberLeft: 52.5,
      sceneNumberRight: 558.5,
      revisionMarkLeft: 572,
      linesPerPage: 56,
      sceneHeadingBaselineStep: 0,
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
      widthPoints: 595.28,
      heightPoints: 841.89,
      bodyFrameLeft: 100.75,
      leftMargin: 100.75,
      glyphWidth: 7.25,
      fontAdvance: (1228 / 2048) * FONT_SIZE,
      firstBodyBaseline: 769,
      subsequentBodyBaseline: 769,
      lastBodyBaseline: 73,
      pageNumberBaseline: 805.5,
      pageNumberRight: 554,
      sceneNumberLeft: 50.5,
      sceneNumberRight: 541.5,
      revisionMarkLeft: 568,
      linesPerPage: 59,
      sceneHeadingBaselineStep: 0.5,
      actionColumns: 60,
      sceneHeadingColumns: 60,
      characterColumns: 38,
      dualCharacterColumns: 20,
      dualDialogueColumns: 27,
      dualParentheticalColumns: 25,
    }),
  });

export function screenplayPaper(size: ScreenplayPaperSize): ScreenplayPaperSpecification {
  return SCREENPLAY_PAPER[size];
}
