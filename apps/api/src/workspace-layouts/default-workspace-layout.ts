import { randomUUID } from 'node:crypto';
import { workspaceLayoutSchema, type WorkspaceLayout } from '@coda/contracts';
import type { Prisma, PrismaClient } from '@prisma/client';

type Transaction = Omit<
  PrismaClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'
>;

export function createDefaultWorkspaceLayout(): WorkspaceLayout {
  return workspaceLayoutSchema.parse({
    schemaVersion: 1,
    root: {
      kind: 'split',
      id: randomUUID(),
      axis: 'horizontal',
      ratioBasisPoints: 7000,
      first: {
        kind: 'panel',
        id: randomUUID(),
        panel: {
          id: randomUUID(),
          type: 'entity_table',
          configVersion: 1,
          config: {
            entityTypeId: null,
            search: '',
            sort: 'manual',
            direction: 'asc',
            filters: [],
            hiddenColumns: [],
            visibleCustomFieldIds: [],
            columnWidths: {},
          },
        },
      },
      second: {
        kind: 'split',
        id: randomUUID(),
        axis: 'vertical',
        ratioBasisPoints: 5500,
        first: {
          kind: 'panel',
          id: randomUUID(),
          panel: {
            id: randomUUID(),
            type: 'pdf',
            configVersion: 1,
            config: { sourceDocumentId: null, page: 1, zoom: 1 },
          },
        },
        second: {
          kind: 'panel',
          id: randomUUID(),
          panel: {
            id: randomUUID(),
            type: 'inspector',
            configVersion: 1,
            config: { section: 'details', search: '' },
          },
        },
      },
    },
    view: { zoom: 1, textScale: 1.2 },
  });
}

export async function createProjectWorkspaceLayouts(
  tx: Transaction,
  projectId: string,
  ownerMembershipId: string,
  layout = createDefaultWorkspaceLayout(),
): Promise<void> {
  const validated = workspaceLayoutSchema.parse(layout);
  const storedLayout = validated as unknown as Prisma.InputJsonValue;
  await tx.projectWorkspaceDefault.create({
    data: {
      projectId,
      layout: storedLayout,
      schemaVersion: validated.schemaVersion,
      publishedAt: new Date(),
    },
  });
  await tx.projectMembershipWorkspaceLayout.create({
    data: {
      membershipId: ownerMembershipId,
      layout: storedLayout,
      schemaVersion: validated.schemaVersion,
      basedOnDefaultRevision: 0,
    },
  });
}
