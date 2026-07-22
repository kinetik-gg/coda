# Deployment and operations

The reference deployment uses Docker Compose with Coda, Postgres, and MinIO. Persistent volumes are operator-managed and survive container replacement.

## Deploy

1. Copy `.env.example` to `.env` outside version control.
2. Replace every placeholder secret with a unique, high-entropy value. `SETUP_TOKEN` must contain at least 32 characters and is required in production.
3. Set `APP_ORIGIN` and `S3_PUBLIC_ENDPOINT` to the browser-reachable origins.
4. Start the pinned release:

   ```sh
   docker compose pull
   docker compose up -d
   ```

5. Wait for `GET /api/v1/health/ready` to return success, then complete the one-time owner setup using the configured setup token.

The application entrypoint runs committed Prisma migrations before starting the API. Do not run development migrations against production.

## Reverse proxy

Terminate TLS at a reverse proxy and forward WebSocket upgrades for Socket.IO. Preserve the original host and scheme. Limit request bodies at or above Coda's configured PDF and asset limits. The MinIO API must be reachable by browsers at `S3_PUBLIC_ENDPOINT`, while its administration console and internal endpoint should remain private.

## Health and logs

- `/api/v1/health/live` indicates that the process is running.
- `/api/v1/health/ready` checks whether required dependencies are ready.
- Application logs are structured JSON and include an `x-request-id` response header for correlation.

Monitor application restarts, readiness failures, Postgres capacity, object-store capacity, request latency, error rate, and backup age.

## Back up

A complete backup needs both Postgres and object storage from a consistent point in time. The database contains object keys and reference state; restoring only one side can leave missing or orphaned files.

For a small instance, stop Coda writes before taking backups:

1. Stop or place the Coda application behind maintenance mode while leaving Postgres and MinIO running.
2. Create a PostgreSQL custom-format dump with `pg_dump`.
3. Snapshot or mirror the MinIO bucket and its configuration using the object-store's supported backup procedure.
4. Record the Coda image tag, database migration version, backup timestamp, and checksums.
5. Store encrypted copies outside the host and test restoration regularly.

Do not treat Docker volumes, filesystem synchronization, or the project JSON export as a complete backup by itself.

## Restore

Restore into an isolated environment first. Use the same Coda release that created the backup, restore Postgres and object storage, verify configuration, then run readiness and product smoke tests. Confirm that source PDFs and other storage objects can be read before switching traffic.

Restoration overwrites durable state. Keep the previous environment intact until the restored instance is verified.

## Upgrade

1. Read `CHANGELOG.md` and the release notes.
2. Take and verify a complete backup.
3. Pin `CODA_IMAGE` to the target release tag; avoid mutable tags for production.
4. Pull the image and recreate only the Coda service:

   ```sh
   docker compose pull coda
   docker compose up -d coda
   ```

5. Watch migration output and wait for readiness.
6. Smoke-test sign-in, project reads and writes, source PDF access, upload, export, and an external credential if used.

Database migrations are forward operations. A rollback that crosses a migration boundary requires the release-specific procedure or a verified backup restore.
