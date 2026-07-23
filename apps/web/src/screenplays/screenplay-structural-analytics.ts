import type { FountainElement } from '@coda/fountain';
import type { ScreenplayContextModel } from './screenplay-context-model';

export interface ScreenplayStructuralCheck {
  id: string;
  label: string;
  status: 'pass' | 'notice';
  count: number;
  detail: string;
}

export interface ScreenplaySceneStructureInput {
  id: string;
  wordCount: number;
}

export function buildStructuralChecks(
  context: ScreenplayContextModel,
  elements: readonly FountainElement[],
  scenes: readonly ScreenplaySceneStructureInput[],
): ScreenplayStructuralCheck[] {
  const missingLocations = context.scenes.filter((scene) => !scene.location).length;
  const missingTimes = context.scenes.filter((scene) => !scene.timeOfDay).length;
  const emptyScenes = scenes.filter((scene) => scene.wordCount === 0).length;
  const duplicateHeadings = countAdjacentDuplicateHeadings(context);
  const unclosedComments = elements.filter(
    (element) => (element.kind === 'note' || element.kind === 'boneyard') && !element.closed,
  ).length;
  return [
    check(
      'missing-locations',
      'Parsed location',
      missingLocations,
      'scene headings without a recognized location',
    ),
    check(
      'missing-times',
      'Time of day',
      missingTimes,
      'scene headings without a final time-of-day segment',
    ),
    check('empty-scenes', 'Scene content', emptyScenes, 'scene ranges without printable words'),
    check(
      'duplicate-headings',
      'Adjacent headings',
      duplicateHeadings,
      'adjacent scene headings with identical normalized text',
    ),
    check(
      'unclosed-comments',
      'Closed comments',
      unclosedComments,
      'unclosed note or boneyard blocks',
    ),
  ];
}

function countAdjacentDuplicateHeadings(context: ScreenplayContextModel): number {
  let count = 0;
  for (let index = 1; index < context.scenes.length; index += 1) {
    const previous = context.scenes[index - 1];
    const current = context.scenes[index];
    if (previous && current && normalize(previous.heading) === normalize(current.heading))
      count += 1;
  }
  return count;
}

function normalize(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toUpperCase();
}

function check(id: string, label: string, count: number, issue: string): ScreenplayStructuralCheck {
  return {
    id,
    label,
    status: count ? 'notice' : 'pass',
    count,
    detail: count ? `${String(count)} ${issue}` : `No ${issue} detected`,
  };
}
