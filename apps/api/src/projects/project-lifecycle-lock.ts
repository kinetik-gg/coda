import { Prisma } from '@prisma/client';

export async function lockProjectLifecycle(
  tx: Prisma.TransactionClient,
  projectId: string,
): Promise<void> {
  await tx.$executeRaw(
    Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'project-lifecycle:' + projectId}, 0))`,
  );
}
