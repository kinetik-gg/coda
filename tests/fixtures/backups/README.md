# In-app backup fixtures

These fixtures back the Recovery workflow's **in-app backup round-trip** gate
(`scripts/ops/validate-app-backup-roundtrip.ts`, wired into
`.github/workflows/recovery.yml`). They protect the portability of the CODA-BK1
archive format produced by the in-app backup engine (`apps/api/src/backup/`).

## Files

| File                     | Purpose                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `coda-backup-n-1.codabk` | Signed CODA-BK1 archive produced by the **previous** release (the "N-1" archive).                                  |
| `coda-backup-n-1.json`   | Sidecar metadata: format/app version, the config key it was signed with, and the expected restored content digest. |

## What the gate proves

Every Recovery run:

1. **Same-version round-trip** — creates an archive on the build under test via
   `GET /api/v1/instance/backups/download`, restores it into a fresh
   same-version instance via `POST /api/v1/setup/import`, and asserts the restored
   business-content digest equals the source. A break in the create/restore path or
   the archive framing fails here.
2. **N/N-1 compatibility window** — restores `coda-backup-n-1.codabk` into the
   current build and asserts it reproduces the digest recorded in the sidecar. If a
   change makes the current build unable to ingest the previous release's archives,
   this fails. The engine's import window is N / N-1 / N-2
   (`BACKUP_IMPORT_MIN_VERSION`); the gate additionally asserts the fixture still
   sits inside that window, so an aged-out fixture fails loudly instead of at a
   user's restore.

## Fixture strategy: how the N-1 archive is produced and stored

- The archive is a **small committed binary fixture** checked into this directory.
  It embeds only synthetic demo data (one movie-template project, one item with a
  text field value, and one minimal single-page PDF upload) and obvious non-secret
  credentials — safe for this PUBLIC repository.
- The in-app engine derives its Ed25519 signing key deterministically from
  `CONFIG_ENCRYPTION_KEY`. The fixture is signed with the synthetic key recorded in
  `coda-backup-n-1.json` (`configEncryptionKey`), and the gate provisions the restore
  target with that same key so the signature verifies — mirroring the real operator
  requirement to carry `CONFIG_ENCRYPTION_KEY` to the new deployment.
- **Regeneration is part of the release flow.** At each release, run the generator
  against that release's image so the archive advances one version per release and the
  committed fixture always represents "the previous release":

  ```sh
  CODA_IMAGE=<the release image under test> \
    pnpm tsx scripts/ops/generate-backup-fixture.ts
  ```

  This boots the bundled full-stack topology, seeds the shared synthetic data
  (`scripts/ops/backup-fixture-seed.ts`), downloads a fresh archive, recomputes the
  content digest, and overwrites both files here. Commit the regenerated pair.

## Regenerating locally

Docker is required. From the repo root:

```sh
docker build --tag coda-fixture:local .
CODA_IMAGE=coda-fixture:local pnpm tsx scripts/ops/generate-backup-fixture.ts
```

The content digest covers the storage object key, which is randomly generated per
upload, so each regeneration produces a new digest. That is fine: the generator
records the freshly generated archive's own digest in `coda-backup-n-1.json`, and the
gate only asserts the fixture restores back to that recorded digest (and that a
same-version round-trip is internally self-consistent). Always commit the archive and
its sidecar together so the recorded digest matches the committed bytes.
