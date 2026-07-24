const { PrismaClient, Prisma } = require('./sqlite-client');
const p = new PrismaClient({ datasources: { db: { url: 'file:./spike.db' } } });
const clip = (m) => String(m).replace(/\s+/g, ' ').slice(0, 300);
(async () => {
  try { await p.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${'k'}, 0))`); }
  catch (e) { console.log('ADVISORY:', clip(e.message)); }
  try { await p.$queryRaw(Prisma.sql`SELECT "id" FROM "storage_deletion_jobs" FOR UPDATE SKIP LOCKED LIMIT 1`); }
  catch (e) { console.log('SKIPLOCKED:', clip(e.message)); }
  try { await p.$queryRaw(Prisma.sql`SELECT CURRENT_TIMESTAMP - INTERVAL '5 minutes' AS t`); }
  catch (e) { console.log('INTERVAL:', clip(e.message)); }
  await p.$disconnect();
})();
