/** The retired instance-wide Default used only by the compatibility migration. */
export const LEGACY_DEFAULT_SPACE_ID = '00000000-0000-4000-8000-000000000001';

/** @deprecated Runtime code must resolve the authenticated user's personal Default Space. */
export const DEFAULT_SPACE_ID = LEGACY_DEFAULT_SPACE_ID;

export const SPACE_RESOURCE_TYPES = ['breakdown', 'screenplay'] as const;

export type SpaceResourceType = (typeof SPACE_RESOURCE_TYPES)[number];
