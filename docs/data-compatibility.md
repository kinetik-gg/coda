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

- **In-app backup round-trip and N-1 compatibility** — the `Recovery` workflow
  (`.github/workflows/recovery.yml`) runs `scripts/ops/validate-app-backup-roundtrip.ts` on the
  candidate image every time backup code, the schema, or the fixtures change. It:
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
- **Operator recovery lifecycle** — the same `Recovery` workflow runs
  `scripts/ops/validate-recovery-lifecycle.sh`, exercising the coordinated operator
  backup/verify/restore/upgrade/rollback path (including a deliberate signature-tamper rejection)
  from the earliest public manifest to the candidate image.
- **Deployment template validation** — `pnpm deployment:validate` (and, in CI,
  `node deploy/coolify/validate-templates.cjs`) renders every canonical, localhost, development,
  and Coolify topology and enforces the shared image, exposure, and hardening contracts, so a
  deploy artifact can never drift from the canonical Compose files.
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
</content>

</invoke>
