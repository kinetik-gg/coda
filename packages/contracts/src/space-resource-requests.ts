import { uuidSchema } from './primitives';
import { z } from 'zod';

// How a request names the Space a resource belongs to. Two shapes, one vocabulary: a list request
// reads `spaceId` as a container filter, and a create request reads it as the container the new
// resource is placed in. Kept in its own leaf module so the per-resource create schemas can compose
// the creation target without importing the barrel, which would be a cycle.

/**
 * The Space a create request targets. Omitting `spaceId` targets the Default Space, which is the
 * pre-Spaces behaviour every existing client relies on, so creation stays ungoverned by Space
 * membership unless the caller explicitly names a Space.
 */
export const spaceResourceTargetSchema = z.object({ spaceId: uuidSchema.optional() });
export type SpaceResourceTarget = z.infer<typeof spaceResourceTargetSchema>;

export const listProjectsQuerySchema = z.object({ spaceId: uuidSchema.optional() });
export type ListProjectsQuery = z.infer<typeof listProjectsQuerySchema>;
