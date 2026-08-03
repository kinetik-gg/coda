# Deploy with generic Docker

This guide defines Coda's generic Docker support boundary and the lifecycle checks used to
qualify it. For the complete environment contract, backup procedures, and recovery details, see
[Deployment and operations](operations.md).

## Support boundary

The generic Docker deployment claim covers one Coda application container with:

- Ubuntu 24.04 on AMD64;
- Docker Engine 26 or newer with the Docker Compose plugin;
- the canonical app-only [`compose.app.yaml`](../compose.app.yaml) topology;
- an immutable release image reference in `CODA_IMAGE` using `name@sha256:...`; and
- operator-owned PostgreSQL, S3-compatible object storage, and TLS termination, each managed
  outside the Coda application lifecycle.

The bundled full stack in `compose.yaml` is an evaluation quickstart, not part of this generic
Docker support claim. Compatibility with a particular reverse proxy, infrastructure provider,
database or object-storage service, control panel, or orchestration platform requires its own
qualification and is not implied by this guide.

## Install from a release bundle

Set `VERSION` to the release you are installing. Download the deployment archive and checksum,
verify both GitHub attestations and the checksum, then extract the bundle:

```sh
VERSION=v0.0.7
gh release download "$VERSION" --repo kinetik-gg/coda \
  --pattern "coda-deployment-${VERSION}.tar.gz" \
  --pattern "coda-deployment-${VERSION}.sha256"
gh attestation verify "coda-deployment-${VERSION}.tar.gz" --repo kinetik-gg/coda
gh attestation verify "coda-deployment-${VERSION}.sha256" --repo kinetik-gg/coda
sha256sum --check "coda-deployment-${VERSION}.sha256"
tar --extract --gzip --file "coda-deployment-${VERSION}.tar.gz"
cd "coda-deployment-${VERSION}"
```

Prepare the environment file without committing it. Keep the bundle's injected immutable
`CODA_IMAGE`, replace every remaining placeholder, and restrict the file to the deployment
operator:

```sh
cp .env.example .env
chmod 600 .env
```

At minimum, configure `APP_ORIGIN`, `TRUSTED_PROXY_CIDRS`, `DATABASE_URL`,
`CONFIG_ENCRYPTION_KEY`, and the `S3_*` variables. PostgreSQL and object storage must already be
reachable, and the bucket and browser CORS policy must already exist. Use a TLS-validated database
connection and bucket-scoped object-storage credentials. Configure the operator-owned TLS proxy to
forward the public Coda origin to container port 3000 on a private Docker network.

Start only the canonical app-only topology:

```sh
docker compose -f compose.app.yaml pull
docker compose -f compose.app.yaml up -d
docker compose -f compose.app.yaml ps
```

The canonical file publishes no host port. For a direct loopback-only diagnostic, add
`-f compose.app.local.yaml`; do not use that override as the public TLS layer. Wait for
`GET /api/v1/health/ready` to succeed, then complete the one-time owner setup. See
[Deployment and operations](operations.md#deploy) for setup-token behavior and the full startup
contract.

## Lifecycle qualification checklist

The generic Docker lane is qualified against a clean host using the release bundle, not a source
checkout. Record the release version, bundle checksum, immutable image digest, Docker and Compose
versions, and sanitized results for every check. Never publish credentials, private endpoints, or
environment files.

- **Fresh install:** start from a clean Ubuntu 24.04 AMD64 host, install Docker Engine and the
  Compose plugin, verify the release artifacts, configure external services, and reach the ready
  health check using `compose.app.yaml`.
- **HTTPS and owner setup:** reach `APP_ORIGIN` over valid HTTPS, confirm insecure HTTP is not the
  application entry point, complete owner setup once, and verify the setup token cannot be reused.
- **Object round trip:** upload an object through the browser's signed transfer flow, retrieve it
  through the signed read flow, and confirm Coda uses the configured private bucket.
- **Restart and reboot:** restart the Coda container and reboot the host; after each event, confirm
  readiness, owner login, database-backed content, and the stored object remain available.
- **Upgrade:** deploy the previous release by immutable digest, create representative data and a
  backup, replace `CODA_IMAGE` with the current release digest, pull, and redeploy. Confirm
  migrations complete and the existing data and object still work.
- **Backup, isolated restore, and rollback:** export and verify a `.codabk` archive, restore it into
  isolated empty PostgreSQL and object-storage targets with the required encryption key, and
  confirm the restored data and object. Exercise the documented rollback procedure from verified
  backups rather than starting an older image against a migrated database.
- **Network exposure:** confirm the host exposes only the operator's intended SSH, HTTP, and HTTPS
  entry points; PostgreSQL, object storage administration, and container port 3000 remain private.
- **Resource measurements:** record idle and exercised container memory, CPU, process count, disk
  use, and restart behavior so the observed workload can be compared with the limits in
  `compose.app.yaml`.

Detailed backup, restore, upgrade, and rollback commands are maintained in
[Deployment and operations](operations.md). A successful checklist establishes only the support
boundary above.
