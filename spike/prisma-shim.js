// THROWAWAY shim exposed to the app as '@prisma/client'. Two jobs:
//  1) Re-export the SQLite-generated client (models) PLUS the enum objects that the
//     SQLite provider drops (Prisma has no enums on SQLite) — the app consumes several
//     enum *values* at runtime (FieldType.LONG_TEXT, ActivityAction.CREATED, ...).
//  2) Wrap Prisma.sql so the Postgres-only raw fragments (advisory locks, FOR UPDATE
//     SKIP LOCKED, INTERVAL literals) degrade to harmless statements on SQLite. This is
//     exactly the residue a DatabaseCapabilities seam (#76) would own.
const client = require('./sqlite-client');
const OrigPrisma = client.Prisma;
const origSql = OrigPrisma.sql.bind(OrigPrisma);

let advisory = 0;
let skiplocked = 0;
// SQLite splits execute vs query strictly: $executeRaw must NOT return a result set,
// $queryRaw MUST. Advisory locks are always $executeRaw; the scheduler probe and the
// deletion-claim are $queryRaw — so the no-op has to match the caller's channel.
function wrappedSql(strings, ...values) {
  const text = Array.isArray(strings) ? strings.join('?') : String(strings);
  if (/AS locked/i.test(text)) {
    advisory += 1;
    return origSql`SELECT 0 AS locked`; // scheduler try-lock: report "not acquired"
  }
  if (/pg_advisory|hashtext/i.test(text)) {
    advisory += 1;
    // $executeRaw no-op that returns a row COUNT, not a result set (app-level mutex site)
    return origSql`UPDATE "users" SET "id" = "id" WHERE 1 = 0`;
  }
  if (/FOR UPDATE SKIP LOCKED|INTERVAL '/i.test(text)) {
    skiplocked += 1;
    return origSql`SELECT 1 WHERE 1 = 0`; // deletion-claim $queryRaw: empty result set
  }
  return origSql(strings, ...values);
}
wrappedSql.__stats = () => ({ advisory, skiplocked });

const Prisma = new Proxy(OrigPrisma, {
  get(t, p) {
    return p === 'sql' ? wrappedSql : t[p];
  },
});

const asEnum = (...m) => Object.freeze(Object.fromEntries(m.map((k) => [k, k])));
const enums = {
  UserStatus: asEnum('ACTIVE', 'DISABLED'),
  InvitationStatus: asEnum('PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'),
  FieldType: asEnum('TEXT', 'LONG_TEXT', 'ENUM', 'MULTI_ENUM', 'INTEGER', 'FLOAT', 'BOOLEAN', 'DATE', 'FILE', 'IMAGE', 'VIDEO'),
  StorageKind: asEnum('SOURCE_DOCUMENT', 'FILE', 'IMAGE', 'VIDEO'),
  StorageStatus: asEnum('PENDING', 'READY', 'FAILED'),
  ActivityAction: asEnum('CREATED', 'UPDATED', 'DELETED', 'RESTORED', 'PURGED', 'INVITED', 'ACCEPTED', 'TRANSFERRED', 'COMMENTED'),
  ApiCredentialKind: asEnum('API_KEY', 'MCP_TOKEN'),
  JobOutcome: asEnum('SUCCESS', 'FAILURE'),
};

module.exports = { ...client, ...enums, Prisma, __sqlStats: wrappedSql.__stats };
