import type { Prisma } from '@prisma/client';

/**
 * Metadata keys stripped from activity events per resource type, matched
 * case-insensitively. Invitation-flavoured resources (project invitations and the
 * tracker-scope twin) must never leak invitee email addresses into a feed that every
 * reader of the container can see; senders that persist an email anyway are redacted
 * on write and again on read, so historical rows stay clean too.
 */
const REDACTED_METADATA_KEYS: ReadonlyMap<string, readonly string[]> = new Map([
  ['invitation', ['email']],
  ['tracker_invitation', ['email']],
]);

/**
 * The read-side projection of one activity event's metadata: object metadata for a
 * redacted resource type loses its sensitive keys; every other value passes through
 * untouched (scalars, arrays, and non-invitation objects are public-safe already).
 */
export function publicActivityMetadata(
  resourceType: string,
  metadata: Prisma.JsonValue,
): Prisma.JsonValue {
  const keys = REDACTED_METADATA_KEYS.get(resourceType);
  if (!keys || metadata === null || Array.isArray(metadata) || typeof metadata !== 'object') {
    return metadata;
  }
  const blocked = new Set(keys.map((key) => key.toLowerCase()));
  return Object.fromEntries(
    Object.entries(metadata).filter(([entryKey]) => !blocked.has(entryKey.toLowerCase())),
  ) as Prisma.JsonObject;
}
