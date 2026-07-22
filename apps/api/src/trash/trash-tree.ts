import type { Prisma } from '@prisma/client';

export async function descendantIds(
  tx: Prisma.TransactionClient,
  projectId: string,
  roots: string[],
  activeOnly = false,
): Promise<string[]> {
  return (await descendantLevels(tx, projectId, roots, activeOnly)).flat();
}

export async function descendantLevels(
  tx: Prisma.TransactionClient,
  projectId: string,
  roots: string[],
  activeOnly = false,
): Promise<string[][]> {
  const levels: string[][] = [];
  const visited = new Set(roots);
  let parents = roots;
  while (parents.length) {
    const children = await tx.breakdownItem.findMany({
      where: {
        projectId,
        parentId: { in: parents },
        ...(activeOnly ? { deletedAt: null } : {}),
      },
      select: { id: true },
    });
    const next = children.map((child) => child.id).filter((id) => !visited.has(id));
    if (!next.length) break;
    next.forEach((id) => visited.add(id));
    levels.push(next);
    parents = next;
  }
  return levels;
}
