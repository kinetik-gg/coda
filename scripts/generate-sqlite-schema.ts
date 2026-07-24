import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Deterministic Postgres -> SQLite Prisma schema transform (issue #77, backed by the #73 spike).
//
// The canonical `apps/api/prisma/schema.prisma` is the single source of truth and is NEVER edited
// for SQLite's sake. This script mechanically derives a SQLite-provider variant used ONLY by the
// portability test lane — nothing ships on SQLite. The committed output is checked into git and a
// CI `--check` step (mirroring `openapi:check`) fails when it drifts from the canonical schema, so
// a Postgres schema change that has no portable SQLite expression is caught at review time.
//
// The transform rules are exactly those the spike proved are load-bearing:
//
//   1. datasource/generator: `postgresql` -> `sqlite`; drop the `citext` extension and the
//      `postgresqlExtensions` preview feature; emit the client to a private path so the SQLite
//      client never clobbers the production Postgres client.
//   2. enums -> `String`: SQLite has no native enums. Enum-typed fields become `String` and every
//      `@default(MEMBER)` becomes the quoted string `@default("MEMBER")`. (The generated SQLite
//      client therefore drops the enum value exports; the lane's tests pass the string literals
//      directly and never import those exports.)
//   3. drop Postgres-native type attributes (`@db.Uuid`, `@db.Timestamptz`, `@db.VarChar`,
//      `@db.Citext`, `@db.Char`, `@db.JsonB`, `@db.Date`, ...) — SQLite has none of them.
//   4. scalar lists (`String[]`) -> `Json`: SQLite has no array columns.
//   5. `Json @default("{}")` -> a `dbgenerated` literal: Prisma emits an invalid bare `DEFAULT {}`
//      on SQLite, so the empty-object default is expressed as raw `'{}'`.
//   6. the Postgres `INTERVAL` dbgenerated default on `StorageDeletionJob.notBefore` -> the
//      equivalent SQLite `datetime(...)` expression.
//
// citext case-insensitivity is NOT restored at the schema level (SQLite column collations are not
// expressible through the Prisma datamodel); it is restored in application code by
// `SqliteDatabaseCapabilities.caseInsensitiveEmail`, and the lane ships a loud test proving
// case-variant emails collide. See portability design note #2 on `DatabaseCapabilities`.

const CANONICAL_SCHEMA = resolve('apps/api/prisma/schema.prisma');
const SQLITE_SCHEMA = resolve('apps/api/prisma/schema.sqlite.prisma');

// The private output keeps the SQLite client out of `@prisma/client` so the production Postgres
// client (with its enum exports the app imports) is never overwritten by a lane run.
const GENERATOR_BLOCK = `generator client {
  provider = "prisma-client-js"
  output   = "./generated/sqlite"
}`;

const DATASOURCE_BLOCK = `datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}`;

const SCALAR_LIST = /\b(?:String|Int|Float|Boolean|DateTime|Bytes|BigInt)\[\]/g;

interface EnumInfo {
  names: string[];
  members: Set<string>;
}

function collectEnums(source: string): EnumInfo {
  const names: string[] = [];
  const members = new Set<string>();
  const enumBlock = /enum\s+(\w+)\s+\{([\s\S]*?)\n\}/g;
  for (let match = enumBlock.exec(source); match; match = enumBlock.exec(source)) {
    names.push(match[1]!);
    for (const line of match[2]!.split('\n')) {
      const member = line.trim();
      if (member && !member.startsWith('//')) members.add(member);
    }
  }
  return { names, members };
}

function transform(source: string): string {
  const { names, members } = collectEnums(source);

  let out = source
    .replace(/generator\s+client\s+\{[\s\S]*?\n\}/, GENERATOR_BLOCK)
    .replace(/datasource\s+db\s+\{[\s\S]*?\n\}/, DATASOURCE_BLOCK)
    .replace(/enum\s+\w+\s+\{[\s\S]*?\n\}\n?/g, '');

  // Enum-typed fields -> String, preserving optionality; enum-value defaults -> quoted strings.
  for (const name of names) {
    out = out.replace(new RegExp(`(\\s)${name}(\\??)(\\s|$)`, 'g'), '$1String$2$3');
  }
  for (const member of members) {
    out = out.replace(new RegExp(`@default\\(${member}\\)`, 'g'), `@default("${member}")`);
  }

  // Postgres-native type attributes have no SQLite equivalent.
  out = out.replace(/ @db\.\w+(?:\([^)]*\))?/g, '');

  // Scalar arrays -> Json (SQLite has no array columns).
  out = out.replace(SCALAR_LIST, 'Json');

  // Json empty-object default: Prisma emits an invalid bare `DEFAULT {}` on SQLite.
  out = out.replace(/@default\("\{\}"\)/g, `@default(dbgenerated("'{}'"))`);

  // The Postgres INTERVAL dbgenerated default -> the equivalent SQLite datetime expression
  // (01:00:01 == 3601 seconds after the current timestamp).
  out = out.replace(
    /@default\(dbgenerated\("\(CURRENT_TIMESTAMP \+ '01:00:01'::interval\)"\)\)/g,
    `@default(dbgenerated("(datetime('now', '+3601 seconds'))"))`,
  );

  // Collapse the alignment padding left behind by the attribute removals so the committed output is
  // deterministic. Leading indentation and any line carrying a comment are left untouched.
  out = out
    .split('\n')
    .map((line) =>
      line.replace(/^(\s*)(.*)$/, (_full, indent: string, rest: string) =>
        rest.includes('//') ? indent + rest : indent + rest.replace(/ {2,}/g, ' '),
      ),
    )
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n');

  const header =
    '// AUTO-GENERATED from apps/api/prisma/schema.prisma by scripts/generate-sqlite-schema.ts.\n' +
    '// Do not edit by hand. Run `pnpm sqlite:schema:generate` after changing the canonical schema.\n' +
    '// SQLite is the portability test lane only (issue #77); nothing ships on SQLite.\n\n';

  return header + out.trimStart().replace(/\n*$/, '\n');
}

async function main(): Promise<void> {
  const canonical = await readFile(CANONICAL_SCHEMA, 'utf8');
  const rendered = transform(canonical);

  if (process.argv.includes('--check')) {
    const current = await readFile(SQLITE_SCHEMA, 'utf8').catch(() => '');
    if (current !== rendered) {
      console.error(
        'apps/api/prisma/schema.sqlite.prisma is stale relative to schema.prisma.\n' +
          'Run `pnpm sqlite:schema:generate` and commit the result.',
      );
      process.exitCode = 1;
      return;
    }
    console.log('schema.sqlite.prisma is up to date.');
    return;
  }

  await writeFile(SQLITE_SCHEMA, rendered, 'utf8');
  console.log(`Generated ${SQLITE_SCHEMA}`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
