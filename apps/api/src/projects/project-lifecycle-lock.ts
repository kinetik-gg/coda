import type { Prisma } from '@prisma/client';
import type { DatabaseCapabilities } from '../database/database-capabilities';

export async function lockProjectLifecycle(
  db: DatabaseCapabilities,
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  await db.acquireTransactionLock(tx, 'project-lifecycle:' + projectId);
}
