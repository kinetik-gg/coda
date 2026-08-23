import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { workspaceLayoutSchema, type WorkspaceLayout } from '@coda/contracts';

type LayoutClient = Pick<Prisma.TransactionClient, 'trackerWorkspaceDefault'>;

/**
 * The canonical tracker default: a record grid beside an inspector, mirroring the breakdown
 * recipe (`createDefaultWorkspaceLayout`) on the tracker panel vocabulary — `grid` carries the
 * column view state the contracts foundation shared across entity table and tracker surfaces.
 */
export function createTrackerDefaultWorkspaceLayout(): WorkspaceLayout {
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
          type: 'grid',
          configVersion: 1,
          config: {
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
    view: { zoom: 1, textScale: 1.2 },
  });
}

/**
 * Lazily seeds the canonical default on first access. Trackers have no creation-time hook
 * (projects seed rows through `createProjectWorkspaceLayouts` at creation and import), so the
 * first reader materializes the row; a concurrent first access loses the PK race and re-reads
 * the winner instead of failing. Like its breakdown twin this row is cloned, never mutated by
 * personal saves, and both layout tables stay FK-free onto `trackers`/`users` so an N-1 backup
 * replay can replace the core tables first (see schema.prisma).
 */
export async function ensureTrackerWorkspaceDefault(client: LayoutClient, trackerId: string) {
  const existing = await client.trackerWorkspaceDefault.findUnique({ where: { trackerId } });
  if (existing) return existing;
  const layout = createTrackerDefaultWorkspaceLayout();
  try {
    return await client.trackerWorkspaceDefault.create({
      data: {
        trackerId,
        layout: layout as unknown as Prisma.InputJsonValue,
        schemaVersion: layout.schemaVersion,
        publishedAt: new Date(),
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return client.trackerWorkspaceDefault.findUniqueOrThrow({ where: { trackerId } });
    }
    throw error;
  }
}
