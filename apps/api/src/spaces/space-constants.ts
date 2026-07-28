export const DEFAULT_SPACE_ID = '00000000-0000-4000-8000-000000000001';

export const SPACE_RESOURCE_TYPES = ['breakdown', 'screenplay'] as const;

export type SpaceResourceType = (typeof SPACE_RESOURCE_TYPES)[number];
