# Data compatibility policy

This is a standing policy, not a release note. It defines the rules every change to a durable
Coda artifact — the backup archive format, the database schema, and the encrypted
instance-configuration store — must follow so that operators can restore, roll forward, and roll
back without losing data. Agents and contributors working on any release inherit these rules; a
change that breaks one of them must ship its migration path in the same change, and the CI gates
below exist to make a violation fail before it reaches an operator.

Three durable artifacts are governed here:

| Artifact                     | Where it lives                                 | Compatibility mechanism                                       |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------- |
| Backup archive (`.codabk`)   | Downloaded, scheduled, and pre-upgrade backups | Versioned format with an N / N-1 / N-2 import window          |
| Database schema              | PostgreSQL, via Prisma migrations              | Forward-only migrations, expand–contract for breaking changes |
| Instance-configuration blobs | Encrypted config store (one row per key)       | Per-key schema version plus a migration hook                  |

## Versioned backup archive format

The in-app backup engine (`apps/api/src/backup/`) writes a single streamed container that begins
with the 8-byte magic `CODA-BK1` (`BACKUP_ARCHIVE_MAGIC` in
`apps/api/src/backup/backup-archive.ts`), followed by a signed JSON manifest, its Ed25519
signature, and then the payload (database dump first, then each object in manifest order). The
manifest and signature lead the stream so a reader authenticates the archive and checks its
format version before a single content byte is written anywhere.

The manifest carries a `formatVersion` integer. `apps/api/src/backup/backup-format.ts` defines the
window:

- `BACKUP_FORMAT_VERSION` — the version the current build writes (currently `1`).
- `BACKUP_IMPORT_WINDOW` — how many previous versions import still accepts (currently `2`).
- `BACKUP_IMPORT_MIN_VERSION` — the oldest importable version, `max(1, BACKUP_FORMAT_VERSION − BACKUP_IMPORT_WINDOW)`.

`assertImportableFormatVersion` enforces the window before any payload is read:

- An archive **newer** than `BACKUP_FORMAT_VERSION` is refused with an explicit "upgrade Coda
  before importing it" message. An older instance never silently ingests a format it cannot fully
  understand.
- An archive **older** than `BACKUP_IMPORT_MIN_VERSION` is refused as unsupported, because the
  current build no longer carries a migration path for it.
- Everything inside the window (`N`, `N-1`, `N-2`) imports.

### Rules for changing the archive format

1. **Any change to the archive layout, manifest shape, or payload framing bumps
   `BACKUP_FORMAT_VERSION` by one.** Never mutate an existing version's meaning in place.
2. **Import must keep accepting the two previous versions.** Add the read path for the old shape
   before the window would drop it; do not remove an old reader while it is still inside the
   window.
3. **The write path only ever emits the current version.** Downgrade is never supported: producing
   an older format for an older instance is not a goal, and newer archives are refused by design.
4. **The manifest signature covers the whole layout.** Entry lengths and checksums come from the
   signed manifest, so a format change that moves a boundary is a signed, version-gated change, not
   a silent one.

The archive's Ed25519 signing key is derived deterministically from `CONFIG_ENCRYPTION_KEY`, so an
archive verifies on another instance only when that instance carries the same key. This is the
operator requirement behind restore-at-setup and every compatibility test: carry
`CONFIG_ENCRYPTION_KEY` to the new deployment.

## Database schema: forward-only, expand–contract

Coda applies committed Prisma migrations at boot, once the database-connection probe succeeds,
under a single-writer PostgreSQL advisory lock (see
[Replicas and migrations](operations.md#replicas-and-migrations)). Migrations are **forward
operations**: an older image must never run against a database a newer image has already migrated.

Because replicas roll forward together and a pre-upgrade safety backup is taken automatically
before pending migrations apply, a **breaking** schema change (dropping or renaming a column,
tightening a constraint, changing a type) must be split across releases using the expand–contract
pattern so that no single deploy leaves the running code and the schema incompatible:

1. **Expand.** Add the new column, table, or nullable constraint alongside the old one. Ship code
   that writes both and reads the old shape. The schema now satisfies both the previous release
   and the current one.
2. **Migrate.** In a later release, backfill and switch reads to the new shape while the old shape
   still exists. Nothing that a same-window backup could restore into is removed yet.
3. **Contract.** Only in a release beyond the import window remove the old column, table, or
   constraint. By then no supported backup or rollback target still depends on it.

A migration that both adds and destructively removes in the same step is not permitted for a
breaking change; it defeats the pre-upgrade backup guarantee and the ability to restore an
in-window archive.

### Worked example: how the Spaces migration shipped

`apps/api/prisma/migrations/20260728000000_spaces/migration.sql` is the reference for an expand
step, and it is worth reading before writing a comparable change. It:

- creates its six tables and every index with `CREATE TABLE IF NOT EXISTS` /
  `CREATE INDEX IF NOT EXISTS`, and performs all seeding with `ON CONFLICT … DO NOTHING`;
- contains **no** `DROP`, no `ALTER TABLE` against a pre-existing table, no rename, and no
  `ALTER COLUMN … SET NOT NULL` — every `NOT NULL` appears in a fresh `CREATE TABLE`;
- takes **no foreign keys onto `projects`, `screenplays`, or `users`**, so it never constrains or
  rewrites a core table; and
- initially seeds a replay-safe legacy placement for every existing breakdown and screenplay.

`apps/api/prisma/migrations/20260806000000_personal_default_spaces/migration.sql` is the matching
correction step. It provisions one owned Default per user, moves legacy placements by resource
owner, and creates the ordinary owner memberships. Those memberships cover resources the user
already owns, so the correction does not grant cross-user access. Both migrations are replayed
together in `tests/integration/spaces-migration.integration.test.ts`.

The retired global Default remains soft-deleted audit history, so no destructive core-table contract
step is pending. The absent foreign keys are
the deliberate cost of that: the Space-to-resource join is repaired at boot by
`apps/api/src/boot/space-resource-reconciler.ts` instead of by the database, which is what lets an
older dump restore under the current schema and still come up coherent. A change that appends a
graph over the core tables inherits that obligation — ship the reconciliation with it.

**This is a checked convention.** `pnpm quality:appended-table-fks`
(`scripts/check-appended-table-fks.ts`, part of `pnpm quality`) fails when a table takes a foreign
key onto `users`, `projects`, or `screenplays`, or types a column with the shared `citext`
extension or a shared enum. It reads both `apps/api/prisma/schema.prisma` relations and the DDL
under `apps/api/prisma/migrations`, so a hand-written
`ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY` is caught even though it never appears as a Prisma
relation. Foreign keys strictly among appended tables are fine and are not flagged. Every
cross-boundary edge that exists today is enumerated as a checked-in allowlist in
`scripts/appended-table-fks.ts`, so widening the surface is a visible diff and never a silent one —
and in practice the fix is to drop the foreign key, not to extend the allowlist.

**On re-application.** The statements above are individually idempotent, and the boot reconciler is
idempotent by construction. The replay itself is now exercised:
`scripts/ops/validate-migration-replay.ts` (the `Replay migrations after an N-1 restore` step in
the `Recovery` workflow) boots the candidate at the current migration head, restores the committed
N-1 fixture onto it — which rewinds `_prisma_migrations` to the fixture's release while every
appended table survives with its rows — then re-applies each rewound migration against that
database and asserts it succeeds.

Each migration is replayed inside its own rolled-back transaction rather than through one
`prisma migrate deploy`, because `migrate deploy` aborts at the first error and would only ever
report one migration. The failures are compared against `KNOWN_REPLAY_UNSAFE_MIGRATIONS` in
`scripts/ops/migration-replay-core.ts`, a checked-in baseline of migrations that predate this gate
and are **not** replay-safe. The comparison is exact in both directions: a migration outside the
baseline that cannot be re-applied fails the gate, and a baseline entry that starts passing fails it
too, so the list can only shrink. While the baseline is non-empty the gate additionally skips the
end-to-end `prisma migrate deploy` assertion and says so; emptying the list turns that assertion —
deploy succeeds, the ledger returns to the pre-restore head with no unfinished, rolled-back, or
duplicated rows, and a second deploy is a clean no-op — back on automatically.

**The baseline is now empty.** Issue #324 made its last five entries (`two_factor_totp`,
`screenplay_access_control`, `screenplay_panel_layouts`, `screenplay_collab_log`,
`screenplay_comment_threads`) idempotent, so the end-to-end assertion runs for real on every
`Recovery` run. Nothing should ever be added back to it: a replay-unsafe migration is a boot crash
loop for any operator restoring an N-1 backup, and the fix is to make the migration idempotent.

Note what this is not. `scripts/smoke-deployment.ts assertExactlyOnceMigration` (the
`concurrent-boot` smoke gate) asserts a different property — that each migration appears _exactly
once_ in `_prisma_migrations` even when two replicas boot simultaneously — and remains in force.
The replay gate also only reaches as far back as the committed fixture: a fixture regenerated from
the current release rewinds nothing, in which case the gate prints a warning rather than failing,
because fixture freshness is a release-checklist item (see below) and not something this lane can
repair.

### How an older dump lands on the current schema

The two restore paths have different requirements, and only one of them replaces an existing schema:

- **The in-app engine** (`apps/api/src/backup/backup-pg.ts`) restores with
  `pg_restore --clean --if-exists --single-transaction --exit-on-error --no-owner --no-privileges`.
  Because the candidate container has already run `prisma migrate deploy`, the target is at the
  current migration head when the older dump is applied, and `--clean --if-exists` drops and
  replaces the objects the dump carries — including `_prisma_migrations`, which is in the dump like
  every other table. This is the path that makes "an older dump restores onto a current build"
  true, and it is the path the round-trip gate exercises. After it, the restored instance's
  migration history is the _dump's_, so the next boot rolls it forward.
- **The operator CLI** (`scripts/ops/coda-recovery.ts`) restores **without** `--clean`/`--if-exists`
  and refuses to run unless the target database contains no public tables. It is a
  restore-into-empty tool by design, which is why the documented procedure has you stand up a fresh
  disposable Compose project first. Do not expect it to overwrite a populated database; it will
  stop at its guard.

## Schema-versioned configuration blobs

The encrypted instance-configuration store keeps one row per configuration key (storage
connection, scheduled-backup schedule, update preferences, upgrade-ceremony state, and so on).
`apps/api/src/config/instance-config-codecs.ts` registers a typed codec per key:

- `version` — a monotonically increasing schema version persisted with every write.
- `schema` — a Zod validator for the current shape.
- `migrate(raw, fromVersion)` — upgrades a blob written under an older version to the current
  shape; it runs only when `fromVersion < version`, and its result is re-validated against
  `schema`.

Because every stored blob records the version it was written under, a shape change ships a **new
version plus a migration step** rather than orphaning existing rows. Rules for changing a config
blob:

1. **Do not change a shape in place.** Bump the key's `version` and extend `migrate` to translate
   every older version to the new shape.
2. **`migrate` must be total across every version that key has ever written**, back to version 1,
   and its output must pass the current `schema`.
3. **Secrets stay encrypted at rest.** Any key holding credentials (storage connection, backup
   destination, Coolify token, redeploy webhook URL) is stored ciphertext-only via the
   `CONFIG_ENCRYPTION_KEY`-backed AES-256-GCM store and is never echoed back to the browser.

## CI gates that enforce this policy

These gates make a compatibility regression fail in CI instead of at an operator's restore. They
must stay green; do not weaken or skip them to land a change.

Before relying on any of them, know when they run. `recovery.yml` is **path-filtered** to
`.github/workflows/recovery.yml`, `apps/api/prisma/**`, `apps/api/src/backup/**`, `compose*.yaml`,
`Dockerfile`, `ops/container-entrypoint.sh`, `scripts/ops/**`, and `tests/fixtures/backups/**`. A
pull request touching none of those matches `recovery-skip.yml` instead, which reports the same
`Restore, upgrade, and rollback` check as a success **without running any gate**. The check name is
green either way, so a green tick on a pull request is not by itself evidence that the recovery
lane ran. Use `workflow_dispatch` when a change affects durable state from outside those paths.

- **In-app backup round-trip and cross-version compatibility** — the `Recovery` workflow
  (`.github/workflows/recovery.yml`) runs `scripts/ops/validate-app-backup-roundtrip.ts` on the
  candidate image when one of the paths above changes. It:
  1. boots a source instance, seeds synthetic demo data, and downloads a signed archive from
     `GET /api/v1/instance/backups/download`;
  2. restores it into a fresh same-version instance via `POST /api/v1/setup/import` and asserts the
     restored business-content digest is byte-for-byte identical to the source; and
  3. restores the committed previous-release fixture
     (`tests/fixtures/backups/coda-backup-n-1.codabk`, with its sidecar
     `tests/fixtures/backups/coda-backup-n-1.json`) into the current build, asserting both that it
     reproduces the recorded digest and that the fixture still sits inside
     `BACKUP_IMPORT_MIN_VERSION`. An aged-out fixture fails loudly here rather than at a user's
     restore.
- **Fixture upkeep** — the N-1 fixture is a small committed binary carrying only synthetic demo
  data and obvious non-secret credentials (safe for this public repository). Regenerate it at each
  release from the image that becomes the previous release with
  `scripts/ops/generate-backup-fixture.ts`, and commit the archive and its sidecar together so the
  recorded digest matches the committed bytes. See `tests/fixtures/backups/README.md`.

  Two limits of this gate are worth stating plainly, because neither is enforced:

  1. **Nothing checks that the fixture is actually N-1.** The committed
     `tests/fixtures/backups/coda-backup-n-1.json` records `appVersion` `0.0.3` while the workspace
     is at `0.0.7`, so the "previous release" fixture is in practice several releases old. That
     makes the restore it exercises _older_ than N-1, which is a stronger cross-version test than
     advertised — but the per-release regeneration this document asks for has not been happening,
     and no check will tell you.
  2. **The aged-out-fixture assertion cannot currently fail.** The script asserts the fixture sits
     at or above `BACKUP_IMPORT_MIN_VERSION`, which is `max(1, BACKUP_FORMAT_VERSION − 2)`. While
     `BACKUP_FORMAT_VERSION` is `1` that floor is `1`, and `1` is the only format version that has
     ever existed, so the assertion is vacuous. It becomes a real gate the first time the format
     version is bumped past `3`. Treat fixture freshness as a release-checklist item, not something
     CI protects.

  The script also compares its own copies of the magic bytes and the format-window constants
  against the engine's (`scripts/ops/backup-roundtrip-core.test.ts`), which runs in the
  `Verify workspace` lane rather than the recovery lane — so constant drift is caught, just not by
  the gate that consumes them.

- **Migration replay after an N-1 restore** — the same `Recovery` workflow runs
  `scripts/ops/validate-migration-replay.ts` on the candidate image. It boots the build against an
  empty database so it reaches the current migration head, restores the committed N-1 fixture
  (which brings the dump's `_prisma_migrations` with it), then re-applies every rewound migration
  and asserts the roll-forward succeeds. A newly written migration that is not safe to apply a
  second time fails here rather than at an operator's restore. `KNOWN_REPLAY_UNSAFE_MIGRATIONS` is
  now empty (issue #324), so the end-to-end `prisma migrate deploy` assertion is on. Its Docker-free
  reasoning is covered by `scripts/ops/migration-replay-core.test.ts`, which the workflow runs
  before building the image.
- **Appended-table foreign keys** — `pnpm quality:appended-table-fks` (in `pnpm quality`) statically
  refuses a foreign key onto `users`, `projects`, or `screenplays`, and any use of `citext` or a
  shared enum, from a table outside the checked-in allowlist. It catches the schema-shape violation
  before the replay gate would ever see it; neither substitutes for the other.
- **Operator recovery lifecycle** — the same `Recovery` workflow runs
  `scripts/ops/validate-recovery-lifecycle.sh`, exercising the coordinated operator
  backup/verify/restore/upgrade/rollback path (including a deliberate signature-tamper rejection)
  from the earliest public manifest to the candidate image.
- **Deployment artifact validation** — `pnpm deployment:validate` renders every canonical,
  localhost, development, and Coolify topology and enforces the shared image, exposure, and
  hardening contracts, so a deploy artifact can never drift from the canonical Compose files. The
  script chains `scripts/validate-deployments.ts` and `deploy/coolify/validate.cjs`. The
  `Verify workspace` job runs the same `pnpm deployment:validate` contract.
- **App-only-first release smoke** — the release workflow smoke-tests the canonical app-only
  topology first, then the bundled full stack, so the primary supported topology is the first
  release gate to fail.

## Checklist for a change that touches a durable artifact

- Archive layout or manifest changed? Bump `BACKUP_FORMAT_VERSION`, keep the N-1/N-2 readers,
  and regenerate the fixture.
- Breaking schema change? Split it expand → migrate → contract across releases; never expand and
  destroy in one step.
- Config blob shape changed? Bump the key's `version` and make `migrate` total from version 1.
- Ran the `Recovery` round-trip and `pnpm deployment:validate` locally before opening the PR.
