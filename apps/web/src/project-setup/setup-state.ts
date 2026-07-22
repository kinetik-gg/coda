import type { ProjectTemplateId } from '@coda/contracts';
import type { CreationOptions, EntityLevelName, StepId } from './types';

export const stepIds: StepId[] = ['details', 'entities', 'source', 'member', 'summary'];

export const defaultLevelNames: EntityLevelName[] = [
  { singular: 'Sequence', plural: 'Sequences' },
  { singular: 'Scene', plural: 'Scenes' },
  { singular: 'Shot', plural: 'Shots' },
];

export function entitiesAreComplete(levels: EntityLevelName[], levelCount: number): boolean {
  return levels
    .slice(0, levelCount)
    .every((level) => Boolean(level.singular.trim() && level.plural.trim()));
}

export function canContinueSetupStep({
  step,
  detailsComplete,
  entitiesComplete,
  hasSource,
  templateId,
}: {
  step: StepId;
  detailsComplete: boolean;
  entitiesComplete: boolean;
  hasSource: boolean;
  templateId: 'blank' | ProjectTemplateId;
}): boolean {
  switch (step) {
    case 'details':
      return detailsComplete;
    case 'entities':
      return entitiesComplete;
    case 'source':
      return hasSource || templateId !== 'blank';
    case 'member':
    case 'summary':
      return true;
  }
}

export function levelsForTemplate(
  templateId: 'blank' | ProjectTemplateId,
  templates: CreationOptions['templates'] | undefined,
): EntityLevelName[] | undefined {
  if (templateId === 'blank') return defaultLevelNames;
  return templates
    ?.find((template) => template.id === templateId)
    ?.levels.map((level) => ({
      singular: level.singularName,
      plural: level.pluralName,
    }));
}
