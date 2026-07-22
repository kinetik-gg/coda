# Deployment and operations

The reference deployment uses Docker Compose with Coda, Postgres, and MinIO. Persistent volumes are operator-managed and survive container replacement.

## Deploy

1. Copy `.env.example` to `.env` outside version control.
2. Replace every placeholder secret with a unique, high-entropy value. `SETUP_TOKEN` must contain at least 32 characters and is required in production.
3. Set `CODA_IMAGE` to the release workflow's attested `name@sha256:...` manifest reference. Do not substitute a mutable version or channel tag.
4. Set `APP_ORIGIN` and `S3_PUBLIC_ENDPOINT` to the browser-reachable origins. Keep
   `CODA_BIND_ADDRESS=127.0.0.1` when the reverse proxy runs on the same host.
5. Start the pinned release:

   ```sh
   docker compose pull
   docker compose up -d
   ```

6. Wait for `GET /api/v1/health/ready` to return success, then complete the one-time owner setup using the configured setup token.

The application entrypoint runs committed Prisma migrations before starting the API. Do not run development migrations against production.

## Reverse proxy

Terminate TLS at a reverse proxy and forward WebSocket upgrades for Socket.IO. Preserve the original host and scheme. The Compose stack binds Coda to `127.0.0.1` by default. Set `CODA_BIND_ADDRESS` to another address only when an external proxy requires it, and firewall that address so clients cannot bypass the proxy. Set `TRUSTED_PROXY_CIDRS` to the comma-separated source IPs or narrow CIDRs from which Coda receives proxy traffic; Coda trusts `X-Forwarded-For` only from those addresses so throttling remains per client. The default trusts loopback only. Ensure the proxy overwrites forwarded headers. Do not use an all-address CIDR such as `0.0.0.0/0`. Limit request bodies at or above Coda's configured PDF and asset limits. The MinIO API must be reachable by browsers at `S3_PUBLIC_ENDPOINT`, while its administration console and internal endpoint should remain private.

Project JSON exports stream from a repeatable-read database snapshot. A slow or abandoned download therefore holds one database connection until completion, cancellation, or the bounded export timeout.

## Health and logs

- `/api/v1/health/live` indicates that the process is running.
- `/api/v1/health/ready` checks whether required dependencies are ready.
- Application logs are structured JSON and include an `x-request-id` response header for correlation.

Monitor application restarts, readiness failures, Postgres capacity, object-store capacity, request latency, error rate, and backup age.

## Upload resource limits

Uploads reserve space against per-project and instance-wide incomplete-upload limits before Coda returns a signed URL. Tune `STORAGE_PENDING_MAX_OBJECTS`, `STORAGE_PENDING_MAX_BYTES`, `STORAGE_PENDING_INSTANCE_MAX_OBJECTS`, and `STORAGE_PENDING_INSTANCE_MAX_BYTES` for the capacity of the object store. Pending or failed uploads older than `STORAGE_UPLOAD_RETENTION_HOURS`, including incomplete objects moved to trash, are removed through the durable storage-deletion queue.

PDF inspection transfers the bounded input buffer to a dedicated worker. `PDF_WORKER_MAX_OLD_GENERATION_MB` caps that worker's old-generation heap, while `PDF_MAX_BYTES` caps the input and cannot be configured above 262,144,000 bytes. Keep container or host memory monitoring enabled even when using these application-level limits.

Screenplay mutation bodies are admitted before parsing only after an active, unexpired cookie session is verified. Bearer credentials cannot mutate screenplays. `SCREENPLAY_REQUEST_MAX_BYTES` is the transport byte ceiling, `SCREENPLAY_BODY_MAX_CONCURRENT` bounds simultaneous session verification and parsing, and `SCREENPLAY_BODY_TIMEOUT_MS` terminates stalled requests before releasing their admission capacity. Owner storage is limited transactionally by `SCREENPLAY_MAX_DOCUMENTS_PER_OWNER` and `SCREENPLAY_MAX_SOURCE_BYTES_PER_OWNER`; the latter measures canonical Fountain source as UTF-8 bytes. Increasing these values requires corresponding Postgres capacity and request-memory monitoring.

## Back up

A complete backup needs both Postgres and object storage from a consistent point in time. The database contains object keys and reference state; restoring only one side can leave missing or orphaned files.

For a small instance, stop Coda writes before taking backups:

1. Stop or place the Coda application behind maintenance mode while leaving Postgres and MinIO running.
2. Create a PostgreSQL custom-format dump with `pg_dump`.
3. Snapshot or mirror the MinIO bucket and its configuration using the object-store's supported backup procedure.
4. Record the Coda image digest, database migration version, backup timestamp, and checksums.
5. Store encrypted copies outside the host and test restoration regularly.

Do not treat Docker volumes, filesystem synchronization, or the project JSON export as a complete backup by itself.

## Restore

Restore into an isolated environment first. Use the same Coda release that created the backup, restore Postgres and object storage, verify configuration, then run readiness and product smoke tests. Confirm that source PDFs and other storage objects can be read before switching traffic.

Restoration overwrites durable state. Keep the previous environment intact until the restored instance is verified.

## Upgrade

1. Read `CHANGELOG.md` and the release notes.
2. Take and verify a complete backup.
3. Pin `CODA_IMAGE` to the target release's attested `name@sha256:...` manifest reference.
4. Pull the image and recreate only the Coda service:

   ```sh
   docker compose pull coda
   docker compose up -d coda
   ```

5. Watch migration output and wait for readiness.
6. Smoke-test sign-in, project reads and writes, source PDF access, upload, export, and an external credential if used.

Database migrations are forward operations. A rollback that crosses a migration boundary requires the release-specific procedure or a verified backup restore.
