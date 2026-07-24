process.env.DATABASE_URL = `file:${require('node:path').join(__dirname, 'spike.db')}`;
const { PrismaClient, Prisma } = require('./prisma-shim');
const p = new PrismaClient();
(async () => {
  try {
    await p.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(1122334455)`);
      console.log('advisory ok, count=', await tx.instanceSettings.count());
      const u = await tx.user.create({ data: { email: 'probe@x.com', displayName: 'P', passwordHash: 'h' } });
      console.log('user created', u.id);
      await tx.instanceSettings.create({ data: { ownerUserId: u.id } });
      console.log('instance settings created');
    });
  } catch (e) {
    console.log('ERR', e.code, String(e.message).replace(/\s+/g, ' ').slice(0, 400));
  }
  await p.$disconnect();
})();
