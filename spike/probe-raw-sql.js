// Spike probe: run each Postgres-specific raw SQL fragment used in the API against the
// SQLite database to capture the exact failure mode of each. Purely diagnostic.
const { PrismaClient, Prisma } = require('./sqlite-client');
const prisma = new PrismaClient({ datasources: { db: { url: 'file:./spike.db' } } });

const probes = [
  {
    name: 'advisory xact lock (single-arg) [auth/projects/breakdown/storage/instance]',
    run: () => prisma.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'k'}, 0))`),
  },
  {
    name: 'advisory xact lock (constant bigint) [auth.service reset]',
    run: () => prisma.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(1122334455)`),
  },
  {
    name: 'try advisory xact lock (two-int) [scheduler]',
    run: () => prisma.$queryRaw(Prisma.sql`SELECT pg_try_advisory_xact_lock(${1}::int4, hashtext(${'k'})) AS locked`),
  },
  {
    name: 'storage-deletion claim: FOR UPDATE SKIP LOCKED + INTERVAL + CURRENT_TIMESTAMP',
    run: () => prisma.$queryRaw(Prisma.sql`
      UPDATE "storage_deletion_jobs" SET "claimed_at" = CURRENT_TIMESTAMP
      WHERE "id" = (
        SELECT "id" FROM "storage_deletion_jobs"
        WHERE "not_before" <= CURRENT_TIMESTAMP
          AND ("claimed_at" IS NULL OR "claimed_at" <= CURRENT_TIMESTAMP - INTERVAL '5 minutes')
        ORDER BY "created_at" ASC FOR UPDATE SKIP LOCKED LIMIT 1)
      RETURNING "id"`),
  },
  {
    name: 'trash purge: INSERT ... SELECT ... ON CONFLICT DO NOTHING + CAST(x AS UUID)',
    run: () => prisma.$executeRaw(Prisma.sql`
      INSERT INTO "storage_deletion_jobs" ("project_id", "object_key", "not_before")
      SELECT "project_id", "object_key", ${new Date()} FROM "storage_objects"
      WHERE "project_id" = CAST(${'00000000-0000-0000-0000-000000000000'} AS UUID)
      ON CONFLICT ("object_key") DO NOTHING`),
  },
  {
    name: 'citext case-insensitive email uniqueness (insert two case variants)',
    run: async () => {
      // Emulate what the Citext column guaranteed: A@x.com and a@x.com must collide.
      await prisma.user.create({ data: { id: 'u1', email: 'A@X.com', displayName: 'A', passwordHash: 'h' } });
      await prisma.user.create({ data: { id: 'u2', email: 'a@x.com', displayName: 'B', passwordHash: 'h' } });
      return 'BOTH INSERTED — case-insensitive uniqueness NOT enforced';
    },
  },
];

(async () => {
  for (const p of probes) {
    try {
      const r = await p.run();
      console.log(`\n[PASS] ${p.name}\n   -> ${typeof r === 'string' ? r : JSON.stringify(r)}`);
    } catch (e) {
      console.log(`\n[FAIL] ${p.name}\n   -> ${String(e.message).split('\n').slice(0, 3).join(' | ')}`);
    }
  }
  await prisma.$disconnect();
})();
