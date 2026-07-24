// Spike helper: mechanically fork the Postgres schema.prisma into a SQLite copy.
// Records every transformation so the findings doc can cite exactly what had to change.
const fs = require('node:fs');
const path = require('node:path');

const src = fs.readFileSync(path.join(__dirname, 'schema.sqlite.prisma'), 'utf8');
const changes = [];
let s = src;

// 1. generator: drop postgresqlExtensions preview feature, emit to an isolated client dir.
s = s.replace(
  /generator client \{[\s\S]*?\}/,
  `generator client {\n  provider = "prisma-client-js"\n  output   = "./sqlite-client"\n}`,
);
changes.push('generator: removed previewFeatures=[postgresqlExtensions], isolated output dir');

// 2. datasource: sqlite provider, drop citext extension block.
s = s.replace(
  /datasource db \{[\s\S]*?\}/,
  `datasource db {\n  provider = "sqlite"\n  url      = env("DATABASE_URL")\n}`,
);
changes.push('datasource: postgresql->sqlite, removed extensions=[citext]');

// 3. Collect enum names, then convert enum declarations to comments and enum-typed fields to String.
const enumNames = [...s.matchAll(/^enum (\w+) \{/gm)].map((m) => m[1]);
changes.push(`enums found (SQLite has no native enum): ${enumNames.join(', ')}`);
// Remove enum blocks.
s = s.replace(/^enum \w+ \{[\s\S]*?\}\n/gm, '');
// Replace enum-typed fields with String. Field lines look like: `  status  UserStatus  @default(...)`.
for (const name of enumNames) {
  const before = s;
  s = s.replace(new RegExp(`(\\s)${name}(\\??)(\\s)`, 'g'), `$1String$2$3`);
  if (before !== s) changes.push(`enum type ${name} -> String on fields`);
}

// 4. Strip Postgres native type attributes unsupported by SQLite.
const nativeTypeAttrs = [
  /@db\.Uuid/g,
  /@db\.Citext/g,
  /@db\.Timestamptz\(\d+\)/g,
  /@db\.VarChar\(\d+\)/g,
  /@db\.Char\(\d+\)/g,
  /@db\.Date/g,
  /@db\.JsonB/g,
  /@db\.Int4/g,
];
for (const re of nativeTypeAttrs) {
  if (re.test(s)) changes.push(`stripped native type attr ${re}`);
  s = s.replace(re, '');
}

// 5. Scalar list String[] -> Json (SQLite has no array columns).
if (/String\[\]/.test(s)) {
  s = s.replace(/String\[\]/g, 'Json');
  changes.push('scalar list String[] -> Json (SQLite has no array type)');
}

// 5b. Enum-valued defaults become quoted strings once the column is a String.
if (/@default\([A-Z][A-Z_]+\)/.test(s)) {
  s = s.replace(/@default\(([A-Z][A-Z_]+)\)/g, '@default("$1")');
  changes.push('quoted former-enum defaults, e.g. @default(ACTIVE) -> @default("ACTIVE")');
}

// 5c. Json @default("{}") emits invalid `DEFAULT {}` on SQLite (Prisma leaves the object
// unquoted). Re-express as a dbgenerated literal so the empty-object default survives.
if (/@default\("\{\}"\)/.test(s)) {
  s = s.replace(/@default\("\{\}"\)/g, `@default(dbgenerated("'{}'"))`);
  changes.push('Json @default("{}") -> @default(dbgenerated("\'{}\'")) (SQLite DEFAULT literal)');
}

// 6. Postgres dbgenerated interval default -> plain now() (loses the +1h skew; noted).
// Narrowly target the CURRENT_TIMESTAMP+interval default so it does not eat the Json literal above.
s = s.replace(
  /@default\(dbgenerated\("\([^"]*interval[^"]*"\)\)/g,
  '@default(now())',
);
changes.push('dbgenerated CURRENT_TIMESTAMP+interval default -> @default(now())');

// Collapse any doubled spaces left by attribute removal.
s = s.replace(/[ \t]+$/gm, '');

fs.writeFileSync(path.join(__dirname, 'schema.sqlite.prisma'), s);
console.log(changes.map((c) => ' - ' + c).join('\n'));
