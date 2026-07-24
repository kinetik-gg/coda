import { expect } from 'vitest';
import type { DatabaseCapabilities } from '../../../apps/api/src/database/database-capabilities';

interface EmailStore {
  create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
}

/**
 * The loud citext trap, written to be dialect-agnostic. Two case-variant addresses, each routed
 * through the capability seam's {@link DatabaseCapabilities.caseInsensitiveEmail}, MUST collide on
 * the account's unique email index on BOTH dialects:
 *
 * - Postgres: `caseInsensitiveEmail` is a pass-through and the `citext` column case-folds equality,
 *   so `A@x.com` and `a@x.com` are the same key.
 * - SQLite: there is no citext; `caseInsensitiveEmail` lower-cases, so both writes persist the same
 *   key and the plain unique index rejects the second.
 *
 * If a future SQLite adapter regressed `caseInsensitiveEmail` to a pass-through (the spike's silent
 * trap), the two rows would be stored as distinct and this assertion would fail loudly — which is
 * the entire point of the lane. The fix always lives at the capability seam
 * (apps/api/src/database/sqlite-database-capabilities.ts).
 */
export async function assertCaseVariantEmailsCollide(
  users: EmailStore,
  caps: Pick<DatabaseCapabilities, 'caseInsensitiveEmail'>,
  baseLocalPart: string,
): Promise<void> {
  const upper = `${baseLocalPart.toUpperCase()}@Example.com`;
  const lower = `${baseLocalPart.toLowerCase()}@example.com`;

  await users.create({
    data: { email: caps.caseInsensitiveEmail(upper), displayName: 'First', passwordHash: 'hash' },
  });

  await expect(
    users.create({
      data: {
        email: caps.caseInsensitiveEmail(lower),
        displayName: 'Second',
        passwordHash: 'hash',
      },
    }),
    'case-variant emails must collide — restore the strategy in DatabaseCapabilities.caseInsensitiveEmail',
  ).rejects.toThrow();
}
