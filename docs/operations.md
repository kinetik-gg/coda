# Deployment and operations

Coda is a stateless application. PostgreSQL and S3-compatible object storage are external
services the operator brings—managed offerings or self-hosted stacks with their own independent
lifecycles. The canonical deployment is therefore the app-only topology; the bundled full stack
remains supported as an all-in-one quickstart for evaluation. A standalone object-storage stack
is available for operators who self-host storage but still want it to keep a lifecycle separate
from the application. Every artifact uses the same immutable Coda image.

| Topology                           | Artifact                    | State services                      | Host ports by default |
| ---------------------------------- | --------------------------- | ----------------------------------- | --------------------- |
| App only (canonical)               | `compose.app.yaml`          | External PostgreSQL and S3          | None                  |
| Full stack (all-in-one quickstart) | `compose.yaml`              | Bundled PostgreSQL and MinIO        | None                  |
| Object storage (standalone)        | `deploy/minio/compose.yaml` | Self-hosted MinIO on its own volume | None                  |

`compose.app.local.yaml`, `compose.local.yaml`, and `deploy/minio/compose.local.yaml` are explicit localhost overrides. Platform ingress and reverse proxies should use the canonical files without local overrides and route to Coda port 3000. Full-stack and standalone object-storage ingress also route the public object-storage domain to MinIO port 9000. Port 9001 and PostgreSQL must remain private.

## Deploy

Each GitHub release attaches `coda-deployment-vX.Y.Z.tar.gz` and its matching `.sha256`
file. Verify the archive before extracting it:

```sh
sha256sum --check coda-deployment-vX.Y.Z.sha256
tar --extract --gzip --file coda-deployment-vX.Y.Z.tar.gz
cd coda-deployment-vX.Y.Z
```

The release bundle contains both canonical Compose topologies, the standalone object-storage
stack, all explicit localhost overlays, the canonical environment templates, and these
operations instructions. Its
`.env.example`, release note, and documentation are generated with the exact attested
multi-architecture manifest digest published by the same release workflow.

The archive also includes dependency-free operator utilities under `operator/`. They require
Node.js 22 or newer, Docker Engine, and the Compose plugin, but do not require a source checkout
or package installation.

1. Copy `.env.example` to `.env` outside version control.
2. Replace every placeholder secret with a unique, high-entropy value. `SETUP_TOKEN` is optional: leave it unset and Coda generates a one-time token at first boot and prints it to the container logs until owner setup completes. Set it explicitly (at least 32 characters) to choose the token yourself, or when running more than one replica, since each replica would otherwise generate its own value.
3. Set `CODA_IMAGE` to the release workflow's attested `name@sha256:...` manifest reference. Do not substitute a mutable version or channel tag.
4. Set `APP_ORIGIN` and `S3_PUBLIC_ENDPOINT` to distinct browser-reachable origins.
5. Start the canonical app-only topology against your external PostgreSQL and object storage. See [App-only deployment](#app-only-deployment) to configure the stores first:

   ```sh
   docker compose -f compose.app.yaml -f compose.app.local.yaml pull
   docker compose -f compose.app.yaml -f compose.app.local.yaml up -d
   ```

   To evaluate the bundled all-in-one quickstart instead, start the full stack, which also provisions PostgreSQL and MinIO:

   ```sh
   docker compose -f compose.yaml -f compose.local.yaml pull
   docker compose -f compose.yaml -f compose.local.yaml up -d
   ```

6. Wait for `GET /api/v1/health/ready` to return success, then complete the one-time owner setup. Use the explicit `SETUP_TOKEN` when configured; otherwise copy the auto-generated token from the container logs (the `CODA SETUP TOKEN` banner), which reprints on every restart until setup completes.

For platform ingress, omit the localhost override (`compose.app.local.yaml` or `compose.local.yaml`); the services remain available to the Compose network through `expose` without publishing host ports. The application entrypoint runs committed Prisma migrations before starting the API. Do not run development migrations against production. See [Replicas and migrations](#replicas-and-migrations) for the supported replica topology and how concurrent boot stays safe.

## App-only deployment

This is the canonical topology. Use `compose.app.yaml` with externally managed PostgreSQL and S3-compatible storage. The bucket must exist and the Coda access key must have the documented bucket-scoped object permissions. Configure the provider's CORS policy for `APP_ORIGIN` before testing signed browser transfers. If you self-host object storage rather than using a managed provider, deploy the [standalone object-storage stack](#standalone-object-storage) as a separate resource and point the `S3_*` variables at it.

For managed PostgreSQL, use the provider's direct migration-capable connection URL and require TLS, for example:

```dotenv
DATABASE_URL=postgresql://user:password@db.example.com:5432/coda?schema=public&sslmode=require&sslaccept=strict
```

If the provider supplies a private CA, mount the certificate read-only and use Prisma's supported certificate parameters. Do not disable certificate validation. Passwords and certificate paths in connection URLs must be percent-encoded where required.

For a direct localhost deployment:

```sh
docker compose -f compose.app.yaml -f compose.app.local.yaml up -d
```

The equivalent app-only container invocation is:

```sh
export CODA_IMAGE='ghcr.io/kinetik-gg/coda@sha256:39bc82fd4aa9c91a1a952bb52744fc02ddedf7ec30a7f1ee9df16c3017818a71'
cp deploy/coda.app.env.example coda.app.env
# Replace every placeholder and restrict the file before starting the container.
chmod 600 coda.app.env
docker run --detach --name coda --restart unless-stopped \
  --memory 2g --memory-swap 2560m --pids-limit 128 \
  --read-only --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m,mode=1777 \
  --security-opt no-new-privileges --cap-drop ALL \
  --publish 127.0.0.1:3000:3000 \
  --env-file coda.app.env \
  "$CODA_IMAGE"
```

The minimal template intentionally omits `CODA_IMAGE`, bind-address variables, PostgreSQL bootstrap credentials, and MinIO root credentials. The application runtime allows 2 GiB of memory, 512 MiB of additional swap, and 128 processes or threads. The bundled full-stack topology also bounds PostgreSQL to 1 GiB of memory, 256 MiB of additional swap, and 192 processes, and bounds object storage to 1.5 GiB of memory, 512 MiB of additional swap, and 128 processes or threads. Sustained swap use indicates capacity pressure. `.env.example` remains the canonical reference for optional limits and tuning. Keep `coda.app.env` readable only by the deployment operator.

## Standalone object storage

`deploy/minio/compose.yaml` is a self-contained, hardened MinIO stack for operators who self-host object storage but want it to keep a lifecycle independent of the application. Deploy it as its own resource so the bucket survives application redeploys, upgrades, and restarts, and so it can later be replaced by a managed provider (R2, S3, Spaces) without touching the application resource.

The stack extracts the same `minio-permissions`, `minio`, and `minio-init` services used by the bundled full stack, with identical hardening: the object store runs as `1000:1000`, the one-shot ownership migration is the only narrowly privileged step (`CHOWN` only, all other capabilities dropped), the administration console binds to loopback, only the object API is exposed internally, and `minio-init` idempotently provisions the private bucket, the bucket-scoped `coda-app` policy, and the service account. Its named `minio-data` volume is separate from any application project.

Copy `deploy/minio/minio.env.example` to `deploy/minio/minio.env`, replace every placeholder, and restrict the file. It defines only the object-storage variables (`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, `MINIO_CORS_ALLOW_ORIGIN`, `MINIO_FORCE_OWNERSHIP_REPAIR`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`); it carries no `CODA_IMAGE`, `DATABASE_URL`, or application variables. Set `MINIO_CORS_ALLOW_ORIGIN` to the Coda `APP_ORIGIN`. The MinIO root credentials bootstrap the bucket and service account and are never handed to Coda; the application receives only the bucket-scoped `S3_ACCESS_KEY` and `S3_SECRET_KEY`.

```sh
docker compose -f deploy/minio/compose.yaml -f deploy/minio/compose.local.yaml up -d
```

For platform ingress, omit `deploy/minio/compose.local.yaml` and route the public object-storage domain to MinIO port 9000; port 9001 must remain private. Point the application's `S3_ENDPOINT` at the stack over the platform network and `S3_PUBLIC_ENDPOINT` at its public object-storage domain. The stack performs its data-volume ownership migration once; after restoring the volume from a filesystem-level backup, set `MINIO_FORCE_OWNERSHIP_REPAIR=1` for one deployment, confirm the object store is healthy, then return it to `0`. Back up this stack independently of the application, together with the PostgreSQL backup, so database object references and stored objects stay consistent.

## Replicas and migrations

Coda supports horizontal scaling of the application container. The supported topology is
single-writer migrations on boot: every replica runs `prisma migrate deploy` from its entrypoint
before serving traffic, but the schema has exactly one writer at any instant.

- **Same image version.** Every replica must run the identical `CODA_IMAGE` manifest digest. A
  migration set is a property of an image; mixing versions lets an older replica reapply or race a
  schema the newer image already changed. Roll all replicas forward together, and never start an
  older image against a database a newer image has already migrated (see [Upgrade](#upgrade)).
- **Concurrent boot is safe.** When several replicas boot at once against the same database, Prisma
  serializes them with a PostgreSQL advisory lock held across `migrate deploy`. Exactly one replica
  applies the pending migrations; the others block on the lock, then observe no pending migrations
  and start. Migrations are therefore applied exactly once even under a simultaneous cold start, so
  raising the replica count on a platform requires no migration coordination or init container.
- **One database.** All replicas share one primary PostgreSQL database. Read replicas are not part
  of the supported topology; the advisory lock and migration state live on the primary.

This guarantee is exercised in CI by the `smoke-deployment.ts concurrent-boot` gate, which boots two
application containers simultaneously against one empty PostgreSQL, waits for both to converge
healthy, and asserts that the committed migration set was applied exactly once with no duplicated,
unfinished, or rolled-back rows in `_prisma_migrations`.

## Environment contract

`.env.example` is the canonical Compose variable template. Platform secret stores may supply the same names directly instead of creating a file.

- Every topology requires the immutable `CODA_IMAGE`, distinct `APP_ORIGIN` and `S3_PUBLIC_ENDPOINT` origins, narrow `TRUSTED_PROXY_CIDRS`, `DATABASE_URL`, and bucket-scoped `S3_*` credentials. `SETUP_TOKEN` is optional and auto-generated at first boot when unset; provide it explicitly for multi-replica bootstrap.
- Full stack additionally requires `POSTGRES_PASSWORD`, `MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`, and `MINIO_CORS_ALLOW_ORIGIN`. These bootstrap credentials are not passed to Coda.
- The bundled object store performs its ownership migration once. After restoring its data volume from a filesystem-level backup, set `MINIO_FORCE_OWNERSHIP_REPAIR=1` for one deployment, verify the object store is healthy, then return it to `0`. Application-level bucket restores do not require this repair.
- App only requires an existing bucket. Set `S3_FORCE_PATH_STYLE=false` for providers that use virtual-hosted bucket addressing; retain `true` for MinIO and providers that require path-style addressing.
- `CONFIG_ENCRYPTION_KEY` is a base64-encoded key of at least 32 bytes (generate with `openssl rand -base64 32`) that encrypts the instance-configuration store with AES-256-GCM. Secrets at rest are ciphertext only. It is optional until a feature writes runtime configuration and required from then on: keep it stable and back it up alongside your database, since the same key is needed to decrypt existing rows. A container recreated with the same `DATABASE_URL` and key sees identical configuration. If encrypted config rows exist but the key is missing or wrong, Coda fails to start with a diagnostic error rather than risk silent data loss; restore the original key to recover.
- `AUTH_LOGIN_BACKOFF_THRESHOLD` (default `5`) and `AUTH_LOGIN_BACKOFF_WINDOWS_MS` (default `60000,300000,900000`) tune account-scoped progressive login backoff, applied in addition to per-IP throttling. After the threshold of consecutive failed logins for one account, each further failure opens the next delay window in milliseconds, with the final value as the cap; the counter and lock are cleared on a successful login or completed password reset. See `docs/security.md`.
- `LOG_LEVEL` sets the structured-log verbosity. `LOG_HTTP_ERROR_DETAIL` (default `false`) is an opt-in staging diagnostic: when `true`, request-error log entries carry the sanitized error name, message, and HTTP status, plus a stack trace for 5xx responses. It never logs request bodies, headers, cookies, tokens, or query strings, and the default keeps the redacted production behavior. Leave it `false` in production.
- `CODA_BIND_ADDRESS`, `CODA_APP_PORT`, `CODA_S3_BIND_ADDRESS`, and `CODA_S3_PORT` affect only the explicit localhost overrides.
- Values containing URL-reserved characters must be percent-encoded inside connection URLs. Never commit populated environment files.

Run `pnpm deployment:validate` after changing a Compose file or deployment variable. It renders
every canonical, localhost, development, and test combination and enforces the shared image,
exposure, and hardening contracts.

## Reverse proxy

Terminate TLS at a reverse proxy and forward WebSocket upgrades for Socket.IO. Preserve the original host and scheme. Use internal Compose exposure for platform ingress; use the localhost overrides only for a proxy running directly on the Docker host. Set `TRUSTED_PROXY_CIDRS` to the comma-separated source IPs or narrow CIDRs from which Coda receives proxy traffic; Coda trusts `X-Forwarded-For` only from those addresses so throttling remains per client. Ensure the proxy overwrites forwarded headers. Do not use an all-address CIDR such as `0.0.0.0/0`. Limit request bodies at or above Coda's configured PDF and asset limits. The S3 API must be browser-reachable at `S3_PUBLIC_ENDPOINT`, while its administration surface and internal endpoint remain private.

Project JSON exports stream from a repeatable-read database snapshot. A slow or abandoned download therefore holds one database connection until completion, cancellation, or the bounded export timeout.

## Health and logs

- `/api/v1/health/live` indicates that the process is running.
- `/api/v1/health/ready` checks whether required dependencies are ready.
- Application logs are structured JSON and include an `x-request-id` response header for correlation.

Monitor application restarts, readiness failures, Postgres capacity, object-store capacity, request latency, error rate, and backup age.

Audit a deployed Coda container against the release runtime contract with its explicit
container name and immutable image reference:

```sh
pnpm deployment:audit-runtime -- \
  --container <container-name> \
  --image 'registry.example/coda@sha256:<64-hex-digest>' \
  --role application
```

The audit reads only selected image, effective user, state, health, privilege, capability,
isolation, resource-limit, temporary-filesystem, and port-binding fields from Docker. It does not
inspect environment values. Use `--role database` and `--role object-storage` for the bundled
full-stack dependencies.
The audit rejects host port bindings by default. Disposable loopback-only smoke environments may
declare one expected container port with `--allow-loopback-port`; this does not permit wildcard
host bindings.

## Upload resource limits

Uploads reserve space against per-project and instance-wide incomplete-upload limits before Coda returns a signed URL. Tune `STORAGE_PENDING_MAX_OBJECTS`, `STORAGE_PENDING_MAX_BYTES`, `STORAGE_PENDING_INSTANCE_MAX_OBJECTS`, and `STORAGE_PENDING_INSTANCE_MAX_BYTES` for the capacity of the object store. Pending or failed uploads older than `STORAGE_UPLOAD_RETENTION_HOURS`, including incomplete objects moved to trash, are removed through the durable storage-deletion queue.

PDF inspection transfers the bounded input buffer to a dedicated worker. `PDF_WORKER_MAX_OLD_GENERATION_MB` caps that worker's old-generation heap, while `PDF_MAX_BYTES` caps the input and cannot be configured above 262,144,000 bytes. Keep container or host memory monitoring enabled even when using these application-level limits.

Screenplay mutations first pass a bounded fixed-window pre-authentication limit keyed by the trusted client address: `SCREENPLAY_PREAUTH_MAX_PER_CLIENT` and `SCREENPLAY_PREAUTH_MAX_GLOBAL` apply during `SCREENPLAY_PREAUTH_WINDOW_MS`, return `429` with `Retry-After`, and run before session lookup or body parsing. Configure an equivalent edge limit at the reverse proxy as defense in depth. Bodies are admitted for parsing only after an active, unexpired cookie session is verified; bearer credentials cannot mutate screenplays. `SCREENPLAY_REQUEST_MAX_BYTES` is the transport byte ceiling for source-bearing routes; checkpoint creation is independently capped at 1 KiB. `SCREENPLAY_BODY_MAX_CONCURRENT` bounds session verification and parsing process-wide and must be at least two. Admission reserves one slot from any single trusted client address before authentication, then re-keys the reservation to the verified session so one client or session cannot consume every slot. `SCREENPLAY_BODY_TIMEOUT_MS` terminates stalled requests before releasing their admission capacity. Owner storage is limited transactionally by `SCREENPLAY_MAX_DOCUMENTS_PER_OWNER` and `SCREENPLAY_MAX_SOURCE_BYTES_PER_OWNER`; the latter measures canonical Fountain source as UTF-8 bytes. Explicit export checkpoints have a separate byte budget equal to the configured owner source-byte budget and are capped at 100 immutable snapshots per screenplay. Idempotent retries for an existing screenplay/version do not consume quota. Increasing the source-byte limit therefore also increases potential checkpoint storage and requires corresponding Postgres capacity and request-memory monitoring.

## Back up

A complete backup needs both Postgres and object storage from a consistent point in time. The database contains object keys and reference state; restoring only one side can leave missing or orphaned files.

For the bundled topology, `scripts/ops/coda-recovery.ts` provides a coordinated, inspectable
procedure. It stops only the Coda container while leaving its PostgreSQL and MinIO services
available, creates a PostgreSQL custom-format dump, mirrors the configured bucket, rejects
missing `READY` object references, then restarts Coda and waits for readiness. The output
manifest records the exact immutable Coda manifest digest, completed Prisma migrations, UTC
timestamp, dump checksum, and a byte-size and SHA-256 inventory for every object. The recovery
directory must not already exist.

Create a dedicated Ed25519 recovery-signing key outside the backup location. Keep the private key on a protected operator host or in a deployment secret store with operator-only access. Distribute the public verification key through a separate trusted channel; copying it into the backup would let an attacker replace both the backup and its claimed identity. OpenSSL 3 or another Ed25519-capable key generator is required to create the key pair.

```sh
umask 077
openssl genpkey -algorithm ED25519 -out /secure/recovery-signing.pem
openssl pkey -in /secure/recovery-signing.pem -pubout -out /secure/recovery-verification.pem
```

```sh
pnpm exec tsx scripts/ops/coda-recovery.ts backup \
  --project coda \
  --env-file /secure/coda.env \
  --compose-file compose.yaml \
  --recovery-directory /secure/backups/coda-2026-07-23T120000Z \
  --signing-key /secure/recovery-signing.pem \
  --image 'ghcr.io/kinetik-gg/coda@sha256:release-manifest-digest'
```

Run `verify` against copied or retrieved backup material before attempting a restore:

```sh
pnpm exec tsx scripts/ops/coda-recovery.ts verify \
  --project coda \
  --env-file /secure/coda.env \
  --recovery-directory /secure/backups/coda-2026-07-23T120000Z \
  --verification-key /secure/recovery-verification.pem
```

`manifest.sig` authenticates the exact manifest bytes. `verify`, `restore`, and `smoke` reject missing, malformed, incorrectly signed, or differently keyed manifests before checksums, paths, Docker state, or database contents are trusted. The manifest and public-key fingerprint do not contain credentials. Backup files still contain private application data and must be encrypted at rest, access-controlled, retained outside the deployment host, and deleted according to the operator's data-retention policy.

For a small instance, stop Coda writes before taking backups:

1. Stop or place the Coda application behind maintenance mode while leaving Postgres and MinIO running.
2. Create a PostgreSQL custom-format dump with `pg_dump`.
3. Snapshot or mirror the MinIO bucket and its configuration using the object-store's supported backup procedure.
4. Record the Coda image digest, database migration version, backup timestamp, and checksums.
5. Store encrypted copies outside the host and test restoration regularly.

Do not treat Docker volumes, filesystem synchronization, or the project JSON export as a complete backup by itself.

## Restore

Restore into an isolated environment first. Use the same Coda release that created the backup, restore Postgres and object storage, verify configuration, then run readiness and product smoke tests. Confirm that source PDFs and other storage objects can be read before switching traffic.

The guarded restore command supports the bundled topology. Before invoking it, start only `postgres`, `minio`, and the one-shot `minio-init` service in a new Compose project. The target name must match `recovery-*` or `coda-recovery-*`, `CODA_RECOVERY_DISPOSABLE_PROJECT` must exactly repeat that name, PostgreSQL must contain no public tables, the bucket must contain no objects, and no Coda container may exist. Any failed guard stops the operation before `pg_restore` runs.

```sh
target=coda-recovery-restore-20260723
docker compose --project-name "$target" --env-file /secure/restore.env \
  -f compose.yaml up --detach postgres minio minio-init
docker compose --project-name "$target" --env-file /secure/restore.env \
  -f compose.yaml wait minio-init
CODA_RECOVERY_DISPOSABLE_PROJECT="$target" \
  pnpm exec tsx scripts/ops/coda-recovery.ts restore \
    --project "$target" \
    --env-file /secure/restore.env \
    --compose-file compose.yaml \
    --recovery-directory /secure/backups/coda-2026-07-23T120000Z \
    --verification-key /secure/recovery-verification.pem
```

Restore starts the exact image recorded in the manifest, waits for dependency readiness, requires the restored migration set to match, verifies database object references against the checksummed mirror, and records a dated JSON smoke-test result beside the backup. This tool deliberately refuses in-place production restores and external managed-service deletion. App-only deployments should use equivalent provider-native point-in-time recovery and bucket-version restoration in an isolated account or project, then run the same migration, object-reference, readiness, and product checks before cutover.

Restoration overwrites durable state. Keep the previous environment intact until the restored instance is verified.

## Upgrade

Release verification starts the previous published release, creates persistent instance
state, upgrades that same deployment to the candidate image, and verifies readiness and
owner authentication. This gate tests the supported forward upgrade path; it is not a
rollback test.

1. Read `CHANGELOG.md` and the release notes.
2. Take and verify a complete backup.
3. Pin `CODA_IMAGE` to the target release's attested `name@sha256:...` manifest reference.
4. Pull the image and recreate only the Coda service:

   ```sh
   docker compose -f compose.yaml -f compose.local.yaml pull coda
   docker compose -f compose.yaml -f compose.local.yaml up -d coda
   ```

   For app-only installations, use `compose.app.yaml` and the same optional override used during installation.

5. Watch migration output and wait for readiness.
6. Smoke-test sign-in, project reads and writes, source PDF access, upload, export, and an external credential if used.

Database migrations are forward operations. A rollback that crosses a migration boundary requires the release-specific procedure or a verified backup restore.

Never start an older Coda image on a database after a newer image has applied migrations. Rollback across a migration boundary means keeping the upgraded environment intact, creating a fresh empty target, and restoring the coordinated backup with the exact older image recorded by its manifest. For a disposable recovery target only, `reset` removes that explicitly confirmed Compose project and its volumes:

```sh
CODA_RECOVERY_DISPOSABLE_PROJECT="$target" \
  pnpm exec tsx scripts/ops/coda-recovery.ts reset \
    --project "$target" --env-file /secure/restore.env --compose-file compose.yaml
```

The `Recovery` GitHub Actions workflow continuously exercises the full bundled lifecycle from the public v0.0.1 manifest digest to the current candidate: API fixture creation with a real object reference, signed coordinated backup, deliberate signature-tamper rejection, same-version restore, candidate upgrade and smoke test, destructive reset limited to the disposable target, then rollback by restoring the matching v0.0.1 backup. It runs both the bundled and app-only Compose application boundaries; the app-only test supplies disposable PostgreSQL and MinIO services only as stand-ins for provider-native restore targets. Dated manifests, signatures, public verification keys, dumps, object inventories, and smoke evidence are retained for review. Unit, integration, and browser end-to-end suites remain separate required release gates; recovery validation supplements rather than replaces them.

## Digest propagation

Every published release keeps the immutable-digest model but removes the manual digest hunt.

- **Machine-readable descriptor.** Each GitHub release attaches a `release.json` asset with the exact `version`, `image`, `digest`, and `bundleSha256` fields. Platforms and scripts read it to discover the current immutable digest without scraping release notes. Resolve the latest release descriptor from the repository's GitHub Releases API and pin the reported `image@digest` reference verbatim; never rewrite it to a mutable tag.
- **Automated propagation pull request.** After a release publishes, the release workflow opens a pull request that rewrites every in-repo image reference in the deployment templates and this document to the new immutable digest. The workflow runs the Coolify deployment validator against the rewritten templates before opening the pull request, so a mutable or malformed reference blocks it. Review and merge the pull request to make the new digest the repository default; because the workflow creates it with `GITHUB_TOKEN`, re-run the required checks from the pull request before merging.

## Optional post-upgrade redeploy hook

Operators who want a hands-off cutover can register a deployment-platform redeploy webhook so that a repository Action requests a redeploy after the digest-propagation pull request merges. This hook is **disabled by default** and ships no platform-specific integration: it is a single authenticated `POST` to a URL you control.

> Back up first. Automated redeploys can apply forward-only database migrations. Never enable this hook for a stateful installation without a verified, restorable backup taken immediately before the redeploy. Rolling back across a migration boundary requires the coordinated backup-and-restore procedure documented above, not a webhook.

To enable it:

1. Take and verify a complete backup, and confirm your platform can restore it.
2. Create the redeploy webhook in your deployment platform. It should redeploy using the digest already pinned in your platform's environment, which the merged propagation pull request has updated in the repository templates you track.
3. Store the webhook URL in a repository or environment secret named `REDEPLOY_WEBHOOK_URL`. Optionally store an authorization header value in `REDEPLOY_WEBHOOK_AUTHORIZATION`. Keep both out of version control; secrets are never printed by the workflow.
4. Run the `Redeploy` workflow manually (`workflow_dispatch`) once you have verified the backup and reviewed the merged digest change. The workflow is a no-op when `REDEPLOY_WEBHOOK_URL` is unset, so forking or cloning the repository never triggers a redeploy.

The provided `Redeploy` workflow is intentionally manual so a human confirms the backup before any redeploy. Operators who accept the risk can extend its triggers to run automatically when the propagation pull request merges; do so only with a verified restore path and platform health checks in place. The webhook contract is your platform's: Coda posts an empty body with an optional operator-supplied authorization header and treats any 2xx response as accepted.
