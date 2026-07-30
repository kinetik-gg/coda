import { z } from 'zod';

// How a request names the Space a resource lives in. Two shapes, one vocabulary: listing reads
// `spaceId` as a container filter, and creation reads it as the container the new resource is
// placed in. Kept in its own leaf module so `index.ts` can compose the creation target into the
// per-resource create schemas without importing anything that imports back.
//
// `spaceId` is uuid-shaped rather than `uuidSchema` from `index.ts`: depending on `index.ts` from a
// module `index.ts` imports would be the cycle `quality:cycles` (madge) fails the build on.
const spaceIdSchema = z.string().uuid();

/**
 * The Space a create request targets. Omitting `spaceId` targets the Default Space, which is the
 * pre-Spaces behaviour every existing client relies on, so creation stays unauthenticated by Space
 * membership unless the caller explicitly names a Space.
 */
export const spaceResourceTargetSchema = z.object({ spaceId: spaceIdSchema.optional() });
export type SpaceResourceTarget = z.infer<typeof spaceResourceTargetSchema>;

export const listProjectsQuerySchema = z.object({ spaceId: spaceIdSchema.optional() });
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;

export const SCREENPLAY_LIST_DEFAULT_LIMIT = 50;
export const SCREENPLAY_LIST_MAX_LIMIT = 100;

export const listScreenplaysQuerySchema = z.object({
  cursor: z.string().trim().min(1).max(512).optional(),
  spaceId: spaceIdSchema.optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(SCREENPLAY_LIST_MAX_LIMIT)
    .default(SCREENPLAY_LIST_DEFAULT_LIMIT),
});
export type ListScreenplaysQuery = z.infer<typeof listScreenplaysQuerySchema>;
