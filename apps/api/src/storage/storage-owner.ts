import type { Prisma } from '@prisma/client';

/**
 * The internal ownership discriminator threaded through the upload orchestration
 * (`createUpload` → `complete` → read/delete): a storage object belongs to exactly one side,
 * never both. The database CHECK (`storage_objects_owner_check`) is the backstop; every write
 * here stamps one side deliberately so the application never relies on the constraint firing.
 */
export type StorageOwner =
  | { kind: 'project'; id: string }
  | { kind: 'tracker'; id: string };

/** The single-side `where` fragment matching every row owned by `owner`. */
export function ownerWhere(owner: StorageOwner): Prisma.StorageObjectWhereInput {
  return owner.kind === 'project' ? { projectId: owner.id } : { trackerId: owner.id };
}

/**
 * The single-side create stamp. Both discriminator columns are written explicitly (the other
 * side as SQL `NULL`) rather than omitted, so a caller reading the data sees the XOR decision
 * instead of inferring it from absent keys.
 */
export function ownerStamp(
  owner: StorageOwner,
): { projectId: string; trackerId: null } | { projectId: null; trackerId: string } {
  return owner.kind === 'project'
    ? { projectId: owner.id, trackerId: null }
    : { projectId: null, trackerId: owner.id };
}
