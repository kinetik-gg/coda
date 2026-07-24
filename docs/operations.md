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

For platform ingress, omit the localhost override (`compose.app.local.yaml` or `compose.local.yaml`); the services remain available to the Compose network through `expose` without publishing host ports. The application runs committed Prisma migrations at boot, once its own database connection probe succeeds; see [Database connection troubleshooting](#database-connection-troubleshooting) for what happens while the database is still unreachable. Do not run development migrations against production. See [Replicas and migrations](#replicas-and-migrations) for the supported replica topology and how concurrent boot stays safe.

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
single-writer migrations on boot: every replica runs `prisma migrate deploy` at boot, once its
database connection probe succeeds, before serving traffic, but the schema has exactly one writer
at any instant.

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

`.env.example` is the canonical Compose variable template. Platform secret stores may supply the same names directly instead of creating a file. The tables below are the complete reference: every variable the application parses is defined in `apps/api/src/config/env.ts`, and every value listed here matches that schema. Values containing URL-reserved characters must be percent-encoded inside connection URLs. Never commit populated environment files.

### Provenance: environment versus in-app settings

Most variables are read once at boot and stay fixed for the life of the container. Some feature areas layer an in-app override on top of the environment value, stored in the encrypted instance-configuration store and shown with its source in the UI:

- **Object storage.** `S3_*` bootstrap the backend at first boot. After setup, the [storage settings wizard](#storage-settings-wizard) can replace the active backend at runtime; the Storage page shows whether the live backend came from the environment or from stored settings, and "Revert to environment configuration" restores the `S3_*` values.
- **Update polling.** `UPDATE_CHECK_INTERVAL_HOURS` is the environment default cadence. The Updates section can set a polling-interval override; the effective value is the override when present, otherwise the environment default, and the source is reported as `env` or `config`.
- **Scheduled backups and storage migration** are configured entirely in the UI and stored in the config store — they add no environment variables.

Any override, and every credential the wizard persists, is encrypted with `CONFIG_ENCRYPTION_KEY`; a database dump alone never reveals a secret key.

### Core and topology

| Variable              | Default                 | Constraints / notes                                                                                                                                                                                                                                           |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`            | `development`           | `development`, `test`, or `production`. Deployment templates set `production`.                                                                                                                                                                                |
| `PORT`                | `3000`                  | Application listen port, `1`–`65535`.                                                                                                                                                                                                                         |
| `APP_ORIGIN`          | `http://localhost:3000` | Browser-reachable origin, no path. Must be HTTPS in production unless loopback-local, and must be a different origin from `S3_PUBLIC_ENDPOINT`.                                                                                                               |
| `TRUSTED_PROXY_CIDRS` | `127.0.0.1/32,::1/128`  | Either the single token `auto` or 1–32 explicit IPs/CIDRs. `auto` trusts the private subnets attached to the container at boot and logs the resolved set. Never mix `auto` with a list; never use `0.0.0.0/0` or `::/0`. See [Reverse proxy](#reverse-proxy). |
| `DATABASE_URL`        | _required_              | PostgreSQL connection string. Require TLS for managed providers. Percent-encode reserved characters in the password.                                                                                                                                          |
| `DEV_ALLOWED_ORIGINS` | _(empty)_               | Comma-separated extra browser origins, max 16. Development/test only; rejected in production.                                                                                                                                                                 |

### Configuration store and database boot

| Variable                     | Default                 | Constraints / notes                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CONFIG_ENCRYPTION_KEY`      | _(unset)_               | Base64 key of at least 32 bytes (`openssl rand -base64 32`) that encrypts the instance-configuration store with AES-256-GCM. Optional until a feature writes runtime configuration, required from then on. Keep it stable and back it up alongside the database; the same key decrypts existing rows and derives the in-app backup signing key. If encrypted rows exist but the key is missing or wrong, Coda refuses to start rather than risk silent data loss. |
| `DB_BOOT_CONNECT_TIMEOUT_MS` | `5000`                  | Bounds one boot-time database-connection probe attempt, `1000`–`30000` ms. See [Database connection troubleshooting](#database-connection-troubleshooting).                                                                                                                                                                                                                                                                                                       |
| `DB_BOOT_RETRY_WINDOWS_MS`   | `2000,5000,10000,30000` | Progressive retry backoff for the boot probe (1–8 entries, each `500`–`300000` ms). The final value is the cap once attempts exceed the list length.                                                                                                                                                                                                                                                                                                              |

### Sessions and authentication

| Variable                        | Default               | Constraints / notes                                                                                                                                                                                                                                                                     |
| ------------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SESSION_COOKIE_NAME`           | `coda_session`        | Session cookie name.                                                                                                                                                                                                                                                                    |
| `SESSION_TTL_DAYS`              | `30`                  | Session lifetime, `1`–`365` days.                                                                                                                                                                                                                                                       |
| `AUTH_LOGIN_BACKOFF_THRESHOLD`  | `5`                   | Consecutive failed logins for one account, `1`–`100`, before progressive backoff begins (in addition to per-IP throttling).                                                                                                                                                             |
| `AUTH_LOGIN_BACKOFF_WINDOWS_MS` | `60000,300000,900000` | Progressive per-account delay windows (1–12 entries, each `1000`–`86400000` ms); the final value is the cap. Cleared on a successful login or completed password reset. See `docs/security.md`.                                                                                         |
| `SETUP_TOKEN`                   | _(auto-generated)_    | Optional. Leave unset and Coda generates a one-time token at first boot, printed to the container logs (the `CODA SETUP TOKEN` banner) until owner setup completes. Set an explicit value of at least 32 characters to choose it yourself; required when running more than one replica. |

### Object storage

| Variable              | Default     | Constraints / notes                                                                                                             |
| --------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `S3_ENDPOINT`         | _required_  | Internal endpoint Coda reaches over the platform network.                                                                       |
| `S3_PUBLIC_ENDPOINT`  | _required_  | Browser-reachable object-storage origin, no path. Distinct origin from `APP_ORIGIN`; HTTPS in production unless loopback-local. |
| `S3_REGION`           | `us-east-1` | Provider region.                                                                                                                |
| `S3_BUCKET`           | _required_  | Private bucket name, at least 3 characters. Must already exist for app-only deployments.                                        |
| `S3_ACCESS_KEY`       | _required_  | Bucket-scoped access key. Never an administrative key.                                                                          |
| `S3_SECRET_KEY`       | _required_  | Bucket-scoped secret, at least 8 characters.                                                                                    |
| `S3_FORCE_PATH_STYLE` | `true`      | `true` for MinIO and path-style providers; `false` for virtual-hosted providers (R2, S3, Spaces).                               |

### Updates, metrics, scheduler, and backups

| Variable                          | Default   | Constraints / notes                                                                                                                                                                                                                                  |
| --------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `UPDATE_CHECK_INTERVAL_HOURS`     | `24`      | Environment default cadence for polling the latest release's `release.json`, `0`–`8760`. `0` disables polling entirely (zero network calls). Startup jitter of up to five minutes spreads a fleet's first check. Overridable in the Updates section. |
| `METRICS_TOKEN`                   | _(unset)_ | Optional, at least 16 characters. Unset disables `/metrics` entirely (the route returns `404`). Set to enable `Authorization: Bearer` scraping. See [Metrics](#metrics).                                                                             |
| `SCHEDULER_JOB_TIMEOUT_MS`        | `300000`  | Bounds one scheduled-job tick, `1000`–`3600000` ms. Recurring jobs run exactly once across replicas via a Postgres advisory lock; a failure is recorded and retried on the next tick without affecting liveness.                                     |
| `SCHEDULER_HEARTBEAT_ENABLED`     | `false`   | Optional scheduler self-check job whose run count is a liveness signal. Leave disabled unless you want that signal.                                                                                                                                  |
| `SCHEDULER_HEARTBEAT_INTERVAL_MS` | `3600000` | Heartbeat cadence when enabled, `1000`–`86400000` ms.                                                                                                                                                                                                |
| `PRE_UPGRADE_BACKUP`              | `on`      | `on` or `off`. When `on`, an initialized instance writes an automatic signed archive under `backups/pre-upgrade/` before applying pending migrations. Requires `CONFIG_ENCRYPTION_KEY`. See [Pre-upgrade auto-backup](#pre-upgrade-auto-backup).     |
| `PRE_UPGRADE_BACKUP_KEEP`         | `3`       | Number of pre-upgrade archives to retain, `1`–`50`; older ones are pruned after a successful backup.                                                                                                                                                 |
| `SCHEDULED_BACKUP_TICK_MS`        | `3600000` | Polling granularity for the scheduled-backup job, `1000`–`86400000` ms. The effective cadence is the operator-configured interval (hours); this only sets how often the job wakes to check. See [Scheduled backups](#scheduled-backups).             |

### Logging

| Variable                | Default | Constraints / notes                                                                                                                                                                                                                     |
| ----------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `LOG_LEVEL`             | `info`  | One of `fatal`, `error`, `warn`, `info`, `debug`, `trace`.                                                                                                                                                                              |
| `LOG_HTTP_ERROR_DETAIL` | `false` | Opt-in staging diagnostic. When `true`, request-error logs carry the sanitized error name, message, and status, plus a stack trace for 5xx. Never logs bodies, headers, cookies, tokens, or query strings. Leave `false` in production. |

### Upload, PDF, and screenplay limits

These tune capacity and abuse limits; the defaults suit a small instance. Full definitions and ranges are in `apps/api/src/config/env.ts`; behavior is described under [Upload resource limits](#upload-resource-limits).

| Variable                                | Default       |
| --------------------------------------- | ------------- |
| `PDF_MAX_BYTES`                         | `262144000`   |
| `PDF_WORKER_MAX_OLD_GENERATION_MB`      | `512`         |
| `SCREENPLAY_REQUEST_MAX_BYTES`          | `20016384`    |
| `SCREENPLAY_BODY_MAX_CONCURRENT`        | `4`           |
| `SCREENPLAY_PREAUTH_WINDOW_MS`          | `60000`       |
| `SCREENPLAY_PREAUTH_MAX_PER_CLIENT`     | `120`         |
| `SCREENPLAY_PREAUTH_MAX_GLOBAL`         | `1200`        |
| `SCREENPLAY_BODY_TIMEOUT_MS`            | `30000`       |
| `SCREENPLAY_MAX_DOCUMENTS_PER_OWNER`    | `250`         |
| `SCREENPLAY_MAX_SOURCE_BYTES_PER_OWNER` | `262144000`   |
| `ASSET_MAX_BYTES`                       | `2147483648`  |
| `STORAGE_PENDING_MAX_OBJECTS`           | `20`          |
| `STORAGE_PENDING_MAX_BYTES`             | `5368709120`  |
| `STORAGE_PENDING_INSTANCE_MAX_OBJECTS`  | `1000`        |
| `STORAGE_PENDING_INSTANCE_MAX_BYTES`    | `21474836480` |
| `STORAGE_UPLOAD_RETENTION_HOURS`        | `24`          |
| `SIGNED_READ_TTL_SECONDS`               | `300`         |
| `SIGNED_UPLOAD_TTL_SECONDS`             | `900`         |

`SCREENPLAY_PREAUTH_MAX_GLOBAL` must be at least `SCREENPLAY_PREAUTH_MAX_PER_CLIENT`, and `SCREENPLAY_BODY_MAX_CONCURRENT` must be at least 2.

### Compose and infrastructure variables

These are consumed by the Compose files and one-shot initializers, not parsed by the application schema.

| Variable                       | Topology                     | Notes                                                                                                                                      |
| ------------------------------ | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `CODA_IMAGE`                   | All                          | Immutable `name@sha256:...` manifest reference. Never a mutable version or channel tag.                                                    |
| `CODA_BIND_ADDRESS`            | Localhost overrides only     | Host bind address for the application port.                                                                                                |
| `CODA_APP_PORT`                | Localhost overrides only     | Host port mapped to the application.                                                                                                       |
| `CODA_S3_BIND_ADDRESS`         | Localhost overrides only     | Host bind address for the MinIO S3 API.                                                                                                    |
| `CODA_S3_PORT`                 | Localhost overrides only     | Host port mapped to the MinIO S3 API.                                                                                                      |
| `POSTGRES_PASSWORD`            | Full stack                   | Bootstraps the bundled PostgreSQL. Keep it identical to the password inside `DATABASE_URL` (URL-encoded there).                            |
| `MINIO_ROOT_USER`              | Full stack, standalone MinIO | Bootstraps the bucket and service account. Never passed to Coda.                                                                           |
| `MINIO_ROOT_PASSWORD`          | Full stack, standalone MinIO | Bootstraps the bucket and service account. Never passed to Coda.                                                                           |
| `MINIO_CORS_ALLOW_ORIGIN`      | Full stack, standalone MinIO | Browser origins allowed to use signed MinIO URLs. Set to the Coda `APP_ORIGIN` (plus development origins).                                 |
| `MINIO_FORCE_OWNERSHIP_REPAIR` | Full stack, standalone MinIO | `0`/`1`. Set to `1` for one deployment after restoring the data volume from a filesystem-level backup, then return to `0`.                 |
| `CODA_DEMO_RESET`              | Seed script only             | Destructive demo reset guard restricted to loopback services (`apps/api/prisma/seed.ts`). Never set in a shared or production environment. |

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

Monitor application restarts, readiness failures, Postgres capacity, object-store capacity, request latency, error rate, and backup age. See [Metrics](#metrics) below for the Prometheus scrape endpoint.

## Database connection troubleshooting

If the initial database connection fails at boot, Coda does not crash-loop. It serves a minimal, static diagnostic page on the normal application port and retries with backoff, then recovers in place — no container restart required — once the database becomes reachable.

- `GET /api/v1/health/live` keeps reporting healthy throughout, so platforms do not kill the container while it waits on the database.
- `GET /api/v1/health/ready` fails throughout with `503`, so load balancers and orchestrators do not route traffic to it.
- Every other request receives the diagnostic page: the target host and port (never credentials, never the database name or query parameters), an error classification, targeted hints, the attempt count, and the next retry time.
- Migrations run after the connection probe succeeds rather than before boot, so a database that only becomes reachable partway through migration also recovers in place instead of crashing the container.

| Error class          | Meaning                                         | Typical hint                                                                                                                                                 |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dns`                | The hostname in `DATABASE_URL` did not resolve. | Check for typos and confirm the hostname resolves from inside the container network; managed providers often expose separate internal and public hostnames.  |
| `connection-refused` | The TCP connection to host:port was refused.    | Confirm the database is running and listening, and check firewall or security-group rules.                                                                   |
| `tls`                | The TLS/SSL handshake failed.                   | Managed Postgres providers usually require `sslmode=require` (or `sslaccept=strict`); mount the provider's CA instead of disabling certificate verification. |
| `auth`               | Authentication failed.                          | Verify the username and password (percent-encoded where required) and that the user has access to the target database.                                       |
| `timeout`            | The connection attempt timed out.               | The database may be reachable but overloaded or connection-pool-limited; check the provider's pool limits and network latency.                               |
| `unknown`            | An unrecognized failure.                        | Check container logs for the full error and the database provider's status page.                                                                             |

Tune the retry behavior with `DB_BOOT_CONNECT_TIMEOUT_MS` (default `5000`, bounds 1000–30000 milliseconds) and `DB_BOOT_RETRY_WINDOWS_MS` (default `2000,5000,10000,30000`): the same progressive-window shape as `AUTH_LOGIN_BACKOFF_WINDOWS_MS`, where each entry is a delay in milliseconds and the final value is the cap once the attempt count exceeds the list length.

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

## Metrics

Coda exposes a Prometheus-format `/metrics` endpoint built on `prom-client`, gated by the
`METRICS_TOKEN` environment variable:

- **Unset (default): the route does not exist.** Requests to `/metrics` return `404`, exactly as
  if no such path were ever registered. This is intentional so an unconfigured instance never
  advertises a scrape surface.
- **Set:** `/metrics` requires `Authorization: Bearer <METRICS_TOKEN>`. A missing or incorrect
  token returns `401`; the correct token returns `200` with the Prometheus text exposition format.
- The route is registered directly on the HTTP server, ahead of both request routing and the
  single-page application's static fallback, and outside Nest's controller/module system — it
  therefore never appears in the OpenAPI/Swagger document and cannot be shadowed by static assets.
- Recording request duration is observation-only (one timestamp read, one histogram write per
  request) and adds no measurable latency to user requests.

Example Prometheus scrape config:

```yaml
scrape_configs:
  - job_name: coda
    scheme: https
    authorization:
      credentials: replace-with-your-metrics-token
    static_configs:
      - targets: ['coda.example.com']
```

### Metric inventory

| Metric                                | Type      | Labels                      | Description                                                                                                                                                                                                                                                                                |
| ------------------------------------- | --------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `coda_http_request_duration_seconds`  | Histogram | `method`, `route`, `status` | HTTP request duration. `route` is a bounded route **class** — the matched route pattern (e.g. `/api/v1/screenplays/:screenplayId`), or one of the fixed buckets `static`, `unmatched`, `metrics` — never a raw request path, so cardinality cannot grow with user data or probing traffic. |
| `coda_backup_engine_available`        | Gauge     | —                           | `1` once the in-app backup engine is constructed and reachable via dependency injection. A liveness/wiring signal for the engine.                                                                                                                                                          |
| `coda_storage_probe_up`               | Gauge     | —                           | Whether the last object-storage bucket probe succeeded (`1`) or failed (`0`). The underlying probe is a real network call, so results are cached for up to 30 seconds regardless of scrape interval.                                                                                       |
| `coda_update_available`               | Gauge     | —                           | Whether the release checker has observed a Coda release newer than the running version (`1`) or not (`0`). Backed by the same state as the update banner; adds no extra network calls.                                                                                                     |
| `coda_scheduler_job_runs_total`       | Counter   | `job`, `outcome`            | Registered extension point for scheduled-job execution telemetry, carrying no data until a scheduler calls the recording hook; `job` stays a small, fixed set of internal job names so the label set cannot grow with user data.                                                           |
| `coda_scheduler_job_duration_seconds` | Histogram | `job`                       | Registered extension point paired with the counter above.                                                                                                                                                                                                                                  |
| `coda_process_*`, `coda_nodejs_*`     | Various   | —                           | Standard `prom-client` default Node.js/process metrics (CPU, memory, event loop lag, GC, handles), namespaced with the `coda_` prefix.                                                                                                                                                     |

## Doctor page

**Settings → Doctor** renders a single owner-facing diagnostic snapshot, served by `GET /api/v1/instance/doctor` (instance administrator only). It aggregates existing health, probe, and status signals — it introduces no new probes — and every row degrades independently, so one subsystem failing to answer never blanks the rest of the report. Rows cover the application version, the update check, database reachability and latency, the object-storage backend, the resolved trusted-proxy set (with an `auto-detected` marker when `TRUSTED_PROXY_CIDRS=auto`), pending migrations, scheduler health, and instance counters (users, projects, storage used).

Each row is `ok`, `warn`, `error`, or `unknown` with a short value and, when unhealthy, a targeted hint. The page also produces a preformatted, plain-text report built exclusively from those rows — it carries the configured `APP_ORIGIN`, statuses, values, and hints, and never credential material — so it is safe to paste into a public bug report by construction.

## Upload resource limits

Uploads reserve space against per-project and instance-wide incomplete-upload limits before Coda returns a signed URL. Tune `STORAGE_PENDING_MAX_OBJECTS`, `STORAGE_PENDING_MAX_BYTES`, `STORAGE_PENDING_INSTANCE_MAX_OBJECTS`, and `STORAGE_PENDING_INSTANCE_MAX_BYTES` for the capacity of the object store. Pending or failed uploads older than `STORAGE_UPLOAD_RETENTION_HOURS`, including incomplete objects moved to trash, are removed through the durable storage-deletion queue.

PDF inspection transfers the bounded input buffer to a dedicated worker. `PDF_WORKER_MAX_OLD_GENERATION_MB` caps that worker's old-generation heap, while `PDF_MAX_BYTES` caps the input and cannot be configured above 262,144,000 bytes. Keep container or host memory monitoring enabled even when using these application-level limits.

Screenplay mutations first pass a bounded fixed-window pre-authentication limit keyed by the trusted client address: `SCREENPLAY_PREAUTH_MAX_PER_CLIENT` and `SCREENPLAY_PREAUTH_MAX_GLOBAL` apply during `SCREENPLAY_PREAUTH_WINDOW_MS`, return `429` with `Retry-After`, and run before session lookup or body parsing. Configure an equivalent edge limit at the reverse proxy as defense in depth. Bodies are admitted for parsing only after an active, unexpired cookie session is verified; bearer credentials cannot mutate screenplays. `SCREENPLAY_REQUEST_MAX_BYTES` is the transport byte ceiling for source-bearing routes; checkpoint creation is independently capped at 1 KiB. `SCREENPLAY_BODY_MAX_CONCURRENT` bounds session verification and parsing process-wide and must be at least two. Admission reserves one slot from any single trusted client address before authentication, then re-keys the reservation to the verified session so one client or session cannot consume every slot. `SCREENPLAY_BODY_TIMEOUT_MS` terminates stalled requests before releasing their admission capacity. Owner storage is limited transactionally by `SCREENPLAY_MAX_DOCUMENTS_PER_OWNER` and `SCREENPLAY_MAX_SOURCE_BYTES_PER_OWNER`; the latter measures canonical Fountain source as UTF-8 bytes. Explicit export checkpoints have a separate byte budget equal to the configured owner source-byte budget and are capped at 100 immutable snapshots per screenplay. Idempotent retries for an existing screenplay/version do not consume quota. Increasing the source-byte limit therefore also increases potential checkpoint storage and requires corresponding Postgres capacity and request-memory monitoring.

## Storage settings wizard

The `S3_*` environment variables bootstrap the object-storage backend at first boot. After setup, the instance administrator can inspect, test, and change the backend from Instance settings → Storage without redeploying or restarting.

- **Provider presets.** MinIO, Cloudflare R2, AWS S3, DigitalOcean Spaces, and a generic S3 preset pre-fill region semantics and path-style addressing (MinIO and generic default to path-style; R2, S3, and Spaces to virtual-hosted). Every field remains editable. Provide both the internal endpoint Coda reaches over the platform network and the browser-reachable public endpoint, which must be a distinct origin from `APP_ORIGIN`.
- **Live validation before acceptance.** Saving first runs a bounded, residue-free probe against the candidate backend: it writes a probe object, reads it back and compares bytes, generates a presigned URL on the public endpoint, and issues a CORS preflight for `APP_ORIGIN`. The probe object is always deleted, even on partial failure, and results are reported check by check. Nothing is persisted or activated when any check fails, so invalid credentials or a missing CORS policy never partially apply.
- **Encrypted persistence and hot-swap.** A clean probe persists the connection — credentials included — through the encrypted instance-configuration store (AES-256-GCM), so a database dump alone never reveals the secret key. The live S3 client is then swapped in-process: consumers resolve the active client per request, in-flight requests finish against the backend they started on, and the retired client is closed after a short drain. No restart is required, and the swapped backend survives container recreation because it is reloaded from the encrypted store at boot.
- **Provenance and revert.** The page always shows whether the active backend came from the environment (`Environment`) or from stored settings (`Instance settings`), along with the active bucket, live object count, and the CORS origin being validated. "Revert to environment configuration" deletes the stored override and hot-swaps back to the `S3_*` bootstrap values.
- **Existing-objects gate.** If live objects already exist in the current backend, a silent cutover is refused. The administrator must either explicitly acknowledge starting empty on the new backend (existing objects remain on the old one) or run the [verified object migration](#storage-reconfiguration-and-migration) below, which copies and verifies every object before an explicit cutover.

## Storage reconfiguration and migration

Changing the object-storage backend is an in-app operation for the instance administrator (**Settings → Storage**); it needs no redeploy or restart. There are two paths, both starting from a probe-validated target backend:

- **Start empty (hot-swap).** When the target is empty or you accept leaving existing objects behind, the [storage settings wizard](#storage-settings-wizard) validates the candidate backend, persists it encrypted, and hot-swaps the live S3 client in-process. Objects already stored on the previous backend are not moved.
- **Verified migration.** When the current backend holds objects you want to keep, run the verified object-migration job. It copies and verifies every object onto the target before any cutover, so no reference is ever pointed at an object that has not been confirmed present.

The migration is driven from the same Storage page and progresses through explicit phases (`idle → copying → verifying → verified → cutover`):

- **Start.** The target backend is validated with the same write/read/delete/presign/CORS probe as the wizard, then the job begins copying. The probe-validated target (secret included) and the resume cursors are stored in the encrypted instance-configuration store, so the job resumes exactly where it left off after a crash or replica failover; it runs under the singleton scheduler so only one replica works at a time.
- **Copy and verify.** Every object is copied to the target, then read back and checked byte-for-byte. Verification mismatches are accumulated and surfaced (bounded to a maximum count) rather than silently ignored.
- **Cutover.** Cutover is permitted only from the `verified` phase — after every object has copied and verified. It swaps the active backend to the target the same way the wizard does. Because the target already holds every verified object, the cutover carries no data loss.
- **Cancel.** Cancelling deletes the migration state and leaves the current backend active and untouched.

Endpoints (owner-only): `GET`/`POST /api/v1/instance/storage-migration`, with `POST /api/v1/instance/storage-migration/start`, `/cutover`, and `/cancel`. The active backend and each candidate always show their provenance (environment or instance settings) on the Storage page.

## Back up

A complete backup needs both Postgres and object storage from a consistent point in time. The database contains object keys and reference state; restoring only one side can leave missing or orphaned files. Coda offers four in-app backup flows on top of the operator-side procedures below — [download](#download-a-backup), [restore at setup](#restore-at-setup), [scheduled backups](#scheduled-backups), and the automatic [pre-upgrade auto-backup](#pre-upgrade-auto-backup) — all producing the same signed `.codabk` archive whose format contract is described in [Data compatibility](data-compatibility.md).

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

## In-app backup engine

The API embeds a backup engine (service layer) so the application itself can produce and ingest a portable archive without the operator-side Compose orchestration. It backs the four in-app backup flows — [download](#download-a-backup), [restore at setup](#restore-at-setup), [scheduled backups](#scheduled-backups), and the [pre-upgrade auto-backup](#pre-upgrade-auto-backup). The runtime image carries a pinned `postgresql-client` so the engine can run `pg_dump`/`pg_restore` in-process, and every temporary file is staged in the container's `tmpfs` mount so the hardened read-only root filesystem is never written and the full archive is never buffered in memory. The `.codabk` archive format and its N / N-1 / N-2 import window are the durable contract described in [Data compatibility](data-compatibility.md).

### Archive format

An archive is a single streamed container. All integers are big-endian.

```
"CODA-BK1"             8-byte magic
uint32 manifestLength
manifest JSON bytes
uint32 signatureLength
Ed25519 signature (base64 text)
<entry content>        raw bytes, database dump first, then each object in manifest order
```

The manifest and its signature lead the stream so a reader authenticates the archive and enforces the format-version window before a single content byte is written anywhere. Entry lengths and checksums come from the signed manifest, so every payload boundary is covered by the signature and each entry is verified against its recorded SHA-256 as it is staged.

The metadata manifest records:

- `formatVersion` — the archive format version (see the import window below).
- `createdAt` — UTC creation timestamp.
- `appVersion` — the Coda application version that produced the archive.
- `creationContext` — the backup reason, database name, bucket, and optional Compose project.
- `database` — canonical path (`database.dump`), byte size, and SHA-256 of the custom-format `pg_dump`.
- `objectStorage` — bucket, a per-object byte-size and SHA-256 inventory, and an inventory checksum.
- `authenticity` — the `Ed25519` algorithm and the SHA-256 fingerprint (SPKI DER) of the verification key.

The manifest is signed with the same Ed25519 convention as the operator recovery manifest in `scripts/ops`, so a single key pair authenticates both operator and in-app archives. Sign with a private key kept outside the archive and distribute the public verification key through a separate trusted channel.

### Import window and restore guards

Import accepts the current format version and the two previous versions (`N`, `N-1`, `N-2`). A newer archive is refused with an explicit upgrade message before any write; an archive older than the window is refused as unsupported. Restore verifies the manifest signature, confirms the verification key matches the manifest fingerprint, and enforces the version window before touching the database or object storage. It then restores only into an uninitialized instance: the target must have no owner and an empty bucket. The database dump is applied inside a single transaction that replaces the schema, and objects are uploaded only after every staged entry passes checksum verification.

### In-app signing key

The in-app download and restore-at-setup flows derive their Ed25519 key pair deterministically from `CONFIG_ENCRYPTION_KEY` — the same durable instance secret that encrypts the configuration store. No separate key file is required. Because the key pair is a function of that one secret, an archive downloaded from instance A verifies on instance B only when B is provisioned with A's `CONFIG_ENCRYPTION_KEY` (which the operator must carry anyway to decrypt A's configuration rows). If `CONFIG_ENCRYPTION_KEY` is unset or shorter than 32 base64-decoded bytes, download and restore both fail with an explicit, actionable message rather than producing an unverifiable archive.

### Download a backup

The owner-only Backups section in instance settings streams a signed archive straight to the browser from `GET /api/v1/instance/backups/download`. The request carries the session cookie same-origin, only the instance owner is authorized, and the response streams through the container's `tmpfs` bounds without buffering the whole archive in memory. The download is a single `*.codabk` file that contains the database dump and every stored object; treat it as sensitive — it holds all instance data — and store it access-controlled and encrypted at rest.

### Restore at setup

A fresh, uninitialized instance can be restored from its first-run screen without shell access:

1. Deploy a new instance and provision it with the **same `CONFIG_ENCRYPTION_KEY`** as the source instance. Point it at an empty database and an empty bucket.
2. Open the first-run screen. Instead of creating an owner account, choose **"Restore from a backup instead."**
3. If the instance requires a setup token, enter it — restore is gated by the setup token exactly like owner creation.
4. Select the `*.codabk` archive and start the restore. Progress streams back as newline-delimited JSON (verify, database, objects); the signature and format version are verified before any write.

Restore refuses to run against an already-initialized instance and leaves the target untouched on any pre-completion failure (rejected token, wrong key, bad signature, unsupported version, truncated upload). On success the instance holds the backed-up data and you sign in with an account from the restored instance.

### Pre-upgrade auto-backup

When an initialized instance boots with pending database migrations, Coda captures an automatic safety backup before applying them. The boot sequence probes the database, detects committed-but-unapplied migrations, and — for an existing instance with genuinely pending migrations — writes a signed archive to the active bucket under `backups/pre-upgrade/`, keeping the most recent `PRE_UPGRADE_BACKUP_KEEP` archives (default 3) and pruning older ones. A fresh install (empty migration history) and an up-to-date instance are both skipped: there is nothing to protect.

If the safety backup cannot be created, boot does **not** apply the migrations: it re-enters the same database-readiness diagnostic page and retries, so an upgrade can never run migrations without a fresh restore point. Pruning old archives is best-effort and never blocks boot once the new archive exists. The `backups/` prefix is hidden from the application's object enumeration and empty-target checks, so safety archives never recurse into later backups and never block a restore-at-setup empty-bucket guard.

Set `PRE_UPGRADE_BACKUP=off` to opt out and apply migrations without a safety backup — an explicit escape hatch for operators who take an equivalent backup by other means. The step also requires `CONFIG_ENCRYPTION_KEY`; with the opt-out unset and no key configured, boot aborts rather than upgrading unprotected.

## Scheduled backups

The instance can continuously back itself up on an operator-defined schedule, using the singleton job scheduler so exactly one replica runs each backup cluster-wide. Configure it under **Settings → Backups → Scheduled backups** (instance administrator only); all settings are stored in the encrypted instance-configuration store, so no additional environment variables are required.

- **Cadence.** Enable/disable the schedule and set an interval in whole hours (default 24). The scheduler wakes on a fixed poll interval (`SCHEDULED_BACKUP_TICK_MS`, default one hour) and runs a backup only when the configured interval has elapsed since the last attempt, so changing the interval takes effect without a restart.
- **Destination.** By default archives are written to the active object-storage backend under the `backups/scheduled/` prefix. Stored archives are excluded from subsequent backups, so archives are never folded back into a new backup. Optionally configure a dedicated bucket or a separate endpoint so the backup failure domain is isolated from primary storage; the override is validated with the same write/read/delete/presign/CORS probe as the storage wizard before it is saved, and is persisted encrypted.
- **Retention.** A rolling policy keeps the newest `keepLast` archives (default 7), plus optional daily and weekly tiers (keep the newest archive of each of the most recent _N_ days / weeks), plus an optional maximum age. Retention runs **only after a new archive has been durably uploaded**, and the newest `keepLast` archives are never deleted regardless of age — a maximum-age cap can trim the daily/weekly tiers but can never remove one of the newest `keepLast`. If a backup fails for any reason (database, source storage, or destination), nothing is pruned, so a misbehaving backend can never cause existing archives to be deleted.
- **Signing.** Scheduled archives are signed with an Ed25519 key pair generated on first use and stored encrypted. The verification-key fingerprint is shown in the section; record the public key through a trusted channel so scheduled archives can be verified on restore with the same tooling as manual and operator backups.
- **Visibility.** The section surfaces last-run status, next-due time, recent run history (kept in the config store), and failures. Scheduler liveness is recorded in the `scheduled_job_status` table; per-backup outcomes are recorded in the history log. **Back up now** forces an immediate run regardless of the schedule.

Disabling the schedule stops the job from running without touching any stored archive. Very large instances whose backups exceed the scheduler's per-job transaction budget should raise `SCHEDULER_JOB_TIMEOUT_MS`; a scheduled backup is always safe to re-run, because each run writes a new archive and retention never deletes the newest archives.

## Update checker and upgrade ceremony

Coda checks for and can drive its own upgrades from the instance settings, on top of the
digest-pinned manual procedure below.

### Update checker

A background release checker polls the latest GitHub release's `release.json` asset for a newer
version at the `UPDATE_CHECK_INTERVAL_HOURS` cadence (see the [environment
contract](#environment-contract)). **Settings → Updates** shows the current and latest versions,
the latest release notes, a manual **Check now** action, per-version banner dismissal, and a
polling-interval preference that overrides the environment default. A malformed or unreachable
release feed is logged quietly and never affects health checks. Endpoints (owner-only):
`GET /api/v1/updates/status`, `POST /api/v1/updates/check`,
`PUT /api/v1/updates/polling-preference`, and `POST /api/v1/updates/dismiss`.

### Upgrade ceremony

The upgrade ceremony is an **opt-in, owner-driven** flow layered over the update checker, exposed
under `GET /api/v1/updates/ceremony` and its actions. It enforces one strict invariant: **no
redeploy trigger runs without a fresh, successful backup recorded for the current target.**

It requires `CONFIG_ENCRYPTION_KEY`, because the mandatory backup is signed and stored with the
key-derived signing key. The server computes a phase for the panel: `unavailable` (no newer
release), `needs_encryption_key` (an update exists but the key is unset), `ready_to_backup` (update
available and key present), or `ready_to_deploy` (a fresh backup for the current target exists).

1. **Backup gate.** `POST /api/v1/updates/ceremony/backup` takes a fresh signed backup through the
   in-app backup engine. Only on success does it record a pending backup that unlocks the deploy
   actions; the pending backup is valid for two hours and only while it matches the current target
   version. A failed backup is recorded and aborts the ceremony — no pending state is written, so
   no deploy path can proceed.
2. **Generic tier.** The panel shows the target image's tagged and digest-pinned references. The
   operator updates the platform's `CODA_IMAGE` environment variable to the target digest, checks
   the explicit confirmation, and calls `POST /api/v1/updates/ceremony/redeploy` to fire the
   configured redeploy webhook. The webhook URL is stored encrypted (it may embed a deploy token)
   and is never returned to the browser or written to logs. Configure it with
   `PUT`/`DELETE /api/v1/updates/ceremony/webhook`.
3. **Coolify adapter tier.** Optionally store Coolify credentials with
   `PUT`/`DELETE /api/v1/updates/ceremony/coolify` (base URL, application UUID, and a write-only
   API token that is never returned or logged). `POST /api/v1/updates/ceremony/coolify/deploy`
   then pins the application's `CODA_IMAGE` to the target digest and triggers a deployment in one
   call. If the adapter fails, the ceremony falls back to the generic tier with the backup intact:
   the failure is recorded and surfaced, but no exception is thrown, so the operator can still
   redeploy manually.

A bounded, most-recent-first history of ceremony steps (backup, generic, Coolify) records each
outcome and its backup reference. Deploy-triggering actions are hard-throttled because they take a
full backup and reach out to the platform.

## Upgrade

The manual, digest-pinned upgrade below remains fully supported and is the reference path when the
ceremony is not used.

> **Upgrading from a pre-v0.0.4 instance.** Two first-run behaviors changed. `SETUP_TOKEN` is now
> optional — leave it unset and Coda generates a one-time token at first boot, printed to the
> container logs until owner setup completes. `TRUSTED_PROXY_CIDRS` now accepts `auto`, which
> derives the trust boundary from the container's attached private subnets in a single deploy;
> the deployment templates ship `auto`. Existing explicit values keep working unchanged.

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

The `Recovery` GitHub Actions workflow continuously exercises the full bundled lifecycle from the public v0.0.1 manifest digest to the current candidate: API fixture creation with a real object reference, signed coordinated backup, deliberate signature-tamper rejection, same-version restore, candidate upgrade and smoke test, destructive reset limited to the disposable target, then rollback by restoring the matching v0.0.1 backup. It runs both the bundled and app-only Compose application boundaries; the app-only test supplies disposable PostgreSQL and MinIO services only as stand-ins for provider-native restore targets. The same workflow also runs the in-app backup round-trip gate: it downloads a signed `.codabk` archive from a source instance, restores it into a fresh same-version instance and asserts an identical content digest, then restores a committed previous-release fixture to prove the N / N-1 import window still holds. See [Data compatibility](data-compatibility.md) for the format contract these gates enforce. Dated manifests, signatures, public verification keys, dumps, object inventories, and smoke evidence are retained for review. Unit, integration, and browser end-to-end suites remain separate required release gates; recovery validation supplements rather than replaces them.

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
