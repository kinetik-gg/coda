export interface FountainRange {
  start: number;
  end: number;
}

export type FountainLineEnding = 'lf' | 'crlf' | 'mixed' | 'none';

export type FountainAnnotation = FountainDelimitedAnnotation | FountainEmphasisAnnotation;

export interface FountainDelimitedAnnotation extends FountainRange {
  kind: 'note' | 'boneyard';
  contentStart: number;
  contentEnd: number;
  closed: boolean;
}

export interface FountainEmphasisAnnotation extends FountainRange {
  kind: 'italic' | 'bold' | 'bold_italic' | 'underline';
  contentStart: number;
  contentEnd: number;
}

interface FountainElementBase extends FountainRange {
  raw: string;
  lineStart: number;
  lineEnd: number;
}

export interface FountainTitleField extends FountainRange {
  key: string;
  value: string;
  valueLines: readonly string[];
  raw: string;
}

export interface FountainTitlePageElement extends FountainElementBase {
  kind: 'title_page';
  fields: readonly FountainTitleField[];
}

export interface FountainSeparatorElement extends FountainElementBase {
  kind: 'separator';
}

export interface FountainSceneHeadingElement extends FountainElementBase {
  kind: 'scene_heading';
  text: string;
  forced: boolean;
  sceneNumber?: string;
}

export interface FountainActionElement extends FountainElementBase {
  kind: 'action';
  text: string;
  forced: boolean;
}

export interface FountainCharacterElement extends FountainElementBase {
  kind: 'character';
  name: string;
  extension?: string;
  forced: boolean;
  dual: boolean;
}

export interface FountainDialogueElement extends FountainElementBase {
  kind: 'dialogue';
  text: string;
}

export interface FountainParentheticalElement extends FountainElementBase {
  kind: 'parenthetical';
  text: string;
}

export interface FountainLyricElement extends FountainElementBase {
  kind: 'lyric';
  text: string;
}

export interface FountainTransitionElement extends FountainElementBase {
  kind: 'transition';
  text: string;
  forced: boolean;
}

export interface FountainCenteredElement extends FountainElementBase {
  kind: 'centered';
  text: string;
}

export interface FountainSectionElement extends FountainElementBase {
  kind: 'section';
  text: string;
  depth: number;
}

export interface FountainSynopsisElement extends FountainElementBase {
  kind: 'synopsis';
  text: string;
}

export type FountainMarkerTextElement =
  | FountainLyricElement
  | FountainTransitionElement
  | FountainCenteredElement
  | FountainSectionElement
  | FountainSynopsisElement;

export interface FountainPageBreakElement extends FountainElementBase {
  kind: 'page_break';
}

export interface FountainCommentElement extends FountainElementBase {
  kind: 'note' | 'boneyard';
  text: string;
  closed: boolean;
}

export type FountainElement =
  | FountainTitlePageElement
  | FountainSeparatorElement
  | FountainSceneHeadingElement
  | FountainActionElement
  | FountainCharacterElement
  | FountainDialogueElement
  | FountainParentheticalElement
  | FountainMarkerTextElement
  | FountainPageBreakElement
  | FountainCommentElement;

export interface FountainDocument {
  source: string;
  hasBom: boolean;
  lineEnding: FountainLineEnding;
  elements: readonly FountainElement[];
  annotations: readonly FountainAnnotation[];
}

export interface FountainSourceLine extends FountainRange {
  index: number;
  text: string;
  contentStart: number;
  contentEnd: number;
  ending: '' | '\n' | '\r\n';
}
