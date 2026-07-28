import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../../apps/api/src/prisma/prisma.service';

const DEFAULT_SPACE_ID = '00000000-0000-4000-8000-000000000001';
const projectId = '00000000-0000-4000-8000-000000000203';
const screenplayId = '00000000-0000-4000-8000-000000000204';
const integrationDatabaseUrl =
  process.env.CODA_INTEGRATION_DATABASE_URL ??
  `postgresql://coda:${encodeURIComponent(
    process.env.POSTGRES_PASSWORD ?? 'integration-postgres-password',
  )}@127.0.0.1:${process.env.CODA_TEST_POSTGRES_PORT ?? '55432'}/coda?schema=public`;
const prisma = new PrismaService({ datasourceUrl: integrationDatabaseUrl });
let disposableOwnerId: string | undefined;

async function migrationStatements(): Promise<string[]> {
  const sql = await readFile(
    resolve('apps/api/prisma/migrations/20260728000000_spaces/migration.sql'),
    'utf8',
  );
  return sql
    .replace(/--.*$/gmu, '')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean);
}

async function applyMigration(): Promise<void> {
  for (const statement of await migrationStatements()) {
    await prisma.$executeRawUnsafe(statement);
  }
}

describe('Spaces migration replay', () => {
  beforeAll(async () => {
    let owner = await prisma.user.findFirst({ select: { id: true } });
    if (!owner) {
      owner = await prisma.user.create({
        data: {
          email: 'spaces-migration@coda.local',
          displayName: 'Spaces Migration',
          passwordHash: 'not-a-login-credential',
        },
        select: { id: true },
      });
      disposableOwnerId = owner.id;
    }
    await prisma.project.create({
      data: {
        id: projectId,
        ownerUserId: owner.id,
        name: 'Soft-deleted migration project',
        deletedAt: new Date('2026-07-28T00:00:00.000Z'),
      },
    });
    await prisma.screenplay.create({
      data: {
        id: screenplayId,
        ownerUserId: owner.id,
        title: 'Soft-deleted migration screenplay',
        filename: 'deleted.fountain',
        deletedAt: new Date('2026-07-28T00:00:00.000Z'),
      },
    });
  });

  afterAll(async () => {
    await prisma.spaceResource.deleteMany({
      where: { resourceId: { in: [projectId, screenplayId] } },
    });
    await prisma.screenplay.deleteMany({ where: { id: screenplayId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    if (disposableOwnerId) await prisma.user.delete({ where: { id: disposableOwnerId } });
    await prisma.$disconnect();
  });

  it('applies twice with one Default Space, unique complete mappings, and zero memberships', async () => {
    await applyMigration();
    await applyMigration();

    expect(await prisma.space.count({ where: { isDefault: true } })).toBe(1);
    expect(await prisma.space.findUnique({ where: { id: DEFAULT_SPACE_ID } })).not.toBeNull();
    expect(await prisma.spaceMembership.count()).toBe(0);

    const mappings = await prisma.spaceResource.findMany({
      select: { resourceType: true, resourceId: true },
    });
    const keys = mappings.map(({ resourceType, resourceId }) => `${resourceType}:${resourceId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys).toEqual(
      expect.arrayContaining([`breakdown:${projectId}`, `screenplay:${screenplayId}`]),
    );

    const [projects, screenplays] = await Promise.all([
      prisma.project.findMany({ select: { id: true } }),
      prisma.screenplay.findMany({ select: { id: true } }),
    ]);
    expect(projects.every(({ id }) => keys.includes(`breakdown:${id}`))).toBe(true);
    expect(screenplays.every(({ id }) => keys.includes(`screenplay:${id}`))).toBe(true);
  });
});
