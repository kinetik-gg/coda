import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

/**
 * Appended-table backup-compatibility gate (issue #265).
 *
 * A database dump taken from release N-1 must `pg_restore --clean` onto the current schema. That
 * only works while every table appended after a release declines to depend on the core tables the
 * dump carries: a foreign key onto `users`, `projects`, or `screenplays` makes the restore unable
 * to drop the core constraint it depends on (e.g. `screenplays_pkey`), and a column typed with the
 * shared `citext` extension or a shared enum makes it unable to replace that type. The convention
 * is stated in docs/data-compatibility.md; `screenplay_*` and `space_*` are the reference examples
 * of it done correctly. Foreign keys strictly AMONG appended tables are fine and are not flagged.
 *
 * Both sources of truth are read, because either alone has a blind spot:
 *   - `apps/api/prisma/schema.prisma` — declared relation fields and column types;
 *   - `apps/api/prisma/migrations/**` — the DDL actually executed, including hand-written
 *     `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY` that never appears as a Prisma relation.
 *
 * The core tables legitimately reference each other, so this is not a blanket ban. Every
 * cross-boundary edge and shared-type column that exists today is enumerated below as a checked-in
 * constant. Anything not on those lists fails the gate, which makes widening the surface a visible,
 * reviewable diff rather than an invisible convention. `check-appended-table-fks.ts` is the runner
 * and mirrors `check-db-portability.ts` in output format and exit-code behaviour; the parsing lives
 * here so `appended-table-fks.test.ts` can pin it without touching the repository's real schema.
 */

const SCHEMA_PATH = resolve('apps/api/prisma/schema.prisma');
const MIGRATIONS_DIR = resolve('apps/api/prisma/migrations');

/** The tables an N-1 dump carries and a `pg_restore --clean` must stay free to drop and replace. */
const CORE_TABLES = new Set(['users', 'projects', 'screenplays']);

/**
 * Every foreign key onto a core table that exists today, as `table(column, ...) -> target`.
 * These predate the convention (or belong to the core graph itself, which is allowed to be
 * self-referential). Adding an entry here is the explicit, reviewable act of accepting that a new
 * table will block an N-1 restore — in practice the answer is to drop the FK, not to widen this.
 */
const ALLOWED_CORE_FOREIGN_KEYS = new Set([
  'activity_events(actor_id) -> users',
  'activity_events(project_id) -> projects',
  'api_credentials(created_by_id) -> users',
  'api_credentials(project_id) -> projects',
  'api_credentials(user_id) -> users',
  'breakdown_items(project_id) -> projects',
  'comments(author_id) -> users',
  'comments(project_id) -> projects',
  'entity_types(project_id) -> projects',
  'field_definitions(project_id) -> projects',
  'instance_invitation_redemptions(user_id) -> users',
  'instance_invitations(accepted_by_id) -> users',
  'instance_invitations(inviter_id) -> users',
  'instance_invitations(project_id) -> projects',
  'instance_settings(owner_user_id) -> users',
  'password_reset_tokens(user_id) -> users',
  'project_invitations(accepted_by_id) -> users',
  'project_invitations(inviter_id) -> users',
  'project_invitations(project_id) -> projects',
  'project_memberships(project_id) -> projects',
  'project_memberships(user_id) -> users',
  'project_roles(project_id) -> projects',
  'project_workspace_defaults(project_id) -> projects',
  'project_workspace_defaults(published_by_id) -> users',
  'projects(owner_user_id) -> users',
  'screenplay_revisions(owner_user_id) -> users',
  'screenplay_revisions(screenplay_id, owner_user_id) -> screenplays',
  'screenplays(owner_user_id) -> users',
  'sessions(user_id) -> users',
  'source_documents(project_id) -> projects',
  'storage_objects(project_id) -> projects',
]);

/**
 * Every column typed with the shared `citext` extension or a shared enum that exists today, as
 * `table.column : type`. A new table must use base types instead (`TEXT` / `VARCHAR`), because
 * `pg_restore --clean` of an N-1 dump has to be free to drop and recreate these shared types.
 */
const ALLOWED_SHARED_TYPE_COLUMNS = new Set([
  'activity_events.action : ActivityAction',
  'api_credentials.kind : ApiCredentialKind',
  'field_definitions.type : FieldType',
  'instance_invitation_redemptions.email : citext',
  'instance_invitations.email : citext',
  'instance_invitations.status : InvitationStatus',
  'project_invitations.email : citext',
  'project_invitations.status : InvitationStatus',
  'scheduled_job_status.last_outcome : JobOutcome',
  'storage_objects.kind : StorageKind',
  'storage_objects.status : StorageStatus',
  'users.email : citext',
  'users.status : UserStatus',
]);

export interface Violation {
  location: string;
  detail: string;
}

function foreignKeyId(table: string, columns: string[], target: string): string {
  return `${table}(${columns.join(', ')}) -> ${target}`;
}

function sharedTypeId(table: string, column: string, type: string): string {
  return `${table}.${column} : ${type}`;
}

// ---------------------------------------------------------------------------
// schema.prisma
// ---------------------------------------------------------------------------

interface PrismaField {
  name: string;
  column: string;
  type: string;
  attributes: string;
}

interface PrismaModel {
  name: string;
  table: string;
  fields: PrismaField[];
}

export function parsePrismaModels(source: string): PrismaModel[] {
  const models: PrismaModel[] = [];
  const blocks = source.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gmu);
  for (const block of blocks) {
    const name = block[1] as string;
    const body = block[2] as string;
    const table = /@@map\("([^"]+)"\)/u.exec(body)?.[1] ?? name;
    const fields: PrismaField[] = [];
    for (const rawLine of body.split('\n')) {
      const line = rawLine.replace(/\/\/.*$/u, '').trim();
      if (line.length === 0 || line.startsWith('@@')) continue;
      const field = /^(\w+)\s+(\w+)(?:\?|\[\])?\s*(.*)$/u.exec(line);
      if (!field) continue;
      const fieldName = field[1] as string;
      const attributes = field[3] as string;
      fields.push({
        name: fieldName,
        column: /@map\("([^"]+)"\)/u.exec(attributes)?.[1] ?? fieldName,
        type: field[2] as string,
        attributes,
      });
    }
    models.push({ name, table, fields });
  }
  return models;
}

export function parsePrismaEnums(source: string): Set<string> {
  return new Set([...source.matchAll(/^enum\s+(\w+)\s*\{/gmu)].map((match) => match[1] as string));
}

export function checkSchemaRelations(models: PrismaModel[], violations: Violation[]): void {
  const tableByModel = new Map(models.map((model) => [model.name, model.table]));
  for (const model of models) {
    const columnByField = new Map(model.fields.map((field) => [field.name, field.column]));
    for (const field of model.fields) {
      const relation = /@relation\((.*)\)/u.exec(field.attributes);
      if (!relation) continue;
      const scalars = /fields:\s*\[([^\]]*)\]/u.exec(relation[1] as string);
      if (!scalars) continue;
      const target = tableByModel.get(field.type);
      if (target === undefined || !CORE_TABLES.has(target)) continue;
      const columns = (scalars[1] as string)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map((entry) => columnByField.get(entry) ?? entry);
      const id = foreignKeyId(model.table, columns, target);
      if (ALLOWED_CORE_FOREIGN_KEYS.has(id)) continue;
      violations.push({
        location: `apps/api/prisma/schema.prisma  model ${model.name}.${field.name}`,
        detail: `foreign key onto core table "${target}" — ${id}`,
      });
    }
  }
}

export function checkSchemaTypes(
  models: PrismaModel[],
  enums: Set<string>,
  violations: Violation[],
): void {
  for (const model of models) {
    for (const field of model.fields) {
      const type = field.attributes.includes('@db.Citext')
        ? 'citext'
        : enums.has(field.type)
          ? field.type
          : null;
      if (type === null) continue;
      const id = sharedTypeId(model.table, field.column, type);
      if (ALLOWED_SHARED_TYPE_COLUMNS.has(id)) continue;
      violations.push({
        location: `apps/api/prisma/schema.prisma  model ${model.name}.${field.name}`,
        detail: `shared ${type === 'citext' ? 'citext extension' : 'enum type'} in an appended table — ${id}`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// migrations/**
// ---------------------------------------------------------------------------

/** Strips `--` line comments, then splits on `;` while respecting '' and $tag$ quoting. */
export function splitStatements(sql: string): string[] {
  const withoutComments = sql
    .split('\n')
    .map((line) => line.replace(/--.*$/u, ''))
    .join('\n');
  const statements: string[] = [];
  let current = '';
  let index = 0;
  while (index < withoutComments.length) {
    const rest = withoutComments.slice(index);
    const dollarTag = /^\$[A-Za-z_]*\$/u.exec(rest);
    if (dollarTag) {
      const tag = dollarTag[0];
      const close = withoutComments.indexOf(tag, index + tag.length);
      const end = close === -1 ? withoutComments.length : close + tag.length;
      current += withoutComments.slice(index, end);
      index = end;
      continue;
    }
    const character = withoutComments[index] as string;
    if (character === "'") {
      const close = withoutComments.indexOf("'", index + 1);
      const end = close === -1 ? withoutComments.length : close + 1;
      current += withoutComments.slice(index, end);
      index = end;
      continue;
    }
    if (character === ';') {
      statements.push(current);
      current = '';
      index += 1;
      continue;
    }
    current += character;
    index += 1;
  }
  statements.push(current);
  return statements.map((statement) => statement.replace(/\s+/gu, ' ').trim()).filter(Boolean);
}

/** Splits a comma-separated DDL clause list, ignoring commas nested inside parentheses. */
export function splitClauses(body: string): string[] {
  const clauses: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of body) {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      clauses.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  clauses.push(current.trim());
  return clauses.filter(Boolean);
}

/** Body between the outermost parentheses of a `CREATE TABLE ... ( ... )` statement. */
function tableBody(statement: string): string {
  const open = statement.indexOf('(');
  if (open === -1) return '';
  let depth = 0;
  for (let index = open; index < statement.length; index += 1) {
    if (statement[index] === '(') depth += 1;
    if (statement[index] === ')') {
      depth -= 1;
      if (depth === 0) return statement.slice(open + 1, index);
    }
  }
  return statement.slice(open + 1);
}

const CONSTRAINT_KEYWORDS =
  /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE|LIKE|ADD|DROP|ALTER|RENAME|SET|OWNER|ENABLE|DISABLE)\b/iu;

function clauseForeignKey(clause: string): { columns: string[]; target: string } | null {
  const references = /REFERENCES\s+"?(\w+)"?/iu.exec(clause);
  if (!references) return null;
  const target = references[1] as string;
  const explicit = /FOREIGN\s+KEY\s*\(([^)]*)\)/iu.exec(clause);
  if (explicit) {
    const columns = (explicit[1] as string)
      .split(',')
      .map((entry) => entry.trim().replace(/"/gu, ''))
      .filter(Boolean);
    return { columns, target };
  }
  const inline = /^"?(\w+)"?\s/u.exec(clause);
  return inline ? { columns: [inline[1] as string], target } : null;
}

function clauseColumnType(clause: string): { column: string; type: string } | null {
  const stripped = clause.replace(/^ADD\s+(COLUMN\s+)?(IF\s+NOT\s+EXISTS\s+)?/iu, '');
  if (CONSTRAINT_KEYWORDS.test(stripped)) return null;
  const column = /^"?(\w+)"?\s+(.+)$/u.exec(stripped);
  if (!column) return null;
  const type = (column[2] as string).trim().split(/\s+/u)[0] as string;
  return { column: column[1] as string, type };
}

export function checkMigrationStatement(
  statement: string,
  file: string,
  enums: Set<string>,
  violations: Violation[],
): void {
  const create = /^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?"?(\w+)"?\s*\(/iu.exec(statement);
  const alter = /^ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?"?(\w+)"?\s+(.*)$/iu.exec(
    statement,
  );
  if (!create && !alter) return;
  const table = (create?.[1] ?? alter?.[1]) as string;
  const clauses = splitClauses(create ? tableBody(statement) : (alter?.[2] as string));
  for (const clause of clauses) {
    const foreignKey = clauseForeignKey(clause);
    if (foreignKey && CORE_TABLES.has(foreignKey.target)) {
      const id = foreignKeyId(table, foreignKey.columns, foreignKey.target);
      if (!ALLOWED_CORE_FOREIGN_KEYS.has(id)) {
        violations.push({
          location: file,
          detail: `foreign key onto core table "${foreignKey.target}" — ${id}`,
        });
      }
    }
    const columnType = clauseColumnType(clause);
    if (!columnType) continue;
    const bare = columnType.type.replace(/"/gu, '').replace(/\(.*$/u, '');
    const type = /^citext$/iu.test(bare) ? 'citext' : enums.has(bare) ? bare : null;
    if (type === null) continue;
    const id = sharedTypeId(table, columnType.column, type);
    if (ALLOWED_SHARED_TYPE_COLUMNS.has(id)) continue;
    violations.push({
      location: file,
      detail: `shared ${type === 'citext' ? 'citext extension' : 'enum type'} in an appended table — ${id}`,
    });
  }
}

async function collectMigrationFiles(): Promise<string[]> {
  const entries = await readdir(MIGRATIONS_DIR, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(MIGRATIONS_DIR, entry.name, 'migration.sql'))
    .sort();
}

async function checkMigrations(enums: Set<string>, violations: Violation[]): Promise<number> {
  const files = await collectMigrationFiles();
  for (const file of files) {
    const sql = await readFile(file, 'utf8');
    const label = relative(process.cwd(), file).replace(/\\/gu, '/');
    for (const statement of splitStatements(sql)) {
      checkMigrationStatement(statement, label, enums, violations);
    }
  }
  return files.length;
}

// ---------------------------------------------------------------------------

export interface GateResult {
  models: number;
  migrations: number;
  violations: Violation[];
}

/** Reads both sources of truth and returns every cross-boundary edge that is not allowlisted. */
export async function collectViolations(): Promise<GateResult> {
  const schema = await readFile(SCHEMA_PATH, 'utf8');
  const models = parsePrismaModels(schema);
  const schemaEnums = parsePrismaEnums(schema);
  const violations: Violation[] = [];

  // Enum types can be declared in a migration before (or without) reaching schema.prisma, so the
  // set the DDL pass matches against is the union of both declaration sites.
  const migrationEnums = new Set(schemaEnums);
  for (const file of await collectMigrationFiles()) {
    const sql = await readFile(file, 'utf8');
    for (const match of sql.matchAll(/CREATE\s+TYPE\s+"?(\w+)"?\s+AS\s+ENUM/giu)) {
      migrationEnums.add(match[1] as string);
    }
  }

  checkSchemaRelations(models, violations);
  checkSchemaTypes(models, schemaEnums, violations);
  const migrations = await checkMigrations(migrationEnums, violations);
  return { models: models.length, migrations, violations };
}

export function formatViolations(violations: Violation[]): string {
  return violations.map((entry) => `${entry.location}\n    ${entry.detail}`).join('\n');
}
